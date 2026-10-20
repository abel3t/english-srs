type GeminiAudioResponse = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
};

// Gemini returns raw PCM (e.g. "audio/L16;codec=pcm;rate=24000") as base64; join the parts and wrap them in a WAV header.
export function geminiAudioToWav(body: GeminiAudioResponse): Blob {
  const parts = (body.candidates?.[0]?.content?.parts ?? []).flatMap(part => part.inlineData?.data ? [part.inlineData] : []);
  if (!parts.length) {
    const reason = body.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned no audio${reason ? ` (${reason})` : ''}`);
  }
  const chunks = parts.map(part => Uint8Array.from(atob(part.data!), char => char.charCodeAt(0)));
  const pcm = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  chunks.reduce((offset, chunk) => { pcm.set(chunk, offset); return offset + chunk.length; }, 0);

  const mimeType = parts[0].mimeType ?? '';
  const bitsPerSample = Number(/L(\d+)/.exec(mimeType)?.[1] ?? 16);
  const sampleRate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
  const numChannels = 1;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); header.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE');
  text(12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, numChannels, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * blockAlign, true);
  header.setUint16(32, blockAlign, true); header.setUint16(34, bitsPerSample, true);
  text(36, 'data'); header.setUint32(40, pcm.length, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}
