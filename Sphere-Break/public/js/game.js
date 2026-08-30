(() => {
  const ENTRY_POSITIONS = [[1,1],[1,2],[2,1],[2,2]];
  const BORDER_POSITIONS = [
    [0,0],[0,1],[0,2],[0,3],
    [1,0],            [1,3],
    [2,0],            [2,3],
    [3,0],[3,1],[3,2],[3,3]
  ];
  const REAPPEAR_CHANCE = 0.55;
  const REAPPEAR_MIN_EMPTY_TURNS = 2;

  const el = {
    statName: document.getElementById('stat-name'),
    statWins: document.getElementById('stat-wins'),
    statLosses: document.getElementById('stat-losses'),
    statRatio: document.getElementById('stat-ratio'),
    statBest: document.getElementById('stat-best'),
    statGils: document.getElementById('stat-gils'),
    btnProfile: document.getElementById('btn-profile'),

    toggleComboMultiple: document.getElementById('toggle-combo-multiple'),
    toggleComboJetons: document.getElementById('toggle-combo-jetons'),

    screenDealer: document.getElementById('screen-dealer'),
    screenEntry: document.getElementById('screen-entry'),
    screenGame: document.getElementById('screen-game'),
    dealerGrid: document.getElementById('dealer-grid'),

    entryPicker: document.getElementById('entry-picker'),
    btnBackToDealer: document.getElementById('btn-back-to-dealer'),
    btnStartMatch: document.getElementById('btn-start-match'),

    hudTurn: document.getElementById('hud-turn'),
    hudTime: document.getElementById('hud-time'),
    hudQuota: document.getElementById('hud-quota'),
    hudQuotaFill: document.getElementById('hud-quota-fill'),
    hudCoreNumber: document.getElementById('hud-core-number'),
    hudSumValue: document.getElementById('hud-sum-value'),
    hudSumStatus: document.getElementById('hud-sum-status'),
    hudMultiplesList: document.getElementById('hud-multiples-list'),
    hudPrevMultiple: document.getElementById('hud-prev-multiple'),
    hudComboMultipleLine: document.getElementById('hud-combo-multiple-line'),
    hudComboMultipleValue: document.getElementById('hud-combo-multiple-value'),
    hudComboMultipleTarget: document.getElementById('hud-combo-multiple-target'),
    hudComboJetonsLine: document.getElementById('hud-combo-jetons-line'),
    hudComboJetonsValue: document.getElementById('hud-combo-jetons-value'),
    hudComboJetonsTarget: document.getElementById('hud-combo-jetons-target'),
    turnToast: document.getElementById('turn-toast'),
    coinGrid: document.getElementById('coin-grid'),
    comboFlash: document.getElementById('combo-flash'),
    btnHint: document.getElementById('btn-hint'),
    btnAbandon: document.getElementById('btn-abandon'),

    modalOverlay: document.getElementById('modal-overlay'),
    modalBox: document.getElementById('modal-box'),
    modalIcon: document.getElementById('modal-icon'),
    modalTitle: document.getElementById('modal-title'),
    modalBody: document.getElementById('modal-body'),
    modalClose: document.getElementById('modal-close'),

    profileOverlay: document.getElementById('profile-overlay'),
    inputPlayerName: document.getElementById('input-playername'),
    btnSaveName: document.getElementById('btn-save-name'),
    inputImportFile: document.getElementById('input-import-file'),
    btnExport: document.getElementById('btn-export'),
    inputAdjust: document.getElementById('input-adjust'),
    btnAdjust: document.getElementById('btn-adjust'),
    adjustCostPreview: document.getElementById('adjust-cost-preview'),
    adjustError: document.getElementById('adjust-error'),
    btnFullReset: document.getElementById('btn-full-reset'),
    btnCloseProfile: document.getElementById('btn-close-profile'),
  };

  let persistedStats = null;
  let selectedDealer = null;
  let entryPickTemp = new Set();
  let match = null;
  let idCounter = 0;
  let turnTimer = null;

  // Player's default combo-rule preference, chosen on the dealer-select
  // screen. A dealer with a forced combo rule overrides this for its match.
  let comboMultiplePref = true;
  let comboJetonsPref = false;

  const GIL_COST_PER_POINT = 200;

  function nextId(prefix) { return prefix + (idCounter++); }
  function randCoinValue() { return 1 + Math.floor(Math.random() * 9); }
  function randCoreNumber() { return 1 + Math.floor(Math.random() * 9); }

  function showScreen(name) {
    el.screenDealer.hidden = name !== 'dealer';
    el.screenEntry.hidden = name !== 'entry';
    el.screenGame.hidden = name !== 'game';
  }

  function loadStats() {
    return fetch('/api/stats')
      .then(r => r.json())
      .then(stats => { persistedStats = stats; renderStatStrip(); return stats; })
      .catch(() => {
        persistedStats = { playerName: 'Joueur', wins: 0, losses: 0, bestQuota: 0 };
        renderStatStrip();
        return persistedStats;
      });
  }

  function renderStatStrip() {
    if (!persistedStats) return;
    el.statName.textContent = persistedStats.playerName || 'Joueur';
    el.statWins.textContent = persistedStats.wins;
    el.statLosses.textContent = persistedStats.losses;
    const games = persistedStats.wins + persistedStats.losses;
    const ratio = games > 0 ? Math.round((persistedStats.wins / games) * 100) : 0;
    el.statRatio.textContent = ratio + '%';
    el.statBest.textContent = persistedStats.bestQuota;
    el.statGils.textContent = persistedStats.gils;
  }

  function renderComboToggles() {
    el.toggleComboMultiple.classList.toggle('active', comboMultiplePref);
    el.toggleComboJetons.classList.toggle('active', comboJetonsPref);
  }

  el.toggleComboMultiple.addEventListener('click', () => {
    comboMultiplePref = !comboMultiplePref;
    renderComboToggles();
  });
  el.toggleComboJetons.addEventListener('click', () => {
    comboJetonsPref = !comboJetonsPref;
    renderComboToggles();
  });

  // ================= SCREEN 1: dealer select =================
  function comboLabel(mode) {
    if (mode === 'multiple') return 'Multiple seul';
    if (mode === 'jetons') return 'Jetons seul';
    if (mode === 'both') return 'Multiple + Jetons';
    return '';
  }

  function renderDealerGrid() {
    el.dealerGrid.innerHTML = '';
    DEALERS.forEach(dealer => {
      const unlocked = isDealerUnlocked(dealer, persistedStats);
      const card = document.createElement('div');
      card.className = 'dealer-card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="dealer-card-name">${dealer.name}</div>
        <div class="dealer-card-stars">${'★'.repeat(dealer.stars)}${'☆'.repeat(5 - dealer.stars)}</div>
        <div class="dealer-card-stats">
          <span>Tours</span><b>${dealer.maxTurns}</b>
          <span>Temps/tour</span><b>${dealer.timeLimit}s</b>
          <span>Quota</span><b>${dealer.quota}</b>
          <span>Gils</span><b>${dealer.gilReward} G</b>
        </div>
        ${dealer.forcedCombo ? `<div class="dealer-card-forced">⚙ Combo imposé : ${comboLabel(dealer.forcedCombo)}</div>` : ''}
        ${unlocked ? '' : `<div class="dealer-card-lock">🔒 ${dealer.minWins} victoires ${dealer.mode === 'AND' ? 'ET' : 'OU'} ${dealer.minRatio}% de ratio</div>`}
      `;
      if (unlocked) {
        card.addEventListener('click', () => {
          selectedDealer = dealer;
          entryPickTemp = new Set();
          renderEntryPicker();
          showScreen('entry');
        });
      }
      el.dealerGrid.appendChild(card);
    });
  }

  // ================= SCREEN 2: entry coin pick =================
  function renderEntryPicker() {
    el.entryPicker.innerHTML = '';
    for (let v = 1; v <= 9; v++) {
      const picked = entryPickTemp.has(v);
      const disabled = !picked && entryPickTemp.size >= 4;
      const div = document.createElement('div');
      div.className = 'entry-pick-coin' + (picked ? ' picked' : '') + (disabled ? ' disabled-pick' : '');
      div.textContent = v;
      if (!disabled) {
        div.addEventListener('click', () => {
          if (entryPickTemp.has(v)) entryPickTemp.delete(v);
          else entryPickTemp.add(v);
          renderEntryPicker();
        });
      }
      el.entryPicker.appendChild(div);
    }
    el.btnStartMatch.disabled = entryPickTemp.size !== 4;
  }

  el.btnBackToDealer.addEventListener('click', () => showScreen('dealer'));
  el.btnStartMatch.addEventListener('click', () => {
    if (entryPickTemp.size !== 4) return;
    const combo = effectiveComboSettings(selectedDealer);
    startMatch(selectedDealer, [...entryPickTemp], combo);
    showScreen('game');
  });

  function effectiveComboSettings(dealer) {
    if (dealer.forcedCombo === 'multiple') return { multiple: true, jetons: false };
    if (dealer.forcedCombo === 'jetons') return { multiple: false, jetons: true };
    if (dealer.forcedCombo === 'both') return { multiple: true, jetons: true };
    return { multiple: comboMultiplePref, jetons: comboJetonsPref };
  }

  // ================= Match setup =================
  function buildGrid(entryValues) {
    const cells = [];
    ENTRY_POSITIONS.forEach(([row, col], i) => {
      cells.push({ row, col, type: 'entry', id: nextId('e'), value: entryValues[i], empty: false, emptyTurns: 0, anim: null });
    });
    BORDER_POSITIONS.forEach(([row, col]) => {
      cells.push({ row, col, type: 'border', id: nextId('b'), value: randCoinValue(), empty: false, emptyTurns: 0, anim: null });
    });
    return cells;
  }

  function startMatch(dealer, entryValues, combo) {
    match = {
      dealer,
      cells: buildGrid(entryValues),
      selection: new Set(),
      coreNumber: null,
      turnNumber: 1,
      timeLeft: dealer.timeLimit,
      quotaProgress: 0,
      comboMultipleActive: combo.multiple,
      comboJetonsActive: combo.jetons,
      lastValidatedMultiplier: null,
      comboMultipleCount: 0,
      lastValidatedTotalCoins: null,
      comboJetonsCount: 0,
      lastResult: null,
      resolving: false,
      gameOver: false
    };
    startTurn();
  }

  function startTurn() {
    match.coreNumber = randCoreNumber();
    match.selection = new Set();
    match.timeLeft = match.dealer.timeLimit;
    match.resolving = false;
    renderGame();
    setToast('');
    startTimer();
  }

  function findCell(id) { return match.cells.find(c => c.id === id); }
  function activeBorderCells() { return match.cells.filter(c => c.type === 'border' && !c.empty); }
  function entryCells() { return match.cells.filter(c => c.type === 'entry'); }

  function selectionSum() {
    let sum = 0;
    match.selection.forEach(id => {
      const c = findCell(id);
      if (c) sum += c.value;
    });
    return sum;
  }
  function hasEntrySelected() {
    return entryCells().some(c => match.selection.has(c.id));
  }
  function isValidSelection() {
    if (match.selection.size === 0 || !hasEntrySelected()) return false;
    const sum = selectionSum();
    return sum > 0 && sum % match.coreNumber === 0;
  }

  function renderGame() {
    if (!match) return;
    el.hudTurn.textContent = `${match.turnNumber}/${match.dealer.maxTurns}`;
    el.hudTime.textContent = formatTime(match.timeLeft);
    el.hudQuota.textContent = `${match.quotaProgress}/${match.dealer.quota}`;
    el.hudQuotaFill.style.width = Math.min(100, (match.quotaProgress / match.dealer.quota) * 100) + '%';

    el.hudCoreNumber.textContent = match.coreNumber == null ? '-' : match.coreNumber;

    const sum = selectionSum();
    el.hudSumValue.textContent = sum;
    const valid = isValidSelection();
    if (match.selection.size === 0) {
      el.hudSumStatus.textContent = '';
      el.hudSumStatus.className = 'pending-status';
    } else if (valid) {
      el.hudSumStatus.textContent = `✓ ×${sum / match.coreNumber}`;
      el.hudSumStatus.className = 'pending-status valid';
    } else {
      el.hudSumStatus.textContent = hasEntrySelected() ? 'pas un multiple' : 'ajoute un jeton orange';
      el.hudSumStatus.className = 'pending-status';
    }

    if (match.lastResult) {
      el.hudPrevMultiple.textContent = `Multiple ${match.lastResult.multiplier}`;
    } else {
      el.hudPrevMultiple.textContent = 'Multiple —';
    }

    el.hudComboMultipleLine.classList.toggle('inactive', !match.comboMultipleActive);
    el.hudComboMultipleValue.textContent = match.comboMultipleCount || 1;
    el.hudComboMultipleTarget.textContent = match.lastValidatedMultiplier == null
      ? ''
      : ` - Multiple ${match.lastValidatedMultiplier}`;

    el.hudComboJetonsLine.classList.toggle('inactive', !match.comboJetonsActive);
    el.hudComboJetonsValue.textContent = match.comboJetonsCount || 1;
    el.hudComboJetonsTarget.textContent = match.lastValidatedTotalCoins == null
      ? ''
      : ` - ${match.lastValidatedTotalCoins} jeton${match.lastValidatedTotalCoins > 1 ? 's' : ''}`;

    renderMultiplesList(sum);
    renderCoinGrid();
  }

  // Live, real-time list of upcoming multiples of the current core number,
  // trimmed as the live selection sum grows past each threshold.
  function renderMultiplesList(currentSum) {
    const core = match.coreNumber;
    const count = 6;
    const startMultiple = Math.floor(currentSum / core) + 1;
    const values = [];
    for (let i = 0; i < count; i++) {
      values.push(core * (startMultiple + i));
    }
    el.hudMultiplesList.textContent = `Multiple : ${values.join(', ')}, ...`;
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function showComboFlash(multipleActive, multipleFactor, multipleGain, jetonsActive, jetonsFactor, jetonsGain) {
    if (!multipleActive && !jetonsActive) return;
    let html = '';
    if (multipleActive) {
      html += `<div class="combo-flash-line flash-multiple">Combo Multiple ×${multipleFactor} = +${multipleGain}</div>`;
    }
    if (jetonsActive) {
      html += `<div class="combo-flash-line flash-jetons">Combo Jetons ×${jetonsFactor} = +${jetonsGain}</div>`;
    }
    el.comboFlash.innerHTML = html;
    el.comboFlash.classList.add('visible');
    setTimeout(() => {
      el.comboFlash.classList.remove('visible');
    }, 1500);
  }

  function setToast(text) {
    el.turnToast.textContent = text;
    el.turnToast.classList.toggle('visible', !!text);
  }

  function renderCoinGrid() {
    el.coinGrid.innerHTML = '';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const cell = match.cells.find(c => c.row === row && c.col === col);
        const div = document.createElement('div');

        if (!cell) { el.coinGrid.appendChild(div); continue; }

        if (cell.type === 'border' && cell.empty) {
          div.className = 'coin empty' + (cell.anim === 'appearing' ? ' appearing' : '');
        } else {
          div.className = 'coin ' + (cell.type === 'entry' ? 'entry-coin' : 'border-coin');
          const alreadyPicked = match.selection.has(cell.id);
          const needsEntryFirst = match.selection.size === 0 && cell.type === 'border';
          if (alreadyPicked) div.classList.add('selected');
          if (needsEntryFirst) div.classList.add('locked-first');
          if (cell.anim === 'disappearing') div.classList.add('disappearing');
          if (cell.anim === 'sparkle') div.classList.add('sparkle');
          div.textContent = cell.value;

          if (!match.resolving && !match.gameOver && !alreadyPicked && !needsEntryFirst) {
            div.addEventListener('click', () => toggleCoin(cell.id));
          }
        }
        el.coinGrid.appendChild(div);
      }
    }

    // Core Sphere badge, floating in the exact center of the grid
    const badge = document.createElement('div');
    badge.className = 'core-badge';
    badge.innerHTML = `<span class="core-badge-value">${match.coreNumber == null ? '-' : match.coreNumber}</span>`;
    el.coinGrid.appendChild(badge);
  }

  function totalSelectableCoins() {
    return entryCells().length + activeBorderCells().length;
  }
  function allSelectedButInvalid() {
    const total = totalSelectableCoins();
    return total > 0 && match.selection.size === total && !isValidSelection();
  }

  function toggleCoin(id) {
    if (match.resolving || match.gameOver) return;
    if (match.selection.has(id)) return; // no going back once a coin is picked

    const cell = findCell(id);
    if (!cell) return;

    // The first coin of a turn must be an entry (orange) coin.
    if (match.selection.size === 0 && cell.type !== 'entry') return;

    match.selection.add(id);
    renderGame();

    if (isValidSelection()) {
      resolveTurn();
      return;
    }

    // Loss condition: every available coin is selected and the sum still
    // isn't a valid multiple — no further coin can be added to fix it.
    if (allSelectedButInvalid()) {
      endMatch('loss', 'stuck');
    }
  }

  el.btnHint.addEventListener('click', () => {
    if (!match || match.resolving || match.gameOver) return;
    const combo = SphereSolver.findBestCombo(entryCells(), activeBorderCells(), match.coreNumber);
    if (!combo) {
      setToast('Aucune combinaison valide sur ce plateau.');
      setTimeout(() => setToast(''), 1800);
      return;
    }
    match.selection = new Set(combo.ids);
    renderGame();
    resolveTurn();
  });

  function resolveTurn() {
    clearInterval(turnTimer);
    match.resolving = true;

    const sum = selectionSum();
    const multiplier = sum / match.coreNumber;
    const usedBorderCells = [...match.selection]
      .map(id => findCell(id))
      .filter(c => c && c.type === 'border');

    const totalCoinsThisTurn = match.selection.size; // entry + border coins together

    // Both combo trackers always run, regardless of whether they count
    // toward quota this match — so the HUD can always show accurate numbers,
    // greyed out when inactive.
    const newComboMultiple = (multiplier === match.lastValidatedMultiplier) ? match.comboMultipleCount + 1 : 1;
    match.comboMultipleCount = newComboMultiple;
    match.lastValidatedMultiplier = multiplier;

    const newComboJetons = (totalCoinsThisTurn === match.lastValidatedTotalCoins) ? match.comboJetonsCount + 1 : 1;
    match.comboJetonsCount = newComboJetons;
    match.lastValidatedTotalCoins = totalCoinsThisTurn;

    // Quota gain: if both rules are active, each contributes its own gain
    // independently (added together) — they do NOT multiply each other.
    let quotaGain;
    let gainFromMultiple = 0;
    let gainFromJetons = 0;
    if (!match.comboMultipleActive && !match.comboJetonsActive) {
      quotaGain = usedBorderCells.length;
    } else {
      if (match.comboMultipleActive) gainFromMultiple = usedBorderCells.length * newComboMultiple;
      if (match.comboJetonsActive) gainFromJetons = usedBorderCells.length * newComboJetons;
      quotaGain = gainFromMultiple + gainFromJetons;
    }

    match.quotaProgress += quotaGain;
    match.lastResult = {
      core: match.coreNumber,
      multiplier,
      sum,
      coinsUsed: usedBorderCells.length,
      quotaGain,
      gainFromMultiple,
      gainFromJetons
    };

    setToast(`Tour validé ! +${quotaGain} quota`);
    showComboFlash(match.comboMultipleActive, newComboMultiple, gainFromMultiple, match.comboJetonsActive, newComboJetons, gainFromJetons);

    usedBorderCells.forEach(c => { c.anim = 'disappearing'; });
    renderGame();

    setTimeout(() => {
      const usedIds = new Set(usedBorderCells.map(c => c.id));

      match.cells.forEach(c => {
        if (c.type === 'border' && c.empty) c.emptyTurns += 1;
      });

      match.cells.forEach(c => {
        if (usedIds.has(c.id)) {
          c.empty = true;
          c.value = null;
          c.emptyTurns = 0;
          c.anim = null;
        }
      });

      match.cells.forEach(c => {
        if (c.type === 'border' && !c.empty) {
          if (c.value >= 9) {
            c.empty = true;
            c.value = null;
            c.emptyTurns = 0;
            c.anim = null;
          } else {
            c.value += 1;
            c.anim = 'sparkle';
          }
        }
      });

      renderGame();

      setTimeout(() => {
        match.cells.forEach(c => {
          if (c.anim === 'sparkle') c.anim = null;
        });

        match.cells.forEach(c => {
          if (c.type === 'border' && c.empty && c.emptyTurns >= REAPPEAR_MIN_EMPTY_TURNS) {
            if (Math.random() < REAPPEAR_CHANCE) {
              c.empty = false;
              c.value = randCoinValue();
              c.emptyTurns = 0;
              c.anim = 'appearing';
            }
          }
        });

        renderGame();

        setTimeout(() => {
          match.cells.forEach(c => { if (c.anim === 'appearing') c.anim = null; });
          setToast('');
          proceedAfterTurn();
        }, 1500);
      }, 500);
    }, 1000);
  }

  function proceedAfterTurn() {
    if (match.quotaProgress >= match.dealer.quota) {
      endMatch('win', 'quota');
      return;
    }
    if (match.turnNumber >= match.dealer.maxTurns) {
      endMatch('loss', 'turns');
      return;
    }
    match.turnNumber += 1;
    startTurn();
  }

  function startTimer() {
    clearInterval(turnTimer);
    turnTimer = setInterval(() => {
      match.timeLeft -= 1;
      el.hudTime.textContent = formatTime(Math.max(0, match.timeLeft));
      if (match.timeLeft <= 0) {
        clearInterval(turnTimer);
        endMatch('loss', 'time');
      }
    }, 1000);
  }

  function endMatch(outcome, reason) {
    if (match.gameOver) return;
    match.gameOver = true;
    match.resolving = true;
    clearInterval(turnTimer);
    renderGame();

    const reasonText = {
      quota: 'Quota atteint !',
      turns: 'Plus de tours disponibles.',
      time: 'Le temps est écoulé sur un tour.',
      stuck: 'Tous les jetons étaient sélectionnés sans somme valide.'
    }[reason] || '';

    fetch('/api/stats/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        outcome,
        dealerId: match.dealer.id,
        quotaReached: match.quotaProgress,
        quotaTarget: match.dealer.quota,
        gilsEarned: outcome === 'win' ? match.dealer.gilReward : 0
      })
    })
      .then(r => r.json())
      .then(stats => {
        persistedStats = stats;
        renderStatStrip();
        showModal(outcome, reasonText);
      })
      .catch(() => showModal(outcome, reasonText));
  }

  el.btnAbandon.addEventListener('click', () => {
    if (!match) { showScreen('dealer'); return; }
    if (!confirm('Abandonner cette manche et revenir au choix du croupier ? Ta progression sur ce croupier sera perdue (non comptée comme défaite).')) return;
    clearInterval(turnTimer);
    match = null;
    renderDealerGrid();
    showScreen('dealer');
  });

  function showModal(outcome, reasonText) {
    const won = outcome === 'win';
    el.modalBox.className = 'modal ' + (won ? 'outcome-win' : 'outcome-loss');
    el.modalIcon.textContent = won ? '✓' : '✕';
    el.modalTitle.textContent = won ? 'VICTOIRE — Croupier battu !' : 'DÉFAITE';
    const gilLine = won ? ` +${match.dealer.gilReward} Gils.` : '';
    el.modalBody.textContent = `${reasonText} Quota atteint : ${match.quotaProgress} / ${match.dealer.quota}.${gilLine}`;
    el.modalOverlay.classList.add('visible');
  }

  el.modalClose.addEventListener('click', () => {
    el.modalOverlay.classList.remove('visible');
    renderDealerGrid();
    showScreen('dealer');
  });

  // ================= Profile / save management =================
  el.btnProfile.addEventListener('click', () => {
    el.inputPlayerName.value = persistedStats ? persistedStats.playerName : '';
    el.profileOverlay.classList.add('visible');
  });
  el.btnCloseProfile.addEventListener('click', () => {
    el.profileOverlay.classList.remove('visible');
  });

  el.btnSaveName.addEventListener('click', () => {
    const name = el.inputPlayerName.value.trim();
    if (!name) return;
    fetch('/api/stats/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: name })
    })
      .then(r => r.json())
      .then(stats => { persistedStats = stats; renderStatStrip(); renderDealerGrid(); });
  });

  el.inputImportFile.addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      const payload = {};
      const nameMatch = text.match(/^\s*(?:nom|name)\s*=\s*(.+)$/im);
      const winsMatch = text.match(/^\s*(?:victoires|wins)\s*=\s*(\d+)/im);
      const lossesMatch = text.match(/^\s*(?:defaites|défaites|losses)\s*=\s*(\d+)/im);
      const gilsMatch = text.match(/^\s*(?:gils|gil|gold)\s*=\s*(\d+)/im);
      if (nameMatch) payload.playerName = nameMatch[1].trim();
      if (winsMatch) payload.wins = parseInt(winsMatch[1], 10);
      if (lossesMatch) payload.losses = parseInt(lossesMatch[1], 10);
      if (gilsMatch) payload.gils = parseInt(gilsMatch[1], 10);

      if (!payload.playerName && payload.wins === undefined && payload.losses === undefined && payload.gils === undefined) {
        alert('Fichier illisible. Format attendu : nom=..., victoires=..., defaites=..., gils=... (une valeur par ligne).');
        return;
      }

      fetch('/api/stats/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(r => r.json())
        .then(stats => {
          persistedStats = stats;
          renderStatStrip();
          renderDealerGrid();
          alert('Sauvegarde importée.');
        });
    };
    reader.readAsText(file);
  });

  el.btnExport.addEventListener('click', () => {
    if (!persistedStats) return;
    const content = `nom=${persistedStats.playerName}\nvictoires=${persistedStats.wins}\ndefaites=${persistedStats.losses}\ngils=${persistedStats.gils}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spherebreak-save.txt';
    a.click();
    URL.revokeObjectURL(url);
  });

  function updateAdjustPreview() {
    const amount = parseInt(el.inputAdjust.value, 10);
    el.adjustError.textContent = '';
    if (!Number.isFinite(amount) || amount <= 0) {
      el.adjustCostPreview.textContent = '';
      el.btnAdjust.disabled = false;
      return;
    }
    const cost = amount * GIL_COST_PER_POINT;
    el.adjustCostPreview.textContent = `Coût : ${cost} G (solde actuel : ${persistedStats ? persistedStats.gils : 0} G)`;
    if (persistedStats && amount > persistedStats.losses) {
      el.adjustError.textContent = `Tu n'as que ${persistedStats.losses} défaite(s).`;
    } else if (persistedStats && cost > persistedStats.gils) {
      el.adjustError.textContent = `Gils insuffisants (${cost} G nécessaires).`;
    }
  }
  el.inputAdjust.addEventListener('input', updateAdjustPreview);

  el.btnAdjust.addEventListener('click', () => {
    const amount = parseInt(el.inputAdjust.value, 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    el.adjustError.textContent = '';
    fetch('/api/stats/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          el.adjustError.textContent = data.error || 'Erreur inconnue.';
          return;
        }
        persistedStats = data;
        renderStatStrip();
        renderDealerGrid();
        el.inputAdjust.value = '';
        el.adjustCostPreview.textContent = '';
      });
  });

  el.btnFullReset.addEventListener('click', () => {
    if (!confirm('Réinitialiser complètement les statistiques (victoires, défaites, meilleur quota) ? Cette action est irréversible.')) return;
    fetch('/api/stats/reset', { method: 'POST' })
      .then(r => r.json())
      .then(stats => {
        persistedStats = stats;
        renderStatStrip();
        renderDealerGrid();
      });
  });

  loadStats().then(() => {
    renderComboToggles();
    renderDealerGrid();
    showScreen('dealer');
  });
})();
