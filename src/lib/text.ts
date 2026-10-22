export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Story lines may carry ElevenLabs audio tags ("[laughs] No way."): heard, never shown, typed or read by Aura.
export const withoutAudioTags = (text: string) => text.replace(/\[[a-z][a-z ]*\]/gi, '').replace(/\s+([.,!?;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
