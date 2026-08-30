'use strict';

const socket = io();

let ALL_CARDS = [];
let OPPONENTS = [];
let CARD_BY_ID = new Map();
let CARD_INDEX = new Map(); // cardId -> position dans cards*.json (ordre "numéro")
let ELEMENT_BY_NAME = new Map(); // nom d'élément -> { name, icon, image }
let LEGENDARY_HOLDERS = new Map(); // cardId -> { tier, opponentIndex, opponentName } | null
let SHOP_BUY_TIERS = {}; // clé -> { cost, minLevel, maxLevel, label }
let AVAILABLE_SETS = []; // [{ id, label, includes }]
let TOURNAMENT_TIERS = []; // [{ id, label, cost, opponentTierRange, rewardScale }]
const SELL_PRICE_BY_LEVEL = { 1: 50, 2: 75, 3: 100, 4: 125, 5: 150, 6: 175, 7: 200 };

let state = {
  activeSet: null,      // set actuellement sélectionné (ex: 'ffviii')
  mode: null,            // 'solo' | 'pvp' | 'tournament'
  playerName: '',
  save: null,
  pendingTarget: null,   // 'solo' | 'pvp' | 'encyclopedia' | 'shop' | 'tournament' — où aller une fois connecté
  selectedTier: null,
  selectedOpponentIdx: null,
  selectedDeck: [],      // tableau de cardId (doublons autorisés), max 5
  pvpDeck: [],
  tournamentDeck: [],
  selectedTournamentTier: null,
  roomCode: null,
  myOwner: null,         // 'A' en solo/tournoi toujours; en pvp dépend
  lastSoloConfig: null,  // pour "Rejouer"
};

// ---------------- Navigation ----------------
// ================= AUDIO (musiques d'ambiance + bruit de bouton) =================
// Placez vos fichiers dans public/audio/ avec ces noms exacts :
//   Menu_TT.mp3   -> musique du menu principal et des écrans hors-duel
//   Duel_TT.mp3   -> musique jouée pendant un affrontement (Solo/PvP/Tournoi)
//   Bouton_TT.mp3 -> bruit joué à chaque clic sur un bouton
const musicTracks = {
  menu: new Audio('/audio/Menu_TT.mp3'),
  duel: new Audio('/audio/Duel_TT.mp3'),
};
musicTracks.menu.loop = true;
musicTracks.duel.loop = true;
musicTracks.menu.volume = 0.5;
musicTracks.duel.volume = 0.5;

const buttonSound = new Audio('/audio/Bouton_TT.mp3');
buttonSound.volume = 0.6;

let audioUnlocked = false;
let musicMuted = localStorage.getItem('musicMuted') === 'true';
let currentTrackKey = null; // 'menu' | 'duel' | null
let desiredTrackKey = 'menu';

function updateAudioToggleUI() {
  const btn = document.getElementById('audioToggleBtn');
  btn.textContent = musicMuted ? '🔇' : '🔊';
  btn.classList.toggle('muted', musicMuted);
}

function playTrack(key) {
  desiredTrackKey = key;
  if (currentTrackKey === key) return;
  if (currentTrackKey && musicTracks[currentTrackKey]) {
    musicTracks[currentTrackKey].pause();
    musicTracks[currentTrackKey].currentTime = 0;
  }
  currentTrackKey = key;
  if (musicMuted || !audioUnlocked) return;
  const el = musicTracks[key];
  el.currentTime = 0;
  el.play().catch(() => { /* lecture auto refusée par le navigateur, débloquée au prochain clic */ });
}

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (!musicMuted) {
    const el = musicTracks[desiredTrackKey];
    el.play().catch(() => {});
  }
}

document.getElementById('audioToggleBtn').addEventListener('click', () => {
  musicMuted = !musicMuted;
  localStorage.setItem('musicMuted', String(musicMuted));
  updateAudioToggleUI();
  if (musicMuted) {
    Object.values(musicTracks).forEach(t => t.pause());
  } else if (audioUnlocked) {
    musicTracks[desiredTrackKey].play().catch(() => {});
  }
});
updateAudioToggleUI();

// Bruit de clic sur n'importe quel bouton, et déblocage de l'audio au premier geste utilisateur.
document.addEventListener('click', (e) => {
  unlockAudioOnce();
  if (e.target.closest('button')) {
    try {
      buttonSound.currentTime = 0;
      buttonSound.play().catch(() => {});
    } catch { /* ignore */ }
  }
});

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.body.classList.toggle('in-game', name === 'game');
  playTrack(name === 'game' ? 'duel' : 'menu');
  if (name === 'home') return;
  document.getElementById('view-' + name).classList.remove('hidden');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-view]');
  if (btn) showView(btn.dataset.view);
});

// ---- Boutons-toggle de règles (remplacent les cases à cocher) ----
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.rule-toggle');
  if (btn) btn.classList.toggle('selected');
});

function readRuleToggles(containerId) {
  const container = document.getElementById(containerId);
  const rules = { same: false, plus: false, combo: false, elemental: false, wallAce: false, suddenDeath: false, open: false, random: false };
  container.querySelectorAll('.rule-toggle.selected').forEach(btn => {
    rules[btn.dataset.rule] = true;
  });
  return rules;
}

function setRuleToggles(containerId, rules) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.rule-toggle').forEach(btn => {
    btn.classList.toggle('selected', !!(rules && rules[btn.dataset.rule]));
  });
}

// ================= UNIVERS (sets) =================

async function bootstrap() {
  AVAILABLE_SETS = await (await fetch('/api/sets')).json();
  const tiers = await (await fetch('/api/tournament/tiers')).json();
  TOURNAMENT_TIERS = tiers;

  const remembered = localStorage.getItem('activeSet');
  if (remembered && AVAILABLE_SETS.some(s => s.id === remembered)) {
    await selectSet(remembered);
  } else {
    buildSetSelectScreen();
    showView('setSelect');
  }
}

function buildSetSelectScreen() {
  const grid = document.getElementById('setSelectGrid');
  grid.innerHTML = '';
  AVAILABLE_SETS.forEach(setDef => {
    const b = document.createElement('button');
    b.textContent = setDef.label;
    b.addEventListener('click', () => selectSet(setDef.id));
    grid.appendChild(b);
  });
}

let staticDataReady = Promise.resolve();

async function loadStaticData(setId) {
  ALL_CARDS = await (await fetch(`/api/${setId}/cards`)).json();
  OPPONENTS = await (await fetch(`/api/${setId}/opponents`)).json();
  const elements = await (await fetch('/api/elements')).json();
  const legendaryHolders = await (await fetch(`/api/${setId}/legendary-holders`)).json();
  SHOP_BUY_TIERS = await (await fetch('/api/shop/tiers')).json();
  CARD_BY_ID = new Map(ALL_CARDS.map(c => [c.id, c]));
  CARD_INDEX = new Map(ALL_CARDS.map((c, i) => [c.id, i]));
  ELEMENT_BY_NAME = new Map(elements.map(e => [e.name, e]));
  LEGENDARY_HOLDERS = new Map(Object.entries(legendaryHolders));
}

async function selectSet(setId) {
  state.activeSet = setId;
  localStorage.setItem('activeSet', setId);
  staticDataReady = loadStaticData(setId);
  await staticDataReady;
  const setDef = AVAILABLE_SETS.find(s => s.id === setId);
  document.getElementById('activeSetLabel').textContent = setDef ? setDef.label : setId;
  document.getElementById('setBar').classList.remove('hidden');
  showView('home');
}

document.getElementById('changeSetBtn').addEventListener('click', () => {
  deactivateSession();
  state.activeSet = null;
  localStorage.removeItem('activeSet');
  document.getElementById('setBar').classList.add('hidden');
  buildSetSelectScreen();
  showView('setSelect');
});

bootstrap();

/** Rend le petit marqueur visuel d'un élément (image personnalisée si fournie, sinon emoji). */
function elementIconHTML(elementName, extraClass) {
  const def = ELEMENT_BY_NAME.get(elementName);
  if (!def) return '';
  const inner = def.image
    ? `<img src="/${def.image}" alt="${def.name}" title="${def.name}">`
    : `<span title="${def.name}">${def.icon || '?'}</span>`;
  return `<div class="${extraClass || 'element-tag'}">${inner}</div>`;
}

/** Trie des cardId par niveau puis par ordre d'apparition dans cards*.json ("numéro"). */
function sortCardIdsByLevelAndNumber(ids) {
  return [...ids].sort((a, b) => {
    const da = CARD_BY_ID.get(a), db = CARD_BY_ID.get(b);
    if (!da || !db) return 0;
    return (da.level - db.level) || (CARD_INDEX.get(a) - CARD_INDEX.get(b));
  });
}

// ---------------- Rendu d'une carte ----------------
function cardTileHTML(card, badges, nameClass) {
  const top = card.top, right = card.right, bottom = card.bottom, left = card.left;
  const def = CARD_BY_ID.get(card.cardId || card.id);
  const name = card.name || def?.name || card.cardId || card.id;
  const imagePath = card.image || def?.image || null;

  const imageHTML = imagePath
    ? `<img class="card-art" src="/${imagePath}" alt="${name}" onerror="this.style.display='none'; this.parentElement.classList.add('no-art'); this.parentElement.querySelector('.stats')?.classList.remove('hidden-stats');">`
    : '';

  const badgesHTML = badges || '';

  // Si une image est fournie, on suppose que les valeurs sont déjà visibles dessus (scan de carte) :
  // on masque alors la surcouche de chiffres pour ne pas les dupliquer au centre.
  const statsClass = imagePath ? 'stats hidden-stats' : 'stats';

  return `
    ${imageHTML}
    ${badgesHTML}
    <span class="name${nameClass ? ' ' + nameClass : ''}">${name}</span>
    <div class="${statsClass}">
      <div class="s-top">${top}</div>
      <div class="s-left">${left}</div>
      <div class="s-right">${right}</div>
      <div class="s-bottom">${bottom}</div>
    </div>
  `;
}

/** Regroupe un tableau de cardId en Map(cardId -> count) */
function groupCounts(cardIds) {
  const map = new Map();
  cardIds.forEach(id => map.set(id, (map.get(id) || 0) + 1));
  return map;
}

// ================= SESSION (commune à Solo / PvP / Encyclopédie / Commerce / Tournoi) =================

function activateSession(save) {
  state.save = save;
  state.playerName = save.name;
  document.getElementById('sessionPlayerName').textContent = save.name;
  document.getElementById('sessionPoints').textContent = save.points ?? 0;
  document.getElementById('sessionBar').classList.remove('hidden');
}

function updateSessionBarPoints() {
  document.getElementById('sessionPoints').textContent = state.save?.points ?? 0;
}

function deactivateSession() {
  state.save = null;
  state.playerName = '';
  document.getElementById('sessionBar').classList.add('hidden');
  showView('home');
}

document.getElementById('logoutBtn').addEventListener('click', deactivateSession);

document.getElementById('downloadSaveBtn').addEventListener('click', async () => {
  try {
    // récupère toujours la version la plus fraîche avant de télécharger, pour ne jamais exporter
    // une progression périmée (ex: après un gain de carte non encore reflété localement)
    const save = await refreshSave();
    const content = JSON.stringify(save, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.playerName}_${state.activeSet}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Impossible de télécharger la sauvegarde : ' + err.message);
  }
});

async function refreshSave() {
  const save = await (await fetch(`/api/${state.activeSet}/save/` + encodeURIComponent(state.playerName))).json();
  state.save = save;
  return save;
}

function goToFeature(target) {
  state.pendingTarget = target;
  if (state.save) enterFeature(target);
  else showView('login');
}

async function enterFeature(target) {
  await staticDataReady;
  if (target === 'solo') {
    document.getElementById('soloPlayerName').textContent = state.playerName;
    buildTierList();
    buildDeckPicker();
    updateLowCardsPanel();
    showView('soloSetup');
  } else if (target === 'pvp') {
    document.getElementById('pvpPlayerName').textContent = state.playerName;
    buildPvpDeckPicker();
    showView('pvpMenu');
  } else if (target === 'encyclopedia') {
    await refreshSave();
    document.getElementById('encyclopediaPlayerName').textContent = state.playerName;
    buildEncyclopedia(state.save);
    showView('encyclopedia');
  } else if (target === 'shop') {
    document.getElementById('shopPlayerName').textContent = state.playerName;
    document.getElementById('shopPoints').textContent = state.save.points ?? 0;
    buildShopBuyGrid();
    buildShopSellGrid();
    switchShopTab('buysell');
    showView('shop');
  } else if (target === 'tournament') {
    await refreshSave();
    document.getElementById('tournamentPlayerName').textContent = state.playerName;
    buildTournamentView();
    showView('tournamentEntry');
  }
}

document.getElementById('navHowTo').addEventListener('click', () => showView('howto'));
document.getElementById('navSolo').addEventListener('click', () => goToFeature('solo'));
document.getElementById('navPvp').addEventListener('click', () => goToFeature('pvp'));
document.getElementById('navEncyclopedia').addEventListener('click', () => goToFeature('encyclopedia'));
document.getElementById('navShop').addEventListener('click', () => goToFeature('shop'));
document.getElementById('navTournament').addEventListener('click', () => goToFeature('tournament'));

// ---- Écran de connexion ----
document.getElementById('loginLoadBtn').addEventListener('click', async () => {
  const name = document.getElementById('loginNameInput').value.trim();
  if (!name) return alert('Entrez un nom.');
  await staticDataReady;
  const save = await (await fetch(`/api/${state.activeSet}/save/` + encodeURIComponent(name))).json();
  activateSession(save);
  enterFeature(state.pendingTarget || 'solo');
});

document.getElementById('importSaveFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await staticDataReady;
    const text = await file.text();
    const data = JSON.parse(text);
    const res = await fetch(`/api/${state.activeSet}/save/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Fichier invalide.');
    }
    const save = await res.json();
    activateSession(save);
    enterFeature(state.pendingTarget || 'solo');
  } catch (err) {
    alert('Impossible d\'importer ce fichier : ' + err.message);
  } finally {
    e.target.value = '';
  }
});

// ---- Panneau "peu de cartes" (reset / abandon) ----
function updateLowCardsPanel() {
  const panel = document.getElementById('lowCardsPanel');
  const count = state.save?.collection?.length ?? 0;
  if (count <= 4) {
    document.getElementById('lowCardsCount').textContent = count;
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }
}

document.getElementById('resetSaveBtn').addEventListener('click', async () => {
  if (!confirm('Remettre votre collection à zéro avec le deck de départ ? Cette action est irréversible.')) return;
  const save = await (await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/reset`, { method: 'POST' })).json();
  state.save = save;
  buildDeckPicker();
  updateLowCardsPanel();
});

document.getElementById('abandonSaveBtn').addEventListener('click', async () => {
  if (!confirm('Supprimer définitivement cette sauvegarde ? Cette action est irréversible.')) return;
  await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}`, { method: 'DELETE' });
  deactivateSession();
});

// ================= SÉLECTEUR DE DECK GÉNÉRIQUE (Solo + PvP + Tournoi, basé sur la collection) =================
/**
 * Construit un sélecteur de deck en regroupant les cartes identiques sous une seule tuile,
 * avec des boutons +/- pour choisir combien en emporter (max 5 au total).
 */
function buildGroupedDeckPicker({ containerId, countElId, stateKey, onChange }) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  state[stateKey] = [];
  document.getElementById(countElId).textContent = 0;

  const counts = groupCounts(state.save.collection);
  const uniqueIds = sortCardIdsByLevelAndNumber([...counts.keys()].filter(id => CARD_BY_ID.has(id)));

  const refreshers = [];
  function refreshAll() { refreshers.forEach(fn => fn()); }

  uniqueIds.forEach(cardId => {
    const def = CARD_BY_ID.get(cardId);
    const owned = counts.get(cardId);

    const item = document.createElement('div');
    item.className = 'deck-picker-item';

    const tile = document.createElement('div');
    tile.className = 'card-tile';

    const qtyControl = document.createElement('div');
    qtyControl.className = 'qty-control';
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.textContent = '−';
    const qtyValue = document.createElement('span');
    qtyValue.className = 'qty-value';
    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.textContent = '+';
    qtyControl.append(minusBtn, qtyValue, plusBtn);

    function refresh() {
      const selected = state[stateKey].filter(id => id === cardId).length;
      tile.classList.toggle('selected', selected > 0);
      const badges = owned > 1 ? `<span class="badge badge-owned">x${owned}</span>` : '';
      tile.innerHTML = cardTileHTML(def, badges);
      qtyValue.textContent = `${selected}/${owned}`;
      minusBtn.disabled = selected <= 0;
      plusBtn.disabled = selected >= owned || state[stateKey].length >= 5;
      document.getElementById(countElId).textContent = state[stateKey].length;
      if (onChange) onChange();
    }
    refreshers.push(refresh);

    minusBtn.addEventListener('click', () => {
      const idx = state[stateKey].indexOf(cardId);
      if (idx !== -1) state[stateKey].splice(idx, 1);
      refreshAll();
    });
    plusBtn.addEventListener('click', () => {
      const selected = state[stateKey].filter(id => id === cardId).length;
      if (selected >= owned || state[stateKey].length >= 5) return;
      state[stateKey].push(cardId);
      refreshAll();
    });

    refresh();
    item.append(tile, qtyControl);
    container.appendChild(item);
  });
}

// ================= SOLO =================

function buildTierList() {
  const container = document.getElementById('tierList');
  container.innerHTML = '';
  OPPONENTS.forEach(tierData => {
    const b = document.createElement('button');
    b.textContent = tierData.label;
    b.addEventListener('click', () => {
      state.selectedTier = tierData.tier;
      state.selectedOpponentIdx = null;
      [...container.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      buildOpponentList(tierData);
    });
    container.appendChild(b);
  });
}

function buildOpponentList(tierData) {
  const container = document.getElementById('opponentList');
  container.innerHTML = '';
  document.getElementById('imposedRulesNote').classList.add('hidden');
  document.getElementById('ruleToggles').classList.remove('rules-locked');
  const tradeSelect = document.getElementById('tradeRuleSelect');
  tradeSelect.classList.remove('rules-locked');
  tradeSelect.disabled = false;
  tierData.opponents.forEach((opp, idx) => {
    const b = document.createElement('button');
    b.textContent = opp.name;
    b.addEventListener('click', () => {
      state.selectedOpponentIdx = idx;
      [...container.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      applyImposedRulesUI(opp);
      updateStartButton();
    });
    container.appendChild(b);
  });
}

/**
 * Si l'adversaire sélectionné impose ses propres règles (voir data/opponents*.json,
 * "imposedRules"/"imposedTradeRule"), on les affiche pré-sélectionnées et on verrouille les
 * contrôles (le serveur les imposerait de toute façon, ceci n'est qu'un reflet visuel honnête).
 */
function applyImposedRulesUI(opponent) {
  const note = document.getElementById('imposedRulesNote');
  const toggles = document.getElementById('ruleToggles');
  const tradeSelect = document.getElementById('tradeRuleSelect');
  const imposed = !!(opponent.imposedRules || opponent.imposedTradeRule);

  note.classList.toggle('hidden', !imposed);
  toggles.classList.toggle('rules-locked', imposed);
  tradeSelect.classList.toggle('rules-locked', imposed);
  tradeSelect.disabled = imposed;

  if (imposed) {
    setRuleToggles('ruleToggles', opponent.imposedRules || {});
    if (opponent.imposedTradeRule) tradeSelect.value = opponent.imposedTradeRule;
  }
}

function buildDeckPicker() {
  buildGroupedDeckPicker({ containerId: 'deckPicker', countElId: 'deckCount', stateKey: 'selectedDeck', onChange: updateStartButton });
}

function updateStartButton() {
  const ok = state.selectedTier !== null && state.selectedOpponentIdx !== null && state.selectedDeck.length === 5;
  document.getElementById('startSoloBtn').disabled = !ok;
}

function startSoloDuel(config) {
  state.mode = 'solo';
  state.myOwner = 'A';
  state.lastSoloConfig = config;
  gameEnded = false;
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  socket.emit('solo:start', config);
}

document.getElementById('startSoloBtn').addEventListener('click', () => {
  const rules = readRuleToggles('ruleToggles');
  const tradeRule = document.getElementById('tradeRuleSelect').value;
  startSoloDuel({
    set: state.activeSet,
    name: state.playerName,
    tier: state.selectedTier,
    opponentIndex: state.selectedOpponentIdx,
    rules,
    tradeRule,
    deckCardIds: state.selectedDeck,
  });
});

// ---- Rejouer / Autre adversaire (fin de partie solo) ----
document.getElementById('rematchBtn').addEventListener('click', async () => {
  if (!state.lastSoloConfig) return;
  const cfg = state.lastSoloConfig;
  await refreshSave();
  document.getElementById('soloPlayerName').textContent = state.playerName;
  buildTierList();
  buildDeckPicker();
  updateLowCardsPanel();
  showView('soloSetup');

  const tierBtn = [...document.getElementById('tierList').children].find((_, i) => OPPONENTS[i]?.tier === cfg.tier);
  if (tierBtn) tierBtn.click();
  const oppBtn = [...document.getElementById('opponentList').children][cfg.opponentIndex];
  if (oppBtn) oppBtn.click();

  setRuleToggles('ruleToggles', cfg.rules);
  document.getElementById('tradeRuleSelect').value = cfg.tradeRule;
  updateStartButton();
});

document.getElementById('otherOpponentBtn').addEventListener('click', async () => {
  await refreshSave();
  document.getElementById('soloPlayerName').textContent = state.playerName;
  buildTierList();
  buildDeckPicker();
  updateLowCardsPanel();
  showView('soloSetup');
  state.selectedTier = null;
  state.selectedOpponentIdx = null;
  document.getElementById('opponentList').innerHTML = '';
  updateStartButton();
});

// ================= PVP =================

function buildPvpDeckPicker() {
  buildGroupedDeckPicker({ containerId: 'pvpDeckPicker', countElId: 'pvpDeckCount', stateKey: 'pvpDeck' });
}

document.getElementById('pvpCreateBtn').addEventListener('click', () => {
  if (!validatePvpForm()) return;
  socket.emit('pvp:create', {
    set: state.activeSet,
    playerName: state.playerName,
    rules: pvpRules(),
    tradeRule: document.getElementById('pvpTradeRuleSelect').value,
    deckCardIds: state.pvpDeck,
  });
});

document.getElementById('pvpJoinBtn').addEventListener('click', () => {
  if (!validatePvpForm()) return;
  const roomCode = document.getElementById('pvpRoomCodeInput').value.trim().toUpperCase();
  if (!roomCode) return alert('Entrez un code de salon.');
  state.roomCode = roomCode;
  socket.emit('pvp:join', {
    roomCode,
    playerName: state.playerName,
    rules: pvpRules(),
    tradeRule: document.getElementById('pvpTradeRuleSelect').value,
    deckCardIds: state.pvpDeck,
  });
});

function pvpRules() {
  return readRuleToggles('pvpRuleToggles');
}

function validatePvpForm() {
  if (state.pvpDeck.length !== 5) { alert('Choisissez exactement 5 cartes.'); return false; }
  state.mode = 'pvp';
  return true;
}

socket.on('pvp:created', ({ roomCode }) => {
  state.roomCode = roomCode;
  document.getElementById('pvpRoomInfo').textContent = `Salon créé: ${roomCode} — en attente d'un adversaire...`;
});

socket.on('pvp:start', (payload) => {
  const me = payload.players.find(p => p.name === state.playerName);
  state.myOwner = me ? me.owner : 'A';
  gameEnded = false;
  document.getElementById('opponentLabel').textContent = 'Adversaire (J2)';
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  showView('game');
  renderGameState(payload);
});

socket.on('pvp:state', (payload) => renderGameState(payload));

socket.on('pvp:gameover', ({ score, players }) => {
  gameEnded = true;
  renderGameState(currentGame);
  const myScore = score[state.myOwner];
  const otherOwner = state.myOwner === 'A' ? 'B' : 'A';
  const otherScore = score[otherOwner];
  let msg;
  if (myScore > otherScore) msg = 'Vous avez gagné le duel !';
  else if (myScore < otherScore) msg = 'Vous avez perdu le duel.';
  else msg = 'Match nul !';
  document.getElementById('gameMessage').textContent = `${msg} (${score.A} - ${score.B})`;
});

// ================= JEU (rendu commun solo/pvp/tournoi) =================
let currentGame = { board: Array(9).fill(null), hands: { A: [], B: [] }, turn: 'A' };
let selectedHandInstanceId = null;
let gameEnded = false;

const RULE_LABELS = {
  open: 'Open', random: 'Aléatoire', same: 'Identique', plus: 'Plus', combo: 'Combo', elemental: 'Élémental',
  wallAce: 'Mur en As', suddenDeath: 'Mort subite',
};
const TRADE_RULE_LABELS = {
  one: 'Une carte (One)', direct: 'Direct', diff: 'Différence (Diff)', all: 'Toutes (All)', none: 'Aucune (None)',
};
const RULE_TRIGGER_LABELS = { same: 'Égal', plus: 'Plus' };

function renderRulesSummary(rules, tradeRule) {
  const el = document.getElementById('rulesSummary');
  if (!rules) { el.textContent = ''; return; }
  const activeRules = Object.keys(RULE_LABELS).filter(k => rules[k]).map(k => RULE_LABELS[k]);
  const rulesText = activeRules.length ? activeRules.join(' · ') : 'Aucune règle spéciale';
  const tradeText = tradeRule ? TRADE_RULE_LABELS[tradeRule] || tradeRule : null;
  el.textContent = tradeText ? `${rulesText}  —  Mise : ${tradeText}` : rulesText;
}

function renderBoardOnly(board, cellElements, flipIndices) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  board.forEach((card, idx) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (card ? '' : ' empty');
    const element = cellElements[idx];

    if (card) {
      cell.classList.add('owner-' + card.owner);
      const tile = document.createElement('div');
      tile.className = 'card-tile';
      if (flipIndices && flipIndices.includes(idx)) tile.classList.add('flipping');
      tile.innerHTML = cardTileHTML(card);
      cell.appendChild(tile);
      if (card.elementalDelta) {
        const indicator = document.createElement('div');
        indicator.className = 'card-elemental-indicator ' + (card.elementalDelta > 0 ? 'positive' : 'negative');
        indicator.textContent = (card.elementalDelta > 0 ? '+' : '') + card.elementalDelta;
        cell.appendChild(indicator);
      }
    } else {
      if (element) cell.insertAdjacentHTML('beforeend', elementIconHTML(element, 'element-tag-big'));
      cell.addEventListener('click', () => attemptPlace(idx));
    }
    boardEl.appendChild(cell);
  });
}

function showRuleTriggerBadge(cellIndex, label) {
  const boardEl = document.getElementById('board');
  const cell = boardEl.children[cellIndex];
  if (!cell) return;
  const badge = document.createElement('div');
  badge.className = 'rule-trigger-badge';
  badge.textContent = label;
  cell.appendChild(badge);
}

function renderGameState(payload) {
  const previousBoard = currentGame.board;

  currentGame.board = payload.board;
  currentGame.hands = payload.hands;
  currentGame.turn = payload.turn;
  currentGame.cellElements = payload.cellElements || currentGame.cellElements || Array(9).fill(null);
  currentGame.rules = payload.rules || currentGame.rules;
  currentGame.tradeRule = 'tradeRule' in payload ? payload.tradeRule : currentGame.tradeRule;
  if (payload.opponentName) currentGame.opponentName = payload.opponentName;

  const board = currentGame.board;
  const hands = currentGame.hands;
  const turn = currentGame.turn;
  const cellElements = currentGame.cellElements;

  if (currentGame.opponentName) {
    document.getElementById('opponentLabel').textContent = `${currentGame.opponentName} (J2)`;
  }

  renderRulesSummary(currentGame.rules, currentGame.tradeRule);

  const myOwner = state.myOwner || 'A';
  const oppOwner = myOwner === 'A' ? 'B' : 'A';

  document.getElementById('turnIndicator').textContent =
    turn === myOwner ? 'À vous de jouer' : ((state.mode === 'solo' || state.mode === 'tournament') ? 'L\'adversaire joue...' : 'Tour de l\'adversaire');

  let scoreA = 0, scoreB = 0;
  board.forEach(c => { if (c) { c.owner === 'A' ? scoreA++ : scoreB++; } });
  document.getElementById('scoreIndicator').textContent = `Score — Vous: ${myOwner === 'A' ? scoreA : scoreB} | Adversaire: ${myOwner === 'A' ? scoreB : scoreA}`;

  const lastMove = payload.lastMove;
  const hasSpecialTrigger = lastMove
    && (lastMove.ruleTriggered === 'same' || lastMove.ruleTriggered === 'plus')
    && lastMove.flippedIndices && lastMove.flippedIndices.length > 0;

  if (hasSpecialTrigger && previousBoard) {
    const intermediateBoard = previousBoard.map((c, i) => (i === lastMove.cellIndex ? board[i] : c));
    renderBoardOnly(intermediateBoard, cellElements, []);
    showRuleTriggerBadge(lastMove.cellIndex, RULE_TRIGGER_LABELS[lastMove.ruleTriggered]);
    setTimeout(() => {
      renderBoardOnly(board, cellElements, lastMove.flippedIndices);
    }, 1000);
  } else {
    const flipIndices = (lastMove && lastMove.flippedIndices) || [];
    renderBoardOnly(board, cellElements, flipIndices);
  }

  const revealOpponentHand = !!(currentGame.rules && currentGame.rules.open) || gameEnded;
  renderHand('handPlayerCards', hands[myOwner] || [], true, true);
  renderHand('handOpponentCards', hands[oppOwner] || [], false, revealOpponentHand);

  document.getElementById('gameMessage').textContent = '';
}

function cardBackHTML() {
  return `<img class="card-art" src="/images/card-back.jpg" alt="Carte cachée">`;
}

function renderHand(elementId, hand, selectable, revealed) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  hand.forEach(card => {
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    if (selectable) {
      tile.style.cursor = 'pointer';
      if (card.instanceId === selectedHandInstanceId) tile.classList.add('selected');
      tile.addEventListener('click', () => {
        selectedHandInstanceId = (selectedHandInstanceId === card.instanceId) ? null : card.instanceId;
        renderGameState(currentGame);
      });
    }
    tile.innerHTML = revealed ? cardTileHTML(card) : cardBackHTML();
    el.appendChild(tile);
  });
}

function attemptPlace(cellIndex) {
  if (!selectedHandInstanceId) return;
  if (currentGame.turn !== state.myOwner) return;
  if (state.mode === 'solo') {
    socket.emit('solo:place', { instanceId: selectedHandInstanceId, cellIndex });
  } else if (state.mode === 'tournament') {
    socket.emit('tournament:place', { instanceId: selectedHandInstanceId, cellIndex });
  } else {
    socket.emit('pvp:place', { roomCode: state.roomCode, instanceId: selectedHandInstanceId, cellIndex });
  }
  selectedHandInstanceId = null;
}

// ---------------- Événements solo ----------------
socket.on('solo:state', (payload) => {
  showView('game');
  renderGameState(payload);
});

socket.on('solo:gameover', ({ score, result, gains, losses, pointsAwarded }) => {
  gameEnded = true;
  renderGameState(currentGame);

  let msg;
  if (result === 'wins') msg = `Victoire ! (${score.A} - ${score.B})`;
  else if (result === 'losses') msg = `Défaite... (${score.A} - ${score.B})`;
  else msg = `Match nul (${score.A} - ${score.B})`;
  if (pointsAwarded) msg += ` — +${pointsAwarded} points`;
  document.getElementById('gameMessage').textContent = msg;

  const panel = document.getElementById('capturedCardsPanel');
  const gainedList = document.getElementById('gainedCardsList');
  const lostList = document.getElementById('lostCardsList');
  gainedList.innerHTML = '';
  lostList.innerHTML = '';
  (gains || []).forEach(id => {
    const def = CARD_BY_ID.get(id);
    if (!def) return;
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    tile.innerHTML = cardTileHTML(def);
    gainedList.appendChild(tile);
  });
  (losses || []).forEach(id => {
    const def = CARD_BY_ID.get(id);
    if (!def) return;
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    tile.innerHTML = cardTileHTML(def);
    lostList.appendChild(tile);
  });
  panel.classList.toggle('hidden', !(gains?.length || losses?.length));

  document.getElementById('postGameActions').classList.remove('hidden');

  refreshSave().then(updateSessionBarPoints);
  fetch(`/api/${state.activeSet}/legendary-holders`).then(r => r.json()).then(data => {
    LEGENDARY_HOLDERS = new Map(Object.entries(data));
  });
});

// ---------------- Choix de la carte gagnée (règles One / Diff) ----------------
let pendingChoice = { count: 0, selected: [] };

function cardGainNameClass(cardId) {
  const collection = state.save?.collection || [];
  const discovered = state.save?.discovered || [];
  if (collection.includes(cardId)) return null;
  return discovered.includes(cardId) ? 'name-yellow' : 'name-green';
}

socket.on('solo:chooseCard', ({ options, count }) => {
  pendingChoice = { count, selected: [] };
  document.getElementById('chooseCardInstructions').textContent =
    count === 1
      ? 'Choisissez la carte que vous remportez sur l\'adversaire.'
      : `Choisissez ${count} cartes que vous remportez sur l'adversaire.`;

  const grid = document.getElementById('chooseCardGrid');
  grid.innerHTML = '';

  options.forEach((cardId, i) => {
    const def = CARD_BY_ID.get(cardId);
    if (!def) return;
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    tile.dataset.cardId = cardId;
    tile.dataset.slot = i;
    tile.innerHTML = cardTileHTML(def, null, cardGainNameClass(cardId));
    tile.addEventListener('click', () => {
      const already = pendingChoice.selected.indexOf(i);
      if (already !== -1) {
        pendingChoice.selected.splice(already, 1);
        tile.classList.remove('selected');
      } else {
        if (pendingChoice.selected.length >= pendingChoice.count) return;
        pendingChoice.selected.push(i);
        tile.classList.add('selected');
      }
      document.getElementById('confirmChooseCardBtn').disabled = pendingChoice.selected.length !== pendingChoice.count;
    });
    grid.appendChild(tile);
  });

  document.getElementById('confirmChooseCardBtn').disabled = true;
  showView('chooseCard');
});

document.getElementById('confirmChooseCardBtn').addEventListener('click', () => {
  const grid = document.getElementById('chooseCardGrid');
  const chosenCardIds = pendingChoice.selected.map(slot =>
    [...grid.children][slot].dataset.cardId
  );
  socket.emit('solo:cardChosen', { chosenCardIds });
});

socket.on('solo:gameover', () => showView('game'));

// ================= ENCYCLOPÉDIE =================

function buildEncyclopedia(save) {
  const counts = groupCounts(save.collection);
  const levels = [...new Set(ALL_CARDS.map(c => c.level))].sort((a, b) => a - b);

  const tabsEl = document.getElementById('encyclopediaTabs');
  tabsEl.innerHTML = '';
  levels.forEach((level, idx) => {
    const b = document.createElement('button');
    b.textContent = `Niveau ${level}`;
    b.addEventListener('click', () => {
      [...tabsEl.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      renderEncyclopediaPage(level, counts);
    });
    tabsEl.appendChild(b);
    if (idx === 0) { b.classList.add('selected'); renderEncyclopediaPage(level, counts); }
  });
}

/**
 * Construit l'indice affiché pour une carte légendaire non obtenue : nom de l'adversaire qui la
 * détient actuellement, son palier, et un indice bonus si cet adversaire fait aussi partie du
 * tournoi en cours du joueur (rappel : le tournoi ne fait gagner aucune carte pour l'instant,
 * c'est une information purement indicative).
 */
function legendaryHintHTML(cardId) {
  const holder = LEGENDARY_HOLDERS.get(cardId);
  if (!holder) return '<span class="legendary-holder">Actuellement introuvable</span>';

  const tierData = OPPONENTS.find(t => t.tier === holder.tier);
  const tierLabel = tierData ? tierData.label : `Palier ${holder.tier}`;

  let html = `<span class="legendary-holder">Détenue par : ${holder.opponentName}<br>(${tierLabel})</span>`;

  const t = state.save?.tournament;
  if (t && t.active && !t.finished) {
    const inRounds = (t.opponents || []).some(o => o.tier === holder.tier && o.opponentIndex === holder.opponentIndex);
    const inDecider = t.deciderOpponent && t.deciderOpponent.tier === holder.tier && t.deciderOpponent.opponentIndex === holder.opponentIndex;
    if (inRounds || inDecider) {
      html += `<span class="legendary-tournament-hint">⚔️ Aussi présent dans votre tournoi en cours</span>`;
    }
  }
  return html;
}

function renderEncyclopediaPage(level, counts) {
  const grid = document.getElementById('encyclopediaGrid');
  grid.innerHTML = '';
  const cardsOfLevel = ALL_CARDS.filter(c => c.level === level);
  let known = 0;

  cardsOfLevel.forEach(def => {
    const owned = counts.get(def.id) || 0;
    const tile = document.createElement('div');
    if (owned > 0) {
      known++;
      tile.className = 'card-tile';
      const badges = owned > 1 ? `<span class="badge badge-owned">x${owned}</span>` : '';
      tile.innerHTML = cardTileHTML(def, badges);
      tile.style.cursor = 'zoom-in';
      tile.addEventListener('click', () => showCardZoom(def));
    } else {
      tile.className = 'card-tile unknown';
      const extra = def.legendary ? legendaryHintHTML(def.id) : '';
      tile.innerHTML = `<span class="big-mark">???</span><span class="name">Non obtenue</span>${extra}`;
    }
    grid.appendChild(tile);
  });

  let progress = document.getElementById('encyclopediaProgress');
  if (!progress) {
    progress = document.createElement('div');
    progress.id = 'encyclopediaProgress';
    progress.className = 'encyclopedia-progress';
    grid.parentElement.insertBefore(progress, grid);
  }
  progress.textContent = `${known} / ${cardsOfLevel.length} cartes obtenues à ce niveau`;
}

socket.on('error:msg', (msg) => alert(msg));

// ---------------- Zoom générique sur une carte (Encyclopédie...) ----------------
function showCardZoom(card) {
  const overlay = document.getElementById('cardZoomOverlay');
  const content = document.getElementById('cardZoomContent');
  content.innerHTML = cardTileHTML(card);
  overlay.classList.remove('hidden');
}

document.getElementById('cardZoomOverlay').addEventListener('click', () => {
  document.getElementById('cardZoomOverlay').classList.add('hidden');
});

// ================= COMMERCE =================

function buildShopBuyGrid() {
  const grid = document.getElementById('shopBuyGrid');
  grid.innerHTML = '';
  Object.entries(SHOP_BUY_TIERS).forEach(([tierKey, tier]) => {
    const tile = document.createElement('div');
    tile.className = 'shop-buy-tile';
    tile.innerHTML = `
      <div class="shop-tier-title">${tier.label}</div>
      <div class="shop-tier-cost">${tier.cost} pts</div>
      <button type="button" class="buy-btn">$ Acheter</button>
    `;
    tile.querySelector('.buy-btn').addEventListener('click', () => buyCard(tierKey, tier));
    grid.appendChild(tile);
  });
}

async function buyCard(tierKey, tier) {
  if (!confirm(`Acheter une carte aléatoire (${tier.label}) pour ${tier.cost} points ?`)) return;
  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/shop/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierKey }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Achat impossible.');
    }
    const { save, purchasedCard } = await res.json();
    state.save = save;
    document.getElementById('shopPoints').textContent = save.points;
    updateSessionBarPoints();
    buildShopSellGrid();
    showShopReveal(purchasedCard);
  } catch (err) {
    alert(err.message);
  }
}

function showShopReveal(card) {
  const overlay = document.getElementById('shopRevealOverlay');
  const cardEl = document.getElementById('shopRevealCard');
  const infoEl = document.getElementById('shopRevealInfo');
  const hintEl = document.getElementById('shopRevealHint');

  cardEl.innerHTML = '';
  cardEl.classList.remove('revealed', 'flipping');
  infoEl.classList.remove('revealed');
  infoEl.textContent = '';
  hintEl.classList.remove('revealed');
  overlay.classList.remove('hidden');
  void overlay.offsetWidth;
  overlay.classList.add('fading-in');

  // 1) après le fondu au noir (2s), affiche le dos de la carte, immobile
  setTimeout(() => {
    cardEl.innerHTML = cardBackHTML();
    cardEl.classList.add('revealed');

    // 2) le dos reste visible 2s de plus, PUIS on déclenche le flip (1s)
    setTimeout(() => {
      cardEl.classList.add('flipping');
      // à mi-course du flip (carte "de profil", donc invisible), on bascule vers la vraie carte
      setTimeout(() => {
        cardEl.innerHTML = cardTileHTML(card);
      }, 500);
      // le niveau + nom et l'indice de clic apparaissent une fois le flip terminé
      setTimeout(() => {
        infoEl.textContent = `Niveau ${card.level} — ${card.name}`;
        infoEl.classList.add('revealed');
        hintEl.classList.add('revealed');
      }, 1000);
    }, 2000);
  }, 2000);
}

document.getElementById('shopRevealOverlay').addEventListener('click', () => {
  const overlay = document.getElementById('shopRevealOverlay');
  overlay.classList.add('hidden');
  overlay.classList.remove('fading-in');
});

function buildShopSellGrid() {
  const container = document.getElementById('shopSellGrid');
  container.innerHTML = '';
  const counts = groupCounts(state.save.collection);
  const uniqueIds = sortCardIdsByLevelAndNumber([...counts.keys()].filter(id => CARD_BY_ID.has(id)));

  uniqueIds.forEach(cardId => {
    const def = CARD_BY_ID.get(cardId);
    const owned = counts.get(cardId);
    const price = SELL_PRICE_BY_LEVEL[def.level] ?? null;

    const item = document.createElement('div');
    item.className = 'deck-picker-item';

    const tile = document.createElement('div');
    tile.className = 'card-tile';
    const badges = owned > 1 ? `<span class="badge badge-owned">x${owned}</span>` : '';
    tile.innerHTML = cardTileHTML(def, badges);

    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.className = 'sell-btn';
    if (price === null) {
      sellBtn.textContent = 'Invendable';
      sellBtn.disabled = true;
    } else {
      sellBtn.textContent = `Vendre ($${price})`;
      sellBtn.addEventListener('click', () => sellCard(cardId, def, price));
    }

    item.append(tile, sellBtn);
    container.appendChild(item);
  });
}

async function sellCard(cardId, def, price) {
  if (!confirm(`Vendre 1 exemplaire de ${def.name} pour ${price} points ?`)) return;
  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/shop/sell`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Vente impossible.');
    }
    const data = await res.json();
    state.save = data.save;
    document.getElementById('shopPoints').textContent = data.save.points;
    updateSessionBarPoints();
    buildShopSellGrid();
  } catch (err) {
    alert(err.message);
  }
}

// ================= TOURNOI =================

const PLACEMENT_LABELS = {
  champion: '🏆 Champion (1ère place)',
  second: '🥈 2e place',
  third: '🥉 3e place',
  eliminated: 'Éliminé',
};
function placementLabel(p) { return PLACEMENT_LABELS[p] || p || ''; }

function getRoundStatus(t, i) {
  if (i < t.roundIndex) return 'won';
  if (i > t.roundIndex) return 'upcoming';
  if (t.isDecider) return 'lost'; // cette manche a été perdue, d'où la manche décisive
  if (t.finished) return t.placement === 'champion' ? 'won' : 'lost';
  return 'current';
}

function getDeciderStatus(t) {
  if (!t.deciderOpponent) return null; // jamais déclenchée
  if (t.isDecider && !t.finished) return 'current';
  if (t.finished) return t.placement === 'third' ? 'won' : 'lost';
  return 'upcoming';
}

function buildTournamentBracketHTML(t) {
  let html = '<div class="tournament-bracket">';
  for (let i = 0; i < 5; i++) {
    const status = getRoundStatus(t, i);
    const opp = t.opponents[i];
    html += `<div class="tournament-step ${status}">
      <span>${i + 1}</span>
      <span class="step-label">${opp ? opp.opponentName : ''}</span>
    </div>`;
  }
  const deciderStatus = getDeciderStatus(t);
  if (deciderStatus) {
    html += `<div class="tournament-step decider ${deciderStatus}">
      <span>D</span>
      <span class="step-label">${t.deciderOpponent ? t.deciderOpponent.opponentName : ''} (3e place)</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

function updateTournamentStartButton() {
  const ok = state.selectedTournamentTier !== null && state.tournamentDeck.length === 5;
  document.getElementById('tournamentStartBtn').disabled = !ok;
}

function buildTournamentTierPicker() {
  const container = document.getElementById('tournamentTierPicker');
  container.innerHTML = '';
  state.selectedTournamentTier = null;
  TOURNAMENT_TIERS.forEach(tier => {
    const b = document.createElement('button');
    b.className = 'tournament-tier-btn';
    b.innerHTML = `
      <span class="tier-label">${tier.label}</span>
      <span class="tier-cost">${tier.cost} pts</span>
    `;
    b.addEventListener('click', () => {
      state.selectedTournamentTier = tier.id;
      [...container.children].forEach(c => c.classList.remove('selected'));
      b.classList.add('selected');
      updateTournamentStartButton();
    });
    container.appendChild(b);
  });
}

function buildTournamentView() {
  const t = state.save.tournament;
  const resumePanel = document.getElementById('tournamentResumePanel');
  const newPanel = document.getElementById('tournamentNewPanel');
  const lastResultPanel = document.getElementById('tournamentLastResult');

  if (t && t.active && !t.finished) {
    resumePanel.classList.remove('hidden');
    newPanel.classList.add('hidden');
    lastResultPanel.classList.add('hidden');
    const tierLabel = TOURNAMENT_TIERS.find(tr => tr.id === t.tierKey)?.label || t.tierKey;
    document.getElementById('tournamentBracket').innerHTML =
      `<p style="text-align:center;color:#ffd873;font-weight:bold;">Niveau : ${tierLabel}</p>` + buildTournamentBracketHTML(t);
  } else {
    resumePanel.classList.add('hidden');
    newPanel.classList.remove('hidden');
    buildTournamentTierPicker();
    setRuleToggles('tournamentRuleToggles', {});
    buildGroupedDeckPicker({ containerId: 'tournamentDeckPicker', countElId: 'tournamentDeckCount', stateKey: 'tournamentDeck', onChange: updateTournamentStartButton });
    updateTournamentStartButton();

    if (t && t.finished) {
      lastResultPanel.classList.remove('hidden');
      const tierLabel = TOURNAMENT_TIERS.find(tr => tr.id === t.tierKey)?.label || t.tierKey;
      document.getElementById('tournamentLastResultText').textContent = `Niveau ${tierLabel} — Résultat : ${placementLabel(t.placement)}`;
      document.getElementById('tournamentLastResultBracket').innerHTML = buildTournamentBracketHTML(t);
    } else {
      lastResultPanel.classList.add('hidden');
    }
  }
}

document.getElementById('tournamentStartBtn').addEventListener('click', async () => {
  const rules = readRuleToggles('tournamentRuleToggles');
  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckCardIds: state.tournamentDeck, rules, tierKey: state.selectedTournamentTier }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Impossible de démarrer le tournoi.');
    }
    const { save } = await res.json();
    state.save = save;
    updateSessionBarPoints();
    buildTournamentView();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('tournamentAbandonBtn').addEventListener('click', async () => {
  if (!confirm('Abandonner ce tournoi ? Les points d\'entrée déjà payés ne seront pas remboursés.')) return;
  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/abandon`, { method: 'POST' });
  const { save } = await res.json();
  state.save = save;
  buildTournamentView();
});

document.getElementById('tournamentContinueBtn').addEventListener('click', () => {
  state.mode = 'tournament';
  state.myOwner = 'A';
  gameEnded = false;
  currentGame.tradeRule = null;
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  socket.emit('tournament:playRound', { set: state.activeSet, name: state.playerName });
});

document.getElementById('tournamentBackBtn').addEventListener('click', () => goToFeature('tournament'));

socket.on('tournament:state', (payload) => {
  showView('game');
  renderGameState(payload);
});

socket.on('tournament:matchOver', (data) => {
  gameEnded = true;
  renderGameState(currentGame);
  let msg = data.result === 'win' ? 'Manche remportée !' : 'Manche perdue.';
  if (data.finished) msg += ` — Tournoi terminé : ${placementLabel(data.placement)}`;
  document.getElementById('gameMessage').textContent = msg;
  document.getElementById('tournamentMatchActions').classList.remove('hidden');
  refreshSave().then(updateSessionBarPoints);
});

// ================= COMMERCE : onglets Boutique / Échange =================

function switchShopTab(tab) {
  const buySellBtn = document.getElementById('shopTabBuySell');
  const tradeBtn = document.getElementById('shopTabTrade');
  const buySellPanel = document.getElementById('shopBuySellPanel');
  const tradePanel = document.getElementById('shopTradePanel');

  buySellBtn.classList.toggle('selected', tab === 'buysell');
  tradeBtn.classList.toggle('selected', tab === 'trade');
  buySellPanel.classList.toggle('hidden', tab !== 'buysell');
  tradePanel.classList.toggle('hidden', tab !== 'trade');
}

document.getElementById('shopTabBuySell').addEventListener('click', () => switchShopTab('buysell'));
document.getElementById('shopTabTrade').addEventListener('click', () => switchShopTab('trade'));

// ================= ÉCHANGE ENTRE JOUEURS =================

let tradeState = {
  roomCode: null,
  offerCardId: null,
  lastPlayers: [],
};

document.getElementById('tradeCreateBtn').addEventListener('click', () => {
  socket.emit('trade:create', { set: state.activeSet, playerName: state.playerName });
});

document.getElementById('tradeJoinBtn').addEventListener('click', () => {
  const roomCode = document.getElementById('tradeRoomCodeInput').value.trim().toUpperCase();
  if (!roomCode) return alert('Entrez un code de salon.');
  tradeState.roomCode = roomCode;
  socket.emit('trade:join', { roomCode, playerName: state.playerName });
});

socket.on('trade:created', ({ roomCode }) => {
  tradeState.roomCode = roomCode;
  document.getElementById('tradeRoomInfo').textContent = `Salon créé : ${roomCode} — partagez ce code avec l'autre joueur.`;
  enterTradeRoom();
});

function enterTradeRoom() {
  tradeState.offerCardId = null;
  document.getElementById('tradePointsInput').value = 0;
  document.getElementById('tradeLobby').classList.add('hidden');
  document.getElementById('tradeRoomView').classList.remove('hidden');
  buildTradeCardPicker();
}

function buildTradeCardPicker() {
  const container = document.getElementById('tradeCardPicker');
  container.innerHTML = '';
  const counts = groupCounts(state.save.collection);
  const uniqueIds = sortCardIdsByLevelAndNumber([...counts.keys()].filter(id => CARD_BY_ID.has(id)));
  uniqueIds.forEach(cardId => {
    const def = CARD_BY_ID.get(cardId);
    const owned = counts.get(cardId);
    const tile = document.createElement('div');
    tile.className = 'card-tile';
    if (tradeState.offerCardId === cardId) tile.classList.add('selected');
    const badges = owned > 1 ? `<span class="badge badge-owned">x${owned}</span>` : '';
    tile.innerHTML = cardTileHTML(def, badges);
    tile.addEventListener('click', () => {
      tradeState.offerCardId = (tradeState.offerCardId === cardId) ? null : cardId;
      buildTradeCardPicker();
      sendTradeOffer();
    });
    container.appendChild(tile);
  });
}

document.getElementById('tradePointsInput').addEventListener('change', sendTradeOffer);

function sendTradeOffer() {
  if (!tradeState.roomCode) return;
  const points = Math.max(0, parseInt(document.getElementById('tradePointsInput').value, 10) || 0);
  socket.emit('trade:setOffer', { roomCode: tradeState.roomCode, cardId: tradeState.offerCardId, points });
  document.getElementById('tradeUnreadyBtn').classList.add('hidden');
  document.getElementById('tradeReadyBtn').classList.remove('hidden');
}

document.getElementById('tradeReadyBtn').addEventListener('click', () => {
  socket.emit('trade:ready', { roomCode: tradeState.roomCode });
  document.getElementById('tradeReadyBtn').classList.add('hidden');
  document.getElementById('tradeUnreadyBtn').classList.remove('hidden');
});

document.getElementById('tradeUnreadyBtn').addEventListener('click', () => {
  socket.emit('trade:unready', { roomCode: tradeState.roomCode });
  document.getElementById('tradeUnreadyBtn').classList.add('hidden');
  document.getElementById('tradeReadyBtn').classList.remove('hidden');
});

document.getElementById('tradeLeaveBtn').addEventListener('click', () => {
  if (tradeState.roomCode) socket.emit('trade:leave', { roomCode: tradeState.roomCode });
  resetTradeRoomUI();
});

function resetTradeRoomUI() {
  tradeState.roomCode = null;
  tradeState.offerCardId = null;
  tradeState.lastPlayers = [];
  document.getElementById('tradeRoomView').classList.add('hidden');
  document.getElementById('tradeLobby').classList.remove('hidden');
  document.getElementById('tradeRoomInfo').textContent = '';
  document.getElementById('tradeRoomCodeInput').value = '';
}

/** Construit le contenu (carte et/ou badge de points) d'un slot d'offre. */
function tradeOfferInnerHTML(offer) {
  if (!offer || (!offer.cardId && !offer.points)) return '';
  let html = '';
  if (offer.cardId) {
    const def = CARD_BY_ID.get(offer.cardId);
    if (def) html += cardTileHTML(def);
  }
  if (offer.points) {
    html += `<div class="trade-points-badge">+${offer.points} pts</div>`;
  }
  return html;
}

socket.on('trade:state', ({ players }) => {
  tradeState.lastPlayers = players;
  // si on vient de rejoindre (pas encore "entré" visuellement dans le salon), on y entre maintenant
  if (document.getElementById('tradeRoomView').classList.contains('hidden')) enterTradeRoom();

  const me = players.find(p => p.name === state.playerName);
  const partner = players.find(p => p.name !== state.playerName);

  document.getElementById('tradePartnerName').textContent = partner ? partner.name : 'En attente d\'un adversaire...';

  const mySlot = document.getElementById('tradeMySlot');
  const theirSlot = document.getElementById('tradeTheirSlot');
  mySlot.classList.remove('swap-left', 'swap-right');
  theirSlot.classList.remove('swap-left', 'swap-right');

  const myHTML = tradeOfferInnerHTML(me?.offer);
  mySlot.innerHTML = myHTML;
  mySlot.classList.toggle('empty', !myHTML);

  const theirHTML = partner ? tradeOfferInnerHTML(partner.offer) : '';
  theirSlot.innerHTML = theirHTML;
  theirSlot.classList.toggle('empty', !theirHTML);

  const myStatus = document.getElementById('tradeMyStatus');
  myStatus.textContent = me?.ready ? '✅ Prêt' : 'En attente...';
  myStatus.classList.toggle('ready', !!me?.ready);

  const theirStatus = document.getElementById('tradeTheirStatus');
  theirStatus.textContent = !partner ? '' : (partner.ready ? '✅ Prêt' : 'En attente...');
  theirStatus.classList.toggle('ready', !!partner?.ready);
});

socket.on('trade:executed', () => {
  // anime les deux offres qui se croisent (3s), puis rafraîchit tout
  const mySlot = document.getElementById('tradeMySlot');
  const theirSlot = document.getElementById('tradeTheirSlot');
  mySlot.classList.add('swap-right');
  theirSlot.classList.add('swap-left');

  setTimeout(async () => {
    await refreshSave();
    updateSessionBarPoints();
    document.getElementById('shopPoints').textContent = state.save.points ?? 0;
    buildShopSellGrid();
    tradeState.offerCardId = null;
    document.getElementById('tradePointsInput').value = 0;
    mySlot.classList.remove('swap-right');
    theirSlot.classList.remove('swap-left');
    mySlot.innerHTML = '';
    mySlot.classList.add('empty');
    theirSlot.innerHTML = '';
    theirSlot.classList.add('empty');
    document.getElementById('tradeMyStatus').textContent = '';
    document.getElementById('tradeTheirStatus').textContent = '';
    document.getElementById('tradeReadyBtn').classList.remove('hidden');
    document.getElementById('tradeUnreadyBtn').classList.add('hidden');
    buildTradeCardPicker();
    alert('Échange effectué avec succès !');
    resetTradeRoomUI();
  }, 3000);
});

socket.on('trade:cancelled', ({ reason }) => {
  alert(reason || 'Échange annulé.');
  resetTradeRoomUI();
});
