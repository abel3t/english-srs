import { Alert, AlertDescription } from '@/components/ui/alert';

export type Status = { type: 'error' | 'success' | 'info'; text: string } | null;

export function StatusMessage({ status }: { status: Status }) {
  if (!status) return null;
  if (status.type === 'info') return <p className="mt-3 text-sm text-muted-foreground">{status.text}</p>;
  return (
    <Alert variant={status.type === 'error' ? 'destructive' : 'default'}
      className={status.type === 'success' ? 'mt-3 border-emerald-200 bg-emerald-50 text-emerald-800' : 'mt-3'}>
      <AlertDescription className={status.type === 'success' ? 'whitespace-pre-wrap text-emerald-800' : 'whitespace-pre-wrap'}>{status.text}</AlertDescription>
    </Alert>
  );
}
