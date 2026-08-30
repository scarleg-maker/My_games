const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 1700;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------------------------------------------------
   Utilitaires
---------------------------------------------------------- */

// Génère un nombre secret de n chiffres, sans zéro en tête.
// repetition === 'unique'  -> chiffres tous différents
// repetition === 'repete'  -> les répétitions sont autorisées (ex: 12344)
function genererSecret(nbChiffres, repetition) {
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

// Évalue une proposition par rapport à un secret.
// difficulte 'facile'  -> tableau de 'vert' | 'orange' | 'rouge' par position
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

  // Mode facile : vert / orange / rouge avec gestion des doublons.
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

function parseGuess(str, nbChiffres) {
  if (!/^[0-9]+$/.test(str)) return null;
  if (str.length !== nbChiffres) return null;
  const arr = str.split('').map(Number);
  return arr;
}

// Vérifie qu'une proposition respecte la règle de répétition de la partie.
function respecteRepetition(arr, repetition) {
  if (repetition !== 'unique') return true;
  return new Set(arr).size === arr.length;
}

function nettoyerNom(nom, defaut) {
  const propre = String(nom || '').trim().slice(0, 24);
  return propre || defaut;
}

/* ----------------------------------------------------------
   État global (jeu local à un seul salon à la fois)
---------------------------------------------------------- */

let soloGame = null;
let duoGame = null;

function nouvelEtatDuoPublic() {
  if (!duoGame) return null;
  return {
    status: duoGame.status,
    digits: duoGame.digits,
    difficulty: duoGame.difficulty,
    repetition: duoGame.repetition,
    turn: duoGame.turn,
    winner: duoGame.winner,
    joueur1: {
      nom: duoGame.players.joueur1.nom,
      ready: duoGame.players.joueur1.ready,
      historique: duoGame.players.joueur1.historique,
    },
    joueur2: {
      nom: duoGame.players.joueur2.nom,
      ready: duoGame.players.joueur2.ready,
      historique: duoGame.players.joueur2.historique,
    },
  };
}

// Comme nouvelEtatDuoPublic, mais ajoute "monCode" = le code secret du joueur
// destinataire (jamais celui de l'adversaire), pour l'afficher sur sa page.
function nouvelEtatPour(joueur) {
  const base = nouvelEtatDuoPublic();
  if (!base) return null;
  const monSecret = duoGame.players[joueur] ? duoGame.players[joueur].secret : null;
  return { ...base, monCode: monSecret ? monSecret.join('') : null };
}

function diffuserEtatDuo() {
  io.to('joueur1').emit('duo-update', nouvelEtatPour('joueur1'));
  io.to('joueur2').emit('duo-update', nouvelEtatPour('joueur2'));
}

/* ----------------------------------------------------------
   API : création de partie depuis la page maître
---------------------------------------------------------- */

app.post('/api/new-game', (req, res) => {
  const { players, digits, difficulty, name, names, repetition } = req.body;
  const nbJoueurs = Number(players);
  const nbChiffres = Number(digits);
  const rep = repetition === 'repete' ? 'repete' : 'unique';

  if (![1, 2].includes(nbJoueurs)) return res.status(400).json({ error: 'players invalide' });
  if (nbChiffres < 3 || nbChiffres > 6) return res.status(400).json({ error: 'digits invalide' });
  if (!['facile', 'difficile'].includes(difficulty)) return res.status(400).json({ error: 'difficulty invalide' });
  if (rep === 'unique' && nbChiffres > 10) return res.status(400).json({ error: 'digits invalide' });

  if (nbJoueurs === 1) {
    soloGame = {
      digits: nbChiffres,
      difficulty,
      repetition: rep,
      secret: genererSecret(nbChiffres, rep),
      historique: [],
      tentatives: 0,
      gagne: false,
      nom: nettoyerNom(name, 'Joueur'),
    };
    return res.json({ mode: 'solo', redirect: '/solo.html' });
  }

  const noms = Array.isArray(names) ? names : [];
  duoGame = {
    digits: nbChiffres,
    difficulty,
    repetition: rep,
    status: 'choix', // choix -> jeu -> fini
    turn: null,
    winner: null,
    players: {
      joueur1: { secret: null, ready: false, historique: [], nom: nettoyerNom(noms[0], 'Joueur 1') },
      joueur2: { secret: null, ready: false, historique: [], nom: nettoyerNom(noms[1], 'Joueur 2') },
    },
  };
  diffuserEtatDuo();

  return res.json({
    mode: '2p',
    links: [`http://localhost:${PORT}/joueur1`, `http://localhost:${PORT}/joueur2`],
  });
});

/* ----------------------------------------------------------
   API : mode solo
---------------------------------------------------------- */

app.get('/api/solo/state', (req, res) => {
  if (!soloGame) return res.status(404).json({ error: 'Aucune partie solo en cours' });
  res.json({
    digits: soloGame.digits,
    difficulty: soloGame.difficulty,
    repetition: soloGame.repetition,
    historique: soloGame.historique,
    tentatives: soloGame.tentatives,
    gagne: soloGame.gagne,
    nom: soloGame.nom,
  });
});

app.post('/api/solo/guess', (req, res) => {
  if (!soloGame) return res.status(404).json({ error: 'Aucune partie solo en cours' });
  if (soloGame.gagne) return res.status(400).json({ error: 'Partie déjà terminée' });

  const guessArr = parseGuess(String(req.body.guess || ''), soloGame.digits);
  if (!guessArr) {
    return res.status(400).json({ error: `Entrez ${soloGame.digits} chiffres valides.` });
  }
  if (!respecteRepetition(guessArr, soloGame.repetition)) {
    return res.status(400).json({ error: 'Cette partie exige des chiffres uniques.' });
  }

  const resultat = evaluer(soloGame.secret, guessArr, soloGame.difficulty);
  soloGame.tentatives += 1;
  const gagne = estGagne(resultat);
  soloGame.gagne = gagne;
  soloGame.historique.push({ guess: guessArr, resultat });

  res.json({
    resultat,
    tentatives: soloGame.tentatives,
    gagne,
    secret: gagne ? soloGame.secret : undefined,
  });
});

/* ----------------------------------------------------------
   Pages joueur (mode duo)
---------------------------------------------------------- */

app.get('/joueur1', (req, res) => res.sendFile(path.join(__dirname, 'public', 'joueur.html')));
app.get('/joueur2', (req, res) => res.sendFile(path.join(__dirname, 'public', 'joueur.html')));

/* ----------------------------------------------------------
   Socket.io : mode duo en temps réel
---------------------------------------------------------- */

io.on('connection', (socket) => {
  socket.on('rejoindre', ({ joueur, nom }) => {
    socket.data.joueur = joueur;
    socket.join(joueur);
    if (duoGame && nom) {
      duoGame.players[joueur].nom = nettoyerNom(nom, duoGame.players[joueur].nom);
      diffuserEtatDuo();
    } else {
      socket.emit('duo-update', nouvelEtatPour(joueur));
    }
  });

  socket.on('definir-nom', ({ joueur, nom }) => {
    if (!duoGame) return;
    duoGame.players[joueur].nom = nettoyerNom(nom, duoGame.players[joueur].nom);
    diffuserEtatDuo();
  });

  socket.on('definir-secret', ({ joueur, secret, nom }) => {
    if (!duoGame || duoGame.status !== 'choix') return;
    const nbChiffres = duoGame.digits;
    const arr = parseGuess(String(secret || ''), nbChiffres);
    if (!arr) {
      socket.emit('erreur', { message: `Choisissez ${nbChiffres} chiffres (0 à 9).` });
      return;
    }
    if (!respecteRepetition(arr, duoGame.repetition)) {
      socket.emit('erreur', { message: `Choisissez ${nbChiffres} chiffres uniques.` });
      return;
    }
    if (nom) duoGame.players[joueur].nom = nettoyerNom(nom, duoGame.players[joueur].nom);
    duoGame.players[joueur].secret = arr;
    duoGame.players[joueur].ready = true;

    const { joueur1, joueur2 } = duoGame.players;
    if (joueur1.ready && joueur2.ready) {
      duoGame.status = 'jeu';
      duoGame.turn = Math.random() < 0.5 ? 'joueur1' : 'joueur2';
    }
    diffuserEtatDuo();
  });

  socket.on('proposition', ({ joueur, guess }) => {
    if (!duoGame || duoGame.status !== 'jeu') return;
    if (duoGame.turn !== joueur) {
      socket.emit('erreur', { message: "Ce n'est pas votre tour." });
      return;
    }
    const adversaire = joueur === 'joueur1' ? 'joueur2' : 'joueur1';
    const nbChiffres = duoGame.digits;
    const arr = parseGuess(String(guess || ''), nbChiffres);
    if (!arr) {
      socket.emit('erreur', { message: `Entrez ${nbChiffres} chiffres (0 à 9).` });
      return;
    }
    if (!respecteRepetition(arr, duoGame.repetition)) {
      socket.emit('erreur', { message: `Entrez ${nbChiffres} chiffres uniques.` });
      return;
    }

    const secretAdversaire = duoGame.players[adversaire].secret;
    const resultat = evaluer(secretAdversaire, arr, duoGame.difficulty);
    const gagne = estGagne(resultat);

    duoGame.players[joueur].historique.push({ guess: arr, resultat });

    if (gagne) {
      duoGame.status = 'fini';
      duoGame.winner = joueur;
    } else {
      duoGame.turn = adversaire;
    }
    diffuserEtatDuo();
  });

  socket.on('demander-etat', () => {
    const joueur = socket.data.joueur;
    socket.emit('duo-update', joueur ? nouvelEtatPour(joueur) : nouvelEtatDuoPublic());
  });
});

server.listen(PORT, () => {
  console.log(`Mastermind disponible sur http://localhost:${PORT}`);
});
