import { useCallback, useEffect, useRef, useState } from 'react';

export const clipUrl = (text: string) => `/api/audio?text=${encodeURIComponent(text.replace(/\s+/g, ' ').trim())}`;

// Ask the server to make (and save) the clip ahead of time so pressing Play is instant.
export function prefetchClip(text: string) {
  void fetch(clipUrl(text)).catch(() => undefined);
}

function speakWithBrowser(text: string, rate: number) {
  if (typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US'; utterance.rate = rate;
  speechSynthesis.speak(utterance);
}

// Plays the saved Gemini clip for a sentence; falls back to the free browser voice when the clip cannot be made.
export function useClip() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const play = useCallback(async (text: string, rate = 1) => {
    const element = audio.current ??= new Audio();
    const src = clipUrl(text);
    if (element.dataset.src !== src) { element.src = src; element.dataset.src = src; }
    element.onended = () => setState('idle');
    element.currentTime = 0;
    element.playbackRate = rate;
    setState('loading');
    try {
      await element.play();
      setState('playing'); setUsingFallback(false);
    } catch (error) {
      setState('idle');
      // Autoplay blocked: wait for a click instead of switching voices.
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      setUsingFallback(true);
      speakWithBrowser(text, rate);
    }
  }, []);

  return { play, state, usingFallback };
}
