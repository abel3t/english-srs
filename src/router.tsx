import { createRouter } from '@tanstack/react-router';
import { PagePending } from './components/page-pending';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    // Replace the previous page while beforeLoad/loader waits for the server.
    defaultPendingComponent: PagePending,
    defaultPendingMs: 100,
    defaultPendingMinMs: 0,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
