const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const MonopolyGame = require("./gameEngine");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 11000;
const BOARDS_DIR = path.join(__dirname, "public", "boards");

app.use(express.static(path.join(__dirname, "public")));

// ----- Liste des plateaux disponibles -----
app.get("/api/boards", (req, res) => {
  try {
    const files = fs.readdirSync(BOARDS_DIR).filter((f) => f.endsWith(".json"));
    const list = files.map((f) => {
      const data = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, f), "utf-8"));
      return { id: f.replace(/\.json$/, ""), name: data.name || f };
    });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: "Impossible de lister les plateaux." });
  }
});

// ----- Parties en mémoire -----
const games = new Map(); // gameId -> MonopolyGame

function genGameId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (games.has(id));
  return id;
}

io.on("connection", (socket) => {
  socket.on("createGame", (config, cb) => {
    try {
      if (!config || !Array.isArray(config.players) || config.players.length < 2 || config.players.length > 8) {
        return cb({ ok: false, error: "Il faut entre 2 et 8 joueurs." });
      }
      const boardFile = path.join(BOARDS_DIR, `${config.boardId}.json`);
      if (!fs.existsSync(boardFile)) return cb({ ok: false, error: "Plateau introuvable." });
      const boardData = JSON.parse(fs.readFileSync(boardFile, "utf-8"));

      const gameId = genGameId();
      const game = new MonopolyGame(gameId, boardData, config.players);
      game.on("update", () => io.to(`game-${gameId}`).emit("state", game.getPublicState()));
      game.on("diceAnimate", (payload) => io.to(`game-${gameId}`).emit("diceRolling", payload));
      games.set(gameId, game);

      cb({
        ok: true,
        gameId,
        players: game.players.map((p) => ({ id: p.id, name: p.name, type: p.type })),
      });

      // démarre le premier tour (déclenche l'IA si besoin) après un court délai
      // pour laisser le temps aux pages joueur de se connecter.
      setTimeout(() => game.startTurn(), 300);
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on("joinGame", ({ gameId, playerIndex }, cb) => {
    const game = games.get(gameId);
    if (!game) return cb({ ok: false, error: "Partie introuvable. Vérifiez le lien." });
    if (playerIndex < 0 || playerIndex >= game.players.length || game.players[playerIndex].type !== "human") {
      return cb({ ok: false, error: "Ce joueur n'existe pas ou n'est pas humain." });
    }
    socket.join(`game-${gameId}`);
    socket.data.gameId = gameId;
    socket.data.playerIndex = playerIndex;
    cb({ ok: true, state: game.getPublicState(), myPlayerIndex: playerIndex });
  });

  function withGame(handler) {
    return (payload) => {
      const game = games.get(socket.data.gameId);
      if (!game || socket.data.playerIndex == null) return;
      handler(game, socket.data.playerIndex, payload || {});
    };
  }

  socket.on("rollDice", withGame((game, idx) => game.performRoll(idx)));
  socket.on("buyDecision", withGame((game, idx, { buy }) => game.resolveBuy(idx, !!buy)));
  socket.on("ackCard", withGame((game, idx) => game.ackCard(idx)));
  socket.on("payJailFee", withGame((game, idx) => game.payJailFee(idx)));
  socket.on("useJailCard", withGame((game, idx) => game.useJailCard(idx)));
  socket.on("endTurn", withGame((game, idx) => game.endTurn(idx)));
  socket.on("manageProperty", withGame((game, idx, { spaceId, action }) => game.manageProperty(idx, spaceId, action)));
});

server.listen(PORT, () => {
  console.log(`🎩 Monopoly est lancé : http://localhost:${PORT}`);
});
