const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 7777;
const DATA_DIR = path.join(__dirname, 'data');
const SAVE_FILE = path.join(DATA_DIR, 'joueurs.txt');
const PARTIES_DIR = path.join(DATA_DIR, 'parties');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SAVE_FILE)) fs.writeFileSync(SAVE_FILE, '');
if (!fs.existsSync(PARTIES_DIR)) fs.mkdirSync(PARTIES_DIR, { recursive: true });

// Local network IPv4 addresses (excluding loopback) that other devices on
// the same Wi-Fi/LAN can use to reach this server instead of "localhost".
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// ---------------------------------------------------------------------------
// Roulette constants
// ---------------------------------------------------------------------------
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// Every 2x2 "corner" (carre) block on the classic 3x12 table, referenced by
// the 4 numbers it covers. Layout (row0=top=3,6,9..36 / row1=mid=2,5,8..35 / row2=bottom=1,4,7..34)
function buildGridNumbers() {
  const rows = [[], [], []]; // row0 top ... row2 bottom
  for (let col = 0; col < 12; col++) {
    const base = col * 3;
    rows[2][col] = base + 1; // bottom
    rows[1][col] = base + 2; // middle
    rows[0][col] = base + 3; // top
  }
  return rows;
}
const GRID = buildGridNumbers();

// ---------------------------------------------------------------------------
// In-memory game state
// ---------------------------------------------------------------------------
let game = {
  started: false,
  spinning: false,
  players: {},   // num -> { num, name, balance, bets: {key:amount}, connected, socketId }
  history: [],   // { number, color }, most recent first
  autoMode: false,
  autoIntervalSec: 20,
  nextSpinAt: null // epoch ms, or null when no auto-spin is scheduled
};
let autoTimerHandle = null;

function publicState() {
  return {
    started: game.started,
    spinning: game.spinning,
    players: Object.values(game.players).map(p => ({
      num: p.num, name: p.name, balance: p.balance,
      connected: p.connected, totalBet: totalBetOf(p),
      historyCount: (p.roundHistory || []).length
    })),
    history: game.history.slice(0, 25),
    hotcold: computeStats()
  };
}

function autoState() {
  return {
    started: game.started,
    autoMode: game.autoMode,
    autoIntervalSec: game.autoIntervalSec,
    nextSpinAt: game.nextSpinAt
  };
}

function broadcastAutoState() {
  io.emit('auto-state', autoState());
}

// Arms (or disarms) the server-side auto-spin countdown. Safe to call anytime;
// always clears any previously pending timer first so there is never more
// than one in flight.
function scheduleAutoSpin() {
  clearTimeout(autoTimerHandle);
  autoTimerHandle = null;
  if (!game.autoMode || !game.started) {
    game.nextSpinAt = null;
    broadcastAutoState();
    return;
  }
  game.nextSpinAt = Date.now() + game.autoIntervalSec * 1000;
  broadcastAutoState();
  autoTimerHandle = setTimeout(() => {
    if (game.autoMode && game.started && !game.spinning) {
      performSpin();
    } else {
      scheduleAutoSpin();
    }
  }, game.autoIntervalSec * 1000);
}

// Resolves one full spin: picks a winning number, broadcasts the 3s wheel
// animation, then after it lands, settles every player's bets and history.
// Used by both the master's manual button and the auto-spin timer.
function performSpin() {
  if (!game.started || game.spinning) return;
  clearTimeout(autoTimerHandle);
  autoTimerHandle = null;

  game.spinning = true;
  const winNumber = Math.floor(Math.random() * 37);
  const winColor = colorOf(winNumber);
  io.emit('spin-start', { number: winNumber, color: winColor, duration: 3000 });

  setTimeout(() => {
    Object.values(game.players).forEach(p => {
      const betsSnapshot = { ...p.bets };
      const miseTotale = totalBetOf(p);
      let winnings = 0;
      Object.entries(p.bets).forEach(([key, amount]) => {
        winnings += evaluateBet(key, amount, winNumber);
      });
      p.balance += winnings;
      p.bets = {};

      if (miseTotale > 0) {
        p.lastBets = betsSnapshot;
        if (!Array.isArray(p.roundHistory)) p.roundHistory = [];
        p.roundHistory.unshift({
          date: new Date().toISOString(),
          numero: winNumber,
          couleur: winColor,
          mises: betsSnapshot,
          miseTotale,
          gain: winnings,
          net: winnings - miseTotale,
          solde: p.balance
        });
        if (p.roundHistory.length > 25) p.roundHistory.length = 25;
      }

      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.emit('your-result', { winnings, balance: p.balance, number: winNumber, color: winColor, lastBets: p.lastBets });
    });

    game.history.unshift({ number: winNumber, color: winColor });
    if (game.history.length > 200) game.history.length = 200;
    game.spinning = false;

    io.emit('spin-result', {
      number: winNumber, color: winColor,
      history: game.history.slice(0, 25),
      hotcold: computeStats()
    });
    broadcastState();

    if (game.autoMode) scheduleAutoSpin();
  }, 3000);
}

function totalBetOf(p) {
  return Object.values(p.bets).reduce((a, b) => a + b, 0);
}

// game.history is already capped to the last 200 draws (see performSpin).
function computeStats() {
  const hist = game.history;
  const counts = new Array(37).fill(0);
  let red = 0, black = 0, green = 0, even = 0, odd = 0;
  const dozen = [0, 0, 0];

  hist.forEach(h => {
    counts[h.number]++;
    if (h.number === 0) {
      green++;
    } else {
      if (h.color === 'red') red++; else black++;
      if (h.number % 2 === 0) even++; else odd++;
      dozen[Math.ceil(h.number / 12) - 1]++;
    }
  });

  const total = hist.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  const arr = counts.map((c, n) => ({ n, c }));
  const hot = [...arr].sort((a, b) => b.c - a.c || a.n - b.n).slice(0, 5);
  const cold = [...arr].sort((a, b) => a.c - b.c || a.n - b.n).slice(0, 5);

  return {
    hot, cold, counts,
    percentages: {
      total,
      red, black, green,
      redPct: pct(red), blackPct: pct(black), greenPct: pct(green),
      even, odd, evenPct: pct(even), oddPct: pct(odd),
      dozen1: dozen[0], dozen2: dozen[1], dozen3: dozen[2],
      dozen1Pct: pct(dozen[0]), dozen2Pct: pct(dozen[1]), dozen3Pct: pct(dozen[2])
    }
  };
}

function broadcastState() {
  io.emit('state-update', publicState());
}

// Position of a number (1-36) on the table: column 1-12, and row 0(top)/1(mid)/2(bottom)
// matching GRID above (row0=3,6,9.. / row1=2,5,8.. / row2=1,4,7..)
function numberPos(n) {
  const col = Math.ceil(n / 3);
  const rem = n - (col - 1) * 3;
  const row = rem === 1 ? 2 : rem === 2 ? 1 : 0;
  return { col, row };
}

// ---------------------------------------------------------------------------
// Bet evaluation - full French/European roulette bet set
// key formats:
//   straight-<n>                     numero plein            x36
//   split-<a>-<b>                    cheval (2 adjacents, incl. 0-1/0-2/0-3) x18
//   trio-0-1-2 | trio-0-2-3          trio (3 numeros avec 0) x12
//   street-<col>                     transversale simple (3)  x12
//   doublestreet-<col>               transversale double (6)  x6
//   corner-a-b-c-d                   carre (4 numeros)        x9
//   column-<1|2|3>                   colonne (12 numeros)     x3
//   dozen-<1|2|3>                    tiers / douzaine (12)    x3
//   color-red | color-black          chance simple            x2
//   parity-even | parity-odd         chance simple            x2
//   range-low | range-high           manque(1-18)/passe(19-36) x2
// ---------------------------------------------------------------------------
function evaluateBet(key, amount, winNumber) {
  const winColor = colorOf(winNumber);
  if (key.startsWith('straight-')) {
    const n = parseInt(key.split('-')[1], 10);
    return n === winNumber ? amount * 36 : 0;
  }
  if (key.startsWith('split-')) {
    const nums = key.split('-').slice(1).map(Number);
    return nums.includes(winNumber) ? amount * 18 : 0;
  }
  if (key.startsWith('doublestreet-')) {
    const col = parseInt(key.split('-')[1], 10);
    const nums = [1,2,3,4,5,6].map(o => (col - 1) * 3 + o);
    return nums.includes(winNumber) ? amount * 6 : 0;
  }
  if (key.startsWith('street-')) {
    const col = parseInt(key.split('-')[1], 10);
    const nums = [1,2,3].map(o => (col - 1) * 3 + o);
    return nums.includes(winNumber) ? amount * 12 : 0;
  }
  if (key.startsWith('corner-')) {
    const nums = key.split('-').slice(1).map(Number);
    return nums.includes(winNumber) ? amount * 9 : 0;
  }
  if (key === 'trio-0-1-2') return [0, 1, 2].includes(winNumber) ? amount * 12 : 0;
  if (key === 'trio-0-2-3') return [0, 2, 3].includes(winNumber) ? amount * 12 : 0;
  if (key.startsWith('column-')) {
    if (winNumber === 0) return 0;
    const rem = parseInt(key.split('-')[1], 10); // 1, 2 or 3 (0 means "3")
    const winRem = winNumber % 3 === 0 ? 3 : winNumber % 3;
    return winRem === rem ? amount * 3 : 0;
  }
  if (key.startsWith('dozen-')) {
    if (winNumber === 0) return 0;
    const d = parseInt(key.split('-')[1], 10);
    const inDozen = winNumber >= (d - 1) * 12 + 1 && winNumber <= d * 12;
    return inDozen ? amount * 3 : 0;
  }
  if (key === 'color-red') return winColor === 'red' ? amount * 2 : 0;
  if (key === 'color-black') return winColor === 'black' ? amount * 2 : 0;
  if (key === 'parity-even') return (winNumber !== 0 && winNumber % 2 === 0) ? amount * 2 : 0;
  if (key === 'parity-odd') return (winNumber !== 0 && winNumber % 2 === 1) ? amount * 2 : 0;
  if (key === 'range-low') return (winNumber >= 1 && winNumber <= 18) ? amount * 2 : 0;
  if (key === 'range-high') return (winNumber >= 19 && winNumber <= 36) ? amount * 2 : 0;
  return 0;
}

function isValidBetKey(key) {
  if (key.startsWith('straight-')) {
    const n = parseInt(key.split('-')[1], 10);
    return Number.isInteger(n) && n >= 0 && n <= 36;
  }
  if (key.startsWith('split-')) {
    const parts = key.split('-').slice(1).map(Number);
    if (parts.length !== 2) return false;
    const [a, b] = parts;
    if (a === 0 || b === 0) {
      // 0 physically touches only 1, 2 and 3 on the table
      const other = a === 0 ? b : a;
      return a !== b && [1, 2, 3].includes(other);
    }
    if ([a, b].some(n => !Number.isInteger(n) || n < 1 || n > 36)) return false;
    const pa = numberPos(a), pb = numberPos(b);
    const sameColAdjacentRow = pa.col === pb.col && Math.abs(pa.row - pb.row) === 1;
    const sameRowAdjacentCol = pa.row === pb.row && Math.abs(pa.col - pb.col) === 1;
    return sameColAdjacentRow || sameRowAdjacentCol;
  }
  if (key.startsWith('doublestreet-')) {
    const col = parseInt(key.split('-')[1], 10);
    return Number.isInteger(col) && col >= 1 && col <= 11;
  }
  if (key.startsWith('street-')) {
    const col = parseInt(key.split('-')[1], 10);
    return Number.isInteger(col) && col >= 1 && col <= 12;
  }
  if (key.startsWith('corner-')) {
    const parts = key.split('-').slice(1);
    return parts.length === 4 && parts.every(p => Number.isInteger(parseInt(p, 10)));
  }
  if (key.startsWith('column-')) return ['column-1', 'column-2', 'column-3'].includes(key);
  if (key.startsWith('dozen-')) return ['dozen-1', 'dozen-2', 'dozen-3'].includes(key);
  if (key === 'trio-0-1-2' || key === 'trio-0-2-3') return true;
  if (key === 'color-red' || key === 'color-black') return true;
  if (key === 'parity-even' || key === 'parity-odd') return true;
  if (key === 'range-low' || key === 'range-high') return true;
  return false;
}

const CHIP_VALUES = [1, 2, 5, 10, 25, 50];

// The three "chances simples" pairs that each cover the entire non-zero
// range on their own: betting both sides at once is disallowed.
const OPPOSITE_BETS = {
  'color-red': 'color-black',
  'color-black': 'color-red',
  'parity-even': 'parity-odd',
  'parity-odd': 'parity-even',
  'range-low': 'range-high',
  'range-high': 'range-low'
};
const BET_LABELS = {
  'color-red': 'Rouge', 'color-black': 'Noir',
  'parity-even': 'Pair', 'parity-odd': 'Impair',
  'range-low': 'Manque (1-18)', 'range-high': 'Passe (19-36)'
};

// ---------------------------------------------------------------------------
// Static files & explicit /joueurN.html routing
// ---------------------------------------------------------------------------
app.use(express.json());
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

app.get('/', (req, res) => res.redirect('/maitre.html'));
app.get('/maitre.html', (req, res) => res.sendFile(path.join(__dirname, 'public/master.html')));
app.get('/master.html', (req, res) => res.sendFile(path.join(__dirname, 'public/master.html'))); // English-name alias
app.get(/^\/joueur(\d+)\.html$/, (req, res) => res.sendFile(path.join(__dirname, 'public/joueur.html')));

// Server's LAN IP addresses + port, so the master screen can show players
// how to reach it from another device instead of "localhost".
app.get('/api/server-info', (req, res) => {
  res.json({ port: PORT, ips: getLocalIPs() });
});

function parseSoldeLine(line) {
  try {
    return JSON.parse(line);
  } catch (e) {
    // backward compatibility with the old "name:balance" plain-text format
    const [savedName, savedBalance] = line.split(':');
    return savedName ? { name: savedName, balance: parseFloat(savedBalance), history: [] } : null;
  }
}

// Lookup a saved player (balance + last 25 rounds history) by name
app.get('/api/solde/:nom', (req, res) => {
  const nom = decodeURIComponent(req.params.nom).trim().toLowerCase();
  const lines = fs.readFileSync(SAVE_FILE, 'utf8').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec = parseSoldeLine(lines[i]);
    if (rec && rec.name && rec.name.trim().toLowerCase() === nom) {
      return res.json({ found: true, balance: rec.balance, history: rec.history || [] });
    }
  }
  res.json({ found: false });
});

// List every distinct saved player name, with their most recent balance
// (the save file is append-only: later lines override earlier ones for the
// same name), so the master screen can offer them for management/deletion.
app.get('/api/soldes', (req, res) => {
  const lines = fs.readFileSync(SAVE_FILE, 'utf8').split('\n').filter(Boolean);
  const byName = new Map(); // lower-case name -> record (last one wins)
  lines.forEach(line => {
    const rec = parseSoldeLine(line);
    if (rec && rec.name) byName.set(rec.name.trim().toLowerCase(), rec);
  });
  const soldes = [...byName.values()].map(rec => ({
    name: rec.name, balance: rec.balance, historyCount: (rec.history || []).length
  }));
  res.json({ soldes });
});

// Delete every saved line for a given player name.
app.delete('/api/solde/:nom', (req, res) => {
  const nom = decodeURIComponent(req.params.nom).trim().toLowerCase();
  const lines = fs.readFileSync(SAVE_FILE, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter(line => {
    const rec = parseSoldeLine(line);
    return !(rec && rec.name && rec.name.trim().toLowerCase() === nom);
  });
  fs.writeFileSync(SAVE_FILE, kept.length ? kept.join('\n') + '\n' : '');
  res.json({ success: true, removed: lines.length - kept.length });
});

// List saved full-game snapshots (numbers drawn + all players' balances),
// newest first, so the master screen can offer them for reloading.
app.get('/api/parties', (req, res) => {
  try {
    const files = fs.readdirSync(PARTIES_DIR).filter(f => f.endsWith('.json'));
    const parties = files.map(filename => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(PARTIES_DIR, filename), 'utf8'));
        return {
          filename,
          label: data.label || filename,
          savedAt: data.savedAt || null,
          playerCount: Array.isArray(data.players) ? data.players.length : 0,
          drawCount: Array.isArray(data.gameHistory) ? data.gameHistory.length : 0
        };
      } catch (e) {
        return null;
      }
    }).filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json({ parties });
  } catch (e) {
    res.json({ parties: [] });
  }
});

// Delete a saved full-game snapshot by filename.
app.delete('/api/parties/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(PARTIES_DIR, filename);
  // guard against path traversal outside PARTIES_DIR
  if (!filePath.startsWith(PARTIES_DIR) || !filename.endsWith('.json')) {
    return res.status(400).json({ success: false, message: 'Nom de fichier invalide.' });
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Impossible de supprimer ce fichier.' });
  }
});

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('state-update', publicState());
  socket.emit('auto-state', autoState());

  // ---- Master: create a brand-new game -----------------------------------
  socket.on('create-game', (payload) => {
    const players = Array.isArray(payload?.players) ? payload.players : [];
    const newPlayers = {};
    players.forEach((p, i) => {
      const num = i + 1;
      const history = Array.isArray(p.history) ? p.history.slice(0, 25) : [];
      newPlayers[num] = {
        num,
        name: (p.name || `Joueur ${num}`).trim(),
        balance: Math.max(0, Number(p.balance) || 0),
        bets: {},
        lastBets: {},
        connected: false,
        socketId: null,
        roundHistory: history
      };
    });
    clearTimeout(autoTimerHandle);
    autoTimerHandle = null;
    game = {
      started: true, spinning: false, players: newPlayers, history: [],
      autoMode: false, autoIntervalSec: 20, nextSpinAt: null
    };
    socket.emit('game-created', { count: players.length });
    broadcastState();
    broadcastAutoState();
  });

  // ---- Master: save a full snapshot of the current game (all players'
  // balances + round history, plus the actual sequence of numbers drawn so
  // the chauds/froids and percentage stats can be restored too) ------------
  socket.on('save-game', ({ label }) => {
    if (!game.started) return;
    const snapshot = {
      savedAt: new Date().toISOString(),
      label: (label && label.trim()) || `Partie du ${new Date().toLocaleString('fr-FR')}`,
      gameHistory: game.history,
      players: Object.values(game.players).map(p => ({
        name: p.name,
        balance: p.balance,
        roundHistory: p.roundHistory || []
      }))
    };
    const filename = `partie-${Date.now()}.json`;
    try {
      fs.writeFileSync(path.join(PARTIES_DIR, filename), JSON.stringify(snapshot, null, 2));
      socket.emit('game-saved', { filename, label: snapshot.label });
    } catch (e) {
      socket.emit('game-save-error', { message: 'Impossible d\'ecrire la sauvegarde sur le disque.' });
    }
  });

  // ---- Master: reload a previously saved full game session ----------------
  socket.on('load-game', ({ filename }) => {
    const filePath = path.join(PARTIES_DIR, String(filename || ''));
    if (!filePath.startsWith(PARTIES_DIR) || !fs.existsSync(filePath)) {
      socket.emit('load-game-error', { message: 'Sauvegarde introuvable.' });
      return;
    }
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      socket.emit('load-game-error', { message: 'Fichier de sauvegarde illisible ou corrompu.' });
      return;
    }

    const newPlayers = {};
    (Array.isArray(snapshot.players) ? snapshot.players : []).forEach((p, i) => {
      const num = i + 1;
      newPlayers[num] = {
        num,
        name: (p.name || `Joueur ${num}`).trim(),
        balance: Math.max(0, Number(p.balance) || 0),
        bets: {},
        lastBets: {},
        connected: false,
        socketId: null,
        roundHistory: Array.isArray(p.roundHistory) ? p.roundHistory.slice(0, 25) : []
      };
    });

    clearTimeout(autoTimerHandle);
    autoTimerHandle = null;
    game = {
      started: true, spinning: false, players: newPlayers,
      history: Array.isArray(snapshot.gameHistory) ? snapshot.gameHistory.slice(0, 200) : [],
      autoMode: false, autoIntervalSec: 20, nextSpinAt: null
    };
    socket.emit('game-created', { count: Object.keys(newPlayers).length });
    broadcastState();
    broadcastAutoState();
  });

  // ---- Player: join their numbered screen ---------------------------------
  socket.on('join-player', ({ num }) => {
    const p = game.players[num];
    if (!game.started || !p) {
      socket.emit('join-error', { message: "La partie n'a pas encore commence. Attendez que le maitre du jeu demarre la partie." });
      return;
    }
    p.connected = true;
    p.socketId = socket.id;
    socket.data.playerNum = num;
    socket.emit('joined', {
      num: p.num, name: p.name, balance: p.balance, bets: p.bets,
      history: game.history.slice(0, 25), hotcold: computeStats(),
      chipValues: CHIP_VALUES, grid: GRID, spinning: game.spinning,
      roundHistoryCount: (p.roundHistory || []).length,
      lastBets: p.lastBets || {}
    });
    broadcastState();
  });

  // ---- Player: place a bet --------------------------------------------------
  socket.on('place-bet', ({ key, amount }) => {
    const num = socket.data.playerNum;
    const p = game.players[num];
    if (!p || game.spinning) return;
    if (!isValidBetKey(key)) return;
    if (!CHIP_VALUES.includes(amount)) return;
    const opposite = OPPOSITE_BETS[key];
    if (opposite && p.bets[opposite]) {
      socket.emit('bet-refused', {
        message: `Impossible de miser sur ${BET_LABELS[key]} et ${BET_LABELS[opposite]} en meme temps.`
      });
      return;
    }
    if (p.balance < amount) {
      socket.emit('bet-refused', { message: 'Solde insuffisant.' });
      return;
    }
    p.balance -= amount;
    p.bets[key] = (p.bets[key] || 0) + amount;
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState();
  });

  // ---- Player: repeat the exact bets from their last round --------------------
  socket.on('repeat-last-bet', () => {
    const num = socket.data.playerNum;
    const p = game.players[num];
    if (!p || game.spinning) return;
    if (!p.lastBets || Object.keys(p.lastBets).length === 0) return;
    const total = Object.values(p.lastBets).reduce((a, b) => a + b, 0);
    if (p.balance < total) {
      socket.emit('bet-refused', { message: 'Solde insuffisant pour rejouer la mise precedente.' });
      return;
    }
    p.balance -= total;
    Object.entries(p.lastBets).forEach(([key, amount]) => {
      p.bets[key] = (p.bets[key] || 0) + amount;
    });
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState();
  });

  // ---- Player: remove a single bet spot (the "gomme", one click at a time) ---
  socket.on('remove-bet', ({ key }) => {
    const num = socket.data.playerNum;
    const p = game.players[num];
    if (!p || game.spinning) return;
    const amount = p.bets[key];
    if (!amount) return;
    p.balance += amount;
    delete p.bets[key];
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState();
  });

  // ---- Player: clear all their bets at once ----------------------------------
  socket.on('clear-bets', () => {
    const num = socket.data.playerNum;
    const p = game.players[num];
    if (!p || game.spinning) return;
    const refund = totalBetOf(p);
    p.balance += refund;
    p.bets = {};
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState();
  });

  // ---- Player: save balance + history to disk and leave -----------------------
  socket.on('save-quit', () => {
    const num = socket.data.playerNum;
    const p = game.players[num];
    if (!p) return;
    const record = {
      name: p.name,
      balance: p.balance,
      history: (p.roundHistory || []).slice(0, 25)
    };
    fs.appendFileSync(SAVE_FILE, JSON.stringify(record) + '\n');
    p.connected = false;
    socket.emit('quit-confirmed');
    broadcastState();
  });

  // ---- Master: top up a player's balance (e.g. after going bankrupt) ----------
  socket.on('add-funds', ({ num, amount }) => {
    const p = game.players[num];
    const amt = Number(amount);
    if (!p || !Number.isFinite(amt) || amt <= 0) return;
    p.balance += amt;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('balance-update', { balance: p.balance });
    broadcastState();
  });

  // ---- Master: launch a spin -------------------------------------------------
  socket.on('spin-request', () => performSpin());

  // ---- Master: enable/disable auto-spin mode and its interval ----------------
  socket.on('set-auto-mode', ({ enabled, interval }) => {
    if (!game.started) return;
    game.autoMode = !!enabled;
    const iv = Number(interval);
    if ([10, 20, 30].includes(iv)) game.autoIntervalSec = iv;
    scheduleAutoSpin();
  });

  socket.on('disconnect', () => {
    const num = socket.data.playerNum;
    if (num && game.players[num] && game.players[num].socketId === socket.id) {
      game.players[num].connected = false;
      broadcastState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Casino Roulette lance : http://localhost:${PORT}/maitre.html`);
});
