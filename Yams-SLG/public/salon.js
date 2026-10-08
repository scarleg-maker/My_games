// Yam's — page de salon : /CODE (arbitre) et /CODE/joueurN (joueur)
(() => {
  const $ = s => document.querySelector(s);
  const m = location.pathname.match(/\/joueur([1-8])\/?$/);
  const WHO = m ? 'p' + m[1] : 'master';
  const IS_MASTER = WHO === 'master';
  let editing = null, editVal = '', entryKey = null, firstRender = true, diceBuilt = false;

  document.title = `Yam's — Salon ${Y.room}${m ? ' — Joueur ' + m[1] : ''}`;

  /* ---------------------------------------------------------------- rendu principal */
  function render(s) {
    if (firstRender) { firstRender = false; Y.recent.add(Y.room, IS_MASTER ? 'arbitre' : 'joueur'); }
    $('#roomBadge').innerHTML = `Salon <strong>${Y.room}</strong>`;
    $('#roomBadge').onclick = () => copy(joinUrl(s));
    const modeTxt = s.mode === 'classic' ? 'Jeu avec dés' : 'Tableau de scores';
    $('#meta').textContent = (IS_MASTER ? 'Arbitre' : `Joueur ${m[1]}`) + (s.phase === 'setup' ? ' — configuration' : ` · ${modeTxt}${s.pointsSup ? ' · Points sup.' : ''}`);

    let acts = '<button class="btn-link small" data-top="rules">📖 Règles</button><button class="btn-link small" data-top="hof">🏆 Palmarès</button>';
    if (IS_MASTER && s.phase !== 'setup') {
      if (s.phase === 'playing') acts += '<button class="btn-link small" data-a="skip">Passer le tour</button>';
      acts += '<button class="btn-link small" data-a="rematch">Nouvelle manche</button><button class="btn-link small" data-a="reset">Configuration</button>';
    }
    $('#topActions').innerHTML = acts;

    $('#setup').classList.toggle('hidden', s.phase !== 'setup');
    $('#play').classList.toggle('hidden', s.phase === 'setup');
    if (s.phase === 'setup') renderSetup(s); else renderPlay(s);
    if (!$('#hof-modal').classList.contains('hidden')) renderHof(s);
  }
  const redraw = () => Y.state && render(Y.state);

  /* ---------------------------------------------------------------- configuration */
  function renderSetup(s, force) {
    const a = document.activeElement;
    if (!force && a && a.tagName === 'INPUT' && $('#setup').contains(a)) return;   // pas de rendu pendant la saisie
    const box = $('#setup');
    if (!IS_MASTER) return renderPlayerSetup(s, box);
    const n = s.nbJoueurs;
    let h = '<div class="card">';
    h += '<h2>Mode de jeu</h2><div class="choice2">' +
      `<button class="mode-card" aria-pressed="${s.mode === 'classic'}" data-mode="classic"><strong>🎲 Jeu avec dés</strong><span>Les dés sont lancés à l'écran (animation 3D), 3 lancers par tour, le score est calculé automatiquement.</span></button>` +
      `<button class="mode-card" aria-pressed="${s.mode === 'sheet'}" data-mode="sheet"><strong>📋 Tableau de scores</strong><span>Vous jouez avec vos dés physiques : on saisit chaque score en cliquant sur la ligne, avec vérification.</span></button></div>`;
    h += `<label class="checkbox-label"><input type="checkbox" id="optPS" ${s.pointsSup ? 'checked' : ''}><span>Règle « Points sup. »</span></label>
      <p class="small muted" style="margin:4px 0 0">Full, Petite suite, Grande suite ou Yam dès le 1er lancer : points doublés. Aucune ligne barrée : +10.</p>`;
    h += '<h2 style="margin-top:20px">Nombre de joueurs</h2><div class="counter">' +
      Array.from({ length: 8 }, (_, i) => `<button data-nb="${i + 1}" aria-pressed="${n === i + 1}">${i + 1}</button>`).join('') + '</div>';

    h += '<h2 style="margin-top:20px">Joueurs</h2>';
    if (s.roster.length) {
      const seated = new Set(s.seats.slice(0, n).filter(x => x.name).map(x => x.name.toLowerCase()));
      h += '<div class="roster"><span class="small muted">Joueurs habituels :</span>' + s.roster.map(r =>
        `<span class="rchip ${seated.has(r.toLowerCase()) ? 'seated' : ''}"><button data-roster="${Y.esc(r)}" title="Placer dans le premier siège libre">${Y.esc(r)}</button><button class="x" data-forget="${Y.esc(r)}" title="Oublier" aria-label="Oublier ${Y.esc(r)}">✕</button></span>`).join('') + '</div>';
    }
    h += '<div class="slots">';
    for (let i = 0; i < n; i++) {
      const st = s.seats[i];
      h += `<div class="slot ${st.name ? 'ready' : ''}"><div class="slot-head"><strong>Joueur ${i + 1}</strong>
        <span class="dot${st.online ? ' on' : ''}" title="${st.online ? 'Écran connecté' : 'Écran non connecté'}"></span><a href="/${Y.room}/joueur${i + 1}" target="_blank" class="small">page du joueur ${i + 1}</a>
        ${st.name ? `<button class="btn-link small" data-unreg="${i}" style="margin-left:auto">Retirer</button>` : ''}</div>
        <div class="row"><input type="text" id="name-${i}" maxlength="20" placeholder="Nom du joueur" value="${Y.esc(st.name || '')}" autocomplete="off"><button class="btn-secondary" data-reg="${i}">${st.name ? 'Modifier' : 'Inscrire'}</button></div></div>`;
    }
    h += '</div>';
    const missing = s.seats.slice(0, n).filter(x => !x.name).length;
    h += `<div class="start-bar"><button class="btn-primary btn-big" data-a="start" ${missing ? 'disabled' : ''}>▶ Lancer la partie</button>
      <span class="small muted">${missing ? `${missing} joueur${missing > 1 ? 's' : ''} à inscrire (ici ou depuis sa page).` : 'Tout le monde est prêt.'}</span></div>`;
    h += invitation(s) + '</div>';
    box.innerHTML = h;
    drawQR();
  }
  function renderPlayerSetup(s, box) {
    const me = s.mySeat;
    if (me >= s.nbJoueurs) {
      box.innerHTML = `<div class="card"><h2>Joueur ${me + 1}</h2><p>Ce poste n'est pas utilisé : la partie est prévue pour ${s.nbJoueurs} joueur(s). Utilisez une page entre <strong>joueur1</strong> et <strong>joueur${s.nbJoueurs}</strong>.</p></div>`;
      return;
    }
    const st = s.seats[me];
    box.innerHTML = `<div class="card"><h2>Joueur ${me + 1}</h2>
      <label class="field-label" for="myname">Votre nom</label>
      <input type="text" id="myname" class="name-input" maxlength="20" value="${Y.esc(st.name || '')}" placeholder="Ex. Camille" autocomplete="off">
      <button class="btn-primary btn-big" id="mySave">${st.name ? 'Mettre à jour' : "Je m'inscris"}</button>
      ${st.name ? `<p class="ok-msg">Inscrit·e sous le nom <strong>${Y.esc(st.name)}</strong>. La partie commencera quand l'arbitre la lancera.</p><p class="small muted">Pas vous ? Modifiez le nom, ou <button class="btn-link small" data-unreg-me>libérez ce siège</button>.</p>` : '<p class="muted">Choisissez un nom, puis inscrivez-vous.</p>'}
      <p class="small muted">${s.mode === 'classic' ? 'Jeu avec dés' : 'Tableau de scores'} · ${s.nbJoueurs} joueur(s)</p></div>`;
  }

  /* ---------------------------------------------------------------- invitation / QR */
  const isLocal = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
  function joinUrl(s) { return isLocal && s.lanUrls && s.lanUrls.length ? `${s.lanUrls[0]}/${Y.room}/rejoindre` : Y.roomUrl('/rejoindre'); }
  function invitation(s) {
    const url = joinUrl(s);
    return `<div class="invite"><div class="qr" id="qr" data-url="${Y.esc(url)}"></div><div>
      <p style="margin:0 0 .3rem"><strong>Inviter les joueurs</strong> — code du salon : <span class="code-big">${Y.room}</span></p>
      <p class="small muted" style="margin:0 0 .5rem">Scannez le QR code, ou ouvrez <code>${Y.esc(url)}</code>, ou tapez le code sur la page d'accueil. Chacun choisit ensuite son siège.</p>
      <button class="btn-secondary" data-copy="${Y.esc(url)}" style="padding:8px 14px;font-size:.9rem">Copier le lien</button></div></div>`;
  }
  let qrLib = null;
  function drawQR() {
    const b = $('#qr');
    if (!b || b.dataset.done === b.dataset.url) return;
    if (!qrLib) qrLib = new Promise(ok => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      sc.onload = () => ok(true); sc.onerror = () => ok(false);
      document.head.appendChild(sc);
    });
    qrLib.then(ok => {
      const q = $('#qr'); if (!q) return;
      if (!ok || !window.QRCode) { q.style.display = 'none'; return; }
      if (q.dataset.done === q.dataset.url) return;
      q.innerHTML = ''; q.dataset.done = q.dataset.url;
      new QRCode(q, { text: q.dataset.url, width: 112, height: 112, colorDark: '#2b2b2b', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); Y.toast('Lien copié : ' + text, 'ok'); } catch { prompt('Copiez ce lien :', text); }
  }

  /* ---------------------------------------------------------------- partie */
  function renderPlay(s) {
    const canPlay = s.phase === 'playing' && !s.rolling && (IS_MASTER || s.mySeat === s.current);
    const cur = s.players[s.current];
    $('#banner').textContent = s.phase === 'over' ? 'Partie terminée'
      : `Au tour de : ${cur.name}${!IS_MASTER && s.mySeat === s.current ? ' — c\'est à vous !' : ''}`;

    const classic = s.mode === 'classic';
    $('#diceZone').classList.toggle('hidden', !classic || s.phase === 'over');
    $('#sheetZone').classList.toggle('hidden', classic || s.phase === 'over');

    if (classic) {
      if (!diceBuilt) { Y.buildDice($('#dice'), onDie); diceBuilt = true; }
      Y.updateDice($('#dice'), s.dice, s.held, s.rolling);
      const left = 3 - s.rollCount;
      $('#rollsLeft').textContent = s.rolling ? 'Les dés roulent…' : s.rollCount === 0 ? 'Aucun lancer effectué' : `Lancers restants : ${left}`;
      $('#btnRoll').disabled = !canPlay || s.rollCount >= 3 || s.locked;
      $('#btnRoll').textContent = s.rollCount === 0 ? '🎲 Lancer les dés' : '🎲 Relancer les dés';
      $('#btnStop').disabled = !canPlay || s.rollCount < 1 || s.rollCount >= 3 || s.locked;
      $('#btnStop').textContent = s.locked && s.rollCount < 3 ? '✅ Lancers arrêtés — choisissez votre ligne' : '✅ Arrêter et marquer';
    }

    const over = s.phase === 'over';
    $('#endBox').classList.toggle('hidden', !over);
    if (over) {
      $('#final-results').innerHTML = Y.ranking(s);
      $('#endActions').innerHTML = IS_MASTER ? '<button class="btn-primary" data-a="rematch">Nouvelle manche</button><button class="btn-secondary" data-a="reset">Configuration</button>' : '<p class="small muted">L\'arbitre peut lancer une nouvelle manche.</p>';
    }

    // tableau (on conserve la valeur d'une correction en cours de saisie)
    const wasEditing = editing && document.activeElement && document.activeElement.id === 'edit-in';
    $('#tbl').innerHTML = Y.tableHTML(s, {
      canPlay,
      canEditPlayer: pi => IS_MASTER || s.mySeat === pi,
      editing,
    });
    if (editing) { const i = $('#edit-in'); if (i) { i.value = editVal; if (wasEditing || true) i.focus(); } }
  }
  function onDie(i) {
    const s = Y.state;
    if (s && s.phase === 'playing' && s.mode === 'classic' && !s.rolling) Y.act('hold', { index: i });
  }

  /* ---------------------------------------------------------------- palmarès */
  function renderHof(s) {
    $('#hof-list').innerHTML = Y.hofHTML(s.hof);
    $('#hofReset').classList.toggle('hidden', !IS_MASTER);
  }

  /* ---------------------------------------------------------------- saisie d'un score (mode Tableau) */
  function openEntry(key) {
    const s = Y.state, cur = s.players[s.current];
    entryKey = key;
    $('#entryTitle').textContent = `${cur.name} — ${Y.plainLabel(isNaN(key) ? key : +key)}`;
    $('#entryHint').textContent = s.hints[key];
    $('#entryInput').value = ''; $('#entryError').textContent = '';
    $('#entry-modal').classList.remove('hidden');
    setTimeout(() => $('#entryInput').focus(), 50);
  }
  function closeEntry() { entryKey = null; $('#entry-modal').classList.add('hidden'); }
  async function submitEntry() {
    if (entryKey === null) return;
    const raw = $('#entryInput').value.trim();
    if (raw === '') { $('#entryError').textContent = 'Veuillez entrer une valeur.'; return; }
    const r = await Y.act('enter', { key: entryKey, value: raw });
    if (r.ok) closeEntry(); else $('#entryError').textContent = r.error || 'Score invalide.';
  }
  $('#entryOk').onclick = submitEntry;
  $('#entryCancel').onclick = closeEntry;
  $('#entryClose').onclick = closeEntry;
  $('#entry-modal').onclick = e => { if (e.target.id === 'entry-modal') closeEntry(); };
  $('#entryInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitEntry(); });

  /* ---------------------------------------------------------------- événements */
  $('#btnRoll').onclick = () => Y.act('roll');
  $('#btnStop').onclick = () => Y.act('stop');

  // tableau : sélection, saisie, correction
  $('#tbl').addEventListener('click', async e => {
    const t = e.target.closest('[data-select],[data-enter],[data-edit],[data-ok]');
    if (!t) return;
    if (t.dataset.select !== undefined) return void Y.act('select', { key: t.dataset.select });
    if (t.dataset.enter !== undefined) return openEntry(t.dataset.enter);
    if (t.dataset.edit !== undefined) {
      editing = { key: t.dataset.edit, player: +t.dataset.player };
      editVal = Y.state.players[editing.player].card[t.dataset.edit];
      return redraw();
    }
    if (t.dataset.ok !== undefined) return submitEdit();
  });
  $('#tbl').addEventListener('input', e => { if (e.target.id === 'edit-in') { editVal = e.target.value; e.target.classList.remove('invalid'); } });
  $('#tbl').addEventListener('keydown', e => { if (e.target.id === 'edit-in' && e.key === 'Enter') submitEdit(); if (e.target.id === 'edit-in' && e.key === 'Escape') { editing = null; redraw(); } });
  async function submitEdit() {
    if (!editing) return;
    const r = await Y.act('edit', { player: editing.player, key: editing.key, value: editVal });
    if (r.ok) { editing = null; redraw(); } else { const i = $('#edit-in'); if (i) i.classList.add('invalid'); }
  }

  // clics généraux (configuration, actions de l'en-tête…)
  document.addEventListener('click', e => {
    const t = e.target.closest('button,[data-top]');
    if (!t) return;
    const d = t.dataset;
    if (d.a) return void Y.act(d.a);
    if (d.top === 'rules') return void $('#rules-modal').classList.remove('hidden');
    if (d.top === 'hof') { renderHof(Y.state); return void $('#hof-modal').classList.remove('hidden'); }
    if (d.mode) return void Y.act('config', { mode: d.mode });
    if (d.nb) return void Y.act('config', { nbJoueurs: +d.nb });
    if (d.copy) return void copy(d.copy);
    if (d.reg !== undefined) {
      const i = +d.reg, v = document.getElementById('name-' + i).value;
      return void Y.act('register', { seat: i, name: v }).then(() => renderSetup(Y.state, true));
    }
    if (d.unreg !== undefined) return void Y.act('unregister', { seat: +d.unreg });
    if (d.roster) {
      const s = Y.state, i = s.seats.slice(0, s.nbJoueurs).findIndex(x => !x.name);
      if (i < 0) return Y.toast('Tous les sièges sont occupés', 'bad');
      return void Y.act('register', { seat: i, name: d.roster });
    }
    if (d.forget) return void Y.act('forget', { name: d.forget });
    if ('unregMe' in d) return void Y.act('unregister');
    if (t.id === 'mySave') {
      const v = document.getElementById('myname').value.trim();
      if (!v) return Y.toast('Indiquez votre nom', 'bad');
      return void Y.act('register', { name: v }).then(() => renderSetup(Y.state, true));
    }
    if (t.id === 'hofClose') return void $('#hof-modal').classList.add('hidden');
    if (t.id === 'rulesClose') return void $('#rules-modal').classList.add('hidden');
    if (t.id === 'hofReset' && confirm('Réinitialiser tout le palmarès de ce salon (les deux colonnes) ? Cette action est irréversible.')) return void Y.act('resetHof');
  });
  document.addEventListener('change', e => { if (e.target.id === 'optPS') Y.act('config', { pointsSup: e.target.checked }); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.id) return;
    if (e.target.id.startsWith('name-')) document.querySelector(`[data-reg="${e.target.id.slice(5)}"]`).click();
    if (e.target.id === 'myname') $('#mySave').click();
  });
  $('#hof-modal').onclick = e => { if (e.target.id === 'hof-modal') e.target.classList.add('hidden'); };
  $('#rules-modal').onclick = e => { if (e.target.id === 'rules-modal') e.target.classList.add('hidden'); };
  // quand on quitte un champ, on applique le dernier état reçu
  document.addEventListener('focusout', () => setTimeout(() => { const s = Y.state; if (s && s.phase === 'setup') renderSetup(s); }, 150));

  /* ---------------------------------------------------------------- salon introuvable */
  function noRoom() {
    $('#setup').classList.remove('hidden'); $('#play').classList.add('hidden');
    $('#setup').innerHTML = `<div class="card" style="text-align:center"><h2>Le salon ${Y.esc(Y.room)} n'existe pas</h2>
      <p class="muted">Il a peut-être expiré, ou le serveur a redémarré.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">${IS_MASTER ? `<button class="btn-primary" id="recreate">Créer le salon ${Y.esc(Y.room)}</button>` : ''}<a class="btn-secondary" href="/" style="text-decoration:none;padding:12px 20px;border-radius:10px">Accueil</a></div></div>`;
    const b = document.getElementById('recreate');
    if (b) b.onclick = async () => {
      const r = await (await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: Y.room, reuse: true }) })).json();
      if (r.ok) Y.reconnect(); else Y.toast(r.error, 'bad');
    };
  }

  Y.connect(WHO, render, noRoom);
})();
