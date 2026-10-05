// Monopoly — serveur avec salons (Node.js + Express + Socket.io)
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante.
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { Server } = require("socket.io");
const MonopolyGame = require("./gameEngine");

const PORT = process.env.PORT || 11000;
const PUBLIC = path.join(__dirname, "public");
const BOARDS_DIR = path.join(PUBLIC, "boards");
const SAVE_FILE = path.join(__dirname, "sauvegarde.json");
const MAX_SEATS = 8;
const DEFAULT_BOARD = "paris";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------- utilitaires
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === "IPv4" && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}
function listBoards() {
  let files = [];
  try { files = fs.readdirSync(BOARDS_DIR).filter((f) => f.endsWith(".json")).sort(); } catch {}
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, f), "utf-8"));
      out.push({ id: f.replace(/\.json$/, ""), name: d.name || f });
    } catch {}
  }
  return out;
}
const boardExists = (id) => /^[\w-]+$/.test(id || "") && fs.existsSync(path.join(BOARDS_DIR, id + ".json"));
const loadBoard = (id) => JSON.parse(fs.readFileSync(path.join(BOARDS_DIR, id + ".json"), "utf-8"));

// ---------------------------------------------------------------- sauvegarde des réglages par code de salon
let savedRooms = {};
try {
  const d = JSON.parse(fs.readFileSync(SAVE_FILE, "utf-8"));
  savedRooms = d && d.rooms && typeof d.rooms === "object" ? d.rooms : {};
} catch {}
let saveTimer = null;
function saveRoom(code, data) {
  savedRooms[code] = { ...data, t: Date.now() };
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(100)) delete savedRooms[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: savedRooms }, null, 1), () => {}), 300);
}

// ================================================================ salons
class Room {
  constructor(code, saved) {
    this.code = code;
    this.channel = `room-${code}`;
    this.boardId = DEFAULT_BOARD;
    this.nbPlayers = 2;
    this.seats = Array.from({ length: MAX_SEATS }, () => ({ type: "human", name: "", claimed: false }));
    this.game = null;
    this.sockets = new Set();
    this.lastActivity = Date.now();
    if (saved) {
      if (boardExists(saved.boardId)) this.boardId = saved.boardId;
      if (saved.nbPlayers) this.nbPlayers = Math.max(2, Math.min(MAX_SEATS, saved.nbPlayers | 0));
      (saved.seats || []).slice(0, MAX_SEATS).forEach((s, i) => {
        if (!s) return;
        this.seats[i].type = s.type === "ai" ? "ai" : "human";
        this.seats[i].name = String(s.name || "").slice(0, 16);
      });
    }
  }
  touch() { this.lastActivity = Date.now(); }
  idle() { return Date.now() - this.lastActivity; }
  get phase() { return !this.game ? "lobby" : this.game.gameOver ? "over" : "playing"; }
  online(i) { return [...this.sockets].some((s) => s.data.role === "seat" && s.data.seat === i); }
  boardName() { try { return loadBoard(this.boardId).name; } catch { return this.boardId; } }

  save() {
    saveRoom(this.code, {
      boardId: this.boardId, nbPlayers: this.nbPlayers,
      seats: this.seats.map((s) => ({ type: s.type, name: s.name })),
    });
  }

  // vue publique du salon (lobby + présence)
  view() {
    return {
      code: this.code, phase: this.phase, boardId: this.boardId, boardName: this.boardName(),
      nbPlayers: this.nbPlayers, lanUrls: lanUrls(),
      seats: this.seats.slice(0, this.nbPlayers).map((s, i) => ({
        index: i, type: s.type, color: MonopolyGame.PALETTE[i],
        name: s.type === "ai" ? s.name || `IA ${i + 1}` : s.name,
        claimed: s.type === "ai" || s.claimed, online: this.online(i),
      })),
    };
  }
  broadcastRoom() { io.to(this.channel).emit("room", this.view()); }

  join(socket, role, seat) {
    if (role === "seat") {
      if (!Number.isInteger(seat) || seat < 0 || seat >= this.nbPlayers) throw new Error("Ce siège n'existe pas dans ce salon.");
      if (this.seats[seat].type !== "human") throw new Error("Ce siège est joué par l'IA.");
    } else if (role !== "host" && role !== "spectator") throw new Error("Rôle invalide.");
    socket.data = { code: this.code, role, seat: role === "seat" ? seat : null };
    socket.join(this.channel);
    this.sockets.add(socket);
    this.touch();
    this.broadcastRoom();
    return { room: this.view(), state: this.game ? this.game.getPublicState() : null };
  }
  leave(socket) {
    if (!this.sockets.delete(socket)) return;
    this.touch();
    this.broadcastRoom();
  }

  startGame() {
    const n = this.nbPlayers;
    const players = this.seats.slice(0, n).map((s, i) => ({
      type: s.type, name: s.type === "ai" ? s.name || `IA ${i + 1}` : s.name,
    }));
    this.game = new MonopolyGame(this.code, loadBoard(this.boardId), players);
    const g = this.game;
    g.on("update", () => {
      io.to(this.channel).emit("state", g.getPublicState());
      if (g.gameOver && !g._roomNotified) { g._roomNotified = true; this.broadcastRoom(); }
    });
    g.on("diceAnimate", (p) => io.to(this.channel).emit("diceRolling", p));
    this.broadcastRoom();
    setTimeout(() => { if (this.game === g) g.startTurn(); }, 300);
  }
  stopGame() {
    if (this.game) { this.game.destroy(); this.game = null; }
  }

  // toutes les actions envoyées par les pages (hôte, joueur) passent ici
  act(socket, a) {
    const { role, seat } = socket.data || {};
    const need = (c, m) => { if (!c) throw new Error(m); };
    const isHost = role === "host";
    this.touch();

    switch (a.type) {
      // ----- configuration du salon (hôte, avant la partie)
      case "config": {
        need(isHost, "Action réservée à l'hôte.");
        need(this.phase === "lobby", "Configuration impossible pendant une partie.");
        if (a.boardId !== undefined) { need(boardExists(a.boardId), "Plateau introuvable."); this.boardId = a.boardId; }
        if (a.nbPlayers !== undefined) this.nbPlayers = Math.max(2, Math.min(MAX_SEATS, a.nbPlayers | 0));
        if (a.seat !== undefined) {
          const i = a.seat | 0;
          need(i >= 0 && i < MAX_SEATS, "Siège invalide.");
          if (a.seatType !== undefined) {
            this.seats[i].type = a.seatType === "ai" ? "ai" : "human";
            this.seats[i].claimed = false;
          }
          if (a.seatName !== undefined) {
            this.seats[i].name = String(a.seatName).trim().slice(0, 16);
            if (this.seats[i].type === "human") this.seats[i].claimed = false;
          }
        }
        this.save(); this.broadcastRoom(); break;
      }
      case "start": {
        need(isHost, "Action réservée à l'hôte.");
        need(this.phase === "lobby", "La partie est déjà lancée.");
        for (let i = 0; i < this.nbPlayers; i++) {
          const s = this.seats[i];
          need(s.type === "ai" || (s.claimed && s.name), `Le siège ${i + 1} n'est pas encore occupé (ou passe-le en IA).`);
        }
        need(this.seats.slice(0, this.nbPlayers).some((s) => s.type === "human"), "Il faut au moins un joueur humain.");
        this.startGame(); break;
      }
      case "rematch": {
        need(isHost, "Action réservée à l'hôte.");
        need(this.phase !== "lobby", "Aucune partie à rejouer.");
        this.stopGame(); this.startGame(); break;
      }
      case "reset": {
        need(isHost, "Action réservée à l'hôte.");
        this.stopGame(); this.broadcastRoom(); break;
      }
      // ----- sièges (joueur)
      case "claim": {
        need(role === "seat", "Ouvre le lien d'un siège pour t'installer.");
        need(this.phase === "lobby", "Les inscriptions sont fermées pendant la partie.");
        const name = String(a.name || "").trim().slice(0, 16);
        need(name, "Indique un nom.");
        const dup = this.seats.findIndex((s, i) => i !== seat && i < this.nbPlayers && s.claimed && s.name.toLowerCase() === name.toLowerCase());
        need(dup < 0, "Ce nom est déjà pris dans le salon.");
        this.seats[seat].name = name; this.seats[seat].claimed = true;
        this.save(); this.broadcastRoom(); break;
      }
      case "release": {
        need(this.phase === "lobby", "Impossible pendant la partie.");
        const i = isHost ? a.seat | 0 : seat;
        need(Number.isInteger(i) && i >= 0 && i < MAX_SEATS, "Siège invalide.");
        this.seats[i].claimed = false;
        this.save(); this.broadcastRoom(); break;
      }
      // ----- actions de jeu (joueur assis)
      case "rollDice": case "buyDecision": case "ackCard": case "payJailFee":
      case "useJailCard": case "endTurn": case "manageProperty": {
        need(role === "seat", "Les spectateurs ne peuvent pas jouer.");
        need(this.game, "La partie n'a pas commencé.");
        const g = this.game;
        if (a.type === "rollDice") g.performRoll(seat);
        else if (a.type === "buyDecision") g.resolveBuy(seat, !!a.buy);
        else if (a.type === "ackCard") g.ackCard(seat);
        else if (a.type === "payJailFee") g.payJailFee(seat);
        else if (a.type === "useJailCard") g.useJailCard(seat);
        else if (a.type === "endTurn") g.endTurn(seat);
        else g.manageProperty(seat, a.spaceId | 0, a.action);
        break;
      }
      default: throw new Error("Action inconnue.");
    }
  }

  destroy() {
    this.stopGame();
    io.to(this.channel).emit("roomClosed");
    for (const s of this.sockets) s.leave(this.channel);
    this.sockets.clear();
  }
  info() {
    const v = this.view();
    return { exists: true, code: v.code, phase: v.phase, boardName: v.boardName, nbPlayers: v.nbPlayers, seats: v.seats };
  }
}

// ================================================================ registre des salons
const rooms = new Map();
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(["API", "STATIC", "BOARDS", "SOCKET"]);
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L
const ROOM_IDLE_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 300;

const cleanCode = (c) => String(c || "").trim().toUpperCase();
const validCode = (c) => CODE_RE.test(c) && !RESERVED.has(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = "";
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !savedRooms[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms)
    if (r.sockets.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000);
// un salon connu du fichier de sauvegarde est recréé à la demande (après redémarrage du serveur)
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = new Room(code, savedRooms[code] || null);
  rooms.set(code, r);
  if (!savedRooms[code]) r.save();
  return r;
}

// ================================================================ HTTP
app.use(express.json({ limit: "100kb" }));
app.use("/static", express.static(PUBLIC, { setHeaders: (res) => res.set("Cache-Control", "no-cache") }));
const page = (name) => (req, res) => res.sendFile(path.join(PUBLIC, name));

app.get("/", page("index.html"));
app.get("/api/boards", (req, res) => res.json(listBoards()));
app.get("/api/rooms/:code", (req, res) => {
  const code = cleanCode(req.params.code);
  const r = validCode(code) ? getRoom(code, false) : null;
  res.set("Cache-Control", "no-store");
  res.json(r ? r.info() : { exists: false, code });
});
app.post("/api/rooms", (req, res) => {
  const a = req.body || {};
  const code = a.code ? cleanCode(a.code) : newCode();
  if (!validCode(code)) return res.json({ ok: false, error: "Code invalide : 3 à 10 lettres ou chiffres." });
  if (rooms.has(code) && !a.reuse) return res.json({ ok: false, error: `Le salon ${code} est déjà en cours d'utilisation.` });
  getRoom(code, true);
  res.json({ ok: true, code });
});

const codeOf = (req) => cleanCode(req.params[0]);
const ifValid = (file) => (req, res, next) => (validCode(codeOf(req)) ? res.sendFile(path.join(PUBLIC, file)) : next());
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur([1-8])\/?$/, ifValid("play.html"));
app.get(/^\/([A-Za-z0-9]{3,10})\/plateau\/?$/, ifValid("play.html"));
app.get(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/, ifValid("index.html"));
app.get(/^\/([A-Za-z0-9]{3,10})\/?$/, ifValid("host.html"));

// ================================================================ temps réel
io.on("connection", (socket) => {
  socket.on("joinRoom", (p, cb) => {
    try {
      const code = cleanCode(p && p.code);
      const room = validCode(code) ? getRoom(code, false) : null;
      if (!room) return cb({ ok: false, noroom: true, error: "Ce salon n'existe pas (ou plus)." });
      if (socket.data && socket.data.code) { const old = rooms.get(socket.data.code); if (old) old.leave(socket); }
      cb({ ok: true, ...room.join(socket, p.role, p.seat) });
    } catch (e) { cb({ ok: false, error: e.message }); }
  });
  socket.on("act", (a, cb) => {
    const reply = typeof cb === "function" ? cb : () => {};
    const room = socket.data && socket.data.code ? rooms.get(socket.data.code) : null;
    if (!room) return reply({ ok: false, noroom: true, error: "Ce salon n'existe plus." });
    try { room.act(socket, a || {}); reply({ ok: true }); }
    catch (e) { reply({ ok: false, error: e.message }); }
  });
  socket.on("disconnect", () => {
    const room = socket.data && socket.data.code ? rooms.get(socket.data.code) : null;
    if (room) room.leave(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  🎩 Monopoly est lancé !`);
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log("");
});
