const pathParts = location.pathname.split('/').filter(Boolean);
const lastPart = pathParts[pathParts.length - 1] || '';
const playerId = parseInt(lastPart.replace(/^joueur/, ''), 10);

const socket = io();
socket.emit('join-player', { playerId });

const playerLabel = document.getElementById('playerLabel');
const noGame = document.getElementById('noGame');
const gameArea = document.getElementById('gameArea');
const timerBox = document.getElementById('timerBox');
const lowTimeMsg = document.getElementById('lowTimeMsg');
const statusMsg = document.getElementById('statusMsg');
const finishBtn = document.getElementById('finishBtn');
const toastBox = document.getElementById('toastBox');

const currentRoundPanel = document.getElementById('currentRoundPanel');
const currentRoundLetter = document.getElementById('currentRoundLetter');
const currentRoundThemes = document.getElementById('currentRoundThemes');
const historyTable = document.getElementById('historyTable');

const liveReviewPanel = document.getElementById('liveReviewPanel');
const liveReviewTheme = document.getElementById('liveReviewTheme');
const liveReviewIdx = document.getElementById('liveReviewIdx');
const liveReviewTotal = document.getElementById('liveReviewTotal');
const liveReviewTable = document.getElementById('liveReviewTable');

const letterOverlay = document.getElementById('letterOverlay');
const letterOverlayLetter = document.getElementById('letterOverlayLetter');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownDisplay = document.getElementById('countdownDisplay');
const winnerOverlay = document.getElementById('winnerOverlay');
const winnerName = document.getElementById('winnerName');

let timerInterval = null;
let countdownInterval = null;

let currentAnswers = {};   // theme -> text, for the round in progress
let lastRoundSeen = 0;     // last round number for which we reset currentAnswers
let hasClickedFinish = false;
let expandedRounds = new Set(); // history rows expanded to show detail

let liveReviewData = null;    // { theme, themeIndex, totalThemes, rows: [{playerId,name,answer}] }
let liveReviewStatuses = {};  // playerId -> 'correct' | 'incomplete' | 'invalid'

function statusLabelFull(status) {
  if (status === 'correct') return 'Correcte';
  if (status === 'incomplete') return 'Incomplète';
  if (status === 'invalid') return 'Invalide';
  return 'En attente...';
}

function renderLiveReview() {
  if (!liveReviewData) return;
  liveReviewTheme.textContent = liveReviewData.theme;
  liveReviewIdx.textContent = liveReviewData.themeIndex + 1;
  liveReviewTotal.textContent = liveReviewData.totalThemes;

  let html = '<tr><th>Joueur</th><th>Réponse</th><th>Évaluation</th></tr>';
  liveReviewData.rows.forEach(row => {
    const status = liveReviewStatuses[row.playerId];
    const rowClass = status ? `row-${status}` : '';
    html += `<tr class="${rowClass}">
      <td>${row.name}</td>
      <td>${row.answer ? row.answer : '<i>(vide)</i>'}</td>
      <td><b>${statusLabelFull(status)}</b></td>
    </tr>`;
  });
  liveReviewTable.innerHTML = html;
}

function clearTimers() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function statusLabel(status) {
  if (status === 'correct') return 'Correcte';
  if (status === 'incomplete') return 'Incomplète';
  return 'Invalide';
}

function renderCurrentRound(state, me) {
  const inProgress = state.round > me.scores.length && state.letter && state.phase !== 'lobby';
  if (!inProgress) {
    currentRoundPanel.style.display = 'none';
    return;
  }
  currentRoundPanel.style.display = 'block';
  currentRoundLetter.textContent = state.letter;

  const isActive = state.phase === 'active' && !hasClickedFinish;

  let html = '';
  state.themes.forEach(theme => {
    const val = currentAnswers[theme] || '';
    html += `
      <div class="theme-answer-row">
        <label class="theme-answer-label">${theme}</label>
        <input
          class="answer-input theme-answer-input"
          data-theme="${encodeURIComponent(theme)}"
          value="${val.replace(/"/g, '&quot;')}"
          placeholder="${state.letter}..."
          ${isActive ? '' : 'disabled'}
        >
      </div>`;
  });
  currentRoundThemes.innerHTML = html;

  currentRoundThemes.querySelectorAll('.answer-input').forEach(input => {
    input.addEventListener('input', () => {
      const theme = decodeURIComponent(input.dataset.theme);
      currentAnswers[theme] = input.value;
      socket.emit('update-answer', { playerId, theme, text: input.value });
    });
  });
}

function renderHistory(state, me) {
  if (me.scores.length === 0) {
    historyTable.innerHTML = '<tr><td class="subtitle" style="border:none;">Aucune manche jouée pour le moment.</td></tr>';
    return;
  }

  let html = '<tr><th>Manche</th><th>Lettre</th><th>Score</th><th></th></tr>';
  for (let r = 0; r < me.scores.length; r++) {
    const s = me.scores[r];
    const isExpanded = expandedRounds.has(r);
    html += `<tr class="history-row" data-round="${r}">
      <td>${r + 1}</td>
      <td class="badge letter">${s.letter}</td>
      <td><b>${s.points}</b></td>
      <td><button class="btn secondary toggle-detail-btn" data-round="${r}">${isExpanded ? 'Masquer' : 'Détail'}</button></td>
    </tr>`;

    if (isExpanded) {
      html += `<tr class="history-detail-row"><td colspan="4"><div class="detail-grid">`;
      state.themes.forEach(theme => {
        const res = s.results ? s.results[theme] : null;
        if (res) {
          html += `<div class="detail-cell cell-${res.status}">
            <div class="detail-theme">${theme}</div>
            <div class="detail-answer">${res.answer ? res.answer : '<i>(vide)</i>'}</div>
            <div class="cell-tag">${statusLabel(res.status)}</div>
          </div>`;
        } else {
          html += `<div class="detail-cell"><div class="detail-theme">${theme}</div><div class="detail-answer">-</div></div>`;
        }
      });
      html += `</div></td></tr>`;
    }
  }
  historyTable.innerHTML = html;

  historyTable.querySelectorAll('.toggle-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = parseInt(btn.dataset.round, 10);
      if (expandedRounds.has(r)) expandedRounds.delete(r);
      else expandedRounds.add(r);
      renderHistory(currentStateCache, currentMeCache);
    });
  });
}

let currentStateCache = null;
let currentMeCache = null;

function runCountdown(remainingMs) {
  countdownOverlay.style.display = 'flex';
  const localEnd = Date.now() + remainingMs;
  function tick() {
    const remaining = Math.ceil((localEnd - Date.now()) / 1000);
    countdownDisplay.textContent = remaining > 0 ? remaining : 'GO !';
    if (Date.now() >= localEnd) clearInterval(countdownInterval);
  }
  tick();
  countdownInterval = setInterval(tick, 200);
}

function runTimer(remainingMs) {
  timerBox.style.display = 'block';
  const localEnd = Date.now() + remainingMs;
  function tick() {
    const remaining = Math.max(0, Math.ceil((localEnd - Date.now()) / 1000));
    const mm = Math.floor(remaining / 60);
    const ss = remaining % 60;
    timerBox.textContent = `${mm}:${ss.toString().padStart(2, '0')}`;
    const isLow = remaining <= 10 && remaining > 0;
    timerBox.classList.toggle('low', isLow);
    lowTimeMsg.style.display = isLow ? 'block' : 'none';
    if (Date.now() >= localEnd) clearInterval(timerInterval);
  }
  tick();
  timerInterval = setInterval(tick, 250);
}

function showToast(message, type) {
  const div = document.createElement('div');
  div.className = `toast toast-${type || 'info'}`;
  div.textContent = message;
  toastBox.appendChild(div);
  setTimeout(() => div.classList.add('visible'), 10);
  setTimeout(() => {
    div.classList.remove('visible');
    setTimeout(() => div.remove(), 400);
  }, 4500);
}

function render(state) {
  if (!state) {
    noGame.style.display = 'block';
    gameArea.style.display = 'none';
    return;
  }

  const me = state.players.find(p => p.id === playerId);
  if (!me) {
    noGame.style.display = 'block';
    noGame.querySelector('p').textContent = "Ce joueur n'existe pas dans la partie en cours.";
    gameArea.style.display = 'none';
    return;
  }

  currentStateCache = state;
  currentMeCache = me;

  noGame.style.display = 'none';
  gameArea.style.display = 'block';
  playerLabel.textContent = me.name;

  if (state.round !== lastRoundSeen) {
    currentAnswers = {};
    hasClickedFinish = false;
    lastRoundSeen = state.round;
  }

  clearTimers();
  timerBox.style.display = 'none';
  lowTimeMsg.style.display = 'none';
  letterOverlay.style.display = 'none';
  countdownOverlay.style.display = 'none';
  winnerOverlay.style.display = 'none';
  finishBtn.style.display = 'none';
  liveReviewPanel.style.display = 'none';

  switch (state.phase) {
    case 'lobby':
      statusMsg.textContent = 'En attente du maître du jeu...';
      break;
    case 'drawing':
      statusMsg.textContent = 'Tirage de la lettre en cours...';
      break;
    case 'letter-reveal':
      letterOverlay.style.display = 'flex';
      letterOverlayLetter.textContent = state.letter;
      statusMsg.textContent = `Lettre : ${state.letter}`;
      break;
    case 'ready':
      statusMsg.textContent = 'La manche va bientôt commencer...';
      break;
    case 'countdown':
      runCountdown(state.countdownRemainingMs);
      statusMsg.textContent = 'Préparez-vous !';
      break;
    case 'active':
      runTimer(state.timerRemainingMs);
      if (hasClickedFinish) {
        statusMsg.textContent = `En attente des autres joueurs... (${state.playersDone.length}/${state.players.length} ont terminé)`;
      } else {
        statusMsg.textContent = 'À vous de jouer !';
        finishBtn.style.display = 'inline-block';
      }
      break;
    case 'reviewing':
      statusMsg.textContent = 'Le maître du jeu corrige les réponses...';
      liveReviewPanel.style.display = 'block';
      break;
    case 'round-summary':
      statusMsg.textContent = 'Manche terminée, en attente du maître du jeu...';
      break;
    case 'finished':
      winnerOverlay.style.display = 'flex';
      winnerName.textContent = (state.winner || []).join(' & ');
      statusMsg.textContent = 'Partie terminée.';
      break;
  }

  renderCurrentRound(state, me);
  renderHistory(state, me);
}

finishBtn.addEventListener('click', () => {
  hasClickedFinish = true;
  finishBtn.style.display = 'none';
  socket.emit('player-finished', { playerId });
});

socket.on('state', render);
socket.on('notification', (data) => showToast(data.message, data.type));
socket.on('reset', () => { location.reload(); });

socket.on('review-data', (data) => {
  liveReviewData = data;
  liveReviewStatuses = {}; // new theme: clear previous statuses
  renderLiveReview();
});

socket.on('review-live-status', ({ theme, playerId, status }) => {
  if (!liveReviewData || liveReviewData.theme !== theme) return;
  liveReviewStatuses[playerId] = status;
  renderLiveReview();
});
