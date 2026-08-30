const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10200;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const DEFAULT_STATS = {
  playerName: 'Joueur',
  wins: 0,
  losses: 0,
  gamesPlayed: 0,
  bestQuota: 0,
  currentStreak: 0,
  bestStreak: 0,
  gils: 1000,
  history: []
};

function readStats(cb) {
  fs.readFile(STATS_FILE, 'utf8', (err, data) => {
    if (err) return cb(null, Object.assign({}, DEFAULT_STATS));
    try {
      const parsed = JSON.parse(data);
      cb(null, Object.assign({}, DEFAULT_STATS, parsed));
    } catch (e) {
      cb(null, Object.assign({}, DEFAULT_STATS));
    }
  });
}

function writeStats(stats, cb) {
  fs.mkdir(path.dirname(STATS_FILE), { recursive: true }, () => {
    fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2), 'utf8', cb);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req, cb) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      cb(null, JSON.parse(body || '{}'));
    } catch (e) {
      cb(e, null);
    }
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Introuvable');
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- GET current stats ----
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    return readStats((err, stats) => sendJson(res, 200, stats));
  }

  // ---- Record the outcome of a match against a chosen dealer ----
  if (url.pathname === '/api/stats/result' && req.method === 'POST') {
    readBody(req, (err, payload) => {
      if (err) return sendJson(res, 400, { error: 'JSON invalide' });

      readStats((_e, stats) => {
        const outcome = payload.outcome; // 'win' | 'loss'
        const quotaReached = Number(payload.quotaReached) || 0;
        const quotaTarget = Number(payload.quotaTarget) || 0;
        const dealerId = Number.isInteger(payload.dealerId) ? payload.dealerId : null;
        const gilsEarned = Math.max(0, Number(payload.gilsEarned) || 0);

        stats.gamesPlayed += 1;
        if (quotaReached > stats.bestQuota) stats.bestQuota = quotaReached;
        if (outcome === 'win') stats.gils += gilsEarned;

        if (outcome === 'win') {
          stats.wins += 1;
          stats.currentStreak = stats.currentStreak > 0 ? stats.currentStreak + 1 : 1;
        } else {
          stats.losses += 1;
          stats.currentStreak = stats.currentStreak < 0 ? stats.currentStreak - 1 : -1;
        }
        if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;

        stats.history.unshift({
          date: new Date().toISOString(),
          outcome,
          quotaReached,
          quotaTarget,
          dealerId,
          gilsEarned: outcome === 'win' ? gilsEarned : 0
        });
        stats.history = stats.history.slice(0, 25);

        writeStats(stats, () => sendJson(res, 200, stats));
      });
    });
    return;
  }

  // ---- Partial reset: subtract the same amount from wins AND losses, paid in Gils ----
  if (url.pathname === '/api/stats/adjust' && req.method === 'POST') {
    readBody(req, (err, payload) => {
      if (err) return sendJson(res, 400, { error: 'JSON invalide' });
      const amount = Math.floor(Number(payload.amount) || 0);
      const GIL_COST_PER_POINT = 200;

      readStats((_e, stats) => {
        if (amount <= 0) {
          return sendJson(res, 400, { error: 'Le nombre doit être supérieur à 0.' });
        }
        if (amount > stats.losses) {
          return sendJson(res, 400, {
            error: `Impossible de soustraire ${amount} : tu n'as que ${stats.losses} défaite(s) en stock.`
          });
        }
        const cost = amount * GIL_COST_PER_POINT;
        if (cost > stats.gils) {
          return sendJson(res, 400, {
            error: `Gils insuffisants : ${cost} G nécessaires, tu as ${stats.gils} G.`
          });
        }

        stats.wins = Math.max(0, stats.wins - amount);
        stats.losses = Math.max(0, stats.losses - amount);
        stats.gils -= cost;
        stats.gamesPlayed = stats.wins + stats.losses;
        writeStats(stats, () => sendJson(res, 200, stats));
      });
    });
    return;
  }

  // ---- Import a save (player name, wins, losses) — overwrites those fields only ----
  if (url.pathname === '/api/stats/import' && req.method === 'POST') {
    readBody(req, (err, payload) => {
      if (err) return sendJson(res, 400, { error: 'JSON invalide' });

      readStats((_e, stats) => {
        if (typeof payload.playerName === 'string' && payload.playerName.trim()) {
          stats.playerName = payload.playerName.trim().slice(0, 40);
        }
        if (Number.isFinite(payload.wins)) stats.wins = Math.max(0, Math.floor(payload.wins));
        if (Number.isFinite(payload.losses)) stats.losses = Math.max(0, Math.floor(payload.losses));
        if (Number.isFinite(payload.gils)) stats.gils = Math.max(0, Math.floor(payload.gils));
        stats.gamesPlayed = stats.wins + stats.losses;
        writeStats(stats, () => sendJson(res, 200, stats));
      });
    });
    return;
  }

  // ---- Full reset ----
  if (url.pathname === '/api/stats/reset' && req.method === 'POST') {
    const fresh = Object.assign({}, DEFAULT_STATS);
    writeStats(fresh, () => sendJson(res, 200, fresh));
    return;
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, url.pathname);
  }

  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`Sphere Break en cours d'exécution sur http://localhost:${PORT}`);
});
