const socket = io();
socket.on('connect', () => socket.emit('register', { role: 'master' }));

const namesContainer = document.getElementById('namesContainer');
const numPlayersInput = document.getElementById('numPlayers');
const setupPanel = document.getElementById('setupPanel');
const gamePanel = document.getElementById('gamePanel');
const setupError = document.getElementById('setupError');

let savedNames = [];
let lastNames = [];

function renderNameInputs() {
  const n = parseInt(numPlayersInput.value, 10) || 2;
  namesContainer.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const div = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `Nom du joueur ${i + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'name' + i;
    input.setAttribute('list', 'namesHistory');
    input.value = lastNames[i] || '';
    div.appendChild(label);
    div.appendChild(input);
    namesContainer.appendChild(div);
  }
  if (!document.getElementById('namesHistory')) {
    const dl = document.createElement('datalist');
    dl.id = 'namesHistory';
    document.body.appendChild(dl);
  }
  const dl = document.getElementById('namesHistory');
  dl.innerHTML = savedNames.map(n2 => `<option value="${n2}">`).join('');
}

numPlayersInput.addEventListener('input', renderNameInputs);

fetch('/api/init-data').then(r => r.json()).then(data => {
  savedNames = data.allNamesEver || [];
  lastNames = data.lastNames || [];
  if (lastNames.length >= 2) numPlayersInput.value = lastNames.length;
  renderNameInputs();
});

document.getElementById('uploadBtn').addEventListener('click', () => {
  const fileInput = document.getElementById('zipFile');
  const status = document.getElementById('uploadStatus');
  if (!fileInput.files.length) { status.textContent = 'Sélectionnez un fichier ZIP.'; return; }
  const fd = new FormData();
  fd.append('zipfile', fileInput.files[0]);
  status.textContent = 'Chargement...';
  fetch('/api/upload-zip', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.error) { status.textContent = '❌ ' + data.error; return; }
      status.textContent = `✅ ${data.count} images chargées dans l'archive.`;
    })
    .catch(() => status.textContent = '❌ Erreur réseau.');
});

document.getElementById('startBtn').addEventListener('click', () => {
  const n = parseInt(numPlayersInput.value, 10);
  const names = [];
  for (let i = 0; i < n; i++) {
    const v = document.getElementById('name' + i).value.trim();
    names.push(v || `Joueur ${i + 1}`);
  }
  const body = {
    names,
    numImages: document.getElementById('numImages').value,
    maxCards: document.getElementById('maxCards').value,
    numBombs: document.getElementById('numBombs').value,
    intouchable: document.getElementById('ruleIntouchable').checked,
    multiboom: document.getElementById('ruleMultiboom').checked,
  };
  setupError.textContent = '';
  fetch('/api/start-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()).then(data => {
    if (data.error) { setupError.textContent = '❌ ' + data.error; return; }
    setupPanel.style.display = 'none';
    gamePanel.style.display = 'block';
  }).catch(() => setupError.textContent = '❌ Erreur réseau.');
});

document.getElementById('newRoundBtn').addEventListener('click', () => {
  socket.emit('newRound');
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Repartir sur une nouvelle configuration complète ?')) {
    socket.emit('resetGame');
    setupPanel.style.display = 'block';
    gamePanel.style.display = 'none';
    fetch('/api/init-data').then(r => r.json()).then(data => {
      savedNames = data.allNamesEver || [];
      lastNames = data.lastNames || [];
      renderNameInputs();
    });
  }
});

const PLAYER_COLORS = ['#ff4d4d', '#4da6ff', '#4dff88', '#ffd24d', '#c94dff', '#ff944d', '#4dffea', '#ff4dc4'];
function colorFor(idx) { return PLAYER_COLORS[idx % PLAYER_COLORS.length]; }
function colorDot(idx) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorFor(idx)};margin-right:5px;vertical-align:middle;"></span>`;
}

function phaseLabelText(phase) {
  return {
    placement: 'Pose des bombes',
    draw: 'Tirage des cartes',
    roundEnd: 'Fin de manche',
    gameEnd: 'Partie terminée',
  }[phase] || phase;
}

socket.on('state', (state) => {
  if (!state.started) {
    setupPanel.style.display = 'block';
    gamePanel.style.display = 'none';
    return;
  }
  setupPanel.style.display = 'none';
  gamePanel.style.display = 'block';

  document.getElementById('roundNum').textContent = state.roundNumber;
  document.getElementById('phaseLabel').textContent = phaseLabelText(state.phase);

  const rules = [];
  if (state.config.intouchable) rules.push('🛡️ Intouchable activée (victoire immédiate si équipe complète en premier)');
  if (state.config.multiboom) rules.push('💥 Multi-boom activée (élimination si 0 image restante après une case à 2+ bombes)');
  document.getElementById('activeRules').textContent = rules.join(' — ');

  // liens joueurs
  const linksDiv = document.getElementById('playerLinks');
  linksDiv.innerHTML = state.players.map(p =>
    `<a href="/joueur${p.index + 1}" target="_blank">${colorDot(p.index)}${p.name} → /joueur${p.index + 1}${p.eliminated ? ' (éliminé)' : ''}</a>`
  ).join('');

  // plateau (vue arbitre : bombes visibles avec couleur par joueur)
  const board = document.getElementById('masterBoard');
  board.style.gridTemplateColumns = `repeat(${state.gridCols}, 1fr)`;
  board.innerHTML = state.board.map(c => {
    let cls = 'cell';
    if (c.taken) cls += c.isBomb ? ' taken taken-bomb' : ' taken taken-safe';
    const dots = (c.bombs || []).map(pIdx => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${colorFor(pIdx)};border:1px solid #000;margin:1px;"></span>`).join('');
    const dotsWrap = dots ? `<div style="position:absolute;top:2px;left:2px;display:flex;flex-wrap:wrap;max-width:60%;">${dots}</div>` : '';
    const bombIcon = c.taken && c.isBomb ? `<div class="bomb-icon" style="left:auto;right:2px;top:20px;">💣${c.bombs.length > 1 ? 'x' + c.bombs.length : ''}</div>` : '';
    const takenLabel = c.taken ? `<div class="fname">→ ${state.players[c.takenBy] ? state.players[c.takenBy].name : ''}</div>` : `<div class="fname">${c.filename}</div>`;
    return `<div class="${cls}">
      <img src="/images_pool/${encodeURIComponent(c.filename)}" loading="lazy">
      ${dotsWrap}${bombIcon}
      ${takenLabel}
    </div>`;
  }).join('');

  // colonnes joueurs
  const columns = document.getElementById('columns');
  columns.innerHTML = state.players.map(p => {
    const cards = p.drawnCards.map(c =>
      `<div class="card-thumb ${c.lost ? 'lost' : ''}"><img src="/images_pool/${encodeURIComponent(c.filename)}"></div>`
    ).join('');
    const bombInfo = state.phase === 'placement'
      ? `<div class="status-line">Bombes restantes : ${p.bombsRemaining} ${p.ready ? '✅ Validé' : ''}</div>`
      : '';
    const turnMark = state.currentPlayer === p.index ? ' ⬅ à son tour' : '';
    return `<div class="player-column ${p.eliminated ? 'eliminated' : ''}">
      <h4>${colorDot(p.index)}${p.name}${turnMark}</h4>
      <div class="status-line">${p.safeCount}/${state.config.maxCards} images ${p.complete ? '🏆' : ''}${p.eliminated ? ' ☠️ éliminé' : ''}</div>
      ${bombInfo}
      <div class="cards-grid">${cards}</div>
    </div>`;
  }).join('');

  // fin de manche
  const roundEndPanel = document.getElementById('roundEndPanel');
  const winnerPanel = document.getElementById('winnerPanel');
  if (state.phase === 'roundEnd') {
    roundEndPanel.style.display = 'block';
    winnerPanel.style.display = 'none';
    const controls = document.getElementById('eliminationControls');
    controls.innerHTML = state.players.filter(p => !p.eliminated).map(p =>
      `<button class="danger" data-idx="${p.index}" onclick="eliminatePlayer(${p.index})">Éliminer ${p.name} (${p.safeCount}/${state.config.maxCards})</button>`
    ).join('') + state.players.filter(p => p.eliminated).map(p =>
      `<button class="secondary" onclick="restorePlayer(${p.index})">Ré-inclure ${p.name}</button>`
    ).join('');
  } else if (state.phase === 'gameEnd') {
    roundEndPanel.style.display = 'none';
    winnerPanel.style.display = 'block';
    document.getElementById('winnerText').textContent = state.winner
      ? `🏆 Victoire de ${state.winner} !`
      : `Partie terminée.`;
  } else {
    roundEndPanel.style.display = 'none';
    winnerPanel.style.display = 'none';
  }

  // overlay de révélation (visible aussi côté arbitre)
  const revealOverlay = document.getElementById('revealOverlay');
  if (state.lastReveal) {
    const r = state.lastReveal;
    const resultClass = r.isBomb ? 'bomb' : 'safe';
    const resultText = r.isBomb
      ? `💣 Piégée${r.bombCount > 1 ? ' x' + r.bombCount : ''}`
      : '👍 Sûre';
    document.getElementById('revealBox').innerHTML = `
      <img src="/images_pool/${encodeURIComponent(r.filename)}">
      <div class="reveal-player">${r.playerName} a tiré :</div>
      <div class="reveal-result ${resultClass}">${resultText}</div>
    `;
    revealOverlay.style.display = 'flex';
  } else {
    revealOverlay.style.display = 'none';
  }
});

function eliminatePlayer(index) { socket.emit('eliminatePlayer', { index }); }
function restorePlayer(index) { socket.emit('restorePlayer', { index }); }
