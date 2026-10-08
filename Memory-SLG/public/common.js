// Memory-SLG — code partagé entre l'accueil, la page arbitre et les pages joueurs
(function () {
  const SLG = (window.SLG = {});
  let who = null, lastFlash = null, firstState = true;

  SLG.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SLG.fmt = ms => {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  // ---------- code du salon = premier segment de l'adresse (/K7QF ou /K7QF/joueur2)
  SLG.room = (location.pathname.split('/')[1] || '').toUpperCase();
  {
    const seg = location.pathname.split('/')[1] || '';
    if (seg && seg !== SLG.room && /^[a-z0-9]{3,10}$/i.test(seg) && seg !== 'static')
      history.replaceState(null, '', location.pathname.replace('/' + seg, '/' + SLG.room) + location.search);
  }
  SLG.roomUrl = (suffix = '') => `${location.origin}/${SLG.room}${suffix}`;
  SLG.imgUrl = id => `/api/rooms/${encodeURIComponent(SLG.room)}/img/${id}`;

  // ---------- connexion temps réel (Server-Sent Events)
  SLG.connect = function (w, onState, onNoRoom) {
    who = w;
    if (!document.getElementById('toasts'))
      document.body.insertAdjacentHTML('beforeend', '<div class="offline-bar">Connexion au serveur perdue — reconnexion…</div><div id="toasts" aria-live="polite"></div>');
    let es = null, retry = null;
    const open = () => {
      es = new EventSource(`/events?room=${encodeURIComponent(SLG.room)}&who=${encodeURIComponent(w)}`);
      es.onopen = () => document.body.classList.remove('offline');
      es.onerror = () => {
        document.body.classList.add('offline');
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          SLG.roomInfo().then(info => {
            if (info && !info.exists) { document.body.classList.remove('offline'); onNoRoom && onNoRoom(); }
            retry = setTimeout(open, 4000);
          });
        }
      };
      es.onmessage = e => {
        const s = JSON.parse(e.data);
        SLG.state = s; SLG.recvAt = performance.now();
        if (s.flash && s.flash.id !== lastFlash) { if (!firstState) SLG.toast(s.flash.text, s.flash.kind); lastFlash = s.flash.id; }
        SLG.preload(s);
        SLG.keepInputs(() => onState(s));
        firstState = false;
      };
    };
    SLG.reconnect = () => { if (es) es.close(); clearTimeout(retry); open(); };
    open();
  };
  SLG.roomInfo = async function (code = SLG.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };
  SLG.act = async function (type, data = {}) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: SLG.room, who, type, ...data }) });
      const j = await r.json();
      if (!j.ok) SLG.toast(j.error, 'bad');
      if (j.noroom && SLG.reconnect) SLG.reconnect();
      return j;
    } catch { SLG.toast('Serveur injoignable', 'bad'); return { ok: false }; }
  };
  SLG.toast = function (text, kind = 'info') {
    const box = document.getElementById('toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  // ---------- salons récents de cet appareil
  SLG.recent = {
    list() { try { return JSON.parse(localStorage.getItem('slg-salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = SLG.recent.list().filter(x => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('slg-salons', JSON.stringify(l.slice(0, 8)));
      } catch { }
    },
    remove(code) { try { localStorage.setItem('slg-salons', JSON.stringify(SLG.recent.list().filter(x => x.code !== code))); } catch { } },
  };

  // ---------- conserve la saisie en cours quand la page est redessinée
  const drafts = {};
  document.addEventListener('input', e => { if (e.target.id) drafts[e.target.id] = e.target.value; });
  SLG.draft = (id, v) => (v === undefined ? drafts[id] : (drafts[id] = v));
  SLG.clearDraft = id => { delete drafts[id]; };
  // Met la page à jour sans la reconstruire : un champ de saisie en cours n'est jamais recréé
  // (pas de perte de focus, de clavier mobile ou de lettre en cours de frappe).
  function syncAttrs(o, n) {
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  }
  function morph(o, n) {
    if (o.hasAttribute('data-keep') && n.hasAttribute('data-keep')) return;   // contenu géré à part (plateau, QR code…)
    const focused = o === document.activeElement;
    if (o.tagName === 'INPUT') {
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
      if (n.nodeType === 1 && n.id && byId.has(n.id) && byId.get(n.id) !== o) {
        const kept = byId.get(n.id);
        if (kept.contains(document.activeElement)) {
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
  SLG.setHTML = function (el, html) {
    const tpl = document.createElement(el.tagName);
    tpl.innerHTML = html;
    morphChildren(el, tpl);
  };
  SLG.keepInputs = function (render) {
    const a = document.activeElement, id = a && a.id;
    const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    render();
    for (const [k, v] of Object.entries(drafts)) {
      const el = document.getElementById(k);
      if (!el || el.tagName !== 'INPUT' || el.type !== 'text') continue;
      if ('server' in el.dataset && k !== id) { delete drafts[k]; continue; }
      if (el.value !== v) el.value = v;
    }
    if (id) {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement) { el.focus(); if (sel) try { el.setSelectionRange(...sel); } catch { } }
    }
  };

  // ---------- images : préchargées chez chaque client pour que les cartes se retournent instantanément
  const preloaded = new Set();
  SLG.preload = function (s) {
    for (const im of s.images || []) if (!preloaded.has(im.id)) { preloaded.add(im.id); new Image().src = SLG.imgUrl(im.id); }
  };

  // ---------- chronomètre : le serveur donne le temps écoulé, l'écran le fait avancer tout seul
  SLG.elapsed = s => s.timer.elapsed + (s.timer.running ? performance.now() - SLG.recvAt : 0);
  setInterval(() => {
    const s = SLG.state;
    if (!s || !s.timer) return;
    const t = SLG.fmt(SLG.elapsed(s));
    document.querySelectorAll('.timer-val').forEach(e => { if (e.textContent !== t) e.textContent = t; });
  }, 250);

  // ---------- bandeau : chronomètre + joueurs
  SLG.hud = function (s, { showOnline = false } = {}) {
    let h = `<div class="timer-pill${s.paused ? ' paused' : ''}">${s.paused ? '⏸ ' : ''}<span class="timer-val">${SLG.fmt(SLG.elapsed(s))}</span></div>`;
    h += `<div class="players-hud"><div class="player-chip">🧩 ${s.matches} / ${s.pairs} paires</div>`;
    if (s.nbActive > 1) {
      for (let i = 0; i < s.nbActive; i++) {
        const p = s.seats[i], turn = s.phase === 'playing' && s.current === i, won = s.phase === 'over' && s.winners.includes(i);
        h += `<div class="player-chip${turn || won ? ' turn' : ''}" style="--c:${p.color}"><span class="dot"></span>${SLG.esc(p.label)}`;
        h += ` <span class="score">${s.scores[i]}</span>${won ? ' 🏆' : ''}`;
        if (showOnline) h += `<span class="on-dot${p.online ? ' on' : ''}" title="${p.online ? 'Écran connecté' : 'Écran non connecté'}"></span>`;
        h += '</div>';
      }
    }
    return h + '</div>';
  };

  // ---------- fenêtre de fin de partie
  SLG.endOverlay = function (s, isMaster) {
    if (s.phase !== 'over') return '<div class="overlay" id="endOverlay"></div>';
    const order = [...Array(s.nbActive).keys()].sort((a, b) => s.scores[b] - s.scores[a]);
    let title;
    if (s.nbActive === 1) title = 'Bravo, partie terminée ! 🎉';
    else if (s.winners.length === 1) title = `${SLG.esc(s.seats[s.winners[0]].label)} gagne 🎉`;
    else title = 'Égalité !';
    const medal = i => ['🥇', '🥈', '🥉'][i] || '🏅';
    let h = `<div class="overlay show" id="endOverlay"><div class="end-card"><h2>${title}</h2><div class="final-time">Temps : ${SLG.fmt(s.timer.elapsed)}</div>`;
    h += '<ul class="end-ranking">' + order.map((i, k) => {
      const p = s.seats[i];
      return `<li class="${s.nbActive > 1 && s.winners.includes(i) ? 'winner' : ''}"><span>${s.nbActive > 1 ? medal(k) : '⏱️'}
        <span class="swatch" style="background:${p.color};display:inline-block;width:10px;height:10px;margin-right:6px;"></span>${SLG.esc(p.label)}</span><span>${s.scores[i]} paire${s.scores[i] > 1 ? 's' : ''}</span></li>`;
    }).join('') + '</ul>';
    h += isMaster
      ? '<div class="row"><button class="btn primary" data-a="rematch">Rejouer</button><button class="btn" data-a="reset">Configuration</button></div>'
      : '<p class="muted" style="color:rgba(16,18,38,.66)">En attente de l\'arbitre pour la suite…</p>';
    return h + '</div></div>';
  };

  // ---------- plateau : cartes créées une fois par partie, puis simplement mises à jour
  SLG.renderBoard = function (el, s, opt = {}) {
    const n = s.cards.length;
    let st = el._slg;
    if (!st || st.gameId !== s.gameId || st.n !== n) {
      el.innerHTML = '<div class="board-wrap"><div class="board"></div><div class="pause-overlay"><div>⏸ Partie en pause</div></div></div>';
      const board = el.querySelector('.board'), cards = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElement('div');
        c.className = 'card'; c.dataset.i = i;
        c.innerHTML = '<div class="card-face card-back"></div><div class="card-face card-front"><img alt="" draggable="false"></div>';
        board.appendChild(c); cards.push(c);
      }
      board.addEventListener('click', e => {
        const c = e.target.closest('.card');
        const o = el._slg && el._slg.opt;
        if (c && o && o.canClick && o.onCard) o.onCard(+c.dataset.i);
      });
      st = el._slg = { gameId: s.gameId, n, board, cards, imgs: Array(n).fill(null), opt };
    }
    st.opt = opt;
    s.cards.forEach((c, i) => {
      const d = st.cards[i], flipped = c.st === 1, matched = c.st === 2;
      d.classList.toggle('flipped', flipped);
      d.classList.toggle('matched', matched);
      d.classList.toggle('miss', flipped && s.lock === 'miss');
      if (c.img && st.imgs[i] !== c.img) { d.querySelector('img').src = SLG.imgUrl(c.img); st.imgs[i] = c.img; }
      if (matched) d.style.setProperty('--match', (s.seats[c.owner] || {}).color || '#22c55e'); else d.style.removeProperty('--match');
    });
    st.board.classList.toggle('can-click', !!opt.canClick);
    el.querySelector('.pause-overlay').classList.toggle('show', !!s.paused);
    SLG.fitBoard(el);
  };

  // Taille des cases : on cherche la grille (colonnes × lignes) qui donne les plus grosses cartes
  // dans la largeur ET la hauteur réellement visibles à l'écran.
  SLG.fitBoard = function (el) {
    const st = el._slg;
    if (!st) return;
    const n = st.n;
    const availW = Math.max(200, el.clientWidth);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(220, window.innerHeight - top - 20);
    const g = 8, MIN_TOUCH = 44;
    const sizeW = cols => (availW - g * (cols - 1)) / cols;
    const sizeBoth = cols => Math.min(sizeW(cols), (availH - g * (Math.ceil(n / cols) - 1)) / Math.ceil(n / cols));
    // choisit la grille qui maximise score(cols) ; on préfère une grille complète (pas de ligne à moitié vide)
    // si elle ne coûte presque rien
    const choose = score => {
      let best = { cols: n, v: -Infinity }, exact = null;
      for (let cols = 1; cols <= n; cols++) {
        const v = score(cols);
        if (v > best.v) best = { cols, v };
        if (n % cols === 0 && (!exact || v > exact.v)) exact = { cols, v };
      }
      return exact && exact.v >= best.v * 0.88 ? exact : best;
    };
    let pick = choose(sizeBoth);
    let cell = pick.v;
    if (cell < MIN_TOUCH) {
      // écran étroit et beaucoup de cartes : des cases trop petites pour être touchées.
      // On garde des cases d'au moins 44 px et on laisse la page défiler vers le bas.
      const ok = c => sizeW(c) >= MIN_TOUCH;
      const hgt = c => Math.ceil(n / c) * sizeW(c);
      let bestC = null, exactC = null;
      for (let c = 1; c <= n; c++) {
        if (!ok(c)) continue;
        if (!bestC || hgt(c) < hgt(bestC)) bestC = c;
        if (n % c === 0 && (!exactC || hgt(c) < hgt(exactC))) exactC = c;
      }
      if (bestC) {
        pick = { cols: exactC && hgt(exactC) <= hgt(bestC) * 1.12 ? exactC : bestC };
        cell = sizeW(pick.cols);
      }
    }
    cell = Math.floor(Math.max(30, Math.min(170, cell)));
    const gap = cell >= 90 ? 10 : cell >= 70 ? 8 : cell >= 50 ? 6 : 4;
    const border = cell >= 90 ? 4 : cell >= 70 ? 3 : cell >= 50 ? 2 : 1;
    const b = st.board;
    b.style.setProperty('--cell', cell + 'px');
    b.style.setProperty('--card-border', border + 'px');
    b.style.gap = gap + 'px';
    b.style.gridTemplateColumns = `repeat(${pick.cols}, ${cell}px)`;
  };
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => SLG.redraw && SLG.redraw(), 150); });

  // ---------- code QR (bibliothèque chargée à la demande)
  let qrLib = null;
  SLG.drawQR = function () {
    const box = document.getElementById('qr');
    if (!box || box.dataset.done === box.dataset.url) return;
    if (!qrLib) qrLib = new Promise(ok => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      sc.onload = () => ok(true); sc.onerror = () => ok(false);
      document.head.appendChild(sc);
    });
    qrLib.then(ok => {
      const b = document.getElementById('qr');
      if (!b) return;
      if (!ok || !window.QRCode) { b.style.display = 'none'; return; }
      if (b.dataset.done === b.dataset.url) return;
      b.innerHTML = ''; b.dataset.done = b.dataset.url;
      new QRCode(b, { text: b.dataset.url, width: 112, height: 112, colorDark: '#0d0f1a', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    });
  };
  SLG.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); SLG.toast('Lien copié : ' + text, 'ok'); }
    catch { prompt('Copie ce lien :', text); }
  };
})();
