// Accounts with Better Auth: email and password, no sign-up page. The superadmin (role 'admin') creates the other
// accounts on the Admin page; the first superadmin comes from the SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD secrets.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/d1';
import type { Bindings } from '../bindings';
import { Accounts, Sessions, Users, Verifications } from '../db/schema';
import { hashPassword, verifyPassword } from './password';

function createAuth(env: Bindings, origin: string) {
  return betterAuth({
    appName: 'PhraseLoop',
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(drizzle(env.DB), {
      provider: 'sqlite',
      schema: { user: Users, session: Sessions, account: Accounts, verification: Verifications },
    }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, password: { hash: hashPassword, verify: verifyPassword } },
    // The session is also kept in a signed cookie for 5 minutes, so checking it needs no database query on most
    // requests. A blocked or deleted account can still open pages until then; its connector stops at once.
    session: { expiresIn: 60 * 60 * 24 * 60, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [admin()],
  });
}

type Auth = ReturnType<typeof createAuth>;

// One instance per origin (the Worker's URL, or localhost in development), made on first use.
const instances = new Map<string, Auth>();
export function getAuth(env: Bindings, origin: string): Auth {
  let auth = instances.get(origin);
  if (!auth) instances.set(origin, auth = createAuth(env, origin));
  return auth;
}

export type Viewer = { id: string; name: string; email: string; role: string | null };

export async function getViewer(env: Bindings, request: Request): Promise<Viewer | null> {
  const session = await getAuth(env, new URL(request.url).origin).api.getSession({ headers: request.headers });
  if (!session) return null;
  const { id, name, email, role } = session.user as typeof session.user & { role?: string | null };
  return { id, name, email, role: role ?? null };
}

// Creates the superadmin from the secrets when no admin exists yet (first deploy, or after the database is reset).
export async function ensureSuperadmin(env: Bindings, origin: string): Promise<void> {
  const email = env.SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = env.SUPERADMIN_PASSWORD;
  if (!email || !password) return;
  if (await env.DB.prepare("SELECT 1 FROM Users WHERE role = 'admin' LIMIT 1").first()) return;
  const context = await getAuth(env, origin).$context;
  const existing = await context.internalAdapter.findUserByEmail(email, { includeAccounts: false });
  if (existing) {
    await env.DB.prepare("UPDATE Users SET role = 'admin' WHERE id = ?1").bind(existing.user.id).run();
    return;
  }
  const user = await context.internalAdapter.createUser({ email, name: 'Admin', role: 'admin', emailVerified: true }, { method: 'admin' });
  await context.internalAdapter.linkAccount({ userId: user.id, providerId: 'credential', accountId: user.id, password: await context.password.hash(password) });
}
