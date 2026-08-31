const params = new URLSearchParams(location.search);
const gameId = params.get("game");
const myPlayerIndex = parseInt(params.get("player"), 10);

const socket = io();

let latestState = null;
let boardBuilt = false;
let diceAnimTimer = null;
let manageModalOpen = false;

const bannerEl = document.getElementById("current-player-banner");
const die1El = document.getElementById("die1");
const die2El = document.getElementById("die2");
const actionButtonsEl = document.getElementById("action-buttons");
const manageBtn = document.getElementById("manage-btn");
const logEl = document.getElementById("log");

// ===================== CONNEXION =====================
socket.on("connect", () => {
  socket.emit("joinGame", { gameId, playerIndex: myPlayerIndex }, (res) => {
    if (!res.ok) {
      document.body.innerHTML = `<div class="overlay"><div class="setup-card"><h2>Impossible de rejoindre</h2><p>${res.error}</p></div></div>`;
      return;
    }
    applyState(res.state);
  });
});

socket.on("state", (state) => applyState(state));
socket.on("diceRolling", () => startDiceAnimation());

// ===================== PLATEAU =====================
function boardCoords(id) {
  if (id <= 10) return { row: 11, col: 11 - id };
  if (id <= 20) return { row: 21 - id, col: 1 };
  if (id <= 30) return { row: 1, col: id - 19 };
  return { row: id - 29, col: 11 };
}

function buildBoard(state) {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  state.spaces.forEach((space) => {
    const { row, col } = boardCoords(space.id);
    const cell = document.createElement("div");
    cell.className = "cell" + ([0, 10, 20, 30].includes(space.id) ? " corner" : "");
    cell.style.gridColumn = col;
    cell.style.gridRow = row;
    cell.id = `cell-${space.id}`;

    if (space.group) {
      const band = document.createElement("div");
      band.className = "band";
      band.style.background = state.groupColors[space.group];
      cell.appendChild(band);
    }

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = space.name;
    cell.appendChild(nameEl);

    if (space.price || space.amount) {
      const priceEl = document.createElement("div");
      priceEl.className = "price";
      priceEl.textContent = `${space.price || space.amount} M€`;
      cell.appendChild(priceEl);
    }

    const housesEl = document.createElement("div");
    housesEl.className = "houses";
    housesEl.id = `houses-${space.id}`;
    cell.appendChild(housesEl);

    const pawnsEl = document.createElement("div");
    pawnsEl.className = "pawns-on-cell";
    pawnsEl.id = `pawns-${space.id}`;
    cell.appendChild(pawnsEl);

    boardEl.appendChild(cell);
  });

  const centerLogo = document.createElement("div");
  centerLogo.className = "center-logo";
  centerLogo.innerHTML = `<span>${state.boardName.split(" ")[0].toUpperCase()}</span>`;
  boardEl.appendChild(centerLogo);
  boardBuilt = true;
}

function renderOwnership(state) {
  state.spaces.forEach((space) => {
    const cell = document.getElementById(`cell-${space.id}`);
    const housesEl = document.getElementById(`houses-${space.id}`);
    if (!cell) return;
    const prop = state.properties[space.id];
    cell.classList.remove("owned", "mortgaged");
    cell.style.removeProperty("--owner-color");
    if (prop) {
      const owner = state.players.find((p) => p.id === prop.ownerId);
      cell.classList.add("owned");
      if (prop.mortgaged) cell.classList.add("mortgaged");
      if (owner) cell.style.setProperty("--owner-color", owner.color);
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

function renderPawns(state) {
  state.spaces.forEach((space) => {
    const el = document.getElementById(`pawns-${space.id}`);
    if (el) el.innerHTML = "";
  });
  state.players.filter((p) => !p.bankrupt).forEach((p) => {
    const container = document.getElementById(`pawns-${p.position}`);
    if (!container) return;
    const pawn = document.createElement("div");
    pawn.className = "pawn";
    pawn.style.background = p.color;
    pawn.title = p.name;
    container.appendChild(pawn);
  });
}

function renderPlayersPanel(state) {
  const panel = document.getElementById("players-panel");
  panel.innerHTML = "";
  state.players.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "player-card" +
      (i === state.currentPlayerIndex && !state.gameOver ? " active" : "") +
      (p.bankrupt ? " bankrupt" : "");
    const youTag = i === myPlayerIndex ? " (vous)" : "";
    const aiTag = p.type === "ai" ? " 🤖" : "";
    card.innerHTML = `
      <div class="swatch" style="background:${p.color}"></div>
      <div class="pname">${p.name}${youTag}${aiTag}${p.inJail ? ' <span class="jail-tag">🔒</span>' : ""}</div>
      <div class="pmoney">${p.money} M€</div>
    `;
    panel.appendChild(card);
  });
}

function renderLog(state) {
  const seen = logEl.dataset.count || 0;
  if (+seen === state.log.length) return;
  logEl.innerHTML = "";
  state.log.forEach((msg) => {
    const entry = document.createElement("div");
    entry.className = "entry";
    entry.textContent = msg;
    logEl.appendChild(entry);
  });
  logEl.dataset.count = state.log.length;
}

// ===================== DÉS =====================
function startDiceAnimation() {
  clearInterval(diceAnimTimer);
  die1El.classList.add("rolling");
  die2El.classList.add("rolling");
  diceAnimTimer = setInterval(() => {
    die1El.textContent = 1 + Math.floor(Math.random() * 6);
    die2El.textContent = 1 + Math.floor(Math.random() * 6);
  }, 90);
}
function syncDice(state) {
  if (state.hasRolled && state.dice[0] != null) {
    clearInterval(diceAnimTimer);
    diceAnimTimer = null;
    die1El.classList.remove("rolling");
    die2El.classList.remove("rolling");
    die1El.textContent = state.dice[0];
    die2El.textContent = state.dice[1];
  } else if (!diceAnimTimer) {
    die1El.textContent = "?";
    die2El.textContent = "?";
  }
}

// ===================== CONTRÔLES =====================
function renderControls(state) {
  const isMyTurn = state.currentPlayerIndex === myPlayerIndex;
  const me = state.players[myPlayerIndex];
  actionButtonsEl.innerHTML = "";
  manageBtn.disabled = state.gameOver;

  if (state.gameOver) {
    bannerEl.textContent = `🏆 ${state.players.find((p) => p.id === state.winnerId)?.name} remporte la partie !`;
    return;
  }

  const current = state.players[state.currentPlayerIndex];
  if (!isMyTurn) {
    bannerEl.textContent = current.type === "ai" ? `🤖 ${current.name} réfléchit…` : `Au tour de ${current.name}…`;
    return;
  }

  bannerEl.textContent = "C'est votre tour !";

  if (state.pendingAction) return; // la modale gère l'action

  if (me.inJail && !state.hasRolled) {
    const payBtn = document.createElement("button");
    payBtn.className = "btn ghost wide";
    payBtn.textContent = "Payer 50 M€ pour sortir";
    payBtn.onclick = () => socket.emit("payJailFee");
    actionButtonsEl.appendChild(payBtn);

    if (me.jailCards > 0) {
      const cardBtn = document.createElement("button");
      cardBtn.className = "btn ghost wide";
      cardBtn.textContent = "Utiliser une carte de sortie";
      cardBtn.onclick = () => socket.emit("useJailCard");
      actionButtonsEl.appendChild(cardBtn);
    }
    const rollBtn = document.createElement("button");
    rollBtn.className = "btn primary wide";
    rollBtn.textContent = "Tenter un double";
    rollBtn.onclick = () => socket.emit("rollDice");
    actionButtonsEl.appendChild(rollBtn);
    return;
  }

  if (!state.hasRolled) {
    const rollBtn = document.createElement("button");
    rollBtn.className = "btn primary wide";
    rollBtn.textContent = "Lancer les dés";
    rollBtn.onclick = () => socket.emit("rollDice");
    actionButtonsEl.appendChild(rollBtn);
  } else {
    const endBtn = document.createElement("button");
    endBtn.className = "btn ghost wide";
    endBtn.textContent = "Fin du tour";
    endBtn.onclick = () => socket.emit("endTurn");
    actionButtonsEl.appendChild(endBtn);
  }
}

// ===================== MODALES =====================
function openModal(html) {
  document.getElementById("modal-card").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  manageModalOpen = false;
}

function renderPendingModal(state) {
  const isMyTurn = state.currentPlayerIndex === myPlayerIndex;
  if (!state.pendingAction || !isMyTurn) {
    if (!manageModalOpen) closeModal();
    return;
  }
  const action = state.pendingAction;
  if (action.type === "buy") {
    const space = state.spaces[action.spaceId];
    const me = state.players[myPlayerIndex];
    openModal(`
      <h2>${space.name}</h2>
      <p>Terrain libre. Prix d'achat : <strong>${space.price} M€</strong></p>
      <p>Votre solde : ${me.money} M€</p>
      <div class="modal-buttons">
        <button class="btn primary" id="buy-yes">Acheter</button>
        <button class="btn ghost" id="buy-no">Ne pas acheter</button>
      </div>
    `);
    document.getElementById("buy-yes").onclick = () => socket.emit("buyDecision", { buy: true });
    document.getElementById("buy-no").onclick = () => socket.emit("buyDecision", { buy: false });
  } else if (action.type === "card") {
    openModal(`
      <h2>${action.deck}</h2>
      <div class="card-flavor">${action.card.text}</div>
      <div class="modal-buttons">
        <button class="btn primary" id="card-ok">OK</button>
      </div>
    `);
    document.getElementById("card-ok").onclick = () => socket.emit("ackCard");
  }
}

manageBtn.onclick = () => {
  manageModalOpen = true;
  renderManageModal();
};

function renderManageModal() {
  if (!manageModalOpen || !latestState) return;
  const state = latestState;
  const me = state.players[myPlayerIndex];
  const owned = state.spaces.filter((s) => state.properties[s.id] && state.properties[s.id].ownerId === me.id);
  const isMyTurn = state.currentPlayerIndex === myPlayerIndex;

  if (owned.length === 0) {
    openModal(`<h2>Mes propriétés</h2><p>Vous ne possédez aucune propriété pour le moment.</p>
      <div class="modal-buttons"><button class="btn ghost" id="close-manage">Fermer</button></div>`);
    document.getElementById("close-manage").onclick = () => { manageModalOpen = false; closeModal(); };
    return;
  }

  let rowsHtml = "";
  owned.forEach((space) => {
    const prop = state.properties[space.id];
    rowsHtml += `<div class="property-row" data-id="${space.id}">
      <span>${space.name} ${prop.mortgaged ? "(hypothéquée)" : ""} ${prop.houses ? `— ${prop.houses === 5 ? "Hôtel" : prop.houses + " maison(s)"}` : ""}</span>
      <span class="row-actions"></span>
    </div>`;
  });
  openModal(`
    <h2>Mes propriétés — ${me.money} M€</h2>
    <div class="property-list">${rowsHtml}</div>
    <div class="modal-buttons"><button class="btn ghost" id="close-manage">Fermer</button></div>
  `);
  document.getElementById("close-manage").onclick = () => { manageModalOpen = false; closeModal(); };

  if (!isMyTurn) return; // lecture seule si ce n'est pas votre tour

  owned.forEach((space) => {
    const prop = state.properties[space.id];
    const rowActions = document.querySelector(`.property-row[data-id="${space.id}"] .row-actions`);
    if (!rowActions) return;

    if (space.type === "property") {
      const groupIds = state.spaces.filter((s) => s.group === space.group).map((s) => s.id);
      const ownsFullGroup = groupIds.every((id) => state.properties[id] && state.properties[id].ownerId === me.id);
      const minSiblingHouses = Math.min(...groupIds.map((id) => (state.properties[id] && state.properties[id].houses) || 0));

      if (!prop.mortgaged && ownsFullGroup && prop.houses < 5 && prop.houses <= minSiblingHouses) {
        const buildBtn = document.createElement("button");
        buildBtn.textContent = prop.houses === 4 ? `Hôtel (${space.houseCost} M€)` : `+ Maison (${space.houseCost} M€)`;
        buildBtn.onclick = () => socket.emit("manageProperty", { spaceId: space.id, action: "build" });
        rowActions.appendChild(buildBtn);
      }
      if (prop.houses > 0) {
        const sellBtn = document.createElement("button");
        sellBtn.textContent = "Vendre bâtiment";
        sellBtn.onclick = () => socket.emit("manageProperty", { spaceId: space.id, action: "sellHouse" });
        rowActions.appendChild(sellBtn);
      }
    }
    if (prop.houses === 0) {
      if (!prop.mortgaged) {
        const mortgageBtn = document.createElement("button");
        mortgageBtn.textContent = `Hypothéquer (+${Math.floor(space.price / 2)} M€)`;
        mortgageBtn.onclick = () => socket.emit("manageProperty", { spaceId: space.id, action: "mortgage" });
        rowActions.appendChild(mortgageBtn);
      } else {
        const cost = Math.ceil((space.price / 2) * 1.1);
        const unmortgageBtn = document.createElement("button");
        unmortgageBtn.textContent = `Lever l'hypothèque (-${cost} M€)`;
        unmortgageBtn.onclick = () => socket.emit("manageProperty", { spaceId: space.id, action: "unmortgage" });
        rowActions.appendChild(unmortgageBtn);
      }
    }
  });
}

// ===================== APPLICATION D'ÉTAT =====================
function applyState(state) {
  latestState = state;
  if (!boardBuilt) buildBoard(state);
  syncDice(state);
  renderOwnership(state);
  renderPawns(state);
  renderPlayersPanel(state);
  renderLog(state);
  renderControls(state);
  renderPendingModal(state);
  if (manageModalOpen) renderManageModal();
}
