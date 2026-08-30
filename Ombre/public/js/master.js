const socket = io();

const el = (id) => document.getElementById(id);

const setupScreen = el("setup-screen");
const lobbyScreen = el("lobby-screen");
const playScreen = el("play-screen");
const endScreen = el("end-screen");

// ---------- Ecran de configuration ----------

const STORAGE_KEY_NAMES = "ombre_playerNames";
const STORAGE_KEY_NUM = "ombre_numPlayers";

function loadSavedNames() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_NAMES) || "[]");
  } catch {
    return [];
  }
}

function persistNames() {
  const names = Array.from(document.querySelectorAll(".pname")).map((i) => i.value);
  try {
    localStorage.setItem(STORAGE_KEY_NAMES, JSON.stringify(names));
    localStorage.setItem(STORAGE_KEY_NUM, String(names.length));
  } catch {
    // stockage indisponible (navigation privee, etc.) : on continue sans persister
  }
}

function renderPlayerNameFields() {
  const n = parseInt(el("numPlayers").value, 10);
  const saved = loadSavedNames();
  const wrap = el("playerNames");
  wrap.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const div = document.createElement("div");
    div.className = "player-name-field";

    const span = document.createElement("span");
    span.textContent = `Joueur ${i + 1}`;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pname";
    input.placeholder = "Nom";
    input.value = saved[i] || `Joueur ${i + 1}`;
    input.addEventListener("input", persistNames);

    div.appendChild(span);
    div.appendChild(input);
    wrap.appendChild(div);
  }
  persistNames();
}

const savedNumPlayers = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY_NUM);
  } catch {
    return null;
  }
})();
if (savedNumPlayers) el("numPlayers").value = savedNumPlayers;

el("numPlayers").addEventListener("input", renderPlayerNameFields);
renderPlayerNameFields();

function updateModeUI() {
  const mode = el("mode").value;
  el("viesBlock").style.display = mode === "elimination" ? "block" : "none";
  el("essaisLabel").textContent =
    mode === "survie"
      ? "Nombre d'erreurs autorisées avant élimination (3 à 8)"
      : "Nombre d'essais par image (3 à 8)";
}
el("mode").addEventListener("change", updateModeUI);
updateModeUI();

socket.on("master:archives", () => {}); // conserve pour compat, ignore desormais

el("archiveZip").addEventListener("change", () => {
  const f = el("archiveZip").files[0];
  el("zipInfo").textContent = f ? `Fichier sélectionné : ${f.name} (${(f.size / 1024 / 1024).toFixed(1)} Mo)` : "";
});

el("btnCreate").addEventListener("click", async () => {
  const errorEl = el("createError");
  errorEl.textContent = "";

  const names = Array.from(document.querySelectorAll(".pname")).map((i) => i.value.trim() || "Joueur");
  const zipFile = el("archiveZip").files[0];
  if (!zipFile) {
    errorEl.textContent = "Choisis un fichier .zip contenant tes images.";
    return;
  }
  const essais = parseInt(el("essais").value, 10);
  const tempsRaw = parseInt(el("temps").value, 10);
  const tempsSec = tempsRaw === 0 ? "" : tempsRaw;
  const mode = el("mode").value;
  const vies = mode === "elimination" ? parseInt(el("vies").value, 10) : "";

  const form = new FormData();
  form.append("names", JSON.stringify(names));
  form.append("essais", essais);
  form.append("tempsSec", tempsSec);
  form.append("mode", mode);
  form.append("vies", vies);
  form.append("archive", zipFile);

  const btn = el("btnCreate");
  btn.disabled = true;
  btn.textContent = "Envoi du zip et création...";

  try {
    const res = await fetch("/api/create-game", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur inconnue");
    // La suite (passage a l'ecran lobby) arrive via l'evenement socket master:state
  } catch (e) {
    errorEl.textContent = "Erreur : " + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Créer la partie";
  }
});

el("joueurUrl").textContent = `${location.origin}/joueur`;

el("btnStartRound").addEventListener("click", () => socket.emit("master:startRound"));
el("btnNextRound").addEventListener("click", () => socket.emit("master:startRound"));
el("btnReset").addEventListener("click", () => {
  if (confirm("Réinitialiser la partie en cours ?")) socket.emit("master:resetGame");
});
el("btnResetFromLobby").addEventListener("click", () => socket.emit("master:resetGame"));
el("btnNewGame").addEventListener("click", () => socket.emit("master:resetGame"));

// ---------- Reception de l'etat ----------

function showScreen(status) {
  setupScreen.style.display = status === "idle" ? "block" : "none";
  lobbyScreen.style.display = status === "lobby" ? "block" : "none";
  playScreen.style.display = status === "playing" || status === "roundEnd" ? "block" : "none";
  endScreen.style.display = status === "finished" ? "block" : "none";
}

socket.on("master:state", (state) => {
  showScreen(state.status);

  if (state.status === "idle") return;

  if (state.status === "lobby") {
    const list = el("lobbyList");
    list.innerHTML = "";
    state.players.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = `${p.name} — ${p.claimed ? "✅ connecté" : "⏳ en attente"}`;
      list.appendChild(li);
    });
    return;
  }

  if (state.status === "playing" || state.status === "roundEnd") {
    const totalTxt = state.totalRounds ? ` / ${state.totalRounds}` : "";
    el("roundInfo").textContent = `Manche ${state.roundNum}${totalTxt} — mode ${state.settings.mode}`;

    const timerEl = el("timerDisplay");
    if (state.timeLeft === null) {
      timerEl.textContent = "∞";
      timerEl.classList.remove("danger");
    } else {
      timerEl.textContent = `${state.timeLeft}s`;
      timerEl.classList.toggle("danger", state.timeLeft <= 10);
    }

    el("btnNextRound").disabled = state.status !== "roundEnd" && state.status !== "lobby";
    el("btnNextRound").textContent = state.status === "roundEnd" ? "Manche suivante ▶" : "Manche en cours...";
    el("btnNextRound").disabled = state.status === "playing";

    const board = el("board");
    board.innerHTML = "";
    state.players.forEach((p) => {
      const col = document.createElement("div");
      col.className = "player-col" + (p.eliminated ? " eliminated" : "");

      let html = `<h3>${p.name}</h3>`;
      if (p.round) {
        html += `<img src="${p.round.imageUrl}" alt="silhouette" />`;
        html += `<div class="image-name">Réponse : ${p.round.imageName}</div>`;

        const lastEntry = p.round.history[p.round.history.length - 1];
        let boxClass = "";
        let boxText = "...";
        if (p.round.status === "correct") {
          boxClass = "correct";
          boxText = "✔ " + (lastEntry ? lastEntry.text : "");
        } else if (p.round.status === "failed") {
          boxClass = "wrong";
          boxText =
            state.settings.mode === "survie"
              ? "✘ éliminé (erreur ou temps écoulé)"
              : "✘ épuisé / temps écoulé";
        } else if (lastEntry) {
          boxClass = lastEntry.correct ? "correct" : "wrong";
          boxText = (lastEntry.correct ? "✔ " : "✘ ") + lastEntry.text;
        }
        html += `<div class="answer-box ${boxClass}">${boxText}</div>`;

        const attemptsLabel = state.settings.mode === "survie" ? "Erreurs restantes" : "Essais restants";
        html += `<div class="attempts">${attemptsLabel} : ${p.round.attemptsLeft}</div>`;

        if (p.round.status !== "correct") {
          html += `<button class="small validate-btn" data-id="${p.id}">Valider quand même</button>`;
        }

        if (p.round.history.length) {
          html += `<div class="history-list">`;
          p.round.history.forEach((h) => {
            html += `<div class="${h.correct ? "correct-item" : "wrong-item"}">${h.text}</div>`;
          });
          html += `</div>`;
        }
      } else {
        html += `<div class="answer-box">—</div>`;
      }

      if (state.settings.mode === "survie") {
        html += `<div class="lives">Score : ${p.score}${p.eliminated ? " — Éliminé (manche " + p.eliminationRound + ")" : ""}</div>`;
      } else {
        html += `<div class="lives">${p.eliminated ? "Éliminé (manche " + p.eliminationRound + ")" : "Vies : " + "❤".repeat(p.lives)}</div>`;
      }

      col.innerHTML = html;
      board.appendChild(col);
    });

    document.querySelectorAll(".validate-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        socket.emit("master:forceValidate", { playerId: btn.dataset.id });
      });
    });
    return;
  }

  if (state.status === "finished") {
    el("winnerText").textContent = state.winnerText || "";
    const rank = el("finalRanking");
    rank.innerHTML = "<h3>Classement</h3>";
    // Non-elimines d'abord (tries par score desc), puis elimines du plus tardif au plus precoce
    // (tri par score desc en cas d'egalite de manche d'elimination).
    const sorted = [...state.players].sort((a, b) => {
      if (a.eliminated && b.eliminated) {
        if (b.eliminationRound !== a.eliminationRound) return b.eliminationRound - a.eliminationRound;
        return b.score - a.score;
      }
      if (a.eliminated) return 1;
      if (b.eliminated) return -1;
      return b.score - a.score;
    });
    sorted.forEach((p, i) => {
      const line = document.createElement("div");
      let detail;
      if (state.settings.mode === "survie") {
        detail = p.eliminated
          ? `${p.score} point(s) — éliminé à la manche ${p.eliminationRound}`
          : `${p.score} point(s)`;
      } else {
        detail = p.eliminated ? `éliminé à la manche ${p.eliminationRound}` : "vainqueur";
      }
      line.textContent = `${i + 1}. ${p.name} — ${detail}`;
      rank.appendChild(line);
    });
  }
});

socket.on("master:error", (msg) => alert("Erreur : " + msg));

socket.emit("master:hello");
