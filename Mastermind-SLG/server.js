const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const { MOTS } = require('./mots');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 1700;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------------------------------------------------
   Utilitaires de jeu
---------------------------------------------------------- */

// Génère un nombre secret de n chiffres, sans zéro en tête.
// repetition === 'unique'  -> chiffres tous différents
// repetition === 'repete'  -> les répétitions sont autorisées (ex: 12344)
function genererSecret(nbChiffres, repetition, type) {
  if (type === 'mots') return motAleatoire(nbChiffres).split('');
  if (repetition === 'unique') {
    const chiffres = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = chiffres.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chiffres[i], chiffres[j]] = [chiffres[j], chiffres[i]];
    }
    const selection = chiffres.slice(0, nbChiffres);
    if (selection[0] === 0) {
      const idx = selection.findIndex((c) => c !== 0);
      if (idx > 0) [selection[0], selection[idx]] = [selection[idx], selection[0]];
    }
    return selection;
  }
  const arr = [];
  for (let i = 0; i < nbChiffres; i++) {
    arr.push(i === 0 ? 1 + Math.floor(Math.random() * 9) : Math.floor(Math.random() * 10));
  }
  return arr;
}

// Tire un mot au hasard dans le dictionnaire (longueur 4 à 7).
function motAleatoire(longueur) {
  const liste = MOTS[longueur] || [];
  return liste[Math.floor(Math.random() * liste.length)];
}

// Évalue une proposition par rapport à un secret.
// difficulte 'facile'    -> tableau de 'vert' | 'orange' | 'rouge' par position
// difficulte 'difficile' -> tableau de 'vert' | 'rouge' par position (présence uniquement)
function evaluer(secretArr, guessArr, difficulte) {
  const n = secretArr.length;
  const resultat = new Array(n).fill(null);

  if (difficulte === 'difficile') {
    for (let i = 0; i < n; i++) {
      resultat[i] = secretArr.includes(guessArr[i]) ? 'vert' : 'rouge';
    }
    return resultat;
  }

  const restant = [...secretArr];
  for (let i = 0; i < n; i++) {
    if (guessArr[i] === secretArr[i]) {
      resultat[i] = 'vert';
      restant[i] = null;
    }
  }
  for (let i = 0; i < n; i++) {
    if (resultat[i] !== null) continue;
    const idx = restant.findIndex((c) => c === guessArr[i]);
    if (idx !== -1) {
      resultat[i] = 'orange';
      restant[idx] = null;
    } else {
      resultat[i] = 'rouge';
    }
  }
  return resultat;
}

function estGagne(resultat) {
  return resultat.every((c) => c === 'vert');
}

// Convertit la saisie en tableau de symboles (nombres pour le mode chiffres,
// lettres majuscules sans accent pour le mode mots). Renvoie null si invalide.
function parseGuess(str, nbChiffres, type) {
  if (type === 'mots') {
    const mot = String(str).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Œ/g, 'OE');
    if (!/^[A-Z]+$/.test(mot) || mot.length !== nbChiffres) return null;
    return mot.split('');
  }
  if (!/^[0-9]+$/.test(str)) return null;
  if (str.length !== nbChiffres) return null;
  return str.split('').map(Number);
}

function respecteRepetition(arr, repetition, type) {
  if (type === 'mots') return true; // les lettres peuvent toujours se répéter
  if (repetition !== 'unique') return true;
  return new Set(arr).size === arr.length;
}

function nettoyerNom(nom, defaut) {
  const propre = String(nom || '').trim().slice(0, 24);
  return propre || defaut;
}

function lanUrls() {
  const urls = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const i of infos || []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${PORT}`);
    }
  }
  return urls;
}

/* ----------------------------------------------------------
   Salons : chaque partie (solo ou duel) vit dans son propre
   salon, identifié par un code court, indépendant des autres.
---------------------------------------------------------- */

const salons = new Map(); // code -> salon
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I/L, pour éviter les confusions
const CODE_RE = /^[A-Z2-9]{4}$/;
const RESERVED = new Set(['API', 'STATIC']);
const SALON_IDLE_MS = 6 * 3600 * 1000; // un salon inactif depuis 6h est supprimé

const cleanCode = (c) => String(c || '').trim().toUpperCase();
const validCode = (c) => CODE_RE.test(c) && !RESERVED.has(c);

function nouveauCode() {
  for (let i = 0; i < 100; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!salons.has(c) && validCode(c)) return c;
  }
  throw new Error('Impossible de générer un code de salon');
}

function creerSalon(config) {
  const code = nouveauCode();
  const salon = {
    code,
    mode: config.mode, // 'solo' | 'duo'
    type: config.type, // 'chiffres' | 'mots'
    digits: config.digits,
    difficulty: config.difficulty,
    repetition: config.repetition,
    creeLe: Date.now(),
    derniereActivite: Date.now(),
    connectes: new Set(), // sockets connectés à ce salon (toutes pages confondues)
    solo: null,
    duo: null,
  };

  if (config.mode === 'solo') {
    salon.solo = {
      secret: genererSecret(config.digits, config.repetition, config.type),
      historique: [],
      tentatives: 0,
      gagne: false,
      nom: nettoyerNom(config.name, 'Joueur'),
    };
  } else {
    const noms = Array.isArray(config.names) ? config.names : [];
    salon.duo = {
      status: 'choix', // choix -> jeu -> fini
      turn: null,
      winner: null,
      players: {
        joueur1: { secret: null, ready: false, historique: [], nom: nettoyerNom(noms[0], 'Joueur 1') },
        joueur2: { secret: null, ready: false, historique: [], nom: nettoyerNom(noms[1], 'Joueur 2') },
      },
    };
  }

  salons.set(code, salon);
  return salon;
}

function toucher(salon) {
  salon.derniereActivite = Date.now();
}

function purgerSalons() {
  const maintenant = Date.now();
  for (const [code, salon] of salons) {
    if (salon.connectes.size === 0 && maintenant - salon.derniereActivite > SALON_IDLE_MS) {
      salons.delete(code);
    }
  }
}
setInterval(purgerSalons, 30 * 60 * 1000);

/* ----------------------------------------------------------
   États publics diffusés aux clients (jamais le secret adverse)
---------------------------------------------------------- */

function infoSalon(salon) {
  const base = {
    code: salon.code,
    mode: salon.mode,
    type: salon.type,
    digits: salon.digits,
    difficulty: salon.difficulty,
    repetition: salon.repetition,
  };
  if (salon.mode === 'duo') {
    const { joueur1, joueur2 } = salon.duo.players;
    base.duo = {
      status: salon.duo.status,
      turn: salon.duo.turn,
      winner: salon.duo.winner,
      joueur1: { nom: joueur1.nom, ready: joueur1.ready, pret: joueur1.ready },
      joueur2: { nom: joueur2.nom, ready: joueur2.ready, pret: joueur2.ready },
    };
  }
  return base;
}

function etatDuoPublic(salon) {
  const d = salon.duo;
  return {
    code: salon.code,
    type: salon.type,
    digits: salon.digits,
    difficulty: salon.difficulty,
    repetition: salon.repetition,
    status: d.status,
    turn: d.turn,
    winner: d.winner,
    joueur1: { nom: d.players.joueur1.nom, ready: d.players.joueur1.ready, historique: d.players.joueur1.historique },
    joueur2: { nom: d.players.joueur2.nom, ready: d.players.joueur2.ready, historique: d.players.joueur2.historique },
  };
}

// Comme etatDuoPublic, mais ajoute "monCode" = le code secret du joueur
// destinataire (jamais celui de l'adversaire), pour l'afficher sur sa page.
function etatDuoPour(salon, joueur) {
  const base = etatDuoPublic(salon);
  const monSecret = salon.duo.players[joueur] ? salon.duo.players[joueur].secret : null;
  return { ...base, monCode: monSecret ? monSecret.join('') : null };
}

function diffuserEtatDuo(salon) {
  io.to(`${salon.code}:joueur1`).emit('duo-update', etatDuoPour(salon, 'joueur1'));
  io.to(`${salon.code}:joueur2`).emit('duo-update', etatDuoPour(salon, 'joueur2'));
  io.to(`${salon.code}:lobby`).emit('duo-update', etatDuoPublic(salon));
}

function getSalon(code) {
  if (!validCode(code)) return null;
  return salons.get(code) || null;
}

/* ----------------------------------------------------------
   API : création et consultation des salons
---------------------------------------------------------- */

app.post('/api/salons', (req, res) => {
  const { players, digits, difficulty, name, names, repetition, type } = req.body;
  const nbJoueurs = Number(players);
  const nbChiffres = Number(digits);
  const typeJeu = type === 'mots' ? 'mots' : 'chiffres';
  const rep = repetition === 'repete' ? 'repete' : 'unique';

  if (![1, 2].includes(nbJoueurs)) return res.status(400).json({ error: 'players invalide' });
  const [minLong, maxLong] = typeJeu === 'mots' ? [4, 7] : [3, 6];
  if (!(nbChiffres >= minLong && nbChiffres <= maxLong)) return res.status(400).json({ error: 'longueur invalide' });
  if (!['facile', 'difficile'].includes(difficulty)) return res.status(400).json({ error: 'difficulty invalide' });
  if (rep === 'unique' && nbChiffres > 10) return res.status(400).json({ error: 'digits invalide' });

  const salon = creerSalon({
    mode: nbJoueurs === 1 ? 'solo' : 'duo',
    type: typeJeu,
    digits: nbChiffres,
    difficulty,
    repetition: rep,
    name,
    names,
  });

  if (salon.mode === 'solo') {
    return res.json({ mode: 'solo', code: salon.code, redirect: `/${salon.code}/solo` });
  }
  return res.json({
    mode: '2p',
    code: salon.code,
    redirect: `/${salon.code}`,
    links: [`${req.protocol}://${req.get('host')}/${salon.code}/joueur1`, `${req.protocol}://${req.get('host')}/${salon.code}/joueur2`],
  });
});

app.get('/api/salons/:code', (req, res) => {
  const salon = getSalon(cleanCode(req.params.code));
  if (!salon) return res.json({ existe: false, code: cleanCode(req.params.code) });
  res.json({ existe: true, ...infoSalon(salon) });
});

/* ----------------------------------------------------------
   API : mode solo (scopée par salon)
---------------------------------------------------------- */

app.get('/api/salons/:code/solo/state', (req, res) => {
  const salon = getSalon(cleanCode(req.params.code));
  if (!salon || salon.mode !== 'solo') return res.status(404).json({ error: 'Salon introuvable' });
  const s = salon.solo;
  res.json({
    code: salon.code,
    type: salon.type,
    digits: salon.digits,
    difficulty: salon.difficulty,
    repetition: salon.repetition,
    historique: s.historique,
    tentatives: s.tentatives,
    gagne: s.gagne,
    nom: s.nom,
  });
});

app.post('/api/salons/:code/solo/guess', (req, res) => {
  const salon = getSalon(cleanCode(req.params.code));
  if (!salon || salon.mode !== 'solo') return res.status(404).json({ error: 'Salon introuvable' });
  const s = salon.solo;
  if (s.gagne) return res.status(400).json({ error: 'Partie déjà terminée' });

  const guessArr = parseGuess(String(req.body.guess || ''), salon.digits, salon.type);
  if (!guessArr) return res.status(400).json({ error: salon.type === 'mots' ? `Entrez un mot de ${salon.digits} lettres (sans espace ni chiffre).` : `Entrez ${salon.digits} chiffres valides.` });
  if (!respecteRepetition(guessArr, salon.repetition, salon.type)) {
    return res.status(400).json({ error: 'Cette partie exige des chiffres uniques.' });
  }

  const resultat = evaluer(s.secret, guessArr, salon.difficulty);
  s.tentatives += 1;
  const gagne = estGagne(resultat);
  s.gagne = gagne;
  s.historique.push({ guess: guessArr, resultat });
  toucher(salon);

  res.json({ resultat, guess: guessArr, tentatives: s.tentatives, gagne, secret: gagne ? s.secret : undefined });
});

/* ----------------------------------------------------------
   Pages servies dynamiquement par salon
   (statiques en premier via express.static, donc on n'arrive
   ici que pour des chemins qui ne correspondent à aucun fichier)
---------------------------------------------------------- */

app.get('/:code/solo', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(404).send('Salon introuvable');
  res.sendFile(path.join(__dirname, 'public', 'solo.html'));
});

app.get('/:code/joueur1', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(404).send('Salon introuvable');
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

app.get('/:code/joueur2', (req, res) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return res.status(404).send('Salon introuvable');
  res.sendFile(path.join(__dirname, 'public', 'joueur.html'));
});

app.get('/:code', (req, res, next) => {
  const code = cleanCode(req.params.code);
  if (!validCode(code)) return next(); // laisse Express répondre 404 normalement
  res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
});

/* ----------------------------------------------------------
   Socket.io : mode duo en temps réel, isolé par salon
---------------------------------------------------------- */

io.on('connection', (socket) => {
  socket.on('rejoindre', ({ code, joueur, nom }) => {
    code = cleanCode(code);
    const salon = getSalon(code);
    if (!salon || salon.mode !== 'duo') {
      socket.emit('duo-update', null);
      return;
    }
    socket.data.code = code;
    socket.data.joueur = joueur; // 'joueur1' | 'joueur2' | undefined (spectateur lobby)
    socket.join(joueur === 'joueur1' || joueur === 'joueur2' ? `${code}:${joueur}` : `${code}:lobby`);
    salon.connectes.add(socket.id);
    toucher(salon);
    if (nom && (joueur === 'joueur1' || joueur === 'joueur2')) {
      salon.duo.players[joueur].nom = nettoyerNom(nom, salon.duo.players[joueur].nom);
    }
    diffuserEtatDuo(salon);
  });

  socket.on('definir-nom', ({ code, joueur, nom }) => {
    const salon = getSalon(cleanCode(code));
    if (!salon || salon.mode !== 'duo') return;
    salon.duo.players[joueur].nom = nettoyerNom(nom, salon.duo.players[joueur].nom);
    toucher(salon);
    diffuserEtatDuo(salon);
  });

  socket.on('definir-secret', ({ code, joueur, secret, nom }) => {
    const salon = getSalon(cleanCode(code));
    if (!salon || salon.mode !== 'duo' || salon.duo.status !== 'choix') return;
    const nbChiffres = salon.digits;
    const arr = parseGuess(String(secret || ''), nbChiffres, salon.type);
    if (!arr) {
      socket.emit('erreur', { message: salon.type === 'mots' ? `Choisissez un mot de ${nbChiffres} lettres.` : `Choisissez ${nbChiffres} chiffres (0 à 9).` });
      return;
    }
    if (!respecteRepetition(arr, salon.repetition, salon.type)) {
      socket.emit('erreur', { message: `Choisissez ${nbChiffres} chiffres uniques.` });
      return;
    }
    if (nom) salon.duo.players[joueur].nom = nettoyerNom(nom, salon.duo.players[joueur].nom);
    salon.duo.players[joueur].secret = arr;
    salon.duo.players[joueur].ready = true;

    const { joueur1, joueur2 } = salon.duo.players;
    if (joueur1.ready && joueur2.ready) {
      salon.duo.status = 'jeu';
      salon.duo.turn = Math.random() < 0.5 ? 'joueur1' : 'joueur2';
    }
    toucher(salon);
    diffuserEtatDuo(salon);
  });

  socket.on('proposition', ({ code, joueur, guess }) => {
    const salon = getSalon(cleanCode(code));
    if (!salon || salon.mode !== 'duo' || salon.duo.status !== 'jeu') return;
    if (salon.duo.turn !== joueur) {
      socket.emit('erreur', { message: "Ce n'est pas votre tour." });
      return;
    }
    const adversaire = joueur === 'joueur1' ? 'joueur2' : 'joueur1';
    const nbChiffres = salon.digits;
    const arr = parseGuess(String(guess || ''), nbChiffres, salon.type);
    if (!arr) {
      socket.emit('erreur', { message: salon.type === 'mots' ? `Entrez un mot de ${nbChiffres} lettres.` : `Entrez ${nbChiffres} chiffres (0 à 9).` });
      return;
    }
    if (!respecteRepetition(arr, salon.repetition, salon.type)) {
      socket.emit('erreur', { message: `Entrez ${nbChiffres} chiffres uniques.` });
      return;
    }

    const secretAdversaire = salon.duo.players[adversaire].secret;
    const resultat = evaluer(secretAdversaire, arr, salon.difficulty);
    const gagne = estGagne(resultat);

    salon.duo.players[joueur].historique.push({ guess: arr, resultat });

    if (gagne) {
      salon.duo.status = 'fini';
      salon.duo.winner = joueur;
    } else {
      salon.duo.turn = adversaire;
    }
    toucher(salon);
    diffuserEtatDuo(salon);
  });

  socket.on('mot-aleatoire', ({ code }) => {
    const salon = getSalon(cleanCode(code));
    if (!salon || salon.mode !== 'duo' || salon.type !== 'mots') return;
    socket.emit('mot-aleatoire', { mot: motAleatoire(salon.digits) });
  });

  socket.on('demander-etat', ({ code, joueur } = {}) => {
    const salon = getSalon(cleanCode(code));
    if (!salon || salon.mode !== 'duo') { socket.emit('duo-update', null); return; }
    socket.emit('duo-update', joueur === 'joueur1' || joueur === 'joueur2' ? etatDuoPour(salon, joueur) : etatDuoPublic(salon));
  });

  socket.on('disconnect', () => {
    const code = socket.data.code;
    const salon = code ? getSalon(code) : null;
    if (salon) {
      salon.connectes.delete(socket.id);
      toucher(salon);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Mastermind-SLG est lancé !`);
  console.log(`  Accueil (créer une partie) : http://localhost:${PORT}/`);
  for (const u of lanUrls()) console.log(`  Depuis le réseau local      : ${u}/`);
  console.log('');
});
