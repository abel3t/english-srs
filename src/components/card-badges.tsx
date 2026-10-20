import { Badge } from '@/components/ui/badge';
import type { CardState } from '@/lib/srs';

const stateStyles: Record<CardState, string> = {
  new: 'bg-sky-100 text-sky-800',
  learning: 'bg-amber-100 text-amber-800',
  review: 'bg-emerald-100 text-emerald-800',
};

export function StateBadge({ state }: { state: CardState }) {
  return <Badge variant="secondary" className={stateStyles[state]}>{state}</Badge>;
}

