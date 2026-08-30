const socket = io();

let meta = { bidLabels: {}, config: {} };
let me = { roomId: null, joueurId: null, name: null };
let state = null;
let selection = new Set();      // cards selected for discard / poignée
let chelemToggled = false;

const SUIT_SYMBOL = { C: '♥', D: '♦', P: '♠', T: '♣' };
const RANK_LABEL = { 11: 'V', 12: 'C', 13: 'D', 14: 'R' };
const SUIT_FULLNAME = { C: 'Cœur', D: 'Carreau', P: 'Pique', T: 'Trèfle' };
const IMG_EXT = 'png'; // change to 'jpg' or 'svg' if you use another format in public/images/atouts/

// Traditional Tarot de Marseille major-arcana names & a default symbol shown until a custom
// illustration is dropped in public/images/atouts/ (see the README.md in that folder).
const ATOUT_NAMES = {
  1: 'Le Bateleur', 2: 'La Papesse', 3: "L'Impératrice", 4: "L'Empereur", 5: 'Le Pape',
  6: "L'Amoureux", 7: 'Le Chariot', 8: 'La Justice', 9: "L'Hermite", 10: 'La Roue de Fortune',
  11: 'La Force', 12: 'Le Pendu', 13: 'Arcane sans nom', 14: 'Tempérance', 15: 'Le Diable',
  16: 'La Maison Dieu', 17: "L'Étoile", 18: 'La Lune', 19: 'Le Soleil', 20: 'Le Jugement', 21: 'Le Monde',
};
const ATOUT_SYMBOL = {
  1: '🎩', 2: '📜', 3: '👸', 4: '🤴', 5: '⛪', 6: '💘', 7: '🐎', 8: '⚖️', 9: '🏮', 10: '🎡',
  11: '🦁', 12: '🙃', 13: '💀', 14: '🏺', 15: '😈', 16: '🏚️', 17: '⭐', 18: '🌙', 19: '☀️', 20: '📯', 21: '🌍',
};
const EXCUSE_NAME = "L'Excuse";
const EXCUSE_SYMBOL = '🃏';
const PHASE_LABEL = {
  lobby: 'Salon', bidding: 'Enchères', chien: 'Le chien', calling: 'Appel du roi',
  poignee: 'Avant le jeu', playing: 'En jeu', scoring: 'Résultats', all_passed: 'Personne n\'a parlé',
};

// ---------- helpers ----------
function $(sel) { return document.querySelector(sel); }
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

function cardFace(card) {
  if (card.suit === 'X') return { corner: '🃏', name: EXCUSE_NAME, symbol: EXCUSE_SYMBOL, cls: 'suit-X', img: `/images/atouts/excuse.${IMG_EXT}` };
  if (card.suit === 'A') return { corner: String(card.rank), name: ATOUT_NAMES[card.rank] || '', symbol: ATOUT_SYMBOL[card.rank] || '★', cls: 'suit-A', img: `/images/atouts/atout-${card.rank}.${IMG_EXT}` };
  const s = SUIT_SYMBOL[card.suit];
  const r = RANK_LABEL[card.rank] || String(card.rank);
  return { corner: `${r}<br>${s}`, pip: s, cls: 'suit-' + card.suit };
}

function makeCardEl(card, { back = false } = {}) {
  const c = el('div', 'card' + (back ? ' back' : ''));
  if (!back) {
    const f = cardFace(card);
    c.classList.add(f.cls);
    if (card.suit === 'A' || card.suit === 'X') {
      c.innerHTML = `
        <div class="corner">${f.corner}</div>
        <div class="pip-wrap">
          <div class="pip-emoji">${f.symbol}</div>
          <div class="pip-name">${escapeHtml(f.name)}</div>
        </div>
        <div class="corner bottom">${f.corner}</div>`;
      const img = new Image();
      img.className = 'card-illustration';
      img.alt = f.name;
      img.addEventListener('load', () => c.classList.add('has-illustration'));
      img.addEventListener('error', () => img.remove());
      img.src = f.img;
      c.insertBefore(img, c.firstChild);
    } else {
      c.innerHTML = `<div class="corner">${f.corner}</div><div class="pip">${f.pip}</div><div class="corner bottom">${f.corner}</div>`;
    }
  }
  c.dataset.id = card ? card.id : '';
  return c;
}

// ---------- socket meta ----------
socket.on('meta', (m) => { meta = m; });

socket.on('errorMsg', (msg) => showToast(msg));

socket.on('joined', ({ roomId, joueurId }) => {
  me.roomId = roomId; me.joueurId = joueurId;
  localStorage.setItem('tarot_room', roomId);
  localStorage.setItem('tarot_joueur', joueurId);
});

socket.on('state', (s) => {
  state = s;
  selection.clear();
  render();
});

socket.on('connect', () => {
  const r = localStorage.getItem('tarot_room');
  const p = localStorage.getItem('tarot_joueur');
  if (r && p) socket.emit('reconnectRoom', { roomId: r, joueurId: p });
});

// ---------- menu ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});
document.querySelectorAll('#joueur-count-seg button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#joueur-count-seg button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
});
$('#btn-create').addEventListener('click', () => {
  const name = $('#create-name').value.trim() || 'Joueur';
  const nombreJoueurs = document.querySelector('#joueur-count-seg button.active').dataset.val;
  me.name = name;
  socket.emit('createRoom', { name, nombreJoueurs });
});
$('#btn-join').addEventListener('click', () => {
  const name = $('#join-name').value.trim() || 'Joueur';
  const roomId = $('#join-code').value.trim();
  if (!roomId) { $('#menu-error').textContent = 'Entrez un code de salon.'; return; }
  me.name = name;
  socket.emit('joinRoom', { name, roomId });
});

$('#btn-start').addEventListener('click', () => socket.emit('startHand'));

// ---------- scoreboard drawer ----------
$('#btn-scoreboard').addEventListener('click', () => $('#scoreboard-drawer').classList.add('open'));
$('#close-scoreboard').addEventListener('click', () => $('#scoreboard-drawer').classList.remove('open'));

$('#btn-next-hand').addEventListener('click', () => {
  $('#result-modal').classList.add('hidden');
  socket.emit('nextHand');
});

// ---------- main render ----------
function render() {
  if (!state) return;
  if (state.phase === 'lobby') { renderLobby(); showScreen('#screen-lobby'); return; }
  showScreen('#screen-game');
  renderTop();
  renderSeats();
  renderTrick();
  renderBanner();
  renderScoreboard();
  renderActions();
  renderHand();
  if (state.phase === 'scoring') renderResult(); else $('#result-modal').classList.add('hidden');
  if (state.phase === 'all_passed') {
    $('#banner').textContent = 'Tout le monde a passé — nouvelle distribution.';
  }
}

function renderLobby() {
  $('#lobby-code').textContent = state.roomId;
  const ul = $('#lobby-joueurs'); ul.innerHTML = '';
  for (let i = 0; i < state.maxJoueurs; i++) {
    const p = state.joueurs[i];
    const li = el('li');
    if (p) {
      li.innerHTML = `<span class="dot"></span> ${escapeHtml(p.name)}${p.isAI ? ' <span class="ai-badge">IA</span>' : ''}${p.id === me.joueurId ? ' (vous)' : ''}`;
      if (p.isAI) {
        li.classList.add('clickable');
        li.title = 'Cliquer pour retirer cette IA';
        li.addEventListener('click', () => socket.emit('removeAI', { aiId: p.id }));
      }
    } else {
      li.innerHTML = '<span class="dot" style="opacity:.3"></span> Cliquer pour ajouter une IA 🤖';
      li.className = 'empty clickable';
      li.addEventListener('click', () => socket.emit('addAI'));
    }
    ul.appendChild(li);
  }
  const btn = $('#btn-start');
  const ready = state.joueurs.length === state.maxJoueurs;
  btn.disabled = !ready;
  btn.textContent = ready ? 'Distribuer les cartes' : `En attente de joueurs (${state.joueurs.length}/${state.maxJoueurs})…`;

  document.querySelectorAll('#ai-diff-seg button').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === (state.aiDifficulty || 'confirme'));
  });
}

document.querySelectorAll('#ai-diff-seg button').forEach((b) => {
  b.addEventListener('click', () => socket.emit('setAIDifficulty', { level: b.dataset.val }));
});

function renderTop() {
  $('#game-room-tag').textContent = state.roomId;
  $('#phase-tag').textContent = PHASE_LABEL[state.phase] || state.phase;
}

function myIndex() { return state.joueurs.findIndex((p) => p.id === me.joueurId); }

function renderSeats() {
  const container = $('#seats');
  container.innerHTML = '';
  const n = state.maxJoueurs;
  const mySeat = myIndex();
  const rx = 42, ry = 36;
  state.joueurs.forEach((p, idx) => {
    const rel = (idx - mySeat + n) % n;
    const angle = 90 + rel * (360 / n);
    const rad = (angle * Math.PI) / 180;
    const x = 50 + rx * Math.cos(rad);
    const y = 50 + ry * Math.sin(rad);
    const seat = el('div', 'seat');
    seat.style.left = x + '%';
    seat.style.top = y + '%';
    const isTurn = (state.turnIndex !== undefined && state.turnIndex === idx && state.phase === 'playing')
      || (state.phase === 'bidding' && state.currentBidder === p.id);
    if (isTurn) seat.classList.add('turn');
    if (state.taker === p.id) seat.classList.add('taker');
    if (state.partnerId === p.id) seat.classList.add('partner');
    if (!p.connected) seat.classList.add('seat-disconnected');

    const avatar = el('div', 'seat-avatar', p.isAI ? '🤖' : '🧑');
    if (state.taker === p.id) avatar.appendChild(el('span', 'crown-badge', '♛'));
    if (state.partnerId === p.id) avatar.appendChild(el('span', 'partner-badge', '♦'));
    seat.appendChild(avatar);

    const nameEl = el('div', 'seat-name', escapeHtml(p.name) + (p.id === me.joueurId ? ' <span class="you-tag">(vous)</span>' : ''));
    seat.appendChild(nameEl);

    const cardsRow = el('div', 'seat-cards');
    const count = state.handCounts ? (state.handCounts[p.id] || 0) : 0;
    const shown = Math.min(count, 8);
    for (let i = 0; i < shown; i++) cardsRow.appendChild(el('div', 'mini-card'));
    seat.appendChild(cardsRow);
    container.appendChild(seat);
  });
}

function renderTrick() {
  const zone = $('#trick-zone');
  zone.innerHTML = '';
  if (!state.currentTrick) return;
  const n = state.maxJoueurs;
  const mySeat = myIndex();
  const rx = 25, ry = 22;
  state.currentTrick.forEach((t) => {
    const idx = state.joueurs.findIndex((p) => p.id === t.joueurId);
    const rel = (idx - mySeat + n) % n;
    const angle = 90 + rel * (360 / n);
    const rad = (angle * Math.PI) / 180;
    const x = 50 + rx * Math.cos(rad);
    const y = 50 + ry * Math.sin(rad);
    const jitter = ((idx * 37) % 17) - 8; // small deterministic rotation per joueur, not random each render
    const wrap = el('div', 'trick-card');
    wrap.style.left = x + '%';
    wrap.style.top = y + '%';
    wrap.style.setProperty('--rot', jitter + 'deg');
    wrap.appendChild(makeCardEl(t.card));
    zone.appendChild(wrap);
  });
}

function labelOf(id) {
  const p = state.joueurs.find((p) => p.id === id);
  return p ? p.name : '???';
}

function renderBanner() {
  const b = $('#banner');
  let msg = '';
  switch (state.phase) {
    case 'bidding':
      msg = state.currentBidder === me.joueurId ? 'À vous d\'enchérir' : `${labelOf(state.currentBidder)} enchérit…`;
      break;
    case 'chien':
      msg = state.taker === me.joueurId ? 'Choisissez les cartes à écarter dans le chien' : `${labelOf(state.taker)} compose son écart…`;
      break;
    case 'calling':
      msg = state.taker === me.joueurId ? 'Appelez un roi pour former votre équipe' : `${labelOf(state.taker)} appelle un roi…`;
      break;
    case 'poignee':
      msg = 'Déclarez une poignée ou annoncez le chelem, puis confirmez que vous êtes prêt';
      break;
    case 'playing':
      msg = state.joueurs[state.turnIndex] && state.joueurs[state.turnIndex].id === me.joueurId ? 'À vous de jouer' : `${labelOf(state.joueurs[state.turnIndex] && state.joueurs[state.turnIndex].id)} joue…`;
      break;
    case 'scoring':
      msg = 'Manche terminée';
      break;
    default: msg = '';
  }
  b.textContent = msg;
}

function renderScoreboard() {
  const c = $('#scoreboard-content');
  c.innerHTML = '';
  state.joueurs.forEach((p) => {
    const row = el('div', 'score-row');
    const sc = Math.round((state.scores[p.id] || 0) * 10) / 10;
    row.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${sc}</span>`;
    c.appendChild(row);
  });
}

// ---------- action panel ----------
function renderActions() {
  const panel = $('#action-panel');
  panel.innerHTML = '';

  if (state.phase === 'bidding') {
    if (state.currentBidder !== me.joueurId) { panel.appendChild(el('div', 'hint', `En attente de ${escapeHtml(labelOf(state.currentBidder))}…`)); return; }
    const curIdx = state.currentBid ? Object.keys(meta.bidLabels).indexOf ? null : null : null;
    const order = ['petite', 'garde', 'garde_sans', 'garde_contre'];
    const curLevel = state.currentBid ? state.currentBid.level : null;
    const curIndex = curLevel ? order.indexOf(curLevel) : -1;
    order.forEach((lvl, i) => {
      const btn = el('button', '', meta.bidLabels[lvl] || lvl);
      btn.disabled = i <= curIndex;
      btn.addEventListener('click', () => socket.emit('bid', { level: lvl }));
      panel.appendChild(btn);
    });
    const pass = el('button', 'danger', 'Passe');
    pass.addEventListener('click', () => socket.emit('bid', { level: 'passe' }));
    panel.appendChild(pass);
    return;
  }

  if (state.phase === 'all_passed') {
    const btn = el('button', 'primary', 'Redistribuer');
    btn.addEventListener('click', () => socket.emit('redeal'));
    panel.appendChild(btn);
    return;
  }

  if (state.phase === 'chien') {
    if (state.taker !== me.joueurId) { panel.appendChild(el('div', 'hint', `${escapeHtml(labelOf(state.taker))} compose son écart…`)); return; }
    const cfg = meta.config[state.maxJoueurs];
    const need = cfg ? cfg.chien : 6;
    panel.appendChild(el('div', 'hint', `Sélectionnez ${need} carte(s) dans votre main à écarter (ni bout, ni roi si possible), puis validez.`));
    const btn = el('button', 'primary', `Écarter (${selection.size}/${need})`);
    btn.disabled = selection.size !== need;
    btn.addEventListener('click', () => {
      socket.emit('discardChien', { cardIds: [...selection] });
      selection.clear();
    });
    panel.appendChild(btn);
    return;
  }

  if (state.phase === 'calling') {
    if (state.taker !== me.joueurId) { panel.appendChild(el('div', 'hint', `${escapeHtml(labelOf(state.taker))} appelle un roi…`)); return; }
    panel.appendChild(el('div', 'hint', 'Appelez le roi de la couleur de votre partenaire secret :'));
    ['C', 'D', 'P', 'T'].forEach((s) => {
      const holds = (state.yourHand || []).some((c) => c.suit === s && c.rank === 14);
      const btn = el('button', '', `Roi de ${SUIT_FULLNAME[s]} ${SUIT_SYMBOL[s]}`);
      btn.disabled = holds;
      btn.addEventListener('click', () => socket.emit('callKing', { suit: s }));
      panel.appendChild(btn);
    });
    return;
  }

  if (state.phase === 'poignee') {
    const cfg = meta.config[state.maxJoueurs];
    const trumps = (state.yourHand || []).filter((c) => c.suit === 'A' || c.suit === 'X');
    const already = state.poignees.find((p) => p.joueurId === me.joueurId);
    if (!already && cfg) {
      panel.appendChild(el('div', 'hint', `Vous avez ${trumps.length} atout(s). Sélectionnez-en ${cfg.poignee.simple}, ${cfg.poignee.double} ou ${cfg.poignee.triple} pour déclarer une poignée.`));
      const btn = el('button', '', `Déclarer une poignée (${selection.size})`);
      const valid = [cfg.poignee.simple, cfg.poignee.double, cfg.poignee.triple].includes(selection.size);
      btn.disabled = !valid;
      btn.addEventListener('click', () => {
        socket.emit('declarePoignee', { cardIds: [...selection] });
        selection.clear();
      });
      panel.appendChild(btn);
    } else if (already) {
      panel.appendChild(el('div', 'hint', `Poignée ${already.type} déclarée (${already.count} atouts).`));
    }
    if (state.taker === me.joueurId && !state.chelemAnnonce) {
      const btn = el('button', chelemToggled ? 'primary' : '', 'Annoncer le Chelem');
      btn.addEventListener('click', () => { socket.emit('announceChelem'); });
      panel.appendChild(btn);
    }
    if (state.chelemAnnonce) panel.appendChild(el('div', 'hint', '⚑ Chelem annoncé par le preneur.'));
    const readyBtn = el('button', 'primary', `Prêt à jouer (${state.readyCount}/${state.joueurs.length})`);
    readyBtn.addEventListener('click', () => socket.emit('confirmReady'));
    panel.appendChild(readyBtn);
    return;
  }

  if (state.phase === 'playing') {
    const isMyTurn = state.joueurs[state.turnIndex] && state.joueurs[state.turnIndex].id === me.joueurId;
    panel.appendChild(el('div', 'hint', `Plis joués : ${state.tricksPlayed}/${state.totalTricks}` + (isMyTurn ? ' — cliquez une carte de votre main pour la jouer' : '')));
    return;
  }
}

// ---------- hand ----------
function renderHand() {
  const handEl = $('#hand');
  handEl.innerHTML = '';
  const cards = state.yourHand || [];
  const isChienPhase = state.phase === 'chien' && state.taker === me.joueurId;
  const isPoigneePhase = state.phase === 'poignee';
  const isPlayPhase = state.phase === 'playing';
  const isMyTurn = isPlayPhase && state.joueurs[state.turnIndex] && state.joueurs[state.turnIndex].id === me.joueurId;
  const legalSet = new Set(state.legalMoves || []);

  cards.forEach((card) => {
    const c = makeCardEl(card);
    if (isChienPhase || (isPoigneePhase && (card.suit === 'A' || card.suit === 'X'))) {
      if (selection.has(card.id)) c.classList.add('selected');
      c.addEventListener('click', () => {
        if (selection.has(card.id)) selection.delete(card.id); else selection.add(card.id);
        renderHand(); renderActions();
      });
    } else if (isPlayPhase) {
      if (isMyTurn && legalSet.has(card.id)) {
        c.classList.add('legal');
        c.addEventListener('click', () => socket.emit('playCard', { cardId: card.id }));
      } else {
        c.classList.add('illegal');
      }
    }
    handEl.appendChild(c);
  });
}

// ---------- result modal ----------
function renderResult() {
  const r = state.lastResult;
  if (!r) return;
  $('#result-title').textContent = `${labelOf(r.taker)} — ${meta.bidLabels[r.bidLevel] || r.bidLevel}`;
  const body = $('#result-body');
  const rows = [];
  rows.push(row('Points attaque', `${r.attackPoints} / ${r.need} requis`));
  rows.push(row('Bouts détenus', r.nbBouts));
  rows.push(row('Contrat', r.success ? 'Réussi' : 'Chuté', r.success ? 'pos' : 'neg'));
  rows.push(row('Points du contrat', Math.round(r.contractPoints)));
  if (r.poigneeAttack) rows.push(row('Poignée(s) attaque', '+' + r.poigneeAttack));
  if (r.poigneeDefense) rows.push(row('Poignée(s) défense', '+' + r.poigneeDefense));
  if (r.chelemBonus) rows.push(row('Chelem', (r.chelemBonus > 0 ? '+' : '') + r.chelemBonus, r.chelemBonus > 0 ? 'pos' : 'neg'));
  if (r.petitBonus) rows.push(row('Petit au bout', (r.petitBonus > 0 ? '+' : '') + r.petitBonus, r.petitBonus > 0 ? 'pos' : 'neg'));
  rows.push('<hr style="border-color:var(--line); margin:10px 0;">');
  state.joueurs.forEach((p) => {
    const d = Math.round((r.delta[p.id] || 0) * 10) / 10;
    rows.push(row(escapeHtml(p.name), (d >= 0 ? '+' : '') + d, d >= 0 ? 'pos' : 'neg'));
  });
  body.innerHTML = rows.join('');
  $('#result-modal').classList.remove('hidden');
}
function row(label, val, cls) { return `<div class="row"><span>${label}</span><span class="${cls || ''}">${val}</span></div>`; }

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
