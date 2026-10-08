const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Registre des salons ─────────────────────────────────────────────────────
const rooms = new Map();  // code → roomState
const ROOM_IDLE_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 50;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let i = 0; i < 1000; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return Date.now().toString(36).toUpperCase().slice(-4);
}

function validCode(c) { return /^[A-Z0-9]{3,10}$/.test(c); }
function cleanCode(c) { return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); }

function purgeIdle() {
  for (const [code, r] of rooms) {
    if (io.sockets.adapter.rooms.get(code)?.size === 0 &&
        Date.now() - r.lastActivity > ROOM_IDLE_MS) {
      clearInterval(r.timerInterval);
      rooms.delete(code);
    }
  }
}

// ── Création d'un salon ─────────────────────────────────────────────────────
function createRoom(code) {
  const state = {
    phase: 'setup',
    mode: 'single',
    config: { proposalsPerPlayer: 3, numPlayers: 4, timePerRound: 60 },
    teams: [], players: [], proposals: [], proposalsLeft: [], found: [],
    allFound: [], currentTeamIdx: 0, teamTurnCounters: [],
    roundIdx: 0, rounds: ['Phrase', '1 mot', 'Mimes'],
    scores: [], timeLeft: 60, timerRunning: false,
    currentProposal: null, roundPoints: 0,
    playerValidations: {}, collectingIdx: 0,
    startingTeamIdx: 0, timeBonus: 0,
  };

  const room = {
    code,
    state,
    timerInterval: null,
    lastActivity: Date.now(),
  };
  return room;
}

function getRoom(code) {
  if (rooms.has(code)) {
    rooms.get(code).lastActivity = Date.now();
    return rooms.get(code);
  }
  return null;
}

function getOrCreateRoom(code) {
  if (rooms.has(code)) {
    rooms.get(code).lastActivity = Date.now();
    return rooms.get(code);
  }
  if (rooms.size >= MAX_ROOMS) purgeIdle();
  const r = createRoom(code);
  rooms.set(code, r);
  return r;
}

// ── Utilitaires jeu ─────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentTeam(s) { return s.teams[s.currentTeamIdx]; }

function currentPlayer(s) {
  const team = currentTeam(s);
  if (!team || team.players.length === 0) return '';
  const turns = s.teamTurnCounters[s.currentTeamIdx] || 0;
  return team.players[turns % team.players.length];
}

function nextTeam(s) {
  s.teamTurnCounters[s.currentTeamIdx]++;
  s.currentTeamIdx = (s.currentTeamIdx + 1) % s.teams.length;
}

function pickProposal(s) {
  if (s.proposalsLeft.length === 0) return null;
  const idx = Math.floor(Math.random() * s.proposalsLeft.length);
  s.currentProposal = s.proposalsLeft[idx];
  return s.currentProposal;
}

function broadcastState(code) {
  const r = rooms.get(code);
  if (!r) return;
  io.to(code).emit('state', buildClientState(r));
}

function buildClientState(r) {
  const s = r.state;
  return {
    phase: s.phase, mode: s.mode, config: s.config,
    teams: s.teams, players: s.players,
    currentTeamIdx: s.currentTeamIdx,
    currentTeamName: currentTeam(s)?.name || '',
    currentPlayer: currentPlayer(s),
    roundIdx: s.roundIdx, rounds: s.rounds, scores: s.scores,
    timeLeft: s.timeLeft, timerRunning: s.timerRunning,
    currentProposal: s.currentProposal, roundPoints: s.roundPoints,
    proposalsLeftCount: s.proposalsLeft.length,
    totalProposals: s.proposals.length,
    foundCount: s.found.length,
    allFoundCount: s.allFound.length,
    playerValidations: s.playerValidations,
    collectingIdx: s.collectingIdx,
    startingTeamIdx: s.startingTeamIdx,
    timeBonus: s.timeBonus,
  };
}

function stopTimer(r) {
  if (r.timerInterval) { clearInterval(r.timerInterval); r.timerInterval = null; }
  r.state.timerRunning = false;
}

function startTimer(r, onEnd) {
  stopTimer(r);
  r.state.timerRunning = true;
  r.timerInterval = setInterval(() => {
    r.state.timeLeft--;
    broadcastState(r.code);
    if (r.state.timeLeft <= 0) {
      stopTimer(r);
      onEnd();
    }
  }, 1000);
}

function startRoundTimer(r) {
  startTimer(r, () => {
    r.state.phase = 'roundEnd';
    broadcastState(r.code);
  });
}

function initScores(s) {
  s.scores = s.teams.map(() => [0, 0, 0]);
  s.teamTurnCounters = s.teams.map(() => 0);
}

function resetProposals(s) {
  s.proposalsLeft = shuffle([...s.proposals]);
  s.found = [];
  s.allFound = [];
}

// ── Routes HTTP ─────────────────────────────────────────────────────────────
// Page d'accueil (liste/création des salons)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'accueil.html')));

// Créer un salon (POST /api/salons)
app.post('/api/salons', (req, res) => {
  const rawCode = req.body?.code;
  const code = rawCode ? cleanCode(rawCode) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
  if (rooms.has(code)) return res.json({ ok: false, error: `Le salon ${code} existe deja` });
  getOrCreateRoom(code);
  res.json({ ok: true, code });
});

// Info salon (GET /api/salons/:code)
app.get('/api/salons/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  const r = rooms.get(code);
  if (!r) return res.json({ exists: false });
  res.json({ exists: true, code, phase: r.state.phase,
    players: r.state.players.length, teams: r.state.teams.length });
});

// Page maitre du salon
app.get('/:code', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// Page joueur
app.get('/:code/joueur/:name', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  socket.on('joinRoom', (code) => {
    code = cleanCode(code);
    if (!validCode(code)) return;
    // Quitter les anciens salons
    for (const r of socket.rooms) {
      if (r !== socket.id) socket.leave(r);
    }
    const room = getOrCreateRoom(code);
    socket.join(code);
    socket.emit('state', buildClientState(room));
  });

  function getSocketRoom() {
    for (const r of socket.rooms) {
      if (r !== socket.id && rooms.has(r)) return rooms.get(r);
    }
    return null;
  }

  // ── SETUP ────────────────────────────────────────────────────────────────
  socket.on('startSetup', (data) => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    stopTimer(r);
    // Reset etat
    Object.assign(s, {
      phase: 'setup', mode: data.mode, config: data.config,
      teams: data.teams, players: data.teams.flatMap(t => t.players),
      proposals: [], proposalsLeft: [], found: [], allFound: [],
      currentTeamIdx: 0, teamTurnCounters: [], roundIdx: 0,
      rounds: ['Phrase', '1 mot', 'Mimes'], scores: [],
      timeLeft: data.config.timePerRound, timerRunning: false,
      currentProposal: null, roundPoints: 0, playerValidations: {},
      collectingIdx: 0, timeBonus: 0,
    });
    s.startingTeamIdx = Math.floor(Math.random() * data.teams.length);
    s.currentTeamIdx = s.startingTeamIdx;
    initScores(s);
    s.players.forEach(p => s.playerValidations[p] = false);

    if (data.mode === 'single') {
      s.phase = 'collecting_single';
      s.collectingIdx = 0;
    } else {
      s.phase = 'collecting_multi';
    }
    broadcastState(r.code);
  });

  // ── COLLECTE SINGLE ──────────────────────────────────────────────────────
  socket.on('submitProposalsSingle', (data) => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    data.proposals.forEach(p => s.proposals.push(p.trim()));
    s.playerValidations[data.playerName] = true;
    s.collectingIdx++;
    if (s.collectingIdx >= s.players.length) {
      s.phase = 'ready';
      s.proposals = shuffle(s.proposals);
    }
    broadcastState(r.code);
  });

  // ── COLLECTE MULTI ───────────────────────────────────────────────────────
  socket.on('submitProposalsMulti', (data) => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    data.proposals.forEach(p => s.proposals.push(p.trim()));
    s.playerValidations[data.playerName] = true;
    const allDone = s.players.every(p => s.playerValidations[p]);
    if (allDone) {
      s.phase = 'ready';
      s.proposals = shuffle(s.proposals);
    }
    broadcastState(r.code);
  });

  // ── LANCEMENT PARTIE ─────────────────────────────────────────────────────
  socket.on('startGame', () => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    resetProposals(s);
    s.roundIdx = 0;
    s.phase = 'countdown';
    s.timeLeft = s.config.timePerRound;
    s.roundPoints = 0;
    broadcastState(r.code);
  });

  // ── COUNTDOWN TERMINÉ ────────────────────────────────────────────────────
  socket.on('countdownDone', () => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    s.phase = 'playing';
    pickProposal(s);
    broadcastState(r.code);
    startRoundTimer(r);
  });

  // ── TROUVÉE ──────────────────────────────────────────────────────────────
  socket.on('found', () => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    if (s.phase !== 'playing') return;
    s.found.push(s.currentProposal);
    s.allFound.push(s.currentProposal);
    s.proposalsLeft = s.proposalsLeft.filter(p => p !== s.currentProposal);
    s.scores[s.currentTeamIdx][s.roundIdx]++;
    s.roundPoints++;
    if (s.proposalsLeft.length === 0) {
      stopTimer(r);
      s.phase = 'roundEnd_noMore';
      broadcastState(r.code);
      return;
    }
    pickProposal(s);
    broadcastState(r.code);
  });

  // ── PASSE ────────────────────────────────────────────────────────────────
  socket.on('pass', () => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    if (s.phase !== 'playing') return;
    s.timeLeft = Math.max(0, s.timeLeft - 3);
    if (s.timeLeft === 0) {
      stopTimer(r);
      s.phase = 'roundEnd';
      broadcastState(r.code);
      return;
    }
    const others = s.proposalsLeft.filter(p => p !== s.currentProposal);
    if (others.length > 0) {
      s.currentProposal = others[Math.floor(Math.random() * others.length)];
    }
    broadcastState(r.code);
  });

  // ── FIN TOUR → equipe suivante ────────────────────────────────────────────
  socket.on('nextTeam', () => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    nextTeam(s);
    s.phase = 'countdown';
    s.timeLeft = s.config.timePerRound;
    s.roundPoints = 0;
    s.found = [];
    broadcastState(r.code);
  });

  // ── PLUS DE PROPOSITIONS → manche suivante ────────────────────────────────
  socket.on('nextRound', (data) => {
    const r = getSocketRoom();
    if (!r) return;
    const s = r.state;
    s.roundIdx++;
    if (s.roundIdx >= s.rounds.length) {
      s.phase = 'finished';
      broadcastState(r.code);
      return;
    }
    s.proposalsLeft = shuffle([...s.proposals]);
    s.found = [];
    s.phase = 'countdown';
    s.timeLeft = data.timeLeft > 0 ? data.timeLeft : s.config.timePerRound;
    s.roundPoints = 0;
    broadcastState(r.code);
  });

  // ── RESET ────────────────────────────────────────────────────────────────
  socket.on('reset', () => {
    const r = getSocketRoom();
    if (!r) return;
    stopTimer(r);
    const s = r.state;
    Object.assign(s, {
      phase: 'setup', mode: 'single',
      config: { proposalsPerPlayer: 3, numPlayers: 4, timePerRound: 60 },
      teams: [], players: [], proposals: [], proposalsLeft: [], found: [],
      allFound: [], currentTeamIdx: 0, teamTurnCounters: [],
      roundIdx: 0, scores: [], timeLeft: 60, timerRunning: false,
      currentProposal: null, roundPoints: 0, playerValidations: {},
      collectingIdx: 0, startingTeamIdx: 0, timeBonus: 0,
    });
    broadcastState(r.code);
  });
});

// Nettoyage periodique
setInterval(purgeIdle, 30 * 60 * 1000);

const PORT = 6300;
server.listen(PORT, () => console.log(`Time's Up SLG sur http://localhost:${PORT}`));
