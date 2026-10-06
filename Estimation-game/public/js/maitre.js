const socket = io();

const MAX_PLAYERS = 8;
const STORAGE_KEY = 'estimation-game-names';

// Code du salon = premier segment de l'URL (ex: /K7QF)
const ROOM_CODE = (window.location.pathname.split('/')[1] || '').toUpperCase();
document.getElementById('room-code-display').textContent = ROOM_CODE;
document.getElementById('code-big').textContent = ROOM_CODE;

let selectedNumPlayers = 4;
let selectedTarget = 50;
let lanUrls = [];

// ---------------------------------------------------------------------
// Persistance des noms de joueurs (localStorage) d'une partie à l'autre
// ---------------------------------------------------------------------
function loadSavedNames() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveNames(names) { localStorage.setItem(STORAGE_KEY, JSON.stringify(names)); }

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
    input.addEventListener('input', () => saveNames(getCurrentNamesFromInputs()));
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
  if (!theme) { alert("Merci d'indiquer un thème pour la partie."); return; }
  socket.emit('master:configure', {
    code: ROOM_CODE, numPlayers: selectedNumPlayers, names, theme, targetScore: selectedTarget,
  });
  socket.emit('master:start', { code: ROOM_CODE });
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  socket.emit('master:new-game', { code: ROOM_CODE });
  document.getElementById('config-screen').classList.remove('hidden');
  document.getElementById('live-screen').classList.add('hidden');
  document.getElementById('game-over-card').classList.add('hidden');
  document.getElementById('last-results-card').classList.add('hidden');
});

document.getElementById('copy-link-btn').addEventListener('click', async () => {
  const url = joinUrl();
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copy-link-btn');
    const old = btn.textContent;
    btn.textContent = '✅ Copié !';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch (e) {
    alert(url);
  }
});

// ---------------------------------------------------------------------
// Réception des évènements serveur
// ---------------------------------------------------------------------
socket.on('connect', () => {
  socket.emit('master:join', { code: ROOM_CODE });
});

socket.on('room:error', ({ message }) => {
  alert(message);
});

socket.on('game:state', state => {
  renderScoreboardFromScores(state.players);
  if (state.started) showLiveScreen(state);
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
  if (info.phase === 'bm-turn') txt = `⏳ <strong>${escapeHtml(info.bmName)}</strong> (Book-maker) rédige son indice...`;
  else if (info.phase === 'guessing') txt = `🤔 En attente des estimations : ${info.guessedCount}/${info.totalNeeded} joueurs ont validé.`;
  else if (info.phase === 'results') txt = `✅ Résultats de la manche disponibles.`;
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
// Lien d'invitation + QR code
// ---------------------------------------------------------------------
const isLocalHost = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(window.location.hostname);

function joinUrl() {
  // en local, "localhost" n'est pas joignable depuis un téléphone : on propose l'IP du réseau
  if (isLocalHost && lanUrls.length) return `${lanUrls[0]}/${ROOM_CODE}/rejoindre`;
  return `${window.location.origin}/${ROOM_CODE}/rejoindre`;
}

async function fetchServerInfo() {
  try {
    const res = await fetch('/api/server-info');
    const data = await res.json();
    lanUrls = data.lanUrls || [];
  } catch (e) { /* ignore */ }
}

let qrDrawnFor = null;
function drawQR() {
  const box = document.getElementById('qr-box');
  const url = joinUrl();
  document.getElementById('join-url-text').textContent = url;
  if (!box || qrDrawnFor === url || typeof QRCode === 'undefined') return;
  box.innerHTML = '';
  new QRCode(box, { text: url, width: 140, height: 140, colorDark: '#0d5c48', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  qrDrawnFor = url;
}

fetchServerInfo().then(drawQR);

// ---------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------
function showLiveScreen(state) {
  document.getElementById('config-screen').classList.add('hidden');
  document.getElementById('live-screen').classList.remove('hidden');
  document.getElementById('theme-display').textContent = state.theme;
  document.getElementById('target-display').textContent = state.targetScore;

  drawQR();
  renderPlayerLinks(state.players);
  renderScoreboardFromScores(state.players);
}

function renderPlayerLinks(players) {
  const linksContainer = document.getElementById('player-links');
  linksContainer.innerHTML = '';
  const origin = window.location.origin;
  players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'player-link-row';
    row.innerHTML = `
      <span><span class="status-dot ${p.connected ? 'on' : ''}"></span>${escapeHtml(p.name)}</span>
      <a href="${origin}/${ROOM_CODE}/${p.id}" target="_blank">${origin}/${ROOM_CODE}/${p.id}</a>
    `;
    linksContainer.appendChild(row);
  });
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
  if (document.getElementById('live-screen') && !document.getElementById('live-screen').classList.contains('hidden')) {
    renderPlayerLinks(players);
  }
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
