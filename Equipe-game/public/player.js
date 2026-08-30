const socket = io();

const myIndex = parseInt(window.location.pathname.match(/joueur(\d+)/)[1], 10) - 1;
let currentState = null;
let lastProcessedEventId = 0;

const waitScreen = document.getElementById('wait-screen');
const gameScreen = document.getElementById('game-screen');
const eliminationScreen = document.getElementById('elimination-screen');
const winnerScreen = document.getElementById('winner-screen');

function showScreen(name) {
  [waitScreen, gameScreen, eliminationScreen, winnerScreen].forEach(s => s.classList.add('hidden'));
  ({ wait: waitScreen, game: gameScreen, elimination: eliminationScreen, finished: winnerScreen })[name].classList.remove('hidden');
}

socket.on('state', (newState) => {
  const evt = newState.lastEvent;
  const animTypes = ['draw', 'draw-all', 'candidates', 'draw-round-d'];
  const needsAnim = evt && evt.id !== lastProcessedEventId && animTypes.includes(evt.type);
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
  const FPS_MS = 50;
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
    const timer = setInterval(() => { slots.forEach(s => { s.src = randomImageUrl(pool); }); }, 25);
    setTimeout(() => {
      clearInterval(timer);
      currentState = newState;
      render();
    }, DURATION);
  } else if (evt.type === 'draw-round-d') {
    // Le défilement de la manche n'apparaît que sur l'écran du joueur concerné
    if (!(myIndex in evt.pending)) {
      currentState = newState;
      render();
      return;
    }
    const overlay = document.getElementById('flicker-overlay');
    const img = document.getElementById('flicker-img');
    overlay.classList.remove('hidden');
    const timer = setInterval(() => { img.src = randomImageUrl(pool); }, FPS_MS);
    setTimeout(() => {
      clearInterval(timer);
      overlay.classList.add('hidden');
      currentState = newState;
      render();
    }, DURATION);
  }
}

function render() {
  if (!currentState) return;
  const s = currentState;

  if (s.phase === 'setup') {
    document.getElementById('my-name').textContent = s.players[myIndex] ? s.players[myIndex].name : `Joueur ${myIndex + 1}`;
    showScreen('wait');
    return;
  }
  const me = s.players[myIndex];
  if (!me) {
    document.getElementById('wait-message').textContent = "Ce numéro de joueur n'existe pas pour cette partie.";
    showScreen('wait');
    return;
  }

  if (s.phase === 'finished') { renderWinner(s); showScreen('finished'); return; }
  if (s.phase === 'elimination') { renderElimination(s); showScreen('elimination'); return; }

  showScreen('game');
  document.getElementById('theme-display').textContent = s.theme || '(sans thème)';
  const modeLabel = { A: 'Mode A — Équipe au hasard', B: 'Mode B — Équipe de choix', C: 'Mode C — Duel d\'équipe', D: 'Mode D — Défi' }[s.mode];
  document.getElementById('mode-display').textContent = modeLabel;
  document.getElementById('my-name-2').textContent = 'Vous : ' + me.name;

  renderColumns(s);
  renderControls(s, me);
}

function renderColumns(s) {
  const container = document.getElementById('columns');
  container.innerHTML = '';
  s.players.forEach((p, idx) => {
    const col = document.createElement('div');
    col.className = 'player-col';
    col.dataset.index = idx;
    if (idx === myIndex) col.classList.add('active');
    if (p.eliminated) col.classList.add('eliminated');

    const title = document.createElement('h3');
    title.textContent = p.name + (idx === myIndex ? ' (vous)' : '') + (s.mode === 'D' ? ` (dons : ${s.maxGifts - p.giftsUsed})` : '');
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

function renderControls(s, me) {
  const controls = document.getElementById('controls');
  controls.innerHTML = '';

  if (s.mode === 'D') {
    renderControlsD(s, controls, me);
    return;
  }

  if (s.mode === 'B' && s.candidates && s.candidates.playerIndex === myIndex) {
    const title = document.createElement('h3');
    title.textContent = 'À vous de choisir !';
    controls.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'candidate-grid';
    s.candidates.images.forEach(img => {
      const div = document.createElement('div');
      div.className = 'candidate-item';
      div.innerHTML = `<img src="${img.url}"><div class="thumb-label">${img.name}</div>`;
      div.onclick = () => {
        showModal(`Choisir "${img.name}" ?`, () => {
          socket.emit('choice-confirm', { playerIndex: myIndex, file: img.file });
        });
      };
      grid.appendChild(div);
    });
    controls.appendChild(grid);
  } else if (s.currentPlayerIndex === myIndex && (s.mode === 'A' || s.mode === 'B')) {
    const p = document.createElement('p');
    p.textContent = "C'est votre tour ! Suivez les instructions sur l'écran du maître du jeu.";
    controls.appendChild(p);
  } else {
    const p = document.createElement('p');
    p.textContent = s.mode === 'C' ? 'Tirage simultané en cours pour tous les joueurs.' : 'En attente de votre tour...';
    controls.appendChild(p);
  }
}

function renderControlsD(s, controls, me) {
  const iAmEliminated = me.eliminated;
  if (iAmEliminated) {
    controls.innerHTML = '<p>Vous avez été éliminé. Vous pouvez observer la suite de la partie.</p>';
    return;
  }

  if (s.roundPhase === 'deciding') {
    const alreadyPending = myIndex in s.pendingDraws;
    const alreadyDecided = s.decidedPlayers.includes(myIndex);

    if (!alreadyPending) {
      controls.innerHTML = '<p>Pas d\'image tirée pour vous cette manche (stock de photos épuisé). En attente des autres joueurs...</p>';
      return;
    }
    if (alreadyDecided) {
      controls.innerHTML = '<p>Décision enregistrée. En attente des autres joueurs...</p>';
      return;
    }

    const img = s.pendingDraws[myIndex];
    const myGiftsLeft = s.maxGifts - me.giftsUsed;
    const otherActive = s.players.map((p, i) => ({ p, i })).filter(x => x.i !== myIndex && !x.p.eliminated);

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <h3>Votre tirage</h3>
      <div style="display:flex;justify-content:center;margin-bottom:14px;">
        <img class="thumb" style="width:180px;height:240px;" src="${img.url}">
      </div>
      <p><strong>${img.name}</strong> — la garder ou la donner à un autre joueur ?</p>
    `;
    controls.appendChild(wrap);

    const row = document.createElement('div');
    row.className = 'row';

    const keepBtn = document.createElement('button');
    keepBtn.textContent = 'Garder';
    keepBtn.onclick = () => {
      showModal('Garder cette image dans votre équipe ?', () => {
        socket.emit('decision', { playerIndex: myIndex, action: 'keep' });
      });
    };
    row.appendChild(keepBtn);

    if (myGiftsLeft > 0 && otherActive.length > 0) {
      const select = document.createElement('select');
      otherActive.forEach(x => {
        const opt = document.createElement('option');
        opt.value = x.i;
        opt.textContent = x.p.name;
        select.appendChild(opt);
      });
      row.appendChild(select);

      const giveBtn = document.createElement('button');
      giveBtn.className = 'secondary';
      giveBtn.textContent = `Donner (${myGiftsLeft} restant${myGiftsLeft > 1 ? 's' : ''})`;
      giveBtn.onclick = () => {
        const targetIndex = parseInt(select.value, 10);
        const targetName = s.players[targetIndex].name;
        showModal(`Donner cette image à ${targetName} ?`, () => {
          socket.emit('decision', { playerIndex: myIndex, action: 'give', targetIndex });
        });
      };
      row.appendChild(giveBtn);
    }
    controls.appendChild(row);
    return;
  }

  if (s.roundPhase === 'trimming') {
    if (!s.trimNeeded.includes(myIndex)) {
      controls.innerHTML = '<p>En attente que les autres joueurs ajustent leur équipe...</p>';
      return;
    }
    const toRemove = me.team.length - s.numDraws;
    const wrap = document.createElement('div');
    wrap.innerHTML = `<h3>Votre équipe dépasse la limite</h3><p>Supprimez ${toRemove} image${toRemove > 1 ? 's' : ''} pour revenir à ${s.numDraws}.</p>`;
    controls.appendChild(wrap);

    const grid = document.createElement('div');
    grid.className = 'candidate-grid';
    me.team.forEach(img => {
      const div = document.createElement('div');
      div.className = 'candidate-item';
      div.innerHTML = `<img src="${img.url}"><div class="thumb-label">${img.name}</div>`;
      div.onclick = () => {
        showModal(`Supprimer "${img.name}" de votre équipe ?`, () => {
          socket.emit('trim-image', { playerIndex: myIndex, file: img.file });
        });
      };
      grid.appendChild(div);
    });
    controls.appendChild(grid);
    return;
  }

  // roundPhase === 'ready'
  const p = document.createElement('p');
  p.textContent = s.round >= s.numRounds
    ? 'Toutes les manches sont terminées. En attente de la phase d\'élimination...'
    : `Manche ${s.round}/${s.numRounds} terminée. En attente du lancement de la manche suivante par le maître du jeu...`;
  controls.appendChild(p);
}

function renderElimination(s) {
  const container = document.getElementById('elim-columns');
  container.innerHTML = '';
  s.players.forEach((p, idx) => {
    const col = document.createElement('div');
    col.className = 'player-col';
    if (idx === myIndex) col.classList.add('active');
    if (p.eliminated) col.classList.add('eliminated');
    const title = document.createElement('h3');
    title.textContent = p.name + (idx === myIndex ? ' (vous)' : '');
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

function renderWinner(s) {
  const isMe = s.winner && s.players[myIndex] && s.winner.name === s.players[myIndex].name;
  document.getElementById('winner-title').textContent = isMe ? `🏆 Vous avez gagné, ${s.winner.name} !` : `🏆 Vainqueur : ${s.winner.name}`;
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
