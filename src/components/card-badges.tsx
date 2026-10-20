import { Badge } from '@/components/ui/badge';
import type { SyncStatus } from '@/lib/cards-db';
import type { CardState } from '@/lib/srs';

const stateStyles: Record<CardState, string> = {
  new: 'bg-sky-100 text-sky-800',
  learning: 'bg-amber-100 text-amber-800',
  review: 'bg-emerald-100 text-emerald-800',
};

export function StateBadge({ state }: { state: CardState }) {
  return <Badge variant="secondary" className={stateStyles[state]}>{state}</Badge>;
}

export function SyncBadge({ status }: { status: SyncStatus }) {
  if (status === 'synced') return <Badge variant="outline">in Noji</Badge>;
  return <Badge variant="secondary" className={status === 'failed' ? 'bg-red-100 text-red-800' : ''}>{status === 'failed' ? 'Noji sync failed' : 'not in Noji yet'}</Badge>;
}
