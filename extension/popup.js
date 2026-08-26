const endpoint = 'https://english-srs.abeltran-develop.workers.dev';
const text = document.getElementById('text');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
let currentCard = null;
let reviewStartedAt = 0;
let revealStage = 0;
const wordCount = value => value.trim().split(/\s+/).filter(Boolean).length;
text.addEventListener('input', () => { submit.disabled = wordCount(text.value) < 3; });
document.querySelector('.tabs').addEventListener('click', event => {
  const tab = event.target.closest('[data-view]'); if (!tab) return;
  document.querySelectorAll('.tab,.view').forEach(element => element.classList.remove('active'));
  tab.classList.add('active'); document.getElementById(tab.dataset.view).classList.add('active'); status.className = '';
});
document.getElementById('form').addEventListener('submit', async event => {
  event.preventDefault(); submit.disabled = true; submit.textContent = 'Analyzing…'; status.className = '';
  try {
    const response = await fetch(endpoint + '/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ text:text.value.trim() }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Could not capture sentence');
    status.textContent = 'Waiting for confirmation: “' + body.item.mainSentence + '”'; status.className = 'success'; text.value = '';
  } catch (error) { status.textContent = error.message; status.className = 'error'; }
  finally { submit.textContent = 'Save for later'; submit.disabled = wordCount(text.value) < 3; }
});

function makeCloze(value) {
  const stop = new Set(['this','that','with','from','have','your','what','when','where','which','would','could','should','about','there','their']);
  const words = [...value.matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)].filter(match => !stop.has(match[0].toLowerCase()));
  const chosen = words.length ? words[Math.floor(Math.random() * words.length)] : null;
  return chosen ? value.slice(0, chosen.index) + '_'.repeat(Math.min(chosen[0].length, 10)) + value.slice(chosen.index + chosen[0].length) : value;
}

function showReviewStage() {
  const label = document.getElementById('stageLabel'); const cardText = document.getElementById('cardText'); const reveal = document.getElementById('reveal');
  if (revealStage === 0) { label.textContent = 'Fill in the blank'; cardText.textContent = makeCloze(currentCard.front); cardText.className = 'cloze'; reveal.textContent = 'Reveal sentence'; }
  else if (revealStage === 1) { label.textContent = 'Complete sentence'; cardText.textContent = currentCard.front; cardText.className = 'cloze'; reveal.textContent = 'Show explanation'; }
  else { label.textContent = 'Explanation'; cardText.textContent = currentCard.back; cardText.className = ''; reveal.hidden = true; document.getElementById('ratings').hidden = false; }
}

document.getElementById('getCard').addEventListener('click', async event => {
  const button = event.target; button.disabled = true; button.textContent = 'Loading…'; status.className = '';
  try {
    const response = await fetch(endpoint + '/api/review/due'); const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Could not load due cards');
    if (!body.card) { document.getElementById('reviewEmpty').textContent = 'No cards are due right now.'; return; }
    currentCard = body.card; reviewStartedAt = Date.now(); revealStage = 0;
    document.getElementById('reviewEmpty').hidden = true; document.getElementById('card').hidden = false; button.hidden = true;
    const ratings = document.getElementById('ratings');
    ratings.replaceChildren(...currentCard.answerButtons.map(item => {
      const rating = document.createElement('button'); rating.className = item.type; rating.dataset.answer = item.type;
      rating.append(document.createTextNode(item.type[0].toUpperCase() + item.type.slice(1)));
      const repeat = document.createElement('small'); repeat.textContent = item.repeat; rating.append(repeat); return rating;
    }));
    ratings.hidden = true; document.getElementById('reveal').hidden = false; showReviewStage();
  } catch (error) { status.textContent = error.message; status.className = 'error'; }
  finally { button.disabled = false; button.textContent = 'Show a due card'; }
});

document.getElementById('reveal').addEventListener('click', () => { revealStage += 1; showReviewStage(); });
document.getElementById('ratings').addEventListener('click', async event => {
  const button = event.target.closest('[data-answer]'); if (!button || !currentCard) return;
  document.querySelectorAll('#ratings button').forEach(item => { item.disabled = true; });
  try {
    const response = await fetch(endpoint + '/api/review/answer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ cardId:currentCard.cardId, sessionTimestamp:currentCard.sessionTimestamp, answer:button.dataset.answer, reviewDurationMs:Date.now()-reviewStartedAt }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Noji did not accept the answer');
    status.textContent = 'Review updated in Noji.'; status.className = 'success'; currentCard = null;
    document.getElementById('card').hidden = true; document.getElementById('getCard').hidden = false; document.getElementById('getCard').click();
  } catch (error) { status.textContent = error.message; status.className = 'error'; document.querySelectorAll('#ratings button').forEach(item => { item.disabled = false; }); }
});
