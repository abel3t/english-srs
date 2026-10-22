// Password hashing for Better Auth with Web Crypto's PBKDF2 (native, so a sign-in stays within the Workers CPU
// limit, unlike Better Auth's default scrypt in JavaScript). Stored as pbkdf2$<iterations>$<salt>$<hash> (base64).
const ITERATIONS = 100_000;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [scheme, iterations, salt, expected] = hash.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false;
  const actual = await derive(password, fromBase64(salt), Number(iterations));
  const wanted = fromBase64(expected);
  // Compare every byte, so the time taken does not tell how much of the hash matched.
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ (wanted[index] ?? 0);
  return difference === 0;
}
