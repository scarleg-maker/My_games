/* Duo-Master — page arbitre (/ ou /arbitre) */
(() => {
  const { $, esc, api } = DM;

  const view = new DM.DrawView($('#draw'));
  let S = null;            // dernier état reçu
  let themes = [];         // thèmes disponibles
  let info = null;         // adresses réseau du serveur
  let ansKey = null;       // tirage pour lequel les réponses sont chargées
  let ansData = null;
  let chain = Promise.resolve();
  let stopCountdown = null; // arrête le compte à rebours affiché (mode Réponse)

  const MODE_DESC = {
    speed: 'Rapidité : l\'arbitre désigne qui a répondu le premier.',
    answer: 'Réponse : chaque joueur écrit sa réponse (10 s), corrigée automatiquement. Plusieurs joueurs peuvent marquer sur le même tour.',
  };

  const answersHidden = () => localStorage.getItem('dm_hide_answers') === '1';

  DM.connect(
    (st) => { chain = chain.then(() => render(st)).catch(console.error); },
    (ok) => { $('#offline').style.display = ok ? 'none' : 'block'; }
  );

  async function act(url, body = {}) {
    try { await api(url, body); } catch (e) { DM.toast(e.message, true); }
  }

  /* ---------------- rendu principal ---------------- */
  async function render(st) {
    const wasStarted = S ? S.started : null;
    S = st;
    const theme = await DM.getTheme(st);
    const box = $('#settings');
    if (!st.started && wasStarted !== false) box.open = true;   // salon : réglages ouverts
    if (st.started && wasStarted === false) box.open = false;  // partie lancée : on les replie
    view.render(st, theme);

    $('#themeTag').textContent = `${theme.emoji} ${theme.name}${st.round ? ` · tour ${st.round}` : ''}`;
    renderMode();
    renderStage();
    renderPlayers();
    renderSettings(theme);
    renderLinks();
    loadAnswers();
  }

  function renderMode() {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    $('#modeDesc').textContent = MODE_DESC[S.mode] || '';
  }

  function renderStage() {
    const btn = $('#drawBtn');
    const winner = S.players.find((p) => p.id === S.winnerId);

    const isAnswer = S.mode === 'answer';
    let label = S.draw ? 'Tour suivant' : 'Lancer le tirage';
    if (!S.started) label = '▶ Lancer la partie';
    else if (S.gameOver) label = 'Partie terminée';
    else if (S.phase === 'rolling') label = 'Tirage en cours…';
    else if (S.phase === 'drawn' && !isAnswer) label = 'Autre tirage (personne ne trouve)';
    btn.textContent = label;
    btn.disabled = S.started && (S.gameOver || S.phase === 'rolling');
    btn.className = `btn big${S.phase === 'drawn' ? ' white' : ''}`;

    let status = 'Prêt ? Lancez le tirage.';
    if (!S.started) status = 'Réglez la partie (thème, joueurs, points) puis lancez-la.';
    else if (S.gameOver) status = '';
    else if (S.phase === 'rolling') status = 'Tirage en cours…';
    else if (S.phase === 'drawn' && isAnswer) status = 'Les joueurs écrivent leur réponse — corrigez ou complétez ci-dessous.';
    else if (S.phase === 'drawn') status = 'Désignez le joueur qui gagne le point.';
    else if (S.draw && S.lastEvent && S.lastEvent.type === 'point') status = `${DM.eventText(S.lastEvent)}. Prêt pour le tour suivant.`;
    else if (S.draw) status = 'Prêt pour le tour suivant.';
    $('#status').textContent = status;

    $('#over').hidden = !S.gameOver;
    if (S.gameOver && winner) $('#overText').textContent = `🏆 ${winner.name} remporte la partie avec ${winner.score} points !`;
  }

  function renderPlayers() {
    $('#targetInfo').textContent = `— premier à ${S.target}`;
    const canAwardRound = S.started && S.phase === 'drawn' && !S.gameOver;
    const awardedIds = new Set((ansData && ansData.submissions || []).filter((s) => s.awarded).map((s) => s.id));
    $('#players').innerHTML = S.players.map((p) => `
      <div class="row${p.id === S.winnerId ? ' win' : ''}" style="--pc:${DM.playerColor(p.id)}">
        <span class="badge">${p.id}</span>
        <div class="row-main">
          <div class="row-name">${esc(p.name)}</div>
          ${DM.pips(p.score, S.target)}
        </div>
        <div class="row-score">${p.score}<small>/${S.target}</small></div>
        <div class="row-btns">
          <button class="btn small mint" data-act="award" data-id="${p.id}" type="button" ${canAwardRound && !awardedIds.has(p.id) ? '' : 'disabled'}>🏆 Point</button>
          <button class="btn small white icon" data-act="minus" data-id="${p.id}" type="button" ${!S.started || p.score <= 0 ? 'disabled' : ''} aria-label="Retirer un point à ${esc(p.name)}" title="Retirer un point (erreur)">−1</button>
          <button class="btn small white icon" data-act="plus" data-id="${p.id}" type="button" ${!S.started || p.score >= S.target ? 'disabled' : ''} aria-label="Ajouter un point à ${esc(p.name)}" title="Ajouter un point">+1</button>
        </div>
      </div>`).join('');
  }

  /* ---------------- réponses possibles + réponses des joueurs ---------------- */
  async function loadAnswers() {
    const card = $('#answersCard');
    const subCard = $('#submissionsCard');
    const isAnswer = S.mode === 'answer';
    subCard.hidden = !(isAnswer && S.draw && S.phase !== 'rolling');
    renderCountdown();

    if (S.phase === 'rolling') { card.hidden = false; ansKey = null; ansData = null; paintAnswers('rolling'); return; }
    if (!S.draw) { card.hidden = true; ansKey = null; return; }
    card.hidden = false;
    // En mode Réponse, subRev change à chaque réponse tapée : on doit alors recharger.
    const key = `${S.themeId}:${S.themeRev}:${S.round}:${isAnswer ? S.subRev : 0}`;
    if (key === ansKey) { paintAnswers(); paintSubmissions(); return; }
    ansKey = key;
    ansData = null;
    paintAnswers('loading');
    try {
      const data = await api('/api/answers');
      if (ansKey !== key) return; // un autre tirage est arrivé entre-temps
      ansData = data;
      paintAnswers();
      paintSubmissions();
      renderPlayers(); // les boutons 🏆 dépendent de ansData.submissions
    } catch (e) {
      DM.toast(e.message, true);
    }
  }

  function renderCountdown() {
    if (stopCountdown) { stopCountdown(); stopCountdown = null; }
    const bar = $('#subBar');
    const fill = $('#subBarFill');
    const txt = $('#subTimer');
    if (S.mode !== 'answer' || S.phase !== 'drawn' || !S.answerDeadline) {
      bar.hidden = true;
      txt.textContent = '';
      return;
    }
    bar.hidden = false;
    stopCountdown = DM.countdown(S.answerDeadline, S.answerMs, (secs, frac) => {
      txt.textContent = secs > 0 ? `⏱ ${secs}s` : 'Temps écoulé';
      fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    });
  }

  function paintSubmissions() {
    const box = $('#submissions');
    if (S.mode !== 'answer' || !ansData) { box.innerHTML = ''; return; }
    const subs = ansData.submissions || [];
    box.innerHTML = subs.map((s) => {
      const icon = s.awarded ? '✅' : s.correct === false ? '❌' : s.text ? '❔' : '⏳';
      const canGive = S.started && S.phase === 'drawn' && !S.gameOver && !s.awarded;
      return `
        <div class="row" style="--pc:${DM.playerColor(s.id)}">
          <span class="badge">${s.id}</span>
          <div class="row-main">
            <div class="row-name">${esc(s.name)}</div>
            <div class="sub-text">${icon} ${s.text ? esc(s.text) : '<span class="muted">— pas encore de réponse —</span>'}</div>
          </div>
          <button class="btn small mint" data-act="give" data-id="${s.id}" type="button" ${canGive ? '' : 'disabled'}>🏆 Attribuer</button>
        </div>`;
    }).join('');
  }

  $('#submissions').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act="give"]');
    if (!b || b.disabled) return;
    act('/api/award', { playerId: Number(b.dataset.id) });
  });

  const chip = (a) => `<span class="chip">${esc(a.name)}${a.info ? ` <small>${esc(a.info)}</small>` : ''}${a.detail ? ` <small>${esc(a.detail)}</small>` : ''}</span>`;

  function paintAnswers(mode) {
    const box = $('#answers');
    const hidden = answersHidden();
    $('#ansToggle').textContent = hidden ? 'Afficher' : 'Masquer';
    $('#ansToggle').hidden = mode === 'rolling';
    if (mode === 'rolling') { $('#ansTitle').textContent = 'Réponses possibles'; box.innerHTML = '<p class="muted">Le tirage est en cours…</p>'; return; }
    if (mode === 'loading' || !ansData) { box.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    if (!ansData.hasAnswers) {
      $('#ansTitle').textContent = 'Réponses possibles';
      box.innerHTML = '<p class="muted">Ce thème n\'a pas de liste de réponses : c\'est à l\'arbitre de juger.</p>';
      return;
    }
    $('#ansTitle').textContent = `Réponses possibles (${ansData.exact.length})`;
    if (hidden) { box.innerHTML = '<p class="muted">Réponses masquées (pratique sur un écran partagé).</p>'; return; }
    let html = ansData.exact.length
      ? `<div class="chips">${ansData.exact.map(chip).join('')}</div>`
      : '<p class="muted">Aucune réponse répertoriée pour ce tirage : c\'est à l\'arbitre de juger.</p>';
    if (ansData.also.length) {
      html += `<details class="more"><summary>${esc(ansData.alsoLabel)} (${ansData.also.length})</summary><div class="chips">${ansData.also.map(chip).join('')}</div></details>`;
    }
    box.innerHTML = html;
  }

  $('#ansToggle').addEventListener('click', () => {
    localStorage.setItem('dm_hide_answers', answersHidden() ? '0' : '1');
    paintAnswers();
  });

  /* ---------------- réglages ---------------- */
  async function loadThemes() {
    try {
      const list = await api('/api/themes');
      if (JSON.stringify(list) === JSON.stringify(themes)) return;
      themes = list;
      const sel = $('#theme');
      sel.innerHTML = themes.map((t) => `<option value="${esc(t.id)}">${esc(t.emoji)} ${esc(t.name)}</option>`).join('');
      if (S) sel.value = S.themeId;
    } catch (e) { /* silencieux */ }
  }

  function renderSettings(theme) {
    const sel = $('#theme');
    if (!sel.options.length) loadThemes();
    if (document.activeElement !== sel) sel.value = S.themeId;
    $('#themeDesc').textContent = theme.description || '';
    $('#targetOut').textContent = S.target;
    $('#countOut').textContent = S.players.length;

    const names = $('#names');
    if (names.children.length !== S.players.length) {
      names.innerHTML = S.players.map((p) => `
        <div class="name-line" style="--pc:${DM.playerColor(p.id)}">
          <span class="badge">${p.id}</span>
          <input type="text" maxlength="24" data-idx="${p.id - 1}" value="" aria-label="Nom du joueur ${p.id}" autocomplete="off">
        </div>`).join('');
    }
    names.querySelectorAll('input').forEach((inp, i) => {
      if (document.activeElement !== inp) inp.value = S.players[i].name;
    });
  }

  $('#modeBar').addEventListener('click', (e) => {
    const b = e.target.closest('.mode-btn');
    if (!b || !S || b.dataset.mode === S.mode) return;
    act('/api/settings', { mode: b.dataset.mode });
  });

  $('#theme').addEventListener('focus', loadThemes);
  $('#theme').addEventListener('change', (e) => act('/api/settings', { themeId: e.target.value }));

  document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.step;
    const cur = key === 'target' ? S.target : S.players.length;
    act('/api/settings', { [key]: cur + Number(b.dataset.d) });
  }));

  let savedTimer = null;
  $('#names').addEventListener('change', async (e) => {
    const inp = e.target.closest('input');
    if (!inp) return;
    const arr = new Array(6).fill(null);
    arr[Number(inp.dataset.idx)] = inp.value;
    await act('/api/settings', { names: arr });
    $('#saved').textContent = '✔ Nom enregistré';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { $('#saved').textContent = 'Les noms sont conservés d\'une partie à l\'autre.'; }, 2000);
  });

  /* ---------------- liens joueurs ---------------- */
  async function renderLinks() {
    if (!info) {
      info = { ips: [], port: location.port }; // valeur provisoire, évite les appels multiples
      try { info = await api('/api/info'); } catch (e) { /* ignore */ }
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const base = local ? `http://localhost:${info.port}` : location.origin;
    const lines = S.players.map((p) => `<div>${esc(p.name)} : <a href="${base}/joueur${p.id}" target="_blank" rel="noopener">${base}/joueur${p.id}</a></div>`);
    lines.push(`<div>Écran commun (scores + tirage) : <a href="${base}/ecran" target="_blank" rel="noopener">${base}/ecran</a></div>`);
    if (local && info.ips.length) {
      lines.push(`<div class="muted" style="margin-top:6px">Depuis un téléphone (même réseau Wi-Fi), remplacez <code>localhost</code> par ${info.ips.map((ip) => `<code>${esc(ip)}</code>`).join(' ou ')} dans l'adresse.</div>`);
    }
    $('#links').innerHTML = lines.join('');
  }

  /* ---------------- actions ---------------- */
  $('#drawBtn').addEventListener('click', () => act(S && !S.started ? '/api/start' : '/api/draw'));

  $('#players').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    const playerId = Number(b.dataset.id);
    if (b.dataset.act === 'award') act('/api/award', { playerId });
    else act('/api/adjust', { playerId, delta: b.dataset.act === 'minus' ? -1 : 1 });
  });

  function newGame() {
    const started = S.players.some((p) => p.score > 0);
    if (!S.gameOver && started && !confirm('Recommencer une partie ? Les points seront remis à zéro.')) return;
    act('/api/newgame');
  }
  $('#newGame').addEventListener('click', newGame);
  $('#overNew').addEventListener('click', newGame);
})();
