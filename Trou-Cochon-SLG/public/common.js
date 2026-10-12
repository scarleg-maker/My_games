// Trou-cochon-SLG — code partagé (connexion temps réel, mise à jour douce de la page, salons récents)
(function () {
  const P = (window.P = {});
  let who = null, lastFlash = null, firstState = true;

  P.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P.hex = (s, id) => (s.colors.find(c => c.id === id) || {}).hex || '#888';
  P.colName = (s, id) => (s.colors.find(c => c.id === id) || {}).nom || '';
  P.pname = (s, i) => s.seats[i]?.name || `Joueur ${i + 1}`;
  P.ink = hex => { // couleur de texte lisible sur un fond donné
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1b1b1b' : '#ffffff';
  };
  P.shade = (hex, f) => { // f<0 assombrit, f>0 éclaircit
    const n = parseInt(hex.slice(1), 16), c = k => Math.max(0, Math.min(255, Math.round(((n >> k) & 255) + (f < 0 ? ((n >> k) & 255) * f : (255 - ((n >> k) & 255)) * f))));
    return '#' + [16, 8, 0].map(k => c(k).toString(16).padStart(2, '0')).join('');
  };

  // code du salon = premier segment de l'adresse (/K7QF/maitre ou /K7QF/joueur2)
  P.room = (location.pathname.split('/')[1] || '').toUpperCase();
  P.roomUrl = (suffix = '') => `${location.origin}/${P.room}${suffix}`;

  P.connect = function (w, onState, onNoRoom) {
    who = w;
    if (!document.getElementById('toasts'))
      document.body.insertAdjacentHTML('beforeend', '<div class="offline-bar">Connexion au serveur perdue — reconnexion…</div><div id="toasts" aria-live="polite"></div>');
    let es = null, retry = null;
    const open = () => {
      es = new EventSource(`/events?room=${encodeURIComponent(P.room)}&who=${encodeURIComponent(w)}`);
      es.onopen = () => document.body.classList.remove('offline');
      es.onerror = () => {
        document.body.classList.add('offline');
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          P.roomInfo().then(info => {
            if (info && !info.exists) { document.body.classList.remove('offline'); onNoRoom && onNoRoom(); }
            retry = setTimeout(open, 4000);
          });
        }
      };
      es.onmessage = e => {
        const s = JSON.parse(e.data);
        P.state = s;
        if (s.flash && s.flash.id !== lastFlash) { if (!firstState) P.toast(s.flash.text, s.flash.kind); lastFlash = s.flash.id; }
        P.keepInputs(() => onState(s));
        firstState = false;
      };
    };
    P.reconnect = () => { if (es) es.close(); clearTimeout(retry); open(); };
    open();
  };
  P.roomInfo = async function (code = P.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); } catch { return null; }
  };
  P.act = async function (type, data = {}) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: P.room, who, type, ...data }) });
      const j = await r.json();
      if (!j.ok) P.toast(j.error, 'bad');
      if (j.noroom && P.reconnect) P.reconnect();
      return j;
    } catch { P.toast('Serveur injoignable', 'bad'); return { ok: false }; }
  };

  // mémoire locale de l'appareil (salons récents, dernier nom/couleur)
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  };
  P.store = store;
  P.recent = {
    list() { return store.get('tc-salons', []); },
    add(code, role) { store.set('tc-salons', [{ code, role, t: Date.now() }, ...P.recent.list().filter(x => !(x.code === code && x.role === role))].slice(0, 8)); },
    remove(code) { store.set('tc-salons', P.recent.list().filter(x => x.code !== code)); },
  };
  P.toast = function (text, kind = 'info') {
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
  P.draft = (id, v) => (v === undefined ? drafts[id] : (drafts[id] = v));
  P.clearDraft = id => { delete drafts[id]; };
  function syncAttrs(o, n) {
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  }
  function morph(o, n) {
    if (o.hasAttribute('data-keep') && n.hasAttribute('data-keep')) { // contenu géré à part (dé, QR code…)
      for (const a of [...n.attributes]) if (a.name !== 'style' && a.name !== 'class' && o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
      return;
    }
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
  const sameKind = (o, n) => o.nodeType === n.nodeType && (o.nodeType !== 1 || (o.tagName === n.tagName && (o.id || '') === (n.id || '')));
  function morphChildren(from, to) {
    const olds = [...from.childNodes], news = [...to.childNodes];
    const byId = new Map();
    for (const o of olds) if (o.nodeType === 1 && o.id) byId.set(o.id, o);
    let i = 0;
    for (const n of news) {
      let o = from.childNodes[i];
      if (n.nodeType === 1 && n.id && byId.has(n.id) && byId.get(n.id) !== o) {
        const kept = byId.get(n.id);
        if (kept.contains(document.activeElement)) { while (from.childNodes[i] && from.childNodes[i] !== kept) from.removeChild(from.childNodes[i]); }
        else from.insertBefore(kept, o || null);
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
  P.setHTML = function (el, html) {
    const tpl = document.createElement(el.tagName);
    tpl.innerHTML = html;
    morphChildren(el, tpl);
  };
  P.keepInputs = function (render) {
    const a = document.activeElement, id = a && a.id;
    const sel = id && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
    render();
    for (const [k, v] of Object.entries(drafts)) {
      const el = document.getElementById(k);
      if (!el || el.tagName !== 'INPUT' || el.type !== 'text') continue;
      if (el.value !== v) el.value = v;
    }
    if (id) {
      const el = document.getElementById(id);
      if (el && el !== document.activeElement) { el.focus(); if (sel) try { el.setSelectionRange(...sel); } catch { } }
    }
  };
})();
