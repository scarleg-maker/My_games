/**
 * Registre des salons : chaque salon (code court, ex. K7QF) contient un
 * tournoi Enigma-Lien complet et indépendant (10 places, thème, mode...).
 * Autant de salons que nécessaire peuvent tourner en parallèle.
 *
 * Les salons vivent en mémoire : un salon sans aucune page ouverte depuis
 * ROOM_IDLE_MS est supprimé. Sur un hébergeur gratuit (Render) qui se met en
 * veille, les salons disparaissent ; la page maître propose alors de recréer
 * le salon avec le même code.
 */
const { Tournament, MAX_SLOTS } = require("./tournament");

const CODE_RE = /^[A-Z0-9]{3,10}$/;
// codes qui entreraient en collision avec des routes du site
const RESERVED = new Set(["API", "IMAGES", "CSS", "JS", "SOLO", "MAITRE", "JOUEUR", "CLASSEMENT", "HEALTHZ", "SOCKET"]);
// sans 0/O, 1/I/L pour éviter les confusions à la lecture / à la dictée
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SLOT_RESERVATION_MS = 90 * 1000;

const cleanCode = (c) => String(c || "").trim().toUpperCase();
const validCode = (c) => CODE_RE.test(c) && !RESERVED.has(c) && !/^JOUEUR\d*$/.test(c);

class Room {
  constructor(code, themeStore) {
    this.code = code;
    this.tournament = new Tournament(themeStore);
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.sockets = 0; // nombre de pages (maître + joueurs) actuellement connectées
    this.roundTimer = null;
    this.lastSavedFinishedAt = null;
    this.reservations = new Map(); // slot -> timestamp (place proposée à un joueur qui arrive par le QR code)
  }

  touch() {
    this.lastActivity = Date.now();
  }

  idleMs() {
    return Date.now() - this.lastActivity;
  }

  clearRoundTimer() {
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = null;
  }

  destroy() {
    this.clearRoundTimer();
  }

  /**
   * Attribue la première place libre (sans nom, non réservée récemment) :
   * utilisé par le bouton "Rejoindre" du QR code, pour que deux joueurs qui
   * scannent en même temps n'atterrissent pas sur la même place.
   */
  claimSlot() {
    const now = Date.now();
    for (const [s, t] of this.reservations) if (now - t > SLOT_RESERVATION_MS) this.reservations.delete(s);
    for (let s = 1; s <= MAX_SLOTS; s++) {
      const p = this.tournament.players[s];
      if (!p.name && !this.reservations.has(s)) {
        this.reservations.set(s, now);
        this.touch();
        return s;
      }
    }
    return null;
  }

  /** Résumé public (page d'accueil / page "rejoindre"). */
  info() {
    const t = this.tournament;
    return {
      code: this.code,
      status: t.status,
      mode: t.config ? t.config.mode : null,
      themeId: t.config ? t.config.themeId : null,
      maxSlots: MAX_SLOTS,
      seats: Object.values(t.players).map((p) => ({ slot: p.slot, name: p.name, connected: p.connected })),
    };
  }
}

class RoomRegistry {
  constructor(themeStore, { idleMs = 6 * 3600 * 1000, maxRooms = 200 } = {}) {
    this.themeStore = themeStore;
    this.idleMs = idleMs;
    this.maxRooms = maxRooms;
    this.rooms = new Map();
  }

  get size() {
    return this.rooms.size;
  }

  get(code) {
    return this.rooms.get(cleanCode(code)) || null;
  }

  newCode() {
    for (let len = 4; len <= 8; len++) {
      for (let i = 0; i < 60; i++) {
        let c = "";
        for (let k = 0; k < len; k++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        if (!this.rooms.has(c) && validCode(c)) return c;
      }
    }
    throw new Error("Impossible de générer un code de salon.");
  }

  /**
   * Crée un salon. Sans code, un code aléatoire est généré. Avec un code déjà
   * pris : erreur, sauf si reuse=true (on renvoie alors le salon existant).
   */
  create(requestedCode, { reuse = false } = {}) {
    const code = requestedCode ? cleanCode(requestedCode) : this.newCode();
    if (!validCode(code)) throw new Error("Code invalide : 3 à 10 lettres ou chiffres.");
    const existing = this.rooms.get(code);
    if (existing) {
      if (reuse) return existing;
      throw new Error(`Le salon ${code} est déjà en cours d'utilisation.`);
    }
    if (this.rooms.size >= this.maxRooms) this.purge(true);
    if (this.rooms.size >= this.maxRooms) throw new Error("Trop de salons ouverts sur ce serveur, réessaie plus tard.");
    const room = new Room(code, this.themeStore);
    this.rooms.set(code, room);
    return room;
  }

  /** Supprime les salons inactifs (sans page ouverte). force=true : sans attendre le délai. */
  purge(force = false) {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (room.sockets === 0 && (force || room.idleMs() > this.idleMs)) {
        room.destroy();
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = { RoomRegistry, Room, cleanCode, validCode, MAX_SLOTS };
