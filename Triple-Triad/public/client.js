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
// (TOURNAMENT_TIERS retiré : la liste des tournois est désormais chargée par sauvegarde, voir buildTournamentTierPicker)
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
  selectedTournamentId: null,
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
  refreshMilestoneTitle();
}

async function updateSessionBarPoints() {
  document.getElementById('sessionPoints').textContent = state.save?.points ?? 0;
  await refreshMilestoneTitle();
}

/** Récupère et affiche le titre de jalon actuel sous le nom du joueur (barre de session). */
async function refreshMilestoneTitle() {
  if (!state.playerName || !state.activeSet) return;
  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/milestones`);
    const data = await res.json();
    state.milestones = data;
    document.getElementById('milestoneIcon').textContent = data.displayIcon;
    document.getElementById('milestoneTitle').textContent = data.displayTitle;
  } catch {
    // non bloquant : le reste de l'interface continue de fonctionner si cet appel échoue
  }
}

/** Construit et affiche l'overlay du tableau récapitulatif des jalons (icône barre "Univers"). */
async function openMilestonesOverlay() {
  document.getElementById('milestonesPlayerName').textContent = state.playerName;
  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/milestones`);
  const data = await res.json();
  state.milestones = data;

  const nextLabel = data.nextTier
    ? `Prochain palier : ${data.nextTier.icon} ${data.nextTier.label} (${data.nextTier.threshold} pts, encore ${data.nextTier.threshold - data.points} pts)`
    : 'Palier maximal des jalons de points atteint.';
  document.getElementById('milestonesCurrentSummary').innerHTML =
    `Titre actuel : ${data.displayIcon} <strong>${data.displayTitle}</strong> — ${data.points} points<br>${nextLabel}`;

  const tableEl = document.getElementById('milestonesTable');
  tableEl.innerHTML = '';
  data.allTiers.forEach(t => {
    const row = document.createElement('div');
    row.className = 'milestone-tier-row' + (t.reached ? ' reached' : '') + (t.label === data.currentTierLabel ? ' current' : '');
    const statusIcon = t.reached ? '✅' : '🔒';
    row.innerHTML = `<span>${t.icon} ${t.label}</span><span>${t.threshold} pts ${statusIcon}</span>`;
    tableEl.appendChild(row);
  });

  const badgesEl = document.getElementById('milestonesBadges');
  const badgeDefs = [
    { key: 'maitreDesGForces', suffix: '(toutes les cartes niveau 8 et 9)' },
    { key: 'celebrite', suffix: '(toutes les cartes niveau 10)' },
    { key: 'herosLegendaire', suffix: '(collection complète — remplace tous les autres titres)' },
  ];
  badgesEl.innerHTML = '<h3>Jalons spéciaux</h3>';
  badgeDefs.forEach(b => {
    const earned = data.badges[b.key];
    const icon = data.badgeIcons[b.key];
    const title = data.badgeLabels[b.key];
    const div = document.createElement('div');
    div.className = 'milestone-badge' + (earned ? ' earned' : '');
    div.innerHTML = `<span class="milestone-badge-icon">${icon}</span> ${earned ? '✅ Obtenu' : '🔒 Non obtenu'} — ${title} ${b.suffix}`;
    badgesEl.appendChild(div);
  });

  document.getElementById('milestonesOverlay').classList.remove('hidden');
}
document.getElementById('milestonesBtn').addEventListener('click', openMilestonesOverlay);
document.getElementById('milestonesCloseBtn').addEventListener('click', () => {
  document.getElementById('milestonesOverlay').classList.add('hidden');
});

function deactivateSession() {
  state.save = null;
  state.playerName = '';
  document.getElementById('sessionBar').classList.add('hidden');
  showView('home');
}

document.getElementById('logoutBtn').addEventListener('click', deactivateSession);

/**
 * Écrit `content` dans un fichier nommé `suggestedName`. Sur les navigateurs compatibles
 * (Chrome/Edge/Opera), ouvre le sélecteur natif "Enregistrer sous" : l'utilisateur choisit
 * l'emplacement et peut remplacer directement un fichier existant. Sur les autres navigateurs
 * (Firefox, Safari), repli sur un téléchargement classique vers le dossier par défaut.
 */
async function saveContentToFile(content, suggestedName) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Sauvegarde Triple Triad', accept: { 'text/plain': ['.txt'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return;
    } catch (pickerErr) {
      if (pickerErr.name === 'AbortError') return; // l'utilisateur a annulé la boîte de dialogue
      // toute autre erreur (ex: API présente mais indisponible dans ce contexte) : repli silencieux
    }
  }
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById('downloadSaveBtn').addEventListener('click', async () => {
  try {
    // récupère toujours la version la plus fraîche avant de télécharger, pour ne jamais exporter
    // une progression périmée (ex: après un gain de carte non encore reflété localement)
    const save = await refreshSave();
    const content = JSON.stringify(save, null, 2);
    await saveContentToFile(content, `${state.playerName}_${state.activeSet}.txt`);
  } catch (err) {
    alert('Impossible de télécharger la sauvegarde : ' + err.message);
  }
});

document.getElementById('downloadAllSavesBtn').addEventListener('click', async () => {
  try {
    const res = await fetch(`/api/save-all/${encodeURIComponent(state.playerName)}`);
    if (!res.ok) throw new Error('Échec de la récupération des sauvegardes.');
    const data = await res.json();
    const content = JSON.stringify(data, null, 2);
    await saveContentToFile(content, `${state.playerName}_tous_univers.txt`);
  } catch (err) {
    alert('Impossible de télécharger la sauvegarde combinée : ' + err.message);
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
    switchPvpKind('friendly');
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
    await buildTournamentView();
    showView('tournamentEntry');
  } else if (target === 'profile') {
    await refreshSave();
    document.getElementById('profilePlayerName').textContent = state.playerName;
    buildProfileView();
    showView('profile');
  }
}

document.getElementById('navHowTo').addEventListener('click', () => showView('howto'));
document.getElementById('navSolo').addEventListener('click', () => goToFeature('solo'));
document.getElementById('navPvp').addEventListener('click', () => goToFeature('pvp'));
document.getElementById('navEncyclopedia').addEventListener('click', () => goToFeature('encyclopedia'));
document.getElementById('navShop').addEventListener('click', () => goToFeature('shop'));
document.getElementById('navTournament').addEventListener('click', () => goToFeature('tournament'));
document.getElementById('navProfile').addEventListener('click', () => goToFeature('profile'));

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

    // Fichier combiné (tous univers, via "⬇️ Tous mes univers") : répartit chaque univers vers sa
    // propre sauvegarde, puis recharge l'univers actuellement actif si sa progression en fait partie.
    if (data && typeof data === 'object' && data.universes && typeof data.universes === 'object') {
      const res = await fetch('/api/save-all/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Fichier invalide.');
      }
      const result = await res.json();
      const importedSets = Object.keys(result.imported || {});
      const failedSets = Object.keys(result.errors || {});
      let msg = `Sauvegarde combinée importée : ${importedSets.length} univers restauré(s)`;
      if (failedSets.length) msg += `, échec pour ${failedSets.join(', ')}`;
      alert(msg);
      if (result.imported && result.imported[state.activeSet]) {
        activateSession(result.imported[state.activeSet]);
        enterFeature(state.pendingTarget || 'solo');
      }
      return;
    }

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

  // Regroupe par niveau : seuls les niveaux où au moins une carte est possédée apparaissent.
  const byLevel = new Map();
  uniqueIds.forEach(cardId => {
    const lvl = CARD_BY_ID.get(cardId).level;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(cardId);
  });
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  const tabsEl = document.createElement('div');
  tabsEl.className = 'pill-list deck-picker-level-tabs';
  const gridEl = document.createElement('div');
  gridEl.className = 'card-grid';
  container.append(tabsEl, gridEl);

  if (levels.length === 0) return; // aucune carte possédée (cas limite)

  let activeLevel = levels[0];
  const refreshers = [];
  function refreshAll() { refreshers.forEach(fn => fn()); }

  function renderGrid() {
    gridEl.innerHTML = '';
    refreshers.length = 0;

    byLevel.get(activeLevel).forEach(cardId => {
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
      gridEl.appendChild(item);
    });
  }

  levels.forEach(lvl => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `Niveau ${lvl}`;
    if (lvl === activeLevel) btn.classList.add('selected');
    btn.addEventListener('click', () => {
      activeLevel = lvl;
      [...tabsEl.children].forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      renderGrid();
    });
    tabsEl.appendChild(btn);
  });

  renderGrid();
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

  // "Level cartes : X et Y" — niveaux de cartes réellement présents dans les decks-pools du palier
  const levelsUsed = new Set();
  tierData.opponents.forEach(opp => {
    opp.deck.forEach(cardId => {
      const def = CARD_BY_ID.get(cardId);
      if (def) levelsUsed.add(def.level);
    });
  });
  const sortedLevels = [...levelsUsed].sort((a, b) => a - b);
  const levelsLabel = document.getElementById('opponentLevelsLabel');
  if (sortedLevels.length === 0) {
    levelsLabel.textContent = '';
  } else if (sortedLevels.length === 1) {
    levelsLabel.textContent = `Level cartes : ${sortedLevels[0]}`;
  } else {
    const last = sortedLevels[sortedLevels.length - 1];
    const rest = sortedLevels.slice(0, -1).join(', ');
    levelsLabel.textContent = `Level cartes : ${rest} et ${last}`;
  }

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
  coinFlipShown = false;
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('chooseCardOverlay').classList.add('hidden');
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

function switchPvpKind(kind) {
  state.pvpKind = kind;
  document.getElementById('pvpTabFriendly').classList.toggle('selected', kind === 'friendly');
  document.getElementById('pvpTabRanked').classList.toggle('selected', kind === 'ranked');
  document.getElementById('pvpFriendlyRulesBlock').classList.toggle('hidden', kind !== 'friendly');
}
document.getElementById('pvpTabFriendly').addEventListener('click', () => switchPvpKind('friendly'));
document.getElementById('pvpTabRanked').addEventListener('click', () => switchPvpKind('ranked'));

document.getElementById('pvpCreateBtn').addEventListener('click', () => {
  if (!validatePvpForm()) return;
  socket.emit('pvp:create', {
    set: state.activeSet,
    playerName: state.playerName,
    kind: state.pvpKind,
    rules: state.pvpKind === 'friendly' ? pvpRules() : null,
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
  coinFlipShown = false;
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('chooseCardOverlay').classList.add('hidden');
  document.getElementById('opponentLabel').textContent = 'Adversaire (J2)';
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('pvpPostGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  showView('game');
  revealGameStart(payload, renderGameState);
});

socket.on('pvp:state', (payload) => renderGameState(payload));

socket.on('pvp:gameover', ({ score, kind, players }) => {
  gameEnded = true;
  renderGameState(currentGame);
  const myScore = score[state.myOwner];
  const otherOwner = state.myOwner === 'A' ? 'B' : 'A';
  const otherScore = score[otherOwner];
  let msg;
  if (myScore > otherScore) msg = 'Vous avez gagné le duel !';
  else if (myScore < otherScore) msg = 'Vous avez perdu le duel.';
  else msg = 'Match nul !';
  const rankedNote = kind === 'ranked' ? ' (Classée — comptabilisé dans vos statistiques)' : ' (Amicale — non comptabilisé)';
  showGameOverOverlay(msg, `Score final : ${score.A} - ${score.B}${rankedNote}`, `${msg} (${score.A} - ${score.B})${rankedNote}`);
  if (kind === 'ranked') refreshSave().then(updateSessionBarPoints);

  document.getElementById('pvpPostGameActions').classList.remove('hidden');
  document.getElementById('pvpRematchStatus').textContent = '';
  document.getElementById('pvpRematchBtn').disabled = false;
});

document.getElementById('pvpRematchBtn').addEventListener('click', () => {
  socket.emit('pvp:rematch', { roomCode: state.roomCode });
  document.getElementById('pvpRematchBtn').disabled = true;
  document.getElementById('pvpRematchStatus').textContent = 'En attente de la confirmation de l\'adversaire...';
});

socket.on('pvp:rematchWaiting', ({ playerName }) => {
  document.getElementById('pvpRematchStatus').textContent = `${playerName} souhaite une revanche — cliquez sur "Revanche" pour accepter.`;
});

// ================= JEU (rendu commun solo/pvp/tournoi) =================
let currentGame = { board: Array(9).fill(null), hands: { A: [], B: [] }, turn: 'A' };
let selectedHandInstanceId = null;
let gameEnded = false;
let coinFlipShown = false; // évite de rejouer l'animation de pièce à chaque mise à jour du plateau

/**
 * Affiche l'animation de pièce (bleu = vous, rouge = adversaire) qui tourne 2s puis se fige 1,5s sur
 * le résultat, avant de révéler l'état réel de la partie. Ne se déclenche qu'une seule fois par
 * manche (contrôlé par coinFlipShown, réinitialisé à chaque nouveau début de duel).
 */
let pendingGameState = null; // dernier état reçu du serveur, utilisé même si l'animation de pièce est en cours

function revealGameStart(payload, renderFn) {
  // Réaffiche le plateau et les mains (masqués en fin de partie précédente une fois le résultat
  // des cartes gagnées/perdues affiché) — chaque nouvelle partie repart avec l'écran de jeu normal.
  document.getElementById('board-frame').classList.remove('hidden');
  document.getElementById('handPlayer').classList.remove('hidden');
  document.getElementById('handOpponent').classList.remove('hidden');
  document.getElementById('turnIndicator').classList.remove('hidden');
  document.getElementById('scoreIndicator').classList.remove('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');

  // mémorise toujours le DERNIER état reçu, même si une animation de pièce est déjà en cours et
  // qu'on ne l'affiche pas immédiatement — évite qu'un état plus ancien (plateau vide) n'écrase par
  // erreur un état plus récent (ex: le coup d'ouverture de l'IA) une fois l'animation terminée.
  pendingGameState = payload;
  if (coinFlipShown) {
    renderFn(payload);
    return;
  }
  coinFlipShown = true;
  const myOwner = state.myOwner || 'A';
  const playerStarts = payload.turn === myOwner;
  showCoinFlip(playerStarts, () => renderFn(pendingGameState));
}

function showCoinFlip(playerStarts, onDone) {
  const overlay = document.getElementById('coinFlipOverlay');
  const coin = document.getElementById('singleCoin');
  const resultText = document.getElementById('coinFlipResultText');

  coin.classList.remove('landed');
  coin.style.transition = 'none';
  coin.style.transform = 'rotateY(0deg)';
  resultText.textContent = '';
  overlay.classList.remove('hidden');

  // force le navigateur à appliquer la réinitialisation ci-dessus avant de lancer l'animation
  // (sinon le passage transition:none -> transition:... pourrait être fusionné et ignoré)
  void coin.offsetWidth;
  coin.classList.add('spinning');

  setTimeout(() => {
    coin.classList.remove('spinning');
    // Continue la rotation sur plusieurs tours supplémentaires pour un ralentissement fluide,
    // en s'arrêtant pile sur la bonne face : 0°/360°/... = bleu (vous), 180°/540°/... = rouge.
    const extraSpins = 5;
    const finalAngle = extraSpins * 360 + (playerStarts ? 0 : 180);
    coin.style.transition = 'transform 1s cubic-bezier(0.15, 0.8, 0.25, 1)';
    coin.style.transform = `rotateY(${finalAngle}deg)`;
    coin.classList.add('landed');
    resultText.textContent = playerStarts ? 'Vous commencez !' : 'L\'adversaire commence !';

    setTimeout(() => {
      overlay.classList.add('hidden');
      onDone();
    }, 1500);
  }, 2000);
}

/**
 * Affiche l'écran de fin de partie (titre + score) par-dessus le plateau, qui reste visible en
 * arrière-plan (aucun changement de vue, la musique continue normalement). Reste affiché tant que
 * le joueur n'a pas cliqué sur "Continuer".
 */
/**
 * Affiche le résultat de fin de partie (message + overlay) après un délai de 3 secondes, laissant
 * au joueur le temps de voir la dernière carte posée avant de révéler victoire/défaite/nul.
 */
function showGameOverOverlay(title, scoreText, messageText) {
  setTimeout(() => {
    if (messageText !== undefined) document.getElementById('gameMessage').textContent = messageText;
    document.getElementById('gameOverTitle').textContent = title;
    document.getElementById('gameOverScore').textContent = scoreText;
    document.getElementById('gameOverOverlay').classList.remove('hidden');
  }, 3000);
}
document.getElementById('gameOverContinueBtn').addEventListener('click', () => {
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('chooseCardOverlay').classList.add('hidden');
});

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
  revealGameStart(payload, renderGameState);
});

socket.on('solo:gameover', ({ score, result, gains, losses, pointsAwarded }) => {
  gameEnded = true;
  renderGameState(currentGame);

  let msg;
  if (result === 'wins') msg = `Victoire ! (${score.A} - ${score.B})`;
  else if (result === 'losses') msg = `Défaite... (${score.A} - ${score.B})`;
  else msg = `Match nul (${score.A} - ${score.B})`;
  if (pointsAwarded) msg += ` — +${pointsAwarded} points`;

  let overlayTitle;
  if (result === 'wins') overlayTitle = 'Victoire !';
  else if (result === 'losses') overlayTitle = 'Défaite...';
  else overlayTitle = 'Match nul';
  let overlayScore = `Score final : ${score.A} - ${score.B}`;
  if (pointsAwarded) overlayScore += ` — +${pointsAwarded} points`;
  showGameOverOverlay(overlayTitle, overlayScore, msg);

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
  // Une fois le résultat connu (et les cartes gagnées/perdues affichées), le plateau et les mains
  // n'ont plus d'utilité : on les masque pour ne laisser que ce panneau à l'écran.
  const hasCapturedCards = gains?.length || losses?.length;
  document.getElementById('board-frame').classList.toggle('hidden', hasCapturedCards);
  document.getElementById('handPlayer').classList.toggle('hidden', hasCapturedCards);
  document.getElementById('handOpponent').classList.toggle('hidden', hasCapturedCards);
  document.getElementById('turnIndicator').classList.toggle('hidden', hasCapturedCards);
  document.getElementById('scoreIndicator').classList.toggle('hidden', hasCapturedCards);

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

socket.on('solo:roundResult', ({ score }) => {
  // Annonce immédiate du résultat (le choix de carte n'arrivera que 2s plus tard, côté serveur).
  document.getElementById('gameMessage').textContent = `Victoire ! (${score.A} - ${score.B})`;
});

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
  document.getElementById('chooseCardOverlay').classList.remove('hidden');
});

document.getElementById('confirmChooseCardBtn').addEventListener('click', () => {
  const grid = document.getElementById('chooseCardGrid');
  const chosenCardIds = pendingChoice.selected.map(slot =>
    [...grid.children][slot].dataset.cardId
  );
  document.getElementById('chooseCardOverlay').classList.add('hidden');
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

// ---- Onglet "Cartes légendaires" : achats spéciaux avec conditions (victoires/ratio) ----
async function buildShopLegendaryGrid() {
  const grid = document.getElementById('shopLegendaryGrid');
  grid.innerHTML = '<p class="hint">Chargement...</p>';

  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/shop/legendary-items`);
  const { items } = await res.json();

  if (!items.length) {
    grid.innerHTML = '<p class="hint">Aucun achat spécial disponible pour cet univers pour le moment.</p>';
    return;
  }

  grid.innerHTML = '';
  items.forEach(item => {
    const tile = document.createElement('div');
    tile.className = 'shop-buy-tile shop-legendary-tile' + (!item.conditionMet && !item.owned ? ' locked' : '');

    let actionHTML;
    if (item.owned && item.type === 'duel') {
      actionHTML = `<button type="button" class="buy-btn duel-btn">⚔️ Combattre</button>`;
    } else if (item.owned) {
      actionHTML = `<div class="shop-owned-label">✓ Possédé</div>`;
    } else if (!item.conditionMet) {
      actionHTML = `<div class="shop-condition-label">🔒 ${item.conditionLabel}</div>`;
    } else {
      actionHTML = `<button type="button" class="buy-btn">Acheter</button>`;
    }

    tile.innerHTML = `
      <div class="shop-tier-title">${item.label}</div>
      <div class="shop-tier-cost">${item.cost} pts</div>
      ${actionHTML}
    `;

    if (item.owned && item.type === 'duel') {
      tile.querySelector('.duel-btn').addEventListener('click', () => goToLegendaryDuelSetup(item.cardId, item.label));
    } else if (item.conditionMet && !item.owned) {
      tile.querySelector('.buy-btn').addEventListener('click', () => buyLegendaryItem(item));
    }
    grid.appendChild(tile);
  });
}

async function buyLegendaryItem(item) {
  if (!confirm(`Acheter "${item.label}" pour ${item.cost} points ?`)) return;

  const endpointByType = {
    card: 'buy-legendary-card',
    pass: item.id === 'pass_gf' ? 'buy-gf-pass' : 'buy-legendary-pass',
    duel: 'buy-lvl9-duel',
  };
  const endpoint = endpointByType[item.type];
  const body = (item.type === 'card' || item.type === 'duel') ? { cardId: item.cardId } : {};

  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/shop/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Achat impossible.');
    state.save = data.save;
    document.getElementById('shopPoints').textContent = data.save.points;
    buildShopLegendaryGrid();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
}

// ================= COMBAT UNIQUE NIVEAU 9 =================

function goToLegendaryDuelSetup(cardId, label) {
  state.legendaryDuelCardId = cardId;
  document.getElementById('legendaryDuelOpponentLabel').textContent = label.replace('Combat : ', '');
  buildGroupedDeckPicker({
    containerId: 'legendaryDuelDeckPicker',
    countElId: 'legendaryDuelDeckCount',
    stateKey: 'legendaryDuelDeck',
    onChange: updateLegendaryDuelStartButton,
  });
  updateLegendaryDuelStartButton();
  showView('legendaryDuelSetup');
}

function updateLegendaryDuelStartButton() {
  const ok = state.legendaryDuelDeck && state.legendaryDuelDeck.length === 5;
  document.getElementById('legendaryDuelStartBtn').disabled = !ok;
}

document.getElementById('legendaryDuelStartBtn').addEventListener('click', () => {
  gameEnded = false;
  coinFlipShown = false;
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('chooseCardOverlay').classList.add('hidden');
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  state.mode = 'legendaryDuel';
  state.myOwner = 'A';
  socket.emit('legendaryDuel:start', {
    set: state.activeSet,
    name: state.playerName,
    cardId: state.legendaryDuelCardId,
    deckCardIds: state.legendaryDuelDeck,
  });
});

document.getElementById('legendaryDuelBackBtn').addEventListener('click', async () => {
  await goToFeature('shop');
  switchShopTab('legendary');
});

socket.on('legendaryDuel:state', (payload) => {
  showView('game');
  revealGameStart(payload, renderGameState);
});

socket.on('legendaryDuel:gameover', ({ score, result, cardId }) => {
  gameEnded = true;
  renderGameState(currentGame);

  const won = result === 'win';
  const cardName = CARD_BY_ID.get(cardId)?.name || cardId;
  const msg = won
    ? `Victoire ! ${cardName} rejoint votre collection.`
    : `Défaite... Vous pouvez retenter ce combat plus tard.`;
  showGameOverOverlay(won ? 'Victoire !' : 'Défaite...', won ? `${cardName} obtenue ! (${score.A} - ${score.B})` : `Score final : ${score.A} - ${score.B}`, `${msg} (${score.A} - ${score.B})`);

  // Pas d'actions "Rejouer"/"Autre adversaire" ici (spécifiques au mode Solo) : la barre de
  // navigation principale reste accessible pour retourner à la boutique ou ailleurs.
  refreshSave().then(updateSessionBarPoints);
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
  eliminated: 'Éliminé',
};
function placementLabel(p) { return PLACEMENT_LABELS[p] || p || ''; }

function getRoundStatus(t, i) {
  if (i < t.roundIndex) return 'won';
  if (i > t.roundIndex) return 'upcoming';
  if (t.finished) return t.placement === 'champion' ? 'won' : 'lost';
  return 'current';
}

function buildTournamentBracketHTML(t) {
  const totalRounds = t.opponents.length; // 4 (base) ou 5 (spécial)
  let html = '<div class="tournament-bracket">';
  for (let i = 0; i < totalRounds; i++) {
    const status = getRoundStatus(t, i);
    const opp = t.opponents[i];
    html += `<div class="tournament-step ${status}">
      <span>${i + 1}</span>
      <span class="step-label">${opp ? opp.opponentName : ''}</span>
    </div>`;
  }
  html += '</div>';
  return html;
}

function updateTournamentStartButton() {
  const ok = state.selectedTournamentId !== null && state.tournamentDeck.length === 5;
  document.getElementById('tournamentStartBtn').disabled = !ok;
}

/** Résume la récompense d'un tournoi de base en une ligne lisible. */
/** Résume les règles imposées d'un tournoi en une ligne courte ("Open, Élémental"), ou "Vanille" si aucune. */
function tournamentRulesLabel(t) {
  if (!t.rules) return '';
  const active = Object.entries(t.rules)
    .filter(([key, val]) => val && key !== 'random') // "random" jamais actif en tournoi, inutile à afficher
    .map(([key]) => RULE_LABELS[key] || key);
  return active.length ? `Règles : ${active.join(', ')}` : 'Règles : Vanille (aucune)';
}

function baseTournamentRewardLabel(t) {
  return `2e : ${t.rewardPoints} pts | 1er : ${t.rewardPoints} pts + carte niveau ${t.rewardCardLevel} au hasard`;
}

/** Résume la récompense d'un tournoi spécial en une ligne lisible. */
function specialTournamentRewardLabel(t) {
  const cardDesc = t.rewardCardPool ? `carte niveau 8 non obtenue` : `carte niveau 10 non obtenue`;
  return `Victoire : ${cardDesc} | Défaite en dernière manche : ${t.lossReward.points} pts`;
}

async function buildTournamentTierPicker() {
  const container = document.getElementById('tournamentTierPicker');
  container.innerHTML = '<p class="hint">Chargement...</p>';
  state.selectedTournamentId = null;

  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/list`);
  const { base, special } = await res.json();

  container.innerHTML = '';

  const renderTile = (t, rewardLabel, lockLabel) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tournament-tier-btn' + (!t.unlocked ? ' locked' : '');
    b.innerHTML = `
      <span class="tier-label">${t.label}${t.completed ? ' ✓' : ''}</span>
      <span class="tier-rules">${tournamentRulesLabel(t)}</span>
      <span class="tier-reward">${t.unlocked ? rewardLabel : `🔒 ${lockLabel}`}</span>
    `;
    if (t.unlocked) {
      b.addEventListener('click', () => {
        state.selectedTournamentId = t.id;
        [...container.querySelectorAll('.tournament-tier-btn')].forEach(c => c.classList.remove('selected'));
        b.classList.add('selected');
        updateTournamentStartButton();
      });
    }
    container.appendChild(b);
  };

  const baseTitle = document.createElement('h4');
  baseTitle.textContent = 'Tournois de base';
  container.appendChild(baseTitle);
  base.forEach((t, idx) => {
    const lockLabel = idx === 0 ? '' : `Remportez "${base[idx - 1].label}" pour débloquer`;
    renderTile(t, baseTournamentRewardLabel(t), lockLabel);
  });

  const specialTitle = document.createElement('h4');
  specialTitle.textContent = 'Tournois spéciaux';
  container.appendChild(specialTitle);
  special.forEach(t => {
    renderTile(t, specialTournamentRewardLabel(t), 'Achetez le pass requis en boutique');
  });

  updateTournamentStartButton();
}

// ================= PROFIL JOUEUR =================

function computeRatio(wins, losses) {
  const total = wins + losses;
  if (total === 0) return null; // pas encore de match joué, ratio non défini
  return (wins / total) * 100;
}

function formatRatio(ratio) {
  return ratio === null ? '—' : `${ratio.toFixed(1)}%`;
}

function buildProfileView() {
  const stats = state.save.stats || { wins: 0, losses: 0, draws: 0 };
  const ratio = computeRatio(stats.wins, stats.losses);

  document.getElementById('profileStatsDisplay').innerHTML = `
    <p>Victoires : <strong>${stats.wins}</strong> — Défaites : <strong>${stats.losses}</strong> — Matchs nuls : <strong>${stats.draws}</strong></p>
    <p>Ratio victoires/défaites : <strong>${formatRatio(ratio)}</strong></p>
  `;

  const input = document.getElementById('ratioAdjustInput');
  input.max = Math.min(stats.wins, stats.losses) || 0;
  updateRatioAdjustPreview();
}

function updateRatioAdjustPreview() {
  const stats = state.save.stats || { wins: 0, losses: 0, draws: 0 };
  const n = Math.floor(Number(document.getElementById('ratioAdjustInput').value)) || 0;
  const preview = document.getElementById('ratioAdjustPreview');
  const applyBtn = document.getElementById('ratioAdjustBtn');

  if (n <= 0 || n > stats.wins || n > stats.losses) {
    preview.textContent = n <= 0
      ? 'Entrez un nombre supérieur à 0.'
      : `Impossible : vous n'avez que ${Math.min(stats.wins, stats.losses)} défaite(s)/victoire(s) en commun à retirer.`;
    applyBtn.disabled = true;
    return;
  }

  const newWins = stats.wins - n;
  const newLosses = stats.losses - n;
  const newRatio = computeRatio(newWins, newLosses);
  preview.textContent = `Après application : ${newWins} victoires, ${newLosses} défaites, ratio ${formatRatio(newRatio)}.`;
  applyBtn.disabled = false;
}

document.getElementById('ratioAdjustInput').addEventListener('input', updateRatioAdjustPreview);

document.getElementById('ratioAdjustBtn').addEventListener('click', async () => {
  const n = Math.floor(Number(document.getElementById('ratioAdjustInput').value)) || 0;
  const stats = state.save.stats || { wins: 0, losses: 0, draws: 0 };
  const newWins = stats.wins - n;
  const newLosses = stats.losses - n;
  const confirmed = confirm(
    `Retirer ${n} victoire(s) et ${n} défaite(s) ? Action irréversible.\n` +
    `Nouveau total : ${newWins} victoires, ${newLosses} défaites.\n` +
    `Attention : cela peut vous faire repasser sous un seuil de victoires minimum requis ailleurs.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/profile/adjust-ratio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeCount: n }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue.');
    state.save = data.save;
    buildProfileView();
  } catch (err) {
    alert('Erreur : ' + err.message);
  }
});

function tournamentLabelFromId(id) {
  const all = [...tournament_baseCache, ...tournament_specialCache];
  return all.find(t => t.id === id)?.label || id;
}
let tournament_baseCache = [];
let tournament_specialCache = [];

async function buildTournamentView() {
  const t = state.save.tournament;
  const resumePanel = document.getElementById('tournamentResumePanel');
  const newPanel = document.getElementById('tournamentNewPanel');
  const lastResultPanel = document.getElementById('tournamentLastResult');

  // rafraîchit le cache des libellés (utilisé pour afficher le nom du tournoi en cours/dernier résultat)
  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/list`);
  const { base, special } = await res.json();
  tournament_baseCache = base;
  tournament_specialCache = special;

  if (t && t.active && !t.finished) {
    resumePanel.classList.remove('hidden');
    newPanel.classList.add('hidden');
    lastResultPanel.classList.add('hidden');
    const label = tournamentLabelFromId(t.tournamentId);
    document.getElementById('tournamentBracket').innerHTML =
      `<p style="text-align:center;color:#ffd873;font-weight:bold;">${label}</p>` + buildTournamentBracketHTML(t);
  } else {
    resumePanel.classList.add('hidden');
    newPanel.classList.remove('hidden');
    await buildTournamentTierPicker();
    buildGroupedDeckPicker({ containerId: 'tournamentDeckPicker', countElId: 'tournamentDeckCount', stateKey: 'tournamentDeck', onChange: updateTournamentStartButton });
    updateTournamentStartButton();

    if (t && t.finished) {
      lastResultPanel.classList.remove('hidden');
      const label = tournamentLabelFromId(t.tournamentId);
      let text = `${label} — Résultat : ${placementLabel(t.placement)}`;
      if (t.reward) {
        const parts = [];
        if (t.reward.points) parts.push(`${t.reward.points} points`);
        if (t.reward.cardId) parts.push(`1 carte gagnée`);
        if (parts.length) text += ` (${parts.join(' + ')})`;
      }
      document.getElementById('tournamentLastResultText').textContent = text;
      document.getElementById('tournamentLastResultBracket').innerHTML = buildTournamentBracketHTML(t);
    } else {
      lastResultPanel.classList.add('hidden');
    }
  }
}

document.getElementById('tournamentStartBtn').addEventListener('click', async () => {
  try {
    const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckCardIds: state.tournamentDeck, tournamentId: state.selectedTournamentId }),
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
  if (!confirm('Abandonner ce tournoi ?')) return;
  const res = await fetch(`/api/${state.activeSet}/save/${encodeURIComponent(state.playerName)}/tournament/abandon`, { method: 'POST' });
  const { save } = await res.json();
  state.save = save;
  buildTournamentView();
});

document.getElementById('tournamentContinueBtn').addEventListener('click', () => {
  state.mode = 'tournament';
  state.myOwner = 'A';
  gameEnded = false;
  coinFlipShown = false;
  document.getElementById('gameOverOverlay').classList.add('hidden');
  document.getElementById('chooseCardOverlay').classList.add('hidden');
  currentGame.tradeRule = null;
  document.getElementById('postGameActions').classList.add('hidden');
  document.getElementById('tournamentMatchActions').classList.add('hidden');
  document.getElementById('capturedCardsPanel').classList.add('hidden');
  socket.emit('tournament:playRound', { set: state.activeSet, name: state.playerName });
});

document.getElementById('tournamentBackBtn').addEventListener('click', () => goToFeature('tournament'));

socket.on('tournament:state', (payload) => {
  showView('game');
  revealGameStart(payload, renderGameState);
});

socket.on('tournament:matchOver', (data) => {
  gameEnded = true;
  renderGameState(currentGame);
  let msg = data.result === 'win' ? 'Manche remportée !' : 'Manche perdue.';
  if (data.finished) msg += ` — Tournoi terminé : ${placementLabel(data.placement)}`;
  document.getElementById('tournamentMatchActions').classList.remove('hidden');
  showGameOverOverlay(data.result === 'win' ? 'Manche remportée !' : 'Manche perdue.', data.finished ? `Tournoi terminé : ${placementLabel(data.placement)}` : '', msg);
  refreshSave().then(updateSessionBarPoints);
});

// ================= COMMERCE : onglets Boutique / Échange =================

function switchShopTab(tab) {
  const buySellBtn = document.getElementById('shopTabBuySell');
  const tradeBtn = document.getElementById('shopTabTrade');
  const legendaryBtn = document.getElementById('shopTabLegendary');
  const buySellPanel = document.getElementById('shopBuySellPanel');
  const tradePanel = document.getElementById('shopTradePanel');
  const legendaryPanel = document.getElementById('shopLegendaryPanel');

  buySellBtn.classList.toggle('selected', tab === 'buysell');
  tradeBtn.classList.toggle('selected', tab === 'trade');
  legendaryBtn.classList.toggle('selected', tab === 'legendary');
  buySellPanel.classList.toggle('hidden', tab !== 'buysell');
  tradePanel.classList.toggle('hidden', tab !== 'trade');
  legendaryPanel.classList.toggle('hidden', tab !== 'legendary');

  if (tab === 'legendary') buildShopLegendaryGrid();
}

document.getElementById('shopTabBuySell').addEventListener('click', () => switchShopTab('buysell'));
document.getElementById('shopTabTrade').addEventListener('click', () => switchShopTab('trade'));
document.getElementById('shopTabLegendary').addEventListener('click', () => switchShopTab('legendary'));

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
