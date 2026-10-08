// Adresses : /CODE/joueurN (joueur assis) ou /CODE/plateau (spectateur)
const pm = location.pathname.match(/^\/([A-Za-z0-9]{3,10})\/(?:joueur([1-8])|plateau)/i) || [];
const ROOM = (pm[1] || '').toUpperCase();
const myPlayerIndex = pm[2] ? parseInt(pm[2], 10) - 1 : -1; // -1 = spectateur
const isSpectator = myPlayerIndex < 0;

const socket = io();

let latestState = null;
let latestRoom = null;
let boardBuilt = false;
let diceAnimTimer = null;
let manageModalOpen = false;
let lobbyFormKey = null;

const bannerEl = document.getElementById("current-player-banner");
const die1El = document.getElementById("die1");
const die2El = document.getElementById("die2");
const actionButtonsEl = document.getElementById("action-buttons");
const manageBtn = document.getElementById("manage-btn");
const logEl = document.getElementById("log");
document.getElementById("room-tag").textContent = `Salon ${ROOM}${isSpectator ? " · spectateur" : ` · siège ${myPlayerIndex + 1}`}`;
if (isSpectator) { manageBtn.classList.add("hidden"); document.getElementById("trade-panel").classList.add("hidden"); }
MP.recent.add(ROOM, isSpectator ? "spectateur" : "joueur");

// envoi d'une action au serveur (affiche l'erreur éventuelle)
function act(type, data = {}, cb) {
  socket.emit("act", { type, ...data }, (r) => {
    if (r && !r.ok) { MP.toast(r.error, "bad"); if (r.noroom) showNoRoom(r.error); }
    if (cb) cb(r);
  });
}
function showNoRoom(msg) {
  document.body.innerHTML = `<div class="overlay"><div class="setup-card"><h2>Salon introuvable</h2><p>${MP.esc(msg || "")}</p><a class="btn primary" href="/">Retour à l'accueil</a></div></div>`;
}

// ===================== CONNEXION =====================
socket.on("connect", () => {
  socket.emit("joinRoom", { code: ROOM, role: isSpectator ? "spectator" : "seat", seat: myPlayerIndex }, (res) => {
    if (!res.ok) return showNoRoom(res.error);
    renderRoom(res.room);
    if (res.state && res.room.phase !== "lobby") applyState(res.state);
  });
});

socket.on("room", (room) => renderRoom(room));
socket.on("state", (state) => { if (latestRoom && latestRoom.phase !== "lobby") applyState(state); });
socket.on("roomClosed", () => showNoRoom("Ce salon a été fermé."));
socket.on("diceRolling", () => startDiceAnimation());

// ===================== SALLE D'ATTENTE =====================
function renderRoom(room) {
  const prev = latestRoom;
  latestRoom = room;
  const overlay = document.getElementById("lobby-overlay");
  if (room.phase === "lobby") {
    if (prev && prev.phase !== "lobby") { boardBuilt = false; latestState = null; manageModalOpen = false; seenTrades = new Set(); closeModal(); closeTrade(); }
    overlay.classList.remove("hidden");
    renderLobby(room);
  } else {
    overlay.classList.add("hidden");
  }
}

// Résumé des règles choisies par l'hôte
function rulesText(o) {
  if (!o) return "";
  const parts = [`${o.startMoney} M€ de départ`];
  if (o.doubleGo) parts.push("Départ doublé (400 M€ si on s'arrête dessus)");
  if (o.parkMode !== "off") parts.push("Parc : cagnotte des cartes");
  return parts.join(" · ");
}

let draftName = null; // nom en cours de saisie (conservé quand le formulaire est redessiné)

function pickerHtml(room, me) {
  const taken = (pred) => room.seats.some((x) => x.index !== me.index && x.index < room.nbPlayers && x.type === "human" && x.claimed && pred(x));
  const toks = MPT.TOKENS.map((t) => {
    const isTaken = taken((x) => x.token === t.id);
    return `<button type="button" class="tok-btn${me.token === t.id ? " sel" : ""}${isTaken ? " taken" : ""}" data-token="${t.id}" title="${isTaken ? "Déjà pris" : t.name}">
      ${MPT.tokenSvg(t.id, me.color)}<span>${t.name}</span></button>`;
  }).join("");
  const cols = MPT.COLORS.map((c) => {
    const isTaken = taken((x) => MPT.colorDistance(x.color, c.hex) < 60);
    return `<button type="button" class="col-btn${me.color.toLowerCase() === c.hex ? " sel" : ""}${isTaken ? " taken" : ""}" style="--c:${c.hex}" data-color="${c.hex}" title="${isTaken ? "Déjà prise" : c.name}"></button>`;
  }).join("");
  return `<div class="picker-title">Ton pion</div><div class="tok-grid">${toks}</div>
    <div class="picker-title">Ta couleur</div>
    <div class="col-grid">${cols}<label class="col-custom">ou <input type="color" id="custom-color" value="${me.color}"> libre</label></div>`;
}

function renderLobby(room) {
  document.getElementById("lobby-title").textContent = `Salon ${room.code} — ${room.boardName}`;
  document.getElementById("lobby-rules").textContent = "Règles : " + rulesText(room.options);
  const me = isSpectator ? null : room.seats[myPlayerIndex];
  const form = document.getElementById("lobby-form");
  const key = isSpectator ? "spec" : me ? [me.claimed, me.claimed ? me.name : "", me.token, me.color, room.seats.map((x) => x.claimed + x.token + x.color).join()].join("|") : "none";
  if (key !== lobbyFormKey) { // le formulaire n'est reconstruit que si quelque chose change
    lobbyFormKey = key;
    if (isSpectator) {
      form.innerHTML = `<p class="muted">Tu suis la partie en spectateur. Le plateau s'affichera dès son démarrage.</p>`;
    } else if (me) {
      if (draftName === null) draftName = me.name || localStorage.getItem("monopoly-slg-name") || "";
      const head = me.claimed
        ? `<p>Tu es <strong>${MP.esc(me.name)}</strong> (siège ${myPlayerIndex + 1}). En attente du lancement par l'hôte…</p>
           <button class="btn ghost small" id="release-btn">Changer de nom / libérer le siège</button>`
        : `<p class="muted">Choisis ton nom et ton pion pour t'installer au siège ${myPlayerIndex + 1}.</p>
           <div class="row"><input type="text" id="claim-name" maxlength="16" placeholder="Ton nom" value="${MP.esc(draftName)}" autocomplete="off">
           <button class="btn primary" id="claim-btn">Je m'installe</button></div>`;
      form.innerHTML = head + pickerHtml(room, me);
      if (me.claimed) document.getElementById("release-btn").onclick = () => { draftName = me.name; act("release"); };
      else {
        const input = document.getElementById("claim-name");
        input.addEventListener("input", () => { draftName = input.value; });
        const submit = () => {
          const name = input.value.trim();
          if (name) localStorage.setItem("monopoly-slg-name", name);
          act("claim", { name });
        };
        document.getElementById("claim-btn").onclick = submit;
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
      }
      form.querySelectorAll(".tok-btn").forEach((b) => { b.onclick = () => { if (!b.classList.contains("taken")) act("style", { token: b.dataset.token }); }; });
      form.querySelectorAll(".col-btn").forEach((b) => { b.onclick = () => { if (!b.classList.contains("taken")) act("style", { color: b.dataset.color }); }; });
      document.getElementById("custom-color").onchange = (e) => act("style", { color: e.target.value });
    }
  }
  document.getElementById("lobby-seats").innerHTML = room.seats.map((x) => {
    const sub = x.type === "ai" ? "🤖 joué par l'IA" : x.claimed ? (x.online ? "connecté" : "installé, pas connecté") : "place libre";
    const you = x.index === myPlayerIndex ? " (vous)" : "";
    return `<div class="seat static"><span class="stok">${MPT.tokenSvg(x.token, x.color)}</span><span class="dot${x.online ? " on" : ""}"></span>
      <span class="who">${MP.esc(x.name || "Joueur " + (x.index + 1))}${you}<small>Siège ${x.index + 1} — ${sub}</small></span></div>`;
  }).join("");
  const missing = room.seats.filter((x) => !x.claimed).length;
  document.getElementById("lobby-wait").textContent = missing
    ? `En attente de ${missing} joueur${missing > 1 ? "s" : ""}…`
    : "Tout le monde est là : l'hôte peut lancer la partie.";
}

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

    if (space.type === "go") {
      const g = document.createElement("div");
      g.className = "price";
      g.textContent = state.options && state.options.doubleGo ? "Arrêt : +400 M€" : "+200 M€";
      cell.appendChild(g);
    }
    if (space.type === "freeparking" && state.options && state.options.parkMode !== "off") {
      const pot = document.createElement("div");
      pot.className = "pot"; pot.id = "pot";
      cell.appendChild(pot);
    }

    boardEl.appendChild(cell);
  });

  const centerLogo = document.createElement("div");
  centerLogo.className = "center-logo";
  centerLogo.innerHTML = `<span>MONOPOLY-SLG</span><small>${MP.esc(state.boardName)}</small><small class="rules-line">${MP.esc(rulesText(state.options))}</small>`;
  boardEl.appendChild(centerLogo);

  const layer = document.createElement("div");
  layer.className = "pawn-layer";
  layer.id = "pawn-layer";
  boardEl.appendChild(layer);
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

// Répartition des pions quand plusieurs occupent la même case : plus il y en a, plus ils sont petits
// (--s = facteur de taille). Les positions sont en fraction de case, relatives au centre de la case.
function spread(k) {
  if (k === 1) return { s: 1, pts: [[0, 0.1]] };
  const sc = k === 2 ? 0.85 : k <= 4 ? 0.72 : 0.55;
  const pitch = 0.56 * sc * 0.95;
  const cols = k <= 2 ? k : k <= 4 ? 2 : 3;
  const rows = Math.ceil(k / cols);
  const pts = [];
  for (let i = 0; i < k; i++) {
    const r = Math.floor(i / cols), c = i % cols, inRow = Math.min(cols, k - r * cols);
    pts.push([(c - (inRow - 1) / 2) * pitch, (r - (rows - 1) / 2) * pitch + 0.1]);
  }
  return { s: sc, pts };
}

function renderPawns(state) {
  const layer = document.getElementById("pawn-layer");
  if (!layer) return;
  const alive = state.players.filter((p) => !p.bankrupt);
  // retire les pions des joueurs en faillite
  layer.querySelectorAll(".pawn").forEach((el) => { if (!alive.some((p) => "p" + p.id === el.id)) el.remove(); });

  const groups = {};
  alive.forEach((p) => (groups[p.position] = groups[p.position] || []).push(p));
  Object.entries(groups).forEach(([pos, list]) => {
    const { col, row } = boardCoords(+pos);
    const sp = spread(list.length);
    list.forEach((p, i) => {
      let el = document.getElementById("p" + p.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "pawn"; el.id = "p" + p.id;
        el.dataset.pos = p.position;
        el.style.left = ((col - 0.5) / 11) * 100 + "%";
        el.style.top = ((row - 0.5) / 11) * 100 + "%";
        layer.appendChild(el);
      }
      const sig = p.token + p.color;
      if (el.dataset.sig !== sig) { el.innerHTML = MPT.tokenSvg(p.token, p.color); el.dataset.sig = sig; el.title = p.name; }
      el.style.left = ((col - 0.5) / 11) * 100 + "%";
      el.style.top = ((row - 0.5) / 11) * 100 + "%";
      el.style.marginLeft = `calc(var(--cell) * ${sp.pts[i][0]})`;
      el.style.marginTop = `calc(var(--cell) * ${sp.pts[i][1]})`;
      el.style.setProperty("--s", sp.s);
      el.classList.toggle("active", p.id === state.currentPlayerIndex && !state.gameOver);
      if (el.dataset.pos !== String(p.position)) { // petit saut à chaque case franchie
        el.dataset.pos = p.position;
        el.classList.remove("hop"); void el.offsetWidth; el.classList.add("hop");
      }
    });
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
      <div class="ptok">${MPT.tokenSvg(p.token, p.color)}</div>
      <div class="pname">${MP.esc(p.name)}${youTag}${aiTag}${p.inJail ? ' <span class="jail-tag">🔒</span>' : ""}</div>
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
  if (state.moving) {
    bannerEl.textContent = isMyTurn ? "Votre pion avance…" : `${current.name} avance…`;
    return;
  }
  if (isSpectator) {
    bannerEl.textContent = current.type === "ai" ? `🤖 ${current.name} joue…` : `Au tour de ${current.name}`;
    return;
  }
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
    payBtn.onclick = () => act("payJailFee");
    actionButtonsEl.appendChild(payBtn);

    if (me.jailCards > 0) {
      const cardBtn = document.createElement("button");
      cardBtn.className = "btn ghost wide";
      cardBtn.textContent = "Utiliser une carte de sortie";
      cardBtn.onclick = () => act("useJailCard");
      actionButtonsEl.appendChild(cardBtn);
    }
    const rollBtn = document.createElement("button");
    rollBtn.className = "btn primary wide";
    rollBtn.textContent = "Tenter un double";
    rollBtn.onclick = () => act("rollDice");
    actionButtonsEl.appendChild(rollBtn);
    return;
  }

  if (!state.hasRolled) {
    const rollBtn = document.createElement("button");
    rollBtn.className = "btn primary wide";
    rollBtn.textContent = "Lancer les dés";
    rollBtn.onclick = () => act("rollDice");
    actionButtonsEl.appendChild(rollBtn);
  } else {
    const endBtn = document.createElement("button");
    endBtn.className = "btn ghost wide";
    endBtn.textContent = "Fin du tour";
    endBtn.onclick = () => act("endTurn");
    actionButtonsEl.appendChild(endBtn);
  }
}

// un clic sur un bouton d'action le désactive aussitôt (évite les doubles envois)
actionButtonsEl.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) b.disabled = true; });

// ===================== CAGNOTTE DU PARC =====================
function renderPot(state) {
  const el = document.getElementById("pot");
  if (el) el.textContent = `💰 ${state.parkPot} M€`;
}

// ===================== ÉCHANGES =====================
let seenTrades = new Set();
const tradeBtn = document.getElementById("trade-btn");
const tradeOverlay = document.getElementById("trade-overlay");
const tradeCard = document.getElementById("trade-card");

function describeSide(state, side) {
  const items = side.props.map((id) => state.spaces[id].name);
  if (side.money) items.push(`${side.money} M€`);
  if (side.jail) items.push(`${side.jail} carte${side.jail > 1 ? "s" : ""} « sortie de prison »`);
  return items.length ? items.map(MP.esc).join(", ") : "rien";
}

function renderTrades(state) {
  if (isSpectator) return;
  const me = state.players[myPlayerIndex];
  tradeBtn.disabled = state.gameOver || !me || me.bankrupt;
  const mine = (state.trades || []).filter((t) => t.from === myPlayerIndex || t.to === myPlayerIndex);
  mine.forEach((t) => {
    if (t.to === myPlayerIndex && !seenTrades.has(t.id)) {
      seenTrades.add(t.id);
      MP.toast(`🤝 ${state.players[t.from].name} te propose un échange`, "ok");
    }
  });
  const list = document.getElementById("trade-list");
  list.innerHTML = mine.map((t) => {
    if (t.to === myPlayerIndex) {
      return `<div class="trade-item incoming">
        <div><strong>${MP.esc(state.players[t.from].name)}</strong> te propose un échange</div>
        <div class="trade-line">Tu reçois : <b>${describeSide(state, t.give)}</b></div>
        <div class="trade-line">Tu donnes : <b>${describeSide(state, t.get)}</b></div>
        <div class="trade-actions"><button class="btn primary small" data-acc="${t.id}">Accepter</button>
        <button class="btn ghost small" data-dec="${t.id}">Refuser</button></div></div>`;
    }
    return `<div class="trade-item outgoing">
      <div>Ta proposition à <strong>${MP.esc(state.players[t.to].name)}</strong> (en attente)</div>
      <div class="trade-line">Tu donnes : <b>${describeSide(state, t.give)}</b></div>
      <div class="trade-line">Tu reçois : <b>${describeSide(state, t.get)}</b></div>
      <div class="trade-actions"><button class="btn ghost small" data-cancel="${t.id}">Annuler</button></div></div>`;
  }).join("");
  list.querySelectorAll("[data-acc]").forEach((b) => { b.onclick = () => { b.disabled = true; act("tradeAccept", { id: +b.dataset.acc }); }; });
  list.querySelectorAll("[data-dec]").forEach((b) => { b.onclick = () => { b.disabled = true; act("tradeDecline", { id: +b.dataset.dec }); }; });
  list.querySelectorAll("[data-cancel]").forEach((b) => { b.onclick = () => { b.disabled = true; act("tradeCancel", { id: +b.dataset.cancel }); }; });
}

function closeTrade() { tradeOverlay.classList.add("hidden"); }
tradeBtn.onclick = () => openTradeComposer();

// Fenêtre de composition : choix du partenaire puis des deux côtés de l'échange
function openTradeComposer(partner) {
  const st = latestState;
  if (!st || isSpectator) return;
  const me = st.players[myPlayerIndex];
  const others = st.players.filter((p) => p.id !== myPlayerIndex && !p.bankrupt);
  if (!others.length) return;
  if (partner === undefined) {
    if (others.length === 1) return openTradeComposer(others[0].id);
    tradeCard.innerHTML = `<h2>Échanger avec…</h2><div class="trade-partners">${others.map((p) =>
      `<button class="btn ghost trade-partner" data-p="${p.id}"><span class="stok">${MPT.tokenSvg(p.token, p.color)}</span>${MP.esc(p.name)}${p.type === "ai" ? " 🤖" : ""}</button>`).join("")}</div>
      <div class="modal-buttons"><button class="btn ghost" id="trade-close">Fermer</button></div>`;
    tradeCard.querySelectorAll("[data-p]").forEach((b) => { b.onclick = () => openTradeComposer(+b.dataset.p); });
    document.getElementById("trade-close").onclick = closeTrade;
    tradeOverlay.classList.remove("hidden");
    return;
  }
  const other = st.players[partner];
  const ownedBy = (pid) => st.spaces.filter((s) => st.properties[s.id] && st.properties[s.id].ownerId === pid);
  const blocked = (s) => s.type === "property" && st.spaces.some((x) => x.group === s.group && st.properties[x.id] && st.properties[x.id].houses > 0);
  const propRows = (pid, side) => {
    const rows = ownedBy(pid).map((s) => {
      const b = blocked(s), mort = st.properties[s.id].mortgaged;
      return `<label class="trade-prop${b ? " blocked" : ""}" title="${b ? "Vendez d'abord les bâtiments du groupe" : ""}">
        <input type="checkbox" data-side="${side}" value="${s.id}"${b ? " disabled" : ""}>
        <span class="dotc" style="background:${s.group ? st.groupColors[s.group] : "#9aa"}"></span>
        <span>${MP.esc(s.name)}${mort ? " <em>(hypothéquée)</em>" : ""}</span></label>`;
    }).join("");
    return rows || `<p class="small muted">Aucune propriété.</p>`;
  };
  const jailRow = (p, side) => p.jailCards > 0
    ? `<label class="trade-money">Cartes « sortie de prison » (max ${p.jailCards})
        <input type="number" min="0" max="${p.jailCards}" value="0" data-jail="${side}"></label>` : "";
  tradeCard.innerHTML = `
    <h2>Échange avec ${MP.esc(other.name)}${other.type === "ai" ? " 🤖" : ""}</h2>
    <div class="trade-cols">
      <div class="trade-col">
        <h3>Tu donnes</h3>
        <div class="trade-props">${propRows(me.id, "give")}</div>
        <label class="trade-money">Argent (solde : ${me.money} M€)
          <input type="number" min="0" max="${me.money}" step="10" value="0" data-money="give"></label>
        ${jailRow(me, "give")}
      </div>
      <div class="trade-col">
        <h3>Tu reçois</h3>
        <div class="trade-props">${propRows(other.id, "get")}</div>
        <label class="trade-money">Argent (solde de ${MP.esc(other.name)} : ${other.money} M€)
          <input type="number" min="0" max="${other.money}" step="10" value="0" data-money="get"></label>
        ${jailRow(other, "get")}
      </div>
    </div>
    ${other.type === "ai" ? `<p class="small muted">🤖 L'IA accepte si elle reçoit au moins 15 % de valeur en plus de ce qu'elle cède.</p>` : ""}
    <div class="modal-buttons">
      <button class="btn primary" id="trade-send">Envoyer la proposition</button>
      <button class="btn ghost" id="trade-close">Fermer</button>
    </div>`;
  const side = (name) => ({
    props: [...tradeCard.querySelectorAll(`input[data-side="${name}"]:checked`)].map((i) => +i.value),
    money: +(tradeCard.querySelector(`input[data-money="${name}"]`).value || 0),
    jail: +((tradeCard.querySelector(`input[data-jail="${name}"]`) || { value: 0 }).value || 0),
  });
  document.getElementById("trade-close").onclick = closeTrade;
  document.getElementById("trade-send").onclick = () => {
    act("tradePropose", { to: partner, give: side("give"), get: side("get") }, (r) => {
      if (r && r.ok) { closeTrade(); MP.toast("Proposition envoyée", "ok"); }
    });
  };
  tradeOverlay.classList.remove("hidden");
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
    document.getElementById("buy-yes").onclick = () => act("buyDecision", { buy: true });
    document.getElementById("buy-no").onclick = () => act("buyDecision", { buy: false });
  } else if (action.type === "card") {
    openModal(`
      <h2>${action.deck}</h2>
      <div class="card-flavor">${action.card.text}</div>
      <div class="modal-buttons">
        <button class="btn primary" id="card-ok">OK</button>
      </div>
    `);
    document.getElementById("card-ok").onclick = () => act("ackCard");
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
        buildBtn.onclick = () => act("manageProperty", { spaceId: space.id, action: "build" });
        rowActions.appendChild(buildBtn);
      }
      if (prop.houses > 0) {
        const sellBtn = document.createElement("button");
        sellBtn.textContent = "Vendre bâtiment";
        sellBtn.onclick = () => act("manageProperty", { spaceId: space.id, action: "sellHouse" });
        rowActions.appendChild(sellBtn);
      }
    }
    if (prop.houses === 0) {
      if (!prop.mortgaged) {
        const mortgageBtn = document.createElement("button");
        mortgageBtn.textContent = `Hypothéquer (+${Math.floor(space.price / 2)} M€)`;
        mortgageBtn.onclick = () => act("manageProperty", { spaceId: space.id, action: "mortgage" });
        rowActions.appendChild(mortgageBtn);
      } else {
        const cost = Math.ceil((space.price / 2) * 1.1);
        const unmortgageBtn = document.createElement("button");
        unmortgageBtn.textContent = `Lever l'hypothèque (-${cost} M€)`;
        unmortgageBtn.onclick = () => act("manageProperty", { spaceId: space.id, action: "unmortgage" });
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
  renderPot(state);
  renderTrades(state);
  renderPlayersPanel(state);
  renderLog(state);
  renderControls(state);
  renderPendingModal(state);
  if (manageModalOpen) renderManageModal();
}
