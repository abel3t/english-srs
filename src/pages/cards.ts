export function cardsPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>English Learning Assistant</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; color: #172033; background: #f5f7fb; }
    * { box-sizing: border-box; }
    body { max-width: 760px; margin: 0 auto; padding: 18px 16px 40px; }
    nav { display: flex; align-items: center; gap: 6px; margin-bottom: 18px; }
    nav .brand { font-weight: 800; margin-right: auto; color: #172033; text-decoration: none; }
    nav a:not(.brand) { color: #4c5870; padding: 7px 10px; border-radius: 7px; text-decoration: none; font-size: .92rem; }
    nav a.active, nav a:not(.brand):hover { color: #1748bd; background: #e8efff; }
    h1 { margin: 0 0 4px; font-size: 1.75rem; } .subtitle { color: #5d677a; margin: 0; font-size: .95rem; }
    .panel { background: white; border: 1px solid #dde3ee; border-radius: 12px; padding: 16px; margin-top: 14px; box-shadow: 0 4px 14px rgba(31, 45, 75, .05); }
    label { display: block; font-weight: 650; margin: 11px 0 5px; font-size: .94rem; }
    label:first-child { margin-top: 0; }
    textarea, input { width: 100%; border: 1px solid #bdc6d6; border-radius: 7px; padding: 8px 10px; font: inherit; }
    textarea { min-height: 58px; resize: vertical; } #text { min-height: 88px; }
    button { border: 0; border-radius: 8px; padding: 9px 16px; font: inherit; font-weight: 650; cursor: pointer; margin: 11px 8px 0 0; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .primary { background: #245eea; color: white; } .save { background: #16834a; color: white; }
    .secondary { background: #e9edf5; color: #263148; }
    #preview, #message { display: none; } #message { padding: 10px; border-radius: 8px; margin-top: 12px; white-space: pre-wrap; }
    .error { display: block !important; background: #ffe9e9; color: #8c1b1b; }
    .success { display: block !important; background: #e5f7ec; color: #126436; }
    .recommendation { border-left: 4px solid #245eea; padding: 8px 12px; background: #f0f4ff; border-radius: 6px; }
    .score { font-size: 1.1rem; font-weight: 750; text-transform: capitalize; }
    .stats { color: #687386; font-size: .92rem; }
    .hint { color: #687386; font-size: .84rem; margin-top: 4px; }
    #explanation { min-height: 230px !important; }
    @media (max-width: 560px) {
      body { padding: 14px 12px 30px; }
      h1 { font-size: 1.5rem; }
      .panel { padding: 13px; margin-top: 11px; }
      #text { min-height: 78px; }
    }
  </style>
</head>
<body>
  <nav><a class="brand" href="/">English SRS</a><a href="/">Dashboard</a><a class="active" href="/learn">Learn</a><a href="/history">History</a></nav>
  <h1>English Learning Assistant</h1>
  <p class="subtitle">Understand real English, check how people use it, then decide whether it deserves a Noji card.</p>

  <form id="analyzeForm" class="panel">
    <label for="text">Sentence, phrase, or passage</label>
    <textarea id="text" maxlength="3000" placeholder="Paste something you encountered and did not fully understand..."></textarea>
    <div class="hint">At least 3 words. Nothing is saved to Noji until you confirm.</div>
    <label for="context">Context <span class="hint">(English or Vietnamese, optional)</span></label>
    <textarea id="context" maxlength="1500" placeholder="Where did you find it? Who was speaking? What was happening?"></textarea>
    <label for="confusingPart">What part don’t you understand? <span class="hint">(optional)</span></label>
    <textarea id="confusingPart" maxlength="500" placeholder="A word, phrase, grammar point, or tone. Leave empty to explain the whole sentence."></textarea>
    <label for="intendedMeaning">What do you think it means? <span class="hint">(English or Vietnamese, optional)</span></label>
    <textarea id="intendedMeaning" maxlength="1000" placeholder="Leave empty if you have no idea. This helps identify a possible misunderstanding."></textarea>
    <button id="analyzeButton" class="primary" type="submit" disabled>Analyze</button>
  </form>

  <div id="message"></div>
  <section id="preview" class="panel">
    <div class="recommendation">
      <div id="recommendation" class="score"></div>
      <div id="reason"></div>
    </div>
    <label for="mainSentence">Noji title</label>
    <textarea id="mainSentence"></textarea>
    <label for="explanation">Card content</label>
    <textarea id="explanation"></textarea>
    <div id="stats" class="stats"></div>
    <button id="saveButton" class="save" type="button">Save to Noji</button>
    <button id="skipButton" class="secondary" type="button">Skip for now</button>
  </section>

  <script>
    const elements = Object.fromEntries(['text','context','confusingPart','intendedMeaning','analyzeButton','message','preview','recommendation','reason','mainSentence','explanation','stats','saveButton','skipButton'].map(id => [id, document.getElementById(id)]));
    let currentId = null;
    const wordCount = value => value.trim().split(/\\s+/).filter(Boolean).length;
    const showMessage = (message, type) => { elements.message.textContent = message; elements.message.className = type; };
    const clearMessage = () => { elements.message.textContent = ''; elements.message.className = ''; elements.message.style.display = 'none'; };
    const setBusy = busy => { elements.analyzeButton.disabled = busy || wordCount(elements.text.value) < 3; elements.saveButton.disabled = busy; elements.skipButton.disabled = busy; };
    elements.text.addEventListener('input', () => setBusy(false));

    document.getElementById('analyzeForm').addEventListener('submit', async event => {
      event.preventDefault(); clearMessage(); setBusy(true); elements.preview.style.display = 'none';
      elements.analyzeButton.textContent = 'Analyzing…';
      try {
        const response = await fetch('/api/analyze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: elements.text.value.trim(), context: elements.context.value.trim() || undefined, confusingPart: elements.confusingPart.value.trim() || undefined, intendedMeaning: elements.intendedMeaning.value.trim() || undefined }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error || 'Analysis failed');
        currentId = body.item.id;
        elements.recommendation.textContent = body.item.recommendation.replaceAll('_', ' ') + ' — ' + body.item.recommendationScore + '/10';
        elements.reason.textContent = body.item.recommendationReason;
        elements.mainSentence.value = body.item.mainSentence;
        elements.explanation.value = body.item.explanation;
        elements.stats.textContent = 'Today: ' + body.stats.analyzed + ' analyzed · ' + body.stats.saved + ' saved · ' + body.stats.skipped + ' skipped';
        elements.preview.style.display = 'block';
      } catch (error) { showMessage(error.message, 'error'); }
      finally { elements.analyzeButton.textContent = 'Analyze'; setBusy(false); }
    });

    elements.saveButton.addEventListener('click', async () => {
      if (!currentId) return; clearMessage(); setBusy(true); elements.saveButton.textContent = 'Saving…';
      try {
        const response = await fetch('/api/learning-items/' + currentId + '/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mainSentence: elements.mainSentence.value.trim(), explanation: elements.explanation.value.trim() }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error || 'Save failed');
        showMessage('Saved to Noji.', 'success'); elements.preview.style.display = 'none'; currentId = null;
      } catch (error) { showMessage(error.message, 'error'); }
      finally { elements.saveButton.textContent = 'Save to Noji'; setBusy(false); }
    });

    elements.skipButton.addEventListener('click', async () => {
      if (!currentId) return; clearMessage(); setBusy(true);
      try {
        const response = await fetch('/api/learning-items/' + currentId + '/skip', { method: 'POST' });
        const body = await response.json(); if (!response.ok) throw new Error(body.message || body.error || 'Skip failed');
        showMessage('Skipped for now. It remains in your private history for recurrence detection.', 'success'); elements.preview.style.display = 'none'; currentId = null;
      } catch (error) { showMessage(error.message, 'error'); }
      finally { setBusy(false); }
    });
  </script>
</body>
</html>`;
}
