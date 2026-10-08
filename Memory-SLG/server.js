// Memory-SLG — serveur de salons (Node.js, aucune dépendance)
// Lancement : node server.js  →  http://localhost:14500
// Chaque salon (code court, ex. K7QF) contient une partie de Memory complète et indépendante :
// ses images, ses joueurs, son plateau, son chronomètre.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 14500;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'donnees');
const SAVE_FILE = path.join(DATA_DIR, 'sauvegarde.json');

const MAX_SEATS = 8, MIN_IMAGES = 2, MAX_IMAGES = 100;
const MISS_MS = 3000;     // temps d'affichage de 2 cartes différentes avant de les recacher
const MATCH_MS = 600;     // petit délai avant de valider une paire (fin de l'animation de retournement)
const MAX_IMG_BYTES = 3 * 1024 * 1024;
const COLORS = [
  { id: 'bleu', nom: 'Bleu', hex: '#2f6bff' },
  { id: 'rouge', nom: 'Rouge', hex: '#ef4444' },
  { id: 'vert', nom: 'Vert', hex: '#16a34a' },
  { id: 'jaune', nom: 'Jaune', hex: '#eab308' },
  { id: 'violet', nom: 'Violet', hex: '#9333ea' },
  { id: 'orange', nom: 'Orange', hex: '#f97316' },
  { id: 'rose', nom: 'Rose', hex: '#ec4899' },
  { id: 'cyan', nom: 'Cyan', hex: '#06b6d4' },
];
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// ---------------------------------------------------------------- utilitaires
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

// ---------------------------------------------------------------- sauvegarde (réglages, noms et images de chaque salon)
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { }
let savedRooms = {};
try {
  const d = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  savedRooms = d && d.rooms && typeof d.rooms === 'object' ? d.rooms : {};
} catch { }
let saveTimer = null;
function flushSave() {
  try {
    const tmp = SAVE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ rooms: savedRooms }));
    fs.renameSync(tmp, SAVE_FILE);
  } catch (e) { console.log('Sauvegarde impossible :', e.message); }
}
const roomDir = code => path.join(DATA_DIR, code);
function removeRoomData(code) {
  delete savedRooms[code];
  try { fs.rmSync(roomDir(code), { recursive: true, force: true }); } catch { }
}
function saveRoom(code, data) {
  savedRooms[code] = { ...data, t: Date.now() };
  // on ne garde que les 100 salons les plus récents
  const keys = Object.keys(savedRooms).sort((a, b) => (savedRooms[b].t || 0) - (savedRooms[a].t || 0));
  for (const k of keys.slice(100)) removeRoomData(k);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}

// ================================================================ salons
function createRoom(code, saved, onDestroy) {
  const state = {
    phase: 'setup',               // setup | playing | over
    mode: 'multi',                // solo | multi
    nbJoueurs: 2,
    singleScreen: true,           // toute la partie se joue sur l'écran de l'arbitre
    names: Array(MAX_SEATS).fill(''),
    images: [],                   // { id, name, mime, file }
    gameId: 0,
    cards: [], totalPairs: 0, matches: 0,
    flipped: [], lock: null, lockUntil: 0,   // lock : null | 'match' | 'miss'
    current: 0, starter: 0, scores: Array(MAX_SEATS).fill(0),
    paused: false, elapsedBase: 0, runningSince: null,
    winners: [], flash: null, seq: 0,
  };
  let lockTimer = null;
  const nbActive = () => (state.mode === 'solo' ? 1 : state.nbJoueurs);
  const isSingle = () => state.singleScreen || state.mode === 'solo';
  const pname = i => state.names[i] || (state.mode === 'solo' ? 'Vous' : `Joueur ${i + 1}`);
  const flash = (text, kind = 'info') => { state.flash = { id: ++state.seq, text, kind }; };

  // ---------------------------------------------------------------- sauvegarde
  function save() {
    saveRoom(code, {
      mode: state.mode, nbJoueurs: state.nbJoueurs, singleScreen: state.singleScreen, names: state.names,
      images: state.images.map(({ id, name, mime, file }) => ({ id, name, mime, file })),
    });
  }
  if (saved) {
    if (saved.mode === 'solo' || saved.mode === 'multi') state.mode = saved.mode;
    if (saved.nbJoueurs) state.nbJoueurs = Math.max(2, Math.min(MAX_SEATS, saved.nbJoueurs | 0));
    if ('singleScreen' in saved) state.singleScreen = !!saved.singleScreen;
    if (Array.isArray(saved.names)) state.names = Array.from({ length: MAX_SEATS }, (_, i) => cleanName(saved.names[i]));
    if (Array.isArray(saved.images)) {
      state.images = saved.images.filter(x => x && x.id && x.file && MIME_EXT[x.mime] && fs.existsSync(path.join(roomDir(code), path.basename(x.file))))
        .map(x => ({ id: String(x.id), name: String(x.name || '').slice(0, 80), mime: x.mime, file: path.basename(x.file) }));
    }
  }

  // ---------------------------------------------------------------- chronomètre (côté serveur)
  const timerShouldRun = () => state.phase === 'playing' && !state.paused && state.lock !== 'miss';
  function syncTimer() {
    const now = Date.now();
    if (timerShouldRun()) { if (state.runningSince === null) state.runningSince = now; }
    else if (state.runningSince !== null) { state.elapsedBase += now - state.runningSince; state.runningSince = null; }
  }
  const elapsed = () => state.elapsedBase + (state.runningSince !== null ? Date.now() - state.runningSince : 0);

  // ---------------------------------------------------------------- images
  function addImages(list) {
    if (state.phase !== 'setup') throw new Error('Les images se changent avant le début de la partie');
    let added = 0, skipped = 0;
    fs.mkdirSync(roomDir(code), { recursive: true });
    for (const it of Array.isArray(list) ? list : []) {
      if (state.images.length >= MAX_IMAGES) { skipped++; continue; }
      const data = String((it && it.data) || '');
      const comma = data.indexOf(',');
      const m = comma > 0 && /^data:(image\/(?:jpeg|png|webp|gif));base64$/.exec(data.slice(0, comma));
      if (!m) { skipped++; continue; }
      const buf = Buffer.from(data.slice(comma + 1), 'base64');
      if (!buf.length || buf.length > MAX_IMG_BYTES) { skipped++; continue; }
      const id = crypto.randomBytes(5).toString('hex');
      const file = `${id}.${MIME_EXT[m[1]]}`;
      try { fs.writeFileSync(path.join(roomDir(code), file), buf); }
      catch (e) { throw new Error('Impossible d\'enregistrer les images sur le serveur'); }
      state.images.push({ id, name: String(it.name || '').slice(0, 80), mime: m[1], file });
      added++;
    }
    save();
    return { added, skipped };
  }
  function removeImage(id) {
    const i = state.images.findIndex(x => x.id === id);
    if (i < 0) return;
    const [x] = state.images.splice(i, 1);
    try { fs.unlinkSync(path.join(roomDir(code), x.file)); } catch { }
    save();
  }
  function readImage(id) {
    const x = state.images.find(i => i.id === id);
    if (!x) return null;
    try { return { mime: x.mime, buf: fs.readFileSync(path.join(roomDir(code), x.file)) }; } catch { return null; }
  }

  // ---------------------------------------------------------------- partie
  function clearLock() { clearTimeout(lockTimer); lockTimer = null; state.lock = null; state.lockUntil = 0; }
  function newGame() {
    clearLock();
    const n = nbActive();
    for (let i = 0; i < MAX_SEATS; i++) if (!state.names[i] && state.mode !== 'solo') { /* nom par défaut affiché, non enregistré */ }
    let deck = [];
    state.images.forEach(img => { deck.push(img.id); deck.push(img.id); });
    deck = shuffle(deck);
    Object.assign(state, {
      phase: 'playing', cards: deck.map(img => ({ img, st: 0, owner: null })),   // st : 0 cachée | 1 retournée | 2 trouvée
      totalPairs: state.images.length, matches: 0, flipped: [], paused: false,
      scores: Array(MAX_SEATS).fill(0), winners: [], elapsedBase: 0, runningSince: null,
      starter: n > 1 ? (Math.random() * n) | 0 : 0,
    });
    state.current = state.starter;
    state.gameId++;
    syncTimer();
    flash(n > 1 ? `C'est parti ! ${pname(state.current)} commence.` : 'C\'est parti !');
  }
  function endGame() {
    clearLock();
    state.phase = 'over';
    const n = nbActive(), best = Math.max(...state.scores.slice(0, n));
    state.winners = state.scores.slice(0, n).map((s, i) => (s === best ? i : -1)).filter(i => i >= 0);
    syncTimer();
    if (n === 1) flash('Bravo, toutes les paires sont trouvées !', 'win');
    else if (state.winners.length === 1) flash(`${pname(state.winners[0])} gagne la partie !`, 'win');
    else flash('Égalité !', 'win');
  }
  function afterFlip() {
    const gid = state.gameId, [x, y] = state.flipped, a = state.cards[x], b = state.cards[y];
    if (a.img === b.img) {
      state.lock = 'match';
      lockTimer = setTimeout(() => {
        if (state.gameId !== gid || state.phase !== 'playing') return;
        a.st = 2; b.st = 2; a.owner = state.current; b.owner = state.current;
        state.scores[state.current]++; state.matches++;
        state.flipped = []; clearLock();
        if (nbActive() > 1) flash(`${pname(state.current)} trouve une paire !`, 'ok');
        if (state.matches === state.totalPairs) endGame();
        syncTimer(); broadcast();
      }, MATCH_MS);
    } else {
      state.lock = 'miss'; state.lockUntil = Date.now() + MISS_MS;
      lockTimer = setTimeout(() => {
        if (state.gameId !== gid || state.phase !== 'playing') return;
        a.st = 0; b.st = 0; state.flipped = []; clearLock();
        if (nbActive() > 1) { state.current = (state.current + 1) % nbActive(); flash(`À ${pname(state.current)} de jouer`); }
        syncTimer(); broadcast();
      }, MISS_MS);
    }
    syncTimer();
  }

  // ---------------------------------------------------------------- actions
  function handle(who, a) {
    const isMaster = who === 'master';
    const mySeat = /^p[1-8]$/.test(who) ? +who.slice(1) - 1 : null;
    const need = (cond, msg) => { if (!cond) throw new Error(msg); };
    const masterOnly = () => need(isMaster, "Action réservée à l'arbitre");

    switch (a.type) {
      case 'config': {
        masterOnly(); need(state.phase === 'setup', 'Configuration impossible pendant une partie');
        if (a.mode === 'solo' || a.mode === 'multi') state.mode = a.mode;
        if (a.nbJoueurs) state.nbJoueurs = Math.max(2, Math.min(MAX_SEATS, a.nbJoueurs | 0));
        if ('singleScreen' in a) state.singleScreen = !!a.singleScreen;
        save(); break;
      }
      case 'name': {
        const seat = isMaster ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0 && seat < MAX_SEATS, 'Siège invalide');
        need(state.phase === 'setup', 'Les noms se changent avant le début de la partie');
        state.names[seat] = cleanName(a.name);
        save(); break;
      }
      case 'clearNames': {
        masterOnly(); need(state.phase === 'setup', 'Impossible pendant la partie');
        state.names = Array(MAX_SEATS).fill(''); save(); break;
      }
      case 'removeImage': { masterOnly(); need(state.phase === 'setup', 'Impossible pendant la partie'); removeImage(String(a.id)); break; }
      case 'clearImages': {
        masterOnly(); need(state.phase === 'setup', 'Impossible pendant la partie');
        for (const x of [...state.images]) removeImage(x.id);
        break;
      }
      case 'start': {
        masterOnly(); need(state.phase === 'setup', 'Partie déjà lancée');
        need(state.images.length >= MIN_IMAGES, `Charge au moins ${MIN_IMAGES} images`);
        newGame(); break;
      }
      case 'rematch': { masterOnly(); need(state.phase !== 'setup', 'Aucune partie'); newGame(); break; }
      case 'reset': {
        masterOnly(); clearLock();
        Object.assign(state, { phase: 'setup', cards: [], flipped: [], matches: 0, winners: [], paused: false, elapsedBase: 0, runningSince: null });
        state.gameId++;
        break;
      }
      case 'pause': {
        masterOnly(); need(state.phase === 'playing', "La partie n'est pas en cours");
        state.paused = 'paused' in a ? !!a.paused : !state.paused;
        syncTimer(); break;
      }
      case 'flip': {
        need(state.phase === 'playing', "La partie n'est pas en cours");
        need(!state.paused, 'La partie est en pause');
        if (!isMaster) {
          need(!isSingle(), "Cette partie se joue sur l'écran de l'arbitre");
          need(mySeat !== null && mySeat === state.current, "Ce n'est pas ton tour");
        }
        need(!state.lock, 'Patiente un instant…');
        const card = state.cards[a.index | 0];
        need(card && card.st === 0, 'Carte indisponible');
        card.st = 1; state.flipped.push(a.index | 0);
        if (state.flipped.length === 2) afterFlip();
        break;
      }
      default: throw new Error('Action inconnue');
    }
  }

  // ---------------------------------------------------------------- vues & diffusion
  const clients = new Set();
  const online = i => [...clients].some(c => c.who === 'p' + (i + 1));
  let lastActivity = Date.now();
  const touch = () => { lastActivity = Date.now(); };
  function view(who) {
    touch();
    const s = state, v = {
      room: code, you: who, phase: s.phase, mode: s.mode, nbJoueurs: s.nbJoueurs, nbActive: nbActive(),
      singleScreen: isSingle(), maxSeats: MAX_SEATS, minImages: MIN_IMAGES, maxImages: MAX_IMAGES,
      seats: Array.from({ length: MAX_SEATS }, (_, i) => ({ name: s.names[i], label: pname(i), color: COLORS[i].hex, colorName: COLORS[i].nom, online: online(i) })),
      images: s.images.map(x => ({ id: x.id, name: x.name })),
      gameId: s.gameId,
      cards: s.cards.map(c => ({ st: c.st, img: c.st ? c.img : null, owner: c.owner })),   // les cartes cachées ne révèlent jamais leur image
      current: s.current, scores: s.scores.slice(0, nbActive()), paused: s.paused, lock: s.lock,
      timer: { elapsed: elapsed(), running: s.runningSince !== null },
      winners: s.winners, pairs: s.totalPairs, matches: s.matches, flash: s.flash,
    };
    if (who === 'master') v.lanUrls = lanUrls();
    return v;
  }
  function send(c) { c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`); }
  function broadcast() { for (const c of clients) send(c); }

  function addClient(res, who, req) {
    const presence = () => Array.from({ length: MAX_SEATS }, (_, i) => online(i)).join();
    const before = presence();
    const c = { res, who };
    clients.add(c); touch();
    if (presence() !== before) broadcast(); else send(c);
    req.on('close', () => {
      const b = presence();
      clients.delete(c); touch();
      if (presence() !== b) broadcast();
    });
  }
  function act(who, a) { touch(); handle(who, a); broadcast(); }
  function destroy() { clearLock(); state.gameId++; }
  function info() {
    return {
      code, phase: state.phase, mode: state.mode, nbActive: nbActive(), singleScreen: isSingle(), nbImages: state.images.length,
      seats: Array.from({ length: nbActive() }, (_, i) => ({ name: state.names[i] || null, color: COLORS[i].hex, online: online(i) })),
    };
  }
  return { code, clients, addClient, act, destroy, info, addImages, readImage, idle: () => Date.now() - lastActivity, broadcast };
}

// ================================================================ registre des salons
const rooms = new Map();                     // code → salon
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'EVENTS', 'JOUEUR', 'MAITRE', 'ARBITRE', 'ACCUEIL', 'FAVICON', 'IMG']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';      // sans 0/O, 1/I/L pour éviter les confusions
const ROOM_IDLE_MS = 6 * 3600 * 1000;        // un salon sans page ouverte depuis 6 h est libéré de la mémoire (ses données restent sur disque)
const MAX_ROOMS = 300;

const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-8]$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !savedRooms[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms)
    if (r.clients.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000);
// un salon connu du fichier de sauvegarde est recréé à la demande (après un redémarrage, par exemple)
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !savedRooms[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code, savedRooms[code] || null);
  rooms.set(code, r);
  if (!savedRooms[code]) saveRoom(code, {});
  return r;
}
function destroyRoom(code) {
  const r = rooms.get(code);
  if (r) {
    for (const c of r.clients) { try { c.res.end(); } catch { } }
    r.destroy(); rooms.delete(code);
  }
  removeRoomData(code); flushSave();
}
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 15000);

// ================================================================ HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, res, limit, cb) {
  const chunks = []; let size = 0, dead = false;
  req.on('data', d => {
    if (dead) return;
    size += d.length;
    if (size > limit) { dead = true; json(res, { ok: false, error: 'Envoi trop volumineux' }, 413); req.destroy(); return; }
    chunks.push(d);
  });
  req.on('end', () => {
    if (dead) return;
    let a = {};
    try { a = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { }
    cb(a);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if (req.method === 'GET') {
    if (p === '/') return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.startsWith('/static/')) {
      const f = path.normalize(path.join(PUBLIC, p.slice(8)));
      if (!f.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
      return sendFile(res, f);
    }
    if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})\/img\/([a-f0-9]{10})$/))) {
      const code = cleanCode(m[1]), r = validCode(code) ? getRoom(code, false) : null;
      const img = r && r.readImage(m[2]);
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img.buf);
    }
    if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})$/))) {
      const code = cleanCode(m[1]);
      const r = validCode(code) ? getRoom(code, false) : null;
      return json(res, r ? { exists: true, ...r.info() } : { exists: false, code });
    }
    if (p === '/events') {
      const code = cleanCode(url.searchParams.get('room')), who = url.searchParams.get('who');
      if (who !== 'master' && !/^p[1-8]$/.test(who)) { res.writeHead(400); return res.end(); }
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) { res.writeHead(404); return res.end(); }
      // en-têtes adaptés aux hébergeurs derrière un proxy (Render…) : pas de mise en tampon ni de compression
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
      return r.addClient(res, who, req);
    }
    if (/^\/(joueur[1-8]|maitre|arbitre)\/?$/i.test(p)) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([1-8])\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'joueur.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'maitre.html'));
  }
  if (req.method === 'POST' && p === '/api/rooms') {
    return readBody(req, res, 1e4, a => {
      const code = a.code ? cleanCode(a.code) : newCode();
      if (!validCode(code)) return json(res, { ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
      if (rooms.has(code) && rooms.get(code).clients.size && !a.reuse) return json(res, { ok: false, error: `Le salon ${code} est déjà en cours d'utilisation` });
      getRoom(code, true);
      json(res, { ok: true, code });
    });
  }
  if (req.method === 'POST' && (m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})\/images$/))) {
    return readBody(req, res, 25e6, a => {
      const code = cleanCode(m[1]);
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) return json(res, { ok: false, error: "Ce salon n'existe plus.", noroom: true });
      if (a.who !== 'master') return json(res, { ok: false, error: "Action réservée à l'arbitre" });
      try { const out = r.addImages(a.images); r.broadcast(); json(res, { ok: true, ...out }); }
      catch (e) { json(res, { ok: false, error: e.message }); }
    });
  }
  if (req.method === 'POST' && p === '/api') {
    return readBody(req, res, 1e5, a => {
      const code = cleanCode(a.room);
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) return json(res, { ok: false, error: "Ce salon n'existe plus. Recharge la page.", noroom: true });
      try {
        if (a.type === 'destroy') {
          if (a.who !== 'master') throw new Error("Action réservée à l'arbitre");
          destroyRoom(code); return json(res, { ok: true });
        }
        r.act(a.who, a); json(res, { ok: true });
      } catch (e) { json(res, { ok: false, error: e.message }); }
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable');
});

process.on('SIGINT', () => { flushSave(); process.exit(0); });
process.on('SIGTERM', () => { flushSave(); process.exit(0); });
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Memory-SLG est lancé !`);
  console.log(`  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
