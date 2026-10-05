// Casino Royal - roulette multi-joueurs, multi-salons.
// Chaque salon (code court, ex. K7QF) contient une partie complete et independante :
// ses joueurs, ses tirages, son mode automatique, ses sauvegardes.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const R = require('./roulette');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 7777;
// DATA_DIR peut pointer vers un disque persistant (ex. Render : /var/data)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SALONS_DIR = path.join(DATA_DIR, 'salons');
const PUBLIC = path.join(__dirname, 'public');

const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS) || 6 * 3600 * 1000;      // salon sans personne depuis 6 h : supprime de la memoire
const PURGE_INTERVAL_MS = Number(process.env.PURGE_INTERVAL_MS) || 10 * 60 * 1000;
const MAX_ROOMS = 300;

fs.mkdirSync(SALONS_DIR, { recursive: true });

// Adresses IPv4 locales (hors loopback) utilisables par les autres appareils du reseau.
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
// Codes de salon et dossiers de sauvegarde (un dossier par salon)
// ---------------------------------------------------------------------------
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'CSS', 'JS', 'LIB', 'SOCKET', 'STATIC', 'DATA', 'JOUEUR', 'MAITRE', 'MASTER', 'ARBITRE', 'ACCUEIL', 'FAVICON', 'REJOINDRE']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sans 0/O ni 1/I/L : evite les confusions a l'oral
const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d+$/.test(c);

const salonDir = code => path.join(SALONS_DIR, code);
const saveFileOf = code => path.join(salonDir(code), 'joueurs.txt');
const partiesDirOf = code => path.join(salonDir(code), 'parties');
const salonKnownOnDisk = code => fs.existsSync(salonDir(code));
function ensureSalonDir(code) {
  fs.mkdirSync(partiesDirOf(code), { recursive: true });
  if (!fs.existsSync(saveFileOf(code))) fs.writeFileSync(saveFileOf(code), '');
}

// Anciennes versions (un seul salon implicite) : data/joueurs.txt et data/parties/
// sont deplaces vers le salon PRINCIPAL pour ne rien perdre.
(function migrateLegacyData() {
  const legacySave = path.join(DATA_DIR, 'joueurs.txt');
  const legacyParties = path.join(DATA_DIR, 'parties');
  let partyFiles = [];
  try { partyFiles = fs.readdirSync(legacyParties).filter(f => f.endsWith('.json')); } catch { }
  let hasSave = false;
  try { hasSave = fs.statSync(legacySave).size > 0; } catch { }
  if ((!hasSave && partyFiles.length === 0) || salonKnownOnDisk('PRINCIPAL')) return;
  ensureSalonDir('PRINCIPAL');
  if (hasSave) fs.renameSync(legacySave, saveFileOf('PRINCIPAL'));
  partyFiles.forEach(f => fs.renameSync(path.join(legacyParties, f), path.join(partiesDirOf('PRINCIPAL'), f)));
  console.log('  Anciennes sauvegardes deplacees vers le salon PRINCIPAL (creez un salon avec le code PRINCIPAL pour les retrouver).');
})();

// ---------------------------------------------------------------------------
// Registre des salons : code -> { code, game, autoTimer, lastActivity }
// ---------------------------------------------------------------------------
function newGame() {
  return {
    started: false,
    spinning: false,
    players: {},       // num -> { num, name, balance, bets: {key:amount}, connected, socketId, ... }
    history: [],       // { number, color }, le plus recent en premier (200 max)
    autoMode: false,
    autoIntervalSec: 20,
    nextSpinAt: null   // epoch ms, ou null si aucun tirage automatique n'est programme
  };
}

const rooms = new Map();
const socketCount = code => { const s = io.sockets.adapter.rooms.get(code); return s ? s.size : 0; };

function destroyRoom(room) {
  room.destroyed = true;
  clearTimeout(room.autoTimer);
  rooms.delete(room.code);
}
// force : le registre est plein, on libere les salons vides (sauf ceux crees il y a moins d'une minute)
function purgeRooms(force) {
  const limit = force ? 60 * 1000 : ROOM_IDLE_MS;
  for (const room of [...rooms.values()]) {
    if (socketCount(room.code) === 0 && Date.now() - room.lastActivity > limit) destroyRoom(room);
  }
}
setInterval(() => purgeRooms(false), PURGE_INTERVAL_MS).unref();

// create=false : un salon deja connu sur le disque est recree a la demande
// (utile apres un redemarrage du serveur) ; sinon on renvoie null.
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !salonKnownOnDisk(code)) return null;
  if (rooms.size >= MAX_ROOMS) purgeRooms(true);
  if (rooms.size >= MAX_ROOMS) return null;
  ensureSalonDir(code);
  const room = { code, game: newGame(), autoTimer: null, lastActivity: Date.now(), destroyed: false };
  rooms.set(code, room);
  return room;
}

function newCode() {
  for (let len = 4; len <= 8; len++) {
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !salonKnownOnDisk(c) && validCode(c)) return c;
    }
  }
  throw new Error('Impossible de generer un code de salon');
}

// ---------------------------------------------------------------------------
// Etat diffuse aux clients d'un salon
// ---------------------------------------------------------------------------
function publicState(room) {
  const game = room.game;
  return {
    started: game.started,
    spinning: game.spinning,
    players: Object.values(game.players).map(p => ({
      num: p.num, name: p.name, balance: p.balance,
      connected: p.connected, totalBet: R.totalBetOf(p),
      historyCount: (p.roundHistory || []).length
    })),
    history: game.history.slice(0, 25),
    hotcold: R.computeStats(game.history)
  };
}

function autoState(room) {
  const game = room.game;
  return {
    started: game.started,
    autoMode: game.autoMode,
    autoIntervalSec: game.autoIntervalSec,
    nextSpinAt: game.nextSpinAt
  };
}

const emitRoom = (room, event, payload) => io.to(room.code).emit(event, payload);
const broadcastState = room => emitRoom(room, 'state-update', publicState(room));
const broadcastAutoState = room => emitRoom(room, 'auto-state', autoState(room));

// Arme (ou desarme) le compte a rebours du tirage automatique du salon. Peut etre
// appele a tout moment : annule toujours le minuteur precedent (jamais deux en meme temps).
function scheduleAutoSpin(room) {
  clearTimeout(room.autoTimer);
  room.autoTimer = null;
  const game = room.game;
  if (room.destroyed || !game.autoMode || !game.started) {
    game.nextSpinAt = null;
    broadcastAutoState(room);
    return;
  }
  game.nextSpinAt = Date.now() + game.autoIntervalSec * 1000;
  broadcastAutoState(room);
  room.autoTimer = setTimeout(() => {
    if (room.destroyed) return;
    const g = room.game;
    if (socketCount(room.code) === 0) {
      // plus personne dans le salon : on met le mode automatique en pause
      g.autoMode = false;
      g.nextSpinAt = null;
      broadcastAutoState(room);
      return;
    }
    if (g.autoMode && g.started && !g.spinning) performSpin(room);
    else scheduleAutoSpin(room);
  }, game.autoIntervalSec * 1000);
}

// Un tirage complet : choisit le numero, diffuse l'animation de 3 s, puis regle les
// mises de chaque joueur. Utilise par le bouton manuel et par le minuteur automatique.
function performSpin(room) {
  const game = room.game;
  if (room.destroyed || !game.started || game.spinning) return;
  clearTimeout(room.autoTimer);
  room.autoTimer = null;

  game.spinning = true;
  const winNumber = Math.floor(Math.random() * 37);
  const winColor = R.colorOf(winNumber);
  emitRoom(room, 'spin-start', { number: winNumber, color: winColor, duration: 3000 });

  setTimeout(() => {
    if (room.destroyed || room.game !== game) return;   // salon supprime ou partie remplacee entre-temps

    Object.values(game.players).forEach(p => {
      const betsSnapshot = { ...p.bets };
      const miseTotale = R.totalBetOf(p);
      let winnings = 0;
      Object.entries(p.bets).forEach(([key, amount]) => {
        winnings += R.evaluateBet(key, amount, winNumber);
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

    emitRoom(room, 'spin-result', {
      number: winNumber, color: winColor,
      history: game.history.slice(0, 25),
      hotcold: R.computeStats(game.history)
    });
    broadcastState(room);

    if (game.autoMode) scheduleAutoSpin(room);
  }, 3000);
}

// ---------------------------------------------------------------------------
// HTTP : pages, API des salons
// ---------------------------------------------------------------------------
app.use(express.json());
app.use('/css', express.static(path.join(PUBLIC, 'css')));
app.use('/js', express.static(path.join(PUBLIC, 'js')));

const sendPage = (res, name) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(PUBLIC, name)); };

app.get('/', (req, res) => sendPage(res, 'accueil.html'));
app.get('/favicon.ico', (req, res) => res.status(204).end());
// anciennes adresses (un seul salon implicite) -> accueil
app.get(['/maitre.html', '/master.html'], (req, res) => res.redirect('/'));
app.get(/^\/joueur\d+\.html$/, (req, res) => res.redirect('/'));

// Adresses reseau du serveur : pour que la page maitre donne un lien utilisable depuis un autre appareil.
app.get('/api/server-info', (req, res) => {
  res.json({ port: PORT, ips: getLocalIPs() });
});

// Creation d'un salon : code aleatoire, ou code choisi (3 a 10 lettres/chiffres).
// reuse:true => on (re)prend un salon existant ou on le recree avec le meme code.
app.post('/api/salons', (req, res) => {
  const body = req.body || {};
  const code = body.code ? cleanCode(body.code) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: 'Code invalide : 3 a 10 lettres ou chiffres' });
  if (rooms.has(code) && !body.reuse) return res.json({ ok: false, error: `Le salon ${code} est deja en cours d'utilisation` });
  const room = getRoom(code, true);
  if (!room) return res.json({ ok: false, error: 'Le serveur est plein, reessayez dans quelques minutes' });
  res.json({ ok: true, code });
});

// --- API d'un salon : /api/salons/:code/... --------------------------------
const salonApi = express.Router();
app.use('/api/salons/:code', (req, res, next) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Code de salon invalide' });
  req.salonCode = code;
  next();
}, salonApi);

// Infos publiques : utilisees par la page d'accueil pour choisir son siege.
salonApi.get('/', (req, res) => {
  const room = getRoom(req.salonCode, false);
  if (!room) return res.json({ exists: false, code: req.salonCode });
  const g = room.game;
  res.json({
    exists: true, code: room.code, started: g.started, spinning: g.spinning,
    players: Object.values(g.players).map(p => ({ num: p.num, name: p.name, connected: p.connected }))
  });
});

function parseSoldeLine(line) {
  try {
    return JSON.parse(line);
  } catch (e) {
    // compatibilite avec l'ancien format texte "nom:solde"
    const [savedName, savedBalance] = line.split(':');
    return savedName ? { name: savedName, balance: parseFloat(savedBalance), history: [] } : null;
  }
}
function readSoldeLines(code) {
  try { return fs.readFileSync(saveFileOf(code), 'utf8').split('\n').filter(Boolean); } catch { return []; }
}

// Solde sauvegarde d'un joueur (solde + 25 dernieres parties), par nom
salonApi.get('/solde/:nom', (req, res) => {
  const nom = decodeURIComponent(req.params.nom).trim().toLowerCase();
  const lines = readSoldeLines(req.salonCode);
  for (let i = lines.length - 1; i >= 0; i--) {
    const rec = parseSoldeLine(lines[i]);
    if (rec && rec.name && rec.name.trim().toLowerCase() === nom) {
      return res.json({ found: true, balance: rec.balance, history: rec.history || [] });
    }
  }
  res.json({ found: false });
});

// Tous les joueurs sauvegardes du salon (le fichier est en ajout : la derniere ligne gagne)
salonApi.get('/soldes', (req, res) => {
  const byName = new Map();
  readSoldeLines(req.salonCode).forEach(line => {
    const rec = parseSoldeLine(line);
    if (rec && rec.name) byName.set(rec.name.trim().toLowerCase(), rec);
  });
  res.json({
    soldes: [...byName.values()].map(rec => ({ name: rec.name, balance: rec.balance, historyCount: (rec.history || []).length }))
  });
});

salonApi.delete('/solde/:nom', (req, res) => {
  const nom = decodeURIComponent(req.params.nom).trim().toLowerCase();
  const lines = readSoldeLines(req.salonCode);
  const kept = lines.filter(line => {
    const rec = parseSoldeLine(line);
    return !(rec && rec.name && rec.name.trim().toLowerCase() === nom);
  });
  if (lines.length) fs.writeFileSync(saveFileOf(req.salonCode), kept.length ? kept.join('\n') + '\n' : '');
  res.json({ success: true, removed: lines.length - kept.length });
});

// Parties completes sauvegardees du salon (les plus recentes d'abord)
salonApi.get('/parties', (req, res) => {
  const dir = partiesDirOf(req.salonCode);
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { }
  const parties = files.map(filename => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf8'));
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
});

salonApi.delete('/parties/:filename', (req, res) => {
  const filename = req.params.filename;
  if (filename !== path.basename(filename) || !filename.endsWith('.json')) {
    return res.status(400).json({ success: false, message: 'Nom de fichier invalide.' });
  }
  try {
    const filePath = path.join(partiesDirOf(req.salonCode), filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Impossible de supprimer ce fichier.' });
  }
});

// --- Pages d'un salon --------------------------------------------------------
//   /CODE                 page maitre du salon
//   /CODE/rejoindre       page d'accueil, code pre-rempli (lien / QR code des joueurs)
//   /CODE/joueurN         ecran du joueur N (".html" accepte aussi)
const pageCode = req => cleanCode(req.params[0]);
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur(\d+)(?:\.html)?\/?$/, (req, res, next) => validCode(pageCode(req)) ? sendPage(res, 'joueur.html') : next());
app.get(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/, (req, res, next) => validCode(pageCode(req)) ? sendPage(res, 'accueil.html') : next());
app.get(/^\/([A-Za-z0-9]{3,10})\/?$/, (req, res, next) => validCode(pageCode(req)) ? sendPage(res, 'master.html') : next());

// ---------------------------------------------------------------------------
// Socket.io : une connexion = une page ouverte dans un salon (?room=CODE)
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const code = cleanCode(socket.handshake.query && socket.handshake.query.room);
  const room = validCode(code) ? getRoom(code, false) : null;
  if (!room) {
    // salon inconnu (serveur redemarre, salon expire...) : la page decide quoi faire
    socket.emit('no-room', { code });
    return;
  }
  socket.join(room.code);
  socket.data.roomCode = room.code;
  room.lastActivity = Date.now();
  socket.onAny(() => { room.lastActivity = Date.now(); });

  socket.emit('state-update', publicState(room));
  socket.emit('auto-state', autoState(room));

  const makePlayer = (num, p) => ({
    num,
    name: (p.name || `Joueur ${num}`).trim(),
    balance: Math.max(0, Number(p.balance) || 0),
    bets: {},
    lastBets: {},
    connected: false,
    socketId: null,
    roundHistory: Array.isArray(p.history || p.roundHistory) ? (p.history || p.roundHistory).slice(0, 25) : []
  });

  // ---- Maitre : nouvelle partie ---------------------------------------------
  socket.on('create-game', (payload) => {
    const players = Array.isArray(payload?.players) ? payload.players : [];
    const newPlayers = {};
    players.forEach((p, i) => { newPlayers[i + 1] = makePlayer(i + 1, p); });
    clearTimeout(room.autoTimer);
    room.autoTimer = null;
    room.game = { ...newGame(), started: true, players: newPlayers };
    socket.emit('game-created', { count: players.length });
    broadcastState(room);
    broadcastAutoState(room);
  });

  // ---- Maitre : sauvegarder la partie complete (soldes + historiques + tirages) ---
  socket.on('save-game', ({ label }) => {
    const game = room.game;
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
      ensureSalonDir(room.code);
      fs.writeFileSync(path.join(partiesDirOf(room.code), filename), JSON.stringify(snapshot, null, 2));
      socket.emit('game-saved', { filename, label: snapshot.label });
    } catch (e) {
      socket.emit('game-save-error', { message: "Impossible d'ecrire la sauvegarde sur le disque." });
    }
  });

  // ---- Maitre : recharger une partie sauvegardee du salon ----------------------
  socket.on('load-game', ({ filename }) => {
    const name = String(filename || '');
    if (name !== path.basename(name) || !name.endsWith('.json')) {
      socket.emit('load-game-error', { message: 'Sauvegarde introuvable.' });
      return;
    }
    const filePath = path.join(partiesDirOf(room.code), name);
    if (!fs.existsSync(filePath)) {
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
      newPlayers[i + 1] = makePlayer(i + 1, p);
    });
    clearTimeout(room.autoTimer);
    room.autoTimer = null;
    room.game = {
      ...newGame(), started: true, players: newPlayers,
      history: Array.isArray(snapshot.gameHistory) ? snapshot.gameHistory.slice(0, 200) : []
    };
    socket.emit('game-created', { count: Object.keys(newPlayers).length });
    broadcastState(room);
    broadcastAutoState(room);
  });

  // ---- Maitre : ajouter un joueur a la partie en cours -------------------------
  // (les statistiques sont communes a toute la partie : le nouveau les voit aussitot)
  socket.on('add-player', ({ name, balance, history }) => {
    const game = room.game;
    if (!game.started) return;
    const existingNums = Object.keys(game.players).map(Number);
    const num = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
    game.players[num] = makePlayer(num, { name, balance, history });
    socket.emit('player-added', { num, name: game.players[num].name });
    broadcastState(room);
  });

  // ---- Joueur : rejoindre son ecran numerote ------------------------------------
  socket.on('join-player', ({ num }) => {
    const game = room.game;
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
      history: game.history.slice(0, 25), hotcold: R.computeStats(game.history),
      chipValues: R.CHIP_VALUES, grid: R.GRID, spinning: game.spinning,
      roundHistoryCount: (p.roundHistory || []).length,
      lastBets: p.lastBets || {}
    });
    broadcastState(room);
  });

  // ---- Joueur : miser ---------------------------------------------------------
  socket.on('place-bet', ({ key, amount }) => {
    const game = room.game;
    const p = game.players[socket.data.playerNum];
    if (!p || game.spinning) return;
    if (!R.isValidBetKey(key)) return;
    if (!R.CHIP_VALUES.includes(amount)) return;
    const opposite = R.OPPOSITE_BETS[key];
    if (opposite && p.bets[opposite]) {
      socket.emit('bet-refused', {
        message: `Impossible de miser sur ${R.BET_LABELS[key]} et ${R.BET_LABELS[opposite]} en meme temps.`
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
    broadcastState(room);
  });

  // ---- Joueur : rejouer les mises du tour precedent -------------------------------
  socket.on('repeat-last-bet', () => {
    const game = room.game;
    const p = game.players[socket.data.playerNum];
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
    broadcastState(room);
  });

  // ---- Joueur : effacer une mise (la gomme) ---------------------------------------
  socket.on('remove-bet', ({ key }) => {
    const game = room.game;
    const p = game.players[socket.data.playerNum];
    if (!p || game.spinning) return;
    const amount = p.bets[key];
    if (!amount) return;
    p.balance += amount;
    delete p.bets[key];
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState(room);
  });

  // ---- Joueur : effacer toutes ses mises -------------------------------------------
  socket.on('clear-bets', () => {
    const game = room.game;
    const p = game.players[socket.data.playerNum];
    if (!p || game.spinning) return;
    p.balance += R.totalBetOf(p);
    p.bets = {};
    socket.emit('bet-update', { balance: p.balance, bets: p.bets });
    broadcastState(room);
  });

  // ---- Joueur : sauvegarder solde + historique dans le salon et quitter -------------
  socket.on('save-quit', () => {
    const game = room.game;
    const p = game.players[socket.data.playerNum];
    if (!p) return;
    const record = {
      name: p.name,
      balance: p.balance,
      history: (p.roundHistory || []).slice(0, 25)
    };
    ensureSalonDir(room.code);
    fs.appendFileSync(saveFileOf(room.code), JSON.stringify(record) + '\n');
    p.connected = false;
    socket.emit('quit-confirmed');
    broadcastState(room);
  });

  // ---- Maitre : recharger un joueur a sec ------------------------------------------
  socket.on('add-funds', ({ num, amount }) => {
    const game = room.game;
    const p = game.players[num];
    const amt = Number(amount);
    if (!p || !Number.isFinite(amt) || amt <= 0) return;
    p.balance += amt;
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('balance-update', { balance: p.balance });
    broadcastState(room);
  });

  // ---- Maitre : lancer un tirage ------------------------------------------------------
  socket.on('spin-request', () => performSpin(room));

  // ---- Maitre : mode automatique (10, 20 ou 30 s) --------------------------------------
  socket.on('set-auto-mode', ({ enabled, interval }) => {
    const game = room.game;
    if (!game.started) return;
    game.autoMode = !!enabled;
    const iv = Number(interval);
    if ([10, 20, 30].includes(iv)) game.autoIntervalSec = iv;
    scheduleAutoSpin(room);
  });

  socket.on('disconnect', () => {
    const p = room.game.players[socket.data.playerNum];
    if (p && p.socketId === socket.id) {
      p.connected = false;
      broadcastState(room);
    }
  });
});

server.listen(PORT, () => {
  console.log('\n  Casino Roulette lance !');
  console.log(`  Accueil (creer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const ip of getLocalIPs()) console.log(`  Depuis le reseau local                : http://${ip}:${PORT}/`);
  console.log('');
});
