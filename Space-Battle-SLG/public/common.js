// Outils partagés par les pages (accueil, maître, joueur)
(function () {
  const SB = window.SB = {};
  SB.N = 10;
  SB.LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  SB.PCOL = ['#4cf0ff', '#ff5dc8', '#ffb547', '#58f0a6', '#b79bff', '#ff7a59'];   // une couleur par siège
  SB.TEAMS = [{ name: 'Équipe A', color: '#4cf0ff' }, { name: 'Équipe B', color: '#ff5dc8' }, { name: 'Équipe C', color: '#ffb547' }];
  SB.games = {
    classic: { name: 'Classique', icon: '⚔', desc: '2 joueurs, un duel.' },
    ffa: { name: 'Chacun pour soi', icon: '🎯', desc: '3 à 6 joueurs : on choisit sur qui tirer. Le dernier vivant gagne.' },
    team: { name: 'Équipes', icon: '🤝', desc: '3 à 6 joueurs en équipes A, B, C. Un joueur seul dans son équipe tire après chaque tir adverse.' },
    royale: { name: 'Battle Royale', icon: '👑', desc: '3 à 6 joueurs sur une carte commune. Les vaisseaux peuvent se superposer.' },
  };
  SB.room = (location.pathname.split('/')[1] || '').toUpperCase();
  SB.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SB.coord = (i, n = 10) => SB.LET[i % n] + (Math.floor(i / n) + 1);
  SB.modes = {
    single: { name: '1 tir par tour', desc: 'Chaque joueur tire une seule fois, puis passe la main.' },
    chain: { name: 'Tirs consécutifs', desc: 'Touché ? On rejoue ! Le tour ne s\'arrête qu\'au premier tir raté.' },
    salvo: { name: 'Salve à l\'aveugle', desc: '3 à 5 tirs choisis d\'un coup. Les résultats ne sont révélés qu\'une fois la salve lancée.' },
  };
  SB.levels = { debutant: 'Débutant', avance: 'Avancé', expert: 'Expert' };
  SB.modeLabel = (mode, salvo) => mode === 'salvo' ? `Salve de ${salvo} tirs` : SB.modes[mode].name;

  // ---------- notifications
  SB.toast = function (text, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || ''); t.textContent = text;
    box.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };

  // ---------- réseau
  SB.roomInfo = async function (code = SB.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };
  SB.api = async function (who, type, data) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: SB.room, who, type, ...data }) });
      const j = await r.json();
      if (!j.ok) SB.toast(j.error || 'Erreur', 'bad');
      return j;
    } catch { SB.toast('Serveur injoignable', 'bad'); return { ok: false }; }
  };
  // flux temps réel ; onNoRoom est rappelé tant que le salon n'existe pas (serveur redémarré, salon expiré)
  SB.connect = function (who, onState, onNoRoom) {
    let es = null, timer = null;
    function open() {
      clearTimeout(timer);
      es = new EventSource(`/events?room=${encodeURIComponent(SB.room)}&who=${who}`);
      es.onmessage = e => {
        document.body.classList.remove('offline');
        try { onState(JSON.parse(e.data)); } catch (err) { console.error(err); }
      };
      es.onerror = () => {
        document.body.classList.add('offline');
        if (es.readyState === EventSource.CLOSED) { es.close(); poll(); }
      };
    }
    async function poll() {
      const info = await SB.roomInfo();
      if (info && info.exists) return open();
      if (info && !info.exists && onNoRoom) await onNoRoom();
      timer = setTimeout(poll, 2000);
    }
    open();
  };

  // ---------- salons récents (par appareil)
  SB.recent = {
    list() { try { return JSON.parse(localStorage.getItem('sb-recent') || '[]'); } catch { return []; } },
    save(l) { try { localStorage.setItem('sb-recent', JSON.stringify(l.slice(0, 8))); } catch { } },
    add(code, role) { this.save([{ code, role }, ...this.list().filter(x => x.code !== code)]); },
    remove(code) { this.save(this.list().filter(x => x.code !== code)); },
  };

  // ---------- rendu d'un plateau
  // o : { n (côté), cls, id, shots[n*n], ships[] (affichés, avec .color), fresh:Set, pop, order:Map, targets:Map(idx→n), live, place,
  //       halo:Set, revealFoe, blocked:Set (cases non visables), owners:{idx:[sièges touchés]} (carte du Battle Royale) }
  SB.board = function (o) {
    const N = o.n || 10, ships = o.ships || [], owner = {};
    ships.forEach((s, k) => s.cells.forEach(i => { owner[i] = k; }));
    let h = `<div class="board ${o.cls || ''}${o.live ? ' live' : ''}" style="--n:${N}"${o.id ? ` id="${o.id}"` : ''}><span class="lab"></span>`;
    for (let c = 0; c < N; c++) h += `<span class="lab">${SB.LET[c]}</span>`;
    for (let r = 0; r < N; r++) {
      h += `<span class="lab">${r + 1}</span>`;
      for (let c = 0; c < N; c++) {
        const i = r * N + c, k = owner[i], sh = o.shots ? o.shots[i] : 0;
        const cl = ['cell'], style = [];
        if (k !== undefined) {
          const s = ships[k], same = (rr, cc) => rr >= 0 && rr < N && cc >= 0 && cc < N && owner[rr * N + cc] === k;
          const u = same(r - 1, c), d = same(r + 1, c), l = same(r, c - 1), rt = same(r, c + 1);
          cl.push('ship');
          if (u) cl.push('j-u'); if (d) cl.push('j-d'); if (l) cl.push('j-l'); if (rt) cl.push('j-r');
          if (rt && d && same(r + 1, c + 1)) cl.push('j-rd');
          if (s.sunk) cl.push('sunk'); else if (o.revealFoe) cl.push('unsunk');
          style.push(`--ship:${s.color || '#8aa2dd'}`);
        } else if (o.halo && o.halo.has(i)) cl.push('halo');
        const blocked = o.blocked && o.blocked.has(i);
        if (blocked) cl.push('blocked');
        if (sh === 1) cl.push('miss'); if (sh === 2) cl.push('hit');
        const fresh = o.fresh && o.fresh.has(i);
        if (fresh) cl.push('fresh'); if (fresh && o.pop) cl.push('pop');
        let inner = '';
        if (sh === 2) inner = '<i class="fx"></i>'; else if (sh === 1) inner = '<i class="dot2"></i>';
        const ow = o.owners && o.owners[i];
        if (ow && sh === 2) inner += '<em class="own">' + ow.map(p => `<u style="background:${SB.PCOL[p]}"></u>`).join('') + '</em>';
        const n = o.targets && o.targets.get(i);
        if (n) { cl.push('target'); if (o.targets.size > 1) inner += `<b>${n}</b>`; }
        const ord = o.order && o.order.get(i);
        if (ord != null) style.push(`--d:${ord * 0.18}s`);
        const tag = (o.live && !blocked) || o.place ? 'button' : 'div';
        h += `<${tag} class="${cl.join(' ')}" data-i="${i}" aria-label="${SB.coord(i, N)}"${style.length ? ` style="${style.join(';')}"` : ''}${tag === 'button' ? ' type="button"' : ''}>${inner}</${tag}>`;
      }
    }
    return h + '</div>';
  };
  // miniature d'une forme (cartes de choix, liste de placement)
  SB.mini = function (cells, color, u) {
    const hh = Math.max(...cells.map(c => c[0])) + 1, ww = Math.max(...cells.map(c => c[1])) + 1;
    return `<span class="mini" style="--u:${u || 12}px;grid-template-columns:repeat(${ww},var(--u));grid-template-rows:repeat(${hh},var(--u))">` +
      cells.map(([r, c]) => `<i style="grid-area:${r + 1}/${c + 1};background:${color}"></i>`).join('') + '</span>';
  };
  SB.pips = function (ships) {   // pastilles : un vaisseau = une capsule de points, à la couleur du vaisseau
    return '<div class="fleet">' + ships.map(s => `<span class="pip${s.sunk ? ' dead' : ''}" title="${SB.esc(s.name)}${s.sunk ? ' (détruit)' : ''}">${Array.from({ length: s.size }, () => `<i style="background:${s.sunk ? 'var(--hit)' : s.color}"></i>`).join('')}</span>`).join('') + '</div>';
  };
  // résumé d'une volée : names = noms des joueurs ; multi = plusieurs propriétaires possibles (on précise de qui est le vaisseau)
  SB.volleyChips = function (last, names, multi) {
    if (!last) return '';
    const n = last.n || 10;
    return '<div class="chips">' + last.shots.map(v => {
      const sunk = v.sunk && v.sunk.length;
      const txt = sunk ? '· ' + v.sunk.map(x => SB.esc(x.name) + (multi ? ' de ' + SB.esc(names[x.owner]) : '')).join(', ') + ' coulé'
        : v.hit ? '· touché' + (multi && v.owners && v.owners.length ? ' (' + v.owners.map(o => SB.esc(names[o])).join(', ') + ')' : '') : '· raté';
      return `<span class="chip ${sunk ? 'sunk' : v.hit ? 'hit' : 'miss'}">${SB.coord(v.i, n)} ${txt}</span>`;
    }).join('') + '</div>';
  };
  // pastille colorée d'un siège
  SB.who = (names, i, ai) => `<b class="pn" style="color:${SB.PCOL[i]}">${ai && ai[i] ? '🤖 ' : ''}${SB.esc(names[i])}</b>`;
})();
