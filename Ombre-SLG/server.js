/**
 * Jeu "Ombre-SLG" - serveur Node.js (Express + Socket.io)
 * Plusieurs parties simultanees ("salons"), chacune identifiee par un code.
 *
 * Accueil (creer / rejoindre un salon) : http://localhost:3300/
 * Page maitre d'un salon                : http://localhost:3300/<CODE>
 * Page joueur d'un salon                : http://localhost:3300/<CODE>/joueur
 */

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { Server } = require("socket.io");
const os = require("os");

const PORT = 3300;
const VALID_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
};
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000; // un salon sans personne connectee depuis 6h est supprime
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L (ambigus a l'oral/a l'ecrit)
const CODE_RE = /^[A-Z0-9]{4,10}$/;
const RESERVED_CODES = new Set(["API", "JOUEUR", "STATIC", "FAVICON", "CSS", "JS", "SOCKET"]);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Utilitaires generaux ----------

function extractImagesFromZip(buffer) {
  const zip = new AdmZip(buffer);
  const images = [];
  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory) return;
    if (entry.entryName.includes("__MACOSX")) return;
    const base = path.basename(entry.entryName);
    if (base.startsWith(".")) return; // fichiers caches type .DS_Store
    const ext = path.extname(base).toLowerCase();
    if (!VALID_EXT.has(ext)) return;
    images.push({
      file: base,
      name: path.parse(base).name,
      buffer: entry.getData(),
      mimeType: MIME_BY_EXT[ext],
    });
  });
  return images;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(str) {
  return (str || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
    .toLowerCase()
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeToken() {
  return crypto.randomBytes(8).toString("hex");
}

function lanUrls() {
  const urls = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) urls.push(`http://${iface.address}:${PORT}`);
    }
  }
  return urls;
}

// ---------- Registre des salons ----------

const rooms = new Map(); // code -> room

function cleanCode(c) {
  return String(c || "").trim().toUpperCase();
}
function validCode(c) {
  return CODE_RE.test(c) && !RESERVED_CODES.has(c);
}
function newCode(len = 4) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = "";
    for (let k = 0; k < len; k++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return newCode(len + 1);
}

function createRoom(code) {
  return {
    code,
    game: null,
    roundInterval: null,
    sockets: new Set(), // ids des sockets connectees a ce salon (maitre + joueurs)
    lastActivity: Date.now(),
  };
}

function getRoom(code, create) {
  code = cleanCode(code);
  if (rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  const r = createRoom(code);
  rooms.set(code, r);
  return r;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function purgeRooms(force) {
  for (const [code, r] of rooms) {
    if (r.sockets.size === 0 && (force || Date.now() - r.lastActivity > ROOM_IDLE_MS)) {
      clearRoundTimer(r);
      rooms.delete(code);
    }
  }
}
setInterval(() => purgeRooms(false), 10 * 60 * 1000);

// ---------- Logique du jeu (toutes les fonctions prennent "room" en parametre) ----------

function createGame({ names, images, archiveName, essais, tempsSec, mode, vies }) {
  const players = names.map((name, i) => ({
    id: "p" + i,
    name,
    socketId: null,
    claimed: false,
    score: 0,
    lives: mode === "elimination" ? vies : null,
    // En mode survie, errorsLeft est un budget d'erreurs GLOBAL (non reinitialise a chaque manche).
    errorsLeft: mode === "survie" ? essais : null,
    eliminated: false,
    eliminationRound: null,
  }));

  return {
    status: "lobby", // lobby -> playing -> roundEnd -> playing ... -> finished
    settings: { archiveName, essais, tempsSec, mode, vies },
    images,
    survieOrder: mode === "survie" ? shuffle(images) : null,
    survieIndex: 0,
    roundNum: 0,
    players,
    round: null, // { perPlayer: {id: {...}}, startedAt, endsAt, image? }
    imageTokens: {},
    winnerText: null,
  };
}

function activePlayers(room) {
  return room.game.players.filter((p) => !p.eliminated);
}

function clearRoundTimer(room) {
  if (room.roundInterval) {
    clearInterval(room.roundInterval);
    room.roundInterval = null;
  }
}

function startRound(room) {
  const game = room.game;
  if (!game) return;
  clearRoundTimer(room);

  const { mode, essais, tempsSec } = game.settings;
  game.roundNum++;
  game.imageTokens = {};

  const perPlayer = {};

  if (mode === "survie") {
    if (game.survieIndex >= game.survieOrder.length) {
      return finishGame(room);
    }
    const image = game.survieOrder[game.survieIndex];
    game.survieIndex++;
    const token = makeToken();
    game.imageTokens[token] = { buffer: image.buffer, mimeType: image.mimeType };
    game.round = { image, token, startedAt: Date.now() };

    activePlayers(room).forEach((p) => {
      // Le compteur affiche le budget d'erreurs GLOBAL restant du joueur (pas reinitialise).
      perPlayer[p.id] = { attemptsLeft: p.errorsLeft, status: "playing", history: [] };
    });
  } else {
    game.round = { startedAt: Date.now() };
    activePlayers(room).forEach((p) => {
      const image = game.images[Math.floor(Math.random() * game.images.length)];
      const token = makeToken();
      game.imageTokens[token] = { buffer: image.buffer, mimeType: image.mimeType };
      perPlayer[p.id] = {
        attemptsLeft: essais,
        status: "playing",
        history: [],
        image,
        token,
      };
    });
  }

  game.round.perPlayer = perPlayer;
  game.round.endsAt = tempsSec ? Date.now() + tempsSec * 1000 : null;
  game.status = "playing";

  if (tempsSec) {
    room.roundInterval = setInterval(() => {
      if (!room.game || !room.game.round) return clearRoundTimer(room);
      if (Date.now() >= room.game.round.endsAt) {
        endRound(room);
      } else {
        broadcastAll(room);
      }
    }, 1000);
  }

  touch(room);
  broadcastAll(room);
}

function allResolved(room) {
  const pp = room.game.round.perPlayer;
  return activePlayers(room).every((p) => pp[p.id] && pp[p.id].status !== "playing");
}

function endRound(room) {
  const game = room.game;
  if (!game || !game.round) return;
  clearRoundTimer(room);

  const pp = game.round.perPlayer;
  const { mode } = game.settings;

  activePlayers(room).forEach((p) => {
    const st = pp[p.id];
    if (!st) return;

    if (mode === "survie") {
      if (st.status === "correct") {
        p.score += 1;
      } else if (st.status === "playing") {
        // Le temps est ecoule avant que le joueur n'ait trouve : elimination
        // directe et definitive, au meme titre qu'une erreur.
        st.status = "failed";
        p.eliminated = true;
        p.eliminationRound = game.roundNum;
      }
      // Si st.status === "failed", le joueur a deja ete elimine directement
      // au moment de sa derniere erreur (voir submitAnswer).
    } else {
      if (st.status === "playing") st.status = "failed"; // temps ecoule / non resolu
      if (st.status !== "correct") {
        p.lives -= 1;
        if (p.lives <= 0) {
          p.eliminated = true;
          p.eliminationRound = game.roundNum;
        }
      }
    }
  });

  game.status = "roundEnd";

  // Conditions de fin de partie
  const remaining = activePlayers(room);
  if (mode === "survie") {
    if (game.survieIndex >= game.survieOrder.length || remaining.length <= 1) {
      return finishGame(room);
    }
  } else if (remaining.length <= 1) {
    return finishGame(room);
  }

  broadcastAll(room);
}

function finishGame(room) {
  const game = room.game;
  clearRoundTimer(room);
  game.status = "finished";
  const { mode } = game.settings;

  if (mode === "survie") {
    const remaining = activePlayers(room);
    if (remaining.length === 1) {
      game.winnerText = `${remaining[0].name} est le dernier survivant avec ${remaining[0].score} point(s) !`;
    } else if (remaining.length === 0) {
      game.winnerText = "Tous les joueurs restants ont ete elimines a la meme manche - egalite !";
    } else {
      // Toutes les images ont ete utilisees avec plusieurs survivants : le score depart le vainqueur.
      const max = Math.max(...remaining.map((p) => p.score));
      const winners = remaining.filter((p) => p.score === max);
      game.winnerText =
        winners.length === 1
          ? `${winners[0].name} remporte la partie avec ${max} bonne(s) reponse(s) !`
          : `Egalite entre ${winners.map((w) => w.name).join(", ")} (${max} points)`;
    }
  } else {
    const remaining = activePlayers(room);
    if (remaining.length === 1) {
      game.winnerText = `${remaining[0].name} remporte la partie !`;
    } else if (remaining.length === 0) {
      game.winnerText = "Tous les joueurs ont ete elimines a la meme manche - egalite !";
    } else {
      game.winnerText = `Egalite entre ${remaining.map((w) => w.name).join(", ")}`;
    }
  }

  broadcastAll(room);
}

function submitAnswer(room, playerId, text) {
  const game = room.game;
  if (!game || !game.round || game.status !== "playing") return;
  const player = game.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return;
  const st = game.round.perPlayer[playerId];
  if (!st || st.status !== "playing") return;

  const correctName = game.settings.mode === "survie" ? game.round.image.name : st.image.name;
  const isCorrect = normalize(text) === normalize(correctName);

  st.history.push({ text, correct: isCorrect, time: Date.now() });

  if (isCorrect) {
    st.status = "correct";
  } else {
    st.attemptsLeft--;

    if (game.settings.mode === "survie") {
      // Mode Survie : chaque erreur consomme le budget global du joueur.
      // Elimination DIRECTE et definitive des que le budget est epuise.
      player.errorsLeft = st.attemptsLeft;
      if (st.attemptsLeft <= 0) {
        st.status = "failed";
        player.eliminated = true;
        player.eliminationRound = game.roundNum;
      }
    } else if (st.attemptsLeft <= 0) {
      st.status = "failed";
    }
  }

  touch(room);
  if (allResolved(room)) {
    endRound(room);
  } else {
    broadcastAll(room);
  }
}

function forceValidate(room, playerId) {
  const game = room.game;
  if (!game || !game.round) return;
  const st = game.round.perPlayer[playerId];
  if (!st || st.status === "correct") return;
  st.status = "correct";
  if (st.history.length) st.history[st.history.length - 1].correct = true;
  else st.history.push({ text: "(valide par le maitre)", correct: true, time: Date.now() });

  touch(room);
  if (allResolved(room)) {
    endRound(room);
  } else {
    broadcastAll(room);
  }
}

// ---------- Diffusion de l'etat ----------

function timeLeftSec(room) {
  const game = room.game;
  if (!game || !game.round || !game.round.endsAt) return null;
  return Math.max(0, Math.ceil((game.round.endsAt - Date.now()) / 1000));
}

function buildMasterState(room) {
  const game = room.game;
  if (!game) return { status: "idle", code: room.code };

  const players = game.players.map((p) => {
    const st = game.round ? game.round.perPlayer[p.id] : null;
    return {
      id: p.id,
      name: p.name,
      claimed: p.claimed,
      score: p.score,
      lives: p.lives,
      eliminated: p.eliminated,
      eliminationRound: p.eliminationRound,
      round: st
        ? {
            status: st.status,
            attemptsLeft: st.attemptsLeft,
            history: st.history,
            imageUrl: st.token ? `/game-image/${room.code}/${st.token}` : `/game-image/${room.code}/${game.round.token}`,
            imageName: game.settings.mode === "survie" ? game.round.image.name : st.image.name,
          }
        : null,
    };
  });

  return {
    status: game.status,
    code: room.code,
    settings: game.settings,
    roundNum: game.roundNum,
    totalRounds: game.settings.mode === "survie" ? game.images.length : null,
    timeLeft: timeLeftSec(room),
    players,
    winnerText: game.winnerText,
  };
}

function buildPlayerState(room, player) {
  const game = room.game;
  if (!game) return { status: "idle", code: room.code };
  const st = game.round ? game.round.perPlayer[player.id] : null;

  const base = {
    status: game.status,
    code: room.code,
    mode: game.settings.mode,
    roundNum: game.roundNum,
    totalRounds: game.settings.mode === "survie" ? game.images.length : null,
    timeLeft: timeLeftSec(room),
    tempsSec: game.settings.tempsSec,
    name: player.name,
    score: player.score,
    lives: player.lives,
    eliminated: player.eliminated,
    winnerText: game.winnerText,
  };

  if (!st) return { ...base, round: null };

  return {
    ...base,
    round: {
      status: st.status,
      attemptsLeft: st.attemptsLeft,
      history: st.history,
      imageUrl: `/game-image/${room.code}/${st.token || game.round.token}`,
      revealedName: st.status !== "playing" ? (game.settings.mode === "survie" ? game.round.image.name : st.image.name) : null,
    },
  };
}

function availableSlots(room) {
  if (!room.game) return [];
  return room.game.players.filter((p) => !p.claimed).map((p) => ({ id: p.id, name: p.name }));
}

function broadcastAll(room) {
  io.to("master:" + room.code).emit("master:state", buildMasterState(room));
  io.to("players-lobby:" + room.code).emit("player:slots", availableSlots(room));
  if (!room.game) return;
  room.game.players.forEach((p) => {
    if (p.socketId) {
      io.to(p.socketId).emit("player:state", buildPlayerState(room, p));
    }
  });
}

// ---------- Routes HTTP ----------

// Sert une image depuis la memoire via un jeton opaque (jamais ecrite sur disque,
// le nom de fichier reel n'apparait jamais dans l'URL)
app.get("/game-image/:code/:token", (req, res) => {
  const room = getRoom(req.params.code, false);
  const data = room && room.game && room.game.imageTokens[req.params.token];
  if (!data) return res.sendStatus(404);
  res.set("Content-Type", data.mimeType);
  res.set("Cache-Control", "no-store");
  res.send(data.buffer);
});

// Cree ou verifie un salon (bouton "Creer un salon" / code personnalise sur la page d'accueil)
app.post("/api/rooms", (req, res) => {
  let code = req.body.code ? cleanCode(req.body.code) : newCode();
  if (!validCode(code)) {
    return res.json({ ok: false, error: "Code invalide : 4 a 10 lettres ou chiffres." });
  }
  if (rooms.has(code)) {
    return res.json({ ok: false, error: `Le salon ${code} existe deja. Ouvre-le directement ou choisis un autre code.` });
  }
  getRoom(code, true);
  res.json({ ok: true, code });
});

// Info rapide sur un salon (existe-t-il, partie en cours...)
app.get("/api/rooms/:code", (req, res) => {
  const code = cleanCode(req.params.code);
  const room = validCode(code) ? getRoom(code, false) : null;
  if (!room) return res.json({ exists: false, code });
  res.json({
    exists: true,
    code,
    status: room.game ? room.game.status : "idle",
    nbPlayers: room.game ? room.game.players.length : 0,
  });
});

// Reception du zip d'images + creation de la partie pour un salon donne (rien n'est stocke sur disque)
app.post("/api/rooms/:code/create-game", upload.single("archive"), (req, res) => {
  try {
    const code = cleanCode(req.params.code);
    if (!validCode(code)) return res.status(400).json({ error: "Code de salon invalide." });
    if (!req.file) return res.status(400).json({ error: "Aucun fichier .zip fourni." });

    const names = JSON.parse(req.body.names || "[]");
    const essais = parseInt(req.body.essais, 10);
    const tempsRaw = req.body.tempsSec;
    const tempsSec = tempsRaw === "" || tempsRaw === "0" || tempsRaw === undefined ? null : parseInt(tempsRaw, 10);
    const mode = req.body.mode;
    const vies = mode === "elimination" ? parseInt(req.body.vies, 10) : null;

    if (!Array.isArray(names) || names.length < 1) {
      return res.status(400).json({ error: "Liste de joueurs invalide." });
    }

    const images = extractImagesFromZip(req.file.buffer);
    if (images.length === 0) {
      return res.status(400).json({ error: "Aucune image valide trouvee dans ce zip (png, jpg, webp, bmp, gif)." });
    }

    const room = getRoom(code, true);
    clearRoundTimer(room);
    room.game = createGame({
      names,
      images,
      archiveName: req.file.originalname,
      essais,
      tempsSec,
      mode,
      vies,
    });
    touch(room);
    broadcastAll(room);
    res.json({ ok: true, imageCount: images.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "accueil.html"));
});
app.get("/:code([A-Za-z0-9]{4,10})", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "master.html"));
});
app.get("/:code([A-Za-z0-9]{4,10})/joueur", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

// ---------- Socket.io ----------

io.on("connection", (socket) => {
  socket.on("master:hello", ({ code }) => {
    const room = getRoom(code, true);
    if (!room) return;
    socket.data.roomCode = room.code;
    socket.join("master:" + room.code);
    room.sockets.add(socket.id);
    touch(room);
    socket.emit("master:state", buildMasterState(room));
  });

  socket.on("master:startRound", () => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.game) startRound(room);
  });

  socket.on("master:forceValidate", ({ playerId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (room) forceValidate(room, playerId);
  });

  socket.on("master:resetGame", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    clearRoundTimer(room);
    room.game = null;
    touch(room);
    io.to("master:" + room.code).emit("master:state", buildMasterState(room));
    io.to("players-lobby:" + room.code).emit("player:slots", []);
  });

  // ---- Joueur ----

  socket.on("player:hello", ({ code }) => {
    const cleaned = cleanCode(code);
    const room = validCode(cleaned) ? getRoom(cleaned, false) : null;
    socket.data.roomCode = cleaned;
    socket.join("players-lobby:" + cleaned);
    if (!room) {
      socket.emit("player:roomStatus", { exists: false });
      return;
    }
    room.sockets.add(socket.id);
    touch(room);
    socket.emit("player:roomStatus", { exists: true });
    socket.emit("player:slots", availableSlots(room));
    socket.emit("player:gameStatus", room.game ? room.game.status : "idle");
  });

  socket.on("player:claim", ({ playerId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.game) return;
    const player = room.game.players.find((p) => p.id === playerId);
    if (!player || player.claimed) {
      socket.emit("player:claimFailed");
      return;
    }
    player.claimed = true;
    player.socketId = socket.id;
    socket.playerId = playerId;
    touch(room);
    socket.emit("player:claimed", { id: player.id, name: player.name });
    socket.emit("player:state", buildPlayerState(room, player));
    io.to("master:" + room.code).emit("master:state", buildMasterState(room));
    io.to("players-lobby:" + room.code).emit("player:slots", availableSlots(room));
  });

  socket.on("player:submit", ({ text }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.playerId) return;
    submitAnswer(room, socket.playerId, text);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.sockets.delete(socket.id);
    touch(room);
    if (socket.playerId && room.game) {
      const player = room.game.players.find((p) => p.id === socket.playerId);
      if (player) player.socketId = null;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nJeu Ombre-SLG lance !`);
  console.log(`Accueil (creer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`Depuis le reseau local                : ${u}/`);
  console.log("");
});
