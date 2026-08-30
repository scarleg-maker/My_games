const match = window.location.pathname.match(/joueur(\d+)/);
const playerIndex = match ? parseInt(match[1], 10) - 1 : 0;

const socket = io();
socket.on('connect', () => socket.emit('register', { role: 'player', index: playerIndex }));

const waiting = document.getElementById('waiting');
const playArea = document.getElementById('playArea');

function phaseLabelText(phase) {
  return {
    placement: 'Pose des bombes',
    draw: 'Tirage des cartes',
    roundEnd: 'Fin de manche — en attente de l\'arbitre',
    gameEnd: 'Partie terminée',
  }[phase] || phase;
}

socket.on('state', (state) => {
  if (!state.started) {
    waiting.style.display = 'block';
    playArea.style.display = 'none';
    return;
  }
  waiting.style.display = 'none';
  playArea.style.display = 'block';

  const me = state.players[playerIndex];
  document.getElementById('playerTitle').textContent = `💣 ${me ? me.name : 'Joueur'} — Manche ${state.roundNumber}`;
  document.getElementById('phaseText').textContent = 'Phase : ' + phaseLabelText(state.phase);

  const turnDiv = document.getElementById('turnIndicator');
  const board = document.getElementById('board');
  board.style.gridTemplateColumns = `repeat(${state.gridCols}, 1fr)`;
  const instructions = document.getElementById('instructions');
  const actionsPanel = document.getElementById('actionsPanel');
  actionsPanel.innerHTML = '';
  turnDiv.innerHTML = '';
  turnDiv.className = '';

  if (me && me.eliminated) {
    instructions.textContent = 'Vous avez été éliminé. Vous pouvez observer la partie.';
  }

  if (state.phase === 'placement') {
    instructions.textContent = me && !me.eliminated
      ? `Placez vos ${state.config.numBombs} bombe(s) en cliquant sur les images, puis validez. Cliquez à nouveau sur une image piégée pour retirer la bombe.`
      : '';
    board.innerHTML = state.board.map(c => {
      let cls = 'cell';
      if (c.mine) cls += ' mine-bomb';
      const bombIcon = c.mine ? '<div class="bomb-icon">💣</div>' : '';
      return `<div class="${cls}" data-idx="${c.idx}" onclick="clickPlacement(${c.idx})">
        <img src="/images_pool/${encodeURIComponent(c.filename)}" loading="lazy">
        ${bombIcon}
        <div class="fname">${c.filename}</div>
      </div>`;
    }).join('');

    if (me && !me.eliminated) {
      const btnLabel = me.ready ? 'Modifier mes bombes' : `Valider (${me.bombsRemaining} restante(s))`;
      actionsPanel.innerHTML = `<button ${(!me.ready && me.bombsRemaining > 0) ? 'disabled' : ''} onclick="validateOrEdit(${me.ready})">${btnLabel}</button>`;
    }
  } else if (state.phase === 'draw') {
    const isMyTurn = state.currentPlayer === playerIndex && !state.turnLocked;
    if (state.turnLocked) {
      turnDiv.innerHTML = '<div class="turn-indicator">Résolution en cours...</div>';
    } else if (isMyTurn) {
      turnDiv.innerHTML = '<div class="turn-indicator my-turn">🎯 C\'est votre tour ! Choisissez une image.</div>';
    } else {
      const cp = state.players[state.currentPlayer];
      turnDiv.innerHTML = `<div class="turn-indicator">En attente : ${cp ? cp.name : '...'}</div>`;
    }
    instructions.textContent = 'Cliquez sur une image disponible pour la tirer dans votre équipe. Vos propres bombes sont repérées par 💣.';
    board.innerHTML = state.board.map(c => {
      let cls = 'cell';
      if (c.taken) {
        cls += c.isBomb ? ' taken taken-bomb' : ' taken taken-safe';
      } else {
        if (c.mine) cls += ' mine-bomb';
        if (!isMyTurn) cls += ' disabled-cell';
      }
      const bombIcon = (c.taken && c.isBomb) ? '<div class="bomb-icon">💣</div>' : (!c.taken && c.mine ? '<div class="bomb-icon">💣</div>' : '');
      const clickAttr = (!c.taken && isMyTurn) ? `onclick="clickDraw(${c.idx})"` : '';
      return `<div class="${cls}" data-idx="${c.idx}" ${clickAttr}>
        <img src="/images_pool/${encodeURIComponent(c.filename)}" loading="lazy">
        ${bombIcon}
        <div class="fname">${c.filename}</div>
      </div>`;
    }).join('');
  } else {
    instructions.textContent = '';
    board.innerHTML = state.board.map(c => {
      let cls = 'cell taken';
      cls += c.taken && c.isBomb ? ' taken-bomb' : (c.taken ? ' taken-safe' : '');
      return `<div class="${cls}">
        <img src="/images_pool/${encodeURIComponent(c.filename)}" loading="lazy">
        <div class="fname">${c.filename}</div>
      </div>`;
    }).join('');
  }

  // mon équipe
  const myTeam = document.getElementById('myTeam');
  if (me) {
    const cards = me.drawnCards.map(c =>
      `<div class="card-thumb ${c.lost ? 'lost' : ''}"><img src="/images_pool/${encodeURIComponent(c.filename)}"></div>`
    ).join('');
    myTeam.innerHTML = `<div class="player-column">
      <h4>${me.name}</h4>
      <div class="status-line">${me.safeCount}/${state.config.maxCards} images ${me.complete ? '🏆 Terminé !' : ''}</div>
      <div class="cards-grid">${cards}</div>
    </div>`;
  }

  const endPanel = document.getElementById('endPanel');
  if (state.phase === 'gameEnd') {
    endPanel.style.display = 'block';
    document.getElementById('endText').textContent = state.winner
      ? (state.winner === (me && me.name) ? '🏆 Vous avez gagné !' : `🏆 Victoire de ${state.winner}`)
      : 'Partie terminée.';
  } else {
    endPanel.style.display = 'none';
  }

  // overlay de révélation (Sûre / Piégée) pendant 2s
  const revealOverlay = document.getElementById('revealOverlay');
  if (state.lastReveal) {
    const r = state.lastReveal;
    const isMe = r.playerIndex === playerIndex;
    const resultClass = r.isBomb ? 'bomb' : 'safe';
    const resultText = r.isBomb
      ? `💣 Piégée${r.bombCount > 1 ? ' x' + r.bombCount : ''}`
      : '👍 Sûre';
    document.getElementById('revealBox').innerHTML = `
      <img src="/images_pool/${encodeURIComponent(r.filename)}">
      <div class="reveal-player">${isMe ? 'Vous avez' : r.playerName + ' a'} tiré :</div>
      <div class="reveal-result ${resultClass}">${resultText}</div>
    `;
    revealOverlay.style.display = 'flex';
  } else {
    revealOverlay.style.display = 'none';
  }
});

function clickPlacement(imgIndex) {
  socket.emit('toggleBomb', { index: playerIndex, imgIndex });
}
function validateOrEdit(currentlyReady) {
  if (currentlyReady) {
    socket.emit('unvalidatePlacement', { index: playerIndex });
  } else {
    socket.emit('validatePlacement', { index: playerIndex });
  }
}
function clickDraw(imgIndex) {
  socket.emit('drawCard', { index: playerIndex, imgIndex });
}
