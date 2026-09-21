/* Duo-Master — page joueur (/joueur1 … /joueur6) et écran commun (/ecran) */
(() => {
  const { $, esc } = DM;

  const m = location.pathname.match(/^\/joueur([1-6])$/);
  const me = m ? Number(m[1]) : 0; // 0 = écran commun
  document.title = me ? `Duo-Master · Joueur ${me}` : 'Duo-Master · Écran';
  if (!me) { $('.wrap').classList.add('wide'); $('#board').classList.add('board-xl'); }

  const view = new DM.DrawView($('#draw'));
  let seenEvent; // id du dernier événement déjà notifié (undefined = pas encore d'état reçu)
  let chain = Promise.resolve();

  DM.connect(
    (st) => { chain = chain.then(() => render(st)).catch(console.error); },
    (ok) => { $('#offline').style.display = ok ? 'none' : 'block'; }
  );

  async function render(S) {
    const theme = await DM.getTheme(S);
    view.render(S, theme);
    $('#themeTag').textContent = `${theme.emoji} ${theme.name}${S.round ? ` · tour ${S.round}` : ''}`;

    /* notification des événements (point, retrait…) */
    const ev = S.lastEvent;
    if (seenEvent !== undefined && ev && ev.id !== seenEvent) {
      const t = DM.eventText(ev);
      if (t) DM.toast(t);
    }
    seenEvent = ev ? ev.id : (seenEvent === undefined ? null : seenEvent);

    renderMe(S);
    renderStatus(S);
    renderBoard(S);
  }

  /* --- mes points (en haut) --- */
  function renderMe(S) {
    const card = $('#me');
    if (!me) { card.hidden = true; return; }
    card.hidden = false;
    const p = S.players.find((x) => x.id === me);
    if (!p) {
      card.style.display = 'block';
      card.innerHTML = `<div class="empty-seat">Le joueur ${me} ne participe pas à la partie en cours (${S.players.length} joueurs).</div>`;
      return;
    }
    card.style.display = '';
    card.style.setProperty('--pc', DM.playerColor(me));
    card.innerHTML = `
      <span class="badge">${me}</span>
      <div class="me-info">
        <div class="me-name">${esc(p.name)}${S.winnerId === me ? ' 🏆' : ''}</div>
        ${DM.pips(p.score, S.target)}
      </div>
      <div class="me-score" aria-label="${p.score} points sur ${S.target}">${p.score}<small>/${S.target}</small></div>`;
  }

  /* --- message d'état --- */
  function renderStatus(S) {
    const winner = S.players.find((p) => p.id === S.winnerId);
    const over = $('#over');
    over.hidden = !S.gameOver;
    if (S.gameOver && winner) {
      over.textContent = winner.id === me
        ? `🏆 Victoire ! Bravo ${winner.name} !`
        : `🏆 ${winner.name} remporte la partie !`;
    }

    let status = 'En attente du tirage de l\'arbitre…';
    if (!S.started) status = 'En attente du lancement de la partie par l\'arbitre…';
    else if (S.gameOver) status = '';
    else if (S.phase === 'rolling') status = 'Tirage en cours…';
    else if (S.phase === 'drawn') status = `Tour ${S.round} — à vous de trouver !`;
    else if (S.draw && S.lastEvent && S.lastEvent.type === 'point') status = DM.eventText(S.lastEvent);
    else if (S.draw) status = 'En attente du prochain tirage…';
    $('#status').textContent = status;
  }

  /* --- tableau des scores --- */
  function renderBoard(S) {
    $('#boardTitle').textContent = `Scores — premier à ${S.target}`;
    $('#board').innerHTML = S.players.map((p) => `
      <div class="row${p.id === me ? ' me' : ''}${p.id === S.winnerId ? ' win' : ''}" style="--pc:${DM.playerColor(p.id)}">
        <span class="badge">${p.id}</span>
        <div class="row-main">
          <div class="row-name">${esc(p.name)}</div>
          ${DM.pips(p.score, S.target)}
        </div>
        <div class="row-score">${p.score}<small>/${S.target}</small></div>
      </div>`).join('');
  }
})();
