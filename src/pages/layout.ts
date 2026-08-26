export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export const sharedStyles = `
  :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; color: #172033; background: #f5f7fb; }
  * { box-sizing: border-box; }
  body { max-width: 920px; margin: 0 auto; padding: 18px 16px 40px; }
  nav { display: flex; align-items: center; gap: 6px; margin-bottom: 18px; }
  nav .brand { font-weight: 800; margin-right: auto; color: #172033; text-decoration: none; }
  nav a:not(.brand) { color: #4c5870; padding: 7px 10px; border-radius: 7px; text-decoration: none; font-size: .92rem; }
  nav a.active, nav a:not(.brand):hover { color: #1748bd; background: #e8efff; }
  h1 { margin: 0 0 4px; font-size: 1.75rem; }
  .subtitle { color: #5d677a; margin: 0; font-size: .95rem; }
  .panel { background: white; border: 1px solid #dde3ee; border-radius: 12px; padding: 16px; margin-top: 14px; box-shadow: 0 4px 14px rgba(31,45,75,.05); }
  .muted { color: #687386; }
  .badge { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: .76rem; font-weight: 700; background: #e9edf5; color: #47536a; }
  .badge.saved, .badge.edited_then_saved { background: #dff5e8; color: #126436; }
  .badge.skipped { background: #f1f2f5; color: #687386; }
  .badge.pending { background: #fff1cc; color: #785500; }
  @media (max-width: 560px) { body { padding: 14px 12px 30px; } h1 { font-size: 1.5rem; } nav { margin-bottom: 14px; } nav a:not(.brand) { padding: 6px 7px; } }
`;

export function pageShell(title: string, active: 'dashboard' | 'learn' | 'history', content: string, extraStyles = ''): string {
  const link = (href: string, label: string, key: typeof active) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(title)}</title><style>${sharedStyles}${extraStyles}</style></head><body>
    <nav><a class="brand" href="/">English SRS</a>${link('/', 'Dashboard', 'dashboard')}${link('/learn', 'Learn', 'learn')}${link('/history', 'History', 'history')}</nav>
    ${content}
  </body></html>`;
}
