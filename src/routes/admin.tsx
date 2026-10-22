import { createFileRoute, redirect } from '@tanstack/react-router';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { errorMessage } from '@/lib/api-client';
import { authClient, unwrap } from '@/lib/auth-client';

export const Route = createFileRoute('/admin')({
  // Superadmins only (role 'admin'); Better Auth checks the role again on every call.
  beforeLoad: ({ context }) => { if (context.viewer?.role !== 'admin') throw redirect({ to: '/' }); },
  head: () => ({ meta: [{ title: 'Admin · PhraseLoop' }] }),
  component: Admin,
});

type Account = { id: string; name: string; email: string; role?: string | null; banned?: boolean | null; createdAt: Date | string };

// There is no sign-up page: accounts are made here. Each account has its own cards, reading, stories, API key and
// connector link.
function Admin() {
  const { viewer } = Route.useRouteContext();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    try {
      const data = await unwrap(authClient.admin.listUsers({ query: { limit: 200, sortBy: 'createdAt', sortDirection: 'desc' } }));
      setAccounts((data?.users ?? []) as Account[]);
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader title="Admin" description="Create accounts and manage them. Each account has its own cards, reading, stories, API key and connector link." />
      <CreateAccount onCreated={load} />
      <Card className="mt-4">
        <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {!accounts ? <p className="text-sm text-muted-foreground">Loading…</p>
            : accounts.map(account => <AccountRow key={account.id} account={account} self={account.id === viewer?.id} onChanged={load} />)}
        </CardContent>
      </Card>
      <StatusMessage status={status} />
    </>
  );
}

function CreateAccount({ onCreated }: { onCreated: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setStatus(null);
    try {
      await unwrap(authClient.admin.createUser({ name: name.trim(), email: email.trim(), password, role }));
      setStatus({ type: 'success', text: `Created ${email.trim()}. Give them their email and password; they can change the password in Settings.` });
      setName(''); setEmail(''); setPassword(''); setRole('user');
      await onCreated();
    } catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New account</CardTitle>
        <CardDescription>At least 8 characters for the password.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="new-name">Name</Label><Input id="new-name" required value={name} onChange={event => setName(event.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-email">Email</Label><Input id="new-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-password">Password</Label><Input id="new-password" type="text" autoComplete="off" required minLength={8} value={password} onChange={event => setPassword(event.target.value)} /></div>
          <div className="grid gap-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={value => setRole(value as 'user' | 'admin')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="user">Learner</SelectItem><SelectItem value="admin">Superadmin</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button></div>
        </form>
        <StatusMessage status={status} />
      </CardContent>
    </Card>
  );
}

function AccountRow({ account, self, onChanged }: { account: Account; self: boolean; onChanged: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setStatus(null);
    try { await action(); setStatus({ type: 'success', text: done }); await onChanged(); }
    catch (error) { setStatus({ type: 'error', text: errorMessage(error) }); }
    finally { setBusy(false); }
  }

  const resetPassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => { await unwrap(authClient.admin.setUserPassword({ userId: account.id, newPassword: password })); setPassword(''); }, 'Password changed.');
  };
  const remove = () => {
    if (!confirm(`Delete ${account.email} and all their cards, reading and stories? This cannot be undone.`)) return;
    void run(() => unwrap(authClient.admin.removeUser({ userId: account.id })), 'Deleted.');
  };

  return (
    <div className="grid gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{account.name}</span>
        <span className="text-sm text-muted-foreground">{account.email}</span>
        {account.role === 'admin' && <Badge variant="secondary">superadmin</Badge>}
        {account.banned && <Badge variant="destructive">blocked</Badge>}
        {self && <Badge variant="outline">you</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={resetPassword} className="flex gap-2">
          <Input type="text" autoComplete="off" minLength={8} required placeholder="New password" value={password} onChange={event => setPassword(event.target.value)} className="h-8 w-44" />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>Set password</Button>
        </form>
        {!self && (
          <>
            {account.banned
              ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unwrap(authClient.admin.unbanUser({ userId: account.id })), 'Unblocked.')}>Unblock</Button>
              : <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => unwrap(authClient.admin.banUser({ userId: account.id })), 'Blocked: signed out and cannot sign in.')}>Block</Button>}
            <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>Delete</Button>
          </>
        )}
      </div>
      <StatusMessage status={status} />
    </div>
  );
}
