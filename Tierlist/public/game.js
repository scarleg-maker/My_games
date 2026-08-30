const socket = io();

const match = window.location.pathname.match(/joueur(\d+)\.html/);
const myPlayerNum = match ? parseInt(match[1], 10) : null; // null = solo or spectator

let state = null;
let selectedPoolItem = null;   // itemId selected from pool (to place)
let selectedPlacedItem = null; // itemId selected among already-placed (for "move" in dernière chance)

const loadingEl = document.getElementById('loading');
const appEl = document.getElementById('app');
const titleText = document.getElementById('titleText');
const subText = document.getElementById('subText');
const turnBanner = document.getElementById('turnBanner');
const rowsContainer = document.getElementById('rowsContainer');
const poolEl = document.getElementById('pool');
const poolPanel = document.getElementById('poolPanel');
const poolTitle = document.getElementById('poolTitle');
const actionBar = document.getElementById('actionBar');
const endTurnBtn = document.getElementById('endTurnBtn');
const recapPanel = document.getElementById('recapPanel');
const recapContent = document.getElementById('recapContent');
const newGameBtn = document.getElementById('newGameBtn');
const screenshotBtn = document.getElementById('screenshotBtn');

socket.on('state', (s) => {
  state = s;
  render();
});

function isMyTurn() {
  if (!state) return false;
  if (state.mode === 'solo') return true;
  if (myPlayerNum === null) return false; // spectator
  return state.currentPlayer === myPlayerNum;
}

function render() {
  if (!state) {
    loadingEl.style.display = 'block';
    appEl.style.display = 'none';
    return;
  }
  loadingEl.style.display = 'none';
  appEl.style.display = 'block';

  titleText.textContent = state.title;
  const modeLabel = state.mode === 'solo' ? 'Mode solo' : `Multijoueur — ${state.players.length} joueurs`;
  let extra = '';
  if (state.mode === 'multi') {
    if (state.suddenDeath) extra = ' · Mort subite';
    if (state.lastChance) extra = ' · Dernière chance';
  }
  subText.textContent = modeLabel + extra + (myPlayerNum ? ` · Tu es ${playerName(myPlayerNum)}` : (state.mode === 'multi' ? ' · Écran spectateur' : ''));

  renderTurnBanner();
  renderRows();
  renderPool();
  renderActionBar();
  renderRecap();
  screenshotBtn.style.display = (state.mode === 'solo') ? 'block' : 'none';
}

function playerName(num) {
  const p = state.players.find(pl => pl.num === num);
  return p ? p.name : `Joueur ${num}`;
}

function renderTurnBanner() {
  if (state.finished) { turnBanner.style.display = 'none'; return; }
  if (state.mode !== 'multi') { turnBanner.style.display = 'none'; return; }
  turnBanner.style.display = 'block';
  const cur = state.currentPlayer;
  const pendingItem = state.suddenDeath && state.pendingRandomItem
    ? state.items.find(i => i.id === state.pendingRandomItem)
    : null;

  if (myPlayerNum === cur) {
    turnBanner.className = 'turn-banner mine';
    if (state.turnPlaceUsed) {
      turnBanner.textContent = "🎯 C'est ton tour — valide pour passer au joueur suivant";
    } else if (pendingItem) {
      turnBanner.textContent = `🎯 C'est ton tour ! Image imposée : ${pendingItem.name} — glisse-la (ou clique une ligne) pour la placer`;
    } else {
      turnBanner.textContent = "🎯 C'est ton tour, tu as la main !";
    }
  } else {
    turnBanner.className = 'turn-banner waiting';
    const who = myPlayerNum ? `En attente de ${playerName(cur)}...` : `Tour de ${playerName(cur)}`;
    turnBanner.textContent = who + (pendingItem ? ` — image tirée au hasard : ${pendingItem.name}` : '');
  }
}

function rowIsFull(rowIndex) {
  if (state.maxPerRow === null) return false;
  const count = Object.values(state.placements).filter(r => r === rowIndex).length;
  return count >= state.maxPerRow;
}

function makeCard(item, placed) {
  const div = document.createElement('div');
  div.className = 'card' + (item.type === 'text' ? ' text-card' : '');
  div.dataset.id = item.id;
  if (item.type === 'image') {
    div.innerHTML = `<img src="${item.url}" alt=""><div class="name">${escapeHtml(item.name)}</div>`;
  } else {
    div.innerHTML = `<div class="name">${escapeHtml(item.name)}</div>`;
  }
  if (!placed && selectedPoolItem === item.id) div.classList.add('selected');
  if (placed && selectedPlacedItem === item.id) div.classList.add('selected');
  div.addEventListener('click', () => onCardClick(item.id, placed));

  // Drag and drop (desktop): works alongside the click-then-click flow, which stays
  // available for touch devices (tablets) where native HTML5 drag doesn't work.
  const canDrag = placed ? canMovePlaced() : canPlaceItem(item.id);
  div.draggable = canDrag;
  if (canDrag) {
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({ itemId: item.id, placed }));
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
    });
  }
  return div;
}

function findNearestCard(container, x, y, excludeId) {
  const cards = Array.from(container.querySelectorAll('.card')).filter(c => c.dataset.id !== excludeId);
  let nearest = null, minDist = Infinity;
  cards.forEach(c => {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = Math.hypot(x - cx, y - cy);
    if (d < minDist) { minDist = d; nearest = c; }
  });
  return nearest;
}

function handleDrop(e, rowIndex, cardsEl) {
  e.preventDefault();
  cardsEl.classList.remove('drop-target');
  let data;
  try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
  if (!data || !data.itemId) return;
  const { itemId, placed } = data;
  const nearest = findNearestCard(cardsEl, e.clientX, e.clientY, itemId);
  const targetItemId = nearest ? nearest.dataset.id : undefined;

  if (!placed) {
    if (!canPlaceItem(itemId)) return;
    socket.emit('place', { itemId, rowIndex, targetItemId, playerNum: myPlayerNum });
    selectedPoolItem = null;
  } else {
    if (!canMovePlaced()) return;
    const fromRow = state.placements[itemId];
    if (fromRow === rowIndex) {
      if (targetItemId && targetItemId !== itemId) {
        socket.emit('reorder', { itemId, targetItemId, playerNum: myPlayerNum });
      }
    } else {
      socket.emit('move', { itemId, rowIndex, targetItemId, playerNum: myPlayerNum });
    }
    selectedPlacedItem = null;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function canPlaceItem(itemId) {
  if (state.finished) return false;
  if (state.mode === 'solo') return true;
  if (!isMyTurn()) return false;
  if (state.turnPlaceUsed) return false;
  if (state.suddenDeath) return itemId === state.pendingRandomItem;
  return true;
}

function canMovePlaced() {
  if (state.finished) return false;
  if (state.mode === 'solo') return true;
  if (!state.lastChance) return false;
  if (!isMyTurn()) return false;
  return !state.turnMoveUsed;
}

function onCardClick(itemId, placed) {
  if (!placed) {
    if (!canPlaceItem(itemId)) return;
    selectedPoolItem = (selectedPoolItem === itemId) ? null : itemId;
    selectedPlacedItem = null;
  } else {
    if (selectedPlacedItem && selectedPlacedItem !== itemId) {
      // a placed card was already selected: clicking another placed card
      // repositions it right before the clicked one (same row = reorder, different row = move)
      if (!canMovePlaced()) { selectedPlacedItem = null; render(); return; }
      const targetRow = state.placements[itemId];
      if (targetRow === state.placements[selectedPlacedItem]) {
        socket.emit('reorder', { itemId: selectedPlacedItem, targetItemId: itemId, playerNum: myPlayerNum });
      } else {
        socket.emit('move', { itemId: selectedPlacedItem, rowIndex: targetRow, targetItemId: itemId, playerNum: myPlayerNum });
      }
      selectedPlacedItem = null;
      render();
      return;
    }
    if (!canMovePlaced()) return;
    selectedPlacedItem = (selectedPlacedItem === itemId) ? null : itemId;
    selectedPoolItem = null;
  }
  render();
}

function renderRows() {
  rowsContainer.innerHTML = '';
  const itemsById = new Map(state.items.map(it => [it.id, it]));
  const maxLabel = state.maxPerRow === null ? '∞' : state.maxPerRow;

  state.rows.forEach((row, idx) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'tier-row';

    const label = document.createElement('div');
    label.className = 'tier-label';
    label.style.background = row.color;

    if (state.mode === 'solo') {
      label.classList.add('editable');

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'tier-name-input';
      nameInput.value = row.name;
      nameInput.maxLength = 20;
      nameInput.title = 'Modifier le nom de la ligne';
      nameInput.addEventListener('click', e => e.stopPropagation());
      nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });
      nameInput.addEventListener('blur', () => {
        const newName = nameInput.value.trim();
        if (newName && newName !== row.name) {
          socket.emit('updateRow', { rowIndex: idx, name: newName });
        } else {
          nameInput.value = row.name;
        }
      });

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.className = 'tier-color-input';
      colorInput.value = row.color;
      colorInput.title = 'Modifier la couleur de la ligne';
      colorInput.addEventListener('click', e => e.stopPropagation());
      colorInput.addEventListener('input', () => {
        label.style.background = colorInput.value; // live preview while picking
      });
      colorInput.addEventListener('change', () => {
        socket.emit('updateRow', { rowIndex: idx, color: colorInput.value });
      });

      const maxLine = document.createElement('div');
      maxLine.className = 'tier-max';
      maxLine.textContent = `Max : ${maxLabel}`;

      label.appendChild(nameInput);
      label.appendChild(colorInput);
      label.appendChild(maxLine);
    } else {
      label.innerHTML = `<div class="tier-name">${escapeHtml(row.name)}</div><div class="tier-max">Max : ${maxLabel}</div>`;
    }
    rowEl.appendChild(label);

    const cardsEl = document.createElement('div');
    cardsEl.className = 'tier-cards';
    if (rowIsFull(idx)) cardsEl.classList.add('full');

    const orderedIds = (state.rowItems && state.rowItems[idx]) ? state.rowItems[idx] : state.items.filter(it => state.placements[it.id] === idx).map(it => it.id);
    orderedIds.forEach(id => {
      const it = itemsById.get(id);
      if (it) cardsEl.appendChild(makeCard(it, true));
    });

    cardsEl.addEventListener('click', (e) => {
      if (e.target.closest('.card')) return; // handled by card click
      onRowClick(idx);
    });
    cardsEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cardsEl.classList.add('drop-target');
    });
    cardsEl.addEventListener('dragleave', () => cardsEl.classList.remove('drop-target'));
    cardsEl.addEventListener('drop', (e) => handleDrop(e, idx, cardsEl));
    // also allow clicking row even when clicking empty space next to cards
    rowEl.addEventListener('click', (e) => {
      if (e.target === rowEl) onRowClick(idx);
    });

    rowEl.appendChild(cardsEl);
    rowsContainer.appendChild(rowEl);
  });
}

function onRowClick(rowIndex) {
  if (state.finished) return;
  if (rowIsFull(rowIndex)) return;

  // sudden death: clicking a row places the imposed item directly
  if (state.mode === 'multi' && state.suddenDeath && isMyTurn() && state.pendingRandomItem) {
    socket.emit('place', { itemId: state.pendingRandomItem, rowIndex, playerNum: myPlayerNum });
    return;
  }

  if (selectedPoolItem) {
    socket.emit('place', { itemId: selectedPoolItem, rowIndex, playerNum: myPlayerNum });
    selectedPoolItem = null;
    return;
  }
  if (selectedPlacedItem) {
    if (state.placements[selectedPlacedItem] === rowIndex) { selectedPlacedItem = null; render(); return; }
    socket.emit('move', { itemId: selectedPlacedItem, rowIndex, playerNum: myPlayerNum });
    selectedPlacedItem = null;
    return;
  }
}

function renderPool() {
  const unplaced = state.items.filter(it => !(it.id in state.placements));
  poolEl.innerHTML = '';

  if (state.mode === 'multi' && state.suddenDeath) {
    const stillPending = state.pendingRandomItem && !(state.pendingRandomItem in state.placements);
    poolPanel.style.display = stillPending ? 'block' : 'none';
    if (stillPending) {
      const it = state.items.find(i => i.id === state.pendingRandomItem);
      poolTitle.textContent = isMyTurn()
        ? 'Image imposée par le hasard — à toi de la placer'
        : `Image tirée au hasard pour ${playerName(state.currentPlayer)}`;
      if (it) poolEl.appendChild(makeCard(it, false));
    }
    return;
  }

  poolPanel.style.display = unplaced.length > 0 ? 'block' : 'none';
  poolTitle.textContent = `Cases restantes (${unplaced.length})`;
  unplaced.forEach(it => poolEl.appendChild(makeCard(it, false)));

  if (state.mode === 'multi' && !isMyTurn() && !state.finished) {
    poolEl.style.opacity = '0.45';
    poolEl.style.pointerEvents = 'none';
  } else {
    poolEl.style.opacity = '1';
    poolEl.style.pointerEvents = 'auto';
  }
}

function renderActionBar() {
  if (state.mode === 'multi' && isMyTurn() && state.turnPlaceUsed && !state.finished) {
    actionBar.style.display = 'block';
  } else {
    actionBar.style.display = 'none';
  }
}
endTurnBtn.addEventListener('click', () => {
  socket.emit('endTurn', { playerNum: myPlayerNum });
});

function renderRecap() {
  if (!state.finished) { recapPanel.style.display = 'none'; return; }
  recapPanel.style.display = 'block';
  poolPanel.style.display = 'none';
  turnBanner.style.display = 'none';
  actionBar.style.display = 'none';

  recapContent.innerHTML = '';
  state.rows.forEach((row, idx) => {
    const itemsHere = state.items.filter(it => state.placements[it.id] === idx);
    const div = document.createElement('div');
    div.className = 'recap-row';
    const swatch = document.createElement('div');
    swatch.className = 'recap-swatch';
    swatch.style.background = row.color;
    swatch.style.display = 'flex';
    swatch.style.alignItems = 'center';
    swatch.style.justifyContent = 'center';
    swatch.style.fontWeight = '800';
    swatch.style.color = '#0a0a0a';
    swatch.textContent = row.name;

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'recap-items';
    itemsHere.forEach(it => {
      itemsWrap.appendChild(makeCard(it, true));
    });

    div.appendChild(swatch);
    div.appendChild(itemsWrap);
    recapContent.appendChild(div);
  });
}

const saveBtn = document.getElementById('saveBtn');
saveBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/export');
    const data = await res.json();
    if (!res.ok || !data.ok) { alert(data.error || 'Impossible de sauvegarder pour le moment.'); return; }
    const blob = new Blob([JSON.stringify(data.save, null, 2)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = (data.save.title || 'Ma Tier List').replace(/[\\/:*?"<>|]+/g, '_').trim();
    a.href = url;
    a.download = `TierList - ${safeTitle}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Erreur lors de la sauvegarde : ' + err.message);
  }
});

screenshotBtn.addEventListener('click', async () => {
  try {
    if (typeof html2canvas === 'undefined') { alert("La bibliothèque de capture n'a pas pu être chargée (vérifie ta connexion internet)."); return; }
    screenshotBtn.disabled = true;
    screenshotBtn.textContent = 'Capture en cours...';
    const canvas = await html2canvas(rowsContainer, { backgroundColor: '#050912', scale: 2 });
    const link = document.createElement('a');
    const safeTitle = (state.title || 'tierlist').replace(/[^a-z0-9_\-]+/gi, '_');
    link.download = `${safeTitle}_capture.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    alert('Erreur lors de la capture : ' + err.message);
  }
  screenshotBtn.disabled = false;
  screenshotBtn.textContent = "📸 Capture d'écran";
});

newGameBtn.addEventListener('click', async () => {
  await fetch('/api/new-game', { method: 'POST' });
  window.location.href = '/setup.html';
});
