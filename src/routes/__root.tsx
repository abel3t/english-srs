/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { AppNav } from '@/components/app-nav';
import { MiniPlayer } from '@/components/mini-player';
import { PageContent } from '@/components/page-pending';
import { getViewerFn } from '@/data/cards';
import { usePlayer } from '@/lib/player';
import { cachedViewer, rememberViewer } from '@/lib/viewer-cache';
import appCss from '@/styles.css?url';

export const Route = createRootRoute({
  // Every page but the sign-in page needs an account; the viewer is shared with the pages through the context.
  beforeLoad: async ({ location }) => {
    // On the server (first load) and on the sign-in page, always ask; in the browser, reuse a recent answer.
    const browser = typeof window !== 'undefined';
    const recent = browser && location.pathname !== '/login' ? cachedViewer() : undefined;
    const viewer = recent !== undefined ? recent : await getViewerFn();
    if (browser) rememberViewer(viewer);
    if (!viewer && location.pathname !== '/login') throw redirect({ to: '/login' });
    return { viewer };
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }, { title: 'PhraseLoop' },
      // Add to Home Screen: the name under the icon, and opening full screen like an app (iOS reads the apple-* tags).
      { name: 'application-name', content: 'PhraseLoop' }, { name: 'apple-mobile-web-app-title', content: 'PhraseLoop' },
      { name: 'mobile-web-app-capable', content: 'yes' }, { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' }, { name: 'theme-color', content: '#ffffff' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss }, { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }, { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

function RootDocument({ children }: { children: ReactNode }) {
  const { viewer } = Route.useRouteContext();
  const listening = usePlayer().tracks.length > 0;
  // Room at the bottom so nothing hides behind the phone tab bar and the mini player.
  const bottom = !viewer ? 'pb-10' : listening ? 'pb-[calc(9.5rem+env(safe-area-inset-bottom))] sm:pb-32' : 'pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-10';
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body className="bg-muted/40 text-foreground antialiased">
        {viewer && <AppNav viewer={viewer} />}
        <div className={`mx-auto max-w-4xl px-4 pt-4 ${bottom}`}>
          <PageContent>{children}</PageContent>
        </div>
        {viewer && <MiniPlayer />}
        <Toaster position="top-center" richColors closeButton />
        <Scripts />
      </body>
    </html>
  );
}
