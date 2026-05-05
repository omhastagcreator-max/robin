import { useEffect, useRef, useState } from 'react';
import * as api from '@/api';

/**
 * useHuddleTranscription
 *
 * Captures the user's own speech via the browser's Web Speech API while
 * they are in the huddle, batches lines, and posts them to the server.
 * Truly free — Chrome/Edge/Safari run STT on Google's servers behind the
 * scenes at no cost.
 *
 * Why per-user (not per-room) transcription:
 *   - Each browser only hears its own mic, so speaker labels are automatic.
 *   - No server-side audio plumbing, no LiveKit Egress fees.
 *   - Each user can opt out individually with one toggle.
 *
 * Browser quirks we handle:
 *   - The recogniser silently stops every ~30 seconds. We auto-restart.
 *   - 'no-speech' / 'audio-capture' errors are normal — restart on those.
 *   - Final results > interim results (we only post 'isFinal').
 */

const FLUSH_INTERVAL_MS = 5000;        // batch upload every 5s
const FLUSH_MAX_LINES   = 8;           // or sooner if the buffer fills

type Line = {
  text: string;
  confidence?: number;
  startedAt: string;
  endedAt?: string;
};

interface Options {
  enabled: boolean;             // master switch (huddle.joined)
  roomId: string;
  language?: string;            // BCP-47, defaults to en-IN
}

export function useHuddleTranscription({ enabled, roomId, language = 'en-IN' }: Options) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [linesPosted, setLinesPosted] = useState(0);

  const recognitionRef = useRef<any>(null);
  const bufferRef = useRef<Line[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lineStartedAtRef = useRef<string>(new Date().toISOString());
  const cancelledRef = useRef(false);

  // ── Flush buffer to server ────────────────────────────────────────────────
  const flush = async () => {
    const batch = bufferRef.current;
    if (!batch.length) return;
    bufferRef.current = [];
    try {
      const data = await api.postTranscriptLines({
        roomId,
        language,
        lines: batch,
      });
      setLinesPosted(p => p + (data?.inserted ?? batch.length));
    } catch {
      // On failure, push the batch back to retry next flush. Drop after
      // 100 lines to avoid runaway memory use.
      bufferRef.current = [...batch, ...bufferRef.current].slice(-100);
    }
  };

  useEffect(() => {
    if (!enabled || !roomId) return;
    cancelledRef.current = false;

    // Detect support — Chrome/Edge use webkitSpeechRecognition,
    // Safari ships SpeechRecognition. Firefox: not supported.
    const SR: any =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SR) {
      setSupported(false);
      return;
    }

    const recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;       // interim makes it feel live; we only POST finals
    recognition.lang           = language;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setListening(true);
      setLastError(null);
      lineStartedAtRef.current = new Date().toISOString();
    };

    // For each result, the API gives us a list. The "isFinal" ones are
    // sentences the engine is confident about — those are what we keep.
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        if (!r.isFinal) continue;
        const alt = r[0];
        const text = (alt?.transcript || '').trim();
        if (!text) continue;

        bufferRef.current.push({
          text,
          confidence: alt.confidence,
          startedAt:  lineStartedAtRef.current,
          endedAt:    new Date().toISOString(),
        });
        // Reset the next-line marker
        lineStartedAtRef.current = new Date().toISOString();

        if (bufferRef.current.length >= FLUSH_MAX_LINES) flush();
      }
    };

    recognition.onerror = (e: any) => {
      // 'no-speech' and 'aborted' are normal pauses — silent on those.
      if (e?.error && !['no-speech', 'aborted'].includes(e.error)) {
        setLastError(e.error);
      }
    };

    // Browsers stop the recogniser every ~30s. Auto-restart while enabled.
    recognition.onend = () => {
      setListening(false);
      if (cancelledRef.current) return;
      try { recognition.start(); } catch { /* will retry next tick */ }
    };

    try { recognition.start(); } catch { /* ignore — onend will retry */ }

    intervalRef.current = setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      cancelledRef.current = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
      try { recognition.stop(); } catch { /* ignore */ }
      // Final flush on unmount
      flush();
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, roomId, language]);

  return { supported, listening, lastError, linesPosted };
}
