const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
// QR codes : générateur embarqué dans lib/vendor (aucun module npm supplémentaire à installer).
const qrcode = require("./lib/vendor/qrcode-generator");
const { Server } = require("socket.io");

const themeStore = require("./lib/themeStore");
const playerStats = require("./lib/playerStats");
const { generatePuzzle, validateArrangement } = require("./lib/puzzleEngine");
const { MAX_SLOTS } = require("./lib/tournament");
const { RoomRegistry, cleanCode, validCode } = require("./lib/rooms");

// Render (et la plupart des hébergeurs) fournissent le port via la variable PORT.
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8500;
// Adresse publique (utilisée pour le QR code). Sur Render, RENDER_EXTERNAL_URL est fournie automatiquement.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "") || null;

const rooms = new RoomRegistry(themeStore);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/images", express.static(path.join(__dirname, "public", "images")));

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) out.push(`http://${i.address}:${PORT}`);
    }
  }
  return out;
}

// =====================================================================
// Salons : pages et API
// =====================================================================

app.get("/healthz", (req, res) => res.type("text/plain").send("ok"));

// Anciennes adresses fixes (un seul tournoi global) -> accueil, où l'on crée / rejoint un salon
app.get(["/maitre.html", /^\/joueur\d+\.html$/i], (req, res) => res.redirect("/"));

app.get("/api/config", (req, res) => {
  res.json({ publicUrl: PUBLIC_URL, lanUrls: lanUrls(), maxSlots: MAX_SLOTS });
});

// QR code en SVG généré côté serveur (aucune dépendance à un CDN : marche aussi sans internet, en réseau local)
app.get("/api/qr", (req, res) => {
  const text = String(req.query.text || "");
  if (!text || text.length > 400) return res.status(400).send("texte invalide");
  try {
    const qr = qrcode(0, "M"); // taille automatique, correction d'erreur moyenne
    qr.addData(text);
    qr.make();
    const svg = qr.createSvgTag(8, 2); // cellule 8 px, marge 2 modules (le SVG s'adapte à la taille de l'image)
    res.set("Cache-Control", "public, max-age=3600").type("image/svg+xml").send(svg);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.post("/api/rooms", (req, res) => {
  try {
    const { code, reuse } = req.body || {};
    const room = rooms.create(code || null, { reuse: !!reuse });
    room.touch();
    res.json({ ok: true, code: room.code });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/api/rooms/:code", (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  res.set("Cache-Control", "no-store");
  res.json(room ? { exists: true, ...room.info() } : { exists: false, code });
});

// Attribue la première place libre (pour le bouton "Rejoindre" du QR code)
app.post("/api/rooms/:code/claim", (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) return res.status(404).json({ ok: false, error: "Ce salon n'existe pas (ou a expiré)." });
  const slot = room.claimSlot();
  if (!slot) return res.status(409).json({ ok: false, error: `Le salon est complet (${MAX_SLOTS} joueurs).` });
  res.json({ ok: true, slot });
});

// /CODE (écran maître), /CODE/rejoindre (accueil pré-rempli), /CODE/joueurN (page joueur)
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur(\d+)\/?$/, (req, res, next) => {
  const code = cleanCode(req.params[0]);
  const slot = parseInt(req.params[1], 10);
  if (!validCode(code) || slot < 1 || slot > MAX_SLOTS) return next();
  res.sendFile(path.join(__dirname, "public", "salon-joueur.html"));
});
app.get(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/, (req, res, next) => {
  if (!validCode(cleanCode(req.params[0]))) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get(/^\/([A-Za-z0-9]{3,10})\/?$/, (req, res, next) => {
  if (!validCode(cleanCode(req.params[0]))) return next();
  res.sendFile(path.join(__dirname, "public", "salon-maitre.html"));
});

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
      display: display.map((c) => ({ name: c.name, image: c.image })),
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
// Socket.IO — salons, lobby & tournois multijoueur (Sprinteur / Survie)
// =====================================================================

const server = app.listen(PORT, () => {
  console.log(`Enigma-Lien en écoute sur http://localhost:${PORT}`);
  console.log(`  Accueil (créer / rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local               : ${u}/`);
  if (PUBLIC_URL) console.log(`  Adresse publique                     : ${PUBLIC_URL}/`);
});

const io = new Server(server);

// Nettoyage des salons abandonnés (sans page ouverte depuis plusieurs heures)
setInterval(() => rooms.purge(false), 10 * 60 * 1000).unref();

const masterChannel = (room) => `${room.code}:master`;
const slotChannel = (room, s) => `${room.code}:slot-${s}`;

function broadcastState(room) {
  room.touch();
  const t = room.tournament;
  io.to(masterChannel(room)).emit("master:state", t.getMasterState());
  for (let s = 1; s <= MAX_SLOTS; s++) {
    io.to(slotChannel(room, s)).emit("player:state", t.getStateFor(s));
  }
}

function scheduleNextRound(room, delayMs = 3500) {
  room.clearRoundTimer();
  room.roundTimer = setTimeout(() => {
    room.roundTimer = null;
    if (rooms.get(room.code) === room && room.tournament.status === "playing") {
      room.tournament.startNextRound();
      broadcastState(room);
    }
  }, delayMs);
}

function saveTournamentHistoryIfFinished(room) {
  const t = room.tournament;
  if (t.status !== "finished") return;
  if (room.lastSavedFinishedAt === t.finishedAt) return; // déjà enregistré
  room.lastSavedFinishedAt = t.finishedAt;
  try {
    const file = path.join(themeStore.DATA_DIR, "tournaments_history.json");
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    raw.push({
      date: t.finishedAt,
      room: room.code,
      themeId: t.config ? t.config.themeId : null,
      mode: t.config ? t.config.mode : null,
      winners: t.winnerSlots.map((s) => t.players[s].name),
      standings: t.standings(),
    });
    while (raw.length > 500) raw.shift();
    fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
  } catch (e) {
    // sur un hébergeur à disque en lecture seule / éphémère, l'historique est simplement facultatif
    console.warn("Impossible d'enregistrer l'historique du tournoi :", e.message);
  }
}

const NO_ROOM = { ok: false, noroom: true, error: "Ce salon n'existe plus (ou a expiré). Recharge la page." };

io.on("connection", (socket) => {
  // Chaque page annonce son salon à la connexion : io({ query: { room: "K7QF" } })
  const code = cleanCode(socket.handshake.query && socket.handshake.query.room);
  const room = validCode(code) ? rooms.get(code) : null;
  if (!room) {
    socket.emit("room:missing", { code });
    return;
  }
  socket.data.room = code;
  room.sockets++;
  room.touch();

  // On retrouve le salon à chaque événement (il peut avoir été supprimé / recréé entre-temps)
  const current = () => {
    const r = rooms.get(code);
    return r === room ? r : null;
  };
  // Enveloppe commune : vérifie que le salon existe encore et attrape les erreurs
  const handle = (fn) => (payload, ack) => {
    const r = current();
    if (!r) {
      if (typeof ack === "function") ack(NO_ROOM);
      socket.emit("room:missing", { code });
      return;
    }
    r.touch();
    try {
      const out = fn(r, payload || {}) || {};
      if (typeof ack === "function") ack({ ok: true, ...out });
    } catch (e) {
      if (typeof ack === "function") ack({ ok: false, error: e.message });
    }
  };

  socket.on("master:hello", () => {
    const r = current();
    if (!r) return socket.emit("room:missing", { code });
    socket.join(masterChannel(r));
    socket.emit("master:state", r.tournament.getMasterState());
    socket.emit("themes:list", themeStore.listThemesSummary());
  });

  socket.on("master:configure", handle((r, cfg) => {
    const state = r.tournament.configure(cfg);
    broadcastState(r);
    return { state };
  }));

  socket.on("master:start", handle((r) => {
    const state = r.tournament.start();
    broadcastState(r);
    return { state };
  }));

  socket.on("master:end", handle((r) => {
    r.clearRoundTimer();
    const state = r.tournament.end();
    saveTournamentHistoryIfFinished(r);
    broadcastState(r);
    return { state };
  }));

  socket.on("master:reset", handle((r) => {
    r.clearRoundTimer();
    const state = r.tournament.resetToLobby();
    broadcastState(r);
    return { state };
  }));

  socket.on("player:hello", handle((r, { slot }) => {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) throw new Error("Emplacement invalide.");
    socket.data.slot = slot;
    socket.join(slotChannel(r, slot));
    r.tournament.markConnected(slot);
    socket.emit("player:state", r.tournament.getStateFor(slot));
    io.to(masterChannel(r)).emit("master:state", r.tournament.getMasterState());
  }));

  socket.on("player:setName", handle((r, { slot, name }) => {
    const state = r.tournament.setPlayerName(slot, name);
    socket.data.slot = Number(slot);
    socket.join(slotChannel(r, Number(slot)));
    r.reservations.delete(Number(slot));
    broadcastState(r);
    return { state };
  }));

  socket.on("player:validate", handle((r, { slot, order }) => {
    const result = r.tournament.submit(slot, order);
    if (result.tournamentOver) {
      saveTournamentHistoryIfFinished(r);
    } else if (result.roundOver) {
      scheduleNextRound(r);
    }
    broadcastState(r);
    return { result };
  }));

  socket.on("disconnect", () => {
    room.sockets = Math.max(0, room.sockets - 1);
    const r = current();
    if (!r) return;
    r.touch();
    const slot = socket.data.slot;
    if (slot) {
      // Une autre page du même joueur (rechargement, reconnexion mobile) est peut-être déjà revenue
      const still = io.sockets.adapter.rooms.get(slotChannel(r, slot));
      if (!still || still.size === 0) {
        r.tournament.markDisconnected(slot);
        broadcastState(r);
      }
    }
  });
});
