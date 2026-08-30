(function () {
  const match = window.location.pathname.match(/joueur(\d+)\.html/i);
  const playerNum = match ? parseInt(match[1], 10) : null;

  const socket = io();

  const el = (id) => document.getElementById(id);
  const balanceAmountEl = el('balance-amount');
  const playerNameEl = el('player-name');
  const totalBetEl = el('total-bet');
  const historyListEl = el('history-list');
  const hotRowEl = el('hot-row');
  const coldRowEl = el('cold-row');
  const hotcoldBtn = el('hotcold-btn');
  const hotcoldPanel = el('hotcold-panel');
  const waitingOverlay = el('waiting-overlay');
  const bankruptOverlay = el('bankrupt-overlay');
  const goodbyeOverlay = el('goodbye-overlay');
  const numbersGrid = el('numbers-grid');
  const overlayLayer = el('overlay-layer');
  const zeroOverlayLayer = el('zero-overlay-layer');
  const columnsWrap = el('columns-wrap');
  const streetsWrap = el('streets-wrap');
  const repeatBtn = el('repeat-btn');
  const resultFlash = el('result-flash');
  const resultFlashNumber = el('result-flash-number');
  const resultFlashGain = el('result-flash-gain');
  const autoCountdownBadge = el('auto-countdown-badge');
  const autoCountdownValue = el('auto-countdown-value');

  let selectedChip = null;
  let currentBets = {};
  let currentBalance = 0;
  let lastBets = {};

  function fmt(n) { return n.toFixed(2).replace('.', ',') + ' €'; }
  function colorClass(c) { return c === 'red' ? 'c-red' : c === 'black' ? 'c-black' : 'c-green'; }

  function updateRepeatBtn() {
    repeatBtn.disabled = !lastBets || Object.keys(lastBets).length === 0;
  }

  // -------------------- Build the number grid (3 rows x 12 cols) --------------------
  // row0=top(3,6,9..36) row1=mid(2,5,8..35) row2=bottom(1,4,7..34) -- matches server GRID
  const GRID = [[], [], []];
  for (let col = 0; col < 12; col++) {
    const base = col * 3;
    GRID[2][col] = base + 1;
    GRID[1][col] = base + 2;
    GRID[0][col] = base + 3;
  }

  const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

  function colorOfNumber(n) {
    if (n === 0) return 'green';
    return RED_SET.has(n) ? 'red' : 'black';
  }

  // Every number (0-36) covered by a given bet key, used to highlight the
  // grid when that bet is active.
  function numbersForKey(key) {
    if (key.startsWith('straight-')) return [parseInt(key.split('-')[1], 10)];
    if (key.startsWith('split-')) return key.split('-').slice(1).map(Number);
    if (key.startsWith('corner-')) return key.split('-').slice(1).map(Number);
    if (key === 'trio-0-1-2') return [0, 1, 2];
    if (key === 'trio-0-2-3') return [0, 2, 3];
    if (key.startsWith('street-')) {
      const col = parseInt(key.split('-')[1], 10);
      return [1, 2, 3].map(o => 3 * (col - 1) + o);
    }
    if (key.startsWith('doublestreet-')) {
      const col = parseInt(key.split('-')[1], 10);
      return [1, 2, 3, 4, 5, 6].map(o => 3 * (col - 1) + o);
    }
    if (key.startsWith('column-')) {
      const rem = parseInt(key.split('-')[1], 10);
      const nums = [];
      for (let n = 1; n <= 36; n++) { const r = n % 3 === 0 ? 3 : n % 3; if (r === rem) nums.push(n); }
      return nums;
    }
    if (key.startsWith('dozen-')) {
      const d = parseInt(key.split('-')[1], 10);
      const nums = [];
      for (let n = (d - 1) * 12 + 1; n <= d * 12; n++) nums.push(n);
      return nums;
    }
    if (key === 'color-red') return [...RED_SET];
    if (key === 'color-black') { const nums = []; for (let n = 1; n <= 36; n++) if (!RED_SET.has(n)) nums.push(n); return nums; }
    if (key === 'parity-even') { const nums = []; for (let n = 2; n <= 36; n += 2) nums.push(n); return nums; }
    if (key === 'parity-odd') { const nums = []; for (let n = 1; n <= 36; n += 2) nums.push(n); return nums; }
    if (key === 'range-low') { const nums = []; for (let n = 1; n <= 18; n++) nums.push(n); return nums; }
    if (key === 'range-high') { const nums = []; for (let n = 19; n <= 36; n++) nums.push(n); return nums; }
    return [];
  }

  // Payout multiplier (total return incl. stake) for a given bet key.
  function multiplierForKey(key) {
    if (key.startsWith('straight-')) return 36;
    if (key.startsWith('split-')) return 18;
    if (key.startsWith('street-')) return 12;
    if (key.startsWith('doublestreet-')) return 6;
    if (key.startsWith('corner-')) return 9;
    if (key.startsWith('trio-')) return 12;
    if (key.startsWith('column-') || key.startsWith('dozen-')) return 3;
    return 2; // color, parity, range
  }

  const cellsByNumber = {};
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 12; c++) {
      const num = GRID[r][c];
      const cell = document.createElement('div');
      cell.className = 'num-cell ' + colorOfNumber(num);
      cell.style.gridColumn = (c + 1);
      cell.style.gridRow = (r + 1);
      cell.dataset.key = 'straight-' + num;
      cell.innerHTML = `<span>${num}</span>`;
      numbersGrid.appendChild(cell);
      cellsByNumber[num] = cell;
    }
  }

  // -------------------- Colonne (column) boxes, right of the grid --------------------
  // row0(top,%3==0) -> column-3 | row1(mid,%3==2) -> column-2 | row2(bottom,%3==1) -> column-1
  const COLUMN_LABELS = ['Colonne 3-6-9...36', 'Colonne 2-5-8...35', 'Colonne 1-4-7...34'];
  const COLUMN_KEYS = ['column-3', 'column-2', 'column-1'];
  COLUMN_KEYS.forEach((key, i) => {
    const box = document.createElement('div');
    box.className = 'bet-box';
    box.dataset.key = key;
    box.innerHTML = `<span style="font-size:10px;">${COLUMN_LABELS[i]}</span>`;
    columnsWrap.appendChild(box);
  });

  // -------------------- Corners (carre) + splits (cheval) --------------------
  function buildOverlay() {
    overlayLayer.innerHTML = '';
    const containerRect = numbersGrid.getBoundingClientRect();

    function place(elm, x, y) {
      elm.style.left = x + 'px';
      elm.style.top = y + 'px';
      overlayLayer.appendChild(elm);
    }

    // corners: 2 row-boundaries x 11 col-boundaries
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 11; c++) {
        const nums = [GRID[r][c], GRID[r][c + 1], GRID[r + 1][c], GRID[r + 1][c + 1]];
        const rects = nums.map(n => cellsByNumber[n].getBoundingClientRect());
        const x = rects.reduce((a, rc) => a + (rc.left + rc.right) / 2, 0) / 4 - containerRect.left;
        const y = rects.reduce((a, rc) => a + (rc.top + rc.bottom) / 2, 0) / 4 - containerRect.top;
        const key = 'corner-' + [...nums].sort((a, b) => a - b).join('-');
        const btn = document.createElement('div');
        btn.className = 'corner-btn';
        btn.dataset.key = key;
        btn.title = 'Carre : ' + nums.join(', ') + ' (x9)';
        btn.addEventListener('click', () => handleCellClick(key));
        place(btn, x, y);
      }
    }

    // horizontal splits: same row, adjacent columns
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 11; c++) {
        const a = GRID[r][c], b = GRID[r][c + 1];
        const ra = cellsByNumber[a].getBoundingClientRect();
        const rb = cellsByNumber[b].getBoundingClientRect();
        const x = (ra.right + rb.left) / 2 - containerRect.left;
        const y = (ra.top + ra.bottom) / 2 - containerRect.top;
        const key = 'split-' + [a, b].sort((x, y) => x - y).join('-');
        const btn = document.createElement('div');
        btn.className = 'split-btn h';
        btn.dataset.key = key;
        btn.title = `Cheval : ${a}, ${b} (x18)`;
        btn.addEventListener('click', () => handleCellClick(key));
        place(btn, x, y);
      }
    }

    // vertical splits: same column, adjacent rows
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 12; c++) {
        const a = GRID[r][c], b = GRID[r + 1][c];
        const ra = cellsByNumber[a].getBoundingClientRect();
        const rb = cellsByNumber[b].getBoundingClientRect();
        const x = (ra.left + ra.right) / 2 - containerRect.left;
        const y = (ra.bottom + rb.top) / 2 - containerRect.top;
        const key = 'split-' + [a, b].sort((x, y) => x - y).join('-');
        const btn = document.createElement('div');
        btn.className = 'split-btn v';
        btn.dataset.key = key;
        btn.title = `Cheval : ${a}, ${b} (x18)`;
        btn.addEventListener('click', () => handleCellClick(key));
        place(btn, x, y);
      }
    }
  }

  // -------------------- Streets (transversale simple) + double streets --------------------
  function buildStreets() {
    streetsWrap.innerHTML = '';
    const wrapRect = streetsWrap.getBoundingClientRect();
    const colX = [];
    for (let c = 0; c < 12; c++) {
      const rect = cellsByNumber[GRID[0][c]].getBoundingClientRect();
      colX[c] = (rect.left + rect.right) / 2 - wrapRect.left;
    }
    for (let c = 0; c < 12; c++) {
      const nums = [1, 2, 3].map(o => 3 * c + o);
      const key = 'street-' + (c + 1);
      const btn = document.createElement('div');
      btn.className = 'street-btn';
      btn.dataset.key = key;
      btn.title = `Transversale simple : ${nums.join(', ')} (x12)`;
      btn.style.left = colX[c] + 'px';
      btn.addEventListener('click', () => handleCellClick(key));
      streetsWrap.appendChild(btn);
    }
    for (let c = 0; c < 11; c++) {
      const nums = [1, 2, 3, 4, 5, 6].map(o => 3 * c + o);
      const key = 'doublestreet-' + (c + 1);
      const btn = document.createElement('div');
      btn.className = 'doublestreet-btn';
      btn.dataset.key = key;
      btn.title = `Transversale double : ${nums.join(', ')} (x6)`;
      btn.style.left = ((colX[c] + colX[c + 1]) / 2) + 'px';
      btn.addEventListener('click', () => handleCellClick(key));
      streetsWrap.appendChild(btn);
    }
  }

  // -------------------- Zero-adjacent bets: 0-1/0-2/0-3 (cheval) + 0-1-2/0-2-3 (trio) --------------------
  function buildZeroCombos() {
    zeroOverlayLayer.innerHTML = '';
    const gridEl = document.querySelector('.table-grid');
    const gridRect = gridEl.getBoundingClientRect();
    const r1 = cellsByNumber[1].getBoundingClientRect();
    const r2 = cellsByNumber[2].getBoundingClientRect();
    const r3 = cellsByNumber[3].getBoundingClientRect();
    const x = r1.left - gridRect.left; // shared boundary between the 0 cell and column 1

    function place(key, yViewport, cls, tooltip) {
      const btn = document.createElement('div');
      btn.className = cls;
      btn.dataset.key = key;
      btn.title = tooltip;
      btn.style.left = x + 'px';
      btn.style.top = (yViewport - gridRect.top) + 'px';
      btn.addEventListener('click', () => handleCellClick(key));
      zeroOverlayLayer.appendChild(btn);
    }

    place('split-0-1', (r1.top + r1.bottom) / 2, 'zero-split-btn', 'Cheval : 0, 1 (x18)');
    place('split-0-2', (r2.top + r2.bottom) / 2, 'zero-split-btn', 'Cheval : 0, 2 (x18)');
    place('split-0-3', (r3.top + r3.bottom) / 2, 'zero-split-btn', 'Cheval : 0, 3 (x18)');
    place('trio-0-1-2', (r1.top + r2.bottom) / 2, 'zero-trio-btn', 'Trio : 0, 1, 2 (x12)');
    place('trio-0-2-3', (r2.top + r3.bottom) / 2, 'zero-trio-btn', 'Trio : 0, 2, 3 (x12)');
  }

  function rebuildOverlays() {
    buildOverlay();
    buildStreets();
    buildZeroCombos();
    renderBets(currentBets); // targets were just recreated; redraw any active tokens onto them
  }
  let resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(rebuildOverlays, 150);
  });
  setTimeout(rebuildOverlays, 80);

  // -------------------- Betting interactions --------------------
  let eraserMode = false;
  const eraserBtn = el('eraser-btn');

  function handleCellClick(key) {
    if (eraserMode) {
      socket.emit('remove-bet', { key });
      return;
    }
    if (!selectedChip) { flashHint(); return; }
    socket.emit('place-bet', { key, amount: selectedChip });
  }

  function flashHint() {
    const bar = document.querySelector('.chip-bar');
    bar.style.filter = 'brightness(1.6)';
    setTimeout(() => (bar.style.filter = ''), 200);
  }

  document.querySelectorAll('.chip').forEach(chipEl => {
    chipEl.addEventListener('click', () => {
      eraserMode = false;
      eraserBtn.classList.remove('selected');
      const v = parseInt(chipEl.dataset.v, 10);
      if (selectedChip === v) {
        selectedChip = null;
        chipEl.classList.remove('selected');
      } else {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        selectedChip = v;
        chipEl.classList.add('selected');
      }
    });
  });

  eraserBtn.addEventListener('click', () => {
    if (eraserMode) {
      eraserMode = false;
      eraserBtn.classList.remove('selected');
    } else {
      eraserMode = true;
      selectedChip = null;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      eraserBtn.classList.add('selected');
    }
  });

  el('clear-all-btn').addEventListener('click', () => {
    socket.emit('clear-bets');
  });

  repeatBtn.addEventListener('click', () => {
    if (repeatBtn.disabled) return;
    socket.emit('repeat-last-bet');
  });

  document.querySelectorAll('.num-cell, .zero-cell, .bet-box').forEach(cell => {
    cell.addEventListener('click', () => handleCellClick(cell.dataset.key));
  });

  // -------------------- Rendering bets on the table --------------------
  const zeroCell = document.querySelector('.zero-cell');

  // Mirrors server.js OPPOSITE_BETS: these chance-simple pairs cannot be
  // active at the same time, so grey out the opposite box for clarity.
  const OPPOSITE_KEYS = {
    'color-red': 'color-black', 'color-black': 'color-red',
    'parity-even': 'parity-odd', 'parity-odd': 'parity-even',
    'range-low': 'range-high', 'range-high': 'range-low'
  };

  function renderBets(bets) {
    document.querySelectorAll('.chip-token').forEach(t => t.remove());
    document.querySelectorAll('.win-badge').forEach(t => t.remove());
    document.querySelectorAll('.highlighted').forEach(el => el.classList.remove('highlighted'));

    const potentialByNumber = {}; // aggregate potential payout per number, summed across ALL overlapping bets
    let total = 0;

    Object.entries(bets).forEach(([key, amount]) => {
      total += amount;
      const mult = multiplierForKey(key);

      const target = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (target) {
        const token = document.createElement('div');
        token.className = 'chip-token';
        if (target.classList.contains('num-cell') || target.classList.contains('zero-cell')) {
          token.classList.add('on-number'); // keep the digit visible beneath the chip
        }
        token.textContent = amount; // the amount actually staked on this spot
        target.appendChild(token);
      }

      numbersForKey(key).forEach(n => {
        potentialByNumber[n] = (potentialByNumber[n] || 0) + amount * mult;
        const cell = n === 0 ? zeroCell : cellsByNumber[n];
        if (cell) cell.classList.add('highlighted');
      });
    });

    // Show the combined potential win on every covered number (e.g. a street
    // 1-2-3 plus an overlapping double-street both paying out on 1, 2 or 3
    // now show the SUM of both, not just one bet's amount in isolation).
    Object.entries(potentialByNumber).forEach(([nStr, winAmount]) => {
      const n = parseInt(nStr, 10);
      const cell = n === 0 ? zeroCell : cellsByNumber[n];
      if (cell && winAmount > 0) {
        const badge = document.createElement('div');
        badge.className = 'win-badge';
        badge.textContent = winAmount;
        cell.appendChild(badge);
      }
    });

    document.querySelectorAll('.bet-box.blocked').forEach(b => b.classList.remove('blocked'));
    Object.keys(bets).forEach(key => {
      const opp = OPPOSITE_KEYS[key];
      if (opp) {
        const oppEl = document.querySelector(`[data-key="${opp}"]`);
        if (oppEl) oppEl.classList.add('blocked');
      }
    });

    totalBetEl.textContent = fmt(total);
  }

  // -------------------- Big foreground result flash (number + gain) --------------------
  let flashTimeout = null;
  function showResultFlash(number, color, winnings) {
    clearTimeout(flashTimeout);
    resultFlashNumber.textContent = number;
    resultFlashNumber.style.background = color === 'red' ? 'linear-gradient(180deg,#b3283a,#7c1f2b)'
      : color === 'black' ? 'linear-gradient(180deg,#3a3a3a,#161310)'
      : 'linear-gradient(180deg,#1fa568,#0d5c3a)';

    if (winnings > 0) {
      resultFlashGain.textContent = `+ ${fmt(winnings)}`;
      resultFlashGain.classList.add('visible');
    } else {
      resultFlashGain.textContent = '';
      resultFlashGain.classList.remove('visible');
    }

    resultFlash.classList.add('show');
    flashTimeout = setTimeout(() => resultFlash.classList.remove('show'), 3000);
  }

  // -------------------- History / hot-cold --------------------
  function renderHistory(history) {
    historyListEl.innerHTML = '';
    history.forEach(h => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `<span class="history-chip ${colorClass(h.color)}">${h.number}</span><span>${h.color === 'red' ? 'Rouge' : h.color === 'black' ? 'Noir' : 'Zero'}</span>`;
      historyListEl.appendChild(row);
    });
  }

  function renderHotCold(hc) {
    hotRowEl.innerHTML = '';
    coldRowEl.innerHTML = '';
    hc.hot.forEach(o => {
      const item = document.createElement('div');
      item.className = 'hc-item';
      item.innerHTML = `<span class="history-chip ${colorClass(colorOfNumber(o.n))}">${o.n}</span><span class="hc-count">${o.c}x</span>`;
      hotRowEl.appendChild(item);
    });
    hc.cold.forEach(o => {
      const item = document.createElement('div');
      item.className = 'hc-item';
      item.innerHTML = `<span class="history-chip ${colorClass(colorOfNumber(o.n))}">${o.n}</span><span class="hc-count">${o.c}x</span>`;
      coldRowEl.appendChild(item);
    });
    renderPercentages(hc.percentages);
    const dialCanvas = document.getElementById('freq-dial-canvas');
    if (dialCanvas && hc.counts) CasinoWheel.drawFrequencyDial(dialCanvas, hc.counts);
  }

  function renderPercentages(p) {
    if (!p) return;
    el('hc-window').textContent = `Sur les ${p.total} derniers tirages`;
    el('stat-red').textContent = `${p.redPct}% (${p.red})`;
    el('stat-black').textContent = `${p.blackPct}% (${p.black})`;
    el('stat-even').textContent = `${p.evenPct}% (${p.even})`;
    el('stat-odd').textContent = `${p.oddPct}% (${p.odd})`;
    el('stat-dozen1').textContent = `${p.dozen1Pct}% (${p.dozen1})`;
    el('stat-dozen2').textContent = `${p.dozen2Pct}% (${p.dozen2})`;
    el('stat-dozen3').textContent = `${p.dozen3Pct}% (${p.dozen3})`;
  }

  hotcoldBtn.addEventListener('click', () => hotcoldPanel.classList.toggle('show'));

  // -------------------- Balance / overlays --------------------
  function updateBalance(balance) {
    currentBalance = balance;
    balanceAmountEl.textContent = fmt(balance);
    const totalBet = Object.values(currentBets).reduce((a, b) => a + b, 0);
    if (balance < 1 && totalBet === 0) {
      bankruptOverlay.classList.remove('hidden');
    } else {
      bankruptOverlay.classList.add('hidden');
    }
  }

  // -------------------- Wheel --------------------
  const canvas = el('wheel-canvas-player');
  const wheel = CasinoWheel.createController(canvas, { idleSpeed: 0.02 });

  // -------------------- Socket wiring --------------------
  function tryJoin() {
    if (!playerNum) return;
    socket.emit('join-player', { num: playerNum });
  }

  socket.on('connect', tryJoin);

  socket.on('join-error', () => {
    waitingOverlay.classList.remove('hidden');
    setTimeout(tryJoin, 3000);
  });

  socket.on('joined', (data) => {
    waitingOverlay.classList.add('hidden');
    playerNameEl.textContent = data.name;
    currentBets = data.bets || {};
    updateBalance(data.balance);
    renderBets(currentBets);
    renderHistory(data.history || []);
    renderHotCold(data.hotcold || { hot: [], cold: [] });
    lastBets = data.lastBets || {};
    updateRepeatBtn();
    setTimeout(rebuildOverlays, 50);
  });

  socket.on('bet-update', (data) => {
    currentBets = data.bets || {};
    updateBalance(data.balance);
    renderBets(currentBets);
  });

  socket.on('bet-refused', (data) => {
    alert(data.message || 'Mise refusee.');
  });

  socket.on('balance-update', (data) => {
    updateBalance(data.balance);
  });

  socket.on('state-update', (state) => {
    renderHistory(state.history || []);
    if (state.hotcold) renderHotCold(state.hotcold);
  });

  socket.on('spin-start', ({ number, duration }) => {
    wheel.spinTo(number, duration);
  });

  socket.on('your-result', ({ winnings, balance, number, color, lastBets: newLastBets }) => {
    currentBets = {};
    renderBets(currentBets);
    updateBalance(balance);
    if (newLastBets) { lastBets = newLastBets; updateRepeatBtn(); }
    showResultFlash(number, color, winnings);
  });

  socket.on('spin-result', ({ history, hotcold }) => {
    renderHistory(history);
    renderHotCold(hotcold);
  });

  function doSaveQuit() { socket.emit('save-quit'); }
  el('quit-btn').addEventListener('click', () => {
    if (confirm('Sauvegarder votre solde et quitter la partie ?')) doSaveQuit();
  });
  el('bankrupt-save-btn').addEventListener('click', doSaveQuit);

  socket.on('quit-confirmed', () => {
    bankruptOverlay.classList.add('hidden');
    goodbyeOverlay.classList.remove('hidden');
  });

  // -------------------- Auto-spin countdown --------------------
  let nextSpinAt = null;
  let countdownTick = null;

  function updateCountdown() {
    if (!nextSpinAt) {
      autoCountdownBadge.classList.add('hidden');
      autoCountdownBadge.classList.remove('warning');
      return;
    }
    const remaining = Math.max(0, Math.ceil((nextSpinAt - Date.now()) / 1000));
    autoCountdownValue.textContent = remaining;
    autoCountdownBadge.classList.remove('hidden');
    autoCountdownBadge.classList.toggle('warning', remaining <= 7);
  }

  socket.on('auto-state', (data) => {
    nextSpinAt = data.nextSpinAt || null;
    updateCountdown();
    clearInterval(countdownTick);
    if (nextSpinAt) countdownTick = setInterval(updateCountdown, 250);
  });
})();
