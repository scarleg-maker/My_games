const socket = io();

const waitingMsg = document.getElementById('waitingMsg');
const gameArea = document.getElementById('gameArea');
const identityBanner = document.getElementById('identityBanner');
const currentPlayerEl = document.getElementById('currentPlayer');
const messageBar = document.getElementById('messageBar');
const die1 = document.getElementById('die1');
const die2 = document.getElementById('die2');
const rollBtn = document.getElementById('rollBtn');
const boardGrid = document.getElementById('boardGrid');
const legend = document.getElementById('legend');
const winnerBanner = document.getElementById('winnerBanner');
const endButtons = document.getElementById('endButtons');
const restartBtn = document.getElementById('restartBtn');
const editBtn = document.getElementById('editBtn');
const otherPlayerLinks = document.getElementById('otherPlayerLinks');

let currentState = null;

// ---------- Identify which player this page belongs to ----------
const match = window.location.pathname.match(/^\/joueur([1-6])$/);
const myPlayerNum = match ? parseInt(match[1], 10) : null; // 1-based
const myPlayerIndex = myPlayerNum ? myPlayerNum - 1 : null; // 0-based

socket.on('connect', () => {
  if (myPlayerNum) socket.emit('identify', { playerNum: myPlayerNum });
});

// ---------- 3D dice ----------
function buildDie(container) {
  container.innerHTML = '';
  ['front', 'back', 'right', 'left', 'top', 'bottom'].forEach((face) => {
    const f = document.createElement('div');
    f.className = 'die-face ' + face;
    f.textContent = '?';
    container.appendChild(f);
  });
}
buildDie(die1);
buildDie(die2);

function setDieFaces(container, value) {
  container.querySelectorAll('.die-face').forEach((f) => {
    f.textContent = value;
  });
}

let spinIntervals = [];
function startSpin(container, faces) {
  if (container.dataset.spinning === '1') return;
  container.dataset.spinning = '1';
  container.classList.add('spinning');
  const interval = setInterval(() => {
    const v = 1 + Math.floor(Math.random() * faces);
    setDieFaces(container, v);
  }, 90);
  spinIntervals.push(interval);
}

function stopSpin(container, finalValue) {
  spinIntervals.forEach((i) => clearInterval(i));
  spinIntervals = [];
  container.dataset.spinning = '0';
  container.classList.remove('spinning');
  container.style.transform = 'rotateX(0deg) rotateY(0deg)';
  setDieFaces(container, finalValue);
}

// ---------- Rendering ----------
function playerColorClass(color) {
  return 'c-' + color;
}

function renderLegend(state) {
  legend.innerHTML = '';
  state.players.forEach((p, idx) => {
    const item = document.createElement('div');
    item.className = 'legend-item' + (idx === state.currentPlayerIndex && state.status === 'playing' ? ' active' : '');
    const sw = document.createElement('div');
    sw.className = 'swatch ' + playerColorClass(p.color);
    item.appendChild(sw);
    const txt = document.createElement('span');
    txt.textContent = p.name + (idx === myPlayerIndex ? ' (vous)' : '');
    item.appendChild(txt);
    legend.appendChild(item);
  });
}

// Determine, among the rolled options, which cells the current player is
// actually allowed to click: their own already-placed healthy pawn is
// excluded unless there is no other option available.
function computeSelectable(state) {
  if (!state.pendingRoll || !state.pendingRoll.resolved) return [];
  const current = state.players[state.currentPlayerIndex];
  const isOwnHealthy = (opt) => {
    const cd = state.board[opt.row - 1][opt.col - 1];
    return !!cd.color && cd.ownerId === current.id && !cd.damaged;
  };
  const options = state.pendingRoll.options;
  const free = options.filter((o) => !isOwnHealthy(o));
  return free.length > 0 ? free : options; // if no alternative, allow the forced choice
}

function renderBoard(state) {
  const size = state.boardSize;
  boardGrid.style.gridTemplateColumns = `44px repeat(${size}, 60px)`;

  boardGrid.innerHTML = '';

  const corner = document.createElement('div');
  corner.className = 'head-cell';
  boardGrid.appendChild(corner);

  for (let c = 1; c <= size; c++) {
    const head = document.createElement('div');
    head.className = 'head-cell';
    head.textContent = c;
    boardGrid.appendChild(head);
  }

  const isMyTurn = state.status === 'playing' && myPlayerIndex === state.currentPlayerIndex;
  const selectable = isMyTurn ? computeSelectable(state) : [];
  const selectableSet = new Set(selectable.map((o) => `${o.row}-${o.col}`));

  const winSet = new Set();
  if (state.winningCells) {
    state.winningCells.forEach((wc) => winSet.add(`${wc.row}-${wc.col}`));
  }

  for (let r = 1; r <= size; r++) {
    const head = document.createElement('div');
    head.className = 'head-cell';
    head.textContent = r;
    boardGrid.appendChild(head);

    for (let c = 1; c <= size; c++) {
      const cellData = state.board[r - 1][c - 1];
      const cellEl = document.createElement('div');
      cellEl.className = 'cell';
      const key = `${r}-${c}`;
      if (selectableSet.has(key)) {
        cellEl.classList.add('selectable');
        cellEl.addEventListener('click', () => {
          socket.emit('game:place', { row: r, col: c });
        });
      }
      if (winSet.has(key)) {
        cellEl.classList.add('win-cell');
      }
      if (cellData.color) {
        const pawn = document.createElement('div');
        pawn.className = 'pawn ' + playerColorClass(cellData.color) + (cellData.damaged ? ' damaged' : '');
        cellEl.appendChild(pawn);
      }
      boardGrid.appendChild(cellEl);
    }
  }
}

function renderOtherLinks(state) {
  otherPlayerLinks.innerHTML = '';
  const others = state.players.filter((p, idx) => idx !== myPlayerIndex);
  if (others.length === 0) return;
  const label = document.createElement('div');
  label.style.cssText = 'width:100%;text-align:center;opacity:0.75;font-size:13px;margin-top:8px;';
  label.textContent = 'Autres écrans joueurs :';
  otherPlayerLinks.appendChild(label);
  state.players.forEach((p, idx) => {
    if (idx === myPlayerIndex) return;
    const a = document.createElement('a');
    a.className = 'player-link';
    a.href = `/joueur${idx + 1}`;
    a.target = '_blank';
    a.rel = 'noopener';
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = colorAlpha(p.color).replace('0.5', '1');
    a.appendChild(sw);
    const txt = document.createElement('span');
    txt.textContent = `/joueur${idx + 1} — ${p.name}`;
    a.appendChild(txt);
    otherPlayerLinks.appendChild(a);
  });
}

function renderState(state) {
  const previous = currentState;
  currentState = state;
  if (!state) {
    waitingMsg.style.display = 'block';
    gameArea.style.display = 'none';
    return;
  }
  waitingMsg.style.display = 'none';
  gameArea.style.display = 'block';

  // Identity banner
  if (myPlayerIndex !== null && myPlayerIndex < state.players.length) {
    const me = state.players[myPlayerIndex];
    identityBanner.textContent = `Vous êtes : ${me.name} (${me.color})`;
    identityBanner.className = 'identity-banner ' + playerColorClass(me.color);
  } else if (myPlayerIndex !== null) {
    identityBanner.textContent = `/joueur${myPlayerNum} — aucun joueur ${myPlayerNum} dans cette partie (spectateur)`;
    identityBanner.className = 'identity-banner spectator';
  } else {
    identityBanner.textContent = 'Mode spectateur (ouvrez /joueur1, /joueur2, ... pour jouer)';
    identityBanner.className = 'identity-banner spectator';
  }

  renderBoard(state);
  renderLegend(state);
  renderOtherLinks(state);

  messageBar.textContent = state.lastMessage || '';

  const size = state.boardSize;
  const hasPending = !!state.pendingRoll;
  const wasPendingUnresolved = previous && previous.pendingRoll && !previous.pendingRoll.resolved;

  if (state.status === 'finished') {
    currentPlayerEl.style.display = 'none';
    rollBtn.style.display = 'none';
    winnerBanner.style.display = 'block';
    winnerBanner.textContent = `🏆 ${state.winner} remporte la partie !`;
    endButtons.style.display = 'flex';
    spinIntervals.forEach((i) => clearInterval(i));
    spinIntervals = [];
  } else {
    currentPlayerEl.style.display = 'inline-block';
    rollBtn.style.display = 'inline-block';
    winnerBanner.style.display = 'none';
    endButtons.style.display = 'none';

    const current = state.players[state.currentPlayerIndex];
    const isMyTurn = myPlayerIndex === state.currentPlayerIndex;
    currentPlayerEl.textContent = `Au tour de : ${current.name} (${current.color})` + (isMyTurn ? ' — à vous de jouer !' : '');
    currentPlayerEl.style.background = colorAlpha(current.color);

    rollBtn.disabled = hasPending || !isMyTurn;
    rollBtn.textContent = isMyTurn ? '🎲 Lancer les dés' : ('🎲 En attente de ' + current.name + '...');

    if (!hasPending) {
      if (spinIntervals.length) { spinIntervals.forEach((i) => clearInterval(i)); spinIntervals = []; }
      die1.dataset.spinning = '0';
      die2.dataset.spinning = '0';
      die1.classList.remove('spinning');
      die2.classList.remove('spinning');
      setDieFaces(die1, '?');
      setDieFaces(die2, '?');
    } else if (!state.pendingRoll.resolved) {
      if (!wasPendingUnresolved) {
        startSpin(die1, size);
        startSpin(die2, size);
      }
    } else {
      stopSpin(die1, state.pendingRoll.d1);
      stopSpin(die2, state.pendingRoll.d2);
    }
  }
}

function colorAlpha(color) {
  const map = {
    bleu: 'rgba(37,99,235,0.5)', rouge: 'rgba(220,38,38,0.5)', jaune: 'rgba(234,179,8,0.5)',
    vert: 'rgba(22,163,74,0.5)', orange: 'rgba(249,115,22,0.5)', violet: 'rgba(126,34,206,0.5)',
    rose: 'rgba(236,72,153,0.5)', marron: 'rgba(120,53,15,0.5)', noir: 'rgba(17,24,39,0.5)',
    blanc: 'rgba(249,250,251,0.5)'
  };
  return map[color] || 'rgba(255,255,255,0.15)';
}

rollBtn.addEventListener('click', () => {
  if (rollBtn.disabled) return;
  socket.emit('game:roll');
});

restartBtn.addEventListener('click', () => {
  socket.emit('game:reset');
});

editBtn.addEventListener('click', () => {
  socket.emit('game:edit');
  window.location.href = '/';
});

socket.on('state', (state) => {
  renderState(state);
});

socket.on('game:rolling', ({ faces }) => {
  if (!currentState) return;
  startSpin(die1, faces);
  startSpin(die2, faces);
});
