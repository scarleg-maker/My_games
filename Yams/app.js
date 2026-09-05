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
  const LS_SAVE_KEY = 'yams_saved_game';
  const LS_HOF_KEY = 'yams_hall_of_fame';

  /* ===================== UTILITAIRES ===================== */

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function showScreen(id) {
    $all('.screen').forEach(s => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
    if (id === 'screen-home') checkForSavedGame();
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

  /* ===================== SAUVEGARDE DE PARTIE ===================== */

  function saveCurrentGame() {
    if (!game) return;
    const snapshot = Object.assign({}, game, { rolling: false, savedAt: new Date().toISOString() });
    localStorage.setItem(LS_SAVE_KEY, JSON.stringify(snapshot));
  }

  function loadSavedGame() {
    try {
      const raw = localStorage.getItem(LS_SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function deleteSavedGame() {
    localStorage.removeItem(LS_SAVE_KEY);
  }

  function flashSaveConfirm(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('hidden');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 2000);
  }

  function checkForSavedGame() {
    const saved = loadSavedGame();
    const banner = $('#resume-banner');
    if (!saved) {
      banner.classList.add('hidden');
      return;
    }
    const modeLabel = saved.mode === 'classic' ? 'Jeu classique' : 'Tableau de scores';
    const current = saved.players[saved.currentPlayerIndex];
    $('#resume-text').textContent = `Une partie est en attente : ${modeLabel} — ${saved.players.length} joueur(s), au tour de ${current ? current.name : '?'}.`;
    banner.classList.remove('hidden');
  }

  function resumeSavedGame() {
    const saved = loadSavedGame();
    if (!saved) return;
    game = saved;
    game.rolling = false;

    if (game.mode === 'classic') {
      renderDice();
      renderClassicHeader();
      renderClassicTable();
      updateRollUI();
      showScreen('screen-classic-game');
    } else {
      renderSheetHeader();
      renderSheetTable();
      showScreen('screen-scoresheet-table');
    }
  }

  /* ===================== PALMARES (5 MEILLEURS SCORES) ===================== */

  function loadHallOfFame() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_HOF_KEY) || '[]');
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function addResultsToHallOfFame(players, pointsSup) {
    const hof = loadHallOfFame();
    players.forEach(p => {
      hof.push({ name: p.name, score: cardTotal(p.card), pointsSup: !!pointsSup, date: new Date().toISOString() });
    });
    hof.sort((a, b) => b.score - a.score);
    localStorage.setItem(LS_HOF_KEY, JSON.stringify(hof.slice(0, 5)));
  }

  function renderHallOfFame() {
    const hof = loadHallOfFame();
    const container = $('#hof-list');
    if (hof.length === 0) {
      container.innerHTML = '<p class="hof-empty">Aucune partie terminée pour le moment. Jouez une partie pour apparaître ici !</p>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    container.innerHTML = hof.map((entry, i) => `
      <div class="hof-row">
        <span class="hof-rank">${medals[i] || (i + 1) + '.'}</span>
        <span class="hof-name">${escapeHtml(entry.name)}</span>
        <span class="hof-score">${entry.score} pts</span>
        <span class="hof-ps${entry.pointsSup ? ' active' : ''}">${entry.pointsSup ? '⭐ Points sup.' : '—'}</span>
      </div>
    `).join('');
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

  // Vérifie qu'un score saisi manuellement (mode Tableau) est cohérent avec la combinaison visée
  function isValidScoreForRow(key, value, pointsSup) {
    if (typeof key === 'number') {
      const allowed = [0, 1, 2, 3, 4, 5].map(n => n * key);
      return allowed.includes(value);
    }
    switch (key) {
      case 'brelan':
      case 'carre':
      case 'somme':
        return value === 0 || (value >= 5 && value <= 30);
      case 'full':
      case 'petiteSuite':
      case 'grandeSuite':
      case 'yam': {
        const base = COMBO_BASE_POINTS[key];
        const allowed = pointsSup ? [0, base, base * 2] : [0, base];
        return allowed.includes(value);
      }
    }
    return false;
  }

  // Indique si le score saisi correspond au montant doublé (pour l'étoile ⭐ et le suivi "Points sup.")
  function isDoubledValue(key, value, pointsSup) {
    if (!pointsSup || !DOUBLABLE.includes(key)) return false;
    return value === COMBO_BASE_POINTS[key] * 2;
  }

  // Texte d'aide indiquant les valeurs acceptées pour une ligne donnée
  function validValuesHint(key, pointsSup) {
    if (typeof key === 'number') {
      const vals = [0, 1, 2, 3, 4, 5].map(n => n * key);
      return `Valeurs possibles : ${vals.join(', ')}`;
    }
    switch (key) {
      case 'brelan':
      case 'carre':
      case 'somme':
        return 'Valeur possible : 0, ou un total entre 5 et 30';
      case 'full':
      case 'petiteSuite':
      case 'grandeSuite':
      case 'yam': {
        const base = COMBO_BASE_POINTS[key];
        return pointsSup
          ? `Valeurs possibles : 0, ${base} ou ${base * 2} (avec Points sup.)`
          : `Valeurs possibles : 0 ou ${base}`;
      }
    }
    return '';
  }

  /* ---------- Modale de saisie de score (mode Tableau) ---------- */

  let pendingEntry = null; // { key, playerIndex }

  function openScoreEntryModal(key, playerIndex) {
    pendingEntry = { key, playerIndex };
    const player = game.players[playerIndex];
    const label = typeof key === 'number' ? UPPER_LABELS[key] : LOWER_LABELS[key];
    $('#score-entry-title').textContent = `${player.name} — ${label}`;
    $('#score-entry-hint').textContent = validValuesHint(key, game.pointsSup);
    $('#score-entry-input').value = '';
    $('#score-entry-error').textContent = '';
    $('#score-entry-modal').classList.remove('hidden');
    setTimeout(() => $('#score-entry-input').focus(), 50);
  }

  function closeScoreEntryModal() {
    pendingEntry = null;
    $('#score-entry-modal').classList.add('hidden');
  }

  function submitScoreEntry() {
    if (!pendingEntry) return;
    const raw = $('#score-entry-input').value.trim();
    if (raw === '') {
      $('#score-entry-error').textContent = 'Veuillez entrer une valeur.';
      return;
    }
    const value = parseInt(raw, 10);
    if (isNaN(value) || value < 0) {
      $('#score-entry-error').textContent = 'Merci d’entrer un nombre valide.';
      return;
    }
    const { key, playerIndex } = pendingEntry;
    if (!isValidScoreForRow(key, value, game.pointsSup)) {
      $('#score-entry-error').textContent = `Score impossible pour cette ligne. ${validValuesHint(key, game.pointsSup)}.`;
      return;
    }
    const player = game.players[playerIndex];
    player.card[key] = value;
    player.doubled[key] = isDoubledValue(key, value, game.pointsSup);
    closeScoreEntryModal();
    nextTurn();
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

  $('#btn-goto-hof').addEventListener('click', () => {
    renderHallOfFame();
    $('#hof-modal').classList.remove('hidden');
  });
  $('#btn-close-hof').addEventListener('click', () => $('#hof-modal').classList.add('hidden'));
  $('#hof-modal').addEventListener('click', (e) => {
    if (e.target.id === 'hof-modal') $('#hof-modal').classList.add('hidden');
  });

  $('#btn-resume-game').addEventListener('click', resumeSavedGame);
  $('#btn-delete-save').addEventListener('click', () => {
    deleteSavedGame();
    checkForSavedGame();
  });

  $('#btn-score-entry-submit').addEventListener('click', submitScoreEntry);
  $('#btn-score-entry-cancel').addEventListener('click', closeScoreEntryModal);
  $('#btn-close-score-entry').addEventListener('click', closeScoreEntryModal);
  $('#score-entry-modal').addEventListener('click', (e) => {
    if (e.target.id === 'score-entry-modal') closeScoreEntryModal();
  });
  $('#score-entry-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitScoreEntry();
  });

  $('#btn-save-classic').addEventListener('click', () => {
    saveCurrentGame();
    flashSaveConfirm('#save-confirm-classic');
  });
  $('#btn-save-sheet').addEventListener('click', () => {
    saveCurrentGame();
    flashSaveConfirm('#save-confirm-sheet');
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

    const currentPlayer = game.players[game.currentPlayerIndex];
    const currentFilled = currentPlayer.card[key] !== null;

    // Surbrillance légère de toute la ligne quand le joueur courant peut y jouer
    if (game.mode === 'classic') {
      const currentCanPlay = !currentFilled && game.rollCount >= 1 && !game.rolling;
      if (currentCanPlay) {
        const currentPreview = calcScore(key, game.dice, game.rollCount, game.pointsSup);
        tr.className = currentPreview > 0 ? 'row-playable' : 'row-barren';
      }
    } else if (!currentFilled) {
      tr.className = 'row-playable';
    }

    game.players.forEach((p, playerIndex) => {
      const td = document.createElement('td');
      const filled = p.card[key] !== null;
      const isCurrent = playerIndex === game.currentPlayerIndex;

      if (filled) {
        const wasDbl = p.doubled[key];
        td.innerHTML = p.card[key] + (wasDbl ? ' <span class="ps-star" title="Points sup. obtenus">⭐</span>' : '');
        td.className = 'score-cell filled' + (p.card[key] === 0 ? ' zero-score' : '');
      } else if (game.mode === 'classic') {
        const canPlay = isCurrent && !filled && game.rollCount >= 1 && !game.rolling;
        if (canPlay) {
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
      } else {
        // Mode Tableau : seul le joueur en cours peut saisir un score sur cette ligne
        if (isCurrent) {
          td.textContent = '✎ Saisir';
          td.className = 'score-cell empty-current';
          td.title = 'Cliquez pour indiquer le score obtenu sur cette ligne.';
          td.addEventListener('click', () => openScoreEntryModal(key, playerIndex));
        } else {
          td.textContent = '–';
          td.className = 'score-cell other-empty';
        }
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

    if (game.mode === 'classic') {
      game.dice = [1, 1, 1, 1, 1];
      game.held = [false, false, false, false, false];
      game.rollCount = 0;
      game.locked = false;
      renderDice();
      renderClassicHeader();
      renderClassicTable();
      updateRollUI();
    } else {
      renderSheetHeader();
      renderSheetTable();
    }
  }

  function endGame() {
    addResultsToHallOfFame(game.players, game.pointsSup);
    deleteSavedGame();

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
     MODE 2 : TABLEAU DE SCORES (saisie manuelle vérifiée par ligne)
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
      currentPlayerIndex: 0
    };

    renderSheetHeader();
    renderSheetTable();
    showScreen('screen-scoresheet-table');
  });

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

  /* ===================== INITIALISATION ===================== */
  checkForSavedGame();

})();
