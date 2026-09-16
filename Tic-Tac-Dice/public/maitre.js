const COLORS = ['bleu', 'rouge', 'jaune', 'vert', 'orange', 'violet', 'rose', 'marron', 'noir', 'blanc'];

const socket = io();

const nbJoueursSel = document.getElementById('nbJoueurs');
const playersList = document.getElementById('playersList');
const boardSizeGroup = document.getElementById('boardSizeGroup');
const winLengthGroup = document.getElementById('winLengthGroup');
const errorMsg = document.getElementById('errorMsg');
const startBtn = document.getElementById('startBtn');
const playerLinksEl = document.getElementById('playerLinks');
const warningBox = document.getElementById('warningBox');
const forceBtn = document.getElementById('forceBtn');
const aiControlPanel = document.getElementById('aiControlPanel');
const aiControlList = document.getElementById('aiControlList');

let gameInProgress = false;
let forceOverride = false;

function updateStartAvailability() {
  if (gameInProgress && !forceOverride) {
    startBtn.disabled = true;
    startBtn.textContent = '⏳ Partie en cours...';
    warningBox.style.display = 'block';
  } else {
    startBtn.disabled = false;
    startBtn.textContent = '▶ Démarrer la partie';
    warningBox.style.display = 'none';
  }
}

forceBtn.addEventListener('click', () => {
  forceOverride = true;
  updateStartAvailability();
});

let playersData = []; // {name, color}

function defaultPlayers(n, keepExisting) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    if (keepExisting && playersData[i]) {
      arr.push(playersData[i]);
    } else {
      arr.push({ name: `Joueur ${i + 1}`, color: COLORS[i % COLORS.length], isAI: false });
    }
  }
  playersData = arr;
}

function renderPlayers() {
  playersList.innerHTML = '';
  playersData.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'player-row';

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = colorToHex(p.color);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = p.name;
    nameInput.placeholder = `Nom du joueur ${idx + 1}`;
    nameInput.addEventListener('input', () => {
      playersData[idx].name = nameInput.value;
      renderPlayerLinks();
    });

    const colorSelect = document.createElement('select');
    COLORS.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
      const usedElsewhere = playersData.some((pp, i2) => i2 !== idx && pp.color === c);
      if (usedElsewhere) opt.disabled = true;
      if (c === p.color) opt.selected = true;
      colorSelect.appendChild(opt);
    });
    colorSelect.addEventListener('change', () => {
      playersData[idx].color = colorSelect.value;
      swatch.style.background = colorToHex(colorSelect.value);
      renderPlayers();
    });

    row.appendChild(swatch);
    row.appendChild(nameInput);
    row.appendChild(colorSelect);

    const aiToggle = document.createElement('label');
    aiToggle.className = 'ai-toggle' + (idx === 0 ? ' locked' : '');
    const aiCheckbox = document.createElement('input');
    aiCheckbox.type = 'checkbox';
    aiCheckbox.checked = !!p.isAI && idx !== 0;
    aiCheckbox.disabled = idx === 0;
    aiCheckbox.addEventListener('change', () => {
      playersData[idx].isAI = aiCheckbox.checked;
    });
    aiToggle.appendChild(aiCheckbox);
    aiToggle.appendChild(document.createTextNode(idx === 0 ? 'Humain' : '🤖 IA'));
    row.appendChild(aiToggle);

    playersList.appendChild(row);
  });
  renderPlayerLinks();
}

function colorToHex(name) {
  const map = {
    bleu: '#2563eb', rouge: '#dc2626', jaune: '#eab308', vert: '#16a34a',
    orange: '#f97316', violet: '#7e22ce', rose: '#ec4899', marron: '#78350f',
    noir: '#111827', blanc: '#f9fafb'
  };
  return map[name] || '#999';
}

function renderAiControlPanel(state) {
  if (!state || state.status !== 'playing') {
    aiControlPanel.style.display = 'none';
    aiControlList.innerHTML = '';
    return;
  }
  aiControlPanel.style.display = 'block';
  aiControlList.innerHTML = '';
  state.players.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'ai-control-row' + (idx === 0 ? ' locked' : '');

    const info = document.createElement('div');
    info.className = 'player-info';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colorToHex(p.color);
    info.appendChild(sw);
    info.appendChild(document.createTextNode(p.name + (idx === state.currentPlayerIndex ? ' (tour actuel)' : '')));
    row.appendChild(info);

    const badge = document.createElement('span');
    badge.className = 'mode-badge' + (p.isAI ? ' is-ai' : '');
    badge.textContent = p.isAI ? '🤖 IA' : '🧑 Humain';
    row.appendChild(badge);

    const btn = document.createElement('button');
    btn.className = 'toggle-btn';
    btn.type = 'button';
    btn.textContent = p.isAI ? 'Repasser en humain' : 'Passer en IA';
    btn.addEventListener('click', () => {
      const question = p.isAI
        ? `Confirmer : ${p.name} redevient un joueur humain ?`
        : `Confirmer : ${p.name} sera désormais contrôlé par l'IA (intelligence modérée) ?`;
      if (window.confirm(question)) {
        socket.emit('game:setPlayerAI', { playerIndex: idx, isAI: !p.isAI });
      }
    });
    row.appendChild(btn);

    aiControlList.appendChild(row);
  });
}

function renderPlayerLinks() {
  playerLinksEl.innerHTML = '';
  playersData.forEach((p, idx) => {
    const num = idx + 1;
    const a = document.createElement('a');
    a.className = 'player-link';
    a.href = `/joueur${num}`;
    a.target = '_blank';
    a.rel = 'noopener';

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colorToHex(p.color);
    a.appendChild(sw);

    const txt = document.createElement('span');
    txt.textContent = `/joueur${num} — ${p.name || 'Joueur ' + num}`;
    a.appendChild(txt);

    playerLinksEl.appendChild(a);
  });
}

nbJoueursSel.addEventListener('change', () => {
  defaultPlayers(parseInt(nbJoueursSel.value, 10), true);
  renderPlayers();
});

function updateForbiddenCombo() {
  const boardSize = parseInt(document.querySelector('input[name="boardSize"]:checked').value, 10);
  const winInputs = winLengthGroup.querySelectorAll('input[name="winLength"]');
  winInputs.forEach((inp) => {
    const label = inp.closest('label');
    const forbidden = boardSize === 6 && inp.value === '4';
    label.classList.toggle('disabled', forbidden);
    inp.disabled = forbidden;
    if (forbidden && inp.checked) {
      inp.checked = false;
      winLengthGroup.querySelector('input[value="3"]').checked = true;
    }
  });
}

boardSizeGroup.addEventListener('change', updateForbiddenCombo);

function validate() {
  const n = playersData.length;
  if (n < 2 || n > 10) return 'Le nombre de joueurs doit être entre 2 et 10.';
  for (const p of playersData) {
    if (!p.name || !p.name.trim()) return 'Chaque joueur doit avoir un nom.';
  }
  const colors = playersData.map((p) => p.color);
  if (new Set(colors).size !== colors.length) return 'Chaque joueur doit avoir une couleur différente.';
  const boardSize = parseInt(document.querySelector('input[name="boardSize"]:checked').value, 10);
  const winLength = parseInt(document.querySelector('input[name="winLength"]:checked').value, 10);
  if (boardSize === 6 && winLength === 4) return 'La combinaison plateau 6x6 + 4 alignés est interdite.';
  return null;
}

startBtn.addEventListener('click', () => {
  const err = validate();
  if (err) {
    errorMsg.textContent = err;
    errorMsg.style.display = 'block';
    return;
  }
  errorMsg.style.display = 'none';
  const boardSize = parseInt(document.querySelector('input[name="boardSize"]:checked').value, 10);
  const winLength = parseInt(document.querySelector('input[name="winLength"]:checked').value, 10);
  socket.emit('setup:start', {
    players: playersData.map((p, idx) => ({ name: p.name.trim(), color: p.color, isAI: idx === 0 ? false : !!p.isAI })),
    boardSize,
    winLength
  });
  startBtn.textContent = 'Partie démarrée ✔ — ouvrez /joueur1';
  startBtn.disabled = true;
  forceOverride = false;
  setTimeout(() => { updateStartAvailability(); }, 2500);
});

socket.on('state', (state) => {
  gameInProgress = !!(state && state.status === 'playing');
  updateStartAvailability();
  renderAiControlPanel(state);
});

socket.on('setup:config', (config) => {
  if (!config) return;
  nbJoueursSel.value = String(config.players.length);
  playersData = config.players.map((p) => ({ name: p.name, color: p.color, isAI: !!p.isAI }));
  renderPlayers();
  document.querySelector(`input[name="boardSize"][value="${config.boardSize}"]`).checked = true;
  updateForbiddenCombo();
  document.querySelector(`input[name="winLength"][value="${config.winLength}"]`).checked = true;
});

// init
defaultPlayers(parseInt(nbJoueursSel.value, 10), false);
renderPlayers();
updateForbiddenCombo();
socket.emit('setup:getConfig');
