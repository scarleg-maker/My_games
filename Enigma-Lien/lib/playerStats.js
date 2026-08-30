const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PLAYERS_FILE = path.join(DATA_DIR, "players.json");
const HISTORY_FILE = path.join(DATA_DIR, "solo_history.json");

function readJSONSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function keyOf(name) {
  return String(name || "").trim().toLowerCase();
}

/** Enregistre le résultat d'une partie solo et met à jour les stats agrégées du joueur. */
function recordSoloResult({ player, theme, result, livesUsed, livesMax, correctCount, linkCount }) {
  const players = readJSONSafe(PLAYERS_FILE, {});
  const key = keyOf(player);
  if (!key) throw new Error("Nom de joueur manquant.");

  const entry = players[key] || {
    name: player,
    parties: 0,
    victoires: 0,
    defaites: 0,
    meilleureSerie: 0,
    serieActuelle: 0,
    dernierTheme: null,
    dernierJoue: null,
  };
  entry.name = player; // conserve la casse la plus récente utilisée
  entry.parties += 1;
  if (result === "victoire") {
    entry.victoires += 1;
    entry.serieActuelle += 1;
    entry.meilleureSerie = Math.max(entry.meilleureSerie, entry.serieActuelle);
  } else {
    entry.defaites += 1;
    entry.serieActuelle = 0;
  }
  entry.dernierTheme = theme;
  entry.dernierJoue = new Date().toISOString();
  players[key] = entry;
  writeJSON(PLAYERS_FILE, players);

  const history = readJSONSafe(HISTORY_FILE, []);
  history.push({
    date: new Date().toISOString(),
    player,
    theme,
    result,
    livesUsed,
    livesMax,
    correctCount,
    linkCount,
  });
  // on garde un historique borné pour ne pas grossir indéfiniment
  while (history.length > 2000) history.shift();
  writeJSON(HISTORY_FILE, history);

  return entry;
}

function getLeaderboard() {
  const players = readJSONSafe(PLAYERS_FILE, {});
  return Object.values(players)
    .map((p) => ({
      ...p,
      ratio: p.parties > 0 ? Math.round((p.victoires / p.parties) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.victoires - a.victoires || b.ratio - a.ratio);
}

function getHistory(limit = 100) {
  const history = readJSONSafe(HISTORY_FILE, []);
  return history.slice(-limit).reverse();
}

module.exports = { recordSoloResult, getLeaderboard, getHistory };
