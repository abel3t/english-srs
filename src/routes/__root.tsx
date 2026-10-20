/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppNav } from '@/components/app-nav';
import appCss from '@/styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'English SRS' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <p className="text-muted-foreground">Page not found.</p>,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body className="bg-muted/40 text-foreground antialiased">
        <div className="mx-auto max-w-4xl px-4 pt-4 pb-10">
          <AppNav />
          {children}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
