import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { prepareSignIn } from '@/data/cards';
import { authClient, unwrap } from '@/lib/auth-client';
import { forgetViewer } from '@/lib/viewer-cache';
import { errorMessage } from '@/lib/api-client';
import { toast } from 'sonner';

export const Route = createFileRoute('/login')({
  // Already signed in: straight to Today.
  loader: async () => { if (await prepareSignIn()) throw redirect({ to: '/' }); },
  head: () => ({ meta: [{ title: 'Sign in · PhraseLoop' }] }),
  component: SignIn,
});

// Accounts are created by the superadmin on the Admin page; there is no sign-up.
function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await unwrap(authClient.signIn.email({ email: email.trim(), password }));
      forgetViewer();
      await router.invalidate();
      await router.navigate({ to: '/' });
    } catch (error) { toast.error(errorMessage(error)); setBusy(false); }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <Card>
        <CardHeader>
          <Logo className="mb-2 size-10" />
          <CardTitle className="text-xl">PhraseLoop</CardTitle>
          <CardDescription>Sign in with the account you were given.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
