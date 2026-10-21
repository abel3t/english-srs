// Used by the Worker for Gemini speech. Gemini TTS returns base64 audio parts that are
// either raw PCM ("audio/L16;codec=pcm;rate=24000") or already complete WAV files, depending on the model.
export type GeminiAudioResponse = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
};
type PcmFormat = { sampleRate: number; bitsPerSample: number; numChannels: number };

export function geminiAudioParts(body: GeminiAudioResponse): { base64: string[]; mimeType: string } {
  const parts = (body.candidates?.[0]?.content?.parts ?? []).flatMap(part => part.inlineData?.data ? [part.inlineData] : []);
  if (!parts.length) {
    const reason = body.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned no audio${reason ? ` (${reason})` : ''}`);
  }
  return { base64: parts.map(part => part.data!), mimeType: parts[0].mimeType ?? '' };
}

const ascii = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

// Pulls the sample format and data chunk out of a WAV file (the header is not always 44 bytes).
function readWav(bytes: Uint8Array): { pcm: Uint8Array; format: PcmFormat } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: PcmFormat = { sampleRate: 24000, bitsPerSample: 16, numChannels: 1 };
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') format = { numChannels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true), bitsPerSample: view.getUint16(offset + 22, true) };
    // Streamed WAVs may declare an unknown (0 or 0xFFFFFFFF) data size: take everything that follows.
    if (id === 'data') return { pcm: bytes.subarray(offset + 8, size && offset + 8 + size <= bytes.length ? offset + 8 + size : bytes.length), format };
    offset += 8 + size + (size % 2);
  }
  throw new Error('Gemini returned a WAV file without audio data');
}

function formatFromMime(mimeType: string): PcmFormat {
  return {
    bitsPerSample: Number(/L(\d+)/.exec(mimeType)?.[1] ?? 16),
    sampleRate: Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000),
    numChannels: Number(/channels=(\d+)/.exec(mimeType)?.[1] ?? 1),
  };
}

function wavHeader(pcmLength: number, { sampleRate, bitsPerSample, numChannels }: PcmFormat): Uint8Array<ArrayBuffer> {
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = new DataView(new ArrayBuffer(44));
  const text = (offset: number, value: string) => [...value].forEach((char, i) => header.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); header.setUint32(4, 36 + pcmLength, true); text(8, 'WAVE');
  text(12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, numChannels, true);
  header.setUint32(24, sampleRate, true); header.setUint32(28, sampleRate * blockAlign, true);
  header.setUint16(32, blockAlign, true); header.setUint16(34, bitsPerSample, true);
  text(36, 'data'); header.setUint32(40, pcmLength, true);
  return new Uint8Array(header.buffer);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  chunks.reduce((offset, chunk) => { joined.set(chunk, offset); return offset + chunk.length; }, 0);
  return joined;
}

const isWav = (bytes: Uint8Array) => bytes.length > 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WAVE';

// Joins decoded parts into one playable file: PCM and WAV parts become a single WAV; other formats pass through.
export function buildAudio(parts: Uint8Array[], mimeType: string): { bytes: Uint8Array<ArrayBuffer>; contentType: string } {
  const pcmLike = /audio\/(l\d+|pcm|wav|x-wav|wave)/i.test(mimeType) || parts.every(isWav);
  if (!pcmLike) return { bytes: concatBytes(parts), contentType: mimeType.split(';')[0] || 'application/octet-stream' };
  const decoded = parts.map(part => (isWav(part) ? readWav(part) : { pcm: part, format: formatFromMime(mimeType) }));
  const pcm = concatBytes(decoded.map(part => part.pcm));
  return { bytes: concatBytes([wavHeader(pcm.length, decoded[0].format), pcm]), contentType: 'audio/wav' };
}

