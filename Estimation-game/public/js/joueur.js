const socket = io();

const playerId = window.location.pathname.replace('/', '').trim(); // ex: "joueur3"
let isBM = false;
let hasGuessed = false;
let myTheme = '';

const themeBanner = document.getElementById('theme-banner');
const clueBox = document.getElementById('clue-box');
const gaugeContainer = document.getElementById('gauge-container');
const bmControls = document.getElementById('bm-controls');
const guessControls = document.getElementById('guess-controls');
const waitingMsg = document.getElementById('waiting-msg');
const resultsCard = document.getElementById('results-card');
const gameOverCard = document.getElementById('game-over-card');
const bmOverlay = document.getElementById('bm-overlay');
const bmOverlayText = document.getElementById('bm-overlay-text');

drawGauge(gaugeContainer, 0);

function resetPanels() {
  clueBox.classList.add('hidden');
  bmControls.classList.add('hidden');
  guessControls.classList.add('hidden');
  waitingMsg.classList.add('hidden');
  resultsCard.classList.add('hidden');
  gameOverCard.classList.add('hidden');
}

function tryJoin() {
  socket.emit('player:join', { playerId });
}

socket.on('connect', tryJoin);

socket.on('player:error', ({ message }) => {
  themeBanner.textContent = message;
  resetPanels();
  waitingMsg.textContent = "Nouvelle tentative de connexion dans quelques secondes...";
  waitingMsg.classList.remove('hidden');
  setTimeout(tryJoin, 3000);
});

socket.on('player:joined', ({ name, theme }) => {
  myTheme = theme;
  themeBanner.textContent = `👤 ${name} — Thème : ${theme || '(à venir)'}`;
});

socket.on('game:started', ({ theme }) => {
  myTheme = theme;
  themeBanner.textContent = `Thème : ${theme}`;
  resetPanels();
  drawGauge(gaugeContainer, 0);
});

socket.on('game:reset', () => {
  resetPanels();
  themeBanner.textContent = 'En attente d\'une nouvelle partie...';
  drawGauge(gaugeContainer, 0);
});

// ---------------------------------------------------------------------
// Annonce du Book-maker (bandeau 2s)
// ---------------------------------------------------------------------
socket.on('round:bm-announced', ({ isYou, bmName }) => {
  resetPanels();
  isBM = isYou;
  hasGuessed = false;
  drawGauge(gaugeContainer, 0);
  bmOverlayText.textContent = isYou ? '🎯 Vous êtes le Book-maker !' : `🎯 ${bmName} est le Book-maker`;
  bmOverlay.classList.remove('hidden');
  setTimeout(() => bmOverlay.classList.add('hidden'), 2000);
});

// ---------------------------------------------------------------------
// Tour du Book-maker
// ---------------------------------------------------------------------
socket.on('round:your-turn', ({ target, theme, clueSent }) => {
  resetPanels();
  isBM = true;
  myTheme = theme;
  themeBanner.textContent = `🎯 À vous de jouer (Book-maker) — Thème : ${theme}`;
  drawGauge(gaugeContainer, target);
  if (clueSent) {
    waitingMsg.textContent = "Indice envoyé. En attente des estimations des autres joueurs...";
    waitingMsg.classList.remove('hidden');
  } else {
    bmControls.classList.remove('hidden');
    document.getElementById('clue-input').value = '';
  }
});

document.getElementById('send-clue-btn').addEventListener('click', () => {
  const clue = document.getElementById('clue-input').value.trim();
  socket.emit('bm:submit-clue', { clue });
});

socket.on('bm:clue-sent', () => {
  bmControls.classList.add('hidden');
  waitingMsg.textContent = "Indice envoyé. En attente des estimations des autres joueurs...";
  waitingMsg.classList.remove('hidden');
});

// ---------------------------------------------------------------------
// En attente que le BM écrive son indice
// ---------------------------------------------------------------------
socket.on('round:waiting-bm', ({ bmName, theme }) => {
  resetPanels();
  isBM = false;
  myTheme = theme;
  themeBanner.textContent = `Thème : ${theme}`;
  drawGauge(gaugeContainer, 0);
  waitingMsg.textContent = `⏳ ${bmName} rédige son indice...`;
  waitingMsg.classList.remove('hidden');
});

// ---------------------------------------------------------------------
// Réception de l'indice -> phase d'estimation
// ---------------------------------------------------------------------
socket.on('round:clue', ({ clue, theme, bmName }) => {
  resetPanels();
  isBM = false;
  hasGuessed = false;
  myTheme = theme;
  themeBanner.textContent = `Thème : ${theme}`;
  clueBox.textContent = clue ? `💬 « ${clue} »` : `💬 (${bmName} n'a laissé aucun indice)`;
  clueBox.classList.remove('hidden');

  const guessInput = document.getElementById('guess-input');
  guessInput.value = 50;
  drawGauge(gaugeContainer, 50);
  guessControls.classList.remove('hidden');
});

const guessInputEl = document.getElementById('guess-input');
guessInputEl.addEventListener('input', () => {
  let v = parseInt(guessInputEl.value, 10);
  if (isNaN(v)) v = 0;
  v = Math.max(0, Math.min(100, v));
  drawGauge(gaugeContainer, v);
});

document.getElementById('validate-btn').addEventListener('click', () => {
  if (hasGuessed) return;
  let v = parseInt(guessInputEl.value, 10);
  if (isNaN(v)) v = 0;
  v = Math.max(0, Math.min(100, v));
  socket.emit('player:guess', { value: v });
});

socket.on('player:guess-received', () => {
  hasGuessed = true;
  guessControls.classList.add('hidden');
  clueBox.classList.remove('hidden');
  waitingMsg.textContent = "✅ Estimation envoyée. En attente des autres joueurs...";
  waitingMsg.classList.remove('hidden');
});

// ---------------------------------------------------------------------
// Résultats de la manche
// ---------------------------------------------------------------------
socket.on('round:results', payload => {
  resetPanels();
  drawGauge(gaugeContainer, payload.target, { target: payload.target });
  clueBox.textContent = `💬 « ${payload.clue || '(aucun indice)'} »`;
  clueBox.classList.remove('hidden');

  document.getElementById('result-target').textContent = payload.target;
  const list = document.getElementById('results-list');
  list.innerHTML = payload.results.map(r => `
    <div class="results-row">
      <span>${escapeHtml(r.name)} — ${r.guess}%</span>
      <span class="pts">+${r.points} pt${r.points > 1 ? 's' : ''}</span>
    </div>
  `).join('');
  resultsCard.classList.remove('hidden');

  const nextBtn = document.getElementById('next-round-btn');
  if (isBM && !payload.gameOver) {
    nextBtn.classList.remove('hidden');
  } else {
    nextBtn.classList.add('hidden');
  }

  if (payload.gameOver) {
    gameOverCard.classList.remove('hidden');
    document.getElementById('winner-banner').textContent =
      `🏆 ${payload.winner.name} remporte la partie avec ${payload.winner.score} points !`;
  }
});

document.getElementById('next-round-btn').addEventListener('click', () => {
  socket.emit('bm:next-round');
  document.getElementById('next-round-btn').classList.add('hidden');
});

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
