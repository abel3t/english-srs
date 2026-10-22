// Speech: Deepgram Aura-2 on Workers AI for clips (free daily allowance), ElevenLabs only for stories (free plan:
// 10,000 characters a month, about 4 stories). Voice access depends on the user's ElevenLabs account.
export const AURA_MODEL = '@cf/deepgram/aura-2-en' as const;
export const ELEVENLABS_MODEL = 'eleven_v3' as const;
export const CONVERSATION_SPEAKERS = [
  { name: 'Alex', elevenLabs: 'pqHfZKP75CvOlQylNhV4' }, // Bill (male, older)
  { name: 'Sam', elevenLabs: 'CwhRBWXzGAHq8TQ4Fs17' }, // Roger (male, laid-back)
  { name: 'Jordan', elevenLabs: 'cjVigY5qzO86Huf0OWal' }, // Eric (male, smooth)
] as const;
export const STORY_VOICE = CONVERSATION_SPEAKERS[0];
// Practice clips use their own voice, independently of the story/conversation speakers.
export const CLIP_VOICE = { name: 'Orion', aura: 'orion' } as const;
export const MAX_CLIP_CHARS = 400;

// Bump CLIP_VERSION whenever how clips are made changes, so previously saved clips are not reused.
export const CLIP_VERSION = 4;
// Story audio has its own version: remaking it spends the learner's ElevenLabs credits, so it is bumped only when
// story audio itself must change (a new voice is heard in new stories; saved ones keep theirs).
export const STORY_AUDIO_VERSION = 3;

export type StoryKind = 'story' | 'conversation';
