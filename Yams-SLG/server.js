// Yam's — serveur de jeu avec salons (Node.js, aucune dépendance)
// Lancement : node server.js  ->  http://localhost:11200
// Chaque salon (code court, ex. K7QF) contient une partie complète et indépendante.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 11200;       // Render fournit son propre port via PORT
const MAX_PLAYERS = 8;
const ROLL_MS = 1500;                          // durée de l'animation de lancer
const PUBLIC = path.join(__dirname, 'public');
const SAVE_FILE = path.join(__dirname, 'sauvegarde.json');

/* ===================================================== règles du jeu */
const UPPER = [1, 2, 3, 4, 5, 6];
const LOWER = ['brelan', 'carre', 'full', 'petiteSuite', 'grandeSuite', 'yam', 'somme'];
const ALL_KEYS = [...UPPER, ...LOWER];
const BASE = { full: 25, petiteSuite: 30, grandeSuite: 40, yam: 50 };
const DOUBLABLE = Object.keys(BASE);

const emptyCard = () => Object.fromEntries(ALL_KEYS.map(k => [k, null]));
const cardFull = c => ALL_KEYS.every(k => c[k] !== null);
const upperSub = c => UPPER.reduce((s, k) => s + (c[k] || 0), 0);
const upperBonus = c => (upperSub(c) >= 63 ? 35 : 0);
const lowerSum = c => LOWER.reduce((s, k) => s + (c[k] || 0), 0);
const perfectBonus = (c, ps) => (ps && cardFull(c) && !ALL_KEYS.some(k => c[k] === 0) ? 10 : 0);
const totals = (c, ps) => {
  const sub = upperSub(c), bonus = upperBonus(c), low = lowerSum(c), perfect = perfectBonus(c, ps);
  return { sub, bonus, upperTotal: sub + bonus, lower: low, pre: sub + bonus + low, perfect, total: sub + bonus + low + perfect };
};

function calcScore(key, dice, rollCount, ps) {
  const counts = {};
  dice.forEach(d => (counts[d] = (counts[d] || 0) + 1));
  const vals = Object.values(counts);
  const sum = dice.reduce((a, b) => a + b, 0);
  const sorted = [...dice].sort((a, b) => a - b).join('');
  let base = 0;
  if (typeof key === 'number') return dice.filter(d => d === key).reduce((a, b) => a + b, 0);
  switch (key) {
    case 'brelan': return vals.some(c => c >= 3) ? sum : 0;
    case 'carre': return vals.some(c => c >= 4) ? sum : 0;
    case 'somme': return sum;
    case 'full': base = vals.length === 2 && vals.includes(3) ? 25 : 0; break;
    case 'petiteSuite': base = sorted === '12345' ? 30 : 0; break;
    case 'grandeSuite': base = sorted === '23456' ? 40 : 0; break;
    case 'yam': base = vals.includes(5) ? 50 : 0; break;
  }
  return ps && base > 0 && rollCount === 1 ? base * 2 : base;
}
function validScore(key, v, ps) {
  if (!Number.isInteger(v) || v < 0) return false;
  if (typeof key === 'number') return [0, 1, 2, 3, 4, 5].map(n => n * key).includes(v);
  if (DOUBLABLE.includes(key)) return (ps ? [0, BASE[key], BASE[key] * 2] : [0, BASE[key]]).includes(v);
  return v === 0 || (v >= 5 && v <= 30);
}
function hint(key, ps) {
  if (typeof key === 'number') return 'Valeurs possibles : ' + [0, 1, 2, 3, 4, 5].map(n => n * key).join(', ');
  if (DOUBLABLE.includes(key)) return ps ? `Valeurs possibles : 0, ${BASE[key]} ou ${BASE[key] * 2} (avec Points sup.)` : `Valeurs possibles : 0 ou ${BASE[key]}`;
  return 'Valeur possible : 0, ou un total entre 5 et 30';
}
const isDoubled = (key, v, ps) => !!ps && DOUBLABLE.includes(key) && v === BASE[key] * 2;

/* ===================================================== sauvegarde */
let saved = {};
try { saved = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8')).rooms || {}; } catch { }
let saveTimer = null;
function persist(code, data) {
  saved[code] = { ...data, t: Date.now() };
  const keys = Object.keys(saved).sort((a, b) => (saved[b].t || 0) - (saved[a].t || 0));
  for (const k of keys.slice(100)) delete saved[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SAVE_FILE, JSON.stringify({ rooms: saved }), () => { }), 400);
}
function lanUrls() {
  const out = [];
  for (const l of Object.values(os.networkInterfaces()))
    for (const i of l || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

/* ===================================================== un salon */
function createRoom(code, snap) {
  const s = {
    phase: 'setup',             // setup | playing | over
    mode: 'classic',            // classic (dés sur écran) | sheet (tableau à saisir)
    pointsSup: false,
    nbJoueurs: 2,
    seats: Array(MAX_PLAYERS).fill(null),   // { name }
    roster: [],                 // noms habituels
    hof: [],                    // palmarès du salon { name, score, pointsSup }
    players: [],                // { name, card, doubled }
    current: 0, starter: 0,
    dice: [1, 1, 1, 1, 1], held: [false, false, false, false, false],
    rollCount: 0, locked: false, rolling: false,
    gameId: 0, log: [], flash: null, seq: 0,
  };
  const clients = new Set();
  let lastActivity = Date.now(), rollTimer = null;
  const touch = () => (lastActivity = Date.now());
  const need = (c, m) => { if (!c) throw new Error(m); };
  const log = t => { s.log.unshift({ t: Date.now(), text: t }); s.log.length = Math.min(s.log.length, 30); };
  const flash = (text, kind = 'info') => { s.flash = { id: ++s.seq, text, kind }; };
  const nb = () => s.nbJoueurs;
  const online = i => [...clients].some(c => c.who === 'p' + (i + 1));

  function save() {
    persist(code, {
      phase: s.phase, mode: s.mode, pointsSup: s.pointsSup, nbJoueurs: s.nbJoueurs, seats: s.seats, roster: s.roster, hof: s.hof,
      players: s.players, current: s.current, starter: s.starter, dice: s.dice, held: s.held, rollCount: s.rollCount, locked: s.locked,
    });
  }
  if (snap) {
    Object.assign(s, {
      phase: ['setup', 'playing', 'over'].includes(snap.phase) ? snap.phase : 'setup',
      mode: snap.mode === 'sheet' ? 'sheet' : 'classic', pointsSup: !!snap.pointsSup,
      nbJoueurs: Math.max(1, Math.min(MAX_PLAYERS, snap.nbJoueurs | 0 || 2)),
      seats: Array.isArray(snap.seats) ? snap.seats.slice(0, MAX_PLAYERS) : s.seats,
      roster: Array.isArray(snap.roster) ? snap.roster.slice(0, 30) : [], hof: Array.isArray(snap.hof) ? snap.hof.slice(0, 200) : [],
      players: Array.isArray(snap.players) ? snap.players : [], current: snap.current | 0, starter: snap.starter | 0,
      dice: Array.isArray(snap.dice) ? snap.dice : s.dice, held: Array.isArray(snap.held) ? snap.held : s.held,
      rollCount: snap.rollCount | 0, locked: !!snap.locked,
    });
    while (s.seats.length < MAX_PLAYERS) s.seats.push(null);
  }

  function nextTurn() {
    if (s.players.every(p => cardFull(p.card))) return endGame();
    let n = s.current;
    do n = (n + 1) % s.players.length; while (cardFull(s.players[n].card));
    s.current = n;
    s.dice = [1, 1, 1, 1, 1]; s.held = [false, false, false, false, false]; s.rollCount = 0; s.locked = false;
    log(`Au tour de ${s.players[n].name}`);
  }
  function endGame() {
    s.phase = 'over';
    for (const p of s.players) s.hof.push({ name: p.name, score: totals(p.card, s.pointsSup).total, pointsSup: s.pointsSup, date: Date.now() });
    s.hof.sort((a, b) => b.score - a.score); s.hof.length = Math.min(s.hof.length, 200);
    const best = [...s.players].sort((a, b) => totals(b.card, s.pointsSup).total - totals(a.card, s.pointsSup).total)[0];
    flash(`Partie terminée — ${best.name} l'emporte !`, 'ok'); log('Partie terminée');
  }
  function newGame(rematch) {
    const seated = s.seats.slice(0, nb());
    s.players = seated.map(x => ({ name: x.name, card: emptyCard(), doubled: {} }));
    s.starter = rematch ? (s.starter + 1) % nb() : 0;
    Object.assign(s, { phase: 'playing', current: s.starter, dice: [1, 1, 1, 1, 1], held: [false, false, false, false, false], rollCount: 0, locked: false, rolling: false, log: [] });
    s.gameId++;
    log(`Nouvelle partie — ${s.players[s.current].name} commence`);
    flash(`C'est parti ! ${s.players[s.current].name} commence.`);
  }

  function handle(who, a) {
    const master = who === 'master';
    const mySeat = /^p[1-8]$/.test(who) ? +who.slice(1) - 1 : null;
    const playing = () => need(s.phase === 'playing', "La partie n'est pas en cours");
    const myTurn = () => { playing(); need(master || mySeat === s.current, "Ce n'est pas ton tour"); need(!s.rolling, 'Les dés roulent…'); };
    const masterOnly = () => need(master, "Action réservée à l'arbitre");

    switch (a.type) {
      case 'config': {
        masterOnly(); need(s.phase === 'setup', 'Configuration impossible pendant une partie');
        if (a.mode === 'classic' || a.mode === 'sheet') s.mode = a.mode;
        if ('pointsSup' in a) s.pointsSup = !!a.pointsSup;
        if (a.nbJoueurs) s.nbJoueurs = Math.max(1, Math.min(MAX_PLAYERS, a.nbJoueurs | 0));
        break;
      }
      case 'register': {
        const seat = master ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0 && seat < MAX_PLAYERS, 'Siège invalide');
        need(s.phase === 'setup', 'Les inscriptions sont fermées pendant la partie');
        const name = String(a.name || '').trim().slice(0, 20);
        need(name, 'Indique un nom');
        s.seats[seat] = { name };
        break;
      }
      case 'unregister': {
        const seat = master ? a.seat | 0 : mySeat;
        need(seat !== null && seat >= 0, 'Siège invalide'); need(s.phase === 'setup', 'Impossible pendant la partie');
        s.seats[seat] = null; break;
      }
      case 'clearSeats': { masterOnly(); need(s.phase === 'setup', 'Impossible pendant la partie'); s.seats = Array(MAX_PLAYERS).fill(null); break; }
      case 'forget': { masterOnly(); s.roster = s.roster.filter(n => n.toLowerCase() !== String(a.name || '').toLowerCase()); break; }
      case 'start': {
        masterOnly(); need(s.phase === 'setup', 'Partie déjà lancée');
        for (let i = 0; i < nb(); i++) need(s.seats[i], `Le joueur ${i + 1} n'est pas inscrit`);
        for (let i = nb() - 1; i >= 0; i--) { const n = s.seats[i].name; s.roster = [n, ...s.roster.filter(x => x.toLowerCase() !== n.toLowerCase())].slice(0, 30); }
        newGame(false); break;
      }
      case 'rematch': { masterOnly(); need(s.phase !== 'setup', 'Aucune partie'); newGame(true); break; }
      case 'reset': { masterOnly(); s.gameId++; clearTimeout(rollTimer); Object.assign(s, { phase: 'setup', players: [], rolling: false, rollCount: 0, locked: false }); break; }
      case 'resetHof': { masterOnly(); s.hof = []; break; }

      // --- jeu avec dés (mode classic)
      case 'roll': {
        myTurn(); need(s.mode === 'classic', 'Pas de dés dans ce mode');
        need(s.rollCount < 3 && !s.locked, 'Plus de lancer disponible');
        s.rolling = true;
        const gid = s.gameId;
        clearTimeout(rollTimer);
        rollTimer = setTimeout(() => {
          if (s.gameId !== gid || !s.rolling) return;
          s.dice = s.dice.map((v, i) => (s.held[i] ? v : 1 + ((Math.random() * 6) | 0)));
          s.rollCount++; s.rolling = false;
          if (s.rollCount >= 3) s.locked = true;
          touch(); save(); broadcast();
        }, ROLL_MS);
        break;
      }
      case 'hold': {
        myTurn(); need(s.mode === 'classic' && s.rollCount >= 1 && !s.locked, 'Tu ne peux pas conserver de dé maintenant');
        const i = a.index | 0; need(i >= 0 && i < 5, 'Dé invalide');
        s.held[i] = !s.held[i]; break;
      }
      case 'stop': { myTurn(); need(s.mode === 'classic' && s.rollCount >= 1, 'Lance d\'abord les dés'); s.locked = true; break; }
      case 'select': {
        myTurn(); need(s.mode === 'classic' && s.rollCount >= 1, 'Lance d\'abord les dés');
        const key = ALL_KEYS.find(k => String(k) === String(a.key)); need(key !== undefined, 'Ligne invalide');
        const p = s.players[s.current]; need(p.card[key] === null, 'Ligne déjà remplie');
        const score = calcScore(key, s.dice, s.rollCount, s.pointsSup);
        p.card[key] = score; p.doubled[key] = isDoubled(key, score, s.pointsSup) && s.rollCount === 1;
        log(`${p.name} : ${score} pts en ${labelOf(key)}`);
        nextTurn(); break;
      }
      // --- mode tableau : saisie vérifiée
      case 'enter': {
        myTurn(); need(s.mode === 'sheet', 'Saisie réservée au mode Tableau');
        const key = ALL_KEYS.find(k => String(k) === String(a.key)); need(key !== undefined, 'Ligne invalide');
        const v = parseInt(a.value, 10); const p = s.players[s.current];
        need(p.card[key] === null, 'Ligne déjà remplie');
        need(validScore(key, v, s.pointsSup), `Score impossible pour cette ligne. ${hint(key, s.pointsSup)}.`);
        p.card[key] = v; p.doubled[key] = isDoubled(key, v, s.pointsSup);
        log(`${p.name} : ${v} pts en ${labelOf(key)}`);
        nextTurn(); break;
      }
      // --- correction d'une ligne (arbitre, ou joueur pour sa propre colonne)
      case 'edit': {
        need(s.phase === 'playing' || s.phase === 'over', 'Aucune partie');
        const pi = a.player | 0; need(s.players[pi], 'Joueur invalide');
        need(master || mySeat === pi, 'Tu ne peux corriger que ta propre colonne');
        const key = ALL_KEYS.find(k => String(k) === String(a.key)); need(key !== undefined, 'Ligne invalide');
        const p = s.players[pi]; need(p.card[key] !== null, 'Ligne non remplie');
        const v = parseInt(a.value, 10);
        need(validScore(key, v, s.pointsSup), `Score impossible pour cette ligne. ${hint(key, s.pointsSup)}.`);
        p.card[key] = v; p.doubled[key] = isDoubled(key, v, s.pointsSup);
        log(`Correction : ${p.name}, ${labelOf(key)} = ${v}`);
        break;
      }
      case 'skip': { masterOnly(); playing(); need(!s.rolling, 'Attends la fin du lancer'); nextTurn(); break; }
      default: throw new Error('Action inconnue');
    }
  }
  const LABELS = { brelan: 'Brelan', carre: 'Carré', full: 'Full', petiteSuite: 'Petite suite', grandeSuite: 'Grande suite', yam: 'Yam', somme: 'Chance' };
  const labelOf = k => (typeof k === 'number' ? `les ${k}` : LABELS[k]);

  function view(who) {
    touch();
    const mySeat = /^p[1-8]$/.test(who) ? +who.slice(1) - 1 : null;
    const cur = s.players[s.current];
    const previews = {};
    if (s.phase === 'playing' && s.mode === 'classic' && s.rollCount >= 1 && !s.rolling && cur)
      for (const k of ALL_KEYS) if (cur.card[k] === null) {
        const sc = calcScore(k, s.dice, s.rollCount, s.pointsSup);
        previews[k] = { score: sc, doubled: isDoubled(k, sc, s.pointsSup) && s.rollCount === 1 };
      }
    return {
      room: code, you: who, mySeat, phase: s.phase, mode: s.mode, pointsSup: s.pointsSup, nbJoueurs: nb(),
      seats: s.seats.map((x, i) => ({ name: x ? x.name : null, online: online(i) })),
      roster: s.roster, hof: s.hof,
      players: s.players.map(p => ({ name: p.name, card: p.card, doubled: p.doubled, t: totals(p.card, s.pointsSup) })),
      current: s.current, dice: s.dice, held: s.held, rollCount: s.rollCount, locked: s.locked, rolling: s.rolling, gameId: s.gameId,
      previews, hints: Object.fromEntries(ALL_KEYS.map(k => [k, hint(k, s.pointsSup)])),
      log: s.log.slice(0, 15), flash: s.flash, lanUrls: who === 'master' ? lanUrls() : undefined,
    };
  }
  const send = c => c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`);
  function broadcast() { for (const c of clients) send(c); }

  return {
    code, clients,
    addClient(res, who, req) {
      const presence = () => s.seats.map((_, i) => online(i)).join();
      const before = presence();
      const c = { res, who }; clients.add(c); touch();
      if (presence() !== before) broadcast(); else send(c);
      req.on('close', () => { const b = presence(); clients.delete(c); touch(); if (presence() !== b) broadcast(); });
    },
    act(who, a) { touch(); handle(who, a); save(); broadcast(); },
    destroy() { clearTimeout(rollTimer); s.gameId++; },
    idle: () => Date.now() - lastActivity,
    info() {
      return { code, phase: s.phase, mode: s.mode, nbJoueurs: nb(), pointsSup: s.pointsSup,
        seats: s.seats.slice(0, nb()).map((x, i) => ({ name: x ? x.name : null, online: online(i) })) };
    },
  };
}

/* ===================================================== registre des salons */
const rooms = new Map();
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'EVENTS', 'ACCUEIL', 'FAVICON']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_IDLE_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 300;
const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-8]$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && !saved[c] && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms) if (r.clients.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000);
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create && !saved[code]) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code, saved[code] || null);
  rooms.set(code, r);
  if (!saved[code]) persist(code, {});
  return r;
}
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 15000);

/* ===================================================== HTTP */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
const json = (res, obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => { let a = {}; try { a = JSON.parse(body || '{}'); } catch { } cb(a); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  let m;
  if (req.method === 'GET') {
    if (p === '/') return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p.startsWith('/static/')) {
      const f = path.normalize(path.join(PUBLIC, p.slice(8)));
      if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      return sendFile(res, f);
    }
    if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})$/))) {
      const code = cleanCode(m[1]), r = validCode(code) ? getRoom(code, false) : null;
      return json(res, r ? { exists: true, ...r.info() } : { exists: false, code });
    }
    if (p === '/events') {
      const code = cleanCode(url.searchParams.get('room')), who = url.searchParams.get('who');
      if (who !== 'master' && !/^p[1-8]$/.test(who)) { res.writeHead(400); return res.end(); }
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
      return r.addClient(res, who, req);
    }
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([1-8])\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'salon.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/?$/)) && validCode(cleanCode(m[1]))) return sendFile(res, path.join(PUBLIC, 'salon.html'));
  }
  if (req.method === 'POST' && p === '/api/rooms') {
    return readBody(req, a => {
      const code = a.code ? cleanCode(a.code) : newCode();
      if (!validCode(code)) return json(res, { ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
      if (rooms.has(code) && !a.reuse) return json(res, { ok: false, error: `Le salon ${code} est déjà en cours d'utilisation` });
      getRoom(code, true);
      json(res, { ok: true, code });
    });
  }
  if (req.method === 'POST' && p === '/api') {
    return readBody(req, a => {
      const code = cleanCode(a.room), r = validCode(code) ? getRoom(code, false) : null;
      if (!r) return json(res, { ok: false, error: "Ce salon n'existe plus. Recharge la page.", noroom: true });
      try { r.act(a.who, a); json(res, { ok: true }); } catch (e) { json(res, { ok: false, error: e.message }); }
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Yam's est lancé !  Accueil (créer ou rejoindre un salon) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local : ${u}/`);
  console.log('');
});
