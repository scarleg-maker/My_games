const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { Server } = require('socket.io');

const PORT = 3500;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CURRENT_DIR = path.join(UPLOADS_DIR, 'current');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

// --- Préparation des dossiers / fichiers ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CURRENT_DIR)) fs.mkdirSync(CURRENT_DIR, { recursive: true });
if (!fs.existsSync(PLAYERS_FILE)) fs.writeFileSync(PLAYERS_FILE, JSON.stringify({ names: [] }, null, 2));

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// --- Upload zip (multer en mémoire) ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function stripExt(filename) {
  return filename.replace(/\.[^/.]+$/, '');
}

function clearDir(dir) {
  for (const f of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
}

// --- Etat du jeu (une seule partie active à la fois) ---
function freshState() {
  return {
    phase: 'setup', // setup | playing | elimination | finished
    mode: null,     // 'A' | 'B' | 'C' | 'D'
    theme: '',
    numDraws: 5,
    numRounds: 5,   // nombre de manches à jouer (mode D uniquement)
    maxGifts: 2,    // nombre de dons possibles par joueur sur toute la partie (mode D uniquement)
    players: [],    // [{name, eliminated:false, team:[{file,url,name}], giftsUsed:0}]
    images: [],     // [{file, url}] - toutes les images disponibles pour cette partie
    pool: [],        // fichiers restants à tirer
    currentPlayerIndex: 0,
    winner: null,
    lastEvent: null, // {id, type, ...} pour déclencher les animations côté client
    candidates: null, // pour le mode B : {playerIndex, images:[...]}
    // --- Mode D (Défi) ---
    round: 0,             // numéro de la manche en cours (1..numRounds, mode D)
    roundPhase: 'ready',  // ready | deciding | trimming
    pendingDraws: {},     // {playerIndex: image} images tirées en attente de décision
    decisions: {},        // {playerIndex: {action, targetIndex}} décisions de la manche en cours
    decidedPlayers: [],   // playerIndex ayant déjà validé leur décision pour la manche en cours
    trimNeeded: []        // playerIndex devant supprimer des images en trop
  };
}

let state = freshState();
let eventCounter = 0;

function pushEvent(evt) {
  eventCounter += 1;
  state.lastEvent = { id: eventCounter, ...evt };
}

function broadcast() {
  io.emit('state', state);
}

function checkForWinner() {
  const remaining = state.players.filter(p => !p.eliminated);
  if (remaining.length === 1 && state.players.length > 1) {
    state.phase = 'finished';
    state.winner = remaining[0];
  } else if (remaining.length === 0) {
    // sécurité : ne devrait pas arriver
  }
}

function randomPick(arr, n) {
  const copy = [...arr];
  const picked = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}

// ---------- ROUTES API ----------

app.get('/api/players', (req, res) => {
  const data = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
  res.json(data);
});

app.post('/api/players', (req, res) => {
  const { names } = req.body;
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names doit être un tableau' });
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify({ names }, null, 2));
  res.json({ ok: true });
});

// Toile cible de redimensionnement des photos à l'upload : ratio 3:4 (portrait), identique au
// ratio utilisé par toutes les vignettes/affichages côté client (90x120, 150x200, 375x500, 240x320…).
// En calant chaque image sur ce même ratio dès l'upload (avec un fond neutre pour combler
// l'espace éventuel), on évite qu'une image "carrée" ou "large" paraisse plus petite que les autres.
const CANVAS_W = 500;
const CANVAS_H = 667;
const JPEG_QUALITY = 85;
const PAD_COLOR = { r: 238, g: 238, b: 238, alpha: 1 }; // #eeeeee, identique au fond CSS des cases

app.post('/api/upload-zip', upload.single('zipfile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    clearDir(CURRENT_DIR);
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const images = [];
    let skipped = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const base = path.basename(entry.entryName);
      const ext = path.extname(base).toLowerCase();
      if (!IMAGE_EXT.includes(ext)) continue;

      // ré-encodage + mise à un format 3:4 constant : PNG (transparence préservée, complété par du
      // transparent) si l'image a un canal alpha, JPEG (complété par un gris neutre) sinon
      let outputBuffer;
      let outExt;
      try {
        const img = sharp(entry.getData()).rotate(); // corrige l'orientation EXIF
        const meta = await img.metadata();
        const hasAlpha = !!meta.hasAlpha;
        const resized = img.resize({
          width: CANVAS_W,
          height: CANVAS_H,
          fit: 'contain',
          withoutEnlargement: true,
          background: hasAlpha ? { r: 0, g: 0, b: 0, alpha: 0 } : PAD_COLOR
        });
        if (hasAlpha) {
          outExt = '.png';
          outputBuffer = await resized.png({ compressionLevel: 9 }).toBuffer();
        } else {
          outExt = '.jpg';
          outputBuffer = await resized.jpeg({ quality: JPEG_QUALITY }).toBuffer();
        }
      } catch (imgErr) {
        console.error(`Image ignorée (illisible) : ${base} — ${imgErr.message}`);
        skipped++;
        continue;
      }

      let finalName = `${stripExt(base)}${outExt}`;
      let counter = 1;
      while (fs.existsSync(path.join(CURRENT_DIR, finalName))) {
        finalName = `${stripExt(base)}_${counter}${outExt}`;
        counter++;
      }

      fs.writeFileSync(path.join(CURRENT_DIR, finalName), outputBuffer);
      images.push({ file: finalName, url: `/uploads/current/${encodeURIComponent(finalName)}`, name: stripExt(finalName) });
    }
    state.images = images;
    res.json({ ok: true, count: images.length, images, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la lecture du zip : ' + err.message });
  }
});

app.post('/api/start-game', (req, res) => {
  const { mode, players, theme, numDraws, numRounds, maxGifts } = req.body;
  if (!['A', 'B', 'C', 'D'].includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
  if (!Array.isArray(players) || players.length < 2) return res.status(400).json({ error: 'Il faut au moins 2 joueurs' });
  if (state.images.length === 0) return res.status(400).json({ error: 'Aucune image chargée' });
  const nd = parseInt(numDraws, 10);
  if (isNaN(nd) || nd < 3 || nd > 10) return res.status(400).json({ error: 'Nombre de tirages invalide (3 à 10)' });

  let nr = nd; // pour les modes A/B/C, le nombre de tours = nombre de tirages
  let mg = 2;
  if (mode === 'D') {
    nr = parseInt(numRounds, 10);
    if (isNaN(nr) || nr < 1 || nr > 30) return res.status(400).json({ error: 'Nombre de tours invalide (1 à 30)' });
    mg = parseInt(maxGifts, 10);
    if (isNaN(mg) || mg < 1 || mg > 5) return res.status(400).json({ error: 'Nombre de dons possible invalide (1 à 5)' });
  }

  // persister les noms
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify({ names: players }, null, 2));

  state = freshState();
  state.mode = mode;
  state.theme = theme || '';
  state.numDraws = nd;
  state.numRounds = nr;
  state.maxGifts = mg;
  // recharger la liste d'images (celles déjà uploadées restent sur disque)
  const files = fs.readdirSync(CURRENT_DIR).filter(f => IMAGE_EXT.includes(path.extname(f).toLowerCase()));
  state.images = files.map(f => ({ file: f, url: `/uploads/current/${encodeURIComponent(f)}`, name: stripExt(f) }));
  state.pool = state.images.map(i => i.file);
  state.players = players.map(name => ({ name, eliminated: false, team: [], giftsUsed: 0 }));
  state.phase = 'playing';
  state.currentPlayerIndex = 0;

  const playerUrls = players.map((name, i) => `/joueur${i + 1}`);
  broadcast();
  res.json({ ok: true, playerUrls });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

app.get(/^\/joueur(\d+)$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

// ---------- SOCKET.IO : logique de jeu temps réel ----------

io.on('connection', (socket) => {
  socket.emit('state', state);

  // Mode A & C : tirage direct d'une image dans le pool pour un joueur
  socket.on('draw-single', ({ playerIndex }) => {
    if (state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player || player.eliminated) return;
    if (state.pool.length === 0) return;
    const [fileName] = randomPick(state.pool, 1);
    state.pool = state.pool.filter(f => f !== fileName);
    const img = state.images.find(i => i.file === fileName);
    player.team.push(img);
    pushEvent({ type: 'draw', playerIndex, image: img });
    broadcast();
  });

  // Mode C : tirage simultané pour tous les joueurs actifs
  socket.on('draw-all', () => {
    if (state.phase !== 'playing') return;
    const active = state.players.map((p, idx) => ({ p, idx })).filter(x => !x.p.eliminated);
    const results = [];
    for (const { p, idx } of active) {
      if (state.pool.length === 0) break;
      const [fileName] = randomPick(state.pool, 1);
      state.pool = state.pool.filter(f => f !== fileName);
      const img = state.images.find(i => i.file === fileName);
      p.team.push(img);
      results.push({ playerIndex: idx, image: img });
    }
    pushEvent({ type: 'draw-all', results });
    broadcast();
  });

  // Mode B : proposer 5 candidats (sans les retirer du pool)
  socket.on('draw-candidates', ({ playerIndex }) => {
    if (state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player || player.eliminated) return;
    const files = randomPick(state.pool, Math.min(5, state.pool.length));
    const imgs = files.map(f => state.images.find(i => i.file === f));
    state.candidates = { playerIndex, images: imgs };
    pushEvent({ type: 'candidates', playerIndex, images: imgs });
    broadcast();
  });

  // Mode B : confirmer le choix parmi les candidats
  socket.on('choice-confirm', ({ playerIndex, file }) => {
    if (state.phase !== 'playing') return;
    if (!state.candidates || state.candidates.playerIndex !== playerIndex) return;
    const player = state.players[playerIndex];
    const img = state.candidates.images.find(i => i.file === file);
    if (!player || !img) return;
    state.pool = state.pool.filter(f => f !== file);
    player.team.push(img);
    state.candidates = null;
    pushEvent({ type: 'choice-result', playerIndex, image: img });
    broadcast();
  });

  // Passer au joueur suivant (modes A & B)
  socket.on('next-player', () => {
    if (state.phase !== 'playing') return;
    let idx = state.currentPlayerIndex;
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const cand = (idx + i) % n;
      if (!state.players[cand].eliminated) {
        state.currentPlayerIndex = cand;
        break;
      }
    }
    state.candidates = null;
    pushEvent({ type: 'next-player', playerIndex: state.currentPlayerIndex });
    broadcast();
  });

  // ---------- Mode D (Défi) ----------

  // Lancer une nouvelle manche : un tirage simultané par joueur actif, en attente de décision
  socket.on('draw-round-d', () => {
    if (state.phase !== 'playing' || state.mode !== 'D') return;
    if (state.roundPhase !== 'ready') return;
    if (state.round >= state.numRounds) return;

    const active = state.players.map((p, idx) => ({ p, idx })).filter(x => !x.p.eliminated);
    const pending = {};
    for (const { idx } of active) {
      if (state.pool.length === 0) break;
      const [fileName] = randomPick(state.pool, 1);
      state.pool = state.pool.filter(f => f !== fileName);
      pending[idx] = state.images.find(i => i.file === fileName);
    }
    state.pendingDraws = pending;
    state.decisions = {};
    state.decidedPlayers = [];
    state.roundPhase = 'deciding';
    state.round += 1;
    pushEvent({ type: 'draw-round-d', pending });
    broadcast();
  });

  // Un joueur décide de garder son image ou de la donner à un autre joueur (max 2 dons/partie)
  socket.on('decision', ({ playerIndex, action, targetIndex }) => {
    if (state.phase !== 'playing' || state.mode !== 'D' || state.roundPhase !== 'deciding') return;
    if (!(playerIndex in state.pendingDraws)) return;
    if (state.decisions[playerIndex]) return; // déjà décidé

    if (action === 'give') {
      if (targetIndex === playerIndex) return;
      const target = state.players[targetIndex];
      const giver = state.players[playerIndex];
      if (!target || target.eliminated || !giver) return;
      if (giver.giftsUsed >= state.maxGifts) return;
      giver.giftsUsed += 1;
      state.decisions[playerIndex] = { action: 'give', targetIndex };
    } else if (action === 'keep') {
      state.decisions[playerIndex] = { action: 'keep', targetIndex: null };
    } else {
      return;
    }
    state.decidedPlayers.push(Number(playerIndex));

    const pendingIndexes = Object.keys(state.pendingDraws).map(Number);
    const allDecided = pendingIndexes.every(idx => state.decisions[idx] !== undefined);

    if (allDecided) {
      pendingIndexes.forEach(idx => {
        const dec = state.decisions[idx];
        const img = state.pendingDraws[idx];
        const recipientIdx = dec.action === 'give' ? dec.targetIndex : idx;
        state.players[recipientIdx].team.push(img);
      });
      state.pendingDraws = {};
      state.decisions = {};
      state.decidedPlayers = [];
      state.trimNeeded = state.players
        .map((p, i) => i)
        .filter(i => state.players[i].team.length > state.numDraws);

      if (state.trimNeeded.length > 0) {
        state.roundPhase = 'trimming';
      } else {
        state.roundPhase = 'ready';
        if (state.round >= state.numRounds) state.phase = 'elimination';
      }
      pushEvent({ type: 'round-resolved-d' });
    } else {
      pushEvent({ type: 'decision-made-d', playerIndex });
    }
    broadcast();
  });

  // Un joueur en surplus d'images supprime une image de sa colonne
  socket.on('trim-image', ({ playerIndex, file }) => {
    if (state.roundPhase !== 'trimming') return;
    if (!state.trimNeeded.includes(playerIndex)) return;
    const player = state.players[playerIndex];
    if (!player) return;
    const idx = player.team.findIndex(i => i.file === file);
    if (idx === -1) return;
    player.team.splice(idx, 1);
    if (player.team.length <= state.numDraws) {
      state.trimNeeded = state.trimNeeded.filter(i => i !== playerIndex);
    }
    if (state.trimNeeded.length === 0) {
      state.roundPhase = 'ready';
      if (state.round >= state.numRounds) state.phase = 'elimination';
    }
    pushEvent({ type: 'trim-d', playerIndex });
    broadcast();
  });

  // Passage manuel à la phase d'élimination
  socket.on('go-to-elimination', () => {
    state.phase = 'elimination';
    pushEvent({ type: 'elimination-start' });
    broadcast();
  });

  // Eliminer un joueur (après validation côté client)
  socket.on('eliminate-player', ({ playerIndex }) => {
    if (state.phase !== 'elimination' && state.phase !== 'playing') return;
    const player = state.players[playerIndex];
    if (!player) return;
    player.eliminated = true;
    pushEvent({ type: 'eliminated', playerIndex });
    checkForWinner();
    broadcast();
  });

  // Réinitialiser la partie (retour à l'accueil, garde les joueurs enregistrés)
  socket.on('reset-game', () => {
    state = freshState();
    pushEvent({ type: 'reset' });
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`Serveur lancé : http://localhost:${PORT}`);
});
