const EventEmitter = require("events");
const { TOKENS, COLORS } = require("./public/tokens.js");

const PALETTE = COLORS.map((c) => c.hex);
const STEP_MS = 250; // 4 cases par seconde (0,25 s par case)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class MonopolySLGGame extends EventEmitter {
  constructor(id, boardData, playerConfigs, options = {}) {
    super();
    // Règles choisies par l'hôte : argent de départ, Départ doublé, cagnotte du Parc
    this.options = {
      startMoney: Math.max(100, Math.min(50000, Math.round(Number(options.startMoney) || 1500))),
      doubleGo: !!options.doubleGo,
      // une ancienne valeur « chance » est traitée comme « cards » (toutes les cartes)
      parkMode: options.parkMode === "off" || !options.parkMode ? "off" : "cards",
    };
    this.parkPot = 0;   // cagnotte du Parc
    this.trades = [];   // propositions d'échange en attente
    this._tradeSeq = 0;
    this.id = id;
    this.boardName = boardData.name;
    this.board = boardData.spaces;
    this.groupColors = boardData.groupColors;
    this.chanceCardsSource = boardData.chanceCards;
    this.chestCardsSource = boardData.chestCards;
    this.chanceDeck = shuffledCopy(this.chanceCardsSource);
    this.chanceIndex = 0;
    this.chestDeck = shuffledCopy(this.chestCardsSource);
    this.chestIndex = 0;

    this.players = playerConfigs.map((cfg, i) => ({
      id: i,
      name: (cfg.name && cfg.name.trim()) || (cfg.type === "ai" ? `IA ${i + 1}` : `Joueur ${i + 1}`),
      type: cfg.type === "ai" ? "ai" : "human",
      color: cfg.color || PALETTE[i % PALETTE.length],
      token: cfg.token || TOKENS[i % TOKENS.length].id,
      money: this.options.startMoney,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
    }));

    this.properties = {};
    this.currentPlayerIndex = 0;
    this.doublesCount = 0;
    this.lastDiceSum = 0;
    this.hasRolled = false;
    this.moving = false;   // un pion est en train de se déplacer
    this.rolling = false;  // les dés sont en train de rouler
    this.dice = [null, null];
    this.gameOver = false;
    this.winnerId = null;
    this.pendingAction = null;
    this.log = [];
    this._aiTimer = null;

    this.addLog(`Partie créée avec le plateau "${this.boardName}".`);
  }

  // ---------- utilitaires ----------
  // Arrête proprement la partie (salon supprimé ou retour au salon)
  destroy() {
    this._destroyed = true;
    this.gameOver = true;
    clearTimeout(this._aiTimer);
    this._aiTimer = null;
    this.removeAllListeners();
  }

  _safe(result) {
    Promise.resolve(result).catch((e) => console.error("Erreur de jeu :", e));
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }
  currentPlayer() { return this.players[this.currentPlayerIndex]; }
  nextActiveIndex() {
    let i = this.currentPlayerIndex;
    for (let n = 0; n < this.players.length; n++) {
      i = (i + 1) % this.players.length;
      if (!this.players[i].bankrupt) return i;
    }
    return this.currentPlayerIndex;
  }

  getPublicState() {
    return {
      gameId: this.id,
      boardName: this.boardName,
      spaces: this.board,
      groupColors: this.groupColors,
      players: this.players,
      properties: this.properties,
      currentPlayerIndex: this.currentPlayerIndex,
      dice: this.dice,
      doublesCount: this.doublesCount,
      hasRolled: this.hasRolled,
      moving: this.moving,
      options: this.options,
      parkPot: this.parkPot,
      trades: this.trades,
      gameOver: this.gameOver,
      winnerId: this.winnerId,
      pendingAction: this.pendingAction,
      log: this.log.slice(-60),
    };
  }

  // ---------- IA ----------
  _maybeScheduleAI() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (!p || p.type !== "ai" || p.bankrupt) return;
    if (this._aiTimer) return;
    this._aiTimer = setTimeout(() => {
      this._aiTimer = null;
      this.aiStep();
    }, 700 + Math.random() * 500);
  }

  aiStep() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (!p || p.type !== "ai" || p.bankrupt) return;
    if (this.moving || this.rolling) return this._maybeScheduleAI();

    if (this.pendingAction) {
      if (this.pendingAction.type === "buy") {
        const affordable = p.money - this.pendingAction.price >= 100;
        this.resolveBuy(p.id, affordable);
      } else if (this.pendingAction.type === "card") {
        this._safe(this.ackCard(p.id));
      }
      return;
    }
    if (p.inJail && !this.hasRolled) {
      if (p.jailCards > 0) this.useJailCard(p.id);
      else this._safe(this.performRoll(p.id));
      return;
    }
    if (!this.hasRolled) {
      this._safe(this.performRoll(p.id));
      return;
    }
    this.endTurn(p.id);
  }

  // ---------- tours ----------
  startTurn() {
    if (this.gameOver) return;
    const p = this.currentPlayer();
    if (!p) return;
    if (p.bankrupt) {
      this.currentPlayerIndex = this.nextActiveIndex();
      return this.startTurn();
    }
    this.hasRolled = false;
    this.doublesCount = 0;
    this.pendingAction = null;
    this.dice = [null, null];
    this.addLog(`Au tour de ${p.name}.`);
    this.emit("update");
    this._maybeScheduleAI();
  }

  endTurn(playerIndex, force = false) {
    if (this.gameOver) return;
    if (!force) {
      if (this.currentPlayerIndex !== playerIndex) return;
      if (!this.hasRolled || this.pendingAction || this.moving) return;
    }
    this.currentPlayerIndex = this.nextActiveIndex();
    this.startTurn();
  }

  async performRoll(playerIndex) {
    if (this.gameOver) return;
    if (this.currentPlayerIndex !== playerIndex) return;
    if (this.hasRolled || this.pendingAction || this.moving || this.rolling) return;
    const p = this.currentPlayer();

    this.rolling = true;
    this.emit("diceAnimate", { playerIndex });
    await sleep(1000);
    this.rolling = false;
    if (this.gameOver || this.currentPlayerIndex !== playerIndex) return;

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.lastDiceSum = d1 + d2;
    this.hasRolled = true;
    this.moving = true; // bloque les actions le temps d'afficher les dés puis de déplacer le pion
    this.emit("update");
    await sleep(450);   // laisse voir le résultat des dés avant que le pion ne parte

    if (p.inJail) {
      if (d1 === d2) {
        p.inJail = false; p.jailTurns = 0;
        this.addLog(`${p.name} fait un double (${d1}-${d2}) et sort de prison !`);
        await this.movePlayer(p, d1 + d2);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= 3) {
          p.inJail = false; p.jailTurns = 0; p.money -= 50;
          this.addLog(`${p.name} échoue 3 fois, paie 50 M€ et sort de prison.`);
          await this.movePlayer(p, d1 + d2);
        } else {
          this.addLog(`${p.name} ne fait pas de double (${d1}-${d2}) et reste en prison.`);
          this.moving = false;
          this.emit("update");
          this._maybeScheduleAI();
        }
      }
      return;
    }

    if (d1 === d2) this.doublesCount++; else this.doublesCount = 0;

    if (this.doublesCount === 3) {
      this.addLog(`${p.name} fait 3 doubles d'affilée et est envoyé en prison !`);
      this.sendToJail(p);
      this.doublesCount = 0;
      this.moving = false;
      this.emit("update");
      this._maybeScheduleAI();
      return;
    }

    await this.movePlayer(p, d1 + d2);
  }

  payJailFee(playerIndex) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex || this.moving || this.rolling) return;
    const p = this.currentPlayer();
    if (!p.inJail || this.hasRolled) return;
    p.money -= 50; p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} paie 50 M€ pour sortir de prison.`);
    this.checkBankruptcyToBank(p);
    this.emit("update");
    this._maybeScheduleAI();
  }

  useJailCard(playerIndex) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex || this.moving || this.rolling) return;
    const p = this.currentPlayer();
    if (!p.inJail || this.hasRolled || p.jailCards <= 0) return;
    p.jailCards--; p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} utilise une carte de sortie de prison.`);
    this.emit("update");
    this._maybeScheduleAI();
  }

  // ---------- déplacement / atterrissage ----------
  // Le pion avance case par case (0,25 s par case) ; chaque pas est diffusé à tous les joueurs.
  // Pour un très long trajet (> 28 cases), le rythme s'accélère afin de ne pas dépasser ~7 s.
  async walk(player, steps, dir, collectGo) {
    this.moving = true;
    const ms = steps > 28 ? Math.max(100, Math.floor(7000 / steps)) : STEP_MS;
    for (let k = 0; k < steps; k++) {
      if (this._destroyed) break;
      player.position = (player.position + dir + 40) % 40;
      if (collectGo && dir === 1 && player.position === 0) {
        const stops = k === steps - 1;                       // le pion s'arrête sur Départ
        const bonus = stops && this.options.doubleGo ? 200 : 0;
        player.money += 200 + bonus;
        this.addLog(bonus
          ? `${player.name} s'arrête sur Départ : salaire doublé, il reçoit 400 M€ !`
          : `${player.name} passe par la case Départ et reçoit 200 M€.`);
      }
      this.emit("update");
      await sleep(ms);
    }
    this.moving = false;
  }

  async movePlayer(player, steps) {
    await this.walk(player, steps, 1, true);
    if (this._destroyed) return;
    this.resolveLanding(player);
  }

  async moveTo(player, targetId, collectGoIfPass = true, backward = false) {
    const dir = backward ? -1 : 1;
    const steps = (((targetId - player.position) * dir) % 40 + 40) % 40;
    await this.walk(player, steps, dir, collectGoIfPass && !backward);
    if (this._destroyed) return;
    this.resolveLanding(player);
  }

  resolveLanding(player) {
    const space = this.board[player.position];
    this.addLog(`${player.name} arrive sur "${space.name}".`);

    switch (space.type) {
      case "property":
      case "railroad":
      case "utility": {
        const prop = this.properties[space.id];
        if (!prop) {
          this.pendingAction = { type: "buy", spaceId: space.id, price: space.price };
          this.emit("update");
          this._maybeScheduleAI();
          return;
        } else if (prop.ownerId === player.id) {
          this.addLog(`C'est déjà votre propriété.`);
          this.afterActionSettled();
        } else if (prop.mortgaged) {
          this.addLog(`Ce terrain est hypothéqué, aucun loyer à payer.`);
          this.afterActionSettled();
        } else {
          const rent = this.calcRent(space, prop);
          this.payRent(player, prop.ownerId, rent, space.name);
          this.afterActionSettled();
        }
        return;
      }
      case "tax":
        player.money -= space.amount;
        this.addLog(`${player.name} paie ${space.amount} M€ d'impôts.`);
        this.checkBankruptcyToBank(player);
        this.afterActionSettled();
        return;
      case "chance":
      case "chest": {
        const deckName = space.type;
        const card = this.drawCard(deckName);
        this.pendingAction = { type: "card", deckType: deckName, deck: deckName === "chance" ? "Chance" : "Caisse de Communauté", card };
        this.addLog(`${player.name} pioche une carte ${this.pendingAction.deck}.`);
        this.emit("update");
        this._maybeScheduleAI();
        return;
      }
      case "gotojail":
        this.sendToJail(player);
        this.afterActionSettled();
        return;
      case "freeparking":
        if (this.options.parkMode !== "off" && this.parkPot > 0) {
          player.money += this.parkPot;
          this.addLog(`🎉 ${player.name} récupère la cagnotte du Parc : ${this.parkPot} M€ !`);
          this.parkPot = 0;
        }
        this.afterActionSettled();
        return;
      default:
        this.afterActionSettled();
        return;
    }
  }

  afterActionSettled() {
    const p = this.currentPlayer();
    if (p.bankrupt) {
      this.checkWinner();
      this.emit("update");
      if (!this.gameOver) this.endTurn(p.id, true);
      return;
    }
    if (this.doublesCount > 0 && this.doublesCount < 3 && !p.inJail) {
      this.addLog(`Double ! ${p.name} rejoue.`);
      this.hasRolled = false;
    }
    this.checkWinner();
    this.emit("update");
    this._maybeScheduleAI();
  }

  sendToJail(player) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    this.addLog(`${player.name} est envoyé en prison.`);
  }

  // ---------- achats / loyers ----------
  resolveBuy(playerIndex, buy) {
    if (!this.pendingAction || this.pendingAction.type !== "buy") return;
    if (this.currentPlayerIndex !== playerIndex) return;
    const space = this.board[this.pendingAction.spaceId];
    const p = this.currentPlayer();
    this.pendingAction = null;
    if (buy) {
      if (p.money >= space.price) {
        p.money -= space.price;
        this.properties[space.id] = { ownerId: p.id, houses: 0, mortgaged: false };
        this.addLog(`${p.name} achète ${space.name} pour ${space.price} M€.`);
      } else {
        this.addLog(`${p.name} n'a pas assez d'argent pour acheter ${space.name}.`);
      }
    } else {
      this.addLog(`${p.name} ne rachète pas ${space.name}.`);
    }
    this.afterActionSettled();
  }

  calcRent(space, prop) {
    if (space.type === "property") {
      const groupIds = this.board.filter((s) => s.group === space.group).map((s) => s.id);
      const ownsFullGroup = groupIds.every((id) => this.properties[id] && this.properties[id].ownerId === prop.ownerId);
      const level = prop.houses || 0;
      if (level > 0) return space.rent[level];
      return ownsFullGroup ? space.rent[0] * 2 : space.rent[0];
    }
    if (space.type === "railroad") {
      const owned = this.board.filter((s) => s.type === "railroad" && this.properties[s.id] && this.properties[s.id].ownerId === prop.ownerId).length;
      return [0, 25, 50, 100, 200][owned];
    }
    if (space.type === "utility") {
      const owned = this.board.filter((s) => s.type === "utility" && this.properties[s.id] && this.properties[s.id].ownerId === prop.ownerId).length;
      return this.lastDiceSum * (owned === 2 ? 10 : 4);
    }
    return 0;
  }

  payRent(payer, ownerId, amount, label) {
    const owner = this.players.find((pl) => pl.id === ownerId);
    payer.money -= amount;
    owner.money += amount;
    this.addLog(`${payer.name} paie ${amount} M€ de loyer à ${owner.name} pour ${label}.`);
    this.checkBankruptcyToPlayer(payer, ownerId);
  }

  checkBankruptcyToBank(player) { if (player.money < 0) this.handleBankruptcy(player, null); }
  checkBankruptcyToPlayer(player, creditorId) { if (player.money < 0) this.handleBankruptcy(player, creditorId); }

  handleBankruptcy(player, creditorId) {
    if (player.bankrupt) return;
    player.bankrupt = true;
    this.trades = this.trades.filter((t) => t.from !== player.id && t.to !== player.id);
    this.addLog(`💥 ${player.name} est en faillite !`);
    Object.keys(this.properties).forEach((id) => {
      const prop = this.properties[id];
      if (prop.ownerId === player.id) {
        if (creditorId != null) {
          prop.ownerId = creditorId; prop.mortgaged = false; prop.houses = 0;
        } else {
          delete this.properties[id];
        }
      }
    });
    if (creditorId != null) {
      const creditor = this.players.find((pl) => pl.id === creditorId);
      creditor.money += Math.max(0, player.money);
    }
    player.money = 0;
    this.checkWinner();
  }

  checkWinner() {
    if (this.gameOver) return;
    const active = this.players.filter((p) => !p.bankrupt);
    if (active.length === 1 && this.players.length > 1) {
      this.gameOver = true;
      this.trades = [];
      this.winnerId = active[0].id;
      this.addLog(`🏆 ${active[0].name} remporte la partie !`);
    }
  }

  // ---------- cagnotte du Parc ----------
  // Toute somme versée à la banque à cause d'une carte (Chance ou Caisse de Communauté) alimente le Parc.
  addToPot(amount) {
    if (this.options.parkMode === "off" || !(amount > 0)) return;
    this.parkPot += amount;
    this.addLog(`💰 ${amount} M€ rejoignent la cagnotte du Parc (total : ${this.parkPot} M€).`);
  }

  // ---------- cartes ----------
  drawCard(deckName) {
    if (deckName === "chance") {
      if (this.chanceIndex >= this.chanceDeck.length) { this.chanceDeck = shuffledCopy(this.chanceCardsSource); this.chanceIndex = 0; }
      return this.chanceDeck[this.chanceIndex++];
    } else {
      if (this.chestIndex >= this.chestDeck.length) { this.chestDeck = shuffledCopy(this.chestCardsSource); this.chestIndex = 0; }
      return this.chestDeck[this.chestIndex++];
    }
  }

  ackCard(playerIndex) {
    if (!this.pendingAction || this.pendingAction.type !== "card") return;
    if (this.currentPlayerIndex !== playerIndex) return;
    const card = this.pendingAction.card;
    this._cardDeck = this.pendingAction.deckType;
    this.pendingAction = null;
    return this.applyCard(card, this.currentPlayer());
  }

  applyCard(card, player) {
    switch (card.action) {
      case "goto":
        return this.moveTo(player, card.value, card.collectGo !== false);
      case "pay":
        player.money -= card.value;
        this.addLog(`${player.name} paie ${card.value} M€.`);
        this.addToPot(card.value);
        this.checkBankruptcyToBank(player);
        this.afterActionSettled();
        return;
      case "collect":
        player.money += card.value;
        this.addLog(`${player.name} reçoit ${card.value} M€.`);
        this.afterActionSettled();
        return;
      case "jail":
        this.sendToJail(player);
        this.afterActionSettled();
        return;
      case "getoutofjail":
        player.jailCards++;
        this.addLog(`${player.name} obtient une carte de sortie de prison gratuite.`);
        this.afterActionSettled();
        return;
      case "move": {
        const newPos = (player.position + card.value + 40) % 40;
        return this.moveTo(player, newPos, false, card.value < 0);
      }
      case "payeach":
        this.players.filter((pl) => !pl.bankrupt && pl.id !== player.id).forEach((pl) => { player.money -= card.value; pl.money += card.value; });
        this.addLog(`${player.name} paie ${card.value} M€ à chaque joueur.`);
        this.checkBankruptcyToBank(player);
        this.afterActionSettled();
        return;
      case "collecteach":
        this.players.filter((pl) => !pl.bankrupt && pl.id !== player.id).forEach((pl) => { pl.money -= card.value; player.money += card.value; });
        this.addLog(`${player.name} reçoit ${card.value} M€ de chaque joueur.`);
        this.afterActionSettled();
        return;
      case "repairs": {
        let cost = 0;
        Object.values(this.properties).forEach((prop) => {
          if (prop.ownerId === player.id) cost += prop.houses === 5 ? card.hotel : prop.houses * card.house;
        });
        player.money -= cost;
        this.addLog(`${player.name} paie ${cost} M€ de réparations.`);
        this.addToPot(cost);
        this.checkBankruptcyToBank(player);
        this.afterActionSettled();
        return;
      }
      case "nearestrailroad": {
        const ids = this.board.filter((s) => s.type === "railroad").map((s) => s.id);
        const next = ids.find((id) => id > player.position) ?? ids[0];
        return this.moveTo(player, next, true);
      }
      case "nearestutility": {
        const ids = this.board.filter((s) => s.type === "utility").map((s) => s.id);
        const next = ids.find((id) => id > player.position) ?? ids[0];
        return this.moveTo(player, next, true);
      }
      default:
        this.afterActionSettled();
    }
  }

  // ---------- échanges entre joueurs ----------
  // Un échange peut être proposé à tout moment (même hors de son tour) et contient des propriétés, de l'argent
  // et/ou des cartes « sortie de prison ». Le destinataire accepte ou refuse ; l'expéditeur peut annuler.
  isTradable(spaceId) {
    const space = this.board[spaceId], prop = this.properties[spaceId];
    if (!space || !prop) return false;
    if (space.type !== "property") return true;
    // pas d'échange tant qu'un bâtiment existe dans le groupe de couleur
    return !this.board.some((s) => s.group === space.group && this.properties[s.id] && this.properties[s.id].houses > 0);
  }

  _normSide(side) {
    side = side || {};
    const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
    const props = [...new Set((Array.isArray(side.props) ? side.props : []).map((x) => Math.floor(Number(x))))]
      .filter((x) => Number.isInteger(x) && x >= 0 && x < this.board.length);
    return { money: int(side.money), props, jail: int(side.jail) };
  }

  _checkTrade(from, to, give, get) {
    const need = (c, m) => { if (!c) throw new Error(m); };
    need(give.money <= from.money, `${from.name} n'a pas assez d'argent (${from.money} M€).`);
    need(get.money <= to.money, `${to.name} n'a pas assez d'argent (${to.money} M€).`);
    need(give.jail <= from.jailCards, `${from.name} n'a pas assez de cartes de sortie de prison.`);
    need(get.jail <= to.jailCards, `${to.name} n'a pas assez de cartes de sortie de prison.`);
    for (const id of give.props) {
      need(this.properties[id] && this.properties[id].ownerId === from.id, `${this.board[id].name} n'appartient pas à ${from.name}.`);
      need(this.isTradable(id), `${this.board[id].name} : vendez d'abord les bâtiments du groupe.`);
    }
    for (const id of get.props) {
      need(this.properties[id] && this.properties[id].ownerId === to.id, `${this.board[id].name} n'appartient pas à ${to.name}.`);
      need(this.isTradable(id), `${this.board[id].name} : vendez d'abord les bâtiments du groupe.`);
    }
  }

  proposeTrade(fromIdx, toIdx, giveRaw, getRaw) {
    const need = (c, m) => { if (!c) throw new Error(m); };
    need(!this.gameOver, "La partie est terminée.");
    const from = this.players[fromIdx], to = this.players[toIdx];
    need(from && to && fromIdx !== toIdx, "Choisis un autre joueur.");
    need(!from.bankrupt && !to.bankrupt, "Ce joueur est en faillite.");
    const give = this._normSide(giveRaw), get = this._normSide(getRaw);
    const size = (x) => x.money + x.props.length + x.jail;
    need(size(give) + size(get) > 0, "L'échange est vide.");
    this._checkTrade(from, to, give, get);
    this.trades = this.trades.filter((t) => !(t.from === fromIdx && t.to === toIdx)); // remplace l'ancienne proposition
    const trade = { id: ++this._tradeSeq, from: fromIdx, to: toIdx, give, get };
    this.trades.push(trade);
    this.addLog(`🤝 ${from.name} propose un échange à ${to.name}.`);
    this.emit("update");
    if (to.type === "ai") this._aiConsiderTrade(trade);
  }

  respondTrade(playerIdx, id, accept) {
    const need = (c, m) => { if (!c) throw new Error(m); };
    const t = this.trades.find((x) => x.id === id);
    need(t, "Cette proposition n'existe plus.");
    need(t.to === playerIdx, "Cette proposition ne t'est pas adressée.");
    const from = this.players[t.from], to = this.players[t.to];
    this.trades = this.trades.filter((x) => x.id !== id);
    if (!accept) {
      this.addLog(`✘ ${to.name} refuse l'échange de ${from.name}.`);
      this.emit("update");
      return;
    }
    try { this._checkTrade(from, to, t.give, t.get); }
    catch (e) { this.emit("update"); throw new Error("L'échange n'est plus valide : " + e.message); }
    from.money += t.get.money - t.give.money;
    to.money += t.give.money - t.get.money;
    from.jailCards += t.get.jail - t.give.jail;
    to.jailCards += t.give.jail - t.get.jail;
    t.give.props.forEach((sid) => { this.properties[sid].ownerId = to.id; });
    t.get.props.forEach((sid) => { this.properties[sid].ownerId = from.id; });
    this.addLog(`✅ ${from.name} et ${to.name} concluent un échange.`);
    // les autres propositions devenues impossibles disparaissent
    this.trades = this.trades.filter((x) => {
      try { this._checkTrade(this.players[x.from], this.players[x.to], x.give, x.get); return true; } catch { return false; }
    });
    this.emit("update");
  }

  cancelTrade(playerIdx, id) {
    const t = this.trades.find((x) => x.id === id);
    if (!t) throw new Error("Cette proposition n'existe plus.");
    if (t.from !== playerIdx) throw new Error("Tu ne peux annuler que tes propositions.");
    this.trades = this.trades.filter((x) => x.id !== id);
    this.addLog(`${this.players[t.from].name} retire sa proposition d'échange.`);
    this.emit("update");
  }

  // L'IA accepte un échange si elle reçoit au moins 15 % de valeur en plus de ce qu'elle cède
  _aiConsiderTrade(trade) {
    setTimeout(() => {
      if (this._destroyed || !this.trades.some((x) => x.id === trade.id)) return;
      const value = (side) => side.money + side.jail * 50 +
        side.props.reduce((a, id) => a + (this.board[id].price || 0) * (this.properties[id] && this.properties[id].mortgaged ? 0.5 : 1), 0);
      const ok = value(trade.give) >= value(trade.get) * 1.15;
      try { this.respondTrade(trade.to, trade.id, ok); } catch (e) { /* proposition devenue invalide */ }
    }, 1500 + Math.random() * 1000);
  }

  // ---------- gestion des propriétés ----------
  manageProperty(playerIndex, spaceId, action) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex || this.moving) return;
    const p = this.currentPlayer();
    const space = this.board[spaceId];
    const prop = this.properties[spaceId];
    if (!space || !prop || prop.ownerId !== p.id) return;

    if (action === "build" && space.type === "property") {
      const groupIds = this.board.filter((s) => s.group === space.group).map((s) => s.id);
      const ownsFullGroup = groupIds.every((id) => this.properties[id] && this.properties[id].ownerId === p.id);
      const minSiblingHouses = Math.min(...groupIds.map((id) => (this.properties[id] && this.properties[id].houses) || 0));
      if (!prop.mortgaged && ownsFullGroup && prop.houses < 5 && prop.houses <= minSiblingHouses && p.money >= space.houseCost) {
        p.money -= space.houseCost;
        prop.houses++;
        this.addLog(`${p.name} construit sur ${space.name}.`);
      }
    } else if (action === "sellHouse" && prop.houses > 0) {
      prop.houses--;
      p.money += Math.floor(space.houseCost / 2);
      this.addLog(`${p.name} vend un bâtiment sur ${space.name}.`);
    } else if (action === "mortgage" && !prop.mortgaged && prop.houses === 0) {
      prop.mortgaged = true;
      p.money += Math.floor(space.price / 2);
      this.addLog(`${p.name} hypothèque ${space.name}.`);
    } else if (action === "unmortgage" && prop.mortgaged) {
      const cost = Math.ceil((space.price / 2) * 1.1);
      if (p.money >= cost) {
        p.money -= cost;
        prop.mortgaged = false;
        this.addLog(`${p.name} lève l'hypothèque sur ${space.name}.`);
      }
    }
    this.emit("update");
  }
}

MonopolySLGGame.PALETTE = PALETTE;
module.exports = MonopolySLGGame;
