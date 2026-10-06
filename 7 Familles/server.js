// 7 Familles — serveur multijoueur avec SALONS (Node.js + Express + Socket.io)
// Lancement : npm start  →  http://localhost:1500
//
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante :
//   /                      accueil (créer ou rejoindre un salon)
//   /K7QF                  page de l'arbitre du salon
//   /K7QF/rejoindre        page « rejoindre » (adresse du QR code)
//   /K7QF/joueur1.html     page du joueur 1 (joueur2.html, …)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const AdmZip = require('adm-zip');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 1500;
const PUBLIC = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CARDS_DIR = path.join(UPLOAD_DIR, 'cards');      // uploads/cards/<CODE>/...
const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
const SAVE_FILE = path.join(__dirname, 'sauvegarde.json');

const MIN_PLAYERS = 2, MAX_PLAYERS = 10, CARDS_PER_PLAYER = 6, DEFAULT_FAMILY_SIZE = 6;
const MAX_SAVED = 40;                       // salons mémorisés (cartes + noms des joueurs)
const MAX_ROOMS = 200;
const ROOM_IDLE_MS = 6 * 3600 * 1000;       // salon sans personne depuis 6 h : libéré de la mémoire

[UPLOAD_DIR, CARDS_DIR, TMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Palette : bleu clair, rouge, jaune, orange, vert, violet foncé, rose (+ secours)
const FAMILY_COLORS = [
  '#29B6F6', '#E53935', '#FDD835', '#FB8C00', '#43A047', '#6A1B9A', '#EC407A',
  '#8D6E63', '#00897B', '#5C6BC0', '#C0CA33', '#455A64',
];

// ---------------------------------------------------------------- utilitaires
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// "Pirate 01 - Monkey D. Luffy.png" -> { family, number, name, ext }
function parseFilename(filename) {
  const ext = path.extname(filename);
  const m = path.basename(filename, ext).match(/^(.+?)\s+(\d+)\s*-\s*(.+)$/);
  return m ? { family: m[1].trim(), number: m[2].trim(), name: m[3].trim(), ext } : null;
}
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}
const rmCards = code => { try { fs.rmSync(path.join(CARDS_DIR, code), { recursive: true, force: true }); } catch { } };

// ---------------------------------------------------------------- sauvegarde des salons
// On mémorise par code de salon : les cartes chargées (les images restent sur le disque) et les noms des joueurs,
// pour retrouver un salon tel quel après un redémarrage du serveur. La partie en cours, elle, n'est pas conservée.
let saved = {};
try {
  const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  saved = d && d.rooms && typeof d.rooms === 'object' ? d.rooms : {};
} catch { }
let saveTimer = null;
function saveRoom(code, data) {
  saved[code] = { ...data, t: Date.now() };
  const keys = Object.keys(saved).sort((a, b) => (saved[b].t || 0) - (saved[a].t || 0));
  for (const k of keys.slice(MAX_SAVED)) {
    if (rooms.has(k)) continue;            // jamais un salon en cours d'utilisation
    delete saved[k]; rmCards(k);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: saved }, null, 1), () => { }), 300);
}
// dossiers d'images orphelins (ancienne version, salons oubliés) → supprimés au démarrage
try {
  for (const f of fs.readdirSync(CARDS_DIR)) if (!saved[f]) fs.rmSync(path.join(CARDS_DIR, f), { recursive: true, force: true });
} catch { }

// ---------------------------------------------------------------- Express / Socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 300 * 1024 * 1024 } });

const rooms = new Map();                                   // code → salon
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'CARDS', 'SOCKET', 'JOUEUR', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'FAVICON', 'REJOINDRE']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // sans 0/O ni 1/I/L (confusions)
const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d+$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !saved[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms) if (r.empty() && (force || r.idle() > ROOM_IDLE_MS)) rooms.delete(code);
}
setInterval(() => purge(false), 10 * 60 * 1000);
// un salon connu du fichier de sauvegarde est recréé à la demande
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !saved[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code, saved[code] || null);
  rooms.set(code, r);
  if (!saved[code]) saveRoom(code, { cards: [], families: [], names: [] });
  return r;
}

// ================================================================ un salon = une partie indépendante
const EVENTS = ['set-players', 'start-game', 'reset-game', 'request-hand', 'player-ready', 'select-opponent',
  'give-card', 'draw-pioche', 'draw-result', 'pass-turn', 'claim-family'];

function createRoom(code, savedData) {
  let cards = [], families = [];   // cartes du salon : {id, family, number, name, file} ; familles : {name, color, size}
  let g = {
    players: [],                   // {id, name, hand:[], ready, handRevealed, families:[]}
    pioche: [], completed: [],     // completed : {family, ownerId, ownerName}
    started: false, current: null, request: null, allReady: false,
    awaitingDraw: false, lastDrawn: null, over: null,
  };
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };

  const chM = code + ':m', chP = id => `${code}:p${id}`;     // canaux Socket.io : arbitre, joueur n
  const toAll = (ev, d) => io.to(code).emit(ev, d);
  const toMaster = (ev, d) => io.to(chM).emit(ev, d);
  const toPlayer = (id, ev, d) => io.to(chP(id)).emit(ev, d);
  const online = id => { const s = io.sockets.adapter.rooms.get(chP(id)); return !!(s && s.size); };

  const makePlayers = (count, names) => Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    name: String((names && names[i]) ?? '').trim().slice(0, 20) || `Joueur ${i + 1}`,
    hand: [], ready: false, handRevealed: false, families: [],
  }));
  const pubPlayers = () => g.players.map(p => ({ id: p.id, name: p.name }));
  const orderedIds = () => g.players.map(p => p.id).sort((a, b) => Number(a) - Number(b));
  const persistRoom = () => saveRoom(code, { cards, families, names: g.players.map(p => p.name) });

  // reprise des données enregistrées (les images doivent toujours exister sur le disque)
  if (savedData) {
    const ok = Array.isArray(savedData.cards) && savedData.cards.length &&
      savedData.cards.every(c => c && c.file && fs.existsSync(path.join(CARDS_DIR, code, path.basename(c.file))));
    if (ok) { cards = savedData.cards; families = Array.isArray(savedData.families) ? savedData.families : []; }
    if (Array.isArray(savedData.names) && savedData.names.length >= MIN_PLAYERS)
      g.players = makePlayers(Math.min(savedData.names.length, MAX_PLAYERS), savedData.names);
  }

  // ---------------------------------------------------------------- vues
  function masterState() {
    return {
      started: g.started,
      players: g.players.map(p => ({
        id: p.id, name: p.name, handCount: p.hand.length, families: p.families, ready: p.ready, online: online(p.id),
      })),
      piocheCount: g.pioche.length, currentPlayerId: g.current, completedFamilies: g.completed, over: g.over,
    };
  }
  const broadcastMaster = () => toMaster('master-state', masterState());
  function playerInfo(id, p) {
    return {
      room: code, id, exists: !!p, name: p ? p.name : null, started: g.started,
      players: pubPlayers(), families, currentPlayerId: g.current, piocheCount: g.pioche.length,
      completedFamilies: g.completed, requestContext: g.request,
      ready: !!(p && p.ready), handRevealed: !!(p && p.handRevealed), hand: p && p.handRevealed ? p.hand : [],
      pendingDraw: p && g.current === p.id && g.awaitingDraw ? g.lastDrawn : null,   // carte piochée pas encore validée
      over: g.over,
    };
  }

  // ---------------------------------------------------------------- mécanique du jeu
  function setRequest(ctx) { g.request = ctx; toAll('request-context-update', ctx); }
  function emitTurn() {
    toAll('turn-changed', { currentPlayerId: g.current, order: orderedIds(), piocheCount: g.pioche.length });
    broadcastMaster();
  }
  function advanceTurn() {            // joueur suivant, dans l'ordre croissant
    const order = orderedIds();
    g.current = order[(order.indexOf(g.current) + 1) % order.length];
    g.awaitingDraw = false; g.lastDrawn = null;
    setRequest(null);
    emitTurn();
  }
  function finish() {
    const standings = g.players.map(p => ({ id: p.id, name: p.name, count: p.families.length })).sort((a, b) => b.count - a.count);
    const winners = standings.filter(x => x.count === standings[0].count).map(x => x.name);
    g.over = { standings, winners, winner: winners.join(' et '), tie: winners.length > 1, completed: g.completed };
    g.awaitingDraw = false; g.lastDrawn = null;
    setRequest(null);
    toAll('game-over', g.over);
  }

  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const me = s => g.players.find(p => p.id === s.playerId);
  const needTurn = s => {
    need(g.started && g.allReady && !g.over, "La partie n'est pas en cours");
    need(s.playerId === g.current, "Ce n'est pas votre tour");
    need(!g.awaitingDraw, 'Répondez d\'abord à propos de la carte piochée');
  };

  const H = {
    // ---------- arbitre
    'set-players'(s, d) {
      need(s.isMaster, "Action réservée à l'arbitre");
      need(!g.started, 'Impossible de modifier les joueurs pendant une partie');
      const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, parseInt(d.count, 10) || MIN_PLAYERS));
      g.players = makePlayers(count, Array.isArray(d.names) ? d.names : []);
      persistRoom();
      toMaster('players-set', { players: pubPlayers() });
      broadcastMaster();
    },
    'start-game'(s) {
      need(s.isMaster, "Action réservée à l'arbitre");
      need(!g.started, 'La partie est déjà lancée');
      need(g.players.length >= MIN_PLAYERS, "Enregistre d'abord les joueurs (onglet « Joueurs »).");
      need(cards.length > 0, "Charge d'abord les cartes (onglet « Cartes »).");
      need(g.players.length * CARDS_PER_PLAYER <= cards.length,
        `Pas assez de cartes : ${g.players.length} joueurs × ${CARDS_PER_PLAYER} = ${g.players.length * CARDS_PER_PLAYER} cartes, mais seulement ${cards.length} chargées.`);
      const deck = shuffle(cards);
      let cur = 0;
      g.players.forEach(p => {
        p.hand = deck.slice(cur, cur + CARDS_PER_PLAYER); cur += CARDS_PER_PLAYER;
        p.ready = false; p.handRevealed = false; p.families = [];
      });
      Object.assign(g, { pioche: deck.slice(cur), completed: [], started: true, current: null, request: null,
        allReady: false, awaitingDraw: false, lastDrawn: null, over: null });
      toAll('game-started', { players: pubPlayers(), piocheCount: g.pioche.length });
      broadcastMaster();
    },
    'reset-game'(s) {                 // nouvelle partie dans le même salon (mêmes cartes, mêmes joueurs)
      need(s.isMaster, "Action réservée à l'arbitre");
      need(g.started, 'Aucune partie à réinitialiser');
      g.players.forEach(p => { p.hand = []; p.ready = false; p.handRevealed = false; p.families = []; });
      Object.assign(g, { pioche: [], completed: [], started: false, current: null, request: null,
        allReady: false, awaitingDraw: false, lastDrawn: null, over: null });
      toAll('game-reset');
      broadcastMaster();
    },

    // ---------- joueurs
    'request-hand'(s) {
      const p = me(s);
      need(p && g.started, "La partie n'est pas lancée");
      p.handRevealed = true;
      toPlayer(p.id, 'your-hand', { hand: p.hand, families });
      broadcastMaster();
    },
    'player-ready'(s) {
      const p = me(s);
      need(p && g.started && p.handRevealed, "Reçois d'abord tes cartes");
      p.ready = true;
      if (g.players.every(x => x.ready) && !g.allReady) {       // tout le monde est prêt : tirage au sort du premier joueur
        g.allReady = true;
        g.current = g.players[(Math.random() * g.players.length) | 0].id;
        setRequest(null);
        emitTurn();
      } else broadcastMaster();
    },
    'select-opponent'(s, d) {
      needTurn(s);
      const target = g.players.find(p => p.id === String(d.opponentId));
      need(target && target.id !== s.playerId, 'Adversaire invalide');
      setRequest({ fromId: s.playerId, toId: target.id });
    },
    'give-card'(s, d) {
      need(g.started && !g.over && g.request && g.request.toId === s.playerId, "Personne ne vous demande de carte");
      const target = me(s), req = g.players.find(p => p.id === g.request.fromId);
      const idx = target.hand.findIndex(c => c.id === d.cardId);
      need(idx >= 0, 'Carte introuvable dans votre main');
      const [card] = target.hand.splice(idx, 1);
      req.hand.push(card);
      toPlayer(target.id, 'your-hand', { hand: target.hand, families });
      toPlayer(req.id, 'your-hand', { hand: req.hand, families });
      toPlayer(req.id, 'card-received', { card, fromName: target.name });
      setRequest(null);
      emitTurn();                     // le demandeur garde la main
    },
    'draw-pioche'(s) {
      needTurn(s);
      need(g.pioche.length > 0, 'La pioche est vide');
      const [card] = g.pioche.splice((Math.random() * g.pioche.length) | 0, 1);
      const p = me(s);
      p.hand.push(card);
      g.awaitingDraw = true; g.lastDrawn = card;
      setRequest(null);
      toPlayer(p.id, 'your-hand', { hand: p.hand, families });
      toPlayer(p.id, 'card-drawn', { card, piocheCount: g.pioche.length });
      toAll('pioche-count', { count: g.pioche.length });
      broadcastMaster();
    },
    'draw-result'(s, d) {             // le joueur indique si la carte piochée est celle qu'il demandait
      need(g.started && !g.over && s.playerId === g.current && g.awaitingDraw, 'Aucune carte piochée en attente');
      g.awaitingDraw = false; g.lastDrawn = null;
      if (d.correct) emitTurn(); else advanceTurn();
    },
    'pass-turn'(s) {                  // pioche vide : on ne peut plus que passer son tour
      needTurn(s);
      need(g.pioche.length === 0, "La pioche n'est pas vide : piochez une carte.");
      advanceTurn();
    },
    'claim-family'(s, d) {
      const p = me(s);
      need(p && g.started && !g.over, "La partie n'est pas en cours");
      const fam = String(d.family);
      const size = cards.filter(c => c.family === fam).length || DEFAULT_FAMILY_SIZE;
      need(!g.completed.some(f => f.family === fam), 'Famille déjà complétée');
      const mine = p.hand.filter(c => c.family === fam);
      need(mine.length >= size, `Il faut ${size} cartes de cette famille`);
      const ids = new Set(mine.slice(0, size).map(c => c.id));
      p.hand = p.hand.filter(c => !ids.has(c.id));
      p.families.push(fam);
      g.completed.push({ family: fam, ownerId: p.id, ownerName: p.name });
      toPlayer(p.id, 'your-hand', { hand: p.hand, families });
      toAll('family-completed', { family: fam, ownerName: p.name, completed: g.completed });
      if (g.completed.length >= families.length) finish();      // toutes les familles sont constituées
      broadcastMaster();
    },
  };

  // ---------------------------------------------------------------- API du salon
  return {
    code,
    handle(socket, ev, data) {
      touch();
      try { need(H[ev], 'Action inconnue'); H[ev](socket, data); }
      catch (e) { socket.emit('error-msg', e.message); }
    },
    attachMaster(s) {
      s.isMaster = true; s.roomCode = code; s.join(code); s.join(chM); touch();
      s.emit('server-info', { lanUrls: lanUrls(), code });
      s.emit('cards-loaded', { cards, families });
      if (g.players.length) s.emit('players-set', { players: pubPlayers() });
      s.emit('master-state', masterState());
    },
    attachPlayer(s, id) {
      id = String(id || '');
      s.roomCode = code; s.playerId = id; s.join(code); touch();
      const p = g.players.find(x => x.id === id);
      if (p) s.join(chP(id));
      s.emit('your-info', playerInfo(id, p));
      if (p) broadcastMaster();                                  // voyant « connecté » de l'arbitre
    },
    onDisconnect(s) { touch(); if (s.playerId) broadcastMaster(); },
    info() {
      return {
        exists: true, code, started: g.started, over: !!g.over, cardsCount: cards.length,
        players: g.players.map(p => ({ id: p.id, name: p.name, online: online(p.id) })),
      };
    },
    canUpload: () => !g.started,
    setCards(c, f) { cards = c; families = f; persistRoom(); toMaster('cards-loaded', { cards, families }); },
    idle: () => Date.now() - lastActivity,
    empty: () => { const s = io.sockets.adapter.rooms.get(code); return !s || s.size === 0; },
  };
}

// ================================================================ connexions temps réel
io.on('connection', socket => {
  socket.on('master-join', d => {
    const r = getRoom(cleanCode(d && d.room), false);
    if (!r || !validCode(cleanCode(d.room))) return socket.emit('no-room');
    r.attachMaster(socket);
  });
  socket.on('player-join', d => {
    const code = cleanCode(d && d.room);
    const r = validCode(code) ? getRoom(code, false) : null;
    if (!r) return socket.emit('no-room');
    r.attachPlayer(socket, d.playerId);
  });
  for (const ev of EVENTS) socket.on(ev, data => {
    const r = socket.roomCode && rooms.get(socket.roomCode);
    if (!r) return socket.emit('no-room');
    r.handle(socket, ev, data && typeof data === 'object' ? data : {});
  });
  socket.on('disconnect', () => {
    const r = socket.roomCode && rooms.get(socket.roomCode);
    if (r) r.onDisconnect(socket);
  });
});

// ================================================================ HTTP
app.use(express.json({ limit: '100kb' }));
app.use('/static', express.static(PUBLIC, { index: false }));
app.use('/cards', express.static(CARDS_DIR));
const page = f => (req, res) => res.sendFile(path.join(PUBLIC, f));

app.get('/', page('accueil.html'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// création d'un salon (code aléatoire ou choisi). Un code déjà mémorisé est simplement retrouvé.
app.post('/api/rooms', (req, res) => {
  const a = req.body || {};
  const code = a.code ? cleanCode(a.code) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
  const existing = rooms.get(code);
  if (existing && !existing.empty()) return res.json({ ok: false, error: `Le salon ${code} est déjà en cours d'utilisation` });
  getRoom(code, true);
  res.json({ ok: true, code });
});
app.get('/api/rooms/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const r = validCode(code) ? getRoom(code, false) : null;
  res.set('Cache-Control', 'no-store').json(r ? r.info() : { exists: false, code });
});

// chargement du zip de cartes d'un salon
app.post('/api/rooms/:code/upload-zip', (req, res) => {
  upload.single('zipfile')(req, res, err => {
    const cleanup = () => { if (req.file) fs.unlink(req.file.path, () => { }); };
    const fail = (status, error) => { cleanup(); res.status(status).json({ error }); };
    if (err) return fail(400, 'Envoi impossible : ' + err.message);
    const code = cleanCode(req.params.code);
    const room = validCode(code) ? getRoom(code, false) : null;
    if (!room) return fail(404, "Ce salon n'existe plus");
    if (!room.canUpload()) return fail(409, 'Impossible de changer les cartes pendant une partie');
    if (!req.file) return fail(400, 'Aucun fichier reçu');
    try {
      const entries = new AdmZip(req.file.path).getEntries()
        .filter(e => !e.isDirectory && /\.(png|jpe?g|webp|gif)$/i.test(e.entryName) && !/(^|\/)__MACOSX\//.test(e.entryName));
      if (entries.length > 200) return fail(400, 'Archive trop volumineuse (200 images maximum)');

      const dir = path.join(CARDS_DIR, code);
      rmCards(code); fs.mkdirSync(dir, { recursive: true });
      const stamp = Date.now().toString(36);              // évite le cache du navigateur après un nouveau zip
      const cards = [], colorOf = new Map();
      let skipped = 0;
      entries.forEach((entry, idx) => {
        const parsed = parseFilename(path.basename(entry.entryName));
        if (!parsed || entry.header.size > 15e6) { skipped++; return; }
        const file = `card_${idx}_${stamp}${parsed.ext.toLowerCase()}`;
        fs.writeFileSync(path.join(dir, file), entry.getData());
        if (!colorOf.has(parsed.family)) colorOf.set(parsed.family, FAMILY_COLORS[colorOf.size % FAMILY_COLORS.length]);
        cards.push({ id: `c${idx}`, family: parsed.family, number: parsed.number, name: parsed.name, file: `/cards/${code}/${file}` });
      });
      cleanup();
      const families = [...colorOf].map(([name, color]) => ({ name, color, size: cards.filter(c => c.family === name).length }));
      room.setCards(cards, families);
      const warnings = [];
      if (cards.length !== 42) warnings.push(`${cards.length} cartes chargées (42 attendues pour 7 familles de 6)`);
      families.filter(f => f.size !== DEFAULT_FAMILY_SIZE).forEach(f => warnings.push(`Famille « ${f.name} » : ${f.size} carte(s) au lieu de ${DEFAULT_FAMILY_SIZE}`));
      res.json({ success: true, count: cards.length, skipped, families, warnings });
    } catch (e) {
      console.error(e);
      fail(500, 'Erreur lors du traitement du zip : ' + e.message);
    }
  });
});

// QR code en SVG (généré par le serveur : fonctionne aussi sans connexion internet)
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 500);
  if (!text) return res.status(400).end();
  try {
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#3a1a00', light: '#ffffff' } });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch { res.status(500).end(); }
});

// pages : /K7QF/joueur2.html , /K7QF/rejoindre , /K7QF
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur(\d{1,2})(?:\.html)?\/?$/i, (req, res, next) =>
  validCode(cleanCode(req.params[0])) ? page('joueur.html')(req, res) : next());
app.get(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/i, (req, res, next) =>
  validCode(cleanCode(req.params[0])) ? page('accueil.html')(req, res) : next());
app.get(/^\/([A-Za-z0-9]{3,10})\/?$/, (req, res, next) =>
  validCode(cleanCode(req.params[0])) ? page('maitre.html')(req, res) : next());

app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('Page introuvable'));

server.listen(PORT, () => {
  console.log('\n  7 Familles — serveur lancé !');
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
