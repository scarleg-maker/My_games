// Yam's — code partagé entre l'accueil et les pages de salon
(function () {
  const Y = (window.Y = {});
  let who = null, lastFlash = null, firstState = true;

  Y.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // code du salon = premier segment de l'adresse (/K7QF ou /K7QF/joueur2)
  Y.room = (location.pathname.split('/')[1] || '').toUpperCase();
  Y.roomUrl = (suffix = '') => `${location.origin}/${Y.room}${suffix}`;

  Y.roomInfo = async function (code = Y.room) {
    try { return await (await fetch('/api/rooms/' + encodeURIComponent(code), { cache: 'no-store' })).json(); }
    catch { return null; }
  };

  // connexion temps réel (Server-Sent Events)
  Y.connect = function (w, onState, onNoRoom) {
    who = w;
    if (!document.getElementById('toasts'))
      document.body.insertAdjacentHTML('beforeend', '<div class="offline-bar">Connexion au serveur perdue — reconnexion…</div><div id="toasts" aria-live="polite"></div>');
    let es = null, retry = null;
    const open = () => {
      es = new EventSource(`/events?room=${encodeURIComponent(Y.room)}&who=${encodeURIComponent(w)}`);
      es.onopen = () => document.body.classList.remove('offline');
      es.onerror = () => {
        document.body.classList.add('offline');
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          Y.roomInfo().then(info => {
            if (info && !info.exists) { document.body.classList.remove('offline'); onNoRoom && onNoRoom(); }
            retry = setTimeout(open, 4000);
          });
        }
      };
      es.onmessage = e => {
        const s = JSON.parse(e.data);
        Y.state = s;
        if (s.flash && s.flash.id !== lastFlash) { if (!firstState) Y.toast(s.flash.text, s.flash.kind); lastFlash = s.flash.id; }
        onState(s);
        firstState = false;
      };
    };
    Y.reconnect = () => { if (es) es.close(); clearTimeout(retry); open(); };
    open();
  };

  Y.act = async function (type, data = {}) {
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: Y.room, who, type, ...data }) });
      const j = await r.json();
      if (!j.ok) Y.toast(j.error, 'bad');
      if (j.noroom && Y.reconnect) Y.reconnect();
      return j;
    } catch { Y.toast('Serveur injoignable', 'bad'); return { ok: false }; }
  };

  // salons récents de cet appareil
  Y.recent = {
    list() { try { return JSON.parse(localStorage.getItem('yams-salons') || '[]'); } catch { return []; } },
    add(code, role) {
      try {
        const l = Y.recent.list().filter(x => x.code !== code);
        l.unshift({ code, role, t: Date.now() });
        localStorage.setItem('yams-salons', JSON.stringify(l.slice(0, 8)));
      } catch { }
    },
    remove(code) { try { localStorage.setItem('yams-salons', JSON.stringify(Y.recent.list().filter(x => x.code !== code))); } catch { } },
  };

  Y.toast = function (text, kind = 'info') {
    const box = document.getElementById('toasts');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    box.appendChild(d);
    setTimeout(() => d.remove(), 4200);
    while (box.children.length > 3) box.firstChild.remove();
  };

  /* ---------- dés 3D ---------- */
  const FACES = { front: 1, back: 6, right: 2, left: 5, top: 3, bottom: 4 };
  const ROT = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };
  const pips = v => `<div class="pips v${v}">` + ['tl', 'tr', 'ml', 'c', 'mr', 'bl', 'br'].map(p => `<span class="pip ${p}"></span>`).join('') + '</div>';

  // construit les 5 dés une seule fois ; onClick(i) est appelé au clic
  Y.buildDice = function (box, onClick) {
    box.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const w = document.createElement('div');
      w.className = 'die-3d';
      w.innerHTML = '<div class="die-cube">' + Object.entries(FACES).map(([f, v]) => `<div class="die-face ${f}">${pips(v)}</div>`).join('') + '</div>';
      w.addEventListener('click', () => onClick(i));
      box.appendChild(w);
    }
  };
  // met à jour valeurs, dés conservés et animation de lancer
  Y.updateDice = function (box, dice, held, rolling) {
    box.querySelectorAll('.die-3d').forEach((w, i) => {
      const cube = w.querySelector('.die-cube');
      const [x, yy] = ROT[dice[i]];
      const spin = rolling && !held[i];
      if (spin) {
        if (!cube.classList.contains('rolling')) {
          cube.style.animationDuration = (0.22 + Math.random() * 0.22).toFixed(2) + 's';
          cube.style.animationDirection = Math.random() < 0.5 ? 'reverse' : 'normal';
          cube.classList.add('rolling');
        }
      } else {
        cube.classList.remove('rolling');
        cube.style.transform = `rotateX(${x}deg) rotateY(${yy}deg)`;
      }
      w.classList.toggle('held', !!held[i]);
    });
  };

  /* ---------- tableau de scores (identique pour tous les modes) ---------- */
  const UPPER = [1, 2, 3, 4, 5, 6];
  const LOWER = ['brelan', 'carre', 'full', 'petiteSuite', 'grandeSuite', 'yam', 'somme'];
  const UL = { 1: 'As (1)', 2: 'Deux (2)', 3: 'Trois (3)', 4: 'Quatre (4)', 5: 'Cinq (5)', 6: 'Six (6)' };
  const LL = { brelan: 'Brelan', carre: 'Carré', full: 'Full', petiteSuite: 'Petite suite', grandeSuite: 'Grande suite', yam: 'Yam', somme: 'Chance' };
  const BASE = { full: 25, petiteSuite: 30, grandeSuite: 40, yam: 50 };
  Y.label = (k, ps) => (typeof k === 'number' ? UL[k] : BASE[k] ? (ps ? `${LL[k]} (${BASE[k]} / ${BASE[k] * 2} pts)` : `${LL[k]} (${BASE[k]} pts)`) : LL[k]);
  Y.plainLabel = k => (typeof k === 'number' ? UL[k] : LL[k]);

  // opt : { canPlay, canEditPlayer(i), editing:{key,player}|null }
  // Les cellules portent des data-* ; les clics sont gérés par le conteneur (délégation).
  Y.tableHTML = function (s, opt) {
    const n = s.players.length, cols = n + 1;
    let h = '<thead><tr><th class="row-label">Combinaison</th>' + s.players.map((p, i) => `<th>${Y.esc(p.name)}${s.phase === 'playing' && i === s.current ? ' 👈' : ''}</th>`).join('') + '</tr></thead><tbody>';
    const title = t => `<tr class="section-title"><td colspan="${cols}">${t}</td></tr>`;
    const sumRow = (label, fn, cls = 'subtotal-row', bonus = false) => `<tr class="${cls}"><td class="row-label">${label}</td>` +
      s.players.map(p => { const v = fn(p); return `<td${bonus && typeof v === 'string' && v.startsWith('+') ? ' class="bonus-active"' : ''}>${v}</td>`; }).join('') + '</tr>';
    const cur = s.players[s.current];
    const row = key => {
      let cls = '';
      if (s.phase === 'playing' && cur && cur.card[key] === null) {
        if (s.mode === 'classic') { const pv = s.previews[key]; if (pv) cls = pv.score > 0 ? 'row-playable' : 'row-barren'; }
        else cls = 'row-playable';
      }
      let r = `<tr class="${cls}"><td class="row-label">${Y.label(key, s.pointsSup)}</td>`;
      s.players.forEach((p, pi) => {
        const v = p.card[key], isCur = s.phase === 'playing' && pi === s.current;
        const ed = opt.editing && opt.editing.key == key && opt.editing.player === pi;
        if (ed) r += `<td class="score-cell editing"><input type="number" min="0" class="edit-score-input" id="edit-in" value="${v}" data-key="${key}" data-player="${pi}"><button class="edit-score-btn" data-ok title="Valider la correction">✓</button></td>`;
        else if (v !== null) r += `<td class="score-cell filled${v === 0 ? ' zero-score' : ''}"><span>${v}</span>${p.doubled[key] ? '<span class="ps-star" title="Points sup. obtenus">⭐</span>' : ''}${opt.canEditPlayer(pi) ? `<button class="edit-score-btn" data-edit="${key}" data-player="${pi}" title="Corriger ce score">✏️</button>` : ''}</td>`;
        else if (isCur && opt.canPlay && s.mode === 'classic' && s.previews[key]) {
          const pv = s.previews[key];
          r += `<td class="score-cell empty-current${pv.doubled ? ' doubled' : ''}" data-select="${key}" title="${pv.score > 0 ? 'Cliquez pour valider ce score.' : 'Combinaison non réalisée : cliquez pour barrer (0 point).'}">${pv.score > 0 ? pv.score + (pv.doubled ? ' ⭐' : '') : '0 (barrer)'}</td>`;
        } else if (isCur && opt.canPlay && s.mode === 'sheet') r += `<td class="score-cell empty-current" data-enter="${key}" title="Cliquez pour indiquer le score obtenu.">✎ Saisir</td>`;
        else r += '<td class="score-cell other-empty">–</td>';
      });
      return r + '</tr>';
    };
    h += title('Chiffres') + UPPER.map(row).join('');
    h += sumRow('Sous-total (1-6)', p => p.t.sub);
    h += sumRow('Bonus (si ≥ 63) : +35', p => (p.t.bonus ? '+' + p.t.bonus : '0'), 'subtotal-row', true);
    h += sumRow('→ Total Chiffres (avec bonus)', p => p.t.upperTotal, 'subtotal-row running-total');
    h += title('Combinaisons') + LOWER.map(row).join('');
    if (s.pointsSup) {
      h += sumRow('→ Sous-total avant bonus Points sup.', p => p.t.pre, 'subtotal-row running-total');
      h += sumRow('Bonus Points sup. (aucune ligne barrée) : +10', p => (p.t.perfect ? '+' + p.t.perfect : (p.t.perfect === 0 && Object.values(p.card).every(v => v !== null) ? '0' : '—')), 'subtotal-row', true);
    }
    h += sumRow('TOTAL', p => p.t.total, 'total-row');
    return h + '</tbody>';
  };

  Y.ranking = function (s) {
    const res = s.players.map(p => ({ name: p.name, total: p.t.total })).sort((a, b) => b.total - a.total);
    const L = ['🏆 1er', '🥈 2e', '🥉 3e'];
    return res.map((r, i) => `<div class="result-row${i === 0 ? ' winner' : ''}"><span>${L[i] || (i + 1) + 'e'} — ${Y.esc(r.name)}</span><span>${r.total} pts</span></div>`).join('');
  };

  Y.hofHTML = function (hof) {
    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const col = (title, list) => `<div class="hof-column"><h3>${title}</h3>` + (list.length ? list.map((e, i) =>
      `<div class="hof-row"><span class="hof-rank">${medals[i]}</span><span class="hof-name">${Y.esc(e.name)}</span><span class="hof-score">${e.score} pts</span></div>`).join('') : '<p class="hof-empty">Aucun score enregistré.</p>') + '</div>';
    const top = f => hof.filter(f).sort((a, b) => b.score - a.score).slice(0, 5);
    return col('🎯 Classique', top(e => !e.pointsSup)) + col('⭐ Points sup. activé', top(e => e.pointsSup));
  };
})();
