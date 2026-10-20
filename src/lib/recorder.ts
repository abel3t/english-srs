// Browser-only microphone recorder. MediaRecorder formats differ by browser (WebM/Opus, MP4/AAC), so the
// result is decoded and re-encoded as 16 kHz mono WAV: small, and accepted by Gemini everywhere.
import { encodeWav } from './wav';

const SAMPLE_RATE = 16_000;

export type Recording = { blob: Blob; seconds: number; peak: number };
export type Recorder = { stop: () => Promise<Recording>; cancel: () => void; level: () => number };

export async function startRecording(): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record audio.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const meter = new AudioContext();
  const analyser = meter.createAnalyser();
  analyser.fftSize = 1024;
  meter.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start();

  const release = () => { stream.getTracks().forEach(track => track.stop()); void meter.close(); };
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      return Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length) * 4);
    },
    cancel() { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); release(); },
    stop: () => new Promise<Recording>((resolve, reject) => {
      recorder.onstop = async () => {
        release();
        try { resolve(await toWav(new Blob(chunks, { type: recorder.mimeType }))); } catch (error) { reject(error); }
      };
      recorder.stop();
    }),
  };
}

async function toWav(recorded: Blob): Promise<Recording> {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(await recorded.arrayBuffer()).finally(() => context.close());
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const mono = (await offline.startRendering()).getChannelData(0);
  const pcm = new Int16Array(mono.length);
  let peak = 0;
  for (let i = 0; i < mono.length; i++) { const value = Math.max(-1, Math.min(1, mono[i])); pcm[i] = value * 0x7fff; peak = Math.max(peak, Math.abs(value)); }
  return { blob: new Blob([encodeWav(pcm, SAMPLE_RATE)], { type: 'audio/wav' }), seconds: decoded.duration, peak };
}
