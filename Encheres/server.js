// ===================================================================
//  JEU DES ENCHERES — MODE A : "Temps réel"
//  Serveur Node.js (Express + Socket.IO)
//  Tous les fichiers (page principale, page joueur, styles, serveur)
//  vivent dans CE MÊME dossier.
//
//  Port : 5500
//  Maître : http://localhost:5500/   (ou /maitre)
//  Joueurs : http://<ip-du-serveur>:5500/joueur1  ...  /joueur8
// ===================================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e8 }); // limite haute pour transférer les images en base64

const PORT = 5500;

// Sert les fichiers statiques (shared.css, socket.io client, etc.) depuis ce dossier
app.use(express.static(__dirname));

// Page principale (réglages + choix du mode A/B + suivi de la partie en direct pour le mode A)
app.get(['/', '/maitre'], (req, res) => {
    res.sendFile(path.join(__dirname, 'Jeu_des_Encheres.html'));
});

// Pages joueurs : /joueur1 à /joueur8
app.get(/^\/joueur([1-8])$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'joueur.html'));
});

// -------------------------------------------------------------------
//  ETAT DU JEU (une seule partie active à la fois sur ce serveur)
// -------------------------------------------------------------------
const WAIT_FIRST_BID_MS = 10000; // 10s avant la 1ère enchère
const OVERBID_MS = 5000;         // 5s après chaque enchère
const BID_STEPS = [5, 10, 20];   // tranches d'enchère possibles, au choix du joueur (M)
const MIN_BID_STEP = Math.min(...BID_STEPS);
const NO_BID_PENALTY = 20;       // pénalité si personne n'enchérit (M)

let game = createEmptyGame();
let roundTimer = null;          // timeout pour la fin de la fenêtre d'enchère
const connectedSlots = new Map(); // slot(int) -> socket.id (pour l'écran d'attente du maître, avant/pendant la partie)

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
        roundResult: null,  // {type:'won'|'nobid', winnerName, price, imageName}
        finishReason: null, // 'noImages' | 'maxPurchases' | 'noMoney'
    };
}

function clearTimers() {
    if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getPlayer(slot) {
    return game.players.find(p => p.slot === slot);
}

function connectedCount(slot) {
    return connectedSlots.has(slot);
}

// Instantané public de l'état (sans forcément l'image, envoyée à part)
// NB : les collections ne contiennent ici que nom/prix (pas les miniatures), pour rester léger
// sur les diffusions fréquentes (à chaque enchère). Les miniatures voyagent via 'collectionsSync'
// (à la connexion) et 'itemWon' (en direct, à chaque achat) — voir plus bas.
function publicState() {
    return {
        status: game.status,
        startingMoney: game.startingMoney,
        maxPurchases: game.maxPurchases,
        players: game.players.map(p => ({
            slot: p.slot,
            name: p.name,
            money: p.money,
            itemCount: p.itemCount,
            collection: p.collection.map(c => ({ name: c.name, price: c.price })),
            connected: connectedCount(p.slot),
        })),
        totalImages: game.totalImages,
        imagesRemaining: game.images.length,
        currentImageName: game.currentImage ? game.currentImage.name : null,
        currentBid: game.currentBid,
        highestBidderSlot: game.highestBidderSlot,
        highestBidderName: game.highestBidderSlot ? (getPlayer(game.highestBidderSlot) || {}).name : null,
        phase: game.phase,
        timerEnd: game.timerEnd,
        roundResult: game.roundResult,
        finishReason: game.finishReason,
        lobbySlots: game.status === 'lobby' ? [...connectedSlots.keys()] : undefined,
    };
}

// Collections complètes (avec miniatures en base64), envoyées uniquement à la connexion/reconnexion
function fullCollectionsPayload() {
    return game.players.map(p => ({
        slot: p.slot,
        collection: p.collection, // {name, price, dataURL}
    }));
}

function broadcastState() {
    io.emit('gameState', publicState());
}

function sendCurrentImageTo(target) {
    if (game.currentImage) {
        target.emit('newImage', {
            name: game.currentImage.name,
            dataURL: game.currentImage.dataURL,
            imagesRemaining: game.images.length,
            totalImages: game.totalImages,
        });
    }
}

function syncClient(socket) {
    socket.emit('gameState', publicState());
    sendCurrentImageTo(socket);
    socket.emit('collectionsSync', fullCollectionsPayload());
}

// -------------------------------------------------------------------
//  LOGIQUE DE PARTIE
// -------------------------------------------------------------------

function startRoundTimer(durationMs) {
    if (roundTimer) clearTimeout(roundTimer);
    game.timerEnd = Date.now() + durationMs;
    roundTimer = setTimeout(onRoundTimeout, durationMs);
}

function drawNextImage() {
    // Vérifie les conditions de fin AVANT de tirer une nouvelle image
    if (game.images.length === 0) {
        return endGame('noImages');
    }
    const eligible = game.players.filter(p => p.itemCount < game.maxPurchases);
    if (eligible.length === 0) {
        return endGame('maxPurchases');
    }
    if (eligible.every(p => p.money < MIN_BID_STEP)) {
        return endGame('noMoney');
    }

    const idx = Math.floor(Math.random() * game.images.length);
    game.currentImage = game.images.splice(idx, 1)[0];
    game.currentBid = 0;
    game.highestBidderSlot = null;
    game.phase = 'waiting';
    game.roundResult = null;

    io.emit('newImage', {
        name: game.currentImage.name,
        dataURL: game.currentImage.dataURL,
        imagesRemaining: game.images.length,
        totalImages: game.totalImages,
    });

    startRoundTimer(WAIT_FIRST_BID_MS);
    broadcastState();
}

function onRoundTimeout() {
    roundTimer = null;
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
        const winner = getPlayer(game.highestBidderSlot);
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
        io.emit('itemWon', { slot: winner.slot, name: item.name, price: item.price, dataURL: item.dataURL });
    }

    game.phase = 'result';
    broadcastState();
    // Le maître doit cliquer sur "Image suivante" pour relancer une manche (voir 'startRound').
}

function endGame(reason) {
    clearTimers();
    game.status = 'finished';
    game.phase = null;
    game.finishReason = reason;
    game.currentImage = null;
    broadcastState();
}

// -------------------------------------------------------------------
//  SOCKET.IO
// -------------------------------------------------------------------
io.on('connection', (socket) => {

    socket.on('register', ({ role, slot }) => {
        socket.data.role = role;
        if (role === 'joueur') {
            socket.data.slot = slot;
            connectedSlots.set(slot, socket.id);
        }
        syncClient(socket);
        if (role === 'joueur') broadcastState(); // pour mettre à jour le salon du maître
    });

    // Le maître configure et lance la partie (identique aux réglages du mode B)
    socket.on('setupGame', (payload) => {
        if (socket.data.role !== 'maitre') return;
        if (game.status === 'running') return;

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

        game = createEmptyGame();
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

        broadcastState();
        // Réinitialise les collections/miniatures côté clients (nouvelle partie = tout est vide)
        io.emit('collectionsSync', fullCollectionsPayload());
        // Pas de tirage automatique : le maître lance chaque manche manuellement (voir 'startRound').
    });

    // Le maître lance manuellement chaque manche (1ère image, puis chaque image suivante)
    socket.on('startRound', () => {
        if (socket.data.role !== 'maitre') return;
        if (game.status !== 'running') return;
        if (game.phase === 'waiting' || game.phase === 'overbid') return; // une manche est déjà en cours
        drawNextImage();
    });

    // Le maître passe l'image en cours sans pénalité (aucun argent retiré, aucun gagnant désigné)
    socket.on('skipRound', () => {
        if (socket.data.role !== 'maitre') return;
        if (game.status !== 'running') return;
        if (game.phase !== 'waiting' && game.phase !== 'overbid') return; // pas de manche active à passer
        if (roundTimer) { clearTimeout(roundTimer); roundTimer = null; }
        game.roundResult = { type: 'skipped', imageName: game.currentImage.name };
        game.phase = 'result';
        broadcastState();
    });

    // Un joueur enchérit, en choisissant sa tranche (+5M, +10M ou +20M)
    socket.on('placeBid', (payload) => {
        if (socket.data.role !== 'joueur') return;
        if (game.status !== 'running') return;
        if (game.phase !== 'waiting' && game.phase !== 'overbid') return;

        const amount = payload && Number.isInteger(payload.amount) ? payload.amount : null;
        if (!BID_STEPS.includes(amount)) {
            return socket.emit('bidError', 'Tranche d\'enchère invalide.');
        }

        const player = getPlayer(socket.data.slot);
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

        game.currentBid = nextBid;
        game.highestBidderSlot = player.slot;
        game.phase = 'overbid';
        startRoundTimer(OVERBID_MS);
        broadcastState();
    });

    // Le maître peut réinitialiser pour relancer une nouvelle partie depuis le salon
    socket.on('resetGame', () => {
        if (socket.data.role !== 'maitre') return;
        clearTimers();
        game = createEmptyGame();
        broadcastState();
    });

    socket.on('disconnect', () => {
        if (socket.data.role === 'joueur' && socket.data.slot != null) {
            if (connectedSlots.get(socket.data.slot) === socket.id) {
                connectedSlots.delete(socket.data.slot);
            }
            broadcastState();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Jeu des Enchères démarré.`);
    console.log(`Maître  : http://localhost:${PORT}/  (ou /maitre)`);
    console.log(`Joueurs : http://<IP-de-ce-PC>:${PORT}/joueur1  (jusqu'à /joueur8)`);
});
