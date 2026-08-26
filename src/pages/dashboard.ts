import type { LearningItem, LearningOverview } from '../lib/learning-db';
import { escapeHtml, pageShell } from './layout';

export function dashboardPage(overview: LearningOverview, recent: LearningItem[]): string {
  const cards = [
    ['This week', overview.thisWeek], ['Saved to Noji', overview.saved], ['Skipped', overview.skipped], ['Waiting', overview.pending],
  ].map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('');
  const rows = recent.length ? recent.map(item => `<a class="recent" href="/history?q=${encodeURIComponent(item.keyExpression || item.mainSentence)}">
    <div><strong>${escapeHtml(item.mainSentence)}</strong><small>${escapeHtml(item.keyExpression || 'Whole sentence')} · ${new Date(item.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })}</small></div>
    <span class="badge ${item.userDecision}">${item.userDecision.replaceAll('_', ' ')}</span>
  </a>`).join('') : '<p class="muted">No learning history yet. Analyze your first sentence.</p>';
  return pageShell('Dashboard · English SRS', 'dashboard', `
    <h1>Your learning dashboard</h1><p class="subtitle">A small view of what you analyzed and what actually became a Noji card.</p>
    <section class="metrics">${cards}</section>
    <section class="panel"><div class="section-head"><h2>Recent sentences</h2><a href="/history">View all</a></div>${rows}</section>
    <a class="cta" href="/learn">Analyze new English</a>
  `, `
    .metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:14px; }
    .metric { background:white; border:1px solid #dde3ee; border-radius:11px; padding:14px; }
    .metric strong { display:block; font-size:1.65rem; } .metric span { color:#687386; font-size:.85rem; }
    h2 { font-size:1rem; margin:0; } .section-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
    .section-head a { color:#245eea; font-size:.88rem; }
    .recent { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:11px 0; border-top:1px solid #edf0f5; color:inherit; text-decoration:none; }
    .recent strong,.recent small { display:block; } .recent small { color:#687386; margin-top:3px; }
    .cta { display:inline-block; margin-top:14px; padding:10px 16px; background:#245eea; color:white; border-radius:8px; text-decoration:none; font-weight:700; }
    @media(max-width:620px){.metrics{grid-template-columns:repeat(2,1fr)}.recent strong{font-size:.92rem}}
  `);
}
