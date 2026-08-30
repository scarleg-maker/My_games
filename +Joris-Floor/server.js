/**
 * ============================================================
 *  SERVEUR LOCAL - Minuteur Arbitre / Joueur
 * ============================================================
 *
 * Remplace Firebase : sert les pages web ET synchronise l'état
 * du jeu en temps réel entre la page arbitre et la page joueur,
 * uniquement via le réseau local (hotspot WiFi ou partage USB),
 * sans connexion internet.
 *
 * Lancement :
 *   1. npm install
 *   2. npm start
 *   3. Sur CE PC          : http://localhost:3000/Plateau.html
 *   4. Sur la tablette     : http://<IP-de-ce-PC>:3000/arbitre.html
 *      (l'IP dépend du mode de partage choisi, WiFi ou USB -
 *      voir le README pour savoir comment la trouver)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon'
};

// ------------------------------------------------------------
// État du jeu, tenu en mémoire (remplace la base Firebase)
// ------------------------------------------------------------
let gameState = { game: {} };

function getPath(obj, p) {
  if (!p) return obj;
  return p.split('/').filter(Boolean).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function setPath(obj, p, value) {
  const keys = p.split('/').filter(Boolean);
  if (keys.length === 0) {
    Object.keys(obj).forEach((k) => delete obj[k]);
    if (value && typeof value === 'object') Object.assign(obj, value);
    return;
  }
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

// ------------------------------------------------------------
// API : liste automatiquement les fichiers (images ou audio)
// présents dans un dossier de thème (plus besoin de lister les
// fichiers à la main dans theme-configs.js)
// ------------------------------------------------------------
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg'];

function handleListImages(req, res) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const folder = parsedUrl.searchParams.get('folder') || '';
  const type = parsedUrl.searchParams.get('type') || 'image';
  const allowedExtensions = type === 'audio' ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;

  // Sécurité : le dossier demandé doit rester dans public/
  const folderPath = path.normalize(path.join(PUBLIC_DIR, folder));
  if (!folderPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Dossier non autorisé' }));
    return;
  }

  fs.readdir(folderPath, (err, files) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ images: [], error: 'Dossier introuvable: ' + folder }));
      return;
    }
    const images = files
      .filter((f) => allowedExtensions.includes(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'fr'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ images }));
  });
}

// ------------------------------------------------------------
// API : lit une valeur précise de l'état du jeu, DIRECTEMENT
// depuis la mémoire du serveur (jamais périmée, contrairement à
// la copie mise en cache côté navigateur qui peut retarder si la
// connexion WebSocket a été coupée/suspendue un moment - cas
// fréquent sur tablette avec l'onglet en arrière-plan)
// ------------------------------------------------------------
function handleGetState(req, res) {
  const parsedUrl = new URL(req.url, 'http://localhost');
  const p = parsedUrl.searchParams.get('path') || '';
  const value = getPath(gameState, p);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ value: value === undefined ? null : value }));
}

// ------------------------------------------------------------
// Serveur HTTP (fichiers statiques : html, js, images, sons...)
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
  const reqUrlPath = req.url.split('?')[0];

  if (reqUrlPath === '/api/list-images') {
    handleListImages(req, res);
    return;
  }

  if (reqUrlPath === '/api/get-state') {
    handleGetState(req, res);
    return;
  }

  let reqPath = decodeURIComponent(reqUrlPath);
  if (reqPath === '/') reqPath = '/Plateau.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));

  // Sécurité : empêcher de sortir du dossier public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Accès interdit');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Fichier introuvable : ' + reqPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ------------------------------------------------------------
// Serveur WebSocket (relais temps réel, sur le même port)
// ------------------------------------------------------------
const wss = new WebSocketServer({ server });

function broadcast(msg, exclude) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Client connecté (%d client(s) au total)', wss.clients.size);

  // Envoie l'état complet actuel au nouveau client (équivalent au
  // premier déclenchement de onValue() avec Firebase)
  ws.send(JSON.stringify({ type: 'state', state: gameState }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (msg.type === 'set' && typeof msg.path === 'string') {
      setPath(gameState, msg.path, msg.value);
      // Diffuse la mise à jour à TOUS les clients (y compris
      // l'émetteur, pour rester cohérent avec le comportement
      // de Firebase onValue)
      broadcast({ type: 'update', path: msg.path, value: msg.value });
    }
  });

  ws.on('close', () => {
    console.log('Client déconnecté (%d client(s) restant(s))', wss.clients.size);
  });
});

server.listen(PORT, () => {
  console.log('============================================');
  console.log('  Serveur local démarré sur le port', PORT);
  console.log('  Sur ce PC       : http://localhost:' + PORT + '/Plateau.html');
  console.log('  Depuis un autre appareil du même réseau :');
  console.log('    http://<IP-de-ce-PC>:' + PORT + '/arbitre.html');
  console.log('  (voir README.md pour trouver l\'IP selon WiFi ou USB)');
  console.log('============================================');
});
