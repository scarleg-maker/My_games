const EventEmitter = require("events");

const PALETTE = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#8338ec", "#ffbe0b", "#06d6a0", "#ef476f"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class MonopolyGame extends EventEmitter {
  constructor(id, boardData, playerConfigs) {
    super();
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
      color: PALETTE[i % PALETTE.length],
      money: 1500,
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
    this.dice = [null, null];
    this.gameOver = false;
    this.winnerId = null;
    this.pendingAction = null;
    this.log = [];
    this._aiTimer = null;

    this.addLog(`Partie créée avec le plateau "${this.boardName}".`);
  }

  // ---------- utilitaires ----------
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

    if (this.pendingAction) {
      if (this.pendingAction.type === "buy") {
        const affordable = p.money - this.pendingAction.price >= 100;
        this.resolveBuy(p.id, affordable);
      } else if (this.pendingAction.type === "card") {
        this.ackCard(p.id);
      }
      return;
    }
    if (p.inJail && !this.hasRolled) {
      if (p.jailCards > 0) this.useJailCard(p.id);
      else this.performRoll(p.id);
      return;
    }
    if (!this.hasRolled) {
      this.performRoll(p.id);
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
      if (!this.hasRolled || this.pendingAction) return;
    }
    this.currentPlayerIndex = this.nextActiveIndex();
    this.startTurn();
  }

  async performRoll(playerIndex) {
    if (this.gameOver) return;
    if (this.currentPlayerIndex !== playerIndex) return;
    if (this.hasRolled || this.pendingAction) return;
    const p = this.currentPlayer();

    this.emit("diceAnimate", { playerIndex });
    await sleep(1000);
    if (this.gameOver || this.currentPlayerIndex !== playerIndex) return;

    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    this.dice = [d1, d2];
    this.lastDiceSum = d1 + d2;
    this.hasRolled = true;

    if (p.inJail) {
      if (d1 === d2) {
        p.inJail = false; p.jailTurns = 0;
        this.addLog(`${p.name} fait un double (${d1}-${d2}) et sort de prison !`);
        this.movePlayer(p, d1 + d2);
      } else {
        p.jailTurns++;
        if (p.jailTurns >= 3) {
          p.inJail = false; p.jailTurns = 0; p.money -= 50;
          this.addLog(`${p.name} échoue 3 fois, paie 50 M€ et sort de prison.`);
          this.movePlayer(p, d1 + d2);
        } else {
          this.addLog(`${p.name} ne fait pas de double (${d1}-${d2}) et reste en prison.`);
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
      this.emit("update");
      this._maybeScheduleAI();
      return;
    }

    this.movePlayer(p, d1 + d2);
  }

  payJailFee(playerIndex) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex) return;
    const p = this.currentPlayer();
    if (!p.inJail || this.hasRolled) return;
    p.money -= 50; p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} paie 50 M€ pour sortir de prison.`);
    this.checkBankruptcyToBank(p);
    this.emit("update");
    this._maybeScheduleAI();
  }

  useJailCard(playerIndex) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex) return;
    const p = this.currentPlayer();
    if (!p.inJail || this.hasRolled || p.jailCards <= 0) return;
    p.jailCards--; p.inJail = false; p.jailTurns = 0;
    this.addLog(`${p.name} utilise une carte de sortie de prison.`);
    this.emit("update");
    this._maybeScheduleAI();
  }

  // ---------- déplacement / atterrissage ----------
  movePlayer(player, steps) {
    const oldPos = player.position;
    const newPos = (oldPos + steps) % 40;
    if (newPos < oldPos) {
      player.money += 200;
      this.addLog(`${player.name} passe par la case Départ et reçoit 200 M€.`);
    }
    player.position = newPos;
    this.resolveLanding(player);
  }

  moveTo(player, targetId, collectGoIfPass = true) {
    const oldPos = player.position;
    if (collectGoIfPass && (targetId < oldPos || targetId === 0)) {
      player.money += 200;
      this.addLog(`${player.name} passe par (ou arrive sur) la case Départ et reçoit 200 M€.`);
    }
    player.position = targetId;
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
        this.pendingAction = { type: "card", deck: deckName === "chance" ? "Chance" : "Caisse de Communauté", card };
        this.addLog(`${player.name} pioche une carte ${this.pendingAction.deck}.`);
        this.emit("update");
        this._maybeScheduleAI();
        return;
      }
      case "gotojail":
        this.sendToJail(player);
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
      this.winnerId = active[0].id;
      this.addLog(`🏆 ${active[0].name} remporte la partie !`);
    }
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
    this.pendingAction = null;
    this.applyCard(card, this.currentPlayer());
  }

  applyCard(card, player) {
    switch (card.action) {
      case "goto":
        this.moveTo(player, card.value, card.collectGo !== false);
        return;
      case "pay":
        player.money -= card.value;
        this.addLog(`${player.name} paie ${card.value} M€.`);
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
        this.moveTo(player, newPos, false);
        return;
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
        this.checkBankruptcyToBank(player);
        this.afterActionSettled();
        return;
      }
      case "nearestrailroad": {
        const ids = this.board.filter((s) => s.type === "railroad").map((s) => s.id);
        const next = ids.find((id) => id > player.position) ?? ids[0];
        this.moveTo(player, next, true);
        return;
      }
      case "nearestutility": {
        const ids = this.board.filter((s) => s.type === "utility").map((s) => s.id);
        const next = ids.find((id) => id > player.position) ?? ids[0];
        this.moveTo(player, next, true);
        return;
      }
      default:
        this.afterActionSettled();
    }
  }

  // ---------- gestion des propriétés ----------
  manageProperty(playerIndex, spaceId, action) {
    if (this.gameOver || this.currentPlayerIndex !== playerIndex) return;
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

module.exports = MonopolyGame;
