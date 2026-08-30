const socket = io();

const playerId = location.pathname.split('/').filter(Boolean).pop(); // ex: "01"
let myName = '';
let myHand = [];
let families = [];
let allPlayers = [];
let currentPlayerId = null;
let requestContext = null;
let isMyTurn = false;
let iAmRequested = false;

socket.emit('player-join', { playerId });

socket.on('your-info', (data) => {
  const {
    name, started, exists, players, families: fams, currentPlayerId: cur,
    completedFamilies, requestContext: ctx, ready, handRevealed, hand,
  } = data;

  if (!exists) {
    document.getElementById('playerTitle').textContent = '⚠️ Joueur inconnu';
    document.getElementById('waitingBox').innerHTML =
      '<p>Ce joueur n\'existe pas encore. Vérifiez le lien ou attendez que le maître configure les joueurs.</p>';
    return;
  }

  myName = name;
  document.getElementById('playerTitle').textContent = `🎴 ${name} (Joueur ${playerId})`;

  if (players && players.length) allPlayers = players;
  if (fams && fams.length) families = fams;
  if (completedFamilies) renderCompletedFamilies(completedFamilies);

  if (!started) return;

  document.getElementById('waitingBox').classList.add('hidden');

  if (handRevealed) {
    // Reconnexion en cours de partie : la main a déjà été distribuée/vue
    myHand = hand || [];
    document.getElementById('dealBox').classList.add('hidden');
    document.getElementById('readyBox').classList.add('hidden');
    renderHand();
    checkFamilyClaims();
  } else {
    document.getElementById('dealBox').classList.remove('hidden');
  }

  if (cur) {
    currentPlayerId = cur;
    isMyTurn = (cur === playerId);
    document.getElementById('gameArea').classList.remove('hidden');
    renderTurnBanner();
    renderOpponentGrid();
  }

  if (ctx) {
    requestContext = ctx;
    iAmRequested = (ctx.toId === playerId);
    document.getElementById('requestedBanner').classList.toggle('hidden', !iAmRequested);
    renderHand();
  }
});

socket.on('game-started', ({ players }) => {
  allPlayers = players;
  document.getElementById('waitingBox').classList.add('hidden');
  document.getElementById('dealBox').classList.remove('hidden');
});

document.getElementById('dealBtn').addEventListener('click', () => {
  socket.emit('request-hand');
  document.getElementById('dealBox').classList.add('hidden');
  document.getElementById('readyBox').classList.remove('hidden');
});

document.getElementById('readyBtn').addEventListener('click', () => {
  socket.emit('player-ready');
  document.getElementById('readyBtn').disabled = true;
  document.getElementById('readyStatus').textContent = 'En attente des autres joueurs...';
});

socket.on('your-hand', ({ hand, families: fams }) => {
  myHand = hand;
  families = fams;
  renderHand();
  checkFamilyClaims();
});

socket.on('card-received', ({ card, fromName }) => {
  const toast = document.createElement('div');
  // simple visual feedback via turnBanner text momentarily
  const banner = document.getElementById('turnBanner');
  const old = banner.textContent;
  banner.textContent = `✅ Carte reçue de ${fromName} : ${card.number}-${card.name}`;
  setTimeout(() => { renderTurnBanner(); }, 2500);
});

socket.on('turn-changed', ({ currentPlayerId: cur, order }) => {
  currentPlayerId = cur;
  requestContext = null;
  iAmRequested = false;
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('readyBox').classList.add('hidden');
  isMyTurn = (cur === playerId);
  renderTurnBanner();
  renderOpponentGrid();
  document.getElementById('requestedBanner').classList.add('hidden');
});

socket.on('request-context-update', (ctx) => {
  requestContext = ctx;
  iAmRequested = !!(ctx && ctx.toId === playerId);
  document.getElementById('requestedBanner').classList.toggle('hidden', !iAmRequested);
  renderHand();
});

document.getElementById('piocheBtn').addEventListener('click', () => {
  socket.emit('draw-pioche');
});

socket.on('pioche-empty', () => {
  alert('La pioche est vide.');
});

socket.on('card-drawn', ({ card }) => {
  const box = document.getElementById('drawnCardBox');
  box.innerHTML = '';
  box.appendChild(buildCardEl(card, false));
  document.getElementById('drawModal').classList.remove('hidden');
});

document.getElementById('drawCorrectBtn').addEventListener('click', () => {
  document.getElementById('drawModal').classList.add('hidden');
  socket.emit('draw-result', { correct: true });
});
document.getElementById('drawWrongBtn').addEventListener('click', () => {
  document.getElementById('drawModal').classList.add('hidden');
  socket.emit('draw-result', { correct: false });
});

socket.on('family-completed', ({ family, ownerName, completed }) => {
  renderCompletedFamilies(completed);
  checkFamilyClaims();
});

socket.on('game-over', ({ winner, standings }) => {
  const modal = document.getElementById('gameOverModal');
  const text = document.getElementById('gameOverText');
  const lines = standings.map(s => `${s.name} — ${s.count} famille(s)`).join('<br>');
  text.innerHTML = `<strong>Gagnant : ${winner}</strong><br><br>${lines}`;
  modal.classList.remove('hidden');
});

// ---------- Rendering ----------

function renderTurnBanner() {
  const banner = document.getElementById('turnBanner');
  const myTurnControls = document.getElementById('myTurnControls');
  if (isMyTurn) {
    banner.textContent = "🎯 C'est votre tour ! Choisissez un adversaire.";
    banner.className = 'turn-banner my-turn';
    myTurnControls.classList.remove('hidden');
  } else {
    const curName = (allPlayers.find(p => p.id === currentPlayerId) || {}).name || currentPlayerId;
    banner.textContent = `En attente : c'est au tour de ${curName}.`;
    banner.className = 'turn-banner';
    myTurnControls.classList.add('hidden');
  }
}

function renderOpponentGrid() {
  const grid = document.getElementById('opponentGrid');
  grid.innerHTML = '';
  allPlayers.filter(p => p.id !== playerId).forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'opponent-btn';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      socket.emit('select-opponent', { opponentId: p.id });
    });
    grid.appendChild(btn);
  });
}

function buildCardEl(card, clickable) {
  const fam = families.find(f => f.name === card.family) || { color: '#999' };
  const div = document.createElement('div');
  div.className = 'card' + (clickable ? ' clickable' : '');
  div.style.borderColor = fam.color;
  div.innerHTML = `
    <img src="${card.file}" alt="${card.name}">
    <div class="card-label">${card.number}-${card.name}</div>
  `;
  return div;
}

function renderHand() {
  const grid = document.getElementById('handGrid');
  grid.innerHTML = '';
  document.getElementById('handCount').textContent = myHand.length;

  const famIndex = {};
  families.forEach((f, i) => { famIndex[f.name] = i; });
  const sortedHand = [...myHand].sort((a, b) => {
    const ia = famIndex[a.family] !== undefined ? famIndex[a.family] : 999;
    const ib = famIndex[b.family] !== undefined ? famIndex[b.family] : 999;
    if (ia !== ib) return ia - ib;
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.number.localeCompare(b.number, undefined, { numeric: true });
  });

  sortedHand.forEach(card => {
    const clickable = iAmRequested;
    const el = buildCardEl(card, clickable);
    if (clickable) {
      el.addEventListener('click', () => {
        socket.emit('give-card', { cardId: card.id });
      });
    }
    grid.appendChild(el);
  });

  renderFamilySummary();
}

function renderFamilySummary() {
  const box = document.getElementById('handFamiliesSummary');
  if (!box) return;
  const counts = {};
  myHand.forEach(c => { counts[c.family] = (counts[c.family] || 0) + 1; });
  box.innerHTML = '';
  families
    .filter(f => counts[f.name] > 0)
    .forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'family-chip';
      chip.style.background = f.color;
      chip.textContent = `${f.name} (${counts[f.name]})`;
      box.appendChild(chip);
    });
}

function checkFamilyClaims() {
  const counts = {};
  myHand.forEach(c => { counts[c.family] = (counts[c.family] || 0) + 1; });
  const eligible = Object.keys(counts).filter(f => counts[f] >= 6);
  const box = document.getElementById('familyClaimBox');
  const row = document.getElementById('familyBtnRow');
  row.innerHTML = '';
  if (eligible.length === 0) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  eligible.forEach(famName => {
    const fam = families.find(f => f.name === famName) || { color: '#999' };
    const btn = document.createElement('button');
    btn.textContent = `🎉 Famille ${famName}`;
    btn.style.background = fam.color;
    btn.addEventListener('click', () => {
      socket.emit('claim-family', { family: famName });
    });
    row.appendChild(btn);
  });
}

function renderCompletedFamilies(completed) {
  const box = document.getElementById('completedFamiliesPlayer');
  box.innerHTML = '';
  completed.forEach(cf => {
    const fam = families.find(f => f.name === cf.family) || { color: '#999' };
    const chip = document.createElement('span');
    chip.className = 'family-chip';
    chip.style.background = fam.color;
    chip.textContent = `${cf.family} → ${cf.ownerName}`;
    box.appendChild(chip);
  });
}
