(function () {
  const socket = io();

  const setupScreen = document.getElementById('setup-screen');
  const dashboardScreen = document.getElementById('dashboard-screen');
  const playerCountInput = document.getElementById('player-count');
  const generateBtn = document.getElementById('generate-rows-btn');
  const playersForm = document.getElementById('players-form');
  const startBtn = document.getElementById('start-game-btn');
  const spinBtn = document.getElementById('spin-btn');
  const statusLine = document.getElementById('status-line');
  const resultBanner = document.getElementById('result-banner');
  const resultNumberEl = document.getElementById('result-number');
  const playersTbody = document.getElementById('players-tbody');
  const linksBox = document.getElementById('links-box');
  const historyStrip = document.getElementById('history-strip');
  const autoModeCheckbox = document.getElementById('auto-mode-checkbox');
  const autoIntervalSelect = document.getElementById('auto-interval-select');
  const autoCountdown = document.getElementById('auto-countdown');
  const autoCountdownValue = document.getElementById('auto-countdown-value');
  const hcWindow = document.getElementById('hc-window');
  const hotRow = document.getElementById('hot-row');
  const coldRow = document.getElementById('cold-row');
  const serverIpBadge = document.getElementById('server-ip-badge');
  const resumeScreen = document.getElementById('resume-screen');
  const partiesList = document.getElementById('parties-list');
  const soldesScreen = document.getElementById('soldes-screen');
  const soldesList = document.getElementById('soldes-list');
  const saveLabelInput = document.getElementById('save-label-input');
  const saveGameBtn = document.getElementById('save-game-btn');
  const saveGameHint = document.getElementById('save-game-hint');
  const addPlayerNameInput = document.getElementById('add-player-name');
  const addPlayerBalanceInput = document.getElementById('add-player-balance');
  const addPlayerLoadBtn = document.getElementById('add-player-load-btn');
  const addPlayerBtn = document.getElementById('add-player-btn');
  const addPlayerHint = document.getElementById('add-player-hint');
  let pendingAddPlayerHistory = [];

  function colorClass(c) { return c === 'red' ? 'c-red' : c === 'black' ? 'c-black' : 'c-green'; }

  const RED_SET = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
  function colorOfNumber(n) {
    if (n === 0) return 'green';
    return RED_SET.has(n) ? 'red' : 'black';
  }

  // -------- Server LAN IP (so links work from other devices even when the
  // master's own browser shows "localhost") --------
  let networkOrigin = null; // e.g. "http://192.168.1.42:7777", or null if none found

  (async function loadServerInfo() {
    try {
      const r = await fetch('/api/server-info');
      const data = await r.json();
      const port = data.port;
      const ips = data.ips || [];
      if (ips.length > 0) {
        networkOrigin = `http://${ips[0]}:${port}`;
      }
      if (ips.length === 0) {
        serverIpBadge.innerHTML = `Adresse reseau non detectee — utilisez <b>localhost</b> uniquement sur cet ordinateur.`;
      } else if (ips.length === 1) {
        serverIpBadge.innerHTML = `Adresse pour les autres appareils : <b>${ips[0]}:${port}</b> <button class="copy-ip-btn" id="copy-ip-btn">copier</button>`;
      } else {
        serverIpBadge.innerHTML = `Adresses disponibles : ` +
          ips.map(ip => `<b>${ip}:${port}</b>`).join(' &nbsp;ou&nbsp; ') +
          ` <button class="copy-ip-btn" id="copy-ip-btn">copier la 1ere</button>`;
      }
      const copyBtn = document.getElementById('copy-ip-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          navigator.clipboard?.writeText(`${ips[0]}:${port}`);
          copyBtn.textContent = 'copie !';
          setTimeout(() => { copyBtn.textContent = ips.length > 1 ? 'copier la 1ere' : 'copier'; }, 1200);
        });
      }
    } catch (e) {
      console.error('Impossible de recuperer /api/server-info', e);
    }
  })();

  // -------- resume a previously saved full game --------
  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('fr-FR'); } catch (e) { return iso; }
  }

  async function loadPartiesList() {
    try {
      const r = await fetch('/api/parties');
      const data = await r.json();
      const parties = data.parties || [];
      if (parties.length === 0) {
        resumeScreen.classList.add('hidden');
        return;
      }
      resumeScreen.classList.remove('hidden');
      partiesList.innerHTML = '';
      parties.forEach(p => {
        const item = document.createElement('div');
        item.className = 'party-item';
        item.innerHTML = `
          <div class="party-info">
            <div class="party-label">${p.label}</div>
            <div class="party-meta">${fmtDate(p.savedAt)} — ${p.playerCount} joueur(s), ${p.drawCount} tirage(s) memorise(s)</div>
          </div>
          <div class="btn-group">
            <button class="btn-outline load-btn">Charger</button>
            <button class="btn-danger delete-btn">Supprimer</button>
          </div>
        `;
        item.querySelector('.load-btn').addEventListener('click', () => {
          socket.emit('load-game', { filename: p.filename });
        });
        item.querySelector('.delete-btn').addEventListener('click', async () => {
          if (!confirm(`Supprimer definitivement la sauvegarde "${p.label}" ?`)) return;
          try {
            await fetch('/api/parties/' + encodeURIComponent(p.filename), { method: 'DELETE' });
            loadPartiesList();
          } catch (e) { alert('Erreur lors de la suppression.'); }
        });
        partiesList.appendChild(item);
      });
    } catch (e) {
      console.error('Impossible de recuperer /api/parties', e);
    }
  }
  loadPartiesList();

  async function loadSoldesList() {
    try {
      const r = await fetch('/api/soldes');
      const data = await r.json();
      const soldes = data.soldes || [];
      if (soldes.length === 0) {
        soldesScreen.classList.add('hidden');
        return;
      }
      soldesScreen.classList.remove('hidden');
      soldesList.innerHTML = '';
      soldes.forEach(s => {
        const item = document.createElement('div');
        item.className = 'party-item';
        item.innerHTML = `
          <div class="party-info">
            <div class="party-label">${s.name}</div>
            <div class="party-meta">${s.balance.toFixed(2)} € — ${s.historyCount} partie(s) en memoire</div>
          </div>
          <button class="btn-danger delete-solde-btn">Supprimer</button>
        `;
        item.querySelector('.delete-solde-btn').addEventListener('click', async () => {
          if (!confirm(`Supprimer definitivement le solde sauvegarde de "${s.name}" ?`)) return;
          try {
            await fetch('/api/solde/' + encodeURIComponent(s.name), { method: 'DELETE' });
            loadSoldesList();
          } catch (e) { alert('Erreur lors de la suppression.'); }
        });
        soldesList.appendChild(item);
      });
    } catch (e) {
      console.error('Impossible de recuperer /api/soldes', e);
    }
  }
  loadSoldesList();

  saveGameBtn.addEventListener('click', () => {
    socket.emit('save-game', { label: saveLabelInput.value });
  });

  socket.on('game-saved', ({ label }) => {
    saveGameHint.textContent = `Partie sauvegardee : "${label}"`;
    saveLabelInput.value = '';
    setTimeout(() => (saveGameHint.textContent = ''), 4000);
    loadPartiesList();
  });

  socket.on('game-save-error', (d) => alert(d.message || 'Erreur lors de la sauvegarde.'));
  socket.on('load-game-error', (d) => alert(d.message || 'Erreur lors du chargement de la sauvegarde.'));


  function renderStats(hc) {
    if (!hc) return;
    hotRow.innerHTML = '';
    coldRow.innerHTML = '';
    hc.hot.forEach(o => {
      const item = document.createElement('div');
      item.className = 'hc-item';
      item.innerHTML = `<span class="history-chip ${colorClass(colorOfNumber(o.n))}">${o.n}</span><span class="hc-count">${o.c}x</span>`;
      hotRow.appendChild(item);
    });
    hc.cold.forEach(o => {
      const item = document.createElement('div');
      item.className = 'hc-item';
      item.innerHTML = `<span class="history-chip ${colorClass(colorOfNumber(o.n))}">${o.n}</span><span class="hc-count">${o.c}x</span>`;
      coldRow.appendChild(item);
    });
    const dialCanvas = document.getElementById('freq-dial-canvas');
    if (dialCanvas && hc.counts) CasinoWheel.drawFrequencyDial(dialCanvas, hc.counts);
    const p = hc.percentages;
    if (p) {
      hcWindow.textContent = `Sur les ${p.total} derniers tirages`;
      document.getElementById('stat-red').textContent = `${p.redPct}% (${p.red})`;
      document.getElementById('stat-black').textContent = `${p.blackPct}% (${p.black})`;
      document.getElementById('stat-even').textContent = `${p.evenPct}% (${p.even})`;
      document.getElementById('stat-odd').textContent = `${p.oddPct}% (${p.odd})`;
      document.getElementById('stat-dozen1').textContent = `${p.dozen1Pct}% (${p.dozen1})`;
      document.getElementById('stat-dozen2').textContent = `${p.dozen2Pct}% (${p.dozen2})`;
      document.getElementById('stat-dozen3').textContent = `${p.dozen3Pct}% (${p.dozen3})`;
    }
  }

  function buildRows(n) {
    playersForm.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      const row = document.createElement('div');
      row.className = 'setup-row';
      row.innerHTML = `
        <div class="num-badge">${i}</div>
        <input type="text" placeholder="Nom du joueur ${i}" class="p-name" value="Joueur ${i}">
        <input type="number" placeholder="Mise de depart" class="p-balance" value="500" min="0">
        <button type="button" class="btn-outline p-load">Charger solde</button>
      `;
      playersForm.appendChild(row);

      row.dataset.history = '[]';
      let hint = row.querySelector('.load-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'load-hint';
        row.appendChild(hint);
      }

      row.querySelector('.p-load').addEventListener('click', async () => {
        const name = row.querySelector('.p-name').value.trim();
        if (!name) return;
        try {
          const r = await fetch('/api/solde/' + encodeURIComponent(name));
          const data = await r.json();
          if (data.found) {
            row.querySelector('.p-balance').value = data.balance;
            row.dataset.history = JSON.stringify(data.history || []);
            hint.textContent = `Solde et historique charges (${(data.history || []).length} partie(s) precedentes).`;
          } else {
            row.dataset.history = '[]';
            hint.textContent = '';
            alert(`Aucun solde sauvegarde trouve pour "${name}".`);
          }
        } catch (e) { console.error(e); }
      });
    }
  }

  generateBtn.addEventListener('click', () => {
    const n = Math.max(1, Math.min(10, parseInt(playerCountInput.value, 10) || 1));
    buildRows(n);
  });
  buildRows(parseInt(playerCountInput.value, 10) || 2);

  startBtn.addEventListener('click', () => {
    const rows = [...document.querySelectorAll('.setup-row')];
    const players = rows.map((row, i) => {
      let history = [];
      try { history = JSON.parse(row.dataset.history || '[]'); } catch (e) { history = []; }
      return {
        name: row.querySelector('.p-name').value.trim() || `Joueur ${i + 1}`,
        balance: Math.max(0, parseFloat(row.querySelector('.p-balance').value) || 0),
        history
      };
    });
    if (players.length === 0) return;
    socket.emit('create-game', { players });
  });

  let lastLinksCount = 0;
  function renderLinks(count) {
    if (count === lastLinksCount) return;
    lastLinksCount = count;
    linksBox.innerHTML = '';
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const origin = (isLocalhost && networkOrigin) ? networkOrigin : window.location.origin;
    for (let i = 1; i <= count; i++) {
      const url = `${origin}/joueur${i}.html`;
      const item = document.createElement('div');
      item.className = 'link-item';
      item.innerHTML = `<a href="${url}" target="_blank">Ecran Joueur ${i}</a><button data-url="${url}">copier</button>`;
      item.querySelector('button').addEventListener('click', (e) => {
        navigator.clipboard?.writeText(e.target.dataset.url);
        e.target.textContent = 'copie !';
        setTimeout(() => (e.target.textContent = 'copier'), 1200);
      });
      linksBox.appendChild(item);
    }
  }

  socket.on('game-created', ({ count }) => {
    setupScreen.style.display = 'none';
    resumeScreen.classList.add('hidden');
    soldesScreen.classList.add('hidden');
    dashboardScreen.style.display = 'block';
    lastLinksCount = 0; // force a full rebuild even if the count happens to match
    renderLinks(count);
  });

  socket.on('player-added', ({ num, name }) => {
    addPlayerHint.textContent = `${name} a rejoint la table (Joueur ${num}).`;
    addPlayerNameInput.value = '';
    setTimeout(() => (addPlayerHint.textContent = ''), 4000);
  });

  socket.on('add-player-error', (d) => alert(d.message || 'Erreur lors de l\'ajout du joueur.'));

  addPlayerLoadBtn.addEventListener('click', async () => {
    const name = addPlayerNameInput.value.trim();
    if (!name) return;
    try {
      const r = await fetch('/api/solde/' + encodeURIComponent(name));
      const data = await r.json();
      if (data.found) {
        addPlayerBalanceInput.value = data.balance;
        pendingAddPlayerHistory = data.history || [];
        addPlayerHint.textContent = `Solde et historique charges (${(data.history || []).length} partie(s) precedentes).`;
      } else {
        pendingAddPlayerHistory = [];
        addPlayerHint.textContent = '';
        alert(`Aucun solde sauvegarde trouve pour "${name}".`);
      }
    } catch (e) { console.error(e); }
  });

  addPlayerBtn.addEventListener('click', () => {
    const name = addPlayerNameInput.value.trim();
    if (!name) { alert('Indiquez un nom pour le nouveau joueur.'); return; }
    const balance = Math.max(0, parseFloat(addPlayerBalanceInput.value) || 0);
    socket.emit('add-player', { name, balance, history: pendingAddPlayerHistory });
    pendingAddPlayerHistory = [];
  });

  socket.on('state-update', (state) => {
    renderLinks(state.players.length);
    playersTbody.innerHTML = '';
    state.players.forEach(p => {
      const isBankrupt = p.balance < 1 && p.totalBet === 0;
      const tr = document.createElement('tr');
      if (isBankrupt) tr.className = 'bankrupt';
      tr.innerHTML = `
        <td><span class="dot ${p.connected ? 'on' : 'off'}"></span></td>
        <td>${p.name}${isBankrupt ? ' ⚠️' : ''}</td>
        <td>${p.balance.toFixed(2)} €</td>
        <td>${p.totalBet.toFixed(2)} €</td>
        <td>
          <div class="recharge-cell">
            <input type="number" class="recharge-input" min="1" value="50" data-num="${p.num}">
            <button class="recharge-btn" data-num="${p.num}">+ Ajouter</button>
          </div>
        </td>
      `;
      playersTbody.appendChild(tr);
    });

    playersTbody.querySelectorAll('.recharge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const num = parseInt(btn.dataset.num, 10);
        const input = playersTbody.querySelector(`.recharge-input[data-num="${num}"]`);
        const amount = parseFloat(input.value);
        if (!amount || amount <= 0) return;
        socket.emit('add-funds', { num, amount });
      });
    });

    historyStrip.innerHTML = '';
    state.history.forEach(h => {
      const chip = document.createElement('div');
      chip.className = 'history-chip ' + colorClass(h.color);
      chip.textContent = h.number;
      historyStrip.appendChild(chip);
    });

    renderStats(state.hotcold);

    if (state.spinning) {
      spinBtn.disabled = true;
      statusLine.textContent = 'La bille tourne...';
    } else if (state.started) {
      spinBtn.disabled = false;
      statusLine.textContent = 'Pret pour un nouveau tirage';
    }
  });

  // -------- wheel ---------
  const canvas = document.getElementById('wheel-canvas');
  const wheel = CasinoWheel.createController(canvas, { idleSpeed: 0.01 });

  spinBtn.addEventListener('click', () => {
    spinBtn.disabled = true;
    resultBanner.style.display = 'none';
    statusLine.textContent = 'La bille tourne...';
    socket.emit('spin-request');
  });

  socket.on('spin-start', ({ number, duration }) => {
    wheel.spinTo(number, duration);
  });

  socket.on('spin-result', ({ number, color }) => {
    resultNumberEl.textContent = number;
    resultNumberEl.style.background = color === 'red' ? 'linear-gradient(180deg,#b3283a,#7c1f2b)'
      : color === 'black' ? 'linear-gradient(180deg,#3a3a3a,#161310)'
      : 'linear-gradient(180deg,#1fa568,#0d5c3a)';
    resultBanner.style.display = 'block';
  });

  // -------- auto-spin mode --------
  function sendAutoMode() {
    socket.emit('set-auto-mode', {
      enabled: autoModeCheckbox.checked,
      interval: parseInt(autoIntervalSelect.value, 10)
    });
  }
  autoModeCheckbox.addEventListener('change', sendAutoMode);
  autoIntervalSelect.addEventListener('change', sendAutoMode);

  let nextSpinAt = null;
  let countdownTick = null;

  function updateCountdownDisplay() {
    if (!nextSpinAt) {
      autoCountdown.classList.add('hidden');
      return;
    }
    const remaining = Math.max(0, Math.ceil((nextSpinAt - Date.now()) / 1000));
    autoCountdownValue.textContent = remaining;
    autoCountdown.classList.remove('hidden');
  }

  socket.on('auto-state', (data) => {
    autoModeCheckbox.checked = !!data.autoMode;
    if (data.autoIntervalSec) autoIntervalSelect.value = String(data.autoIntervalSec);
    nextSpinAt = data.nextSpinAt || null;
    updateCountdownDisplay();
    clearInterval(countdownTick);
    if (nextSpinAt) countdownTick = setInterval(updateCountdownDisplay, 250);
  });
})();
