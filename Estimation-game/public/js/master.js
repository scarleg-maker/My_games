const socket = io();

const MAX_PLAYERS = 8;
const STORAGE_KEY = 'estimation-game-names';

let selectedNumPlayers = 4;
let selectedTarget = 50;
let currentPlayersMeta = []; // dernier état reçu du serveur

// ---------------------------------------------------------------------
// Persistance des noms de joueurs (localStorage) d'une partie à l'autre
// ---------------------------------------------------------------------
function loadSavedNames() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveNames(names) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
}

function getCurrentNamesFromInputs() {
  const names = [];
  for (let i = 1; i <= selectedNumPlayers; i++) {
    const el = document.getElementById(`name-${i}`);
    names.push(el ? el.value.trim() : '');
  }
  return names;
}

// ---------------------------------------------------------------------
// Construction de l'écran de configuration
// ---------------------------------------------------------------------
function buildNumPlayerButtons() {
  const container = document.getElementById('num-players-buttons');
  container.innerHTML = '';
  for (let n = 2; n <= MAX_PLAYERS; n++) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn' + (n === selectedNumPlayers ? ' selected' : '');
    btn.textContent = n;
    btn.addEventListener('click', () => {
      selectedNumPlayers = n;
      buildNumPlayerButtons();
      buildNamesInputs();
    });
    container.appendChild(btn);
  }
}

function buildNamesInputs() {
  const container = document.getElementById('names-container');
  const saved = loadSavedNames();
  container.innerHTML = '';
  for (let i = 1; i <= selectedNumPlayers; i++) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `Joueur ${i}`;
    label.setAttribute('for', `name-${i}`);
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `name-${i}`;
    input.placeholder = `Nom du joueur ${i}`;
    input.value = saved[i - 1] || '';
    input.addEventListener('input', () => {
      const names = getCurrentNamesFromInputs();
      saveNames(names);
    });
    wrap.appendChild(label);
    wrap.appendChild(input);
    container.appendChild(wrap);
  }
}

function buildPointsButtons() {
  const container = document.getElementById('points-buttons');
  container.innerHTML = '';
  for (let p = 10; p <= 100; p += 10) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn' + (p === selectedTarget ? ' selected' : '');
    btn.textContent = p;
    btn.addEventListener('click', () => {
      selectedTarget = p;
      buildPointsButtons();
    });
    container.appendChild(btn);
  }
}

buildNumPlayerButtons();
buildNamesInputs();
buildPointsButtons();

// ---------------------------------------------------------------------
// Lancement de la partie
// ---------------------------------------------------------------------
document.getElementById('start-btn').addEventListener('click', () => {
  const names = getCurrentNamesFromInputs();
  saveNames(names);
  const theme = document.getElementById('theme-input').value.trim();
  if (!theme) {
    alert("Merci d'indiquer un thème pour la partie.");
    return;
  }
  socket.emit('master:configure', {
    numPlayers: selectedNumPlayers,
    names,
    theme,
    targetScore: selectedTarget,
  });
  socket.emit('master:start');
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  socket.emit('master:new-game');
  document.getElementById('config-screen').classList.remove('hidden');
  document.getElementById('live-screen').classList.add('hidden');
  document.getElementById('game-over-card').classList.add('hidden');
  document.getElementById('last-results-card').classList.add('hidden');
});

// ---------------------------------------------------------------------
// Réception des évènements serveur
// ---------------------------------------------------------------------
socket.on('connect', () => {
  socket.emit('master:join');
});

socket.on('game:state', state => {
  currentPlayersMeta = state.players;
  renderScoreboard(state);
  if (state.started) {
    showLiveScreen(state);
  }
});

socket.on('game:started', state => {
  showLiveScreen(state);
  document.getElementById('game-over-card').classList.add('hidden');
  document.getElementById('last-results-card').classList.add('hidden');
});

socket.on('round:bm-announced', ({ bmName }) => {
  document.getElementById('round-status').innerHTML =
    `📣 <strong>${escapeHtml(bmName)}</strong> est désigné Book-maker pour cette manche...`;
});

socket.on('round:update', info => {
  let txt = '';
  if (info.phase === 'bm-turn') {
    txt = `⏳ <strong>${escapeHtml(info.bmName)}</strong> (Book-maker) rédige son indice...`;
  } else if (info.phase === 'guessing') {
    txt = `🤔 En attente des estimations : ${info.guessedCount}/${info.totalNeeded} joueurs ont validé.`;
  } else if (info.phase === 'results') {
    txt = `✅ Résultats de la manche disponibles.`;
  }
  if (txt) document.getElementById('round-status').innerHTML = txt;
});

socket.on('round:results', payload => {
  document.getElementById('round-status').innerHTML = `✅ Manche terminée. Prochaine manche dès que le Book-maker valide.`;
  renderLastResults(payload);
  renderScoreboardFromScores(payload.scores);

  if (payload.gameOver) {
    document.getElementById('game-over-card').classList.remove('hidden');
    document.getElementById('winner-banner').textContent =
      `🏆 ${payload.winner.name} remporte la partie avec ${payload.winner.score} points !`;
  }
});

socket.on('game:reset', () => {
  document.getElementById('config-screen').classList.remove('hidden');
  document.getElementById('live-screen').classList.add('hidden');
});

// ---------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------
function showLiveScreen(state) {
  document.getElementById('config-screen').classList.add('hidden');
  document.getElementById('live-screen').classList.remove('hidden');
  document.getElementById('theme-display').textContent = state.theme;
  document.getElementById('target-display').textContent = state.targetScore;

  const linksContainer = document.getElementById('player-links');
  linksContainer.innerHTML = '';
  const origin = window.location.origin;
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-link-row';
    row.innerHTML = `
      <span><span class="status-dot ${p.connected ? 'on' : ''}"></span>${escapeHtml(p.name)}</span>
      <a href="${origin}/${p.id}" target="_blank">${origin}/${p.id}</a>
    `;
    linksContainer.appendChild(row);
  });

  renderScoreboardFromScores(state.players);
}

function renderScoreboard(state) {
  renderScoreboardFromScores(state.players);
  const linksContainer = document.getElementById('player-links');
  if (state.players.length && document.getElementById('live-screen') && !document.getElementById('live-screen').classList.contains('hidden')) {
    const origin = window.location.origin;
    linksContainer.innerHTML = '';
    state.players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-link-row';
      row.innerHTML = `
        <span><span class="status-dot ${p.connected ? 'on' : ''}"></span>${escapeHtml(p.name)}</span>
        <a href="${origin}/${p.id}" target="_blank">${origin}/${p.id}</a>
      `;
      linksContainer.appendChild(row);
    });
  }
}

function renderScoreboardFromScores(players) {
  const body = document.getElementById('scoreboard-body');
  if (!body) return;
  const sorted = [...players].sort((a, b) => b.score - a.score);
  body.innerHTML = '';
  sorted.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="status-dot ${p.connected ? 'on' : ''}"></span></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${p.score}</td>
    `;
    body.appendChild(tr);
  });
}

function renderLastResults(payload) {
  const card = document.getElementById('last-results-card');
  const container = document.getElementById('last-results');
  card.classList.remove('hidden');
  const rows = payload.results.map(r => `
    <div class="results-row">
      <span>${escapeHtml(r.name)} — estimation : ${r.guess}%</span>
      <span class="pts">+${r.points} pt${r.points > 1 ? 's' : ''}</span>
    </div>
  `).join('');
  container.innerHTML = `
    <div>Book-maker : <strong>${escapeHtml(payload.bmName)}</strong> — Valeur exacte : <strong>${payload.target}%</strong></div>
    <div style="margin:8px 0;color:#0d5c48;">Indice : « ${escapeHtml(payload.clue || '(aucun)')} »</div>
    <div class="results-list">${rows}</div>
  `;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
