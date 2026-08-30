const socket = io();
const el = (id) => document.getElementById(id);

const selectScreen = el("select-screen");
const waitingScreen = el("waiting-screen");
const playScreen = el("play-screen");
const endScreen = el("end-screen");

let myPlayerId = null;
let lastRoundStatus = null;

function showScreen(name) {
  selectScreen.style.display = name === "select" ? "block" : "none";
  waitingScreen.style.display = name === "waiting" ? "block" : "none";
  playScreen.style.display = name === "play" ? "flex" : "none";
  endScreen.style.display = name === "end" ? "block" : "none";
}

// ---------- Choix du joueur ----------

socket.on("player:slots", (slots) => {
  if (myPlayerId) return; // deja choisi, on ignore les mises a jour de la liste
  const list = el("slotList");
  list.innerHTML = "";
  el("noGame").style.display = "none";

  if (slots.length === 0) {
    el("noGame").style.display = "block";
    el("noGame").textContent = "Aucune place disponible pour le moment. Attends que le maître crée la partie.";
    return;
  }

  slots.forEach((s) => {
    const btn = document.createElement("button");
    btn.textContent = s.name;
    btn.addEventListener("click", () => {
      socket.emit("player:claim", { playerId: s.id });
    });
    list.appendChild(btn);
  });
});

socket.on("player:claimFailed", () => {
  alert("Ce joueur a déjà été choisi par quelqu'un d'autre.");
});

socket.on("player:claimed", ({ id, name }) => {
  myPlayerId = id;
  el("waitingName").textContent = `Bienvenue ${name} !`;
  showScreen("waiting");
});

// ---------- Etat du jeu pour ce joueur ----------

socket.on("player:state", (state) => {
  if (!myPlayerId) return;

  if (state.status === "lobby") {
    showScreen("waiting");
    return;
  }

  if (state.status === "finished") {
    showScreen("end");
    el("endText").textContent = state.winnerText || "";
    return;
  }

  if (state.status === "playing" || state.status === "roundEnd") {
    if (state.eliminated) {
      showScreen("end");
      el("endText").textContent = "Tu as été éliminé. Merci d'avoir joué !";
      return;
    }

    showScreen("play");

    // Minuteur
    const timerEl = el("timer");
    if (state.timeLeft === null) {
      timerEl.textContent = "∞";
      timerEl.classList.remove("danger");
    } else {
      timerEl.textContent = `${state.timeLeft}s`;
      timerEl.classList.toggle("danger", state.timeLeft <= 10);
    }

    const totalTxt = state.totalRounds ? ` / ${state.totalRounds}` : "";
    el("progress").textContent = `Image ${state.roundNum}${totalTxt}`;

    if (!state.round) return;

    el("gameImage").src = state.round.imageUrl;

    const overlay = el("overlay");
    const answerForm = el("answerForm");
    const attemptsLeft = el("attemptsLeft");

    if (state.round.status === "playing") {
      overlay.style.display = "none";
      answerForm.style.display = "flex";
      const label = state.mode === "survie" ? "Erreurs restantes" : "Essais restants";
      attemptsLeft.textContent = `${label} : ${state.round.attemptsLeft}`;
      el("answerInput").disabled = false;
      if (lastRoundStatus !== "playing") {
        el("answerInput").value = "";
        el("answerInput").focus();
      }
    } else {
      answerForm.style.display = "none";
      attemptsLeft.textContent = "";
      overlay.style.display = "flex";
      let cls = "wrong";
      if (state.round.status === "correct") cls = "correct";
      overlay.className = "overlay-result " + cls;
      overlay.textContent = state.round.revealedName || "";
    }

    // Historique des essais
    const histWrap = el("historyList");
    histWrap.innerHTML = "";
    [...state.round.history].reverse().forEach((h) => {
      const div = document.createElement("div");
      div.className = h.correct ? "" : "wrong";
      div.textContent = h.text;
      histWrap.appendChild(div);
    });

    lastRoundStatus = state.round.status;
    return;
  }
});

el("answerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = el("answerInput");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("player:submit", { text });
  input.value = "";
});

socket.emit("player:hello");
