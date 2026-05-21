import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Symmetric AES-256-GCM helpers used to encrypt sensitive client credentials
 * (passwords) at rest in MongoDB.
 *
 * Key resolution order:
 *   1. process.env.CREDENTIAL_KEY  — preferred. Should be a 32-byte (or
 *      longer) random string. SHA-256 is applied to derive a 32-byte key.
 *   2. process.env.JWT_SECRET      — fallback so dev environments work
 *      without an extra env var. PRINTS A WARNING — set CREDENTIAL_KEY
 *      in production.
 *   3. Hard-coded dev string       — last-ditch so the app boots even
 *      without env. PRINTS A WARNING.
 */
function getKey(): Buffer {
  // Audit finding HIGH-2: previously the key silently fell back to
  // JWT_SECRET when CREDENTIAL_KEY was unset — meaning every rotation of
  // JWT_SECRET (which you eventually WILL want to do) made the entire
  // vault unreadable without any error surface. We now REFUSE to boot
  // in production when CREDENTIAL_KEY is missing. The fallback chain
  // is preserved only for `NODE_ENV !== 'production'` so dev work isn't
  // blocked.
  if (process.env.NODE_ENV === 'production' && !process.env.CREDENTIAL_KEY) {
    // eslint-disable-next-line no-console
    console.error('[crypto] FATAL: CREDENTIAL_KEY is not set in production. Refusing to derive the vault key from JWT_SECRET — a JWT rotation would silently destroy every stored credential. Set CREDENTIAL_KEY in Render → Environment and redeploy.');
    process.exit(1);
  }

  const raw = process.env.CREDENTIAL_KEY
    || process.env.JWT_SECRET
    || 'robin-dev-credential-key-change-me';

  if (!process.env.CREDENTIAL_KEY) {
    if (!(global as any).__credKeyWarned) {
      // eslint-disable-next-line no-console
      console.warn(
        '[crypto] CREDENTIAL_KEY is not set; deriving the credential vault key from JWT_SECRET (or a default). ' +
        'Set CREDENTIAL_KEY to a strong random value in production. This is fatal in production builds.'
      );
      (global as any).__credKeyWarned = true;
    }
  }

  return createHash('sha256').update(raw).digest();
}

/**
 * Same key-derivation logic as getKey() but pulls from a CALLER-SUPPLIED
 * raw secret instead of process.env. Used by the rotate-vault-key script
 * to decrypt under the OLD key and re-encrypt under the NEW one in a
 * single pass — see server/scripts/rotateVaultKey.ts.
 */
export function deriveKeyFromSecret(rawSecret: string): Buffer {
  return createHash('sha256').update(rawSecret).digest();
}

/** Like decrypt(), but with a CALLER-SUPPLIED key — used by the migration. */
export function decryptWithKey(blob: EncryptedBlob, key: Buffer): string {
  if (!blob?.enc || !blob?.iv || !blob?.tag) return '';
  const iv  = Buffer.from(blob.iv, 'base64');
  const enc = Buffer.from(blob.enc, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString('utf8');
}

/** Like encrypt(), but with a CALLER-SUPPLIED key — used by the migration. */
export function encryptWithKey(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: encBuf.toString('base64'),
    iv:  iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export interface EncryptedBlob {
  enc: string;   // base64 ciphertext
  iv:  string;   // base64 IV (12 bytes for GCM)
  tag: string;   // base64 auth tag (16 bytes)
}

export function encrypt(plaintext: string): EncryptedBlob {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: encBuf.toString('base64'),
    iv:  iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(blob: EncryptedBlob): string {
  if (!blob?.enc || !blob?.iv || !blob?.tag) return '';
  try {
    const key = getKey();
    const iv  = Buffer.from(blob.iv, 'base64');
    const enc = Buffer.from(blob.enc, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]);
    return out.toString('utf8');
  } catch {
    // Tampered/wrong key → return empty string rather than throw, so the
    // vault list keeps loading even if one record is broken.
    return '';
  }
}
