/**
 * Secret access for Breve — reads from an ISOLATED keychain, not the login one.
 * All Breve secrets (Resend key, per-account mail passwords) live in
 * ~/Library/Keychains/breve.keychain-db. We unlock it with a password stored in
 * a sandbox-denied FILE (~/.breve-secrets/keychain-pw); if that's missing we fall
 * back to the old login-keychain item "breve-keychain-pw" for backward-compat.
 * Each read serializes (mutex) unlock → read → best-effort RE-LOCK, so the
 * keychain is never left unlocked for a model subprocess to read over securityd.
 * Migrate the pw into the file + delete the login item with scripts/keychain-migrate.sh.
 *
 * CLI: `bun scripts/secret.ts get <service>` prints the raw value (exit 1 if empty).
 */
import { $ } from "bun";

const KEYCHAIN = `${process.env.HOME}/Library/Keychains/breve.keychain-db`;
const PW_FILE = `${process.env.HOME}/.breve-secrets/keychain-pw`;
const ROTLI_RESEND_ACCOUNT = "breve-resend-api-key";

// Serialize all unlock/read/relock so concurrent reads don't race over the keychain.
let mutex: Promise<unknown> = Promise.resolve();

/** Read the unlock password: sandbox-denied file first, then the legacy login item. */
async function unlockPw(): Promise<string> {
  const file = Bun.file(PW_FILE);
  if (await file.exists()) return (await file.text()).trim();
  console.error("breve secret: reading unlock pw from login keychain — run scripts/keychain-migrate.sh");
  return (await $`security find-generic-password -s breve-keychain-pw -w`.text()).trim();
}

/** Read a generic-password secret by service name from Breve's isolated keychain. */
export async function readSecret(service: string): Promise<string> {
  const run = mutex.then(async () => {
    // Resend is a Rotli-owned delivery credential now. Prefer Rotli's native
    // login-keychain entry; the isolated Breve keychain remains a one-time
    // migration fallback for installs upgraded from the standalone project.
    if (service === "resend-breve") {
      try {
        const value = (await $`security find-generic-password -s rotli -a ${ROTLI_RESEND_ACCOUNT} -w`.text()).trim();
        if (value) return value;
      } catch {}
    }
    try {
      const pw = await unlockPw();
      if (pw) await $`security unlock-keychain -p ${pw} ${KEYCHAIN}`.quiet();
      try {
        return (await $`security find-generic-password -s ${service} -w ${KEYCHAIN}`.text()).trim();
      } finally {
        // Best-effort re-lock; never throw if it fails.
        try { await $`security lock-keychain ${KEYCHAIN}`.quiet(); } catch {}
      }
    } catch {
      return "";
    }
  });
  mutex = run.catch(() => {});
  return run;
}

/** Write/update a generic-password secret in Breve's isolated keychain (-U updates if present).
 *  Trusted-daemon only — the model subprocess is sandbox-denied from this keychain. */
export async function writeSecret(service: string, value: string): Promise<boolean> {
  const run = mutex.then(async () => {
    try {
      const pw = await unlockPw();
      if (pw) await $`security unlock-keychain -p ${pw} ${KEYCHAIN}`.quiet();
      try {
        await $`security add-generic-password -U -s ${service} -a ${process.env.USER ?? "breve"} -w ${value} ${KEYCHAIN}`.quiet();
        return true;
      } finally {
        try { await $`security lock-keychain ${KEYCHAIN}`.quiet(); } catch {}
      }
    } catch { return false; }
  });
  mutex = run.catch(() => {});
  return run;
}

if (import.meta.main) {
  const [cmd, service] = Bun.argv.slice(2);
  if (!service || !["get", "delete"].includes(cmd ?? "")) {
    console.error("usage: bun scripts/secret.ts <get|delete> <service>");
    process.exit(1);
  }
  if (cmd === "delete") {
    const run = mutex.then(async () => {
      try {
        const pw = await unlockPw();
        if (pw) await $`security unlock-keychain -p ${pw} ${KEYCHAIN}`.quiet();
        try {
          await $`security delete-generic-password -s ${service} ${KEYCHAIN}`.quiet();
        } finally {
          try { await $`security lock-keychain ${KEYCHAIN}`.quiet(); } catch {}
        }
      } catch {}
    });
    await run;
    process.exit(0);
  }
  const value = await readSecret(service);
  if (!value) process.exit(1);
  process.stdout.write(value);
}
