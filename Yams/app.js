(() => {
  'use strict';

  /* ===================== CONSTANTES ===================== */

  const UPPER_KEYS = [1, 2, 3, 4, 5, 6];
  const UPPER_LABELS = { 1: 'As (1)', 2: 'Deux (2)', 3: 'Trois (3)', 4: 'Quatre (4)', 5: 'Cinq (5)', 6: 'Six (6)' };

  const LOWER_KEYS = ['brelan', 'carre', 'full', 'petiteSuite', 'grandeSuite', 'yam', 'somme'];
  const LOWER_LABELS = {
    brelan: 'Brelan',
    carre: 'Carré',
    full: 'Full',
    petiteSuite: 'Petite suite',
    grandeSuite: 'Grande suite',
    yam: 'Yam',
    somme: 'Somme (Chance)'
  };

  const DOUBLABLE = ['full', 'petiteSuite', 'grandeSuite', 'yam'];

  // Valeur attribuée à chaque face du cube 3D (faces opposées = 7 au total, comme un vrai dé)
  const CUBE_FACE_VALUES = { front: 1, back: 6, right: 2, left: 5, top: 3, bottom: 4 };
  // Rotation à appliquer au cube pour amener la face de cette valeur face à l'écran
  const CUBE_ROTATIONS = {
    1: { x: 0, y: 0 },
    6: { x: 0, y: 180 },
    2: { x: 0, y: -90 },
    5: { x: 0, y: 90 },
    3: { x: -90, y: 0 },
    4: { x: 90, y: 0 }
  };
  const PIP_POSITIONS = ['tl', 'tr', 'ml', 'c', 'mr', 'bl', 'br'];

  const LS_PLAYERS_KEY = 'yams_player_names';

  /* ===================== UTILITAIRES ===================== */

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function showScreen(id) {
    $all('.screen').forEach(s => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
  }

  function emptyScoreCard() {
    const card = {};
    UPPER_KEYS.forEach(k => (card[k] = null));
    LOWER_KEYS.forEach(k => (card[k] = null));
    return card;
  }

  function isCardFull(card) {
    return UPPER_KEYS.concat(LOWER_KEYS).every(k => card[k] !== null);
  }

  function cardTotal(card) {
    return UPPER_KEYS.concat(LOWER_KEYS).reduce((sum, k) => sum + (card[k] || 0), 0);
  }

  function savedNames(count) {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_PLAYERS_KEY) || '[]');
      return raw;
    } catch (e) {
      return [];
    }
  }

  function saveNames(names) {
    localStorage.setItem(LS_PLAYERS_KEY, JSON.stringify(names));
  }

  /* ===================== CALCUL DES SCORES ===================== */

  function diceCounts(dice) {
    const counts = {};
    dice.forEach(d => (counts[d] = (counts[d] || 0) + 1));
    return counts;
  }

  // Calcule le score qu'obtiendrait `key` avec les dés donnés.
  // rollCount = nombre de lancers effectués ce tour-ci (1, 2 ou 3)
  function calcScore(key, dice, rollCount, pointsSup) {
    const counts = diceCounts(dice);
    const sum = dice.reduce((a, b) => a + b, 0);
    const sorted = [...dice].sort((a, b) => a - b);
    let base = 0;

    if (typeof key === 'number') {
      return dice.filter(d => d === key).reduce((a, b) => a + b, 0);
    }

    switch (key) {
      case 'brelan':
        base = Object.values(counts).some(c => c >= 3) ? sum : 0;
        return base;
      case 'carre':
        base = Object.values(counts).some(c => c >= 4) ? sum : 0;
        return base;
      case 'full': {
        const vals = Object.values(counts).sort((a, b) => a - b);
        const isFull = vals.length === 2 && vals[0] === 2 && vals[1] === 3;
        base = isFull ? 25 : 0;
        break;
      }
      case 'petiteSuite': {
        base = JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5]) ? 30 : 0;
        break;
      }
      case 'grandeSuite': {
        base = JSON.stringify(sorted) === JSON.stringify([2, 3, 4, 5, 6]) ? 40 : 0;
        break;
      }
      case 'yam': {
        base = Object.values(counts).some(c => c === 5) ? 50 : 0;
        break;
      }
      case 'somme':
        return sum;
    }

    if (pointsSup && base > 0 && rollCount === 1 && DOUBLABLE.includes(key)) {
      base *= 2;
    }
    return base;
  }

  function wasDoubled(key, score, dice, rollCount, pointsSup) {
    if (!pointsSup || rollCount !== 1 || !DOUBLABLE.includes(key)) return false;
    const undoubled = { full: 25, petiteSuite: 30, grandeSuite: 40, yam: 50 }[key];
    return score === undoubled * 2;
  }

  const COMBO_BASE_POINTS = { full: 25, petiteSuite: 30, grandeSuite: 40, yam: 50 };

  // Construit le libellé d'une ligne, en rappelant les points (et leur doublement si la règle est active)
  function comboLabel(key, pointsSup) {
    const label = LOWER_LABELS[key];
    const base = COMBO_BASE_POINTS[key];
    if (!base) return label; // brelan, carré, somme : pas de points fixes
    return pointsSup ? `${label} (${base} / ${base * 2} pts)` : `${label} (${base} pts)`;
  }

  /* ============================================================
     NAVIGATION GENERALE
     ============================================================ */

  $('#btn-goto-classic').addEventListener('click', () => {
    initClassicSetup();
    showScreen('screen-classic-setup');
  });

  $('#btn-goto-scoresheet').addEventListener('click', () => {
    initSheetSetup();
    showScreen('screen-scoresheet-setup');
  });

  $all('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.target));
  });

  $('#btn-explain-points-sup').addEventListener('click', () => {
    $('#points-sup-explanation').classList.toggle('hidden');
  });

  $('#btn-explain-points-sup-sheet').addEventListener('click', () => {
    $('#points-sup-explanation-sheet').classList.toggle('hidden');
  });

  function openRulesModal() { $('#rules-modal').classList.remove('hidden'); }
  $('#btn-show-rules').addEventListener('click', openRulesModal);
  $('#btn-show-rules-2').addEventListener('click', openRulesModal);
  $('#btn-show-rules-3').addEventListener('click', openRulesModal);
  $('#btn-show-rules-4').addEventListener('click', openRulesModal);
  $('#btn-close-rules').addEventListener('click', () => $('#rules-modal').classList.add('hidden'));
  $('#rules-modal').addEventListener('click', (e) => {
    if (e.target.id === 'rules-modal') $('#rules-modal').classList.add('hidden');
  });

  /* ============================================================
     CONFIGURATION : champs "nombre de joueurs" + "noms"
     (fonction réutilisée pour les 2 modes)
     ============================================================ */

  function fillPlayerCountSelect(selectEl, max = 8) {
    selectEl.innerHTML = '';
    for (let i = 1; i <= max; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      selectEl.appendChild(opt);
    }
  }

  function renderNameInputs(container, count, prefill) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = document.createElement('div');
      row.className = 'player-name-row';
      const label = document.createElement('label');
      label.textContent = `Joueur ${i + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'name-input';
      input.placeholder = `Joueur ${i + 1}`;
      input.value = (prefill && prefill[i]) || '';
      input.dataset.index = i;
      row.appendChild(label);
      row.appendChild(input);
      container.appendChild(row);
    }
  }

  function readNameInputs(container, count) {
    const inputs = $all('.name-input', container);
    const names = inputs.map((inp, i) => inp.value.trim() || `Joueur ${i + 1}`);
    return names.slice(0, count);
  }

  /* ============================================================
     DÉS 3D (partagés entre les 2 modes)
     ============================================================ */

  function buildPipsEl(value) {
    const pips = document.createElement('div');
    pips.className = `pips v${value}`;
    PIP_POSITIONS.forEach(pos => {
      const dot = document.createElement('span');
      dot.className = `pip ${pos}`;
      pips.appendChild(dot);
    });
    return pips;
  }

  // Construit les 5 dés en cubes 3D (6 faces chacun) dans le conteneur donné.
  // N'est appelé qu'une fois par écran ; les rendus suivants ne font que mettre à jour la rotation.
  function buildDiceDOM(container, onClick) {
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'die-3d';
      wrap.dataset.index = i;

      const cube = document.createElement('div');
      cube.className = 'die-cube';

      Object.entries(CUBE_FACE_VALUES).forEach(([faceName, val]) => {
        const face = document.createElement('div');
        face.className = `die-face ${faceName}`;
        face.appendChild(buildPipsEl(val));
        cube.appendChild(face);
      });

      wrap.appendChild(cube);
      wrap.addEventListener('click', () => onClick(i));
      container.appendChild(wrap);
    }
  }

  // Met à jour uniquement la rotation (valeur) et l'état "conservé" des dés, sans reconstruire le DOM
  function updateDiceVisuals(container, dice, held) {
    $all('.die-3d', container).forEach((wrap, i) => {
      const cube = wrap.querySelector('.die-cube');
      const r = CUBE_ROTATIONS[dice[i]];
      cube.style.transform = `rotateX(${r.x}deg) rotateY(${r.y}deg)`;
      wrap.classList.toggle('held', !!(held && held[i]));
    });
  }

  /* ============================================================
     MODE 1 : JEU CLASSIQUE
     ============================================================ */

  const classicNumSelect = $('#classic-num-players');
  const classicNamesContainer = $('#classic-player-names');

  function initClassicSetup() {
    fillPlayerCountSelect(classicNumSelect);
    const stored = savedNames();
    const initialCount = stored.length > 0 ? Math.min(Math.max(stored.length, 1), 8) : 2;
    classicNumSelect.value = initialCount;
    renderNameInputs(classicNamesContainer, initialCount, stored);
  }

  classicNumSelect.addEventListener('change', () => {
    const count = parseInt(classicNumSelect.value, 10);
    const stored = savedNames();
    renderNameInputs(classicNamesContainer, count, stored);
  });

  let game = null; // état de la partie en cours

  $('#btn-start-classic').addEventListener('click', () => {
    const count = parseInt(classicNumSelect.value, 10);
    const names = readNameInputs(classicNamesContainer, count);
    saveNames(names);
    const pointsSup = $('#classic-points-sup').checked;

    game = {
      mode: 'classic',
      players: names.map(name => ({ name, card: emptyScoreCard(), doubled: {} })),
      pointsSup,
      currentPlayerIndex: 0,
      dice: [1, 1, 1, 1, 1],
      held: [false, false, false, false, false],
      rollCount: 0,
      rolling: false,
      locked: false // true dès que le joueur choisit d'arrêter de lancer avant le 3e lancer
    };

    renderDice();
    renderClassicHeader();
    renderClassicTable();
    updateRollUI();
    showScreen('screen-classic-game');
  });

  /* ---------- Rendu des dés ---------- */

  const diceContainer = $('#dice-container');

  function renderDice() {
    if (!diceContainer.querySelector('.die-3d')) {
      buildDiceDOM(diceContainer, onDieClick);
    }
    updateDiceVisuals(diceContainer, game.dice, game.held);
  }

  function onDieClick(i) {
    if (game.rolling) return;
    if (game.rollCount === 0 || game.rollCount >= 3) return; // ne peut retenir qu'entre les lancers
    game.held[i] = !game.held[i];
    renderDice();
  }

  function renderClassicHeader() {
    const p = game.players[game.currentPlayerIndex];
    $('#current-player-banner').textContent = `Au tour de : ${p.name}`;
  }

  function updateRollUI() {
    const btn = $('#btn-roll');
    const passBtn = $('#btn-pass-turn');
    const left = 3 - game.rollCount;
    $('#rolls-left').textContent = game.rollCount === 0
      ? 'Aucun lancer effectué'
      : `Lancers restants : ${left}`;
    btn.disabled = game.rolling || game.rollCount >= 3 || game.locked;
    btn.textContent = game.rollCount === 0 ? '🎲 Lancer les dés' : '🎲 Relancer les dés';

    // Bouton "passer la main" : activé dès le 1er lancer, tant qu'il reste des relances possibles
    passBtn.disabled = game.rolling || game.rollCount < 1 || game.rollCount >= 3 || game.locked;
    passBtn.textContent = game.locked ? '✅ Lancers arrêtés — choisissez votre ligne' : '✅ Arrêter et marquer';
  }

  /* ---------- Lancer de dés avec animation 3D ---------- */

  $('#btn-roll').addEventListener('click', rollDice);

  $('#btn-pass-turn').addEventListener('click', () => {
    if (game.rolling || game.rollCount < 1 || game.rollCount >= 3 || game.locked) return;
    game.locked = true;
    updateRollUI();
  });

  function rollDice() {
    if (game.rolling || game.rollCount >= 3 || game.locked) return;
    game.rolling = true;
    updateRollUI();

    $all('.die-3d', diceContainer).forEach((wrap, i) => {
      if (game.held[i]) return;
      const cube = wrap.querySelector('.die-cube');
      // Petite variation de vitesse/sens par dé pour un effet de lancer plus naturel
      cube.style.animationDuration = (0.22 + Math.random() * 0.22).toFixed(2) + 's';
      cube.style.animationDirection = Math.random() < 0.5 ? 'reverse' : 'normal';
      cube.classList.add('rolling');
    });

    setTimeout(finishRoll, 1500);
  }

  function finishRoll() {
    game.dice = game.dice.map((v, i) => (game.held[i] ? v : 1 + Math.floor(Math.random() * 6)));
    game.rollCount += 1;
    game.rolling = false;

    $all('.die-3d .die-cube', diceContainer).forEach(cube => cube.classList.remove('rolling'));
    updateDiceVisuals(diceContainer, game.dice, game.held);
    updateRollUI();
    renderClassicTable();
  }

  /* ---------- Tableau des scores (partagé entre les 2 modes) ---------- */

  function renderScoreTable(table) {
    table.innerHTML = '';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.innerHTML = '<th class="row-label">Combinaison</th>' +
      game.players.map((p, i) => `<th>${escapeHtml(p.name)}${i === game.currentPlayerIndex ? ' 👈' : ''}</th>`).join('');
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    // Section supérieure
    tbody.appendChild(sectionTitleRow('Chiffres', game.players.length + 1));
    UPPER_KEYS.forEach(key => tbody.appendChild(buildScoreRow(UPPER_LABELS[key], key)));
    tbody.appendChild(subtotalRow('Sous-total (1-6)', UPPER_KEYS, game.players.length + 1, false));

    // Section inférieure
    tbody.appendChild(sectionTitleRow('Combinaisons', game.players.length + 1));
    LOWER_KEYS.forEach(key => tbody.appendChild(buildScoreRow(comboLabel(key, game.pointsSup), key)));

    // Total
    tbody.appendChild(subtotalRow('TOTAL', UPPER_KEYS.concat(LOWER_KEYS), game.players.length + 1, true));

    table.appendChild(tbody);
  }

  function renderClassicTable() { renderScoreTable($('#classic-score-table')); }

  function sectionTitleRow(label, colspan) {
    const tr = document.createElement('tr');
    tr.className = 'section-title';
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.textContent = label;
    tr.appendChild(td);
    return tr;
  }

  function subtotalRow(label, keys, colCountTotal, isTotal) {
    const tr = document.createElement('tr');
    tr.className = isTotal ? 'total-row' : 'subtotal-row';
    const labelTd = document.createElement('td');
    labelTd.className = 'row-label';
    labelTd.textContent = label;
    tr.appendChild(labelTd);

    game.players.forEach(p => {
      const td = document.createElement('td');
      const sum = keys.reduce((s, k) => s + (p.card[k] || 0), 0);
      td.textContent = sum;
      tr.appendChild(td);
    });
    return tr;
  }

  function buildScoreRow(label, key) {
    const tr = document.createElement('tr');
    const labelTd = document.createElement('td');
    labelTd.className = 'row-label';
    labelTd.textContent = label;
    tr.appendChild(labelTd);

    // Détermine si la ligne courante est jouable pour le joueur actif, pour appliquer
    // une surbrillance légère sur toute la ligne (verte = score possible, neutre = à barrer)
    const currentPlayer = game.players[game.currentPlayerIndex];
    const currentFilled = currentPlayer.card[key] !== null;
    const currentCanPlay = !currentFilled && game.rollCount >= 1 && !game.rolling;
    if (currentCanPlay) {
      const currentPreview = calcScore(key, game.dice, game.rollCount, game.pointsSup);
      tr.className = currentPreview > 0 ? 'row-playable' : 'row-barren';
    }

    game.players.forEach((p, playerIndex) => {
      const td = document.createElement('td');
      const filled = p.card[key] !== null;
      const isCurrent = playerIndex === game.currentPlayerIndex;
      const canPlay = isCurrent && !filled && game.rollCount >= 1 && !game.rolling;

      if (filled) {
        const wasDbl = p.doubled[key];
        td.innerHTML = p.card[key] + (wasDbl ? ' <span class="ps-star" title="Points sup. obtenus">⭐</span>' : '');
        td.className = 'score-cell filled' + (p.card[key] === 0 ? ' zero-score' : '');
      } else if (canPlay) {
        const preview = calcScore(key, game.dice, game.rollCount, game.pointsSup);
        const doubled = wasDoubled(key, preview, game.dice, game.rollCount, game.pointsSup);
        td.textContent = preview > 0 ? (preview + (doubled ? ' ⭐' : '')) : '0 (barrer)';
        td.className = 'score-cell empty-current' + (doubled ? ' doubled' : '');
        td.title = preview > 0
          ? (doubled ? 'Points sup. ! Score doublé car obtenu dès le 1er lancer.' : 'Cliquez pour valider ce score.')
          : 'Combinaison non réalisée : cliquez pour barrer cette ligne (0 point).';
        td.addEventListener('click', () => selectRow(key));
      } else {
        td.textContent = '–';
        td.className = 'score-cell other-empty';
      }
      tr.appendChild(td);
    });
    return tr;
  }

  function selectRow(key) {
    const player = game.players[game.currentPlayerIndex];
    const score = calcScore(key, game.dice, game.rollCount, game.pointsSup);
    const doubled = wasDoubled(key, score, game.dice, game.rollCount, game.pointsSup);
    player.card[key] = score;
    player.doubled[key] = doubled;
    nextTurn();
  }

  function nextTurn() {
    // Vérifie fin de partie
    const allFull = game.players.every(p => isCardFull(p.card));
    if (allFull) {
      endGame();
      return;
    }

    // Passe au joueur suivant
    let next = game.currentPlayerIndex;
    do {
      next = (next + 1) % game.players.length;
    } while (isCardFull(game.players[next].card));

    game.currentPlayerIndex = next;
    game.dice = [1, 1, 1, 1, 1];

    if (game.mode === 'classic') {
      game.held = [false, false, false, false, false];
      game.rollCount = 0;
      game.locked = false;
      renderDice();
      renderClassicHeader();
      renderClassicTable();
      updateRollUI();
    } else {
      game.rollCount = 2; // pas de bonus tant que "1er lancer" n'est pas recoché
      const firstRollBox = $('#sheet-first-roll');
      if (firstRollBox) firstRollBox.checked = false;
      renderSheetDice();
      renderSheetHeader();
      renderSheetTable();
    }
  }

  function endGame() {
    const results = game.players
      .map(p => ({ name: p.name, total: cardTotal(p.card) }))
      .sort((a, b) => b.total - a.total);

    const container = $('#final-results');
    container.innerHTML = '';
    results.forEach((r, i) => {
      const div = document.createElement('div');
      div.className = 'result-row' + (i === 0 ? ' winner' : '');
      div.innerHTML = `<span>${i === 0 ? '🏆 ' : ''}${escapeHtml(r.name)}</span><span>${r.total} pts</span>`;
      container.appendChild(div);
    });

    showScreen('screen-classic-end');
  }

  $('#btn-end-back-home').addEventListener('click', () => showScreen('screen-home'));

  /* ============================================================
     MODE 2 : TABLEAU DE SCORES (saisie des dés, score entré automatiquement)
     ============================================================ */

  const sheetNumSelect = $('#sheet-num-players');
  const sheetNamesContainer = $('#sheet-player-names');

  function initSheetSetup() {
    fillPlayerCountSelect(sheetNumSelect);
    const stored = savedNames();
    const initialCount = stored.length > 0 ? Math.min(Math.max(stored.length, 1), 8) : 2;
    sheetNumSelect.value = initialCount;
    renderNameInputs(sheetNamesContainer, initialCount, stored);
  }

  sheetNumSelect.addEventListener('change', () => {
    const count = parseInt(sheetNumSelect.value, 10);
    const stored = savedNames();
    renderNameInputs(sheetNamesContainer, count, stored);
  });

  $('#btn-generate-sheet').addEventListener('click', () => {
    const count = parseInt(sheetNumSelect.value, 10);
    const names = readNameInputs(sheetNamesContainer, count);
    saveNames(names);
    const pointsSup = $('#sheet-points-sup').checked;

    game = {
      mode: 'sheet',
      players: names.map(name => ({ name, card: emptyScoreCard(), doubled: {} })),
      pointsSup,
      currentPlayerIndex: 0,
      dice: [1, 1, 1, 1, 1],
      held: [false, false, false, false, false],
      rollCount: 2, // pas de doublement tant que la case "1er lancer" n'est pas cochée
      rolling: false
    };

    $('#sheet-first-roll-label').classList.toggle('hidden', !pointsSup);
    $('#sheet-first-roll').checked = false;

    renderSheetDice();
    renderSheetHeader();
    renderSheetTable();
    showScreen('screen-scoresheet-table');
  });

  $('#sheet-first-roll').addEventListener('change', () => {
    game.rollCount = $('#sheet-first-roll').checked ? 1 : 2;
    renderSheetTable();
  });

  function renderSheetDice() {
    const container = $('#sheet-dice-container');
    if (!container.querySelector('.die-3d')) {
      buildDiceDOM(container, onSheetDieClick);
    }
    updateDiceVisuals(container, game.dice, null);
  }

  function onSheetDieClick(i) {
    game.dice[i] = (game.dice[i] % 6) + 1;
    updateDiceVisuals($('#sheet-dice-container'), game.dice, null);
    renderSheetTable();
  }

  function renderSheetHeader() {
    const p = game.players[game.currentPlayerIndex];
    $('#sheet-current-player-banner').textContent = `Au tour de : ${p.name}`;
  }

  function renderSheetTable() { renderScoreTable($('#sheet-score-table')); }

  /* ===================== HELPERS ===================== */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
