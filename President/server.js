const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { randomUUID } = require('crypto');

const { GameManager } = require('./gameEngine');

const PORT = 4000;
const PLAYERS_FILE = path.join(__dirname, 'data', 'players.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024 } });

const gameManager = new GameManager();

// ---------- persisted player names ----------
function loadSavedPlayers() {
  try {
    const raw = fs.readFileSync(PLAYERS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.players) ? data.players : [];
  } catch (e) {
    return [];
  }
}

function savePlayers(list) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify({ players: list }, null, 2));
}

// ---------- page routes ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

app.get('/joueur:num', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

// ---------- API: saved players ----------
app.get('/api/saved-players', (req, res) => {
  res.json({ players: loadSavedPlayers() });
});

// ---------- API: image streaming (mode B) ----------
app.get('/api/image/:cardId', (req, res) => {
  if (!gameManager.config || gameManager.config.mode !== 'B') return res.status(404).end();
  const card = gameManager.config.images.find((c) => c.id === req.params.cardId);
  if (!card) return res.status(404).end();
  res.sendFile(card.filepath);
});

// ---------- API: start game ----------
app.post('/api/start-game', upload.single('photos'), (req, res) => {
  try {
    const mode = req.body.mode;
    const players = JSON.parse(req.body.players || '[]').map((p) => String(p).trim()).filter(Boolean);
    const theme = String(req.body.theme || '').trim();
    const totalRounds = parseInt(req.body.totalRounds, 10);
    const pointsToWin = parseInt(req.body.pointsToWin, 10);
    const handSizeRaw = req.body.handSize;
    const handSize = handSizeRaw === 'all' ? 'all' : parseInt(handSizeRaw, 10);

    if (!['A', 'B'].includes(mode)) return res.status(400).json({ error: 'Mode invalide.' });
    if (players.length < 2 || players.length > 6)
      return res.status(400).json({ error: 'Il faut entre 2 et 6 joueurs.' });
    if (new Set(players).size !== players.length)
      return res.status(400).json({ error: 'Les noms des joueurs doivent être uniques.' });
    if (mode === 'A' && players.length < 4)
      return res.status(400).json({ error: 'Le mode "Cartes standardes" nécessite au moins 4 joueurs.' });
    if (!Number.isInteger(totalRounds) || totalRounds < 3 || totalRounds > 20)
      return res.status(400).json({ error: 'Le nombre de tours doit être entre 3 et 20.' });
    if (!Number.isInteger(pointsToWin) || pointsToWin < 50 || pointsToWin > 100 || pointsToWin % 10 !== 0)
      return res.status(400).json({ error: 'Le nombre de points doit être entre 50 et 100, par palier de 10.' });
    if (handSize !== 'all' && (!Number.isInteger(handSize) || handSize < 6 || handSize > 20))
      return res.status(400).json({ error: 'Le nombre de cartes par joueur doit être "Toutes" ou entre 6 et 20.' });
    const effectiveHandSize = mode === 'A' ? 'all' : handSize; // verrouillé sur "Toutes" en mode A

    let images = [];
    if (mode === 'B') {
      if (!req.file) return res.status(400).json({ error: 'Merci de sélectionner une archive ZIP de photos.' });
      const gameId = randomUUID();
      const gameUploadDir = path.join(UPLOADS_DIR, gameId);
      fs.mkdirSync(gameUploadDir, { recursive: true });

      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries().filter((e) => !e.isDirectory);
      const imageExt = /\.(jpe?g|png|gif|webp)$/i;
      // Le niveau doit être écrit sur deux chiffres, zéro devant obligatoire (01 à 20).
      const nameLevelRegex = /^(.+?)\s*\((\d{2})\)\.[a-zA-Z0-9]+$/;

      for (const entry of entries) {
        const baseName = path.basename(entry.entryName);
        if (!imageExt.test(baseName)) continue;
        const match = baseName.match(nameLevelRegex);
        if (!match) continue;
        const name = match[1].trim();
        const level = parseInt(match[2], 10);
        if (!name || level < 1 || level > 20) continue;

        const ext = path.extname(baseName);
        const filepath = path.join(gameUploadDir, `${randomUUID()}${ext}`);
        fs.writeFileSync(filepath, entry.getData());
        images.push({ id: randomUUID(), name, level, filepath });
      }

      if (images.length < 42) {
        return res.status(400).json({
          error: `L'archive doit contenir au moins 42 images valides nommées "Nom (niveau).ext", niveau sur deux chiffres de 01 à 20 (${images.length} trouvée(s)).`
        });
      }

      if (effectiveHandSize !== 'all') {
        const maxPerPlayer = Math.floor(images.length / players.length);
        if (effectiveHandSize > maxPerPlayer) {
          return res.status(400).json({
            error: `Avec ${images.length} images importées et ${players.length} joueurs, vous pouvez distribuer au maximum ${maxPerPlayer} cartes par joueur.`
          });
        }
      }
    }

    savePlayers(players);

    gameManager.configure({ mode, players, theme, totalRounds, pointsToWin, handSize: effectiveHandSize, images });
    io.emit('state-updated');
    res.json({ ok: true, playerUrls: players.map((p, i) => `/joueur${i + 1}`) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
});

// ---------- API: game state ----------
app.get('/api/state', (req, res) => {
  if (!gameManager.isConfigured()) return res.json({ configured: false });
  const state = gameManager.getPublicState();
  state.masterExtra = gameManager.getMasterTableExtra();
  res.json(state);
});

app.get('/api/state/:playerIndex', (req, res) => {
  if (!gameManager.isConfigured()) return res.json({ configured: false });
  const idx = parseInt(req.params.playerIndex, 10) - 1;
  const name = gameManager.config.players[idx];
  if (!name) return res.status(404).json({ error: 'Joueur inconnu.' });
  res.json({ ...gameManager.getPlayerState(name), yourName: name, yourIndex: idx + 1 });
});

// ---------- API: round control (master) ----------
app.post('/api/start-round', (req, res) => {
  try {
    if (!gameManager.isConfigured()) return res.status(400).json({ error: 'Aucune partie configurée.' });
    const state = gameManager.startRound();
    io.emit('state-updated');
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/new-game', (req, res) => {
  gameManager.reset();
  io.emit('state-updated');
  res.json({ ok: true });
});

// ---------- API: player actions ----------
function resolvePlayerName(playerIndex) {
  const idx = parseInt(playerIndex, 10) - 1;
  const name = gameManager.config && gameManager.config.players[idx];
  if (!name) throw new Error('Joueur inconnu.');
  return name;
}

app.post('/api/action/play', (req, res) => {
  try {
    const name = resolvePlayerName(req.body.playerIndex);
    const state = gameManager.playCard(name, req.body.cardId);
    io.emit('state-updated');
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/action/pass', (req, res) => {
  try {
    const name = resolvePlayerName(req.body.playerIndex);
    const state = gameManager.pass(name);
    io.emit('state-updated');
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/action/end-trick', (req, res) => {
  try {
    const name = resolvePlayerName(req.body.playerIndex);
    const state = gameManager.endTrick(name);
    io.emit('state-updated');
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

io.on('connection', () => {});

server.listen(PORT, () => {
  console.log(`Serveur lancé : http://localhost:${PORT}`);
});
