// ===================================================================
//  JEU DES ENCHERES — MODE A : "Temps réel"
//  Serveur Node.js (Express + Socket.IO), avec SALONS (plusieurs parties
//  séparées en simultané sur le même serveur, chacune avec son propre code).
//  Tous les fichiers (page principale, page joueur, styles, serveur)
//  vivent dans CE MÊME dossier.
//
//  Port : 5500
//  Accueil (créer un salon)      : http://localhost:5500/
//  Maître d'un salon              : http://localhost:5500/{CODE}
//  Joueurs d'un salon              : http://<ip-du-serveur>:5500/{CODE}/joueur1  ...  /joueur8
// ===================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e8 }); // limite haute pour transférer les images en base64

const PORT = 5500;

app.use(express.json());
// Sert les fichiers statiques (shared.css, socket.io client, etc.) depuis ce dossier
app.use(express.static(__dirname));

// -------------------------------------------------------------------
//  CONSTANTES DE JEU
// -------------------------------------------------------------------
const WAIT_FIRST_BID_MS = 10000; // 10s avant la 1ère enchère
const OVERBID_MS = 5000;         // 5s après chaque enchère
const BID_STEPS = [5, 10, 20];   // tranches d'enchère possibles, au choix du joueur (M)
const MIN_BID_STEP = Math.min(...BID_STEPS);
const NO_BID_PENALTY = 20;       // pénalité si personne n'enchérit (M)

// -------------------------------------------------------------------
//  SALONS (chaque salon = une partie isolée, avec son propre état)
// -------------------------------------------------------------------
const rooms = new Map(); // code -> room
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L (évite les confusions à l'oral/à l'écrit)
const CODE_RE = /^[A-Z0-9]{3,10}$/;
const RESERVED = new Set(['API', 'STATIC', 'JOUEUR', 'MAITRE', 'FAVICON', 'SOCKET']);
const ROOM_IDLE_MS = 4 * 3600 * 1000; // un salon sans personne connectée depuis 4h est supprimé
const MAX_ROOMS = 200;

function createEmptyGame() {
    return {
        status: 'lobby', // 'lobby' | 'running' | 'finished'
        startingMoney: 500,
        maxPurchases: 5,
        players: [],       // {slot, name, money, itemCount, collection:[{name,price}]}
        images: [],         // file d'images restantes {name, dataURL}
        totalImages: 0,
        currentImage: null, // {name, dataURL}
        currentBid: 0,
        highestBidderSlot: null,
        phase: null,        // 'waiting' | 'overbid' | 'result'
        timerEnd: 0,
        roundResult: null,  // {type:'won'|'nobid'|'skipped', winnerName, price, imageName}
        finishReason: null, // 'noImages' | 'maxPurchases' | 'noMoney'
    };
}

function createRoom(code) {
    return {
        code,
        game: createEmptyGame(),
        roundTimer: null,           // timeout pour la fin de la fenêtre d'enchère
        connectedSlots: new Map(),  // slot(int) -> socket.id (pour l'écran d'attente du maître)
        lastActivity: Date.now(),
    };
}

function validCode(c) {
    return CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR[1-8]$/.test(c);
}
function cleanCode(c) {
    return String(c || '').trim().toUpperCase();
}
function newRoomCode() {
    for (let len = 4; ; len++) {
        for (let i = 0; i < 50; i++) {
            let c = '';
            for (let k = 0; k < len; k++) c += ALPHABET[(Math.random() * ALPHABET.length) | 0];
            if (!rooms.has(c) && validCode(c)) return c;
        }
    }
}
function purgeRooms(force) {
    const now = Date.now();
    for (const [code, room] of rooms) {
        const clientsInRoom = io.sockets.adapter.rooms.get(code);
        const count = clientsInRoom ? clientsInRoom.size : 0;
        if (count === 0 && (force || now - room.lastActivity > ROOM_IDLE_MS)) {
            if (room.roundTimer) clearTimeout(room.roundTimer);
            rooms.delete(code);
        }
    }
}
setInterval(() => purgeRooms(false), 10 * 60 * 1000);
function touch(room) { room.lastActivity = Date.now(); }

// -------------------------------------------------------------------
//  LOGIQUE DE PARTIE (toutes les fonctions prennent le salon en paramètre,
//  pour que plusieurs parties tournent en parallèle sans se marcher dessus)
// -------------------------------------------------------------------
function getPlayer(room, slot) {
    return room.game.players.find(p => p.slot === slot);
}
function connectedCount(room, slot) {
    return room.connectedSlots.has(slot);
}

// Instantané public de l'état (sans forcément l'image, envoyée à part)
// NB : les collections ne contiennent ici que nom/prix (pas les miniatures), pour rester léger
// sur les diffusions fréquentes (à chaque enchère). Les miniatures voyagent via 'collectionsSync'
// (à la connexion) et 'itemWon' (en direct, à chaque achat) — voir plus bas.
function publicState(room) {
    const game = room.game;
    return {
        roomCode: room.code,
        status: game.status,
        startingMoney: game.startingMoney,
        maxPurchases: game.maxPurchases,
        players: game.players.map(p => ({
            slot: p.slot,
            name: p.name,
            money: p.money,
            itemCount: p.itemCount,
            collection: p.collection.map(c => ({ name: c.name, price: c.price })),
            connected: connectedCount(room, p.slot),
        })),
        totalImages: game.totalImages,
        imagesRemaining: game.images.length,
        currentImageName: game.currentImage ? game.currentImage.name : null,
        currentBid: game.currentBid,
        highestBidderSlot: game.highestBidderSlot,
        highestBidderName: game.highestBidderSlot ? (getPlayer(room, game.highestBidderSlot) || {}).name : null,
        phase: game.phase,
        timerEnd: game.timerEnd,
        roundResult: game.roundResult,
        finishReason: game.finishReason,
        lobbySlots: game.status === 'lobby' ? [...room.connectedSlots.keys()] : undefined,
    };
}

// Collections complètes (avec miniatures en base64), envoyées uniquement à la connexion/reconnexion
function fullCollectionsPayload(room) {
    return room.game.players.map(p => ({
        slot: p.slot,
        collection: p.collection, // {name, price, dataURL}
    }));
}

function broadcastState(room) {
    io.to(room.code).emit('gameState', publicState(room));
}

function sendCurrentImageTo(room, target) {
    const game = room.game;
    if (game.currentImage) {
        target.emit('newImage', {
            name: game.currentImage.name,
            dataURL: game.currentImage.dataURL,
            imagesRemaining: game.images.length,
            totalImages: game.totalImages,
        });
    }
}

function syncClient(room, socket) {
    socket.emit('gameState', publicState(room));
    sendCurrentImageTo(room, socket);
    socket.emit('collectionsSync', fullCollectionsPayload(room));
}

function startRoundTimer(room, durationMs) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    room.game.timerEnd = Date.now() + durationMs;
    room.roundTimer = setTimeout(() => onRoundTimeout(room), durationMs);
}

function drawNextImage(room) {
    const game = room.game;
    // Vérifie les conditions de fin AVANT de tirer une nouvelle image
    if (game.images.length === 0) {
        return endGame(room, 'noImages');
    }
    const eligible = game.players.filter(p => p.itemCount < game.maxPurchases);
    if (eligible.length === 0) {
        return endGame(room, 'maxPurchases');
    }
    if (eligible.every(p => p.money < MIN_BID_STEP)) {
        return endGame(room, 'noMoney');
    }

    const idx = Math.floor(Math.random() * game.images.length);
    game.currentImage = game.images.splice(idx, 1)[0];
    game.currentBid = 0;
    game.highestBidderSlot = null;
    game.phase = 'waiting';
    game.roundResult = null;

    io.to(room.code).emit('newImage', {
        name: game.currentImage.name,
        dataURL: game.currentImage.dataURL,
        imagesRemaining: game.images.length,
        totalImages: game.totalImages,
    });

    startRoundTimer(room, WAIT_FIRST_BID_MS);
    broadcastState(room);
}

function onRoundTimeout(room) {
    room.roundTimer = null;
    const game = room.game;
    if (game.status !== 'running') return;

    if (game.phase === 'waiting') {
        // Personne n'a enchéri du tout -> pénalité pour tous, comme "Passer l'image"
        game.players.forEach(p => { p.money = Math.max(0, p.money - NO_BID_PENALTY); });
        game.roundResult = {
            type: 'nobid',
            imageName: game.currentImage.name,
            penalty: NO_BID_PENALTY,
        };
    } else if (game.phase === 'overbid') {
        const winner = getPlayer(room, game.highestBidderSlot);
        winner.money -= game.currentBid;
        winner.itemCount += 1;
        const item = { name: game.currentImage.name, price: game.currentBid, dataURL: game.currentImage.dataURL };
        winner.collection.push(item);
        game.roundResult = {
            type: 'won',
            winnerName: winner.name,
            price: game.currentBid,
            imageName: game.currentImage.name,
        };
        // Diffusion immédiate de la miniature achetée (mise à jour en direct, sans attendre une reconnexion)
        io.to(room.code).emit('itemWon', { slot: winner.slot, name: item.name, price: item.price, dataURL: item.dataURL });
    }

    game.phase = 'result';
    broadcastState(room);
    // Le maître doit cliquer sur "Image suivante" pour relancer une manche (voir 'startRound').
}

function endGame(room, reason) {
    if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
    room.game.status = 'finished';
    room.game.phase = null;
    room.game.finishReason = reason;
    room.game.currentImage = null;
    broadcastState(room);
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// -------------------------------------------------------------------
//  SOCKET.IO
// -------------------------------------------------------------------
io.on('connection', (socket) => {

    socket.on('register', ({ role, slot, room: roomCode }) => {
        const code = cleanCode(roomCode);
        const room = rooms.get(code);
        if (!validCode(code) || !room) {
            socket.emit('roomError', "Ce salon n'existe plus ou n'existe pas. Créez-en un nouveau depuis la page d'accueil.");
            return;
        }
        socket.data.role = role;
        socket.data.room = code;
        socket.join(code);
        touch(room);
        if (role === 'joueur') {
            socket.data.slot = slot;
            room.connectedSlots.set(slot, socket.id);
        }
        syncClient(room, socket);
        if (role === 'joueur') broadcastState(room); // pour mettre à jour le salon du maître
    });

    // Le maître configure et lance la partie (identique aux réglages du mode B)
    socket.on('setupGame', (payload) => {
        const room = rooms.get(socket.data.room);
        if (!room || socket.data.role !== 'maitre') return;
        if (room.game.status === 'running') return;
        touch(room);

        const { playerCount, startingMoney, maxPurchases, playerNames, images } = payload;

        if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
            return socket.emit('setupError', 'Nombre de joueurs invalide (2 à 8).');
        }
        if (!Number.isInteger(startingMoney) || startingMoney < 10 || startingMoney % 10 !== 0) {
            return socket.emit('setupError', "La somme de départ doit être un multiple de 10, d'au moins 10 M.");
        }
        if (!Number.isInteger(maxPurchases) || maxPurchases < 1 || maxPurchases > 10) {
            return socket.emit('setupError', 'Nombre d\'achats max invalide (1 à 10).');
        }
        if (!Array.isArray(images) || images.length === 0) {
            return socket.emit('setupError', 'Aucune image chargée.');
        }

        room.game = createEmptyGame();
        const game = room.game;
        game.startingMoney = startingMoney;
        game.maxPurchases = maxPurchases;
        game.images = shuffle(images);
        game.totalImages = images.length;
        game.players = [];
        for (let i = 1; i <= playerCount; i++) {
            const name = (playerNames[i - 1] && playerNames[i - 1].trim()) || `Joueur ${i}`;
            game.players.push({ slot: i, name, money: startingMoney, itemCount: 0, collection: [] });
        }
        game.status = 'running';

        broadcastState(room);
        // Réinitialise les collections/miniatures côté clients (nouvelle partie = tout est vide)
        io.to(room.code).emit('collectionsSync', fullCollectionsPayload(room));
        // Pas de tirage automatique : le maître lance chaque manche manuellement (voir 'startRound').
    });

    // Le maître lance manuellement chaque manche (1ère image, puis chaque image suivante)
    socket.on('startRound', () => {
        const room = rooms.get(socket.data.room);
        if (!room || socket.data.role !== 'maitre') return;
        if (room.game.status !== 'running') return;
        if (room.game.phase === 'waiting' || room.game.phase === 'overbid') return; // une manche est déjà en cours
        touch(room);
        drawNextImage(room);
    });

    // Le maître passe l'image en cours sans pénalité (aucun argent retiré, aucun gagnant désigné)
    socket.on('skipRound', () => {
        const room = rooms.get(socket.data.room);
        if (!room || socket.data.role !== 'maitre') return;
        const game = room.game;
        if (game.status !== 'running') return;
        if (game.phase !== 'waiting' && game.phase !== 'overbid') return; // pas de manche active à passer
        touch(room);
        if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
        game.roundResult = { type: 'skipped', imageName: game.currentImage.name };
        game.phase = 'result';
        broadcastState(room);
    });

    // Un joueur enchérit, en choisissant sa tranche (+5M, +10M ou +20M)
    socket.on('placeBid', (payload) => {
        const room = rooms.get(socket.data.room);
        if (!room || socket.data.role !== 'joueur') return;
        const game = room.game;
        if (game.status !== 'running') return;
        if (game.phase !== 'waiting' && game.phase !== 'overbid') return;

        const amount = payload && Number.isInteger(payload.amount) ? payload.amount : null;
        if (!BID_STEPS.includes(amount)) {
            return socket.emit('bidError', 'Tranche d\'enchère invalide.');
        }

        const player = getPlayer(room, socket.data.slot);
        if (!player) return;
        if (player.itemCount >= game.maxPurchases) {
            return socket.emit('bidError', "Vous avez atteint votre nombre d'achats maximum.");
        }
        if (game.highestBidderSlot === player.slot) {
            return socket.emit('bidError', 'Vous êtes déjà le plus offrant.');
        }
        const nextBid = game.currentBid + amount;
        if (player.money < nextBid) {
            return socket.emit('bidError', 'Fonds insuffisants.');
        }

        touch(room);
        game.currentBid = nextBid;
        game.highestBidderSlot = player.slot;
        game.phase = 'overbid';
        startRoundTimer(room, OVERBID_MS);
        broadcastState(room);
    });

    // Le maître peut réinitialiser pour relancer une nouvelle partie dans le même salon
    // (le code et les liens joueurs restent valables, inutile de les repartager)
    socket.on('resetGame', () => {
        const room = rooms.get(socket.data.room);
        if (!room || socket.data.role !== 'maitre') return;
        touch(room);
        if (room.roundTimer) { clearTimeout(room.roundTimer); room.roundTimer = null; }
        room.game = createEmptyGame();
        broadcastState(room);
    });

    socket.on('disconnect', () => {
        const room = rooms.get(socket.data.room);
        if (!room) return;
        if (socket.data.role === 'joueur' && socket.data.slot != null) {
            if (room.connectedSlots.get(socket.data.slot) === socket.id) {
                room.connectedSlots.delete(socket.data.slot);
            }
            broadcastState(room);
        }
    });
});

// -------------------------------------------------------------------
//  ROUTES HTTP
// -------------------------------------------------------------------

// Page d'accueil : choix du mode, et pour le mode A, création/rejoint d'un salon
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Jeu_des_Encheres.html'));
});

app.get('/favicon.ico', (req, res) => { res.status(204).end(); });

// Crée un nouveau salon (bouton "Créer un salon" sur la page d'accueil)
app.post('/api/rooms', (req, res) => {
    if (rooms.size >= MAX_ROOMS) purgeRooms(true);
    if (rooms.size >= MAX_ROOMS) {
        return res.json({ ok: false, error: 'Trop de salons actifs sur ce serveur, réessayez plus tard.' });
    }
    const code = newRoomCode();
    rooms.set(code, createRoom(code));
    res.json({ ok: true, code });
});

// Vérifie qu'un salon existe (utilisé par la page joueur pour un message d'erreur clair)
app.get('/api/rooms/:code', (req, res) => {
    const code = cleanCode(req.params.code);
    const room = validCode(code) ? rooms.get(code) : null;
    res.json({ exists: !!room, code });
});

// Anciennes adresses sans salon -> accueil (pour les liens enregistrés avant l'ajout des salons)
app.get(/^\/(joueur[1-8]|maitre)\/?$/i, (req, res) => {
    res.redirect('/');
});

// Page maître d'un salon : /{CODE}
app.get(/^\/([A-Za-z0-9]{3,10})$/, (req, res, next) => {
    const code = cleanCode(req.params[0]);
    if (!validCode(code)) return next();
    res.sendFile(path.join(__dirname, 'Jeu_des_Encheres.html'));
});

// Pages joueurs d'un salon : /{CODE}/joueur1 à /{CODE}/joueur8
app.get(/^\/([A-Za-z0-9]{3,10})\/joueur([1-8])$/, (req, res, next) => {
    const code = cleanCode(req.params[0]);
    if (!validCode(code)) return next();
    res.sendFile(path.join(__dirname, 'joueur.html'));
});

app.use((req, res) => {
    res.status(404).send('Page introuvable');
});

function lanUrls() {
    const os = require('os');
    const nets = os.networkInterfaces();
    const urls = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${PORT}`);
        }
    }
    return urls;
}

server.listen(PORT, () => {
    console.log(`Jeu des Enchères démarré.`);
    console.log(`Accueil (créer un salon) : http://localhost:${PORT}/`);
    for (const u of lanUrls()) console.log(`Depuis le réseau local   : ${u}/`);
});
