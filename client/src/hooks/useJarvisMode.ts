import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/api';
import { executeRobinCommand, type RobinAction } from '@/lib/robinActions';

/**
 * useJarvisMode — hands-free voice assistant.
 *
 * One always-on SpeechRecognition listener. Pipeline:
 *
 *   [continuous listen]
 *        │
 *        ├── hears wake word ("hey robin" / "ok robin" / "robin")
 *        │         │
 *        │         ▼
 *        │   [armed]  → next utterance is the command
 *        │         │
 *        │         ▼
 *        │   command captured on silence
 *        │         │
 *        │         ├── /parse-command (Gemini)
 *        │         │
 *        │         ├── ACTION → executeRobinCommand (NO confirm card)
 *        │         │         → speak result aloud
 *        │         │
 *        │         └── QUESTION → /copilot → speak answer aloud
 *        │
 *        └── back to continuous listen
 *
 * State exposed:
 *   - enabled    : Jarvis mode on/off (persisted)
 *   - state      : 'idle' | 'listening' | 'armed' | 'thinking' | 'speaking'
 *   - transcript : the live interim transcript (for the orb UI)
 *   - lastReply  : the most recent thing Robin said
 *   - error      : surface speech-API errors
 *   - toggle()   : flip on/off (asks mic permission first time)
 *
 * Browser support:
 *   - Chrome / Edge : webkitSpeechRecognition + SpeechSynthesis ✓
 *   - Safari        : limited continuous mode; works but flakier
 *   - Firefox       : no SpeechRecognition — toggle stays unavailable
 */

type JarvisState = 'idle' | 'listening' | 'armed' | 'thinking' | 'speaking';

const STORAGE_KEY = 'robin.jarvis.enabled';
// Phrases that arm command-capture. Kept loose because consumer
// recognition mishears "Hey Robin" as "a Robin" / "hi Robin" / etc.
// All matches are case-insensitive substring tests on the interim
// transcript — false-positives are cheap (one extra prompt), but
// false-negatives mean Jarvis ignores the user, which is worse.
const WAKE_PHRASES = [
  'hey robin', 'ok robin', 'okay robin', 'hi robin', 'hello robin',
  'yo robin', 'robin,', 'robin please', 'robin can you', 'robin do',
];
// Trim the wake-phrase prefix off the command so we don't ship
// "hey robin mark Oudfy payment done" to parse-command.
function stripWakePhrase(text: string): string {
  const lower = text.toLowerCase();
  for (const w of WAKE_PHRASES) {
    const idx = lower.indexOf(w);
    if (idx === 0) return text.substring(w.length).replace(/^[\s,.:]+/, '');
    if (idx > 0)   return text.substring(idx + w.length).replace(/^[\s,.:]+/, '');
  }
  return text;
}
function containsWakePhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return WAKE_PHRASES.some(w => lower.includes(w));
}

export function useJarvisMode() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch { return false; }
  });
  const [state,      setState]      = useState<JarvisState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastReply,  setLastReply]  = useState<string>('');
  const [error,      setError]      = useState<string | null>(null);

  const recogRef        = useRef<any>(null);
  const armedRef        = useRef(false);          // true after wake word, awaiting the command
  const commandBufRef   = useRef('');             // accumulating final words after wake word
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef     = useRef(false);          // suppress recognition while Robin speaks
  const stoppingRef     = useRef(false);
  // Latest enabled value visible to async handlers — closure captures
  // would otherwise see the value at recognition.start() time.
  const enabledRef      = useRef(enabled);
  enabledRef.current = enabled;

  const supported = typeof window !== 'undefined' && (
    !!(window as any).SpeechRecognition ||
    !!(window as any).webkitSpeechRecognition
  );
  const ttsSupported = typeof window !== 'undefined' && !!(window as any).SpeechSynthesis === false
    ? true
    : typeof window !== 'undefined' && 'speechSynthesis' in window;

  // ── TTS helper ────────────────────────────────────────────────────
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise(resolve => {
      const t = (text || '').trim();
      if (!t || !ttsSupported || typeof window === 'undefined') { resolve(); return; }
      try {
        const synth = window.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(t.slice(0, 1000));
        // Prefer an Indian-English voice if the OS has one — closer to
        // the team's accent. Fall back to default.
        const voices = synth.getVoices();
        const pref = voices.find(v => /en[-_]IN/i.test(v.lang))
                  || voices.find(v => /Hindi|hi[-_]IN/i.test(v.lang))
                  || voices.find(v => /en[-_]US/i.test(v.lang));
        if (pref) u.voice = pref;
        u.rate  = 1.0;
        u.pitch = 1.0;
        u.onstart = () => { speakingRef.current = true; };
        u.onend   = () => { speakingRef.current = false; resolve(); };
        u.onerror = () => { speakingRef.current = false; resolve(); };
        synth.speak(u);
      } catch { resolve(); }
    });
  }, [ttsSupported]);

  // ── Forward declarations resolved via refs to avoid circular deps ──
  const startRef = useRef<() => void>(() => {});

  // ── Process a captured command ────────────────────────────────────
  const handleCommand = useCallback(async (rawCommand: string) => {
    const cmd = stripWakePhrase(rawCommand).trim();
    if (!cmd) {
      armedRef.current = false;
      commandBufRef.current = '';
      setState('listening');
      return;
    }
    setState('thinking');
    setLastReply('');
    try {
      const parsed = await api.aiParseCommand(cmd);
      if (parsed.isAction && parsed.action !== 'question' && parsed.action !== 'unsupported') {
        // AUTO-EXECUTE — no confirm card in Jarvis mode. This is the
        // whole point of hands-free: less ceremony.
        const r = await executeRobinCommand(parsed.action as RobinAction, parsed.params || {}, cmd);
        setLastReply(r.text);
        setState('speaking');
        await speak(r.text);
      } else if (parsed.action === 'unsupported') {
        const msg = parsed.userReply || "Yeh kaam abhi nahi kar sakta — kuch aur try kar.";
        setLastReply(msg);
        setState('speaking');
        await speak(msg);
      } else {
        // Plain Q&A — hit /copilot for a thoughtful answer.
        const res = await api.aiCopilot({
          question: cmd,
          route:    (typeof window !== 'undefined' ? window.location.pathname : '/'),
        });
        setLastReply(res.answer);
        setState('speaking');
        await speak(res.answer);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Robin abhi reachable nahi hai.';
      setLastReply(msg);
      setState('speaking');
      await speak(msg);
    } finally {
      armedRef.current = false;
      commandBufRef.current = '';
      setState(enabledRef.current ? 'listening' : 'idle');
      // If recognition died during speak/process, restart it.
      if (enabledRef.current && !recogRef.current) startRef.current();
    }
  }, [speak]);

  // ── Continuous listener — fires on every interim/final result ─────
  const start = useCallback(() => {
    if (!supported || recogRef.current) return;
    setError(null);
    const Ctor: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new Ctor();
    r.continuous     = true;
    r.interimResults = true;
    r.lang           = 'en-IN';

    r.onresult = (ev: any) => {
      // Ignore everything while Robin is mid-sentence (TTS feedback).
      if (speakingRef.current) return;

      let interim = '';
      let final   = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0]?.transcript || '';
        if (res.isFinal) final += txt;
        else             interim += txt;
      }
      setTranscript((commandBufRef.current + ' ' + final + ' ' + interim).trim());

      // ARM state machine:
      // - If NOT armed, watch for the wake phrase in the running text.
      // - Once armed, accumulate FINAL words into commandBufRef and
      //   reset a silence-watchdog. When the watchdog fires, ship the
      //   buffered command.
      if (!armedRef.current) {
        const heard = (commandBufRef.current + ' ' + final + ' ' + interim).toLowerCase();
        if (containsWakePhrase(heard)) {
          armedRef.current = true;
          // Drop everything up to and including the wake word.
          commandBufRef.current = stripWakePhrase(heard);
          setState('armed');
          // small chime/cue via a soft beep would be nicer, but a state
          // change to 'armed' makes the orb pulse so the user knows.
        }
      } else {
        if (final) commandBufRef.current += ' ' + final;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const cmd = commandBufRef.current.trim();
          if (cmd) handleCommand(cmd);
        }, 1200);
      }
    };
    r.onerror = (ev: any) => {
      const name = String(ev?.error || '');
      // 'no-speech' is normal — user hasn't talked yet. 'aborted' fires
      // when we stop() manually. Both are harmless.
      if (name === 'no-speech' || name === 'aborted') return;
      setError(name);
    };
    r.onend = () => {
      recogRef.current = null;
      // Restart unless the user disabled Jarvis or we're mid-shutdown.
      if (enabledRef.current && !stoppingRef.current) {
        // Tiny delay smooths over Chrome's "you must wait" between
        // immediate restarts.
        setTimeout(() => { if (enabledRef.current && !stoppingRef.current) start(); }, 300);
      } else {
        setState('idle');
      }
    };
    try {
      r.start();
      recogRef.current = r;
      setState('listening');
    } catch (e: any) {
      // Recognition sometimes throws "already started" if the previous
      // instance hasn't fully torn down. Retry once after a beat.
      setTimeout(() => { if (enabledRef.current && !recogRef.current) start(); }, 500);
    }
  }, [supported, handleCommand]);
  startRef.current = start;

  // ── Stop ──────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stoppingRef.current = true;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    armedRef.current = false;
    commandBufRef.current = '';
    const r = recogRef.current;
    recogRef.current = null;
    if (r) { try { r.stop(); } catch { /* ignore */ } }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    setState('idle');
    setTimeout(() => { stoppingRef.current = false; }, 100);
  }, []);

  // ── Public toggle ─────────────────────────────────────────────────
  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  }, []);
  const toggle = useCallback(() => setEnabled(!enabled), [enabled, setEnabled]);

  // ── Wire enabled flag to lifecycle ────────────────────────────────
  useEffect(() => {
    if (enabled && supported) start();
    else                       stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, supported]);

  return {
    supported, enabled, state, transcript, lastReply, error,
    toggle, setEnabled,
    // Manual ping — if the user wants to test TTS or the orb cycle.
    speak,
  };
}

export default useJarvisMode;
