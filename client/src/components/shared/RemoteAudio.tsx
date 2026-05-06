import { useEffect, useRef, useState } from 'react';

/**
 * Hidden audio element that plays a peer's MediaStream reliably.
 *
 * Why this exists:
 *   - `<audio autoPlay>` is sometimes blocked by browser autoplay policies.
 *     We call `.play()` ourselves and retry on user interaction if rejected.
 *   - Tailwind's `hidden` (display:none) can pause audio in Safari /
 *     mobile Chrome. We use offscreen positioning so the element is in
 *     the layout but invisible.
 */
export function RemoteAudio({ stream, volume = 1, muted = false }: { stream: MediaStream | null; volume?: number; muted?: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.volume = volume;
    el.muted = muted;

    const tryPlay = () => {
      el.play().then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    };
    tryPlay();

    // If the browser blocked autoplay, the next user interaction will unblock it.
    const onUserGesture = () => { tryPlay(); };
    window.addEventListener('click', onUserGesture, { once: true });
    return () => window.removeEventListener('click', onUserGesture);
  }, [stream, volume, muted]);

  return (
    <>
      <audio
        ref={ref}
        autoPlay
        playsInline
        // NOT display:none — that pauses audio in Safari. Use offscreen
        // absolute positioning instead so the element stays in the layout.
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      {blocked && !muted && (
        <span className="absolute top-1 right-1 text-[9px] bg-amber-500/80 text-white px-1.5 py-0.5 rounded">
          tap to hear
        </span>
      )}
    </>
  );
}

/**
 * Live audio level indicator — pulses when the peer is talking.
 * Uses Web Audio API's AnalyserNode on the peer's MediaStream.
 */
export function useAudioLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) { setLevel(0); return; }

    const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);

    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      // RMS over the buffer, normalised 0..1
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 4)); // amplify so quiet speech registers
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      try { src.disconnect(); } catch {}
      try { ctx.close(); } catch {}
    };
  }, [stream]);

  return level;
}
