const socket = io();
socket.emit('join-master');

const noGame = document.getElementById('noGame');
const gameArea = document.getElementById('gameArea');
const roundNum = document.getElementById('roundNum');
const currentLetter = document.getElementById('currentLetter');
const usedLettersBox = document.getElementById('usedLettersBox');
const drawBtn = document.getElementById('drawBtn');
const startBtn = document.getElementById('startBtn');
const redrawBtn = document.getElementById('redrawBtn');
const scoreTable = document.getElementById('scoreTable');
const reviewPanel = document.getElementById('reviewPanel');
const reviewThemeName = document.getElementById('reviewThemeName');
const reviewIdx = document.getElementById('reviewIdx');
const reviewTotal = document.getElementById('reviewTotal');
const reviewBody = document.getElementById('reviewBody');
const validateThemeBtn = document.getElementById('validateThemeBtn');
const summaryPanel = document.getElementById('summaryPanel');
const nextRoundBtn = document.getElementById('nextRoundBtn');
const endGameBtn = document.getElementById('endGameBtn');
const masterLinkList = document.getElementById('masterLinkList');
const activeStatus = document.getElementById('activeStatus');
const toastBox = document.getElementById('toastBox');

const drawOverlay = document.getElementById('drawOverlay');
const drawLetterDisplay = document.getElementById('drawLetterDisplay');
const countdownOverlay = document.getElementById('countdownOverlay');
const countdownDisplay = document.getElementById('countdownDisplay');
const winnerOverlay = document.getElementById('winnerOverlay');
const winnerName = document.getElementById('winnerName');

let currentState = null;
let scrollInterval = null;
let countdownInterval = null;

function renderLinks(players) {
  const base = `${location.protocol}//${location.host}`;
  masterLinkList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}</span><a href="${base}/joueur${p.id}" target="_blank">${base}/joueur${p.id}</a>`;
    masterLinkList.appendChild(li);
  });
}

function renderScoreTable(state) {
  const rounds = state.round;
  let html = '<tr><th>Joueur</th>';
  for (let r = 1; r <= rounds; r++) html += `<th>Manche ${r}</th>`;
  html += '<th>Total</th></tr>';

  state.players.forEach(p => {
    html += `<tr><td>${p.name}</td>`;
    for (let r = 0; r < rounds; r++) {
      const s = p.scores[r];
      html += s ? `<td>${s.letter} — ${s.points} pt</td>` : '<td>-</td>';
    }
    html += `<td><b>${p.total}</b></td></tr>`;
  });
  scoreTable.innerHTML = html;
}

function renderUsedLetters(used) {
  if (!used || used.length === 0) {
    usedLettersBox.innerHTML = '<span class="subtitle">Aucune lettre tirée pour le moment.</span>';
    return;
  }
  usedLettersBox.innerHTML = used.map(l => `<span class="letter-chip">${l}</span>`).join(' ');
}

function clearOverlays() {
  drawOverlay.style.display = 'none';
  countdownOverlay.style.display = 'none';
  if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; }
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

function runLetterScramble(remainingMs) {
  drawOverlay.style.display = 'flex';
  const localEnd = Date.now() + remainingMs;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  scrollInterval = setInterval(() => {
    drawLetterDisplay.textContent = alphabet[Math.floor(Math.random() * alphabet.length)];
    if (Date.now() >= localEnd) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
  }, 80);
}

function runCountdown(remainingMs) {
  countdownOverlay.style.display = 'flex';
  const localEnd = Date.now() + remainingMs;
  function tick() {
    const remaining = Math.ceil((localEnd - Date.now()) / 1000);
    countdownDisplay.textContent = remaining > 0 ? remaining : 'GO !';
    if (Date.now() >= localEnd) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }
  tick();
  countdownInterval = setInterval(tick, 200);
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
  }, 5000);
}

function render(state) {
  currentState = state;
  if (!state) {
    noGame.style.display = 'block';
    gameArea.style.display = 'none';
    return;
  }
  noGame.style.display = 'none';
  gameArea.style.display = 'block';

  renderLinks(state.players);
  roundNum.textContent = state.round || '-';
  currentLetter.textContent = state.letter || '?';
  renderScoreTable(state);
  renderUsedLetters(state.usedLetters);

  reviewPanel.style.display = 'none';
  summaryPanel.style.display = 'none';
  winnerOverlay.style.display = 'none';
  activeStatus.textContent = '';

  drawBtn.disabled = true;
  startBtn.disabled = true;
  redrawBtn.style.display = 'none';

  clearOverlays();

  switch (state.phase) {
    case 'lobby':
      drawBtn.disabled = false;
      break;
    case 'drawing':
      runLetterScramble(state.drawRemainingMs);
      break;
    case 'letter-reveal':
      drawOverlay.style.display = 'flex';
      drawLetterDisplay.textContent = state.letter;
      break;
    case 'ready':
      startBtn.disabled = false;
      redrawBtn.style.display = 'inline-block';
      break;
    case 'countdown':
      runCountdown(state.countdownRemainingMs);
      break;
    case 'active':
      activeStatus.textContent = `${state.playersDone.length} / ${state.players.length} joueur(s) ont terminé`;
      break;
    case 'reviewing':
      reviewPanel.style.display = 'block';
      break;
    case 'round-summary':
      summaryPanel.style.display = 'block';
      break;
    case 'finished':
      winnerOverlay.style.display = 'flex';
      winnerName.textContent = (state.winner || []).join(' & ');
      break;
  }
}

function renderReview(data) {
  reviewThemeName.textContent = data.theme;
  reviewIdx.textContent = data.themeIndex + 1;
  reviewTotal.textContent = data.totalThemes;

  const localResults = {};
  reviewBody.innerHTML = '';
  data.rows.forEach(row => {
    localResults[row.playerId] = null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.name}</td>
      <td>${row.answer ? row.answer : '<i style="color:#777">(vide)</i>'}</td>
      <td>
        <div class="status-btns" data-player="${row.playerId}">
          <button class="status-btn correct" data-status="correct">Correcte</button>
          <button class="status-btn incomplete" data-status="incomplete">Incomplète</button>
          <button class="status-btn invalid" data-status="invalid">Invalide</button>
        </div>
      </td>`;
    reviewBody.appendChild(tr);
  });

  reviewBody.querySelectorAll('.status-btns').forEach(group => {
    const playerId = group.dataset.player;
    group.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        localResults[playerId] = btn.dataset.status;
        group.querySelectorAll('.status-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        socket.emit('review-live-status', { theme: data.theme, playerId, status: btn.dataset.status });
      });
    });
  });

  validateThemeBtn.onclick = () => {
    const missing = Object.values(localResults).some(v => v === null);
    if (missing) {
      if (!confirm('Certaines réponses ne sont pas évaluées, elles seront comptées comme Invalide. Continuer ?')) return;
    }
    const finalResults = {};
    Object.keys(localResults).forEach(pid => {
      finalResults[pid] = localResults[pid] || 'invalid';
    });
    socket.emit('validate-theme', { theme: data.theme, results: finalResults });
  };
}

drawBtn.addEventListener('click', () => socket.emit('draw-letter'));
startBtn.addEventListener('click', () => socket.emit('start-round'));
redrawBtn.addEventListener('click', () => {
  const letter = currentState ? currentState.letter : '';
  if (confirm(`Tirer une nouvelle lettre à la place de "${letter}" ? Cela retirera 3 points à TOUS les joueurs.`)) {
    socket.emit('redraw-letter');
  }
});
nextRoundBtn.addEventListener('click', () => socket.emit('next-round'));
endGameBtn.addEventListener('click', () => {
  if (confirm('Terminer la partie et afficher le vainqueur ?')) socket.emit('end-game');
});

socket.on('state', render);
socket.on('review-data', renderReview);
socket.on('notification', (data) => showToast(data.message, data.type));
socket.on('reset', () => { location.href = '/'; });
