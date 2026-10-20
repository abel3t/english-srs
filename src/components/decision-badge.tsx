import { Badge } from '@/components/ui/badge';
import type { LearningDecision } from '@/lib/learning-db';

const styles: Record<LearningDecision, string> = {
  saved: 'bg-emerald-100 text-emerald-800',
  edited_then_saved: 'bg-emerald-100 text-emerald-800',
  skipped: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-800',
};

export function DecisionBadge({ decision }: { decision: LearningDecision }) {
  return <Badge variant="secondary" className={styles[decision]}>{decision.replaceAll('_', ' ')}</Badge>;
}
