import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';

/**
 * useKnock — the "tap someone on the shoulder" feature.
 *
 * Why it exists: a teammate has muted team audio (deafened) but you need
 * their attention NOW. They can't hear you talking; Slack DMs sit in a
 * tab they don't have open. Knock pierces all of that — they hear a
 * short Web-Audio chime (volume independent from huddle audio, so
 * deafen doesn't silence it) and see a toast naming the sender, no
 * matter which page they're on inside Robin.
 *
 * Scope: anyone with an active session in this org. Off-clock users
 * skip server-side (the server rejects with reason='offline' if the
 * recipient has no live socket). One-shot per click; ratelimited
 * server-side (1/10s per pair, 5/5min per recipient).
 *
 * Auditory design:
 *   - Two-tone Web Audio chime (880 → 1175 Hz, ~300ms total). Programmatic
 *     so we don't ship an mp3 and the file never 404s on Vercel cache miss.
 *   - Uses a fresh AudioContext per knock (no resume race with autoplay
 *     gating). The recipient's last user gesture is in the past, but the
 *     AudioContext was unlocked the first time they clicked anything in
 *     Robin (login button at minimum) so playback works on all modern
 *     browsers in our support matrix.
 *
 * Returns:
 *   - knock(userId, note?)  → send a knock to a teammate
 *   - hasPendingTo(userId)  → true if we're within their per-pair cooldown
 *
 * Receiver side (chime + toast) lives in a useEffect inside this hook;
 * mounting useKnock() ONCE somewhere persistent (AppLayout) covers the
 * whole app. Mounting it multiple times is safe (idempotent listener
 * registration thanks to named handler + off).
 */
export function useKnock() {
  const socket = useSocket();
  // Per-pair cooldown mirror so the UI can disable the button locally
  // and we don't depend on the server's "rejected" toast to teach users.
  const lastSentRef = useRef<Map<string, number>>(new Map());

  // ── Programmatic two-tone chime via Web Audio ──────────────────────
  const playChime = useCallback(() => {
    try {
      const ACtor: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext);
      if (!ACtor) return;
      const ctx = new ACtor();
      // Some browsers start suspended; resume kicks it off if so.
      if (ctx.state === 'suspended') { void ctx.resume(); }

      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      master.connect(ctx.destination);

      // Tone 1 — short A5.
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.setValueAtTime(880, now);
      o1.connect(master);
      o1.start(now);
      o1.stop(now + 0.16);

      // Tone 2 — D6, starts halfway into tone 1 for a "ding-dong" lift.
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(1174.66, now + 0.12);
      o2.connect(master);
      o2.start(now + 0.12);
      o2.stop(now + 0.32);

      // Close the context once the sound is done so we don't leak nodes
      // when knocks come in back-to-back.
      setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 600);
    } catch {
      // No Web Audio support → fail silently. The toast still fires;
      // they'll see the visual notification even if their browser is
      // ancient enough to lack AudioContext.
    }
  }, []);

  // ── Receiver: listen for incoming knocks ───────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onKnock = (data: { from: string; fromName: string; fromRole?: string; note?: string; at: number }) => {
      // Pulse the Robin orb so the visual handoff is consistent even
      // if the user dismisses the toast immediately. Orb listens for
      // this custom event and flashes amber for ~3s.
      try {
        window.dispatchEvent(new CustomEvent('robin:knock-received', { detail: data }));
      } catch { /* ignore */ }

      playChime();

      toast(`${data.fromName} knocked`, {
        description: data.note
          ? data.note
          : 'Tap to respond — they want your attention.',
        icon: '🔔',
        duration: 9000,
        // Sonner action positions stay visible the whole 9s, so the
        // recipient can act late if they were across the room.
        action: {
          label: 'I\'m here',
          onClick: () => {
            // Best-effort handshake — sends a quiet ack back so the
            // sender's "knock sent" toast can flip to "they saw it".
            // (Server doesn't relay this yet; we'll wire the ack in
            // a follow-up if usage shows it helps.)
            try { socket.emit('robin:knock-ack', { to: data.from }); } catch { /* ignore */ }
          },
        },
      });
    };

    const onKnockSent = (data: { recipientId: string; at: number }) => {
      // Sender feedback — confirms the chime fired on the other end.
      toast.success('Knock sent', {
        description: 'They\'ll hear a chime and see your name.',
        duration: 4000,
      });
      lastSentRef.current.set(data.recipientId, data.at);
    };

    const onKnockRejected = (data: { recipientId: string; reason: string; retryInMs?: number }) => {
      let msg = 'Couldn\'t knock';
      if (data.reason === 'cooldown') {
        const sec = Math.ceil((data.retryInMs || 0) / 1000);
        msg = `Wait ${sec}s before knocking them again.`;
      } else if (data.reason === 'recipient_flooded') {
        msg = 'They\'ve had a lot of knocks already — try again in a few minutes.';
      } else if (data.reason === 'offline') {
        msg = 'They\'re not in Robin right now. Try Slack / phone.';
      }
      toast.error(msg, { duration: 5000 });
    };

    socket.on('robin:knock',           onKnock);
    socket.on('robin:knock-sent',      onKnockSent);
    socket.on('robin:knock-rejected',  onKnockRejected);
    return () => {
      // Named handlers — see AppLayout for why socket.off(event, handler)
      // matters instead of socket.off(event). Removing all listeners for
      // these events would also blow away other consumers if we ever
      // add one (e.g. a knock log panel).
      socket.off('robin:knock',           onKnock);
      socket.off('robin:knock-sent',      onKnockSent);
      socket.off('robin:knock-rejected',  onKnockRejected);
    };
  }, [socket, playChime]);

  // ── Sender API ─────────────────────────────────────────────────────
  const knock = useCallback((recipientId: string, note?: string) => {
    if (!socket) {
      toast.error('Not connected — refresh and try again.');
      return;
    }
    socket.emit('robin:knock', { recipientId, note });
  }, [socket]);

  const hasPendingTo = useCallback((recipientId: string) => {
    const last = lastSentRef.current.get(recipientId);
    if (!last) return false;
    return Date.now() - last < 10_000;  // matches server's pair cooldown
  }, []);

  return { knock, hasPendingTo, playChime };
}
