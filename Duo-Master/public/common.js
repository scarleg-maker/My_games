/* Duo-Master — code partagé par la page arbitre et les pages joueurs */
(() => {
  const DM = (window.DM = {});

  DM.$ = (sel, root = document) => root.querySelector(sel);
  DM.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  DM.PLAYER_COLORS = ['#ff4d6d', '#ffd60a', '#19c37d', '#7c5cff', '#ff8a00', '#2f6bff'];
  DM.playerColor = (id) => DM.PLAYER_COLORS[(id - 1) % DM.PLAYER_COLORS.length];

  /**
   * Code du salon en cours : premier segment de l'adresse (/K7QF, /K7QF/joueur2, /K7QF/rejoindre).
   * Vide sur la page d'accueil elle-même (/).
   */
  DM.room = (() => {
    const seg = (location.pathname.split('/')[1] || '');
    return /^[A-Za-z0-9]{3,8}$/.test(seg) ? seg.toUpperCase() : '';
  })();
  DM.roomUrl = (suffix = '') => `${location.origin}/${DM.room}${suffix}`;

  /**
   * Appel d'API (GET si pas de corps, sinon POST JSON).
   * Le salon en cours (DM.room) est injecté automatiquement : dans le corps pour un POST,
   * en paramètre ?room= pour les lectures propres à un salon (état, réponses).
   */
  DM.api = async (url, body) => {
    let opts = {};
    if (body !== undefined) {
      const payload = DM.room ? { room: DM.room, ...body } : body;
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    } else if (DM.room && /^\/api\/(state|answers)(\?|$)/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'room=' + encodeURIComponent(DM.room);
    }
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
    return j;
  };

  /** Info légère d'un salon par son code (existe-t-il ? thème, joueurs…) — page d'accueil */
  DM.roomInfo = async (code) => {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };

  /** Salons récents sur cet appareil (page d'accueil), mémorisés dans le navigateur */
  DM.recentRooms = {
    list() { try { return JSON.parse(localStorage.getItem('dm_salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = DM.recentRooms.list().filter((x) => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('dm_salons', JSON.stringify(l.slice(0, 8)));
      } catch { /* stockage indisponible */ }
    },
    remove(code) {
      try { localStorage.setItem('dm_salons', JSON.stringify(DM.recentRooms.list().filter((x) => x.code !== code))); }
      catch { /* stockage indisponible */ }
    },
  };

  /**
   * Connexion temps réel (Server-Sent Events, reconnexion automatique) au salon DM.room.
   * role : 'referee' (arbitre), 'ecran' (écran commun), ou un numéro de joueur (1 à 6).
   */
  DM.connect = (role, onState, onConn) => {
    const es = new EventSource(`/events?room=${encodeURIComponent(DM.room)}&role=${encodeURIComponent(role)}`);
    es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
    es.onopen = () => onConn && onConn(true);
    es.onerror = () => onConn && onConn(false);
  };

  /** Thème public (types, couleurs…) — mis en cache, rechargé si le fichier JSON change */
  const themeCache = {};
  DM.getTheme = async (st) => {
    const key = `${st.themeId}:${st.themeRev}`;
    if (!themeCache[key]) themeCache[key] = await DM.api(`/api/theme/${encodeURIComponent(st.themeId)}`);
    return themeCache[key];
  };

  DM.contrast = (hex) => {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#0a1f44' : '#ffffff';
  };

  DM.pips = (score, target) =>
    `<div class="pips" aria-hidden="true">${Array.from({ length: target }, (_, i) => `<span class="pip${i < score ? ' on' : ''}"></span>`).join('')}</div>`;

  /**
   * Compte à rebours synchronisé sur une échéance serveur (horodatage ms).
   * onTick(secondesRestantes, fraction 0→1) est appelé ~8x/s ; onDone() une fois à 0.
   * Renvoie une fonction stop() à appeler pour arrêter proprement.
   */
  DM.countdown = (deadline, totalMs, onTick, onDone) => {
    let done = false;
    const step = () => {
      const left = Math.max(0, deadline - Date.now());
      onTick(Math.ceil(left / 1000), totalMs ? left / totalMs : 0);
      if (left <= 0 && !done) { done = true; onDone && onDone(); }
    };
    step();
    const id = setInterval(step, 120);
    return () => clearInterval(id);
  };

  DM.toast = (text, isError = false) => {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' err' : ''}`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3300);
  };

  DM.eventText = (ev) => {
    if (!ev) return '';
    switch (ev.type) {
      case 'point': return `🎉 Point pour ${ev.name}`;
      case 'answer': return `✅ Bonne réponse de ${ev.name} !`;
      case 'remove': return `Point retiré à ${ev.name}`;
      case 'add': return `+1 point pour ${ev.name}`;
      case 'start': return '🚀 La partie commence !';
      case 'newgame': return 'Nouvelle partie : en attente du lancement';
      default: return '';
    }
  };

  /**
   * Affichage du tirage : défilement pendant la phase « rolling »,
   * puis valeurs choisies par le serveur.
   */
  DM.DrawView = class {
    constructor(el) {
      this.el = el;
      this.themeKey = null;
      this.slots = [];
      this.timer = null;
      this.wasRolling = false;
      this.shownKey = null;
      this.reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    build(theme) {
      this.el.innerHTML = '';
      this.slots = theme.slots.map((s) => {
        const box = document.createElement('div');
        box.className = 'slot empty';
        box.innerHTML = `<div class="slot-label">${DM.esc(s.label)}</div><div class="slot-value">?</div>`;
        this.el.appendChild(box);
        return { def: s, box, value: box.querySelector('.slot-value'), current: null };
      });
      this.shownKey = null;
    }

    paint(slot, val) {
      slot.current = val.name;
      slot.box.classList.remove('empty');
      slot.box.style.backgroundColor = val.color;
      slot.box.style.color = DM.contrast(val.color);
      const len = val.name.length;
      slot.value.className = `slot-value ${len <= 5 ? 's-1' : len <= 8 ? 's-2' : len <= 13 ? 's-3' : len <= 22 ? 's-4' : 's-5'}`;
      slot.value.innerHTML = (val.emoji ? `<span class="emo">${DM.esc(val.emoji)}</span>` : '') + DM.esc(val.name);
    }

    clear() {
      for (const s of this.slots) {
        s.current = null;
        s.box.classList.add('empty');
        s.box.style.backgroundColor = '';
        s.box.style.color = '';
        s.value.className = 'slot-value';
        s.value.textContent = '?';
      }
    }

    tick() {
      for (const s of this.slots) {
        const vals = s.def.values;
        let v;
        do { v = vals[Math.floor(Math.random() * vals.length)]; } while (vals.length > 1 && v.name === s.current);
        this.paint(s, v);
      }
    }

    render(state, theme) {
      const key = `${theme.id}:${theme.rev}`;
      if (key !== this.themeKey) { this.stopRoll(); this.build(theme); this.themeKey = key; }
      const rolling = state.phase === 'rolling';
      this.el.classList.toggle('is-rolling', rolling);

      if (rolling) {
        this.shownKey = '__rolling__';
        if (!this.timer) {
          this.tick();
          this.timer = setInterval(() => this.tick(), this.reduce ? 260 : 85);
        }
      } else {
        this.stopRoll();
        const drawKey = state.draw ? `${state.round}:${state.draw.join('|')}` : null;
        if (drawKey !== this.shownKey) {
          if (!state.draw) this.clear();
          else {
            state.draw.forEach((name, i) => {
              const slot = this.slots[i];
              if (!slot) return;
              const val = slot.def.values.find((v) => v.name === name) || { name, color: '#e8eef8' };
              this.paint(slot, val);
              if (this.wasRolling) {
                slot.box.classList.remove('pop');
                void slot.box.offsetWidth; // relance l'animation
                slot.box.classList.add('pop');
              }
            });
          }
          this.shownKey = drawKey;
        }
      }
      this.wasRolling = rolling;
    }

    stopRoll() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
  };
})();
