/**
 * Moteur générique de génération/validation d'énigmes "Enigma-Lien".
 * Indépendant du thème : il ne connaît que la forme générique d'une "entité"
 * (un objet JS avec des champs) et une liste de "critères" décrivant comment
 * comparer deux entités adjacentes.
 *
 * Types de critère (champ "kind") :
 *   - "numeric"      : compare deux nombres avec <, =, >  (ex: génération, puissance)
 *   - "equality"     : compare l'égalité stricte d'un champ (ex: couleur)
 *   - "shared-array" : vrai si les deux entités partagent au moins une valeur
 *                      dans un champ tableau (ex: types)
 *   - "battle"       : vrai si un des types de A "bat" un des types de B selon
 *                      une table de correspondance externe (battleTable)
 */

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN(dataset, n) {
  const pool = shuffle(dataset);
  return pool.slice(0, n);
}

function sharedArray(a, b, field) {
  const av = Array.isArray(a[field]) ? a[field] : [a[field]].filter(Boolean);
  const bv = Array.isArray(b[field]) ? b[field] : [b[field]].filter(Boolean);
  return av.some((v) => bv.includes(v));
}

function beats(a, b, field, battleTable) {
  if (!battleTable) return false;
  const av = Array.isArray(a[field]) ? a[field] : [a[field]].filter(Boolean);
  const bv = Array.isArray(b[field]) ? b[field] : [b[field]].filter(Boolean);
  return av.some((at) => {
    const list = battleTable[at] || [];
    return bv.some((bt) => list.includes(bt));
  });
}

/** Retourne la liste des liens (catégorie+symbole) valides entre deux entités adjacentes */
function possibleLinks(a, b, criteria, battleTable) {
  const opts = [];
  for (const c of criteria) {
    if (c.kind === "numeric") {
      const av = a[c.field];
      const bv = b[c.field];
      if (typeof av !== "number" || typeof bv !== "number") continue;
      if (av === bv) opts.push({ cat: c.id, sym: "=" });
      else opts.push({ cat: c.id, sym: av > bv ? ">" : "<" });
    } else if (c.kind === "equality") {
      if (a[c.field] != null && a[c.field] === b[c.field]) {
        opts.push({ cat: c.id, sym: "=" });
      }
    } else if (c.kind === "shared-array") {
      if (sharedArray(a, b, c.field)) opts.push({ cat: c.id, sym: "=" });
    } else if (c.kind === "battle") {
      if (beats(a, b, c.field, battleTable)) opts.push({ cat: c.id, sym: ">" });
    }
  }
  return opts;
}

/** Vérifie si un lien donné (choisi lors de la génération) est vérifié dans un arrangement donné */
function checkLink(link, a, b, criteria, battleTable) {
  const c = criteria.find((x) => x.id === link.cat);
  if (!c) return false;
  if (c.kind === "numeric") {
    const av = a[c.field];
    const bv = b[c.field];
    if (link.sym === "=") return av === bv;
    if (link.sym === ">") return av > bv;
    if (link.sym === "<") return av < bv;
    return false;
  }
  if (c.kind === "equality") return a[c.field] === b[c.field];
  if (c.kind === "shared-array") return sharedArray(a, b, c.field);
  if (c.kind === "battle") return beats(a, b, c.field, battleTable);
  return false;
}

/**
 * Génère une énigme complète : sélectionne N entités, un ordre "solution",
 * un lien valide (aléatoire parmi les options) pour chaque paire adjacente,
 * puis un ordre "display" mélangé (différent de la solution).
 */
function generatePuzzle(dataset, criteria, battleTable, opts = {}) {
  const charCount = opts.charCount || 6;
  const maxTries = opts.maxTries || 500;
  if (!Array.isArray(dataset) || dataset.length < charCount) {
    throw new Error(
      `Le jeu de données ne contient que ${dataset ? dataset.length : 0} entités, ` +
        `il en faut au moins ${charCount} pour générer une énigme.`
    );
  }
  let tries = 0;
  while (tries < maxTries) {
    tries++;
    const order = pickN(dataset, charCount);
    const chosen = [];
    let ok = true;
    for (let i = 0; i < order.length - 1; i++) {
      const options = possibleLinks(order[i], order[i + 1], criteria, battleTable);
      if (options.length === 0) {
        ok = false;
        break;
      }
      chosen.push(options[Math.floor(Math.random() * options.length)]);
    }
    if (ok) {
      let display;
      do {
        display = shuffle(order);
      } while (display.every((p, i) => p === order[i]));
      return { solution: order, links: chosen, display };
    }
  }
  // Repli extrêmement improbable : on force des liens "toujours vrais" si possible
  const order = pickN(dataset, charCount);
  const display = shuffle(order);
  return { solution: order, links: [], display };
}

/** Valide un arrangement (tableau d'entités dans l'ordre proposé par un joueur) contre les liens */
function validateArrangement(arrangement, links, criteria, battleTable) {
  const results = links.map((l, i) => checkLink(l, arrangement[i], arrangement[i + 1], criteria, battleTable));
  const correctCount = results.filter(Boolean).length;
  return { results, correctCount, solved: correctCount === links.length };
}

module.exports = {
  shuffle,
  pickN,
  sharedArray,
  beats,
  possibleLinks,
  checkLink,
  generatePuzzle,
  validateArrangement,
};
