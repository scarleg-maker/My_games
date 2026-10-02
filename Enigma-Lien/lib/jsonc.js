/**
 * Petit lecteur de JSON "tolérant" pour les fichiers de data/ que
 * l'utilisateur édite à la main : accepte les commentaires `// ...` et
 * `/* ... *\/`, ainsi que les virgules en trop juste avant une accolade ou
 * un crochet fermant. Rien d'autre ne change : le fichier reste du JSON
 * normal pour le reste (JSON.parse est appliqué après ce nettoyage).
 *
 * On ne touche jamais à ce qu'il y a DANS une chaîne "...", donc un "//"
 * ou une "," dans le nom/l'image d'un personnage ne sont pas affectés.
 */

function stripComments(text) {
  let out = "";
  let inString = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += text[++i]; // copie le caractère échappé tel quel
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    if (c === "/" && next === "/") {
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      i--; // le for() réavancera d'un cran et consommera le \n normalement
      continue;
    }

    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n"; // garde les numéros de ligne cohérents
        i++;
      }
      i++; // pointe sur le '/' final, le for() avancera après
      continue;
    }

    out += c;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];

    if (inString) {
      out += c;
      if (c === "\\" && i + 1 < n) {
        out += text[++i];
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }

    if (c === ",") {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        continue; // virgule superflue : on l'ignore simplement
      }
    }

    out += c;
  }
  return out;
}

/** Parse un texte JSON tolérant (commentaires + virgules en trop). */
function parseLenientJSON(raw) {
  const cleaned = stripTrailingCommas(stripComments(raw));
  return JSON.parse(cleaned);
}

module.exports = { parseLenientJSON };
