// Flotte de Space-Battle-SLG : catalogue des vaisseaux, rotation, placement et règle « pas de contact ».
// Ce fichier est partagé : chargé par le serveur (require) ET par les pages (balise <script>).
(function (root) {
  'use strict';
  const N = 10;

  // cells : [ligne, colonne] dans la forme de base (rotation 0). Les couleurs servent partout (placement, plateaux, pastilles).
  const line = n => Array.from({ length: n }, (_, c) => [0, c]);
  const CATALOG = [
    { id: 'chasseur',      name: 'Chasseur',      color: '#ff7ab8', cells: line(2) },
    { id: 'fregate',       name: 'Frégate',       color: '#3d7bff', cells: line(3) },
    { id: 'croiseur',      name: 'Croiseur',      color: '#ff9a3c', cells: line(3) },
    { id: 'destroyer',     name: 'Destroyer',     color: '#dfe6ff', cells: line(4) },
    { id: 'vaisseau-mere', name: 'Vaisseau-mère', color: '#2fe0b4', cells: line(5) },
    // formes du fichier PDF
    { id: 'station',       name: 'Station',       color: '#8e939e', cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
    { id: 'sous-marin',    name: 'Sous-marin',    color: '#92d050', cells: [[0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [3, 1]] },
    { id: 'voltigeur',     name: 'Voltigeur',     color: '#17c1f5', cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
    { id: 'cuirasse',      name: 'Cuirassé',      color: '#ff4545', cells: [[0, 1], [1, 1], [2, 1], [3, 0], [3, 1], [3, 2]] },
    { id: 'intercepteur',  name: 'Intercepteur',  color: '#9a52d6', cells: [[0, 0], [1, 0], [2, 0], [0, 2], [1, 2], [2, 2], [1, 1]] },
    { id: 'cannoniere',    name: 'Cannonière',    color: '#ffc400', cells: [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]] },
  ];
  const DEFAULT_FLEET = ['chasseur', 'fregate', 'croiseur', 'destroyer', 'vaisseau-mere'];
  const MAX_CELLS = 40;                         // au-delà, impossible de tout placer sans contact
  const byId = id => CATALOG.find(s => s.id === id);

  // remet la forme dans le coin haut-gauche de sa boîte englobante
  function norm(cells) {
    const r0 = Math.min(...cells.map(c => c[0])), c0 = Math.min(...cells.map(c => c[1]));
    return cells.map(([r, c]) => [r - r0, c - c0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  // rotation de 90° dans le sens des aiguilles d'une montre, `rot` fois
  function shape(id, rot) {
    let cells = byId(id).cells;
    for (let k = 0; k < ((rot % 4) + 4) % 4; k++) cells = norm(cells.map(([r, c]) => [c, -r]));
    return norm(cells);
  }
  const size = cells => ({ h: Math.max(...cells.map(c => c[0])) + 1, w: Math.max(...cells.map(c => c[1])) + 1 });

  // cases absolues d'un vaisseau dont la boîte englobante a son coin haut-gauche en (r, c) ; null si hors grille
  function place(id, rot, r, c) {
    const out = [];
    for (const [dr, dc] of shape(id, rot)) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) return null;
      out.push(rr * N + cc);
    }
    return out;
  }
  // cases interdites autour d'un ensemble de cases : les 8 voisines (zone de 1 case, diagonales comprises)
  function halo(cells) {
    const s = new Set();
    for (const i of cells) {
      const r = (i / N) | 0, c = i % N;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N) s.add(rr * N + cc);
      }
    }
    return s;
  }
  // `cells` peut-il être posé à côté de `others` (liste de listes de cases) ? ni superposition ni contact
  function free(cells, others) {
    const zone = new Set();
    for (const o of others) for (const i of halo(o)) zone.add(i);
    return cells.every(i => !zone.has(i));
  }
  // vérifie une flotte complète [{id, rot, r, c}] ; retourne [{id, rot, r, c, cells}] ou lève une erreur
  function validate(list, ids) {
    if (!Array.isArray(list) || list.length !== ids.length) throw new Error(`Flotte incomplète : place les ${ids.length} vaisseaux`);
    const seen = new Set(), out = [];
    for (const it of list) {
      const id = it && it.id;
      if (!ids.includes(id) || seen.has(id)) throw new Error('Flotte invalide');
      seen.add(id);
      if (![it.rot, it.r, it.c].every(Number.isInteger) || it.rot < 0 || it.rot > 3) throw new Error('Flotte invalide');
      const cells = place(id, it.rot, it.r, it.c);
      if (!cells) throw new Error(`${byId(id).name} sort de la grille`);
      if (!free(cells, out.map(o => o.cells))) throw new Error('Les vaisseaux ne doivent ni se chevaucher ni se toucher (1 case d\'écart)');
      out.push({ id, rot: it.rot, r: it.r, c: it.c, cells });
    }
    return out;
  }
  // placement aléatoire valide (grands vaisseaux d'abord) ; null si introuvable
  function randomPlacement(ids, attempts = 300) {
    const order = [...ids].sort((a, b) => byId(b).cells.length - byId(a).cells.length);
    const rnd = n => (Math.random() * n) | 0;
    for (let a = 0; a < attempts; a++) {
      const out = [];
      let ok = true;
      for (const id of order) {
        let done = false;
        for (let t = 0; t < 80 && !done; t++) {
          const rot = rnd(4), sh = shape(id, rot), { h, w } = size(sh);
          const r = rnd(N - h + 1), c = rnd(N - w + 1), cells = place(id, rot, r, c);
          if (cells && free(cells, out.map(o => o.cells))) { out.push({ id, rot, r, c, cells }); done = true; }
        }
        if (!done) { ok = false; break; }
      }
      if (ok) return out.map(({ id, rot, r, c }) => ({ id, rot, r, c })).sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id));
    }
    return null;
  }

  // retrouve {rot, r, c} d'un vaisseau posé à partir de ses cases absolues (pour « modifier ma flotte »)
  function recover(id, cells) {
    const rs = cells.map(i => (i / N) | 0), cs = cells.map(i => i % N), r = Math.min(...rs), c = Math.min(...cs);
    const rel = norm(cells.map((i, k) => [rs[k] - r, cs[k] - c])).join('|');
    for (let rot = 0; rot < 4; rot++) if (shape(id, rot).join('|') === rel) return { rot, r, c };
    return null;
  }

  const api = { recover, N, CATALOG, DEFAULT_FLEET, MAX_CELLS, byId, shape, size, place, halo, free, validate, randomPlacement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Fleet = api;
})(typeof window !== 'undefined' ? window : globalThis);
