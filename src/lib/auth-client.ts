// Browser side of Better Auth: sign in and out, change one's password, and (superadmin) manage accounts.
import { adminClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({ plugins: [adminClient()] });

// Better Auth calls return { data, error } instead of throwing; this turns an error into an exception.
export async function unwrap<T>(call: Promise<{ data: T; error: null } | { data: null; error: { message?: string; statusText?: string } }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw new Error(error.message || error.statusText || 'Request failed');
  return data as T;
}
