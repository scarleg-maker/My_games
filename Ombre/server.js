/**
 * Jeu "Ombre" - serveur Node.js (Express + Socket.io)
 * Page maitre : http://localhost:3300
 * Page joueur : http://localhost:3300/joueur
 */

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const AdmZip = require("adm-zip");
const { Server } = require("socket.io");

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

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "master.html"));
});
app.get("/joueur", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "player.html"));
});

// Sert une image depuis la memoire via un jeton opaque (jamais ecrite sur disque,
// le nom de fichier reel n'apparait jamais dans l'URL)
app.get("/game-image/:token", (req, res) => {
  const data = game && game.imageTokens[req.params.token];
  if (!data) return res.sendStatus(404);
  res.set("Content-Type", data.mimeType);
  res.set("Cache-Control", "no-store");
  res.send(data.buffer);
});

// Reception du zip d'images + creation de la partie, en un seul envoi (rien n'est stocke sur disque)
app.post("/api/create-game", upload.single("archive"), (req, res) => {
  try {
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

    game = createGame({
      names,
      images,
      archiveName: req.file.originalname,
      essais,
      tempsSec,
      mode,
      vies,
    });
    clearRoundTimer();
    broadcastAll();
    res.json({ ok: true, imageCount: images.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Utilitaires ----------

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

// ---------- Etat du jeu (une seule partie active a la fois) ----------

let game = null;
let roundInterval = null;

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

function activePlayers() {
  return game.players.filter((p) => !p.eliminated);
}

function startRound() {
  if (!game) return;
  clearRoundTimer();

  const { mode, essais, tempsSec } = game.settings;
  game.roundNum++;
  game.imageTokens = {};

  const perPlayer = {};

  if (mode === "survie") {
    if (game.survieIndex >= game.survieOrder.length) {
      return finishGame();
    }
    const image = game.survieOrder[game.survieIndex];
    game.survieIndex++;
    const token = makeToken();
    game.imageTokens[token] = { buffer: image.buffer, mimeType: image.mimeType };
    game.round = { image, token, startedAt: Date.now() };

    activePlayers().forEach((p) => {
      // Le compteur affiche le budget d'erreurs GLOBAL restant du joueur (pas reinitialise).
      perPlayer[p.id] = { attemptsLeft: p.errorsLeft, status: "playing", history: [] };
    });
  } else {
    game.round = { startedAt: Date.now() };
    activePlayers().forEach((p) => {
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
    roundInterval = setInterval(() => {
      if (!game || !game.round) return clearRoundTimer();
      if (Date.now() >= game.round.endsAt) {
        endRound();
      } else {
        broadcastAll();
      }
    }, 1000);
  }

  broadcastAll();
}

function clearRoundTimer() {
  if (roundInterval) {
    clearInterval(roundInterval);
    roundInterval = null;
  }
}

function allResolved() {
  const pp = game.round.perPlayer;
  return activePlayers().every((p) => pp[p.id] && pp[p.id].status !== "playing");
}

function endRound() {
  if (!game || !game.round) return;
  clearRoundTimer();

  const pp = game.round.perPlayer;
  const { mode } = game.settings;

  activePlayers().forEach((p) => {
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
  const remaining = activePlayers();
  if (mode === "survie") {
    if (game.survieIndex >= game.survieOrder.length || remaining.length <= 1) {
      return finishGame();
    }
  } else if (remaining.length <= 1) {
    return finishGame();
  }

  broadcastAll();
}

function finishGame() {
  clearRoundTimer();
  game.status = "finished";
  const { mode } = game.settings;

  if (mode === "survie") {
    const remaining = activePlayers();
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
    const remaining = activePlayers();
    if (remaining.length === 1) {
      game.winnerText = `${remaining[0].name} remporte la partie !`;
    } else if (remaining.length === 0) {
      game.winnerText = "Tous les joueurs ont ete elimines a la meme manche - egalite !";
    } else {
      game.winnerText = `Egalite entre ${remaining.map((w) => w.name).join(", ")}`;
    }
  }

  broadcastAll();
}

function submitAnswer(playerId, text) {
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

  if (allResolved()) {
    endRound();
  } else {
    broadcastAll();
  }
}

function forceValidate(playerId) {
  if (!game || !game.round) return;
  const st = game.round.perPlayer[playerId];
  if (!st || st.status === "correct") return;
  st.status = "correct";
  if (st.history.length) st.history[st.history.length - 1].correct = true;
  else st.history.push({ text: "(valide par le maitre)", correct: true, time: Date.now() });

  if (allResolved()) {
    endRound();
  } else {
    broadcastAll();
  }
}

// ---------- Diffusion de l'etat ----------

function timeLeftSec() {
  if (!game || !game.round || !game.round.endsAt) return null;
  return Math.max(0, Math.ceil((game.round.endsAt - Date.now()) / 1000));
}

function buildMasterState() {
  if (!game) return { status: "idle" };

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
            imageUrl: st.token ? `/game-image/${st.token}` : `/game-image/${game.round.token}`,
            imageName: game.settings.mode === "survie" ? game.round.image.name : st.image.name,
          }
        : null,
    };
  });

  return {
    status: game.status,
    settings: game.settings,
    roundNum: game.roundNum,
    totalRounds: game.settings.mode === "survie" ? game.images.length : null,
    timeLeft: timeLeftSec(),
    players,
    winnerText: game.winnerText,
  };
}

function buildPlayerState(player) {
  if (!game) return { status: "idle" };
  const st = game.round ? game.round.perPlayer[player.id] : null;

  const base = {
    status: game.status,
    mode: game.settings.mode,
    roundNum: game.roundNum,
    totalRounds: game.settings.mode === "survie" ? game.images.length : null,
    timeLeft: timeLeftSec(),
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
      imageUrl: `/game-image/${st.token || game.round.token}`,
      revealedName: st.status !== "playing" ? (game.settings.mode === "survie" ? game.round.image.name : st.image.name) : null,
    },
  };
}

function broadcastAll() {
  io.to("master").emit("master:state", buildMasterState());
  if (!game) return;
  game.players.forEach((p) => {
    if (p.socketId) {
      io.to(p.socketId).emit("player:state", buildPlayerState(p));
    }
  });
  io.to("players-lobby").emit("player:slots", availableSlots());
}

function availableSlots() {
  if (!game) return [];
  return game.players.filter((p) => !p.claimed).map((p) => ({ id: p.id, name: p.name }));
}

// ---------- Socket.io ----------

io.on("connection", (socket) => {
  socket.on("master:hello", () => {
    socket.join("master");
    socket.emit("master:state", buildMasterState());
  });

  socket.on("master:startRound", () => {
    if (game) startRound();
  });

  socket.on("master:forceValidate", ({ playerId }) => {
    forceValidate(playerId);
  });

  socket.on("master:resetGame", () => {
    clearRoundTimer();
    game = null;
    io.to("master").emit("master:state", buildMasterState());
    io.to("players-lobby").emit("player:slots", []);
  });

  // ---- Joueur ----

  socket.on("player:hello", () => {
    socket.join("players-lobby");
    socket.emit("player:slots", availableSlots());
    socket.emit("player:gameStatus", game ? game.status : "idle");
  });

  socket.on("player:claim", ({ playerId }) => {
    if (!game) return;
    const player = game.players.find((p) => p.id === playerId);
    if (!player || player.claimed) {
      socket.emit("player:claimFailed");
      return;
    }
    player.claimed = true;
    player.socketId = socket.id;
    socket.playerId = playerId;
    socket.emit("player:claimed", { id: player.id, name: player.name });
    socket.emit("player:state", buildPlayerState(player));
    io.to("master").emit("master:state", buildMasterState());
    io.to("players-lobby").emit("player:slots", availableSlots());
  });

  socket.on("player:submit", ({ text }) => {
    if (!socket.playerId) return;
    submitAnswer(socket.playerId, text);
  });

  socket.on("disconnect", () => {
    if (socket.playerId && game) {
      const player = game.players.find((p) => p.id === socket.playerId);
      if (player) player.socketId = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Jeu Ombre lance : http://localhost:${PORT}`);
  console.log(`Page joueur     : http://localhost:${PORT}/joueur`);
});
