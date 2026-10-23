import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/page-header';
import { StatusMessage, type Status } from '@/components/status-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSettingsPage } from '@/data/cards';
import { apiRequest, errorMessage, postJson } from '@/lib/api-client';
import { authClient, unwrap } from '@/lib/auth-client';
import type { KeyStatus, Provider } from '@/lib/settings';
import { toast } from 'sonner';

export const Route = createFileRoute('/settings')({
  loader: () => getSettingsPage(),
  head: () => ({ meta: [{ title: 'Settings · PhraseLoop' }] }),
  component: Settings,
});

const providerInfo: Record<Provider, { name: string; use: string; url: string }> = {
  elevenlabs: { name: 'ElevenLabs', use: 'Required to create story and conversation audio. When its credits run out, paste another key here.', url: 'https://elevenlabs.io/app/settings/api-keys' },
};

function Settings() {
  const { keys, connectorCreatedAt } = Route.useLoaderData();
  return (
    <>
      <PageHeader title="Settings" description="Your connector for Claude or ChatGPT, the voice for your stories, and your password." />
      <Card>
        <CardHeader>
          <CardTitle>API key</CardTitle>
          <CardDescription>Your own key, used only for your stories. It is never shown again, only its last 4 characters.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">{keys.map(key => <ApiKeyRow key={key.provider} status={key} />)}</CardContent>
      </Card>
      <Connector createdAt={connectorCreatedAt} />
      <ChangePassword />
    </>
  );
}

function ApiKeyRow({ status: key }: { status: KeyStatus }) {
  const router = useRouter();
  const info = providerInfo[key.provider];
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function save(method: 'PUT' | 'DELETE') {
    if (method === 'DELETE' && !confirm(`Remove the saved ${info.name} key?`)) return;
    setBusy(true); setStatus(null);
    try {
      await apiRequest(`/api/settings/keys/${key.provider}`, method === 'PUT'
        ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: value }) }
        : { method });
      setValue('');
      await router.invalidate();
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`key-${key.provider}`} className="font-semibold">{info.name}</Label>
        {key.last4
          ? <Badge variant="secondary">Saved · …{key.last4}</Badge>
          : <Badge variant="outline">Not set</Badge>}
        <a href={info.url} target="_blank" rel="noreferrer" className="ml-auto text-xs underline">Get a key</a>
      </div>
      <p className="text-xs text-muted-foreground">{info.use}</p>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void save('PUT'); }}>
        <Input id={`key-${key.provider}`} type="password" autoComplete="off" value={value} onChange={event => setValue(event.target.value)} placeholder={key.last4 ? 'Paste a new key to replace it' : 'Paste your API key'} />
        <Button type="submit" disabled={busy || value.trim().length < 8}>Save</Button>
        {key.last4 && <Button type="button" variant="ghost" disabled={busy} onClick={() => save('DELETE')}>Remove</Button>}
      </form>
      <StatusMessage status={status} />
    </div>
  );
}

function Connector({ createdAt }: { createdAt: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function create() {
    if (createdAt && !confirm('Create a new link? The old link stops working.')) return;
    setBusy(true); setStatus(null);
    try { setUrl((await postJson<{ url: string }>('/api/settings/connector')).url); await router.invalidate(); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm('Disconnect? Claude or ChatGPT can no longer use the app until you create a new link.')) return;
    setBusy(true);
    try { await apiRequest('/api/settings/connector', { method: 'DELETE' }); setUrl(null); await router.invalidate(); }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Claude or ChatGPT</CardTitle>
        <CardDescription>
          Your Claude or ChatGPT subscription is the app’s AI. Connect it, then ask: “Find 10 new phrases in PhraseLoop”, “Add <i>circle back</i> to PhraseLoop” or “Write me a story with my phrases”. New cards wait in the Queue for your review.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {createdAt ? <Badge variant="secondary">Link created {new Date(createdAt).toLocaleDateString()}</Badge> : <Badge variant="outline">Not connected</Badge>}
          <div className="ml-auto flex gap-2">
            <Button disabled={busy} onClick={create}>{createdAt ? 'New link' : 'Create link'}</Button>
            {createdAt && <Button variant="ghost" disabled={busy} onClick={remove}>Disconnect</Button>}
          </div>
        </div>
        {url && (
          <div className="grid gap-1.5">
            <Label htmlFor="connector-url">Your connector link (shown only once; keep it secret like a password)</Label>
            <div className="flex gap-2">
              <Input id="connector-url" readOnly value={url} onFocus={event => event.target.select()} />
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(url).then(() => setStatus({ type: 'success', text: 'Copied.' }))}>Copy</Button>
            </div>
          </div>
        )}
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li><b>Claude</b>: Settings → Connectors → Add custom connector → paste the link (no sign-in needed).</li>
          <li><b>ChatGPT</b>: Settings → Apps &amp; Connectors → Advanced → turn on Developer mode → Create → paste the link, Authentication: none. On some plans ChatGPT can only read, not save cards.</li>
        </ul>
        <StatusMessage status={status} />
      </CardContent>
    </Card>
  );
}

// Signs out the account's other devices too, so a password given by the superadmin can be replaced safely.
function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setStatus(null);
    try {
      await unwrap(authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true }));
      setCurrent(''); setNext('');
      setStatus({ type: 'success', text: 'Password changed. Your other devices are signed out.' });
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>At least 8 characters.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5"><Label htmlFor="current-password">Current password</Label><Input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={event => setNext(event.target.value)} /></div>
          <Button type="submit" disabled={busy}>Change</Button>
        </form>
        <StatusMessage status={status} />
      </CardContent>
    </Card>
  );
}
