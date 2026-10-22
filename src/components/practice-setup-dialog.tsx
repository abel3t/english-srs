import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { apiRequest } from '@/lib/api-client';

export type PracticeMode = 'mixed' | 'phrase' | 'sentences' | 'story';
export type PracticeSettings = { mode: PracticeMode; blank: boolean; story?: number };

const MODES: Array<{ value: PracticeMode; label: string; hint: string }> = [
  { value: 'mixed', label: 'Mixed', hint: 'Each due card: its phrase or one of its sentences.' },
  { value: 'phrase', label: 'Phrases', hint: 'Each due card: the phrase itself.' },
  { value: 'sentences', label: 'Sentences', hint: 'Each due card: one of its example sentences.' },
  { value: 'story', label: 'Story', hint: 'A whole story or conversation, line by line.' },
];
const STORAGE_KEY = 'practice-settings';

const loadSaved = (): PracticeSettings | null => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'); } catch { return null; }
};

// Chosen before starting, so the Practice page itself is only about typing.
export function PracticeSetupDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (open: boolean) => void; initial?: PracticeSettings }) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<PracticeSettings>({ mode: 'mixed', blank: false });
  const [stories, setStories] = useState<Array<{ id: number; title: string; kind: string }> | null>(null);

  // Reset only when the dialog opens, so re-renders of the caller never wipe what the learner is choosing.
  useEffect(() => {
    if (!open) return;
    setSettings(initial ?? loadSaved() ?? { mode: 'mixed', blank: false });
    apiRequest<{ stories: Array<{ id: number; title: string; kind: string }> }>('/api/stories').then(body => setStories(body.stories)).catch(() => setStories([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const story = settings.mode === 'story' ? settings.story ?? stories?.[0]?.id : undefined;
  const canStart = settings.mode !== 'story' || !!story;

  function start() {
    const chosen: PracticeSettings = { mode: settings.mode, blank: settings.blank, ...(story ? { story } : {}) };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(chosen)); } catch { /* storage unavailable */ }
    onOpenChange(false);
    void navigate({ to: '/practice', search: chosen });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start practice</DialogTitle>
          <DialogDescription>Type it Monkeytype-style and read it aloud as you go.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label>What to type</Label>
            <ToggleGroup type="single" variant="outline" value={settings.mode} onValueChange={value => value && setSettings(current => ({ ...current, mode: value as PracticeMode }))} className="w-full">
              {MODES.map(mode => <ToggleGroupItem key={mode.value} value={mode.value} className="flex-1">{mode.label}</ToggleGroupItem>)}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{MODES.find(mode => mode.value === settings.mode)?.hint}</p>
          </div>

          {settings.mode === 'story' && (
            stories === null ? <p className="text-sm text-muted-foreground">Loading stories…</p>
              : stories.length ? (
                <Select value={String(story)} onValueChange={value => setSettings(current => ({ ...current, story: Number(value) }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{stories.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.title} · {item.kind}</SelectItem>)}</SelectContent>
                </Select>
              ) : <p className="text-sm text-muted-foreground">No stories yet. Ask Claude or ChatGPT to write one (<Link to="/stories" className="underline" onClick={() => onOpenChange(false)}>Stories</Link>).</p>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <Label htmlFor="practice-blanks">Blanks</Label>
              <p className="text-xs text-muted-foreground">Hide the phrases and type them from memory.</p>
            </div>
            <Switch id="practice-blanks" checked={settings.blank} onCheckedChange={blank => setSettings(current => ({ ...current, blank }))} />
          </div>
        </div>
        <DialogFooter>
          <Button size="lg" disabled={!canStart} onClick={start}>Start</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
