const match = location.pathname.match(/^\/([A-Za-z0-9]{3,10})\/joueur(\d+)/);
const ROOM_CODE = match ? match[1].toUpperCase() : null;
const playerIndex = match ? match[2] : null;
const api = (p) => `/api/${ROOM_CODE}${p}`;

const waitingPanel = document.getElementById('waiting-panel');
const playPanel = document.getElementById('play-panel');
const gameoverPanel = document.getElementById('gameover-panel');

const roomPill = document.getElementById('room-pill');
if (roomPill && ROOM_CODE) roomPill.textContent = `Salon ${ROOM_CODE}`;

async function refreshState() {
  if (!playerIndex || !ROOM_CODE) return;
  let state;
  try {
    const res = await fetch(api(`/state/${playerIndex}`));
    if (res.status === 404) {
      document.getElementById('player-name').textContent = 'Salon introuvable';
      document.getElementById('status-pill').textContent = 'Ce salon n\'existe pas ou plus.';
      waitingPanel.classList.remove('hidden');
      waitingPanel.innerHTML = `<p>Ce salon n'existe plus. <a href="/">Retourner à l'accueil</a>.</p>`;
      playPanel.classList.add('hidden');
      gameoverPanel.classList.add('hidden');
      return;
    }
    state = await res.json();
  } catch (e) {
    return;
  }
  if (!state.configured) {
    document.getElementById('player-name').textContent = 'En attente...';
    document.getElementById('status-pill').textContent = "Le maître du jeu n'a pas encore lancé la partie.";
    waitingPanel.classList.remove('hidden');
    playPanel.classList.add('hidden');
    gameoverPanel.classList.add('hidden');
    return;
  }

  document.getElementById('player-name').textContent = state.yourName;
  document.getElementById('theme-line').textContent = state.theme ? `Thème : ${state.theme}` : 'Table de jeu';

  const statusLabels = {
    ready: 'En attente du premier tour',
    playing: `Tour ${state.round} / ${state.totalRounds}`,
    'round-end': `Tour ${state.round} terminé — en attente du tour suivant`,
    'game-over': 'Partie terminée'
  };
  document.getElementById('status-pill').textContent = statusLabels[state.status] || state.status;

  if (state.status === 'game-over') {
    waitingPanel.classList.add('hidden');
    playPanel.classList.add('hidden');
    gameoverPanel.classList.remove('hidden');
    const sorted = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
    document.getElementById('final-scores').innerHTML = `
      <table class="scores">
        <tr><th>Classement</th><th>Joueur</th><th>Score</th></tr>
        ${sorted.map(([name, score], i) => `<tr><td>${i + 1}</td><td class="name">${name}${name === state.yourName ? ' (vous)' : ''}</td><td>${score}</td></tr>`).join('')}
      </table>
    `;
    return;
  }

  if (state.status === 'ready') {
    waitingPanel.classList.remove('hidden');
    playPanel.classList.add('hidden');
    gameoverPanel.classList.add('hidden');
    return;
  }

  waitingPanel.classList.add('hidden');
  gameoverPanel.classList.add('hidden');
  playPanel.classList.remove('hidden');

  const isAIControlled = (state.aiPlayers || []).includes(state.yourName);

  // turn banner
  const banner = document.getElementById('turn-banner');
  if (isAIControlled) {
    banner.textContent = "🤖 Ce joueur est actuellement contrôlé par l'IA";
    banner.className = 'turn-banner';
  } else if (state.status === 'round-end') {
    banner.textContent = 'Tour terminé — scores ci-dessous';
    banner.className = 'turn-banner';
  } else if (state.isYourTurn) {
    banner.textContent = "C'est votre tour !";
    banner.className = 'turn-banner yours';
  } else {
    banner.textContent = `Au tour de : ${state.currentPlayer}`;
    banner.className = 'turn-banner';
  }

  // table zone
  const tableZone = document.getElementById('table-zone');
  if (state.table) {
    const face = state.mode === 'B'
      ? `<img src="${api('/image/' + state.table.imageId)}" alt="">`
      : `<img src="/static/assets/cards/${state.table.spriteId}.svg" alt="${state.table.label}">`;
    tableZone.innerHTML = `
      <div class="played-card">${face}</div>
      <div class="by">posée par ${state.table.playerName}${state.table.playerName === state.yourName ? ' (vous)' : ''}</div>
    `;
  } else {
    tableZone.innerHTML = `<div class="played-card empty">Table vide — à vous de lancer</div>`;
  }

  // action row: pass / end trick
  const actionRow = document.getElementById('action-row');
  actionRow.innerHTML = '';
  if (state.isYourTurn && !isAIControlled) {
    if (state.canEndTrickYou) {
      const endBtn = document.createElement('button');
      endBtn.className = 'btn btn-gold';
      endBtn.textContent = 'Fin du tour (relancer)';
      endBtn.addEventListener('click', () => doAction('end-trick'));
      actionRow.appendChild(endBtn);
    }
    const passBtn = document.createElement('button');
    passBtn.className = 'btn btn-outline';
    passBtn.textContent = 'Passer';
    passBtn.addEventListener('click', () => doAction('pass'));
    actionRow.appendChild(passBtn);
  }

  // hand
  const hand = document.getElementById('hand');
  hand.innerHTML = '';
  if (!state.yourHand.length) {
    hand.innerHTML = '<p style="opacity:.7">Vous avez posé toutes vos cartes pour ce tour.</p>';
  }
  state.yourHand.forEach((card) => {
    const btn = document.createElement('button');
    btn.className = 'card-btn';
    btn.disabled = !card.playable || isAIControlled;
    const face = state.mode === 'B'
      ? `<img src="${api('/image/' + card.imageId)}" alt="">`
      : `<img src="/static/assets/cards/${card.spriteId}.svg" alt="${card.display}">`;
    btn.innerHTML = `
      <div class="card-face">${face}</div>
      <div class="card-name">${state.mode === 'B' ? card.display : ''}</div>
    `;
    btn.addEventListener('click', () => doAction('play', { cardId: card.id }));
    hand.appendChild(btn);
  });

  // scores
  const table = document.getElementById('scores-table');
  const sorted = Object.entries(state.scores).sort((a, b) => b[1] - a[1]);
  table.innerHTML = `
    <tr><th>Joueur</th><th>Score total</th><th>Cartes restantes</th></tr>
    ${sorted.map(([name, score]) => `
      <tr>
        <td class="name">${name}${name === state.yourName ? ' (vous)' : ''}</td>
        <td>${score}</td>
        <td>${state.handCounts[name] ?? '—'}</td>
      </tr>
    `).join('')}
  `;
}

async function doAction(action, extra = {}) {
  try {
    const res = await fetch(api(`/action/${action}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerIndex, ...extra })
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Action impossible.');
  } catch (e) {
    alert('Erreur réseau.');
  }
}

const socket = io();
if (ROOM_CODE) socket.emit('join-room', ROOM_CODE);
socket.on('state-updated', refreshState);
setInterval(refreshState, 4000);
refreshState();
