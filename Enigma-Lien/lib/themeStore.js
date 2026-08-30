const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const THEMES_FILE = path.join(DATA_DIR, "themes.json");

function readJSON(relPath) {
  const full = path.join(DATA_DIR, relPath);
  const raw = fs.readFileSync(full, "utf8");
  return JSON.parse(raw);
}

/**
 * Charge data/themes.json + pour chaque thème son dataset et sa table de
 * bataille. Relit les fichiers à chaque appel : comme ce sont de simples
 * fichiers texte que l'utilisateur peut éditer à la main, on veut que les
 * changements soient pris en compte sans redémarrer le serveur.
 */
function loadThemes() {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(THEMES_FILE, "utf8"));
  } catch (e) {
    throw new Error(`Impossible de lire ${THEMES_FILE} : ${e.message}`);
  }
  const themes = {};
  for (const t of list) {
    try {
      const dataset = readJSON(t.dataFile);
      const battleTable = t.battleFile ? readJSON(t.battleFile) : {};
      themes[t.id] = { ...t, dataset, battleTable };
    } catch (e) {
      console.warn(`[themeStore] Thème "${t.id}" ignoré (erreur de chargement) : ${e.message}`);
    }
  }
  return themes;
}

function listThemesSummary() {
  const themes = loadThemes();
  return Object.values(themes).map((t) => ({
    id: t.id,
    name: t.name,
    icon: t.icon,
    note: t.note,
    count: Array.isArray(t.dataset) ? t.dataset.length : 0,
    criteria: t.criteria,
    charCount: t.charCount || 6,
  }));
}

function getTheme(id) {
  const themes = loadThemes();
  const t = themes[id];
  if (!t) throw new Error(`Thème inconnu : "${id}"`);
  if (!Array.isArray(t.dataset) || t.dataset.length < (t.charCount || 6)) {
    throw new Error(
      `Le thème "${id}" n'a que ${t.dataset ? t.dataset.length : 0} entrées, ` +
        `il en faut au moins ${t.charCount || 6}.`
    );
  }
  return t;
}

module.exports = { loadThemes, listThemesSummary, getTheme, DATA_DIR };
