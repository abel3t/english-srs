import { Link, useRouter } from '@tanstack/react-router';
import { BookOpen, Inbox, Keyboard, LogOut, MessagesSquare, Settings, Shield, Sun } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Viewer } from '@/lib/auth';
import { authClient } from '@/lib/auth-client';
import { player } from '@/lib/player';
import { forgetViewer } from '@/lib/viewer-cache';

// The five places used every day. Settings, Admin and signing out live in the account menu.
const navItems = [
  { to: '/', label: 'Today', icon: Sun },
  { to: '/queue', label: 'Queue', icon: Inbox },
  { to: '/practice', label: 'Practice', icon: Keyboard },
  { to: '/stories', label: 'Stories', icon: MessagesSquare },
  { to: '/library', label: 'Library', icon: BookOpen },
] as const;

const initials = (viewer: Viewer) => (viewer.name || viewer.email).split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();

// One compact row on larger screens; on phones a slim top bar plus a tab bar at the bottom, within thumb reach.
export function AppNav({ viewer }: { viewer: Viewer }) {
  return (
    <>
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
        <div className="mx-auto flex h-12 max-w-4xl items-center gap-1 px-4">
          <Link to="/" className="mr-auto flex items-center gap-2 font-semibold tracking-tight"><Logo />PhraseLoop</Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 sm:flex">
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link key={to} to={to} activeOptions={{ exact: to === '/' }}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                activeProps={{ className: 'bg-muted !text-foreground font-medium' }}>
                <Icon className="size-4" aria-hidden />{label}
              </Link>
            ))}
          </nav>
          <AccountMenu viewer={viewer} />
        </div>
      </header>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        <div className="grid h-16 grid-cols-5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} activeOptions={{ exact: to === '/' }}
              className="flex flex-col items-center justify-center gap-0.5 text-[11px] text-muted-foreground transition-colors"
              activeProps={{ className: '!text-primary font-medium' }}>
              <Icon className="size-5" aria-hidden />{label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

function AccountMenu({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const item = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted';

  async function signOut() {
    setLeaving(true);
    player.stop();
    await authClient.signOut();
    forgetViewer();
    await router.invalidate();
    await router.navigate({ to: '/login' });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="ml-1 size-8 rounded-full bg-muted text-xs font-semibold" aria-label="Account">
          {initials(viewer)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{viewer.name}</p>
          <p className="truncate text-xs text-muted-foreground">{viewer.email}</p>
        </div>
        <div className="my-1 h-px bg-border" />
        <Link to="/settings" className={item} onClick={() => setOpen(false)}><Settings className="size-4" aria-hidden />Settings</Link>
        {viewer.role === 'admin' && <Link to="/admin" className={item} onClick={() => setOpen(false)}><Shield className="size-4" aria-hidden />Admin</Link>}
        <div className="my-1 h-px bg-border" />
        <button type="button" className={`${item} text-left`} disabled={leaving} onClick={signOut}><LogOut className="size-4" aria-hidden />{leaving ? 'Signing out…' : 'Sign out'}</button>
      </PopoverContent>
    </Popover>
  );
}
