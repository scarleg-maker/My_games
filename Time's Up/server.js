const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── État global du jeu ──────────────────────────────────────────────────────
let state = {
  phase: 'setup',          // setup | collecting | playing | finished
  mode: 'single',          // single | multi
  config: {
    proposalsPerPlayer: 3,
    numPlayers: 4,
    timePerRound: 60,
  },
  teams: [],               // [{ name, players: [string] }]
  players: [],             // ordre global des joueurs
  proposals: [],           // toutes les propositions (pool)
  proposalsLeft: [],       // propositions restantes dans la manche
  found: [],               // trouvées dans la manche en cours
  allFound: [],            // trouvées toutes manches confondues
  currentTeamIdx: 0,
  teamTurnCounters: [],    // nb de tours joués par équipe (pour rotation joueur)
  roundIdx: 0,             // 0=Phrase, 1=1 mot, 2=Mimes
  rounds: ['Phrase', '1 mot', 'Mimes'],
  scores: [],              // scores par équipe [ [r1,r2,r3], ... ]
  timeLeft: 60,
  timerRunning: false,
  currentProposal: null,
  roundPoints: 0,
  playerValidations: {},   // { playerName: true/false } pour mode multi
  collectingIdx: 0,        // index joueur en cours de saisie (mode single)
  startingTeamIdx: 0,
  timeBonus: 0,            // temps restant reporté sur manche suivante
};

function resetState() {
  state = {
    phase: 'setup', mode: 'single',
    config: { proposalsPerPlayer: 3, numPlayers: 4, timePerRound: 60 },
    teams: [], players: [], proposals: [], proposalsLeft: [], found: [],
    allFound: [], currentTeamIdx: 0, teamTurnCounters: [],
    roundIdx: 0, rounds: ['Phrase', '1 mot', 'Mimes'],
    scores: [], timeLeft: 60, timerRunning: false,
    currentProposal: null, roundPoints: 0,
    playerValidations: {}, collectingIdx: 0,
    startingTeamIdx: 0, timeBonus: 0,
  };
}

let timerInterval = null;

// ── Utilitaires ─────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentTeam() { return state.teams[state.currentTeamIdx]; }

function currentPlayer() {
  const team = currentTeam();
  if (!team || team.players.length === 0) return '';
  const turns = state.teamTurnCounters[state.currentTeamIdx] || 0;
  return team.players[turns % team.players.length];
}

function nextTeam() {
  state.teamTurnCounters[state.currentTeamIdx]++;
  state.currentTeamIdx = (state.currentTeamIdx + 1) % state.teams.length;
}

function pickProposal() {
  if (state.proposalsLeft.length === 0) return null;
  const idx = Math.floor(Math.random() * state.proposalsLeft.length);
  state.currentProposal = state.proposalsLeft[idx];
  return state.currentProposal;
}

function broadcastState() {
  io.emit('state', buildClientState());
}

function buildClientState() {
  return {
    phase: state.phase,
    mode: state.mode,
    config: state.config,
    teams: state.teams,
    players: state.players,
    currentTeamIdx: state.currentTeamIdx,
    currentTeamName: currentTeam()?.name || '',
    currentPlayer: currentPlayer(),
    roundIdx: state.roundIdx,
    rounds: state.rounds,
    scores: state.scores,
    timeLeft: state.timeLeft,
    timerRunning: state.timerRunning,
    currentProposal: state.currentProposal,
    roundPoints: state.roundPoints,
    proposalsLeftCount: state.proposalsLeft.length,
    totalProposals: state.proposals.length,
    foundCount: state.found.length,
    allFoundCount: state.allFound.length,
    playerValidations: state.playerValidations,
    collectingIdx: state.collectingIdx,
    startingTeamIdx: state.startingTeamIdx,
    timeBonus: state.timeBonus,
  };
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  state.timerRunning = false;
}

function startTimer(onEnd) {
  stopTimer();
  state.timerRunning = true;
  timerInterval = setInterval(() => {
    state.timeLeft--;
    broadcastState();
    if (state.timeLeft <= 0) {
      stopTimer();
      onEnd();
    }
  }, 1000);
}

function startRoundTimer() {
  startTimer(() => {
    // Temps ecoulé
    state.phase = 'roundEnd';
    broadcastState();
  });
}

function beginRound(timeOverride) {
  state.phase = 'countdown';
  state.timeLeft = timeOverride !== undefined ? timeOverride : state.config.timePerRound;
  state.roundPoints = 0;
  state.found = [];
  broadcastState();
}

function initScores() {
  state.scores = state.teams.map(() => [0, 0, 0]);
  state.teamTurnCounters = state.teams.map(() => 0);
}

function resetProposals() {
  state.proposalsLeft = shuffle([...state.proposals]);
  state.found = [];
  state.allFound = [];
}

// ── Routes ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'master.html')));
app.get('/joueur/:name', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));

// ── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('state', buildClientState());

  // ── SETUP ────────────────────────────────────────────────────────────────
  socket.on('startSetup', (data) => {
    // data: { mode, config, teams }
    resetState();
    state.mode = data.mode;
    state.config = data.config;
    state.teams = data.teams;
    state.players = data.teams.flatMap(t => t.players);
    state.startingTeamIdx = Math.floor(Math.random() * data.teams.length);
    state.currentTeamIdx = state.startingTeamIdx;
    initScores();
    state.playerValidations = {};
    state.players.forEach(p => state.playerValidations[p] = false);

    if (data.mode === 'single') {
      state.phase = 'collecting_single';
      state.collectingIdx = 0;
    } else {
      state.phase = 'collecting_multi';
    }
    broadcastState();
  });

  // ── COLLECTE SINGLE ──────────────────────────────────────────────────────
  socket.on('submitProposalsSingle', (data) => {
    // data: { playerName, proposals: [string] }
    data.proposals.forEach(p => state.proposals.push(p.trim()));
    state.playerValidations[data.playerName] = true;
    state.collectingIdx++;
    if (state.collectingIdx >= state.players.length) {
      state.phase = 'ready';
      state.proposals = shuffle(state.proposals);
    }
    broadcastState();
  });

  // ── COLLECTE MULTI ───────────────────────────────────────────────────────
  socket.on('submitProposalsMulti', (data) => {
    // data: { playerName, proposals: [string] }
    data.proposals.forEach(p => state.proposals.push(p.trim()));
    state.playerValidations[data.playerName] = true;
    const allDone = state.players.every(p => state.playerValidations[p]);
    if (allDone) {
      state.phase = 'ready';
      state.proposals = shuffle(state.proposals);
    }
    broadcastState();
  });

  // ── LANCEMENT PARTIE ─────────────────────────────────────────────────────
  socket.on('startGame', () => {
    resetProposals();
    state.roundIdx = 0;
    state.phase = 'countdown';
    state.timeLeft = state.config.timePerRound;
    state.roundPoints = 0;
    broadcastState();
  });

  // ── COUNTDOWN TERMINÉ → DÉMARRER VRAI TIMER ─────────────────────────────
  socket.on('countdownDone', () => {
    state.phase = 'playing';
    pickProposal();
    broadcastState();
    startRoundTimer();
  });

  // ── TROUVÉE ──────────────────────────────────────────────────────────────
  socket.on('found', () => {
    if (state.phase !== 'playing') return;
    state.found.push(state.currentProposal);
    state.allFound.push(state.currentProposal);
    state.proposalsLeft = state.proposalsLeft.filter(p => p !== state.currentProposal);
    state.scores[state.currentTeamIdx][state.roundIdx]++;
    state.roundPoints++;
    if (state.proposalsLeft.length === 0) {
      // Plus de propositions → fin de manche / passage manche suivante
      stopTimer();
      state.phase = 'roundEnd_noMore';
      broadcastState();
      return;
    }
    pickProposal();
    broadcastState();
  });

  // ── PASSE ────────────────────────────────────────────────────────────────
  socket.on('pass', () => {
    if (state.phase !== 'playing') return;
    state.timeLeft = Math.max(0, state.timeLeft - 3);
    if (state.timeLeft === 0) {
      stopTimer();
      state.phase = 'roundEnd';
      broadcastState();
      return;
    }
    // Choisir une autre proposition sans exclure
    const others = state.proposalsLeft.filter(p => p !== state.currentProposal);
    if (others.length > 0) {
      state.currentProposal = others[Math.floor(Math.random() * others.length)];
    }
    broadcastState();
  });

  // ── FIN DE TOUR (temps écoulé) → équipe suivante ─────────────────────────
  socket.on('nextTeam', () => {
    nextTeam();
    state.phase = 'countdown';
    state.timeLeft = state.config.timePerRound;
    state.roundPoints = 0;
    state.found = [];
    broadcastState();
  });

  // ── PLUS DE PROPOSITIONS → manche suivante (même équipe, temps restant) ──
  socket.on('nextRound', (data) => {
    // data: { timeLeft }
    state.roundIdx++;
    if (state.roundIdx >= state.rounds.length) {
      state.phase = 'finished';
      broadcastState();
      return;
    }
    state.proposalsLeft = shuffle([...state.proposals]);
    state.found = [];
    state.phase = 'countdown';
    state.timeLeft = data.timeLeft > 0 ? data.timeLeft : state.config.timePerRound;
    state.roundPoints = 0;
    broadcastState();
  });

  // ── RESET ────────────────────────────────────────────────────────────────
  socket.on('reset', () => {
    stopTimer();
    resetState();
    broadcastState();
  });
});

server.listen(6300, () => console.log("Time's Up sur http://localhost:6300"));
