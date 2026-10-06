const socket = io();

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
let playerCount = 2;
let playerTypes = ["human", "human"];
let playerNames = ["Joueur 1", "Joueur 2"];

const boardSelect = document.getElementById("board-select");
const countDisplay = document.getElementById("count-display");
const playerRowsEl = document.getElementById("player-rows");

fetch("/api/boards")
  .then((r) => r.json())
  .then((boards) => {
    boardSelect.innerHTML = boards.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  })
  .catch(() => {
    boardSelect.innerHTML = `<option value="paris">Paris — Édition officielle</option>`;
  });

function renderPlayerRows() {
  playerRowsEl.innerHTML = "";
  for (let i = 0; i < playerCount; i++) {
    if (!playerTypes[i]) playerTypes[i] = "human";
    if (!playerNames[i]) playerNames[i] = playerTypes[i] === "ai" ? `IA ${i + 1}` : `Joueur ${i + 1}`;

    const row = document.createElement("div");
    row.className = "player-row";
    row.innerHTML = `
      <div class="swatch" style="background:${PALETTE_PREVIEW[i % PALETTE_PREVIEW.length]}"></div>
      <input type="text" data-idx="${i}" class="pname-input" value="${playerNames[i]}" maxlength="16" />
      <select data-idx="${i}" class="ptype-select">
        <option value="human" ${playerTypes[i] === "human" ? "selected" : ""}>Humain</option>
        <option value="ai" ${playerTypes[i] === "ai" ? "selected" : ""}>IA</option>
      </select>
    `;
    playerRowsEl.appendChild(row);
  }
  playerRowsEl.querySelectorAll(".pname-input").forEach((el) => {
    el.oninput = () => { playerNames[+el.dataset.idx] = el.value; };
  });
  playerRowsEl.querySelectorAll(".ptype-select").forEach((el) => {
    el.onchange = () => { playerTypes[+el.dataset.idx] = el.value; };
  });
}

const PALETTE_PREVIEW = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#8338ec", "#ffbe0b", "#06d6a0", "#ef476f"];

document.getElementById("count-minus").onclick = () => {
  if (playerCount > MIN_PLAYERS) { playerCount--; renderPlayerRows(); countDisplay.textContent = playerCount; }
};
document.getElementById("count-plus").onclick = () => {
  if (playerCount < MAX_PLAYERS) { playerCount++; renderPlayerRows(); countDisplay.textContent = playerCount; }
};
document.getElementById("solo-ai-btn").onclick = () => {
  playerCount = 4;
  playerTypes = ["human", "ai", "ai", "ai"];
  playerNames = ["Vous", "IA 1", "IA 2", "IA 3"];
  countDisplay.textContent = playerCount;
  renderPlayerRows();
};

renderPlayerRows();

document.getElementById("start-game-btn").onclick = () => {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({ type: playerTypes[i] || "human", name: playerNames[i] });
  }
  if (!players.some((p) => p.type === "human")) {
    alert("Il faut au moins un joueur humain.");
    return;
  }
  const boardId = boardSelect.value || "paris";

  socket.emit("createGame", { boardId, players }, (res) => {
    if (!res.ok) { alert("Erreur : " + res.error); return; }
    showResult(res);
  });
};

function showResult(res) {
  document.querySelector(".setup-card:not(.hidden)").classList.add("hidden");
  const resultCard = document.getElementById("result-card");
  resultCard.classList.remove("hidden");

  const linksList = document.getElementById("links-list");
  linksList.innerHTML = "";
  res.players.forEach((p) => {
    if (p.type !== "human") return;
    const url = `${location.origin}/play.html?game=${res.gameId}&player=${p.id}`;
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <span class="link-name">${p.name}</span>
      <a href="${url}" target="_blank" class="btn primary small">Ouvrir</a>
      <button class="btn ghost small copy-btn">Copier le lien</button>
    `;
    row.querySelector(".copy-btn").onclick = (e) => {
      navigator.clipboard.writeText(url);
      e.target.textContent = "Copié !";
      setTimeout(() => { e.target.textContent = "Copier le lien"; }, 1500);
    };
    linksList.appendChild(row);
  });
}

document.getElementById("new-game-btn").onclick = () => location.reload();
