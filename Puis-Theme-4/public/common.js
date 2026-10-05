// Puis-thème 4 — code partagé entre la page maître et les pages joueurs
(function () {
  const P4 = (window.P4 = {});
  let who = null, lastFlash = null, firstState = true;
  const animSeen = {}, moveSeen = {};

  P4.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P4.hex = (s, id) => (s.colors.find(c => c.id === id) || {}).hex || '#888';
  P4.colName = c => 'ABCDEFG'[c];
  P4.cellLabel = (s, r, c) => 'ABCDEFG'[c] + (s.rows - r);
  P4.chip = (s, seat) => `<span class="chip" style="--c:${P4.hex(s, s.seats[seat]?.color)}"></span>`;
  P4.pname = (s, i) => s.seats[i]?.name || `Joueur ${i + 1}`;

  // ---------- connexion temps réel (Server-Sent Events)
  // code du salon = premier segment de l'adresse (/K7QF ou /K7QF/joueur2)
  P4.room = (location.pathname.split('/')[1] || '').toUpperCase();
  { // adresse en minuscules (/famille) → on affiche la forme officielle (/FAMILLE)
    const seg = location.pathname.split('/')[1] || '';
    if (seg && seg !== P4.room && /^[a-z0-9]{3,10}$/i.test(seg) && seg !== 'static')
      history.replaceState(null, '', location.pathname.replace('/' + seg, '/' + P4.room) + location.search);
  }
  P4.roomUrl = (suffix = '') => `${location.origin}/${P4.room}${suffix}`;

  // ---------- connexion temps réel (Server-Sent Events)
  // onNoRoom : appelé si le salon n'existe pas (ou plus : serveur redémarré, salon expiré)
  P4.connect = function (w, onState, onNoRoom) {
    who = w;
    if (!document.getElementById('toasts'))
      document.body.insertAdjacentHTML('beforeend', '<div class="offline-bar">Connexion au serveur perdue — reconnexion…</div><div id="toasts" aria-live="polite"></div>');
    let es = null, retry = null;
    const open = () => {
      es = new EventSource(`/events?room=${encodeURIComponent(P4.room)}&who=${encodeURIComponent(w)}`);
      es.onopen = () => document.body.classList.remove('offline');
      es.onerror = () => {
        document.body.classList.add('offline');
        // connexion refusée : on vérifie si le salon existe encore, puis on réessaie
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          P4.roomInfo().then(info => {
            if (info && !info.exists) { document.body.classList.remove('offline'); onNoRoom && onNoRoom(); }
            retry = setTimeout(open, 4000);
          });
        }
      };
      es.onmessage = e => {
        const s = JSON.parse(e.data);
        P4.state = s;
        if (s.flash && s.flash.id !== lastFlash) { if (!firstState) P4.toast(s.flash.text, s.flash.kind); lastFlash = s.flash.id; }
        P4.keepInputs(() => onState(s));
        firstState = false;
      };
    };
    P4.reconnect = () => { if (es) es.close(); clearTimeout(retry); open(); };
    open();
  };
  P4.roomInfo = async function (code = P4.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };
  P4.act = async function (type, data = {}) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: P4.room, who, type, ...data }) });
      const j = await r.json();
      if (!j.ok) P4.toast(j.error, 'bad');
      if (j.noroom && P4.reconnect) P4.reconnect();
      return j;
    } catch { P4.toast('Serveur injoignable', 'bad'); return { ok: false }; }
  };
  // salons récents de cet appareil (page d'accueil)
  P4.recent = {
    list() { try { return JSON.parse(localStorage.getItem('p4-salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = P4.recent.list().filter(x => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('p4-salons', JSON.stringify(l.slice(0, 8)));
      } catch { }
    },
    remove(code) { try { localStorage.setItem('p4-salons', JSON.stringify(P4.recent.list().filter(x => x.code !== code))); } catch { } },
  };
  P4.toast = function (text, kind = 'info') {
    const box = document.getElementById('toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  // ---------- conserve la saisie en cours quand la page est redessinée
  const drafts = {};
  document.addEventListener('input', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  P4.draft = (id, v) => (v === undefined ? drafts[id] : (drafts[id] = v));
  P4.clearDraft = id => { delete drafts[id]; };
  // ---------- mise à jour de la page sans la reconstruire
  // Compare le nouveau HTML avec la page affichée et ne modifie que ce qui a changé :
  // un champ de saisie en cours d'utilisation n'est jamais recréé (pas de perte de focus,
  // de clavier mobile ou de lettre en cours de frappe).
  function syncAttrs(o, n) {
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  }
  function morph(o, n) {
    if (o.hasAttribute('data-keep') && n.hasAttribute('data-keep')) return;   // contenu géré à part (QR code…)
    const focused = o === document.activeElement;
    if (o.tagName === 'INPUT') {
      // on ne touche pas aux attributs d'un champ en cours de saisie
      if (!focused) {
        syncAttrs(o, n);
        if (o.type === 'checkbox' || o.type === 'radio') o.checked = n.hasAttribute('checked');
        else if (o.value !== (n.getAttribute('value') ?? '')) o.value = n.getAttribute('value') ?? '';
      }
      return;
    }
    syncAttrs(o, n);
    morphChildren(o, n);
  }
  function sameKind(o, n) {
    return o.nodeType === n.nodeType && (o.nodeType !== 1 || (o.tagName === n.tagName && (o.id || '') === (n.id || '')));
  }
  function morphChildren(from, to) {
    const olds = [...from.childNodes], news = [...to.childNodes];
    const byId = new Map();
    for (const o of olds) if (o.nodeType === 1 && o.id) byId.set(o.id, o);
    let i = 0;
    for (const n of news) {
      let o = from.childNodes[i];
      // un élément avec un identifiant garde son nœud, même s'il a changé de place
      if (n.nodeType === 1 && n.id && byId.has(n.id) && byId.get(n.id) !== o) {
        const kept = byId.get(n.id);
        if (kept.contains(document.activeElement)) {
          // on déplace plutôt les autres nœuds pour ne pas faire perdre le focus
          while (from.childNodes[i] && from.childNodes[i] !== kept) from.removeChild(from.childNodes[i]);
        } else from.insertBefore(kept, o || null);
        o = kept;
      }
      if (!o) from.appendChild(n);
      else if (!sameKind(o, n)) from.replaceChild(n, o);
      else if (o.nodeType === 3 || o.nodeType === 8) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; }
      else morph(o, n);
      i++;
    }
    while (from.childNodes.length > i) from.removeChild(from.lastChild);
  }
  P4.setHTML = function (el, html) {
    const tpl = document.createElement(el.tagName);
    tpl.innerHTML = html;
    morphChildren(el, tpl);
  };
  P4.setOptions = function (list, names) {   // liste de suggestions, mise à jour seulement si elle change
    const html = names.map(n => `<option value="${P4.esc(n)}">`).join('');
    if (list && list.dataset.h !== html) { list.innerHTML = html; list.dataset.h = html; }
  };

  P4.keepInputs = function (render) {
    const a = document.activeElement, id = a && a.id;
    const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    render();
    for (const [k, v] of Object.entries(drafts)) {
      const el = document.getElementById(k);
      if (!el || el.tagName !== 'INPUT' || el.type !== 'text') continue;
      // champ lié au serveur (data-server) : hors saisie en cours, on affiche la valeur enregistrée
      if ('server' in el.dataset && k !== id) { delete drafts[k]; continue; }
      if (el.value !== v) el.value = v;
    }
    if (id) {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement) { el.focus(); if (sel) try { el.setSelectionRange(...sel); } catch { } }
    }
  };

  // ---------- plateau
  // opt : { canAct, showCounts, onDrop(col), onFlip(col) }
  P4.renderBoard = function (el, s, opt = {}) {
    const R = s.rows, C = s.cols, them = s.mode === 'thematique' && s.grid;
    const playing = s.phase === 'playing';
    const canAct = !!opt.canAct && playing;
    const curColor = playing ? P4.hex(s, s.seats[s.current]?.color) : '#888';
    const flippable = new Set(s.flippable || []);
    const winSet = new Set((s.winCells || []).map(([r, c]) => r + ',' + c));
    const dropping = canAct && (s.turnPhase === 'drop' || (s.turnPhase === 'answer' && s.pending && !s.pending.answer && !s.pending.steal));
    const flipping = canAct && s.turnPhase === 'flip';
    const now = performance.now();

    let anim = null, animT = 0;
    if (s.anim) {
      if (!(s.anim.id in animSeen)) animSeen[s.anim.id] = now - s.anim.elapsed;
      animT = now - animSeen[s.anim.id];
      if (animT < (s.anim.dur || 2000)) anim = s.anim;
    }
    let move = null, moveT = 0;
    if (s.lastMove) {
      if (!(s.lastMove.id in moveSeen)) moveSeen[s.lastMove.id] = firstState ? -1e9 : now;
      moveT = now - moveSeen[s.lastMove.id];
      if (moveT < 550) move = s.lastMove;
    }
    const land = c => { for (let r = R - 1; r >= 0; r--) if (s.board[r][c] === null) return r; return -1; };
    const token = (v, cls = '', style = '') => `<div class="token ${cls}" style="--c:${P4.hex(s, s.seats[v]?.color)};${style}"></div>`;

    let cols = '';
    for (let c = 0; c < C; c++) {
      const L = land(c);
      let cls = 'col';
      if (dropping && L >= 0) cls += ' droppable';
      if (flipping && flippable.has(c)) cls += ' flippable';
      if (anim && anim.col === c) cls += ' flipping';
      let cells = '';
      for (let r = 0; r < R; r++) {
        const v = s.board[r][c];
        const isPending = s.pending && s.pending.row === r && s.pending.col === c;
        let inner = '';
        if (v !== null) {
          let tc = winSet.has(r + ',' + c) ? 'win' : '', st = '';
          if (anim && anim.col === c) {
            tc += anim.random ? (anim.flipped ? ' after-flip r3' : ' after-spin') : ' after-flip';
            st = `--fall:${R - anim.k};animation-delay:${-animT}ms`;
          }
          else if (move && move.row === r && move.col === c) { tc += ' drop'; st = `--fall:${r + 1};animation-delay:${-moveT}ms`; }
          inner = token(v, tc, st);
        } else {
          const free = them && s.freeEmpty && s.grid.empty && s.grid.empty[r][c];
          if (free) inner += '<span class="free" title="Case libre : aucune réponse possible, le pion se pose sans question">✦</span>';
          else if (opt.showCounts && them && s.grid.counts) {
            const n = s.grid.counts[r][c];
            inner += `<span class="count${n ? '' : ' zero'}">${n}</span>`;
          }
          if ((r === L && dropping) || isPending) inner += `<div class="token ghost" style="--c:${curColor}"></div>`;
        }
        cells += `<div class="cell${isPending ? ' pending' : ''}">${inner}</div>`;
      }
      if (anim && anim.col === c) {
        let layer = '';
        for (let r = 0; r < R; r++) {
          const v = anim.before[r];
          layer += `<div class="cell">${v !== null ? token(v) : ''}</div>`;
        }
        const lc = anim.random ? (anim.flipped ? ' r3' : ' r3 nof') : '';
        cells += `<div class="flip-layer${lc}" style="animation-delay:${-animT}ms">${layer}</div>`;
      }
      cols += `<div class="${cls}" data-col="${c}">${cells}</div>`;
    }
    const boardCls = ['board', dropping ? 'can-drop' : '', flipping ? 'can-flip' : '', s.phase === 'over' ? 'over' : ''].join(' ');
    let html = '<div class="bw">';
    if (them) {
      const pr = s.pending ? s.pending.row : -1, pc = s.pending ? s.pending.col : -1;
      const lg = t => (Math.max(...String(t).split(/\s+/).map(w => w.length)) > 8 ? ' long' : '');
      const em = t => { const m = (s.themeMeta || {})[t]; return m && m.emoji ? `<span class="em">${m.emoji}</span>` : ''; };
      html += `<div class="chead">${s.grid.cols.map((t, c) => `<div class="${c === pc ? 'hl' : ''}${lg(t)}">${em(t)}${P4.esc(t)}</div>`).join('')}</div>`;
      html += `<div class="rhead">${s.grid.rows.map((t, r) => `<div class="${r === pr ? 'hl' : ''}"><span>${em(t)}${P4.esc(t)}</span></div>`).join('')}</div>`;
    }
    html += `<div class="${boardCls}">${cols}</div></div>`;
    el.innerHTML = html;
    if (opt.fit) P4.fitBoard(el, s, opt.fit);
    el.onclick = e => {
      const col = e.target.closest('.col');
      if (!col) return;
      const c = +col.dataset.col;
      if (col.classList.contains('flippable') && opt.onFlip) opt.onFlip(c);
      else if (col.classList.contains('droppable') && opt.onDrop) opt.onDrop(c);
    };
    // redessine à la fin d'une animation pour retirer les classes transitoires
    clearTimeout(P4._animTimer);
    if (anim) P4._animTimer = setTimeout(() => P4.redraw && P4.redraw(), (anim.dur || 2000) + 50 - animT);
  };

  // ---------- taille du plateau adaptée à l'écran (téléphone, tablette, ordinateur)
  // Calcule la taille d'une case pour que le plateau tienne dans la largeur disponible
  // et, autant que possible, dans la hauteur de l'écran sous l'endroit où il commence.
  P4.fitBoard = function (el, s, f = {}) {
    const them = s.mode === 'thematique' && s.grid;
    const cs = getComputedStyle(el);   // le conteneur du plateau occupe toute la largeur disponible
    const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 6;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const vh = window.innerHeight;
    const availH = Math.max(vh - top - (f.bottom ?? 24), vh * (f.minH ?? 0.5));
    // largeur = 7 cases + 6 intervalles + 2 marges (+ étiquettes des lignes en Thématique)
    const wf = 8.12 + (them ? 1.75 : 0);
    // hauteur = 6 cases + 5 intervalles + 2 marges + ombre (+ en-têtes des colonnes, + symboles ⟲)
    const hf = 7.3 + (them ? 1.5 : 0) + (s.turnPhase === 'flip' ? 0.5 : 0);
    const c = Math.floor(Math.max(f.min ?? 26, Math.min(f.max ?? 96, availW / wf, availH / hf)));
    el.style.setProperty('--cell', c + 'px');
  };
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => P4.redraw && P4.redraw(), 120); });

  P4.playersList = function (s, { showOnline = false } = {}) {
    let h = '<ul class="players">';
    for (let i = 0; i < s.nbActive; i++) {
      const p = s.seats[i];
      const turn = s.phase === 'playing' && s.current === i;
      const won = s.phase === 'over' && s.winner === i;
      h += `<li class="${turn || won ? 'turn' : ''}">${P4.chip(s, i)}<span class="name">${P4.esc(P4.pname(s, i))}${p.ai ? ' <span title="Joueur IA">🤖</span>' : ''}</span>`;
      if (won) h += '<span>🏆</span>';
      else if (turn) h += '<span class="small">à son tour</span>';
      if (showOnline && !p.ai) h += `<span class="dot${p.online ? ' on' : ''}" title="${p.online ? 'Écran connecté' : 'Écran non connecté'}"></span>`;
      h += '</li>';
    }
    return h + '</ul>';
  };
  P4.usedList = function (s) {
    if (!s.used.length) return '<p class="muted small">Aucune réponse validée pour l\'instant.</p>';
    return '<ul class="used">' + [...s.used].reverse().map(u =>
      `<li>${P4.chip(s, u.player)}<span>${P4.esc(u.nom)}</span><span class="cell-tag">${P4.esc(u.rowTheme)} × ${P4.esc(u.colTheme)}</span></li>`).join('') + '</ul>';
  };
  P4.modeName = m => ({ classique: 'Classique', renverse: 'Renversé', thematique: 'Thématique' }[m] || m);
})();
