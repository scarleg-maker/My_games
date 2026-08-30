const { generatePuzzle, validateArrangement } = require("./puzzleEngine");

const MAX_SLOTS = 10;

function freshPlayer(slot) {
  return {
    slot,
    name: null,
    connected: false,
    active: false,
    score: 0,
    livesLeft: 0,
    status: "empty", // empty | idle | playing | solved | solved-late | out | eliminated | spectateur
  };
}

/**
 * État d'un tournoi "Enigma-Lien" (Sprinteur ou Survie), pour un serveur qui
 * héberge une seule partie à la fois (jusqu'à 10 joueurs). Pure logique
 * d'état, sans dépendance réseau — server.js se charge de diffuser les
 * événements socket.io et de temporiser l'enchaînement des manches.
 */
class Tournament {
  constructor(themeStore) {
    this.themeStore = themeStore;
    this.status = "lobby"; // lobby | playing | finished
    this.config = null; // {themeId, mode, sprintTarget, livesPerRound}
    this.theme = null;
    this.players = {};
    for (let s = 1; s <= MAX_SLOTS; s++) this.players[s] = freshPlayer(s);
    this.round = null; // {number, display, links, scorerSlot, participants}
    this.roundHistory = [];
    this.winnerSlots = [];
    this.finishedAt = null;
  }

  // ---------- inscriptions ----------

  setPlayerName(slot, name) {
    slot = Number(slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
      throw new Error("Emplacement joueur invalide.");
    }
    const clean = String(name || "").trim().slice(0, 24);
    if (!clean) throw new Error("Nom de joueur vide.");
    const lower = clean.toLowerCase();
    for (const p of Object.values(this.players)) {
      if (p.slot !== slot && p.connected && p.name && p.name.toLowerCase() === lower) {
        throw new Error(`Le nom "${clean}" est déjà utilisé par un autre joueur connecté.`);
      }
    }
    const p = this.players[slot];
    p.name = clean;
    p.connected = true;
    if (this.status === "playing" && !p.active) {
      p.status = "spectateur"; // rejoint en cours de manche : spectateur jusqu'au prochain tournoi
    } else if (this.status !== "playing") {
      p.status = "idle";
    }
    return this.getStateFor(slot);
  }

  markConnected(slot) {
    const p = this.players[slot];
    if (p && p.name) p.connected = true;
  }

  markDisconnected(slot) {
    const p = this.players[slot];
    if (!p) return;
    p.connected = false;
    // si le round est en cours et qu'il pouvait encore jouer, on le sort proprement
    // de la manche pour ne pas bloquer les autres joueurs indéfiniment.
    if (this.status === "playing" && p.active && p.status === "playing") {
      p.livesLeft = 0;
      if (this.config.mode === "sprint") {
        p.status = "out";
        this._maybeCloseSprintRound();
      } else {
        p.status = "eliminated";
        p.active = false;
        this.round.resolved.add(slot);
        this._maybeCloseSurvieRound();
      }
    }
  }

  removePlayer(slot) {
    this.players[slot] = freshPlayer(Number(slot));
  }

  // ---------- configuration / cycle de vie ----------

  configure({ themeId, mode, sprintTarget, livesPerRound }) {
    if (this.status === "playing") {
      throw new Error("Impossible de reconfigurer : un tournoi est en cours (termine-le ou réinitialise-le d'abord).");
    }
    const theme = this.themeStore.getTheme(themeId);
    if (!["sprint", "survie"].includes(mode)) throw new Error("Mode de tournoi invalide.");
    const target = Math.max(1, parseInt(sprintTarget, 10) || 5);
    const lives = Math.max(1, parseInt(livesPerRound, 10) || 4);
    this.config = { themeId, mode, sprintTarget: target, livesPerRound: lives };
    this.theme = theme;
    this.status = "lobby";
    this.round = null;
    this.roundHistory = [];
    this.winnerSlots = [];
    this.finishedAt = null;
    for (const p of Object.values(this.players)) {
      p.score = 0;
      p.livesLeft = 0;
      p.active = false;
      if (p.connected) p.status = "idle";
    }
    return this.getMasterState();
  }

  start() {
    if (this.status !== "lobby") throw new Error("Le tournoi n'est pas en attente (lobby).");
    if (!this.config) throw new Error("Configure d'abord le tournoi (thème, mode, paramètres).");
    const participants = Object.values(this.players).filter((p) => p.connected && p.name);
    if (participants.length < 1) throw new Error("Aucun joueur inscrit.");
    for (const p of participants) {
      p.active = true;
      p.score = 0;
      p.status = "idle";
    }
    this.status = "playing";
    this.roundHistory = [];
    this.winnerSlots = [];
    this._startRound();
    return this.getMasterState();
  }

  startNextRound() {
    if (this.status !== "playing") return this.getMasterState();
    this._startRound();
    return this.getMasterState();
  }

  _startRound() {
    const active = Object.values(this.players).filter((p) => p.active);
    const { solution, links, display } = generatePuzzle(this.theme.dataset, this.theme.criteria, this.theme.battleTable, {
      charCount: this.theme.charCount || 6,
    });
    const number = this.roundHistory.length + 1;
    this.round = {
      number,
      solution,
      links,
      display,
      scorerSlot: null,
      resolved: new Set(),
      participants: active.map((p) => p.slot),
    };
    for (const p of active) {
      p.livesLeft = this.config.livesPerRound;
      p.status = "playing";
    }
  }

  // ---------- soumission d'une proposition ----------

  submit(slot, orderNames) {
    slot = Number(slot);
    if (this.status !== "playing" || !this.round) throw new Error("Aucune manche en cours.");
    const p = this.players[slot];
    if (!p || !p.active) throw new Error("Tu ne participes pas à cette manche.");
    if (p.status !== "playing") throw new Error("Tu ne peux plus jouer cette manche.");

    const display = this.round.display;
    if (!Array.isArray(orderNames) || orderNames.length !== display.length) {
      throw new Error("Arrangement invalide.");
    }
    const arrangement = orderNames.map((name) => display.find((c) => c.name === name));
    if (arrangement.some((c) => !c)) throw new Error("Arrangement invalide (personnage inconnu).");

    const { results, correctCount, solved } = validateArrangement(
      arrangement,
      this.round.links,
      this.theme.criteria,
      this.theme.battleTable
    );

    const out = {
      playerResult: { results, correctCount, solved, livesLeft: p.livesLeft, status: p.status },
      roundOver: false,
      scorerSlot: null,
      tournamentOver: false,
      winnerSlots: [],
    };

    if (solved) {
      if (this.config.mode === "sprint") {
        if (this.round.scorerSlot == null) {
          this.round.scorerSlot = slot;
          p.status = "solved";
          p.score += 1;
          out.scorerSlot = slot;
          if (p.score >= this.config.sprintTarget) {
            this._finish([slot]);
            out.tournamentOver = true;
            out.winnerSlots = this.winnerSlots;
          } else {
            out.roundOver = true;
            this._closeRound();
          }
        } else {
          p.status = "solved-late";
        }
      } else {
        // survie
        p.status = "solved";
        p.score += 1;
        this.round.resolved.add(slot);
        this._maybeCloseSurvieRound(out);
      }
    } else {
      p.livesLeft -= 1;
      out.playerResult.livesLeft = p.livesLeft;
      if (p.livesLeft <= 0) {
        if (this.config.mode === "sprint") {
          p.status = "out";
          out.playerResult.status = "out";
          if (this._maybeCloseSprintRound()) {
            out.roundOver = true;
          }
        } else {
          p.status = "eliminated";
          p.active = false;
          out.playerResult.status = "eliminated";
          this.round.resolved.add(slot);
          this._maybeCloseSurvieRound(out);
        }
      }
    }
    return out;
  }

  _maybeCloseSprintRound() {
    if (!this.round || this.status !== "playing") return false;
    if (this.round.scorerSlot != null) return false; // déjà clôturée par un vainqueur
    const stillPlaying = this.round.participants.some((s) => this.players[s].status === "playing");
    if (!stillPlaying) {
      this._closeRound();
      return true;
    }
    return false;
  }

  _maybeCloseSurvieRound(out) {
    if (!this.round || this.status !== "playing") return;
    const allResolved = this.round.participants.every((s) => this.round.resolved.has(s));
    if (!allResolved) return;
    if (out) out.roundOver = true;
    const survivors = this.round.participants
      .map((s) => this.players[s])
      .filter((p) => p.status === "solved");
    this._closeRound();
    if (survivors.length <= 1) {
      let winners;
      if (survivors.length === 1) {
        winners = [survivors[0].slot];
      } else {
        // personne n'a survécu à cette manche : ex-aequo entre les participants de la manche
        const parts = this._lastClosedParticipants || [];
        const maxScore = Math.max(0, ...parts.map((s) => this.players[s].score));
        winners = parts.filter((s) => this.players[s].score === maxScore);
      }
      this._finish(winners);
      if (out) {
        out.tournamentOver = true;
        out.winnerSlots = this.winnerSlots;
      }
    }
  }

  _closeRound() {
    this._lastClosedParticipants = this.round.participants.slice();
    this.roundHistory.push({
      number: this.round.number,
      scorerSlot: this.round.scorerSlot,
      participants: this.round.participants,
      statuses: this.round.participants.map((s) => ({ slot: s, status: this.players[s].status })),
    });
  }

  _finish(winnerSlots) {
    this.status = "finished";
    this.winnerSlots = winnerSlots;
    this.finishedAt = new Date().toISOString();
  }

  end() {
    if (this.status !== "playing" && this.status !== "lobby") throw new Error("Rien à terminer.");
    const candidates = Object.values(this.players).filter((p) => p.name && (p.active || p.score > 0));
    if (candidates.length) {
      const maxScore = Math.max(...candidates.map((p) => p.score));
      this._finish(candidates.filter((p) => p.score === maxScore).map((p) => p.slot));
    } else {
      this._finish([]);
    }
    return this.getMasterState();
  }

  resetToLobby() {
    this.status = "lobby";
    this.round = null;
    this.roundHistory = [];
    this.winnerSlots = [];
    this.finishedAt = null;
    for (const p of Object.values(this.players)) {
      p.score = 0;
      p.livesLeft = 0;
      p.active = false;
      if (p.connected) p.status = "idle";
    }
    return this.getMasterState();
  }

  // ---------- lecture d'état ----------

  standings() {
    return Object.values(this.players)
      .filter((p) => p.name)
      .map((p) => ({
        slot: p.slot,
        name: p.name,
        connected: p.connected,
        active: p.active,
        score: p.score,
        livesLeft: p.livesLeft,
        status: p.status,
      }))
      .sort((a, b) => b.score - a.score || a.slot - b.slot);
  }

  getMasterState() {
    return {
      status: this.status,
      config: this.config,
      theme: this.theme ? { id: this.theme.id, name: this.theme.name, icon: this.theme.icon, criteria: this.theme.criteria } : null,
      players: this.standings(),
      round: this.round
        ? {
            number: this.round.number,
            participants: this.round.participants,
            scorerSlot: this.round.scorerSlot,
            links: this.round.links,
          }
        : null,
      winnerSlots: this.winnerSlots,
      finishedAt: this.finishedAt,
    };
  }

  /** État + éventuellement la manche en cours, du point de vue d'un joueur donné. */
  getStateFor(slot) {
    const p = this.players[slot];
    const base = {
      status: this.status,
      config: this.config,
      me: p,
      standings: this.standings(),
      winnerSlots: this.winnerSlots,
    };
    if (this.round && this.status === "playing") {
      base.round = {
        number: this.round.number,
        display: this.round.display.map((c) => ({ name: c.name, types: c.types, image: c.image })),
        links: this.round.links,
        imageFolder: this.theme.imageFolder,
        criteria: this.theme.criteria,
      };
    } else {
      base.round = null;
    }
    return base;
  }
}

module.exports = { Tournament, MAX_SLOTS };
