// ===================== ÉTAT DU JEU =====================
const PALETTE = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#8338ec", "#ffbe0b"];

let players = [];
let properties = {};      // id -> { ownerId, houses (0-4, 5=hotel), mortgaged }
let currentPlayerIndex = 0;
let doublesCount = 0;
let lastDiceSum = 0;
let hasRolled = false;
let gameOver = false;

let chanceDeck = [], chanceIndex = 0;
let chestDeck = [], chestIndex = 0;

function shuffledCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===================== SETUP SCREEN =====================
const playerRowsEl = document.getElementById("player-rows");
let setupCount = 0;

function addPlayerRow(defaultName) {
  if (setupCount >= 6) return;
  const idx = setupCount++;
  const row = document.createElement("div");
  row.className = "player-row";
  row.dataset.index = idx;
  row.innerHTML = `
    <div class="swatch" style="background:${PALETTE[idx]}"></div>
    <input type="text" value="${defaultName}" maxlength="16" />
    <button class="remove-player" title="Retirer">✕</button>
  `;
  row.querySelector(".remove-player").onclick = () => {
    row.remove();
    setupCount--;
    Array.from(playerRowsEl.children).forEach((r, i) => {
      r.dataset.index = i;
      r.querySelector(".swatch").style.background = PALETTE[i];
    });
    setupCount = playerRowsEl.children.length;
  };
  playerRowsEl.appendChild(row);
}

addPlayerRow("Joueur 1");
addPlayerRow("Joueur 2");

document.getElementById("add-player-btn").onclick = () => addPlayerRow(`Joueur ${setupCount + 1}`);

document.getElementById("start-game-btn").onclick = () => {
  const rows = Array.from(playerRowsEl.children);
  if (rows.length < 2) { alert("Il faut au moins 2 joueurs."); return; }
  players = rows.map((row, i) => ({
    id: i,
    name: row.querySelector("input").value.trim() || `Joueur ${i + 1}`,
    color: PALETTE[i],
    money: 1500,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailCards: 0,
    bankrupt: false,
  }));
  document.getElementById("setup-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  initGame();
};

// ===================== INITIALISATION =====================
function initGame() {
  chanceDeck = shuffledCopy(CHANCE_CARDS); chanceIndex = 0;
  chestDeck = shuffledCopy(CHEST_CARDS); chestIndex = 0;
  properties = {};
  renderBoard();
  renderPlayersPanel();
  addManageButton();
  startTurn();
}

function boardCoords(id) {
  if (id <= 10) return { row: 11, col: 11 - id };
  if (id <= 20) return { row: 21 - id, col: 1 };
  if (id <= 30) return { row: 1, col: id - 19 };
  return { row: id - 29, col: 11 };
}

function renderBoard() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  BOARD.forEach(space => {
    const { row, col } = boardCoords(space.id);
    const cell = document.createElement("div");
    cell.className = "cell" + ([0, 10, 20, 30].includes(space.id) ? " corner" : "");
    cell.style.gridColumn = col;
    cell.style.gridRow = row;
    cell.id = `cell-${space.id}`;

    if (space.group) {
      const band = document.createElement("div");
      band.className = "band";
      band.style.background = GROUP_COLORS[space.group];
      cell.appendChild(band);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = space.name;
    cell.appendChild(nameEl);

    if (space.price || space.amount) {
      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = space.price ? `${space.price} M€` : `${space.amount} M€`;
      cell.appendChild(priceEl);
    }

    const housesEl = document.createElement("div");
    housesEl.className = "houses";
    housesEl.id = `houses-${space.id}`;
    cell.appendChild(housesEl);

    const ownerMark = document.createElement("div");
    ownerMark.className = "owner-mark";
    ownerMark.id = `owner-${space.id}`;
    cell.appendChild(ownerMark);

    const pawnsEl = document.createElement("div");
    pawnsEl.className = "pawns-on-cell";
    pawnsEl.id = `pawns-${space.id}`;
    cell.appendChild(pawnsEl);

    boardEl.appendChild(cell);
  });

  const centerLogo = document.createElement("div");
  centerLogo.className = "center-logo";
  centerLogo.innerHTML = "<span>MONOPOLY</span>";
  boardEl.appendChild(centerLogo);

  renderPawns();
}

function renderPawns() {
  BOARD.forEach(space => {
    const el = document.getElementById(`pawns-${space.id}`);
    if (el) el.innerHTML = "";
  });
  players.filter(p => !p.bankrupt).forEach(p => {
    const container = document.getElementById(`pawns-${p.position}`);
    if (!container) return;
    const pawn = document.createElement("div");
    pawn.className = "pawn";
    pawn.style.background = p.color;
    pawn.title = p.name;
    container.appendChild(pawn);
  });
}

function renderOwnershipMarks() {
  BOARD.forEach(space => {
    const mark = document.getElementById(`owner-${space.id}`);
    const housesEl = document.getElementById(`houses-${space.id}`);
    if (!mark) return;
    const prop = properties[space.id];
    if (prop && prop.ownerId != null) {
      const owner = players.find(p => p.id === prop.ownerId);
      mark.style.background = prop.mortgaged ? "#999" : (owner ? owner.color : "transparent");
    } else {
      mark.style.background = "transparent";
    }
    if (housesEl) {
      housesEl.innerHTML = "";
      if (prop && prop.houses > 0) {
        if (prop.houses === 5) {
          const hotel = document.createElement("div");
          hotel.className = "hotel-icon";
          housesEl.appendChild(hotel);
        } else {
          for (let i = 0; i < prop.houses; i++) {
            const h = document.createElement("div");
            h.className = "house-icon";
            housesEl.appendChild(h);
          }
        }
      }
    }
  });
}

function renderPlayersPanel() {
  const panel = document.getElementById("players-panel");
  panel.innerHTML = "";
  players.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "player-card" + (i === currentPlayerIndex && !gameOver ? " active" : "") + (p.bankrupt ? " bankrupt" : "");
    card.innerHTML = `
      <div class="swatch" style="background:${p.color}"></div>
      <div class="pname">${p.name}${p.inJail ? ' <span class="jail-tag">🔒 Prison</span>' : ""}</div>
      <div class="pmoney">${p.money} M€</div>
    `;
    panel.appendChild(card);
  });
}

function renderAll() {
  renderPlayersPanel();
  renderOwnershipMarks();
  renderPawns();
}

function log(msg) {
  const logEl = document.getElementById("log");
  const entry = document.createElement("div");
  entry.className = "entry";
  entry.textContent = msg;
  logEl.appendChild(entry);
}

// ===================== TOUR DE JEU =====================
const rollBtn = document.getElementById("roll-btn");
const endTurnBtn = document.getElementById("end-turn-btn");
const actionButtonsEl = document.getElementById("action-buttons");
const bannerEl = document.getElementById("current-player-banner");
const die1El = document.getElementById("die1");
const die2El = document.getElementById("die2");

function currentPlayer() { return players[currentPlayerIndex]; }

function nextActiveIndex() {
  let i = currentPlayerIndex;
  for (let n = 0; n < players.length; n++) {
    i = (i + 1) % players.length;
    if (!players[i].bankrupt) return i;
  }
  return currentPlayerIndex;
}

function startTurn() {
  if (gameOver) return;
  const p = currentPlayer();
  if (p.bankrupt) { currentPlayerIndex = nextActiveIndex(); return startTurn(); }
  hasRolled = false;
  doublesCount = 0;
  bannerEl.textContent = `Au tour de ${p.name}`;
  die1El.textContent = "?"; die2El.textContent = "?";
  rollBtn.disabled = false;
  endTurnBtn.disabled = true;
  actionButtonsEl.innerHTML = "";
  rollBtn.textContent = p.inJail ? "Lancer les dés (double = liberté)" : "Lancer les dés";

  if (p.inJail) {
    const payBtn = document.createElement("button");
    payBtn.className = "btn ghost wide";
    payBtn.textContent = "Payer 50 M€ pour sortir";
    payBtn.onclick = () => {
      p.money -= 50; p.inJail = false; p.jailTurns = 0;
      log(`${p.name} paie 50 M€ pour sortir de prison.`);
      renderAll();
      startTurn();
    };
    actionButtonsEl.appendChild(payBtn);

    if (p.jailCards > 0) {
      const cardBtn = document.createElement("button");
      cardBtn.className = "btn ghost wide";
      cardBtn.textContent = "Utiliser une carte de sortie";
      cardBtn.onclick = () => {
        p.jailCards--; p.inJail = false; p.jailTurns = 0;
        log(`${p.name} utilise une carte de sortie de prison.`);
        renderAll();
        startTurn();
      };
      actionButtonsEl.appendChild(cardBtn);
    }
  }
  renderAll();
}

rollBtn.onclick = () => {
  if (hasRolled) return;
  const p = currentPlayer();
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  die1El.textContent = d1; die2El.textContent = d2;
  lastDiceSum = d1 + d2;
  hasRolled = true;
  rollBtn.disabled = true;
  actionButtonsEl.innerHTML = "";

  if (p.inJail) {
    if (d1 === d2) {
      p.inJail = false; p.jailTurns = 0;
      log(`${p.name} fait un double (${d1}-${d2}) et sort de prison !`);
      movePlayer(p, d1 + d2);
    } else {
      p.jailTurns++;
      if (p.jailTurns >= 3) {
        p.inJail = false; p.jailTurns = 0; p.money -= 50;
        log(`${p.name} échoue 3 fois, paie 50 M€ et sort de prison.`);
        movePlayer(p, d1 + d2);
      } else {
        log(`${p.name} ne fait pas de double (${d1}-${d2}) et reste en prison.`);
        endTurnBtn.disabled = false;
        renderAll();
      }
    }
    return;
  }

  if (d1 === d2) doublesCount++; else doublesCount = 0;

  if (doublesCount === 3) {
    log(`${p.name} fait 3 doubles d'affilée et est envoyé en prison !`);
    sendToJail(p);
    doublesCount = 0;
    endTurnBtn.disabled = false;
    renderAll();
    return;
  }

  movePlayer(p, d1 + d2);
};

function movePlayer(player, steps) {
  const oldPos = player.position;
  const newPos = (oldPos + steps) % 40;
  if (newPos < oldPos) {
    player.money += 200;
    log(`${player.name} passe par la case Départ et reçoit 200 M€.`);
  }
  player.position = newPos;
  renderAll();
  resolveLanding(player);
}

function moveTo(player, targetId, collectGoIfPass = true) {
  const oldPos = player.position;
  if (collectGoIfPass && targetId < oldPos) {
    player.money += 200;
    log(`${player.name} passe par la case Départ et reçoit 200 M€.`);
  } else if (collectGoIfPass && targetId === 0) {
    player.money += 200;
    log(`${player.name} arrive sur Départ et reçoit 200 M€.`);
  }
  player.position = targetId;
  renderAll();
  resolveLanding(player);
}

function resolveLanding(player) {
  const space = BOARD[player.position];
  log(`${player.name} arrive sur "${space.name}".`);

  switch (space.type) {
    case "property":
    case "railroad":
    case "utility": {
      const prop = properties[space.id];
      if (!prop) {
        showBuyModal(space);
        return; // modal will call finishLandingResolution
      } else if (prop.ownerId === player.id) {
        log(`C'est déjà votre propriété.`);
        finishLandingResolution();
      } else if (prop.mortgaged) {
        log(`Ce terrain est hypothéqué, aucun loyer à payer.`);
        finishLandingResolution();
      } else {
        const rent = calcRent(space, prop);
        payRent(player, prop.ownerId, rent, space.name);
        finishLandingResolution();
      }
      return;
    }
    case "tax":
      player.money -= space.amount;
      log(`${player.name} paie ${space.amount} M€ d'impôts.`);
      checkBankruptcyToBank(player);
      finishLandingResolution();
      return;
    case "chance":
      drawCard("chance", player);
      return;
    case "chest":
      drawCard("chest", player);
      return;
    case "gotojail":
      sendToJail(player);
      finishLandingResolution();
      return;
    default:
      finishLandingResolution();
      return;
  }
}

function finishLandingResolution() {
  renderAll();
  if (gameOver) return;
  const p = currentPlayer();
  if (p.bankrupt) {
    endTurnBtn.disabled = true;
    rollBtn.disabled = true;
    return;
  }
  if (doublesCount > 0 && doublesCount < 3 && !p.inJail) {
    log(`Double ! ${p.name} rejoue.`);
    hasRolled = false;
    rollBtn.disabled = false;
    endTurnBtn.disabled = true;
  } else {
    rollBtn.disabled = true;
    endTurnBtn.disabled = false;
  }
}

endTurnBtn.onclick = () => {
  if (gameOver) return;
  currentPlayerIndex = nextActiveIndex();
  startTurn();
};

function sendToJail(player) {
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  log(`${player.name} est envoyé en prison.`);
  renderAll();
}

// ===================== ACHAT / LOYER =====================
function showBuyModal(space) {
  const p = currentPlayer();
  openModal(`
    <h2>${space.name}</h2>
    <p>Terrain libre. Prix d'achat : <strong>${space.price} M€</strong></p>
    <p>Solde de ${p.name} : ${p.money} M€</p>
    <div class="modal-buttons">
      <button class="btn primary" id="buy-yes">Acheter</button>
      <button class="btn ghost" id="buy-no">Ne pas acheter</button>
    </div>
  `);
  document.getElementById("buy-yes").onclick = () => {
    if (p.money < space.price) {
      alert("Fonds insuffisants !");
      return;
    }
    p.money -= space.price;
    properties[space.id] = { ownerId: p.id, houses: 0, mortgaged: false };
    log(`${p.name} achète ${space.name} pour ${space.price} M€.`);
    closeModal();
    finishLandingResolution();
  };
  document.getElementById("buy-no").onclick = () => {
    log(`${p.name} ne rachète pas ${space.name}.`);
    closeModal();
    finishLandingResolution();
  };
}

function calcRent(space, prop) {
  if (space.type === "property") {
    const groupIds = BOARD.filter(s => s.group === space.group).map(s => s.id);
    const ownsFullGroup = groupIds.every(id => properties[id] && properties[id].ownerId === prop.ownerId);
    const level = prop.houses || 0;
    if (level > 0) return space.rent[level];
    return ownsFullGroup ? space.rent[0] * 2 : space.rent[0];
  }
  if (space.type === "railroad") {
    const owned = BOARD.filter(s => s.type === "railroad" && properties[s.id] && properties[s.id].ownerId === prop.ownerId).length;
    return [0, 25, 50, 100, 200][owned];
  }
  if (space.type === "utility") {
    const owned = BOARD.filter(s => s.type === "utility" && properties[s.id] && properties[s.id].ownerId === prop.ownerId).length;
    return lastDiceSum * (owned === 2 ? 10 : 4);
  }
  return 0;
}

function payRent(payer, ownerId, amount, label) {
  const owner = players.find(pl => pl.id === ownerId);
  payer.money -= amount;
  owner.money += amount;
  log(`${payer.name} paie ${amount} M€ de loyer à ${owner.name} pour ${label}.`);
  checkBankruptcyToPlayer(payer, ownerId);
}

function checkBankruptcyToBank(player) {
  if (player.money < 0) handleBankruptcy(player, null);
}
function checkBankruptcyToPlayer(player, creditorId) {
  if (player.money < 0) handleBankruptcy(player, creditorId);
}

function handleBankruptcy(player, creditorId) {
  player.bankrupt = true;
  log(`💥 ${player.name} est en faillite !`);
  Object.keys(properties).forEach(id => {
    const prop = properties[id];
    if (prop.ownerId === player.id) {
      if (creditorId != null) {
        prop.ownerId = creditorId;
        prop.mortgaged = false;
      } else {
        delete properties[id];
      }
    }
  });
  if (creditorId != null) {
    const creditor = players.find(pl => pl.id === creditorId);
    creditor.money += Math.max(0, player.money);
  }
  player.money = 0;
  renderAll();
  checkWinner();
}

function checkWinner() {
  const active = players.filter(p => !p.bankrupt);
  if (active.length === 1) {
    gameOver = true;
    bannerEl.textContent = `🏆 ${active[0].name} remporte la partie !`;
    rollBtn.disabled = true;
    endTurnBtn.disabled = true;
    actionButtonsEl.innerHTML = "";
    openModal(`
      <h2>🏆 Victoire !</h2>
      <p><strong>${active[0].name}</strong> remporte la partie avec ${active[0].money} M€ !</p>
      <div class="modal-buttons">
        <button class="btn primary" id="close-win">Fermer</button>
      </div>
    `);
    document.getElementById("close-win").onclick = closeModal;
  }
}

// ===================== CARTES =====================
function drawCard(deckName, player) {
  let card, deckLabel;
  if (deckName === "chance") {
    if (chanceIndex >= chanceDeck.length) { chanceDeck = shuffledCopy(CHANCE_CARDS); chanceIndex = 0; }
    card = chanceDeck[chanceIndex++]; deckLabel = "Chance";
  } else {
    if (chestIndex >= chestDeck.length) { chestDeck = shuffledCopy(CHEST_CARDS); chestIndex = 0; }
    card = chestDeck[chestIndex++]; deckLabel = "Caisse de Communauté";
  }

  openModal(`
    <h2>${deckLabel}</h2>
    <div class="card-flavor">${card.text}</div>
    <div class="modal-buttons">
      <button class="btn primary" id="card-ok">OK</button>
    </div>
  `);
  document.getElementById("card-ok").onclick = () => {
    closeModal();
    applyCard(card, player);
  };
}

function applyCard(card, player) {
  switch (card.action) {
    case "goto":
      moveTo(player, card.value, card.collectGo !== false);
      return;
    case "pay":
      player.money -= card.value;
      log(`${player.name} paie ${card.value} M€.`);
      checkBankruptcyToBank(player);
      finishLandingResolution();
      return;
    case "collect":
      player.money += card.value;
      log(`${player.name} reçoit ${card.value} M€.`);
      finishLandingResolution();
      return;
    case "jail":
      sendToJail(player);
      finishLandingResolution();
      return;
    case "getoutofjail":
      player.jailCards++;
      log(`${player.name} obtient une carte de sortie de prison gratuite.`);
      finishLandingResolution();
      return;
    case "move": {
      const newPos = (player.position + card.value + 40) % 40;
      moveTo(player, newPos, false);
      return;
    }
    case "payeach":
      players.filter(pl => !pl.bankrupt && pl.id !== player.id).forEach(pl => {
        player.money -= card.value; pl.money += card.value;
      });
      log(`${player.name} paie ${card.value} M€ à chaque joueur.`);
      checkBankruptcyToBank(player);
      finishLandingResolution();
      return;
    case "collecteach":
      players.filter(pl => !pl.bankrupt && pl.id !== player.id).forEach(pl => {
        pl.money -= card.value; player.money += card.value;
      });
      log(`${player.name} reçoit ${card.value} M€ de chaque joueur.`);
      finishLandingResolution();
      return;
    case "repairs": {
      let cost = 0;
      Object.values(properties).forEach(prop => {
        if (prop.ownerId === player.id) {
          if (prop.houses === 5) cost += card.hotel;
          else cost += prop.houses * card.house;
        }
      });
      player.money -= cost;
      log(`${player.name} paie ${cost} M€ de réparations.`);
      checkBankruptcyToBank(player);
      finishLandingResolution();
      return;
    }
    case "nearestrailroad": {
      const railroads = BOARD.filter(s => s.type === "railroad").map(s => s.id);
      const next = railroads.find(id => id > player.position) ?? railroads[0];
      moveTo(player, next, true);
      return;
    }
    case "nearestutility": {
      const utilities = BOARD.filter(s => s.type === "utility").map(s => s.id);
      const next = utilities.find(id => id > player.position) ?? utilities[0];
      moveTo(player, next, true);
      return;
    }
    default:
      finishLandingResolution();
  }
}

// ===================== GESTION DES PROPRIÉTÉS =====================
function addManageButton() {
  const btn = document.createElement("button");
  btn.className = "btn ghost wide";
  btn.textContent = "🏠 Gérer mes propriétés";
  btn.style.marginBottom = "4px";
  btn.onclick = () => openManageModal();
  document.querySelector(".turn-panel").insertBefore(btn, document.getElementById("action-buttons"));
}

function openManageModal() {
  const p = currentPlayer();
  const owned = BOARD.filter(s => properties[s.id] && properties[s.id].ownerId === p.id);
  if (owned.length === 0) {
    openModal(`<h2>Mes propriétés</h2><p>Vous ne possédez aucune propriété pour le moment.</p>
      <div class="modal-buttons"><button class="btn ghost" id="close-manage">Fermer</button></div>`);
    document.getElementById("close-manage").onclick = closeModal;
    return;
  }
  let rowsHtml = "";
  owned.forEach(space => {
    const prop = properties[space.id];
    rowsHtml += `<div class="property-row" data-id="${space.id}">
      <span>${space.name} ${prop.mortgaged ? "(hypothéquée)" : ""} ${prop.houses ? `— ${prop.houses === 5 ? "Hôtel" : prop.houses + " maison(s)"}` : ""}</span>
      <span class="row-actions"></span>
    </div>`;
  });
  openModal(`
    <h2>Mes propriétés — ${p.money} M€</h2>
    <div class="property-list">${rowsHtml}</div>
    <div class="modal-buttons"><button class="btn ghost" id="close-manage">Fermer</button></div>
  `);
  document.getElementById("close-manage").onclick = closeModal;

  owned.forEach(space => {
    const prop = properties[space.id];
    const rowActions = document.querySelector(`.property-row[data-id="${space.id}"] .row-actions`);
    if (space.type === "property") {
      const groupIds = BOARD.filter(s => s.group === space.group).map(s => s.id);
      const ownsFullGroup = groupIds.every(id => properties[id] && properties[id].ownerId === p.id);
      const siblingHouses = groupIds.map(id => (properties[id] && properties[id].houses) || 0);
      const minSiblingHouses = Math.min(...siblingHouses);

      if (!prop.mortgaged && ownsFullGroup && prop.houses < 5 && prop.houses <= minSiblingHouses) {
        const buildBtn = document.createElement("button");
        buildBtn.textContent = prop.houses === 4 ? `Hôtel (${space.houseCost} M€)` : `+ Maison (${space.houseCost} M€)`;
        buildBtn.onclick = () => {
          if (p.money < space.houseCost) { alert("Fonds insuffisants !"); return; }
          p.money -= space.houseCost;
          prop.houses++;
          log(`${p.name} construit sur ${space.name}.`);
          renderAll();
          openManageModal();
        };
        rowActions.appendChild(buildBtn);
      }
      if (prop.houses > 0) {
        const sellHouseBtn = document.createElement("button");
        sellHouseBtn.textContent = "Vendre bâtiment";
        sellHouseBtn.onclick = () => {
          prop.houses--;
          p.money += Math.floor(space.houseCost / 2);
          log(`${p.name} vend un bâtiment sur ${space.name}.`);
          renderAll();
          openManageModal();
        };
        rowActions.appendChild(sellHouseBtn);
      }
    }
    if (prop.houses === 0) {
      if (!prop.mortgaged) {
        const mortgageBtn = document.createElement("button");
        mortgageBtn.textContent = `Hypothéquer (+${Math.floor(space.price / 2)} M€)`;
        mortgageBtn.onclick = () => {
          prop.mortgaged = true;
          p.money += Math.floor(space.price / 2);
          log(`${p.name} hypothèque ${space.name}.`);
          renderAll();
          openManageModal();
        };
        rowActions.appendChild(mortgageBtn);
      } else {
        const cost = Math.ceil(space.price / 2 * 1.1);
        const unmortgageBtn = document.createElement("button");
        unmortgageBtn.textContent = `Lever l'hypothèque (-${cost} M€)`;
        unmortgageBtn.onclick = () => {
          if (p.money < cost) { alert("Fonds insuffisants !"); return; }
          p.money -= cost;
          prop.mortgaged = false;
          log(`${p.name} lève l'hypothèque sur ${space.name}.`);
          renderAll();
          openManageModal();
        };
        rowActions.appendChild(unmortgageBtn);
      }
    }
  });
}

// ===================== MODAL GÉNÉRIQUE =====================
function openModal(html) {
  document.getElementById("modal-card").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}
