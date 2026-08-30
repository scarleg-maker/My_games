const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

const themeStore = require("./lib/themeStore");
const playerStats = require("./lib/playerStats");
const { generatePuzzle, validateArrangement } = require("./lib/puzzleEngine");
const { Tournament, MAX_SLOTS } = require("./lib/tournament");

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 9500;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "public", "images")));

// ---------- Routes des pages joueur (URL fixes joueur1.html ... joueurN.html) ----------
for (let n = 1; n <= MAX_SLOTS; n++) {
  app.get(`/joueur${n}.html`, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "joueur.html"));
  });
}

// =====================================================================
// API REST — thèmes & mode solo
// =====================================================================

app.get("/api/themes", (req, res) => {
  try {
    res.json(themeStore.listThemesSummary());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/leaderboard", (req, res) => {
  res.json(playerStats.getLeaderboard());
});

app.get("/api/history", (req, res) => {
  res.json(playerStats.getHistory(200));
});

// sessions solo en mémoire : sessionId -> {themeId, theme, solution, links, display, livesLeft, livesMax, player}
const soloSessions = new Map();

app.post("/api/solo/start", (req, res) => {
  try {
    const { themeId, player, lives } = req.body || {};
    const playerName = String(player || "").trim().slice(0, 24);
    if (!playerName) return res.status(400).json({ error: "Nom de joueur requis." });
    const livesMax = Math.max(1, parseInt(lives, 10) || 4);
    const theme = themeStore.getTheme(themeId);
    const { solution, links, display } = generatePuzzle(theme.dataset, theme.criteria, theme.battleTable, {
      charCount: theme.charCount || 6,
    });
    const sessionId = crypto.randomBytes(12).toString("hex");
    soloSessions.set(sessionId, {
      themeId,
      theme,
      solution,
      links,
      livesLeft: livesMax,
      livesMax,
      player: playerName,
      finished: false,
    });
    res.json({
      sessionId,
      player: playerName,
      livesMax,
      livesLeft: livesMax,
      display: display.map((c) => ({ name: c.name, types: c.types, image: c.image })),
      links,
      imageFolder: theme.imageFolder,
      criteria: theme.criteria,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/solo/:sessionId/validate", (req, res) => {
  const session = soloSessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: "Session introuvable ou expirée." });
  if (session.finished) return res.status(409).json({ error: "Partie déjà terminée." });
  const { order } = req.body || {};
  if (!Array.isArray(order) || order.length !== session.solution.length) {
    return res.status(400).json({ error: "Arrangement invalide." });
  }
  const arrangement = order.map((name) => session.solution.find((c) => c.name === name));
  if (arrangement.some((c) => !c)) return res.status(400).json({ error: "Personnage inconnu dans l'arrangement." });

  const { results, correctCount, solved } = validateArrangement(
    arrangement,
    session.links,
    session.theme.criteria,
    session.theme.battleTable
  );

  let gameOver = false;
  let won = false;
  if (solved) {
    gameOver = true;
    won = true;
  } else {
    session.livesLeft -= 1;
    if (session.livesLeft <= 0) gameOver = true;
  }

  let statEntry = null;
  if (gameOver && !session.finished) {
    session.finished = true;
    statEntry = playerStats.recordSoloResult({
      player: session.player,
      theme: session.themeId,
      result: won ? "victoire" : "defaite",
      livesUsed: session.livesMax - session.livesLeft,
      livesMax: session.livesMax,
      correctCount,
      linkCount: session.links.length,
    });
    soloSessions.delete(req.params.sessionId);
  }

  res.json({ results, correctCount, livesLeft: session.livesLeft, gameOver, won, stats: statEntry });
});

// =====================================================================
// Socket.IO — lobby & tournois multijoueur (Sprinteur / Survie)
// =====================================================================

const server = app.listen(PORT, () => {
  console.log(`Enigma-Lien en écoute sur http://localhost:${PORT}`);
  console.log(`  Menu principal   : http://localhost:${PORT}/`);
  console.log(`  Écran maître     : http://localhost:${PORT}/maitre.html`);
  console.log(`  Pages joueurs    : http://localhost:${PORT}/joueur1.html ... /joueur${MAX_SLOTS}.html`);
});

const io = new Server(server);
const tournament = new Tournament(themeStore);

function broadcastState() {
  io.to("master").emit("master:state", tournament.getMasterState());
  for (let s = 1; s <= MAX_SLOTS; s++) {
    io.to(`slot-${s}`).emit("player:state", tournament.getStateFor(s));
  }
}

function scheduleNextRound(delayMs = 3500) {
  setTimeout(() => {
    if (tournament.status === "playing") {
      tournament.startNextRound();
      broadcastState();
    }
  }, delayMs);
}

io.on("connection", (socket) => {
  socket.on("master:hello", () => {
    socket.join("master");
    socket.emit("master:state", tournament.getMasterState());
    socket.emit("themes:list", themeStore.listThemesSummary());
  });

  socket.on("master:configure", (cfg, ack) => {
    try {
      const state = tournament.configure(cfg || {});
      broadcastState();
      if (ack) ack({ ok: true, state });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("master:start", (_payload, ack) => {
    try {
      const state = tournament.start();
      broadcastState();
      if (ack) ack({ ok: true, state });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("master:end", (_payload, ack) => {
    try {
      const state = tournament.end();
      saveTournamentHistoryIfFinished();
      broadcastState();
      if (ack) ack({ ok: true, state });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("master:reset", (_payload, ack) => {
    try {
      const state = tournament.resetToLobby();
      broadcastState();
      if (ack) ack({ ok: true, state });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("player:hello", ({ slot }, ack) => {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
      if (ack) ack({ ok: false, error: "Emplacement invalide." });
      return;
    }
    socket.data.slot = slot;
    socket.join(`slot-${slot}`);
    socket.join("players");
    tournament.markConnected(slot);
    socket.emit("player:state", tournament.getStateFor(slot));
    io.to("master").emit("master:state", tournament.getMasterState());
    if (ack) ack({ ok: true });
  });

  socket.on("player:setName", ({ slot, name }, ack) => {
    try {
      const state = tournament.setPlayerName(slot, name);
      socket.data.slot = Number(slot);
      socket.join(`slot-${slot}`);
      socket.join("players");
      broadcastState();
      if (ack) ack({ ok: true, state });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("player:validate", ({ slot, order }, ack) => {
    try {
      const result = tournament.submit(slot, order);
      if (result.tournamentOver) {
        saveTournamentHistoryIfFinished();
      } else if (result.roundOver) {
        scheduleNextRound();
      }
      broadcastState();
      if (ack) ack({ ok: true, result });
    } catch (e) {
      if (ack) ack({ ok: false, error: e.message });
    }
  });

  socket.on("disconnect", () => {
    const slot = socket.data.slot;
    if (slot) {
      tournament.markDisconnected(slot);
      broadcastState();
    }
  });
});

let lastSavedFinishedAt = null;
function saveTournamentHistoryIfFinished() {
  if (tournament.status !== "finished") return;
  if (lastSavedFinishedAt === tournament.finishedAt) return; // déjà enregistré
  lastSavedFinishedAt = tournament.finishedAt;
  try {
    const fs = require("fs");
    const file = path.join(themeStore.DATA_DIR, "tournaments_history.json");
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    raw.push({
      date: tournament.finishedAt,
      themeId: tournament.config ? tournament.config.themeId : null,
      mode: tournament.config ? tournament.config.mode : null,
      winners: tournament.winnerSlots.map((s) => tournament.players[s].name),
      standings: tournament.standings(),
    });
    while (raw.length > 500) raw.shift();
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  } catch (e) {
    console.warn("Impossible d'enregistrer l'historique du tournoi :", e.message);
  }
}
