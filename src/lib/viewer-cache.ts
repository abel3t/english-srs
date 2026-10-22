import type { Viewer } from './auth';

// In the browser, who is signed in is remembered for a minute between page changes, saving one request per
// navigation. Every server function still checks the session itself; signing in or out forgets it at once.
const FRESH_MS = 60_000;
let cached: { viewer: Viewer | null; at: number } | null = null;

export function cachedViewer(): Viewer | null | undefined {
  return cached && Date.now() - cached.at < FRESH_MS ? cached.viewer : undefined;
}

export function rememberViewer(viewer: Viewer | null) {
  cached = { viewer, at: Date.now() };
}

export function forgetViewer() {
  cached = null;
}
