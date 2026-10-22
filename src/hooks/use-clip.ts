import { useCallback, useEffect, useRef, useState } from 'react';
import { clipUrl, getAudioSpeed, registerAudio } from '@/lib/audio';
import { describe } from '@/lib/player';

function speakWithBrowser(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; utterance.rate = getAudioSpeed();
  speechSynthesis.speak(utterance);
}

type ClipState = 'idle' | 'loading' | 'playing';

// Plays the saved Aura-2 clip for a sentence at the shared speed; falls back to the free browser voice when the clip
// cannot be made. Starting it stops any other audio on the page.
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
      speakWithBrowser(text);
    }
  }, [element]);

  return { play, state };
}
