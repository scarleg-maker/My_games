// Vote_items - serveur Node.js
// Site de vote multi-appareils : chaque participant vote de 0 à 5 (par 0,5) sur une liste d'items.
// L'état est sauvegardé sur disque (data/state.json) pour pouvoir reprendre une session plus tard.

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 15000;
const DATA_FILE = path.join(__dirname, 'data', 'state.json');
const MAX_ITEMS = 30;
const VOTE_MIN = 0;
const VOTE_MAX = 5;
const VOTE_STEP = 0.5;

const app = express();
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Persistance très simple (fichier JSON) avec une file d'écriture pour éviter
// les écritures concurrentes qui se marchent dessus.
// ---------------------------------------------------------------------------

function emptyState() {
  return {
    configured: false,
    participants: [], // ["Alice", "Bob", ...]
    items: [], // ["Item 1", "Item 2", ...]
    votes: {}, // { "Alice": { values: [num|null, ...], validated: bool } }
    createdAt: null,
    updatedAt: null,
  };
}

let state = loadState();

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign(emptyState(), parsed);
  } catch (err) {
    return emptyState();
  }
}

let writeQueue = Promise.resolve();
function saveState() {
  state.updatedAt = new Date().toISOString();
  writeQueue = writeQueue.then(() => new Promise((resolve) => {
    fs.mkdir(path.dirname(DATA_FILE), { recursive: true }, () => {
      fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), (err) => {
        if (err) console.error('Erreur de sauvegarde:', err);
        resolve();
      });
    });
  }));
  return writeQueue;
}

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function isValidVoteValue(v) {
  if (v === null) return true;
  if (typeof v !== 'number' || Number.isNaN(v)) return false;
  if (v < VOTE_MIN || v > VOTE_MAX) return false;
  // doit être un multiple de 0.5 (avec tolérance flottante)
  const scaled = Math.round(v / VOTE_STEP);
  return Math.abs(scaled * VOTE_STEP - v) < 1e-9;
}

function getParticipantIndexFromNum(num) {
  const idx = parseInt(num, 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= state.participants.length) return -1;
  return idx;
}

function computeResults() {
  const n = state.items.length;
  const rows = state.items.map((label, i) => {
    let sum = 0;
    let count = 0;
    const values = {};
    for (const name of state.participants) {
      const v = state.votes[name] ? state.votes[name].values[i] : null;
      values[name] = v === undefined ? null : v;
      if (typeof v === 'number') {
        sum += v;
        count += 1;
      }
    }
    const average = count > 0 ? sum / count : null;
    return { index: i, label, values, average, count };
  });

  // Classement des items qui ont au moins une réponse, moyenne décroissante
  const ranked = rows
    .filter((r) => r.average !== null)
    .slice()
    .sort((a, b) => b.average - a.average);

  ranked.forEach((r, rank) => {
    if (rank < 8) r.highlight = 'top8';
    else if (rank < 10) r.highlight = 'top10';
    else r.highlight = null;
  });
  rows.forEach((r) => {
    if (r.highlight === undefined) r.highlight = null;
  });

  const allValidated = state.participants.length > 0 &&
    state.participants.every((name) => state.votes[name] && state.votes[name].validated);

  return { rows, allValidated };
}

function publicState() {
  const status = state.participants.map((name, i) => {
    const v = state.votes[name] || { values: [], validated: false };
    const answered = v.values.filter((x) => typeof x === 'number').length;
    return {
      num: i + 1,
      name,
      validated: !!v.validated,
      answered,
      total: state.items.length,
    };
  });
  const { rows, allValidated } = computeResults();
  return {
    configured: state.configured,
    participants: state.participants,
    items: state.items,
    status,
    results: rows,
    allValidated,
    updatedAt: state.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Routes de pages (HTML statiques, la logique est côté client via fetch)
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// /joueur1, /joueur2, ... /joueur30
app.get('/joueur:num', (req, res, next) => {
  if (!/^\d+$/.test(req.params.num)) return next();
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get('/api/state', (req, res) => {
  res.json(publicState());
});

function timestampForFilename() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

// Export lisible (.txt) : résumé complet de la session à l'instant présent,
// utile pour garder une trace / imprimer / archiver un exemplaire.
app.get('/api/export', (req, res) => {
  const { rows, allValidated } = computeResults();
  const lines = [];
  lines.push('=== Vote_items — Export de session ===');
  lines.push(`Date d'export : ${new Date().toLocaleString('fr-FR')}`);
  lines.push('');

  if (!state.configured) {
    lines.push("Aucune session n'est configurée pour le moment.");
  } else {
    lines.push(`Participants (${state.participants.length}) : ${state.participants.join(', ')}`);
    lines.push(`Items à voter (${state.items.length})`);
    lines.push('');
    lines.push(`Statut global : ${allValidated ? 'TERMINÉ — tous les participants ont validé' : 'EN COURS'}`);
    lines.push('');
    lines.push('--- Avancement par participant ---');
    state.participants.forEach((name, i) => {
      const v = state.votes[name];
      const answered = v.values.filter((x) => typeof x === 'number').length;
      lines.push(`  /joueur${i + 1} — ${name} : ${answered}/${state.items.length} items votés — ${v.validated ? 'VALIDÉ' : 'en cours'}`);
    });
    lines.push('');
    lines.push('--- Détail des votes par item ---');
    rows.forEach((r) => {
      lines.push(`${r.index + 1}. ${r.label}`);
      state.participants.forEach((name) => {
        const val = r.values[name];
        lines.push(`     - ${name} : ${val === null ? 'pas encore voté' : val}`);
      });
      const tag = r.highlight === 'top8' ? '  [TOP 8]' : r.highlight === 'top10' ? '  [9e/10e]' : '';
      lines.push(`     => Moyenne : ${r.average === null ? 'n/a' : r.average.toFixed(2)} (${r.count}/${state.participants.length} réponses)${tag}`);
      lines.push('');
    });
    lines.push('--- Classement (meilleure moyenne en premier) ---');
    rows.filter((r) => r.average !== null).slice().sort((a, b) => b.average - a.average)
      .forEach((r, idx) => lines.push(`  ${idx + 1}. ${r.label} — ${r.average.toFixed(2)}`));
  }

  const text = lines.join('\n');
  const filename = `vote-items_export_${timestampForFilename()}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(text);
});

// Sauvegarde complète restaurable (.json) : permet de reprendre une session
// plus tard, y compris sur un autre ordinateur.
app.get('/api/backup', (req, res) => {
  const filename = `vote-items_sauvegarde_${timestampForFilename()}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(state, null, 2));
});

app.post('/api/backup/restore', (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.participants) || !Array.isArray(incoming.items) || typeof incoming.votes !== 'object') {
    return res.status(400).json({ error: "Fichier de sauvegarde invalide ou incomplet." });
  }
  const restored = Object.assign(emptyState(), {
    configured: !!incoming.configured,
    participants: incoming.participants,
    items: incoming.items,
    votes: incoming.votes,
    createdAt: incoming.createdAt || new Date().toISOString(),
  });
  state = restored;
  saveState().then(() => res.json(publicState()));
});

app.post('/api/config', (req, res) => {
  let { participants, items } = req.body || {};
  if (!Array.isArray(participants) || !Array.isArray(items)) {
    return res.status(400).json({ error: 'participants et items doivent être des listes.' });
  }
  participants = participants.map((s) => String(s).trim()).filter(Boolean);
  items = items.map((s) => String(s).trim()).filter(Boolean);

  if (participants.length === 0) {
    return res.status(400).json({ error: 'Au moins un participant est requis.' });
  }
  if (items.length === 0) {
    return res.status(400).json({ error: 'Au moins un item est requis.' });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: `Maximum ${MAX_ITEMS} items.` });
  }

  // Fusion intelligente avec les votes existants : un participant et un item
  // sont considérés comme "le même" s'ils portent exactement le même nom
  // qu'avant. Leur vote est alors conservé, quelle que soit sa nouvelle
  // position dans la liste. Seuls les votes d'un item supprimé (ou renommé)
  // ou d'un participant supprimé (ou renommé) sont perdus, puisqu'il n'y a
  // alors plus rien à quoi les rattacher.
  const oldItems = state.items || [];
  const oldVotes = state.votes || {};

  const votes = {};
  for (const name of participants) {
    const oldEntry = oldVotes[name];
    const values = items.map((label) => {
      if (!oldEntry) return null;
      const oldIndex = oldItems.indexOf(label);
      if (oldIndex === -1) return null;
      const v = oldEntry.values[oldIndex];
      return typeof v === 'number' ? v : null;
    });
    // On ne conserve la validation que si ce participant était déjà validé
    // ET que tous ses votes restent renseignés après la fusion (sinon la
    // validation n'aurait plus de sens : il manquerait des votes).
    const validated = !!(oldEntry && oldEntry.validated && values.every((v) => typeof v === 'number'));
    votes[name] = { values, validated };
  }

  const isFirstConfig = !state.configured;

  state.configured = true;
  state.participants = participants;
  state.items = items;
  state.votes = votes;
  if (isFirstConfig) {
    state.createdAt = new Date().toISOString();
  }

  saveState().then(() => res.json(publicState()));
});

app.post('/api/reset', (req, res) => {
  state = emptyState();
  saveState().then(() => res.json(publicState()));
});

app.get('/api/player/:num', (req, res) => {
  const idx = getParticipantIndexFromNum(req.params.num);
  if (!state.configured) return res.status(404).json({ error: "La session n'est pas encore configurée." });
  if (idx === -1) return res.status(404).json({ error: 'Ce lien joueur ne correspond à aucun participant.' });
  const name = state.participants[idx];
  const v = state.votes[name];
  res.json({
    num: idx + 1,
    name,
    items: state.items,
    values: v.values,
    validated: v.validated,
    min: VOTE_MIN,
    max: VOTE_MAX,
    step: VOTE_STEP,
  });
});

app.post('/api/player/:num/vote', (req, res) => {
  const idx = getParticipantIndexFromNum(req.params.num);
  if (idx === -1) return res.status(404).json({ error: 'Participant introuvable.' });
  const name = state.participants[idx];
  const v = state.votes[name];
  if (v.validated) return res.status(403).json({ error: 'Vos votes sont déjà validés.' });

  const { itemIndex, value } = req.body || {};
  if (typeof itemIndex !== 'number' || itemIndex < 0 || itemIndex >= state.items.length) {
    return res.status(400).json({ error: 'itemIndex invalide.' });
  }
  if (!isValidVoteValue(value)) {
    return res.status(400).json({ error: `La valeur doit être entre ${VOTE_MIN} et ${VOTE_MAX}, par pas de ${VOTE_STEP}.` });
  }

  v.values[itemIndex] = value;
  saveState().then(() => res.json({ ok: true, values: v.values }));
});

app.post('/api/player/:num/validate', (req, res) => {
  const idx = getParticipantIndexFromNum(req.params.num);
  if (idx === -1) return res.status(404).json({ error: 'Participant introuvable.' });
  const name = state.participants[idx];
  const v = state.votes[name];
  if (v.validated) return res.json({ ok: true, validated: true });

  const missing = [];
  v.values.forEach((val, i) => {
    if (typeof val !== 'number') missing.push(i);
  });
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Tous les items doivent être votés avant de valider.', missing });
  }

  v.validated = true;
  saveState().then(() => res.json({ ok: true, validated: true }));
});

app.post('/api/player/:num/unlock', (req, res) => {
  // Permet à l'organisateur (page maître) de déverrouiller un participant
  // qui aurait besoin de corriger un vote après validation.
  const idx = getParticipantIndexFromNum(req.params.num);
  if (idx === -1) return res.status(404).json({ error: 'Participant introuvable.' });
  const name = state.participants[idx];
  state.votes[name].validated = false;
  saveState().then(() => res.json({ ok: true }));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vote_items démarré : http://localhost:${PORT}`);
  console.log('Accessible depuis un autre appareil du même réseau via votre adresse IP locale, ex: http://192.168.x.x:' + PORT);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`❌ Le port ${PORT} est déjà utilisé par un autre programme (probablement une autre instance de Vote_items déjà lancée dans un autre terminal, ou une fenêtre restée ouverte).`);
    console.error('');
    console.error('Solutions :');
    console.error(`  1) Fermez l'autre fenêtre/terminal qui fait déjà tourner "node server.js" ou "npm start", puis relancez.`);
    console.error(`  2) Ou trouvez et arrêtez le processus qui occupe le port ${PORT} :`);
    console.error(`     Windows (PowerShell) : netstat -ano | findstr :${PORT}   puis   taskkill /PID <le_PID_trouvé> /F`);
    console.error(`     macOS / Linux        : lsof -i :${PORT}                 puis   kill -9 <le_PID_trouvé>`);
    console.error(`  3) Ou démarrez Vote_items sur un autre port, par exemple :`);
    console.error(`     Windows (PowerShell) : $env:PORT=15001; npm start`);
    console.error(`     macOS / Linux        : PORT=15001 npm start`);
    console.error('');
    process.exit(1);
  }
  throw err;
});
