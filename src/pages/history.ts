import type { LearningDecision, LearningItem } from '../lib/learning-db';
import { escapeHtml, pageShell } from './layout';

export function historyPage(items: LearningItem[], query: string, decision?: LearningDecision): string {
  const options = [['','All decisions'],['saved','Saved'],['edited_then_saved','Edited & saved'],['skipped','Skipped'],['pending','Waiting']]
    .map(([value,label]) => `<option value="${value}" ${decision === value ? 'selected' : ''}>${label}</option>`).join('');
  const rows = items.length ? items.map(item => `<details class="item" data-id="${item.id}"><summary><div><strong>${escapeHtml(item.mainSentence)}</strong><small>${escapeHtml(item.keyExpression || 'Whole sentence')} · ${new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' })}</small></div><span class="badge ${item.userDecision}">${item.userDecision.replaceAll('_',' ')}</span></summary><div class="detail"><p><b>Original:</b> ${escapeHtml(item.originalInput)}</p>${item.context ? `<p><b>Context:</b> ${escapeHtml(item.context)}</p>` : ''}<p class="explanation">${escapeHtml(item.explanation)}</p>${item.nojiNoteId ? `<p class="muted">Saved to Noji · note ${escapeHtml(item.nojiNoteId)}</p>` : ''}<div class="actions">${item.userDecision === 'pending' ? `<button class="save" data-action="save" data-title="${escapeHtml(item.mainSentence)}" data-explanation="${escapeHtml(item.explanation)}">Save to Noji</button><button class="skip" data-action="skip">Skip</button>` : ''}<button class="delete" data-action="delete">Delete permanently</button></div></div></details>`).join('') : '<div class="panel muted">No matching sentences.</div>';
  return pageShell('History · English SRS', 'history', `<h1>Learning history</h1><p class="subtitle">Search your D1 history and confirm items captured for later.</p><form class="filters"><input name="q" value="${escapeHtml(query)}" placeholder="Search sentence or expression"><select name="decision">${options}</select><button>Search</button></form><div id="message"></div><div class="results">${rows}</div><script>
    document.querySelector('.results').addEventListener('click', async event => {
      const button = event.target.closest('[data-action]'); if (!button) return;
      event.preventDefault();
      const item = button.closest('[data-id]'); const id = item.dataset.id; const action = button.dataset.action;
      if (action === 'delete' && !confirm('Permanently delete this row from D1 history? This cannot be undone. A card already saved in Noji will remain there.')) return;
      if (action === 'save' && !confirm('Save this card to Noji?')) return;
      button.disabled = true;
      try {
        const options = { method: action === 'delete' ? 'DELETE' : 'POST', headers: {} };
        if (action === 'save') { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify({ mainSentence: button.dataset.title, explanation: button.dataset.explanation }); }
        const url = action === 'delete' ? '/api/learning-items/' + id : '/api/learning-items/' + id + '/' + action;
        const response = await fetch(url, options); const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Request failed');
        location.reload();
      } catch (error) { document.getElementById('message').textContent = error.message; document.getElementById('message').className = 'error'; button.disabled = false; }
    });
  </script>`, `
    .filters { display:grid; grid-template-columns:1fr 170px auto; gap:8px; margin-top:14px; }
    input,select,button { border:1px solid #bdc6d6; border-radius:8px; padding:9px 10px; font:inherit; background:white; }
    .filters button { background:#245eea; color:white; border-color:#245eea; font-weight:700; cursor:pointer; }
    .results { margin-top:12px; } .item { background:white; border:1px solid #dde3ee; border-radius:10px; margin-bottom:8px; }
    summary { display:flex; justify-content:space-between; align-items:center; gap:12px; cursor:pointer; padding:12px 14px; }
    summary strong,summary small { display:block; } summary small { color:#687386; margin-top:3px; }
    .detail { border-top:1px solid #edf0f5; padding:4px 14px 12px; font-size:.92rem; }
    .explanation { white-space:pre-wrap; line-height:1.5; }
    .actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; } .actions button { cursor:pointer; font-weight:700; padding:7px 10px; }
    .save { color:white; background:#16834a; border-color:#16834a; } .skip { background:#e9edf5; } .delete { color:#9b1c1c; background:#fff1f1; border-color:#f1bcbc; margin-left:auto; }
    #message.error { margin-top:10px; padding:9px; background:#ffe9e9; color:#8c1b1b; border-radius:8px; }
    @media(max-width:560px){.filters{grid-template-columns:1fr 1fr}.filters input{grid-column:1/-1}.filters button{width:100%}}
  `);
}
