// Speech: Deepgram Aura-2 on Workers AI for clips (free daily allowance), ElevenLabs for stories (free plan:
// 10,000 characters a month, about 4 stories). Voice access depends on the user's ElevenLabs account.
export const AURA_MODEL = '@cf/deepgram/aura-2-en' as const;
export const ELEVENLABS_MODEL = 'eleven_v3' as const;
export const CONVERSATION_SPEAKERS = [
  { name: 'Alex', aura: 'arcas', elevenLabs: 'nPczCjzI2devNBz1zQrb' }, // Brian (male)
  { name: 'Sam', aura: 'apollo', elevenLabs: 'TX3LPaxmHKxFdv7VOQHJ' }, // Liam (male)
] as const;
export const STORY_VOICE = CONVERSATION_SPEAKERS[0];
// Practice clips use their own voice, independently of the story/conversation speakers.
export const CLIP_VOICE = { name: 'Arcas', aura: 'arcas' } as const;
export const MAX_CLIP_CHARS = 400;

// Bump CLIP_VERSION whenever how clips are made changes, so previously saved clips are not reused.
export const CLIP_VERSION = 3;

export type StoryKind = 'story' | 'conversation';
