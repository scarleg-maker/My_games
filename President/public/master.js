const setupView = document.getElementById('setup-view');
const gameView = document.getElementById('game-view');

let selectedMode = null;
let playerCount = 4;
let rounds = 10;
let points = 70;
let savedNames = [];
let selectedZip = null;

const handSizeOptions = ['all', 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
let handSizeIndex = 0; // 'all' by default

// ---------- mode selection ----------
document.querySelectorAll('.mode-card').forEach((card) => {
  card.addEventListener('click', () => {
    selectedMode = card.dataset.mode;
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.toggle('selected', c === card));
    document.getElementById('photos-panel').classList.toggle('hidden', selectedMode !== 'B');
    if (selectedMode === 'A') handSizeIndex = 0; // verrouillé sur "Toutes" en mode A
    renderPlayerRows();
    renderHandSize();
  });
});

// ---------- player count ----------
function renderPlayerRows() {
  const container = document.getElementById('player-rows');
  container.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const existing = container.dataset;
    row.innerHTML = `
      <div class="idx">${i + 1}</div>
      <input type="text" class="player-name-input" data-i="${i}" placeholder="Nom du joueur ${i + 1}"
        value="${(savedNames[i] || '').replace(/"/g, '&quot;')}">
    `;
    container.appendChild(row);
  }
  const minBtn = document.getElementById('players-minus');
  const maxBtn = document.getElementById('players-plus');
  minBtn.disabled = playerCount <= 2 || (selectedMode === 'A' && playerCount <= 4);
  maxBtn.disabled = playerCount >= 6;
  document.getElementById('players-count').textContent = playerCount;
}

document.getElementById('players-minus').addEventListener('click', () => {
  const floor = selectedMode === 'A' ? 4 : 2;
  if (playerCount > floor) { playerCount--; renderPlayerRows(); }
});
document.getElementById('players-plus').addEventListener('click', () => {
  if (playerCount < 6) { playerCount++; renderPlayerRows(); }
});

// ---------- rounds stepper ----------
document.getElementById('rounds-minus').addEventListener('click', () => {
  if (rounds > 3) { rounds--; document.getElementById('rounds-count').textContent = rounds; }
});
document.getElementById('rounds-plus').addEventListener('click', () => {
  if (rounds < 20) { rounds++; document.getElementById('rounds-count').textContent = rounds; }
});

// ---------- points stepper ----------
document.getElementById('points-minus').addEventListener('click', () => {
  if (points > 50) { points -= 10; document.getElementById('points-count').textContent = points; }
});
document.getElementById('points-plus').addEventListener('click', () => {
  if (points < 100) { points += 10; document.getElementById('points-count').textContent = points; }
});

// ---------- hand size stepper ----------
function renderHandSize() {
  const label = handSizeOptions[handSizeIndex];
  document.getElementById('handsize-count').textContent = label === 'all' ? 'Toutes' : label;
  const lockedForModeA = selectedMode === 'A';
  document.getElementById('handsize-minus').disabled = lockedForModeA || handSizeIndex <= 0;
  document.getElementById('handsize-plus').disabled = lockedForModeA || handSizeIndex >= handSizeOptions.length - 1;
  document.getElementById('handsize-hint').classList.toggle('hidden', !lockedForModeA);
}
document.getElementById('handsize-minus').addEventListener('click', () => {
  if (handSizeIndex > 0) { handSizeIndex--; renderHandSize(); }
});
document.getElementById('handsize-plus').addEventListener('click', () => {
  if (handSizeIndex < handSizeOptions.length - 1) { handSizeIndex++; renderHandSize(); }
});
renderHandSize();

// ---------- zip dropzone ----------
const dropzone = document.getElementById('dropzone');
const photosInput = document.getElementById('photos-input');
dropzone.addEventListener('click', () => photosInput.click());
photosInput.addEventListener('change', () => {
  selectedZip = photosInput.files[0] || null;
  dropzone.classList.toggle('has-file', !!selectedZip);
  document.getElementById('dropzone-label').textContent = selectedZip
    ? `Archive sélectionnée : ${selectedZip.name}`
    : 'Cliquez pour choisir une archive .zip (minimum 42 images)';
});

// ---------- init ----------
async function init() {
  try {
    const res = await fetch('/api/saved-players');
    const data = await res.json();
    savedNames = data.players || [];
    if (savedNames.length >= 2) playerCount = Math.min(6, Math.max(2, savedNames.length));
  } catch (e) { /* ignore */ }
  renderPlayerRows();

  const stateRes = await fetch('/api/state');
  const state = await stateRes.json();
  if (state.configured) {
    showGameView();
    renderGameState(state);
  }
}

// ---------- form submit ----------
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('setup-error');
  errBox.classList.add('hidden');

  if (!selectedMode) return showError('Choisissez un mode de jeu.');
  const names = Array.from(document.querySelectorAll('.player-name-input')).map((i) => i.value.trim());
  if (names.some((n) => !n)) return showError('Renseignez le nom de tous les joueurs.');

  const fd = new FormData();
  fd.append('mode', selectedMode);
  fd.append('players', JSON.stringify(names));
  fd.append('theme', document.getElementById('theme').value.trim());
  fd.append('totalRounds', rounds);
  fd.append('pointsToWin', points);
  fd.append('handSize', handSizeOptions[handSizeIndex]);
  if (selectedMode === 'B') {
    if (!selectedZip) return showError('Sélectionnez une archive ZIP de photos.');
    fd.append('photos', selectedZip);
  }

  const btn = document.getElementById('launch-btn');
  btn.disabled = true;
  btn.textContent = 'Préparation...';
  try {
    const res = await fetch('/api/start-game', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
    showGameView();
    refreshState();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lancer la partie';
  }

  function showError(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }
});

function showGameView() {
  setupView.classList.add('hidden');
  gameView.classList.remove('hidden');
}

// ---------- game control view ----------
async function refreshState() {
  const res = await fetch('/api/state');
  const state = await res.json();
  if (!state.configured) {
    gameView.classList.add('hidden');
    setupView.classList.remove('hidden');
    return;
  }
  renderGameState(state);
}

function renderGameState(state) {
  document.getElementById('game-title').textContent = state.theme ? `Thème : ${state.theme}` : 'Partie en cours';

  const statusLabels = {
    ready: 'Prêt à démarrer',
    playing: `Tour ${state.round} / ${state.totalRounds} en cours`,
    'round-end': `Tour ${state.round} terminé`,
    'game-over': 'Partie terminée'
  };
  document.getElementById('game-status').textContent = statusLabels[state.status] || state.status;

  // player links
  const linksEl = document.getElementById('player-links');
  linksEl.innerHTML = state.players
    .map((p, i) => `<div><strong>${p}</strong> — <a href="/joueur${i + 1}" target="_blank">localhost:4000/joueur${i + 1}</a></div>`)
    .join('');

  // table zone
  const tableZone = document.getElementById('table-zone');
  if (state.table) {
    const levelBadge = state.masterExtra
      ? `<div class="level-badge">Niv. ${String(state.masterExtra.level).padStart(2, '0')}</div>`
      : '';
    const face = state.mode === 'B'
      ? `<img src="/api/image/${state.table.imageId}" alt="">`
      : `<img src="/static/assets/cards/${state.table.spriteId}.svg" alt="${state.table.label}">`;
    tableZone.innerHTML = `
      <div class="played-card">${levelBadge}${face}</div>
      <div class="by">posée par ${state.table.playerName}</div>
    `;
  } else {
    tableZone.innerHTML = `<div class="played-card empty">Aucune carte sur la table</div>`;
  }

  // round controls
  const controls = document.getElementById('round-controls');
  controls.innerHTML = '';
  if (state.status === 'ready' || state.status === 'round-end') {
    if (state.status !== 'game-over') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-gold';
      btn.textContent = state.status === 'ready' ? 'Lancer le tour 1' : `Lancer le tour ${state.round + 1}`;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await fetch('/api/start-round', { method: 'POST' });
      });
      controls.appendChild(btn);
    }
  } else if (state.status === 'playing') {
    const p = document.createElement('div');
    p.className = 'status-pill';
    p.textContent = `Au tour de : ${state.currentPlayer}`;
    controls.appendChild(p);
  } else if (state.status === 'game-over') {
    const p = document.createElement('div');
    p.className = 'status-pill';
    const winner = Object.entries(state.scores).sort((a, b) => b[1] - a[1])[0];
    p.textContent = `🏆 Vainqueur : ${winner[0]} (${winner[1]} pts)`;
    controls.appendChild(p);
  }

  // scores table
  const table = document.getElementById('scores-table');
  const sorted = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
  table.innerHTML = `
    <tr><th>Joueur</th><th>Score du tour</th><th>Score total</th><th>Cartes restantes</th></tr>
    ${sorted.map(([name, score]) => `
      <tr>
        <td class="name">${name}</td>
        <td>${state.lastRoundScores[name] ?? '—'}</td>
        <td>${score}</td>
        <td>${state.handCounts[name] ?? '—'}</td>
      </tr>
    `).join('')}
  `;

  // log
  document.getElementById('log-feed').innerHTML = state.log.map((l) => `<div>${l}</div>`).join('');
}

document.getElementById('new-game-btn').addEventListener('click', async () => {
  if (!confirm('Démarrer une nouvelle partie ? La partie en cours sera perdue.')) return;
  await fetch('/api/new-game', { method: 'POST' });
  gameView.classList.add('hidden');
  setupView.classList.remove('hidden');
  location.reload();
});

// ---------- realtime ----------
const socket = io();
socket.on('state-updated', refreshState);

init();
