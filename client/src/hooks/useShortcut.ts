import { useEffect } from 'react';

/**
 * Robin v2 keyboard-shortcut framework.
 *
 * Supports:
 *   - single keys: 'n', '/', '?'
 *   - modifier combos: 'mod+k' (mod = ⌘ on Mac, Ctrl elsewhere), 'shift+n'
 *   - sequences: 'g d' (press g then d within 1.2s — gmail-style)
 *
 * The handler is suppressed when the user is typing in an input/textarea
 * unless `inInputs` is true. Defaults are friendly (won't fire when typing).
 *
 * Example:
 *   useShortcut('n',     () => openCreateModal());
 *   useShortcut('g d',   () => navigate('/dashboard'));
 *   useShortcut('mod+k', () => openCommandPalette(), { inInputs: true });
 *
 * Sequence state is kept in a module-level Map keyed by leading-key, so
 * multiple `useShortcut('g X', ...)` registrations cooperate without a
 * shared store.
 */

interface Options {
  /** If true, also fire when the user is focused in an <input>/<textarea>. */
  inInputs?: boolean;
  /** Disable temporarily without unmounting the hook. */
  enabled?: boolean;
}

/** Currently-pending sequence first key, e.g. user pressed 'g' — what's next? */
const pendingSeqRef: { key: string; timer: ReturnType<typeof setTimeout> | null } = { key: '', timer: null };
const SEQ_WINDOW_MS = 1200;

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

/** Parse 'mod+k' / 'g d' / 'n' into a matcher. */
function buildMatcher(spec: string) {
  const tokens = spec.trim().split(/\s+/);
  if (tokens.length === 1) {
    // Single key — may include modifiers
    const parts = tokens[0].split('+').map(p => p.toLowerCase());
    const key  = parts.pop() || '';
    const mods = new Set(parts);
    return {
      kind: 'single' as const, key,
      needsMod: mods.has('mod') || mods.has('ctrl') || mods.has('meta'),
      needsShift: mods.has('shift'),
      needsAlt:   mods.has('alt'),
    };
  }
  // Sequence: ['g', 'd']
  return { kind: 'sequence' as const, leading: tokens[0].toLowerCase(), follow: tokens[1].toLowerCase() };
}

export function useShortcut(spec: string, handler: (e: KeyboardEvent) => void, opts: Options = {}) {
  const { inInputs = false, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    const matcher = buildMatcher(spec);

    const onKey = (e: KeyboardEvent) => {
      if (!inInputs && isTypingTarget(e.target)) return;
      const k = (e.key || '').toLowerCase();

      if (matcher.kind === 'single') {
        const modOk =
          matcher.needsMod  ? (isMac() ? e.metaKey : e.ctrlKey) : (!e.metaKey && !e.ctrlKey);
        const shiftOk = matcher.needsShift ? e.shiftKey : !e.shiftKey;
        const altOk   = matcher.needsAlt   ? e.altKey   : !e.altKey;
        if (k === matcher.key && modOk && shiftOk && altOk) {
          e.preventDefault();
          handler(e);
        }
        return;
      }
      // Sequence
      if (e.metaKey || e.ctrlKey || e.altKey) return;          // sequences don't use modifiers
      if (pendingSeqRef.key === matcher.leading && k === matcher.follow) {
        if (pendingSeqRef.timer) clearTimeout(pendingSeqRef.timer);
        pendingSeqRef.key = '';
        pendingSeqRef.timer = null;
        e.preventDefault();
        handler(e);
      } else if (k === matcher.leading) {
        // Arm — but don't preventDefault; another hook may handle the
        // same leading key with a different follow.
        pendingSeqRef.key = matcher.leading;
        if (pendingSeqRef.timer) clearTimeout(pendingSeqRef.timer);
        pendingSeqRef.timer = setTimeout(() => { pendingSeqRef.key = ''; pendingSeqRef.timer = null; }, SEQ_WINDOW_MS);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spec, handler, inInputs, enabled]);
}
