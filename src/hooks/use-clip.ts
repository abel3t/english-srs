import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { audioErrorMessage, clipUrl, registerAudio } from '@/lib/audio';
import { describe } from '@/lib/player';

type ClipState = 'idle' | 'loading' | 'playing';

// Plays the saved Aura-2 clip for a sentence at the shared speed; when the clip cannot be made, a toast says why.
// Starting it stops any other audio on the page.
export function useClip() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<ClipState>('idle');
  const release = useRef<(() => void) | null>(null);

  useEffect(() => () => release.current?.(), []);

  const element = useCallback(() => {
    if (!audio.current) {
      const created = new Audio();
      created.addEventListener('ended', () => setState('idle'));
      created.addEventListener('pause', () => setState(current => (current === 'playing' ? 'idle' : current)));
      audio.current = created;
      release.current = registerAudio(created);
    }
    return audio.current;
  }, []);

  const play = useCallback(async (text: string) => {
    const player = element();
    describe({ title: text, kind: 'sentence' });
    const src = clipUrl(text);
    if (player.dataset.src !== src) { player.src = src; player.dataset.src = src; }
    player.currentTime = 0;
    setState('loading');
    try {
      await player.play();
      setState('playing');
    } catch (error) {
      setState('idle');
      // Autoplay blocked: wait for a click instead of switching voices.
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return;
      toast.error(await audioErrorMessage(src), { id: 'clip' });
    }
  }, [element]);

  return { play, state };
}
