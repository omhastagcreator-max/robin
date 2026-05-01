/**
 * Resolve the WebRTC ICE servers to use for the huddle.
 *
 * Order of preference:
 *
 *   1. Metered.live REST API  — VITE_METERED_API_KEY + VITE_METERED_DOMAIN.
 *      Returns rotating TURN credentials (lasts ~24h). We fetch once per
 *      session and cache for an hour.
 *
 *   2. Static custom TURN     — VITE_TURN_URL + VITE_TURN_USERNAME +
 *      VITE_TURN_CREDENTIAL. Use when self-hosting coturn or pasting
 *      Cloudflare/Twilio credentials directly.
 *
 *   3. Public STUN (fallback) — Google STUN only. Works on simple home
 *      networks; will fail on most NATs without TURN.
 *
 * Both `useMeetingRoom` and `useWebRTC` call `getIceServers()` on join and
 * pass the result to `new RTCPeerConnection({ iceServers })`.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cached: { servers: RTCIceServer[]; at: number; source: IceSource } | null = null;

export type IceSource = 'metered' | 'static' | 'stun-only' | 'livekit';

/** Last-resolved metadata, used by UI to show what config is in use. */
export function getLastIceMeta(): { source: IceSource; count: number } {
  if (!cached) return { source: 'stun-only', count: 0 };
  return { source: cached.source, count: cached.servers.length };
}

const FALLBACK_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export async function getIceServers(): Promise<RTCIceServer[]> {
  const now = Date.now();
  if (cached && (now - cached.at) < CACHE_TTL_MS) return cached.servers;

  const env = (import.meta as any).env || {};

  // 1) Metered REST API
  const meteredKey    = env.VITE_METERED_API_KEY    as string | undefined;
  const meteredDomain = env.VITE_METERED_DOMAIN     as string | undefined;
  if (meteredKey && meteredDomain) {
    // 5-second timeout so a flaky/down Metered endpoint never hangs the
    // whole join flow. Fallback to STUN if the request is too slow.
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${meteredKey}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const servers = (await res.json()) as RTCIceServer[];
        if (Array.isArray(servers) && servers.length > 0) {
          // Layer Google STUN on top — extra paths if Metered's are slow.
          const out = [...FALLBACK_STUN, ...servers];
          cached = { servers: out, at: now, source: 'metered' };
          // eslint-disable-next-line no-console
          console.log('[ice] using Metered API credentials —', servers.length, 'servers');
          return out;
        }
      }
      console.warn('[ice] Metered API returned non-OK status', res.status);
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === 'AbortError') {
        console.warn('[ice] Metered API timed out after 5s — falling back to STUN');
      } else {
        console.warn('[ice] failed to fetch Metered credentials, falling back', e);
      }
    }
  }

  // 2) Static custom TURN
  const turnUrl  = env.VITE_TURN_URL        as string | undefined;
  const turnUser = env.VITE_TURN_USERNAME   as string | undefined;
  const turnPass = env.VITE_TURN_CREDENTIAL as string | undefined;
  if (turnUrl && turnUser && turnPass) {
    const out: RTCIceServer[] = [
      ...FALLBACK_STUN,
      { urls: turnUrl, username: turnUser, credential: turnPass },
    ];
    cached = { servers: out, at: now, source: 'static' };
    console.log('[ice] using static TURN credentials');
    return out;
  }

  // 3) STUN-only fallback
  console.warn('[ice] no TURN configured — STUN-only. Most NATs will fail.');
  cached = { servers: FALLBACK_STUN, at: now, source: 'stun-only' };
  return FALLBACK_STUN;
}

/** Force the cache to refresh on next call (e.g., after env change). */
export function resetIceServersCache() {
  cached = null;
}
