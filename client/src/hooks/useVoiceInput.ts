import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useVoiceInput — thin React wrapper around the browser's SpeechRecognition
 * (Web Speech API) so any input field in Robin can be filled by voice.
 *
 * Usage:
 *
 *   const v = useVoiceInput({
 *     language: 'en-IN',
 *     onFinal: (text) => setInput(text),
 *     // optional: auto-stop after this many ms of silence (default 1500)
 *     silenceMs: 1500,
 *   });
 *   <button onClick={v.listening ? v.stop : v.start}>...</button>
 *
 * Browser support today:
 *   - Chrome / Edge : webkitSpeechRecognition ✓
 *   - Safari        : SpeechRecognition ✓ (since 14.1)
 *   - Firefox       : not supported (returns supported=false)
 *
 * The hook surfaces:
 *   - listening     : true while recognition is active
 *   - transcript    : the running interim+final text
 *   - error         : last error name (no-speech / audio-capture / not-allowed / aborted)
 *   - supported     : Web Speech API available
 *   - start / stop  : imperative controls
 *
 * Implementation notes:
 *   - We use `continuous=true` + `interimResults=true` so the consumer
 *     sees the transcript grow live (e.g. type-along feel in a textarea).
 *   - A silence-watchdog auto-stops the recogniser when no new interim
 *     results have arrived in `silenceMs`. SpeechRecognition's native
 *     onend doesn't always fire predictably; the watchdog is what makes
 *     "speak then pause" feel natural.
 *   - We call onFinal exactly once per session with the cleaned-up final
 *     transcript when stop() runs (manual or auto).
 */

interface Options {
  language?: string;          // BCP-47 tag — default 'en-IN'
  silenceMs?: number;         // auto-stop after N ms of no new words
  onFinal?: (text: string) => void;
}

export function useVoiceInput(opts: Options = {}) {
  const language  = opts.language || 'en-IN';
  const silenceMs = opts.silenceMs ?? 1500;

  const [listening,  setListening]  = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error,      setError]      = useState<string | null>(null);

  const recogRef       = useRef<any>(null);
  const silenceTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalRef       = useRef<string>('');           // accumulated final text
  const onFinalRef     = useRef(opts.onFinal);
  onFinalRef.current   = opts.onFinal;

  const supported = typeof window !== 'undefined' && (
    !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition
  );

  // ── start ──────────────────────────────────────────────────────────
  const start = useCallback(() => {
    if (!supported || listening) return;
    setError(null);
    setTranscript('');
    finalRef.current = '';
    const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new Ctor();
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = language;

    r.onresult = (ev: any) => {
      let interim = '';
      let final   = finalRef.current;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0]?.transcript || '';
        if (res.isFinal) final += txt;
        else             interim += txt;
      }
      finalRef.current = final;
      setTranscript((final + ' ' + interim).trim());
      // Reset silence watchdog every time new words arrive.
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => stop(), silenceMs);
    };
    r.onerror = (ev: any) => {
      setError(String(ev?.error || 'unknown'));
      // 'no-speech' is harmless — the user just hasn't talked yet.
      if (ev?.error !== 'no-speech') stop();
    };
    r.onend = () => {
      setListening(false);
      if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
      const final = finalRef.current.trim();
      if (final) onFinalRef.current?.(final);
    };

    try {
      r.start();
      recogRef.current = r;
      setListening(true);
      // Initial silence guard — if the user clicks the mic and says nothing
      // for `silenceMs`, we stop so we don't sit listening forever.
      silenceTimer.current = setTimeout(() => stop(), silenceMs);
    } catch (e: any) {
      setError(e?.message || 'start failed');
      setListening(false);
    }
  // stop is defined below; intentional self-ref via closure on next render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, silenceMs, supported, listening]);

  // ── stop ───────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    const r = recogRef.current;
    recogRef.current = null;
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    setListening(false);
    if (r) {
      try { r.stop(); } catch { /* ignore */ }
      // r.onend will fire and dispatch onFinal with the final transcript.
    }
  }, []);

  // Cleanup on unmount — make sure we never leave the mic open.
  useEffect(() => () => { stop(); }, [stop]);

  return { listening, transcript, error, supported, start, stop };
}

export default useVoiceInput;
