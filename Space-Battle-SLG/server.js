// Space-Battle-SLG — bataille navale spatiale à 2 joueurs (Node.js, aucune dépendance)
// Lancement : node server.js  →  http://localhost:19500
const http = require('http');
const fs = require('fs');
const AI = require('./ai');
const Fleet = require('./public/fleet.js');   // catalogue des vaisseaux + règles de placement (partagé avec les pages)
const path = require('path');
const os = require('os');

const PORT = +process.env.PORT || 19500;
const AI_SPEED = +process.env.AI_SPEED || 1;     // >1 = IA plus rapide (tests)
const MODES = ['single', 'chain', 'salvo'];     // option de tir : 1 tir / tour · rejoue si touché · salve de 3 à 5 tirs
const GAMES = ['classic', 'ffa', 'team', 'royale'];   // classique 2 joueurs · chacun pour soi · équipes · battle royale
const MAXP = 6, TEAMS = 3;                      // 6 joueurs maximum, équipes A, B, C
const PUBLIC = path.join(__dirname, 'public');
const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const label = (i, n) => LET[i % n] + (Math.floor(i / n) + 1);
const cleanName = (s, def) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 20) || def;

// ================================================================ un salon = une partie indépendante
function createRoom(code) {
  const clients = new Set();
  let lastActivity = Date.now();

  const S = {
    phase: 'setup',                             // setup → placement → battle → over
    game: 'classic', n: 2,                      // type de partie et nombre de joueurs (2 à 6)
    names: Array.from({ length: MAXP }, (_, i) => `Joueur ${i + 1}`),
    ai: Array(MAXP).fill(null),                 // par siège : null (humain) ou 'debutant' | 'avance' | 'expert'
    team: Array.from({ length: MAXP }, (_, i) => i % 2),   // équipe de chaque siège (mode équipes)
    mode: 'single', salvo: 3, ring: false,      // option de tir ; salve ; « tirer sur le joueur suivant » (chacun pour soi)
    fleet: [...Fleet.DEFAULT_FLEET],            // vaisseaux à placer (choisis par le maître, communs à tous)
    count: 5,                                   // nombre de vaisseaux par joueur (5 à 8)
    armada: false, fleets: Array(MAXP).fill(null),   // « Armada perso » : chaque joueur choisit ses propres types (fleets[i] = ids)
    size: 10,                                   // côté de la grille (carte plus grande en battle royale)
    round: 1, score: Array(MAXP).fill(0),
    starter: 0, turn: 0, winners: [], teamLast: {},
    ready: Array(MAXP).fill(false), rematch: Array(MAXP).fill(false),
    boards: [], shared: null, owners: {},       // boards[i] = {ships, shots reçus} ; shared = carte commune (battle royale)
    last: null, seq: 0, log: [],
  };

  const seats = () => Array.from({ length: S.n }, (_, i) => i);
  const cellsOfIds = ids => ids.reduce((n, id) => n + Fleet.byId(id).cells.length, 0);
  const fleetCells = () => S.armada ? Math.min(Fleet.MAX_CELLS, S.count * 5) : cellsOfIds(S.fleet);   // armada : estimation pour la taille de la carte
  const fleetOf = p => S.armada ? S.fleets[p] : S.fleet;
  const AI_PICK = () => {   // flotte au hasard pour une IA en mode armada
    for (let t = 0; t < 400; t++) {
      const ids = Fleet.CATALOG.map(x => x.id).sort(() => Math.random() - .5).slice(0, S.count);
      if (cellsOfIds(ids) <= Fleet.MAX_CELLS && Fleet.randomPlacement(ids, 40, S.size)) return Fleet.CATALOG.map(x => x.id).filter(id => ids.includes(id));
    }
    return Fleet.DEFAULT_FLEET.slice(0, S.count);
  };
  const gridSize = () => S.game === 'royale' ? Fleet.mapSize(S.n, fleetCells()) : 10;
  const royale = () => S.game === 'royale';
  const shotsOf = i => royale() ? S.shared.shots : S.boards[i].shots;        // tirs reçus par le plateau de i
  const isSunk = (i, s) => s.cells.every(c => shotsOf(i)[c] === 2);
  const shipsLeft = i => S.boards[i].ships.filter(s => !isSunk(i, s));
  const alive = i => S.boards[i].ships.length === 0 || shipsLeft(i).length > 0;
  const online = i => !!S.ai[i] || [...clients].some(c => c.who === 'p' + (i + 1));   // une IA est toujours "connectée"
  const pushLog = t => { S.log.push(t); if (S.log.length > 40) S.log.shift(); };
  const nextAlive = p => { for (let k = 1; k <= S.n; k++) { const i = (p + k) % S.n; if (alive(i)) return i; } return p; };
  const unique = a => [...new Set(a)];
  const teamName = t => `Équipe ${'ABC'[t]}`;

  // ---- ce que chaque page a le droit de voir
  const pubShip = (i, s) => ({ id: s.id, owner: i, name: s.name, color: s.color, size: s.size, cells: s.cells, sunk: isSunk(i, s) });
  function boardPub(i, reveal) {
    const b = S.boards[i];
    return {
      shots: shotsOf(i), remaining: shipsLeft(i).length, total: b.ships.length,
      sunk: b.ships.filter(s => isSunk(i, s)).map(s => pubShip(i, s)),
      ships: reveal ? b.ships.map(s => pubShip(i, s)) : undefined,
    };
  }
  function mapPub(reveal) {                     // battle royale : une seule carte pour tout le monde
    const all = seats().flatMap(i => S.boards[i].ships.map(s => pubShip(i, s)));
    return { shots: S.shared.shots, owners: S.owners, sunk: all.filter(s => s.sunk), ships: reveal ? all : undefined };
  }
  function view(who) {
    const m = /^p([1-6])$/.exec(who), you = m && +m[1] - 1 < S.n ? +m[1] - 1 : -1;
    const over = S.phase === 'over', has = S.boards.length === S.n;
    const v = {
      room: code, you, phase: S.phase, game: S.game, n: S.n, size: S.size,
      names: S.names.slice(0, S.n), ai: S.ai.slice(0, S.n), team: S.team.slice(0, S.n),
      mode: S.mode, salvo: S.salvo, ring: S.ring, count: S.count, armada: S.armada,
      fleet: S.armada ? (you >= 0 ? S.fleets[you] || [] : []) : S.fleet,
      fleetReady: S.armada ? seats().map(i => !!S.fleets[i]) : null,
      fleets: S.armada && (S.phase === 'battle' || S.phase === 'over') ? S.fleets.slice(0, S.n) : null,   // les compositions sont connues de tous une fois la bataille lancée
      round: S.round, score: S.score.slice(0, S.n), turn: S.turn, winners: S.winners,
      ready: S.ready.slice(0, S.n), rematch: S.rematch.slice(0, S.n),
      online: seats().map(online), masterOnline: [...clients].some(c => c.who === 'master'),
      stats: has ? seats().map(i => ({ left: shipsLeft(i).length, total: S.boards[i].ships.length, alive: alive(i) })) : [],
      last: S.last, log: S.log.slice(-14),
    };
    if (!has) return v;
    if (royale()) {
      v.map = mapPub(over);
      if (you >= 0) { v.mine = { ships: S.boards[you].ships.map(s => pubShip(you, s)) }; v.fallback = S.phase === 'battle' && shootable(you, null).fallback; }
    } else if (you >= 0) {
      v.mine = boardPub(you, true);              // sa propre flotte
      v.foes = seats().map(i => i === you ? null : boardPub(i, over || (S.game === 'team' && S.team[i] === S.team[you])));   // équipiers : flotte visible
    } else {
      v.boards = seats().map(i => boardPub(i, over));
    }
    return v;
  }
  function send(c) { c.res.write(`data: ${JSON.stringify(view(c.who))}\n\n`); }
  function broadcast() { for (const c of clients) send(c); }

  // ---- règles
  function startPlacement() {
    S.size = gridSize();
    S.boards = seats().map(() => ({ ships: [], shots: royale() ? [] : Array(S.size * S.size).fill(0) }));
    S.shared = royale() ? { shots: Array(S.size * S.size).fill(0) } : null;
    S.owners = {};
    S.ready = Array(MAXP).fill(false); S.rematch = Array(MAXP).fill(false);
    S.winners = []; S.last = null; S.log = []; S.teamLast = {};
    S.fleets = Array(MAXP).fill(null);
    S.phase = 'placement';
    if (S.armada) pushLog(`Armada perso : chaque joueur choisit ${S.count} types de vaisseaux, puis les place.`);
    else pushLog(royale() ? `Placez vos ${S.fleet.length} vaisseaux sur la carte ${S.size}×${S.size} : vous pouvez les superposer à ceux des autres.`
      : `Placez vos ${S.fleet.length} vaisseaux sur la grille (sans qu'ils se touchent).`);
  }
  // placement envoyé par un joueur : [{id, rot, r, c}] → vérifié par les règles communes (grille, contact entre SES vaisseaux)
  function parseFleet(p, list) {
    const ids = fleetOf(p);
    if (!ids) throw new Error('Choisis d\'abord tes types de vaisseaux');
    return Fleet.validate(list, ids, S.size).map(v => {
      const t = Fleet.byId(v.id);
      return { id: v.id, owner: p, name: t.name, color: t.color, size: v.cells.length, cells: v.cells };
    });
  }

  // cible d'un tir selon le type de partie
  function targetFor(p, a) {
    if (royale()) return null;
    if (S.game === 'classic') return 1 - p;
    if (S.game === 'ffa' && S.ring) return nextAlive(p);          // option : on ne tire que sur le joueur suivant
    const t = a.target;
    if (!Number.isInteger(t) || t < 0 || t >= S.n || t === p) throw new Error('Choisis un adversaire à viser');
    if (!alive(t)) throw new Error(`${S.names[t]} est déjà éliminé`);
    if (S.game === 'team' && S.team[t] === S.team[p]) throw new Error('Tu ne peux pas tirer sur un équipier');
    return t;
  }
  // joueur qui tire après p : chacun son tour ; en équipes, les équipes tirent à tour de rôle (un équipier à la fois),
  // donc un joueur seul dans son équipe tire après chaque tir adverse
  function nextShooter(p) {
    if (S.game !== 'team') return nextAlive(p);
    const teams = unique(seats().filter(alive).map(i => S.team[i])).sort((a, b) => a - b);
    const nt = teams[(teams.indexOf(S.team[p]) + 1) % teams.length];
    const mem = seats().filter(i => alive(i) && S.team[i] === nt);
    const last = S.teamLast[nt];
    const nxt = (last === undefined ? mem[0] : mem.find(i => i > last)) ?? mem[0];
    S.teamLast[nt] = nxt;
    return nxt;
  }
  const shootable = (p, target) => {
    const shots = royale() ? S.shared.shots : S.boards[target].shots;
    const own = royale() ? new Set(S.boards[p].ships.flatMap(s => s.cells)) : null;
    // battle royale : ses propres cases sont interdites, sauf en dernier recours (plus aucune autre case libre) :
    // le tir sur une case à soi touche alors aussi son propre vaisseau
    const fallback = !!own && !shots.some((v, i) => v === 0 && !own.has(i));
    const mine = own && !fallback ? own : null;
    return { shots, mine, fallback, free: shots.filter((v, i) => v === 0 && !(mine && mine.has(i))).length };
  };

  function fire(p, a) {
    if (S.phase !== 'battle') throw new Error("La bataille n'est pas en cours");
    if (S.turn !== p) throw new Error("Ce n'est pas ton tour");
    const target = targetFor(p, a), n = S.size;
    const { shots, mine, free } = shootable(p, target);
    const raw = Array.isArray(a.cells) ? a.cells : [];
    const idxs = [];
    for (const rc of raw) {
      const r = rc && rc[0], c = rc && rc[1];
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= n || c < 0 || c >= n) throw new Error('Cible invalide');
      const i = r * n + c;
      if (shots[i] !== 0) throw new Error(`${label(i, n)} a déjà été visé`);
      if (mine && mine.has(i)) throw new Error(`${label(i, n)} : c'est l'un de tes vaisseaux (visable seulement quand il ne reste plus d'autre case)`);
      if (idxs.includes(i)) throw new Error('Cibles en double');
      idxs.push(i);
    }
    const need = S.mode === 'salvo' ? Math.min(S.salvo, free) : 1;
    if (idxs.length !== need) throw new Error(need > 1 ? `Choisis exactement ${need} cibles` : 'Choisis une cible');

    const wasAlive = seats().map(alive), volley = [], touched = new Set();
    for (const i of idxs) {
      const ships = royale() ? seats().flatMap(o => S.boards[o].ships.filter(s => s.cells.includes(i)))
        : S.boards[target].ships.filter(s => s.cells.includes(i));
      shots[i] = ships.length ? 2 : 1;
      const owners = unique(ships.map(s => s.owner));
      if (royale() && owners.length) S.owners[i] = owners;
      ships.forEach(s => touched.add(s));
      volley.push({ i, hit: ships.length > 0, owners, sunk: [] });
    }
    for (const s of touched) if (isSunk(s.owner, s)) {   // le vaisseau est coulé par le dernier tir de la salve qui le touche
      let k = -1; volley.forEach((v, j) => { if (s.cells.includes(v.i)) k = j; });
      volley[k].sunk.push({ owner: s.owner, name: s.name });
    }
    const out = seats().filter(i => wasAlive[i] && !alive(i));

    // journal
    const name = S.names[p], on = S.game === 'classic' ? '' : ` sur ${S.names[target]}`;
    const sunkTxt = v => v.sunk.map(x => S.game === 'classic' ? x.name : `${x.name} de ${S.names[x.owner]}`).join(', ');
    let again = false;
    if (S.mode === 'salvo') {
      const hits = volley.filter(v => v.hit).length;
      pushLog(`${name} lance une salve de ${volley.length} tirs${royale() ? '' : on} : ${hits} touché${hits > 1 ? 's' : ''}, ${volley.length - hits} dans le vide.`);
      for (const v of volley) if (v.sunk.length) pushLog(`💥 ${sunkTxt(v)} détruit !`);
    } else {
      const v = volley[0];
      again = S.mode === 'chain' && v.hit;
      pushLog(`${name} tire en ${label(v.i, n)}${royale() ? '' : on} : ${v.sunk.length ? `touché-coulé, ${sunkTxt(v)} détruit !` : v.hit ? `touché !${royale() ? ` (${v.owners.map(o => S.names[o]).join(', ')})` : ''}` : 'dans le vide.'}`);
    }
    for (const i of out) pushLog(`☠️ ${S.names[i]} est éliminé !`);

    // victoire ?
    let winners = null;
    if (S.game === 'team') {
      const ts = unique(seats().filter(alive).map(i => S.team[i]));
      if (ts.length <= 1) winners = seats().filter(i => S.team[i] === ts[0]);
    } else {
      const al = seats().filter(alive);
      if (al.length <= 1) winners = al.length ? al : seats().filter(i => wasAlive[i]);   // tir fratricide : élimination simultanée = égalité
    }
    S.last = { by: p, target, shots: volley, again: again && !winners, seq: ++S.seq };
    if (winners) {
      S.phase = 'over'; S.winners = winners; winners.forEach(i => S.score[i]++);
      pushLog(S.game === 'team' ? `🏆 ${teamName(S.team[winners[0]])} (${winners.map(i => S.names[i]).join(', ')}) remporte la bataille !`
        : winners.length > 1 ? `🤝 Égalité : ${winners.map(i => S.names[i]).join(', ')} sont éliminés ensemble.` : `🏆 ${S.names[winners[0]]} remporte la bataille !`);
    } else if (!again || !alive(p)) S.turn = nextShooter(p);
  }

  function beginBattle() {
    S.phase = 'battle'; S.turn = S.starter;
    if (S.game === 'team') S.teamLast[S.team[S.turn]] = S.turn;
    pushLog(`La bataille commence ! ${S.names[S.turn]} ouvre le feu.`);
  }
  function checkFleet(list) {
    const ids = Fleet.CATALOG.map(t => t.id).filter(id => Array.isArray(list) && list.includes(id));
    if (!Array.isArray(list) || new Set(list).size !== list.length || ids.length !== list.length) throw new Error('Flotte invalide');
    if (ids.length !== S.count) throw new Error(`Choisis exactement ${S.count} vaisseaux`);
    const cells = cellsOfIds(ids);
    if (cells > Fleet.MAX_CELLS) throw new Error(`Flotte trop grande (${cells} cases, maximum ${Fleet.MAX_CELLS})`);
    if (!Fleet.randomPlacement(ids, 150, S.size)) throw new Error('Cette flotte ne tient pas sur la grille sans que les vaisseaux se touchent');
    return ids;
  }
  function player(p, a) {
    switch (a.type) {
      case 'team': {
        if (S.phase !== 'setup' || S.game !== 'team') throw new Error('Le choix d\'équipe n\'est pas possible maintenant');
        const t = +a.team;
        if (!Number.isInteger(t) || t < 0 || t >= TEAMS) throw new Error('Équipe inconnue');
        S.team[p] = t; return;
      }
      case 'fleet': {                              // armada perso : choix des types de vaisseaux
        if (!S.armada || S.phase !== 'placement' || S.ready[p]) throw new Error('Choix de flotte impossible maintenant');
        S.fleets[p] = checkFleet(a.ids);
        return;
      }
      case 'unfleet':
        if (S.armada && S.phase === 'placement' && !S.ready[p]) S.fleets[p] = null;
        return;
      case 'place':
        if (S.phase !== 'placement' || S.ready[p]) throw new Error('Placement impossible maintenant');
        S.boards[p].ships = parseFleet(p, a.ships);
        S.ready[p] = true;
        if (seats().every(i => S.ready[i])) beginBattle();
        return;
      case 'unready':
        if (S.phase === 'placement' && S.ready[p]) { S.ready[p] = false; S.boards[p].ships = []; }
        return;
      case 'fire': return fire(p, a);
      case 'rematch':
        if (S.phase !== 'over') throw new Error('La partie n\'est pas terminée');
        S.rematch[p] = true;
        if (seats().every(i => S.rematch[i] || S.ai[i])) doRematch();
        return;
      default: throw new Error('Action inconnue');
    }
  }
  function doRematch() {
    S.round++;
    // classique : le perdant ouvre ; sinon l'ouverture tourne d'un siège
    S.starter = S.game === 'classic' ? 1 - S.winners[0] : (S.starter + 1) % S.n;
    startPlacement();
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function master(a) {
    switch (a.type) {
      case 'config':
        if (S.phase !== 'setup') throw new Error('La partie a déjà commencé');
        if (GAMES.includes(a.game)) S.game = a.game;
        if (S.game === 'classic') S.n = 2;
        else S.n = clamp(Number.isInteger(+a.n) && a.n != null ? +a.n : Math.max(S.n, 3), 3, MAXP);
        if (Array.isArray(a.names)) S.names = S.names.map((old, i) => cleanName(a.names[i], `Joueur ${i + 1}`));
        if (MODES.includes(a.mode)) S.mode = a.mode;
        if (a.salvo != null) S.salvo = clamp(+a.salvo | 0 || 3, 3, 5);
        if (a.ring != null) S.ring = !!a.ring;
        if (a.count != null) S.count = clamp(+a.count | 0 || 5, 5, 8);
        if (a.armada != null) S.armada = !!a.armada;
        if (Array.isArray(a.ai)) S.ai = S.ai.map((old, i) => AI.LEVELS.includes(a.ai[i]) ? a.ai[i] : null);
        if (Array.isArray(a.team)) S.team = S.team.map((old, i) => Number.isInteger(a.team[i]) ? clamp(a.team[i], 0, TEAMS - 1) : old);
        if (Array.isArray(a.fleet)) {
          const ids = Fleet.CATALOG.map(t => t.id).filter(id => a.fleet.includes(id));   // ordre du catalogue, sans doublon
          if (!ids.length) throw new Error('Choisis au moins un vaisseau');
          const cells = ids.reduce((n, id) => n + Fleet.byId(id).cells.length, 0);
          if (cells > Fleet.MAX_CELLS) throw new Error(`Flotte trop grande (${cells} cases, maximum ${Fleet.MAX_CELLS}) : les vaisseaux ne pourraient pas tous tenir sans se toucher`);
          if (ids.join() !== S.fleet.join() && !Fleet.randomPlacement(ids, 150)) throw new Error('Cette flotte ne tient pas sur la grille sans que les vaisseaux se touchent');
          S.fleet = ids;
        }
        S.size = gridSize();
        return;
      case 'start': {
        if (S.phase !== 'setup') throw new Error('La partie a déjà commencé');
        const nm = seats().map(i => S.names[i].toLowerCase());
        if (new Set(nm).size !== nm.length) throw new Error('Les joueurs doivent avoir des noms différents');
        if (!S.armada && S.fleet.length !== S.count) throw new Error(`Choisis exactement ${S.count} vaisseaux (tu en as ${S.fleet.length})`);
        if (S.game === 'team' && unique(seats().map(i => S.team[i])).length < 2) throw new Error('Il faut au moins 2 équipes non vides');
        S.starter = (Math.random() * S.n) | 0;
        return startPlacement();
      }
      case 'setup':                              // retour aux réglages (nouvelle partie, scores remis à zéro)
        S.phase = 'setup'; S.round = 1; S.score = Array(MAXP).fill(0); S.boards = []; S.shared = null; S.owners = {};
        S.ready = Array(MAXP).fill(false); S.rematch = Array(MAXP).fill(false); S.winners = []; S.last = null; S.log = []; S.fleets = Array(MAXP).fill(null);
        S.size = gridSize();
        return;
      case 'rematch':
        if (S.phase !== 'over') throw new Error('La partie n\'est pas terminée');
        return doRematch();
      default: throw new Error('Action inconnue');
    }
  }
  function handle(who, a) {
    if (who === 'master') return master(a);
    const m = /^p([1-6])$/.exec(who || '');
    if (m && +m[1] - 1 < S.n) return player(+m[1] - 1, a);
    throw new Error('Rôle inconnu');
  }

  // ---- joueurs IA : ils agissent après un court délai, comme un humain qui réfléchit
  let aiTimer = null;
  const humans = () => seats().filter(i => !S.ai[i]).length;
  const knowledge = i => ({ n: S.size, shots: S.boards[i].shots,                // ce qu'on sait du plateau de i
    sunk: S.boards[i].ships.filter(s => isSunk(i, s)).map(s => ({ cells: s.cells })), remaining: shipsLeft(i).map(s => s.id) });
  function aiFire(p) {
    const level = S.ai[p];
    let k, target = null;
    if (royale()) {
      const others = seats().filter(o => o !== p).flatMap(o => S.boards[o].ships.map(s => ({ s, o })));
      k = { n: S.size, shots: S.shared.shots, noHalo: true, forbid: shootable(p, null).fallback ? new Set() : new Set(S.boards[p].ships.flatMap(s => s.cells)),
        sunk: others.filter(x => isSunk(x.o, x.s)).map(x => ({ cells: x.s.cells })), remaining: others.filter(x => !isSunk(x.o, x.s)).map(x => x.s.id) };
    } else {
      let cands = S.game === 'classic' ? [1 - p] : seats().filter(i => i !== p && alive(i) && !(S.game === 'team' && S.team[i] === S.team[p]));
      if (S.game === 'ffa' && S.ring) cands = [nextAlive(p)];
      const infos = cands.map(i => ({ i, left: shipsLeft(i).length, hits: AI.unresolved(knowledge(i)).length }));
      target = AI.chooseTarget(level, infos);
      k = knowledge(target);
    }
    const free = k.shots.filter((v, i) => v === 0 && !(k.forbid && k.forbid.has(i))).length;
    const need = S.mode === 'salvo' ? Math.min(S.salvo, free) : 1;
    const cells = AI.chooseShots(level, k, need).map(i => [Math.floor(i / S.size), i % S.size]);
    player(p, { type: 'fire', cells, target });
  }
  function aiKick() {
    clearTimeout(aiTimer);
    const run = (ms, fn) => { aiTimer = setTimeout(() => { try { fn(); broadcast(); } catch (e) { return console.error('IA :', e.message); } aiKick(); }, ms / AI_SPEED); };
    if (S.phase === 'placement') {
      const p = seats().find(i => S.ai[i] && !S.ready[i]);
      if (p !== undefined) run(700, () => { if (S.phase !== 'placement' || S.ready[p]) return; if (S.armada && !S.fleets[p]) S.fleets[p] = AI_PICK(); player(p, { type: 'place', ships: AI.placeFleet(S.ai[p], fleetOf(p), S.size) }); });
    } else if (S.phase === 'battle' && S.ai[S.turn]) {
      run(S.mode === 'salvo' ? 1800 : 1100 + Math.random() * 600, () => { if (S.phase === 'battle' && S.ai[S.turn]) aiFire(S.turn); });
    } else if (S.phase === 'over' && humans() > 0) {   // l'IA accepte toujours la revanche
      const p = seats().find(i => S.ai[i] && !S.rematch[i]);
      if (p !== undefined) run(1500, () => { if (S.phase === 'over') player(p, { type: 'rematch' }); });
    }
  }

  // ---- API du salon
  return {
    code, clients,
    addClient(res, who, req) {
      const c = { res, who };
      const presence = () => seats().map(online).join() + [...clients].some(x => x.who === 'master');
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
      return { code, phase: S.phase, game: S.game, n: S.n, mode: S.mode, names: S.names.slice(0, S.n), ai: S.ai.slice(0, S.n),
        team: S.team.slice(0, S.n), fleet: S.fleet, count: S.count, armada: S.armada, online: seats().map(online), round: S.round };
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
      if (!/^(master|p[1-6])$/.test(who || '')) { res.writeHead(400); return res.end(); }
      const r = validCode(code) ? getRoom(code, false) : null;
      if (!r) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      req.socket.setKeepAlive(true); req.socket.setNoDelay(true); req.socket.setTimeout(0);
      return r.addClient(res, who, req);
    }
    if ((m = p.match(/^\/([A-Za-z0-9]{3,10})\/joueur([1-6])\/?$/)) && validCode(cleanCode(m[1])))
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
