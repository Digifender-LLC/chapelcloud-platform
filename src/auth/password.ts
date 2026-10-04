import { fromBase64Url, timingSafeEqual, toBase64Url } from "./crypto";

// PBKDF2-HMAC-SHA256 via WebCrypto. 100,000 iterations is the maximum the
// Workers runtime allows. The iteration count is stored in each hash so it can
// be raised (or the algorithm swapped for Argon2id) and rehashed on next login.
//
// Format: pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
const ALGORITHM = "pbkdf2-sha256";
export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export const PASSWORD_MIN_LENGTH = 12;
// Caps the work an unauthenticated caller can make us do per request.
export const PASSWORD_MAX_LENGTH = 256;

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return [ALGORITHM, PBKDF2_ITERATIONS, toBase64Url(salt), toBase64Url(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, salt, hash] = stored.split("$");
  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) return false;
  const expected = fromBase64Url(hash);
  const actual = await derive(password, fromBase64Url(salt), Number(iterations));
  return timingSafeEqual(actual, expected);
}

// Verifying against this when an email is unknown keeps the response time the
// same as for a real account, so login cannot be used to probe for customers.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password-placeholder");
  await verifyPassword(password, await dummyHash);
}
