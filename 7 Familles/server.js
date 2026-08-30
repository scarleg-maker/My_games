const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 1500;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const CARDS_DIR = path.join(UPLOAD_DIR, 'cards');
const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');

[UPLOAD_DIR, CARDS_DIR, TMP_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/cards', express.static(CARDS_DIR));

const upload = multer({ dest: TMP_DIR });

// ---------------------------------------------------------------------------
// Etat du jeu (en mémoire, un seul salon de jeu géré par ce serveur)
// ---------------------------------------------------------------------------
let game = {
  cards: [],              // {id, family, number, name, file}
  families: [],           // {name, color}
  players: [],            // {id, name, hand:[], ready, families:[]}
  pioche: [],
  completedFamilies: [],  // {family, ownerId, ownerName}
  started: false,
  currentPlayerId: null,
  requestContext: null,   // {fromId, toId}
  allReady: false,
};

const FAMILY_COLORS = [
  '#29B6F6', // Bleu clair
  '#E53935', // Rouge
  '#FDD835', // Jaune
  '#FB8C00', // Orange
  '#43A047', // Vert
  '#6A1B9A', // Violet foncé
  '#EC407A', // Rose
  '#8D6E63', '#00897B', '#5C6BC0', '#C0CA33', '#455A64',
];

// Parse "Pirate 01 - Monkey D. Luffy.png" -> {family, number, name, ext}
function parseFilename(filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const m = base.match(/^(.+?)\s+(\d+)\s*-\s*(.+)$/);
  if (!m) return null;
  return { family: m[1].trim(), number: m[2].trim(), name: m[3].trim(), ext };
}

app.post('/api/upload-zip', upload.single('zipfile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const zip = new AdmZip(req.file.path);
    const entries = zip.getEntries().filter(
      e => !e.isDirectory && /\.(png|jpe?g|webp|gif)$/i.test(e.entryName)
    );

    // Nettoyage du dossier des cartes précédentes
    fs.readdirSync(CARDS_DIR).forEach(f => fs.unlinkSync(path.join(CARDS_DIR, f)));

    const cards = [];
    const familyMap = new Map();
    let skipped = 0;

    entries.forEach((entry, idx) => {
      const original = path.basename(entry.entryName);
      const parsed = parseFilename(original);
      if (!parsed) { skipped++; return; }
      const safeName = `card_${idx}${parsed.ext}`;
      fs.writeFileSync(path.join(CARDS_DIR, safeName), entry.getData());

      if (!familyMap.has(parsed.family)) {
        familyMap.set(parsed.family, FAMILY_COLORS[familyMap.size % FAMILY_COLORS.length]);
      }
      cards.push({
        id: `c${idx}`,
        family: parsed.family,
        number: parsed.number,
        name: parsed.name,
        file: `/cards/${safeName}`,
      });
    });

    fs.unlinkSync(req.file.path);

    game.cards = cards;
    game.families = Array.from(familyMap.entries()).map(([name, color]) => ({ name, color }));

    io.emit('cards-loaded', { cards: game.cards, families: game.families });
    res.json({ success: true, count: cards.length, skipped, families: game.families });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors du traitement du zip : ' + err.message });
  }
});

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nameOf(id) {
  const p = game.players.find(pl => pl.id === id);
  return p ? p.name : id;
}

function orderedPlayerIds() {
  return game.players.map(p => p.id).sort((a, b) => Number(a) - Number(b));
}

function advanceTurn() {
  const order = orderedPlayerIds();
  const curIdx = order.indexOf(game.currentPlayerId);
  const nextIdx = (curIdx + 1) % order.length;
  game.currentPlayerId = order[nextIdx];
  game.requestContext = null;
  io.emit('request-context-update', null);
  io.emit('turn-changed', { currentPlayerId: game.currentPlayerId, order });
}

function broadcastMasterState() {
  io.to('master').emit('master-state', {
    players: game.players.map(p => ({
      id: p.id, name: p.name, handCount: p.hand.length,
      families: p.families, ready: p.ready,
    })),
    piocheCount: game.pioche.length,
    currentPlayerId: game.currentPlayerId,
    completedFamilies: game.completedFamilies,
  });
}

io.on('connection', (socket) => {
  socket.emit('init-state', {
    started: game.started,
    families: game.families,
    playersCount: game.players.length,
  });

  socket.on('master-join', () => {
    socket.isMaster = true;
    socket.join('master');
    socket.emit('cards-loaded', { cards: game.cards, families: game.families });
    if (game.players.length) {
      socket.emit('players-set', { players: game.players.map(p => ({ id: p.id, name: p.name })) });
    }
    broadcastMasterState();
  });

  socket.on('set-players', ({ count, names }) => {
    if (game.started) return;
    count = Math.max(2, Math.min(10, count));
    const players = [];
    for (let i = 0; i < count; i++) {
      const num = String(i + 1);
      players.push({
        id: num,
        name: (names[i] && names[i].trim()) || `Joueur ${num}`,
        hand: [],
        ready: false,
        handRevealed: false,
        families: [],
      });
    }
    game.players = players;
    io.emit('players-set', { players: players.map(p => ({ id: p.id, name: p.name })) });
  });

  socket.on('start-game', () => {
    if (game.players.length < 2 || game.cards.length === 0) {
      socket.emit('error-msg', 'Il faut au moins 2 joueurs et des cartes chargées avant de lancer la partie.');
      return;
    }
    const CARDS_PER_PLAYER = 6;
    if (game.players.length * CARDS_PER_PLAYER > game.cards.length) {
      socket.emit('error-msg',
        `Pas assez de cartes pour distribuer ${CARDS_PER_PLAYER} cartes à chaque joueur ` +
        `(${game.players.length} joueurs x ${CARDS_PER_PLAYER} = ${game.players.length * CARDS_PER_PLAYER} > ${game.cards.length} cartes).`);
      return;
    }
    const shuffled = shuffle(game.cards);
    const perPlayer = CARDS_PER_PLAYER;
    let cursor = 0;
    game.players.forEach(p => {
      p.hand = shuffled.slice(cursor, cursor + perPlayer);
      cursor += perPlayer;
      p.ready = false;
      p.handRevealed = false;
      p.families = [];
    });
    game.pioche = shuffled.slice(cursor);
    game.completedFamilies = [];
    game.started = true;
    game.currentPlayerId = null;
    game.requestContext = null;
    game.allReady = false;

    io.emit('game-started', {
      players: game.players.map(p => ({ id: p.id, name: p.name })),
      piocheCount: game.pioche.length,
    });
    broadcastMasterState();
  });

  socket.on('player-join', ({ playerId }) => {
    socket.playerId = playerId;
    socket.join('player-' + playerId);
    const p = game.players.find(pl => pl.id === playerId);
    socket.emit('your-info', {
      id: playerId,
      name: p ? p.name : null,
      started: game.started,
      exists: !!p,
      players: game.players.map(pl => ({ id: pl.id, name: pl.name })),
      families: game.families,
      currentPlayerId: game.currentPlayerId,
      piocheCount: game.pioche.length,
      completedFamilies: game.completedFamilies,
      requestContext: game.requestContext,
      ready: p ? p.ready : false,
      handRevealed: p ? p.handRevealed : false,
      hand: (p && p.handRevealed) ? p.hand : [],
    });
  });

  socket.on('request-hand', () => {
    const p = game.players.find(pl => pl.id === socket.playerId);
    if (!p) return;
    p.handRevealed = true;
    socket.emit('your-hand', { hand: p.hand, families: game.families });
    broadcastMasterState();
  });

  socket.on('player-ready', () => {
    const p = game.players.find(pl => pl.id === socket.playerId);
    if (!p) return;
    p.ready = true;
    broadcastMasterState();
    io.emit('players-status', game.players.map(pl => ({ id: pl.id, name: pl.name, ready: pl.ready })));

    if (game.players.every(pl => pl.ready) && !game.allReady) {
      game.allReady = true;
      const starter = game.players[Math.floor(Math.random() * game.players.length)];
      game.currentPlayerId = starter.id;
      game.requestContext = null;
      io.emit('turn-changed', { currentPlayerId: game.currentPlayerId, order: orderedPlayerIds() });
    }
  });

  socket.on('select-opponent', ({ opponentId }) => {
    if (socket.playerId !== game.currentPlayerId) return;
    if (opponentId === socket.playerId) return;
    const target = game.players.find(p => p.id === opponentId);
    if (!target) return;
    game.requestContext = { fromId: socket.playerId, toId: opponentId };
    io.to('player-' + opponentId).emit('you-are-requested', {
      fromId: socket.playerId, fromName: nameOf(socket.playerId),
    });
    io.emit('request-context-update', game.requestContext);
  });

  socket.on('give-card', ({ cardId }) => {
    if (!game.requestContext || game.requestContext.toId !== socket.playerId) return;
    const target = game.players.find(p => p.id === socket.playerId);
    const requester = game.players.find(p => p.id === game.requestContext.fromId);
    if (!target || !requester) return;
    const idx = target.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [card] = target.hand.splice(idx, 1);
    requester.hand.push(card);

    io.to('player-' + target.id).emit('your-hand', { hand: target.hand, families: game.families });
    io.to('player-' + requester.id).emit('your-hand', { hand: requester.hand, families: game.families });
    io.to('player-' + requester.id).emit('card-received', { card, fromName: target.name });

    game.requestContext = null;
    io.emit('request-context-update', null);
    io.emit('turn-changed', { currentPlayerId: game.currentPlayerId, order: orderedPlayerIds() });
    broadcastMasterState();
  });

  socket.on('draw-pioche', () => {
    if (socket.playerId !== game.currentPlayerId) return;
    if (game.pioche.length === 0) {
      socket.emit('pioche-empty');
      return;
    }
    const idx = Math.floor(Math.random() * game.pioche.length);
    const [card] = game.pioche.splice(idx, 1);
    const p = game.players.find(pl => pl.id === socket.playerId);
    p.hand.push(card);
    socket.emit('your-hand', { hand: p.hand, families: game.families });
    socket.emit('card-drawn', { card, piocheCount: game.pioche.length });
    io.emit('pioche-count', { count: game.pioche.length });
    game.requestContext = null;
    io.emit('request-context-update', null);
    broadcastMasterState();
  });

  socket.on('draw-result', ({ correct }) => {
    if (socket.playerId !== game.currentPlayerId) return;
    if (!correct) {
      advanceTurn();
    } else {
      io.emit('turn-changed', { currentPlayerId: game.currentPlayerId, order: orderedPlayerIds() });
    }
  });

  socket.on('claim-family', ({ family }) => {
    const p = game.players.find(pl => pl.id === socket.playerId);
    if (!p) return;
    const cardsOfFamily = p.hand.filter(c => c.family === family);
    if (cardsOfFamily.length < 6) return;
    const toRemove = cardsOfFamily.slice(0, 6).map(c => c.id);
    p.hand = p.hand.filter(c => !toRemove.includes(c.id));
    p.families.push(family);
    game.completedFamilies.push({ family, ownerId: p.id, ownerName: p.name });

    socket.emit('your-hand', { hand: p.hand, families: game.families });
    io.emit('family-completed', {
      family, ownerName: p.name,
      completed: game.completedFamilies,
    });
    broadcastMasterState();

    if (game.completedFamilies.length >= game.families.length) {
      const winner = [...game.players].sort((a, b) => b.families.length - a.families.length)[0];
      io.emit('game-over', {
        completed: game.completedFamilies,
        standings: game.players
          .map(pl => ({ id: pl.id, name: pl.name, count: pl.families.length }))
          .sort((a, b) => b.count - a.count),
        winner: winner.name,
      });
    }
  });

  socket.on('disconnect', () => {});
});

app.get(/^\/joueur(\d+)\.html$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

server.listen(PORT, () => {
  console.log(`Serveur "7 Familles" lancé : http://localhost:${PORT}  (page maître)`);
});
