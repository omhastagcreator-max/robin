/**
 * rotateVaultKey.ts — one-shot migration that re-encrypts every entry in the
 * ClientCredential collection from the OLD vault key to a NEW one.
 *
 * Use case: today the vault key falls back to JWT_SECRET. Rotating JWT_SECRET
 * for any reason (suspected leak, employee departure, periodic hygiene) would
 * silently destroy every stored credential. This script lets you move every
 * row to a dedicated CREDENTIAL_KEY env var BEFORE you ever rotate JWT_SECRET.
 *
 * Usage (from `server/` directory):
 *   OLD_VAULT_KEY="$JWT_SECRET_currently_in_use" \
 *   NEW_VAULT_KEY="<a fresh random 64-char string>" \
 *   MONGODB_URI="<your atlas URI>" \
 *   npx ts-node scripts/rotateVaultKey.ts
 *
 * After it finishes successfully:
 *   1. Set CREDENTIAL_KEY in Render → Environment to the NEW_VAULT_KEY value.
 *   2. Save (Render redeploys).
 *   3. Verify by opening Admin → Vault — every entry should decode cleanly.
 *   4. Now you can safely rotate JWT_SECRET if you need to.
 *
 * The script is IDEMPOTENT — running it twice with the same key pair does
 * nothing harmful (the second pass tries to decrypt under the new key,
 * which works, and overwrites with the same plaintext).
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { deriveKeyFromSecret, decryptWithKey, encryptWithKey, EncryptedBlob } from '../src/lib/crypto';
import ClientCredential from '../src/models/ClientCredential';

async function main() {
  const oldSecret = process.env.OLD_VAULT_KEY;
  const newSecret = process.env.NEW_VAULT_KEY;
  const uri       = process.env.MONGODB_URI;

  if (!oldSecret) { console.error('Set OLD_VAULT_KEY (typically the current JWT_SECRET).'); process.exit(1); }
  if (!newSecret) { console.error('Set NEW_VAULT_KEY (a fresh random secret).'); process.exit(1); }
  if (newSecret.length < 32) { console.error('NEW_VAULT_KEY must be at least 32 characters.'); process.exit(1); }
  if (oldSecret === newSecret) { console.error('OLD and NEW vault keys are identical — nothing to do.'); process.exit(1); }
  if (!uri) { console.error('Set MONGODB_URI (the Atlas connection string).'); process.exit(1); }

  console.log('[rotate] connecting to Mongo…');
  await mongoose.connect(uri);

  const oldKey = deriveKeyFromSecret(oldSecret);
  const newKey = deriveKeyFromSecret(newSecret);

  // Read every credential. ClientCredential is small (one row per saved login),
  // so a full table scan is fine — this isn't a query you run in production.
  const cursor = ClientCredential.find({}).cursor();
  let scanned = 0, rotated = 0, failed = 0, skipped = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const fields = ['password'] as const;        // extend if the schema ever stores more encrypted fields

    let didSomething = false;
    for (const f of fields) {
      const blob = (doc as any)[f] as EncryptedBlob | undefined;
      if (!blob?.enc || !blob?.iv || !blob?.tag) { skipped += 1; continue; }
      let plain = '';
      try {
        plain = decryptWithKey(blob, oldKey);
      } catch {
        // First try with the new key — maybe this row is already migrated.
        try { plain = decryptWithKey(blob, newKey); skipped += 1; continue; }
        catch { /* fall through to failed */ }
      }
      if (!plain) {
        // GCM auth-tag mismatch could mean already-migrated; try new key.
        try { plain = decryptWithKey(blob, newKey); skipped += 1; continue; }
        catch { failed += 1; console.warn(`[rotate] could not decrypt _id=${doc._id} field=${f}`); continue; }
      }
      (doc as any)[f] = encryptWithKey(plain, newKey);
      didSomething = true;
    }
    if (didSomething) {
      await doc.save();
      rotated += 1;
    }
    if (scanned % 50 === 0) console.log(`[rotate] progress: scanned=${scanned} rotated=${rotated} skipped=${skipped} failed=${failed}`);
  }

  console.log(`[rotate] DONE. scanned=${scanned} rotated=${rotated} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
  if (failed > 0) process.exit(2);
}

main().catch(err => { console.error('[rotate] crash:', err); process.exit(3); });
