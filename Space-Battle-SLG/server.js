// Space-Battle-SLG — bataille navale spatiale à 2 joueurs (Node.js, aucune dépendance)
// Lancement : node server.js  →  http://localhost:19500
const http = require('http');
const fs = require('fs');
const AI = require('./ai');
const Fleet = require('./public/fleet.js');   // catalogue des vaisseaux + règles de placement (partagé avec les pages)
const path = require('path');
const os = require('os');

const PORT = +process.env.PORT || 19500;
const N = 10;                                   // grille 10 x 10
const AI_SPEED = +process.env.AI_SPEED || 1;     // >1 = IA plus rapide (tests)
const MODES = ['single', 'chain', 'salvo'];     // 1 tir / tour · rejoue si touché · salve de 3 à 5 tirs
const PUBLIC = path.join(__dirname, 'public');
const LET = 'ABCDEFGHIJ';
const label = i => LET[i % N] + (Math.floor(i / N) + 1);
const cleanName = (s, def) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 20) || def;

// ================================================================ un salon = une partie indépendante
function createRoom(code) {
  const clients = new Set();
  let lastActivity = Date.now();
  const blank = () => ({ ships: [], shots: Array(N * N).fill(0) });   // shots : 0 rien · 1 raté · 2 touché (tirs REÇUS)

  const S = {
    phase: 'setup',                             // setup → placement → battle → over
    names: ['Joueur 1', 'Joueur 2'],
    mode: 'single', salvo: 3,
    fleet: [...Fleet.DEFAULT_FLEET],            // vaisseaux à placer (choisis par le maître, communs aux 2 joueurs)
    ai: [null, null],                           // par siège : null (humain) ou 'debutant' | 'avance' | 'expert'
    round: 1, score: [0, 0],
    starter: (Math.random() * 2) | 0, turn: 0, winner: null,
    ready: [false, false], rematch: [false, false],
    boards: [blank(), blank()],
    last: null, seq: 0, log: [],
  };

  const isSunk = (b, s) => s.cells.every(i => b.shots[i] === 2);
  const pubShip = (b, s) => ({ id: s.id, name: s.name, color: s.color, size: s.size, cells: s.cells, sunk: isSunk(b, s) });
  const online = i => !!S.ai[i] || [...clients].some(c => c.who === 'p' + (i + 1));   // une IA est toujours "connectée"
  const pushLog = t => { S.log.push(t); if (S.log.length > 40) S.log.shift(); };

  // ---- ce que chaque page a le droit de voir
  function boardPub(i, reveal) {
    const b = S.boards[i];
    return {
      shots: b.shots,
      remaining: b.ships.filter(s => !isSunk(b, s)).length,
      total: b.ships.length,
      sunk: b.ships.filter(s => isSunk(b, s)).map(s => pubShip(b, s)),
      ships: reveal ? b.ships.map(s => pubShip(b, s)) : undefined,
    };
  }
  function view(who) {
    const you = who === 'p1' ? 0 : who === 'p2' ? 1 : -1;
    const over = S.phase === 'over';
    const v = {
      room: code, you, phase: S.phase, names: S.names, mode: S.mode, salvo: S.salvo, ai: S.ai, fleet: S.fleet,
      round: S.round, score: S.score, turn: S.turn, winner: S.winner, ready: S.ready, rematch: S.rematch,
      online: [online(0), online(1)], masterOnline: [...clients].some(c => c.who === 'master'),
      last: S.last, log: S.log.slice(-14),
    };
    if (you >= 0) {
      v.mine = boardPub(you, true);              // sa propre flotte
      v.foe = boardPub(1 - you, over);           // la flotte adverse n'est révélée qu'à la fin
    } else {
      v.boards = [boardPub(0, over), boardPub(1, over)];
    }
    return v;
  }
  function send(c) { c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`); }
  function broadcast() { for (const c of clients) send(c); }

  // ---- règles
  function startPlacement() {
    S.boards = [blank(), blank()];
    S.ready = [false, false]; S.rematch = [false, false];
    S.winner = null; S.last = null; S.log = [];
    S.phase = 'placement';
    pushLog(`Placez vos ${S.fleet.length} vaisseaux sur la grille (sans qu'ils se touchent).`);
  }
  // placement envoyé par un joueur : [{id, rot, r, c}] → vérifié par les règles communes (grille, superposition, contact)
  function parseFleet(list) {
    return Fleet.validate(list, S.fleet).map(v => {
      const t = Fleet.byId(v.id);
      return { id: v.id, name: t.name, color: t.color, size: v.cells.length, cells: v.cells };
    });
  }

  function fire(p, a) {
    if (S.phase !== 'battle') throw new Error("La bataille n'est pas en cours");
    if (S.turn !== p) throw new Error("Ce n'est pas ton tour");
    const foe = 1 - p, B = S.boards[foe];
    const raw = Array.isArray(a.cells) ? a.cells : [];
    const idxs = [];
    for (const rc of raw) {
      const r = rc && rc[0], c = rc && rc[1];
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= N || c < 0 || c >= N) throw new Error('Cible invalide');
      const i = r * N + c;
      if (B.shots[i] !== 0) throw new Error(`${label(i)} a déjà été visé`);
      if (idxs.includes(i)) throw new Error('Cibles en double');
      idxs.push(i);
    }
    const free = B.shots.filter(v => v === 0).length;
    const need = S.mode === 'salvo' ? Math.min(S.salvo, free) : 1;
    if (idxs.length !== need) throw new Error(need > 1 ? `Choisis exactement ${need} cibles` : 'Choisis une cible');

    const volley = [];
    for (const i of idxs) {
      const ship = B.ships.find(s => s.cells.includes(i));
      B.shots[i] = ship ? 2 : 1;
      volley.push({ i, hit: !!ship, sunk: ship && isSunk(B, ship) ? ship.name : null });
    }
    const name = S.names[p];
    const won = B.ships.every(s => isSunk(B, s));
    const again = !won && S.mode === 'chain' && volley[0].hit;

    // journal
    if (S.mode === 'salvo') {
      const hits = volley.filter(v => v.hit).length;
      pushLog(`${name} lance une salve de ${volley.length} tirs : ${hits} touché${hits > 1 ? 's' : ''}, ${volley.length - hits} dans le vide.`);
      for (const v of volley) if (v.sunk) pushLog(`💥 ${v.sunk} de ${S.names[foe]} est détruit !`);
    } else {
      const v = volley[0];
      pushLog(`${name} tire en ${label(v.i)} : ${v.sunk ? `touché-coulé, ${v.sunk} détruit !` : v.hit ? 'touché !' : 'dans le vide.'}${again ? ' Il rejoue.' : ''}`);
    }
    S.last = { by: p, shots: volley, again, seq: ++S.seq };
    if (won) {
      S.phase = 'over'; S.winner = p; S.score[p]++;
      pushLog(`🏆 ${name} détruit toute la flotte adverse et remporte la bataille !`);
    } else if (!again) S.turn = foe;
  }

  function player(p, a) {
    switch (a.type) {
      case 'place': {
        if (S.phase !== 'placement' || S.ready[p]) throw new Error('Placement impossible maintenant');
        S.boards[p].ships = parseFleet(a.ships);
        S.ready[p] = true;
        if (S.ready[0] && S.ready[1]) {
          S.phase = 'battle'; S.turn = S.starter;
          pushLog(`La bataille commence ! ${S.names[S.turn]} ouvre le feu.`);
        }
        return;
      }
      case 'unready':
        if (S.phase === 'placement' && S.ready[p]) { S.ready[p] = false; S.boards[p].ships = []; }
        return;
      case 'fire': return fire(p, a);
      case 'rematch':
        if (S.phase !== 'over') throw new Error('La partie n\'est pas terminée');
        S.rematch[p] = true;
        if (S.rematch[0] && S.rematch[1]) doRematch();
        return;
      default: throw new Error('Action inconnue');
    }
  }
  function doRematch() {
    S.round++;
    S.starter = 1 - S.winner;                    // le perdant ouvre le feu
    startPlacement();
  }
  function master(a) {
    switch (a.type) {
      case 'config':
        if (S.phase !== 'setup') throw new Error('La partie a déjà commencé');
        if (Array.isArray(a.names)) S.names = [0, 1].map(i => cleanName(a.names[i], `Joueur ${i + 1}`));
        if (MODES.includes(a.mode)) S.mode = a.mode;
        if (a.salvo != null) S.salvo = Math.max(3, Math.min(5, +a.salvo | 0 || 3));
        if (Array.isArray(a.ai)) S.ai = [0, 1].map(i => AI.LEVELS.includes(a.ai[i]) ? a.ai[i] : null);
        if (Array.isArray(a.fleet)) {
          const ids = Fleet.CATALOG.map(t => t.id).filter(id => a.fleet.includes(id));   // ordre du catalogue, sans doublon
          if (!ids.length) throw new Error('Choisis au moins un vaisseau');
          const cells = ids.reduce((n, id) => n + Fleet.byId(id).cells.length, 0);
          if (cells > Fleet.MAX_CELLS) throw new Error(`Flotte trop grande (${cells} cases, maximum ${Fleet.MAX_CELLS}) : les vaisseaux ne pourraient pas tous tenir sans se toucher`);
          if (ids.join() !== S.fleet.join() && !Fleet.randomPlacement(ids, 150)) throw new Error('Cette flotte ne tient pas sur la grille sans que les vaisseaux se touchent');
          S.fleet = ids;
        }
        return;
      case 'start':
        if (S.phase !== 'setup') throw new Error('La partie a déjà commencé');
        if (S.names[0].toLowerCase() === S.names[1].toLowerCase()) throw new Error('Les deux joueurs doivent avoir des noms différents');
        return startPlacement();
      case 'setup':                              // retour aux réglages (nouvelle partie, scores remis à zéro)
        S.phase = 'setup'; S.round = 1; S.score = [0, 0]; S.boards = [blank(), blank()];
        S.ready = [false, false]; S.rematch = [false, false]; S.winner = null; S.last = null; S.log = [];
        S.starter = (Math.random() * 2) | 0;
        return;
      case 'rematch':
        if (S.phase !== 'over') throw new Error('La partie n\'est pas terminée');
        return doRematch();
      default: throw new Error('Action inconnue');
    }
  }
  function handle(who, a) {
    if (who === 'master') return master(a);
    if (who === 'p1' || who === 'p2') return player(who === 'p1' ? 0 : 1, a);
    throw new Error('Rôle inconnu');
  }

  // ---- joueurs IA : ils agissent après un court délai, comme un humain qui réfléchit
  let aiTimer = null;
  const humans = () => S.ai.filter(x => !x).length;
  function aiKick() {
    clearTimeout(aiTimer);
    const run = (ms, fn) => { aiTimer = setTimeout(() => { try { fn(); broadcast(); } catch (e) { return console.error('IA :', e.message); } aiKick(); }, ms / AI_SPEED); };
    if (S.phase === 'placement') {
      const p = [0, 1].find(i => S.ai[i] && !S.ready[i]);
      if (p !== undefined) run(700, () => { if (S.phase === 'placement' && !S.ready[p]) player(p, { type: 'place', ships: AI.placeFleet(S.ai[p], S.fleet) }); });
    } else if (S.phase === 'battle' && S.ai[S.turn]) {
      run(S.mode === 'salvo' ? 1800 : 1100 + Math.random() * 600, () => {
        const p = S.turn, B = S.boards[1 - p];
        if (S.phase !== 'battle' || !S.ai[p]) return;
        const free = B.shots.filter(v => v === 0).length;
        const n = S.mode === 'salvo' ? Math.min(S.salvo, free) : 1;
        const sunk = B.ships.filter(sh => isSunk(B, sh));
        const k = { shots: B.shots, sunk: sunk.map(sh => ({ cells: sh.cells })), remaining: B.ships.filter(sh => !isSunk(B, sh)).map(sh => sh.id) };
        const cells = AI.chooseShots(S.ai[p], k, n).map(i => [Math.floor(i / N), i % N]);
        player(p, { type: 'fire', cells });
      });
    } else if (S.phase === 'over' && humans() > 0) {   // l'IA accepte toujours la revanche
      const p = [0, 1].find(i => S.ai[i] && !S.rematch[i]);
      if (p !== undefined) run(1500, () => { if (S.phase === 'over') player(p, { type: 'rematch' }); });
    }
  }

  // ---- API du salon
  return {
    code, clients,
    addClient(res, who, req) {
      const c = { res, who };
      const presence = () => online(0) + '' + online(1) + [...clients].some(x => x.who === 'master');
      const before = presence();
      clients.add(c); lastActivity = Date.now();
      if (presence() !== before) broadcast(); else send(c);
      req.on('close', () => {
        const b = presence();
        clients.delete(c); lastActivity = Date.now();
        if (presence() !== b) broadcast();
      });
    },
    act(who, a) { lastActivity = Date.now(); handle(who, a); broadcast(); aiKick(); },
    destroy() { clearTimeout(aiTimer); },
    info() {
      return { code, phase: S.phase, mode: S.mode, names: S.names, ai: S.ai, fleet: S.fleet, online: [online(0), online(1)], round: S.round };
    },
    idle: () => Date.now() - lastActivity,
  };
}

// ================================================================ registre des salons
const rooms = new Map();
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'EVENTS', 'MAITRE', 'FAVICON']);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';     // sans 0/O ni 1/I/L
const ROOM_IDLE_MS = 6 * 3600 * 1000;
const MAX_ROOMS = 300;
const cleanCode = c => String(c || '').trim().toUpperCase();
const validCode = c => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d$/.test(c);
function newCode() {
  for (let len = 4; ; len++)
    for (let i = 0; i < 50; i++) {
      let c = '';
      for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
      if (!rooms.has(c) && validCode(c)) return c;
    }
}
function purge(force) {
  for (const [code, r] of rooms) if (r.clients.size === 0 && (force || r.idle() > ROOM_IDLE_MS)) { r.destroy(); rooms.delete(code); }
}
setInterval(() => purge(false), 10 * 60 * 1000);
function getRoom(code, create) {
  if (rooms.has(code)) return rooms.get(code);
  if (!create) return null;
  if (rooms.size >= MAX_ROOMS) purge(true);
  const r = createRoom(code);
  rooms.set(code, r);
  return r;
}
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n'); }, 15000);

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  return out;
}

// ================================================================ HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
function readBody(req, cb) {
  let body = '';
  req.on('data', d => { body += d; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => { let a = {}; try { a = JSON.parse(body || '{}'); } catch { } cb(a); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  if (req.method === 'GET') {
    if (p === '/') return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    // raccourci : /maitre crée directement un nouveau salon et ouvre sa page maître
    if (/^\/maitre\/?$/i.test(p)) { const code = newCode(); getRoom(code, true); res.writeHead(302, { Location: '/' + code }); return res.end(); }
    // /joueur1, /joueur2 sans code de salon → accueil (saisie du code)
    if (/^\/joueur\d\/?$/i.test(p)) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (p.startsWith('/static/')) {
      const f = path.normalize(path.join(PUBLIC, p.slice(8)));
      if (!f.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
      return sendFile(res, f);
    }
    if (p === '/api/lan') return json(res, { urls: lanUrls() });
    if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{1,12})$/))) {
      const code = cleanCode(m[1]);
      const r = validCode(code) ? getRoom(code, false) : null;
      return json(res, r ? { exists: true, ...r.info() } : { exists: false, code });
    }
    if (p === '/events') {
      const code = cleanCode(url.searchParams.get('room')), who = url.searchParams.get('who');
      if (!['master', 'p1', 'p2'].includes(who)) { res.writeHead(400); return res.end(); }
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
      return r.addClient(res, who, req);
    }
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([12])\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'joueur.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/rejoindre\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'accueil.html'));
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/?$/)) && validCode(cleanCode(m[1])))
      return sendFile(res, path.join(PUBLIC, 'maitre.html'));
  }
  if (req.method === 'POST' && p === '/api/rooms') {
    return readBody(req, a => {
      const code = a.code ? cleanCode(a.code) : newCode();
      if (!validCode(code)) return json(res, { ok: false, error: 'Code invalide : 3 à 10 lettres ou chiffres' });
      if (rooms.has(code) && !a.reuse) return json(res, { ok: false, error: `Le salon ${code} existe déjà` });
      getRoom(code, true);
      json(res, { ok: true, code });
    });
  }
  if (req.method === 'POST' && p === '/api') {
    return readBody(req, a => {
      const code = cleanCode(a.room);
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) return json(res, { ok: false, error: "Ce salon n'existe plus. Recharge la page.", noroom: true });
      try { r.act(a.who, a); json(res, { ok: true }); }
      catch (e) { json(res, { ok: false, error: e.message }); }
    });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Page introuvable');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🚀 Space-Battle-SLG est lancé !');
  console.log(`  Accueil (créer / rejoindre un salon) : http://localhost:${PORT}/`);
  console.log(`  Nouveau salon direct (maître)         : http://localhost:${PORT}/maitre`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local                : ${u}/`);
  console.log('');
});
