import { useRouterState } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export function PagePending() {
  return (
    <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      Loading page…
    </div>
  );
}

export function PageContent({ children }: { children: ReactNode }) {
  // A retained route can still have status "success" while beforeLoad checks
  // the session. Observe navigation too, rather than only loader fallbacks.
  const navigating = useRouterState({
    select: state => state.isLoading && state.location.href !== state.resolvedLocation?.href,
  });
  return <main aria-busy={navigating}>{navigating ? <PagePending /> : children}</main>;
}
