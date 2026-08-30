const socket = io();

let selectedMode = null;
let currentState = null;
let lastProcessedEventId = 0;
let uploadedImagesCount = 0;

// ---------- SETUP SCREEN ----------

const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const eliminationScreen = document.getElementById('elimination-screen');
const winnerScreen = document.getElementById('winner-screen');

function showScreen(name) {
  [setupScreen, gameScreen, eliminationScreen, winnerScreen].forEach(s => s.classList.add('hidden'));
  ({ setup: setupScreen, game: gameScreen, elimination: eliminationScreen, finished: winnerScreen })[name].classList.remove('hidden');
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedMode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('num-rounds-block').classList.toggle('hidden', selectedMode !== 'D');
    checkStartReady();
  });
});

const playerCountInput = document.getElementById('player-count');
const playerNamesDiv = document.getElementById('player-names');
let savedNames = [];

function renderPlayerInputs() {
  const n = Math.max(2, Math.min(12, parseInt(playerCountInput.value, 10) || 2));
  playerCountInput.value = n;
  playerNamesDiv.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Nom du joueur ${i + 1}`;
    input.value = savedNames[i] || '';
    input.className = 'player-name-input';
    playerNamesDiv.appendChild(input);
  }
  checkStartReady();
}
playerCountInput.addEventListener('input', renderPlayerInputs);

fetch('/api/players').then(r => r.json()).then(data => {
  savedNames = data.names || [];
  if (savedNames.length >= 2) playerCountInput.value = savedNames.length;
  renderPlayerInputs();
});

const zipInput = document.getElementById('zip-input');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');

uploadBtn.addEventListener('click', () => {
  if (!zipInput.files[0]) {
    uploadStatus.textContent = ' Choisissez un fichier zip.';
    return;
  }
  const fd = new FormData();
  fd.append('zipfile', zipInput.files[0]);
  uploadStatus.textContent = ' Chargement...';
  fetch('/api/upload-zip', { method: 'POST', body: fd })
    .then(r => r.json())
    .then(data => {
      if (data.error) { uploadStatus.textContent = ' Erreur : ' + data.error; return; }
      uploadedImagesCount = data.count;
      uploadStatus.textContent = ` ✓ ${data.count} images chargées et redimensionnées.` + (data.skipped ? ` (${data.skipped} fichier(s) ignoré(s), illisible(s))` : '');
      checkStartReady();
    })
    .catch(e => { uploadStatus.textContent = ' Erreur réseau.'; });
});

function getPlayerNames() {
  return Array.from(document.querySelectorAll('.player-name-input')).map(i => i.value.trim());
}

function checkStartReady() {
  const names = getPlayerNames();
  const allFilled = names.length >= 2 && names.every(n => n.length > 0);
  let roundsOk = true;
  if (selectedMode === 'D') {
    const nr = parseInt(document.getElementById('num-rounds').value, 10);
    const mg = parseInt(document.getElementById('num-gifts').value, 10);
    roundsOk = !isNaN(nr) && nr >= 1 && nr <= 30 && !isNaN(mg) && mg >= 1 && mg <= 5;
  }
  const ready = selectedMode && allFilled && uploadedImagesCount > 0 && roundsOk;
  document.getElementById('start-btn').disabled = !ready;
}
playerNamesDiv.addEventListener('input', checkStartReady);
document.getElementById('num-rounds').addEventListener('input', checkStartReady);
document.getElementById('num-gifts').addEventListener('input', checkStartReady);

document.getElementById('start-btn').addEventListener('click', () => {
  const names = getPlayerNames();
  const theme = document.getElementById('theme').value.trim();
  const numDraws = document.getElementById('num-draws').value;
  const numRounds = document.getElementById('num-rounds').value;
  const maxGifts = document.getElementById('num-gifts').value;
  const errEl = document.getElementById('setup-error');
  errEl.textContent = '';

  fetch('/api/start-game', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: selectedMode, players: names, theme, numDraws, numRounds, maxGifts })
  })
    .then(r => r.json())
    .then(data => {
      if (data.error) { errEl.textContent = data.error; return; }
      const linksDiv = document.getElementById('player-links');
      linksDiv.innerHTML = '<h3>Liens joueurs :</h3>' + data.playerUrls
        .map((u, i) => `<a href="${u}" target="_blank">${names[i]} → localhost:3500${u}</a>`).join('');
    });
});

document.getElementById('reset-btn').addEventListener('click', () => {
  if (confirm('Réinitialiser la partie en cours ?')) socket.emit('reset-game');
});
document.getElementById('new-game-btn').addEventListener('click', () => {
  socket.emit('reset-game');
});

// ---------- SOCKET / RENDER ----------

socket.on('state', (newState) => {
  const evt = newState.lastEvent;
  const needsAnim = evt && evt.id !== lastProcessedEventId && ['draw', 'draw-all', 'candidates'].includes(evt.type);
  if (needsAnim) {
    lastProcessedEventId = evt.id;
    runAnimation(evt, newState);
  } else {
    if (evt) lastProcessedEventId = evt.id;
    currentState = newState;
    render();
  }
});

function randomImageUrl(images) {
  if (!images || images.length === 0) return '';
  return images[Math.floor(Math.random() * images.length)].url;
}

function runAnimation(evt, newState) {
  const FPS_MS = 50; // ~20 images/seconde
  const DURATION = 3000;
  const REVEAL_HOLD = 2000; // temps d'affichage de l'image tirée avant qu'elle rejoigne la colonne
  const pool = (currentState && currentState.images) || newState.images;

  if (evt.type === 'draw') {
    const overlay = document.getElementById('flicker-overlay');
    const img = document.getElementById('flicker-img');
    overlay.classList.remove('hidden');
    const timer = setInterval(() => { img.src = randomImageUrl(pool); }, FPS_MS);
    setTimeout(() => {
      clearInterval(timer);
      img.src = evt.image.url; // on fige sur l'image réellement tirée
      setTimeout(() => {
        overlay.classList.add('hidden');
        currentState = newState;
        render();
      }, REVEAL_HOLD);
    }, DURATION);
  } else if (evt.type === 'draw-all') {
    // affichage au premier plan : un défilement par joueur actif, côte à côte
    const overlay = document.getElementById('flicker-overlay');
    overlay.innerHTML = '';
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '24px';
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'center';
    const items = [];
    evt.results.forEach(r => {
      const wrap = document.createElement('div');
      wrap.className = 'multi-flicker-item';
      const img = document.createElement('img');
      wrap.appendChild(img);
      const label = document.createElement('div');
      label.className = 'multi-flicker-label';
      label.textContent = (currentState && currentState.players[r.playerIndex]) ? currentState.players[r.playerIndex].name : '';
      wrap.appendChild(label);
      row.appendChild(wrap);
      items.push({ img, finalUrl: r.image.url });
    });
    overlay.appendChild(row);
    overlay.classList.remove('hidden');

    const timer = setInterval(() => {
      const url = randomImageUrl(pool);
      items.forEach(it => { it.img.src = url; });
    }, FPS_MS);
    setTimeout(() => {
      clearInterval(timer);
      items.forEach(it => { it.img.src = it.finalUrl; }); // on fige chaque colonne sur son résultat
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.innerHTML = '<img id="flicker-img" class="center-flicker">';
        currentState = newState;
        render();
      }, REVEAL_HOLD);
    }, DURATION);
  } else if (evt.type === 'candidates') {
    renderCandidateFlicker(pool, () => {
      currentState = newState;
      render();
    });
  }
}

function renderCandidateFlicker(pool, onDone) {
  const controls = document.getElementById('controls');
  controls.innerHTML = '<h3>Tirage en cours...</h3><div class="candidate-grid" id="cand-flicker"></div>';
  const grid = document.getElementById('cand-flicker');
  const slots = [];
  for (let i = 0; i < 5; i++) {
    const div = document.createElement('div');
    div.className = 'candidate-item';
    div.innerHTML = '<img>';
    grid.appendChild(div);
    slots.push(div.querySelector('img'));
  }
  const timer = setInterval(() => {
    slots.forEach(s => { s.src = randomImageUrl(pool); });
  }, 25);
  setTimeout(() => { clearInterval(timer); onDone(); }, 3000);
}

function render() {
  if (!currentState) return;
  const s = currentState;

  if (s.phase === 'setup') { showScreen('setup'); return; }
  if (s.phase === 'finished') { renderWinner(s); showScreen('finished'); return; }
  if (s.phase === 'elimination') { renderElimination(s); showScreen('elimination'); return; }
  showScreen('game');

  document.getElementById('theme-display').textContent = s.theme || '(sans thème)';
  const modeLabel = { A: 'Mode A — Équipe au hasard', B: 'Mode B — Équipe de choix', C: 'Mode C — Duel d\'équipe', D: 'Mode D — Défi' }[s.mode];
  document.getElementById('mode-display').textContent = modeLabel;

  renderColumns(s, 'columns');
  renderControls(s);
}

function renderColumns(s, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  s.players.forEach((p, idx) => {
    const col = document.createElement('div');
    col.className = 'player-col';
    col.dataset.index = idx;
    if (idx === s.currentPlayerIndex && s.mode !== 'C' && s.mode !== 'D' && s.phase === 'playing') col.classList.add('active');
    if (p.eliminated) col.classList.add('eliminated');

    const title = document.createElement('h3');
    title.textContent = p.name + (s.mode === 'D' ? ` (dons restants : ${s.maxGifts - p.giftsUsed})` : '');
    col.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'team-grid';
    p.team.forEach(img => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<img class="thumb" src="${img.url}"><div class="thumb-label">${img.name}</div>`;
      grid.appendChild(wrap);
    });
    col.appendChild(grid);
    container.appendChild(col);
  });
}

function renderControls(s) {
  const controls = document.getElementById('controls');
  const active = s.players.map((p, i) => ({ p, i })).filter(x => !x.p.eliminated);

  if (s.mode === 'A' || s.mode === 'B') {
    const cp = s.players[s.currentPlayerIndex];
    const cpDone = cp.team.length >= s.numDraws;
    const allDone = active.every(x => x.p.team.length >= s.numDraws);

    let html = `<h3>Tour de : ${cp.name} (${cp.team.length}/${s.numDraws})</h3>`;
    controls.innerHTML = html;

    if (allDone) {
      const btn = document.createElement('button');
      btn.textContent = 'Passer à l\'élimination';
      btn.onclick = () => socket.emit('go-to-elimination');
      controls.appendChild(btn);
      return;
    }

    if (cpDone) {
      const btn = document.createElement('button');
      btn.textContent = 'Joueur suivant';
      btn.onclick = () => socket.emit('next-player');
      controls.appendChild(btn);
      return;
    }

    if (s.mode === 'A') {
      const btn = document.createElement('button');
      btn.textContent = 'Nouveau tirage';
      btn.disabled = s.pool.length === 0;
      btn.onclick = () => socket.emit('draw-single', { playerIndex: s.currentPlayerIndex });
      controls.appendChild(btn);
    } else if (s.mode === 'B') {
      if (s.candidates && s.candidates.playerIndex === s.currentPlayerIndex) {
        renderCandidatesChoice(s, controls);
      } else {
        const btn = document.createElement('button');
        btn.textContent = 'Lancer le tirage (5 images)';
        btn.disabled = s.pool.length === 0;
        btn.onclick = () => socket.emit('draw-candidates', { playerIndex: s.currentPlayerIndex });
        controls.appendChild(btn);
      }
    }
  } else if (s.mode === 'C') {
    const minDraws = Math.min(...active.map(x => x.p.team.length));
    const allDone = active.every(x => x.p.team.length >= s.numDraws);
    let html = `<h3>Tirage simultané (${minDraws}/${s.numDraws})</h3>`;
    controls.innerHTML = html;
    if (allDone) {
      const btn = document.createElement('button');
      btn.textContent = 'Passer à l\'élimination';
      btn.onclick = () => socket.emit('go-to-elimination');
      controls.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.textContent = 'Tirage pour tous les joueurs';
      btn.disabled = s.pool.length === 0;
      btn.onclick = () => socket.emit('draw-all');
      controls.appendChild(btn);
    }
  } else if (s.mode === 'D') {
    renderControlsD(s, controls, active);
  }
}

function renderControlsD(s, controls, active) {
  let html = `<h3>Manche ${s.round}/${s.numRounds}</h3>`;
  controls.innerHTML = html;

  if (s.roundPhase === 'deciding') {
    const list = active.map(x => {
      const done = s.decidedPlayers.includes(x.i) || !(x.i in s.pendingDraws);
      return `<div>${x.p.name} : ${done ? '✓ a validé' : '⏳ en attente...'}</div>`;
    }).join('');
    const p = document.createElement('div');
    p.innerHTML = `<p>Chaque joueur décide sur son propre écran de garder ou donner son image.</p>${list}`;
    controls.appendChild(p);
    return;
  }

  if (s.roundPhase === 'trimming') {
    const names = s.trimNeeded.map(i => s.players[i].name).join(', ');
    const p = document.createElement('p');
    p.textContent = `En attente : ${names} doi(ven)t supprimer des images en trop sur leur écran (maximum ${s.numDraws} par équipe).`;
    controls.appendChild(p);
    return;
  }

  // roundPhase === 'ready'
  if (s.round >= s.numRounds) {
    const btn = document.createElement('button');
    btn.textContent = 'Passer à l\'élimination';
    btn.onclick = () => socket.emit('go-to-elimination');
    controls.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.textContent = s.round === 0 ? 'Lancer la première manche' : 'Lancer la manche suivante';
    btn.disabled = s.pool.length === 0;
    btn.onclick = () => socket.emit('draw-round-d');
    controls.appendChild(btn);
  }
}

function renderCandidatesChoice(s, controls) {
  const grid = document.createElement('div');
  grid.className = 'candidate-grid';
  s.candidates.images.forEach(img => {
    const div = document.createElement('div');
    div.className = 'candidate-item';
    div.innerHTML = `<img src="${img.url}"><div class="thumb-label">${img.name}</div>`;
    div.onclick = () => confirmChoice(s.currentPlayerIndex, img);
    grid.appendChild(div);
  });
  controls.appendChild(grid);
}

function confirmChoice(playerIndex, img) {
  showModal(`Choisir "${img.name}" pour ce joueur ?`, () => {
    socket.emit('choice-confirm', { playerIndex, file: img.file });
  });
}

// ---------- ELIMINATION ----------

function renderElimination(s) {
  const container = document.getElementById('elim-columns');
  container.innerHTML = '';
  s.players.forEach((p, idx) => {
    const col = document.createElement('div');
    col.className = 'player-col';
    if (p.eliminated) col.classList.add('eliminated');

    const title = document.createElement('h3');
    title.textContent = p.name;
    col.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'team-grid';
    p.team.forEach(img => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<img class="thumb" src="${img.url}"><div class="thumb-label">${img.name}</div>`;
      grid.appendChild(wrap);
    });
    col.appendChild(grid);

    if (!p.eliminated) {
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = 'Éliminer';
      btn.style.marginTop = '10px';
      btn.onclick = () => {
        showModal(`Confirmer l'élimination de ${p.name} ?`, () => {
          socket.emit('eliminate-player', { playerIndex: idx });
        });
      };
      col.appendChild(btn);
    }
    container.appendChild(col);
  });
}

// ---------- WINNER ----------

function renderWinner(s) {
  document.getElementById('winner-title').textContent = `🏆 Vainqueur : ${s.winner.name}`;
  const container = document.getElementById('winner-team');
  container.innerHTML = '';
  const col = document.createElement('div');
  col.className = 'player-col';
  const grid = document.createElement('div');
  grid.className = 'team-grid';
  s.winner.team.forEach(img => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<img class="thumb" src="${img.url}"><div class="thumb-label">${img.name}</div>`;
    grid.appendChild(wrap);
  });
  col.appendChild(grid);
  container.appendChild(col);
}

// ---------- MODAL ----------

function showModal(text, onConfirm) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay">
      <div class="modal-box">
        <p>${text}</p>
        <div class="actions">
          <button class="secondary" id="modal-cancel">Annuler</button>
          <button id="modal-confirm">Valider</button>
        </div>
      </div>
    </div>`;
  document.getElementById('modal-cancel').onclick = () => { root.innerHTML = ''; };
  document.getElementById('modal-confirm').onclick = () => { root.innerHTML = ''; onConfirm(); };
}
