const PLAYER = window.PLAYER;

const boardGrid = document.getElementById('board-grid');
const boardWrap = document.querySelector('.board-wrap');
const lockedOverlay = document.getElementById('locked-overlay');
const turnStatus = document.getElementById('turn-status');
const playerBadge = document.getElementById('player-badge');
const mysteryFrame = document.getElementById('mystery-frame');
const mysteryName = document.getElementById('mystery-name');
const choixBtn = document.getElementById('choix-btn');
const eliminateBtn = document.getElementById('eliminate-btn');
const endTurnBtn = document.getElementById('end-turn-btn');
const proposeToggleBtn = document.getElementById('propose-toggle-btn');
const guessHint = document.getElementById('guess-hint');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');
const countdownLabel = document.getElementById('countdown-label');
const winnerBanner = document.getElementById('winner-banner');
const winnerText = document.getElementById('winner-text');
const toast = document.getElementById('toast');
const confirmOverlay = document.getElementById('confirm-overlay');
const confirmMessage = document.getElementById('confirm-message');
const confirmYes = document.getElementById('confirm-yes');
const confirmNo = document.getElementById('confirm-no');

let selectedCards = new Set();   // sélection multiple pour l'élimination groupée
let guessMode = false;           // mode "proposer un suspect"
let countdownStarted = false;
let lastMessage = null;
let nameSet = false;
let lastFit = { cols: null, rows: null, w: null, h: null };
let lastBoard = [];
let lastPhotoRatio = null;
let lastCols = 6;
let lastPhase = 'setup';
let lastIsYourTurn = false;

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

/* Modale de confirmation générique (remplace window.confirm pour rester dans le style de l'appli) */
function askConfirm(message) {
  return new Promise(resolve => {
    confirmMessage.textContent = message;
    confirmOverlay.style.display = 'flex';
    function cleanup(result) {
      confirmOverlay.style.display = 'none';
      confirmYes.removeEventListener('click', onYes);
      confirmNo.removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    confirmYes.addEventListener('click', onYes);
    confirmNo.addEventListener('click', onNo);
  });
}

function renderBoard(board, cols, isYourTurn, phase) {
  lastBoard = board;
  lastCols = cols;
  lastPhase = phase;
  lastIsYourTurn = isYourTurn;
  boardGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  boardGrid.innerHTML = '';
  board.forEach(card => {
    const el = document.createElement('div');
    const canClickElim = phase === 'playing' && isYourTurn && !guessMode;
    const canClickGuess = phase === 'playing' && isYourTurn && guessMode && !card.eliminated;
    el.className = 'card'
      + (card.eliminated ? ' eliminated' : '')
      + (selectedCards.has(card.name) && !guessMode ? ' selected' : '')
      + (guessMode && !card.eliminated ? ' guessable' : '');
    el.innerHTML = `
      <div class="photo"><img src="/images/${encodeURIComponent(card.file)}" alt="${card.name}"></div>
      <div class="name">${card.name}</div>
    `;
    el.addEventListener('click', async () => {
      if (guessMode) {
        if (!canClickGuess) return;
        const ok = await askConfirm(`Veux-tu proposer « ${card.name} » ?`);
        if (!ok) return;
        guessMode = false;
        updateProposeToggleUI();
        try {
          const res = await fetch('/api/guess', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player: PLAYER, name: card.name })
          });
          const data = await res.json();
          if (data.ok && !data.correct) {
            showToast('Mauvaise réponse — tour passé à l\'adversaire.');
          }
        } catch (e) { /* ignore, poll() reconciliera l'état */ }
      } else {
        if (!canClickElim) return;
        if (selectedCards.has(card.name)) {
          selectedCards.delete(card.name);
        } else {
          selectedCards.add(card.name);
        }
        renderBoard(board, cols, isYourTurn, phase);
        eliminateBtn.disabled = selectedCards.size === 0;
      }
    });
    boardGrid.appendChild(el);
  });
  fitBoard(cols, board.length / cols);
}

/* Redimensionne (dézoome si besoin) le plateau pour qu'il tienne toujours
   entièrement sur l'écran, sans défilement. */
function fitBoard(cols, rows) {
  const w = window.innerWidth, h = window.innerHeight;
  if (lastFit.cols === cols && lastFit.rows === rows && lastFit.w === w && lastFit.h === h) return;
  lastFit = { cols, rows, w, h };

  boardGrid.style.transform = 'scale(1)';
  const naturalColWidth = 130;
  boardGrid.style.width = (cols * naturalColWidth + (cols - 1) * 10) + 'px';

  requestAnimationFrame(() => {
    const naturalWidth = boardGrid.scrollWidth;
    const naturalHeight = boardGrid.scrollHeight;
    const availWidth = boardWrap.clientWidth - 8;
    const availHeight = boardWrap.clientHeight - 8;
    const scale = Math.min(1, availWidth / naturalWidth, availHeight / naturalHeight);
    boardGrid.style.transform = `scale(${scale})`;
  });
}

function updateProposeToggleUI() {
  proposeToggleBtn.classList.toggle('btn-toggle-active', guessMode);
  proposeToggleBtn.textContent = guessMode ? 'Annuler la proposition' : 'Proposer un suspect';
  guessHint.style.display = guessMode ? 'block' : 'none';
  renderBoard(lastBoard, lastCols, lastIsYourTurn, lastPhase);
}

function runCountdown() {
  if (countdownStarted) return;
  countdownStarted = true;
  countdownOverlay.style.display = 'flex';
  countdownLabel.textContent = 'LA PARTIE COMMENCE…';
  let n = 3;
  countdownNumber.textContent = n;
  const interval = setInterval(() => {
    n -= 1;
    if (n > 0) {
      countdownNumber.textContent = n;
    } else {
      clearInterval(interval);
      countdownLabel.textContent = 'C\'EST PARTI !';
      countdownNumber.textContent = '▸';
      setTimeout(async () => {
        countdownOverlay.style.display = 'none';
        await fetch('/api/confirm_start', { method: 'POST' });
      }, 300);
    }
  }, 1000); // 3 x 1s = 3 secondes entre le choix et le début de la partie
}

async function poll() {
  try {
    const res = await fetch(`/api/state?player=${PLAYER}`);
    const s = await res.json();

    // Noms des joueurs
    if (s.your_name && !nameSet) {
      playerBadge.textContent = s.your_name.toUpperCase();
      nameSet = true;
    }

    // Ratio réel des portraits (tous identiques après normalisation côté serveur) :
    // fixe la forme des cases instantanément, sans attendre le chargement des images.
    if (s.photo_ratio && s.photo_ratio !== lastPhotoRatio) {
      document.documentElement.style.setProperty('--photo-ratio', s.photo_ratio);
      lastPhotoRatio = s.photo_ratio;
      lastFit = { cols: null, rows: null, w: null, h: null }; // force un recalcul du dézoom
    }

    if (!s.is_your_turn && guessMode) {
      guessMode = false; // le mode proposition ne survit pas à la fin du tour
    }

    // Plateau
    renderBoard(s.board, s.cols || 6, s.is_your_turn, s.phase);

    // Panneau mystère (personnage secret que CE joueur doit faire deviner)
    if (s.choix_fait && s.mystery) {
      const found = s.board.find(c => c.name === s.mystery);
      mysteryFrame.innerHTML = found
        ? `<img src="/images/${encodeURIComponent(found.file)}" alt="${found.name}">`
        : '<div class="mystery-placeholder">Chargement…</div>';
      mysteryName.textContent = s.mystery;
      choixBtn.disabled = true;
      choixBtn.textContent = 'Personnage choisi';
    } else {
      mysteryFrame.innerHTML = '<div class="mystery-placeholder">En attente du choix…</div>';
      mysteryName.textContent = '—';
      choixBtn.disabled = s.phase !== 'ready';
    }
    choixBtn.style.display = (s.phase === 'playing' || s.phase === 'finished') ? 'none' : 'block';

    // Statut du tour
    const oppName = s.opponent_name || 'l\'adversaire';
    if (s.phase === 'setup' || !s.rows) {
      turnStatus.textContent = 'En attente de la création de la partie…';
    } else if (s.phase === 'ready') {
      turnStatus.textContent = s.choix_fait
        ? `En attente de ${oppName}…`
        : 'Clique sur « Choix » pour désigner ton personnage secret.';
    } else if (s.phase === 'countdown') {
      turnStatus.textContent = 'La partie va commencer…';
      runCountdown();
    } else if (s.phase === 'playing') {
      turnStatus.textContent = s.is_your_turn ? 'À toi de jouer !' : `Tour de ${oppName}.`;
    } else if (s.phase === 'finished') {
      turnStatus.textContent = 'Partie terminée.';
    }

    // Verrouillage du plateau
    lockedOverlay.style.display = (s.phase === 'playing' && !s.is_your_turn) ? 'flex' : 'none';

    // Boutons d'action (toujours visibles, activés/désactivés selon l'état)
    const canAct = s.phase === 'playing' && s.is_your_turn;
    endTurnBtn.disabled = !canAct;
    eliminateBtn.disabled = !canAct || guessMode || selectedCards.size === 0;
    if (!s.is_your_turn) { selectedCards.clear(); }

    // Bouton "Proposer un suspect" : visible à partir de la fin du 6e tour
    proposeToggleBtn.style.display = s.can_guess ? 'block' : 'none';
    proposeToggleBtn.disabled = !canAct;
    if (!s.can_guess && guessMode) { guessMode = false; }
    updateProposeToggleUI();

    // Message / toast
    if (s.message && s.message !== lastMessage) {
      showToast(s.message);
      lastMessage = s.message;
    }

    // Fin de partie
    if (s.phase === 'finished') {
      winnerBanner.style.display = 'flex';
      winnerText.textContent = (s.winner === PLAYER)
        ? 'Tu as gagné !'
        : `${s.winner_name || 'L\'adversaire'} a gagné.`;
    }
  } catch (e) {
    turnStatus.textContent = 'Connexion au serveur perdue…';
  }
}

choixBtn.addEventListener('click', async () => {
  choixBtn.disabled = true;
  await fetch('/api/choix', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player: PLAYER }) });
});

eliminateBtn.addEventListener('click', async () => {
  if (selectedCards.size === 0) return;
  await fetch('/api/eliminate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player: PLAYER, names: Array.from(selectedCards) })
  });
  selectedCards.clear();
});

proposeToggleBtn.addEventListener('click', () => {
  guessMode = !guessMode;
  selectedCards.clear();
  updateProposeToggleUI();
});

endTurnBtn.addEventListener('click', async () => {
  if (endTurnBtn.disabled) return;
  const ok = await askConfirm('Terminer ton tour ?');
  if (!ok) return;
  guessMode = false;
  selectedCards.clear();
  updateProposeToggleUI();
  endTurnBtn.disabled = true;
  await fetch('/api/end_turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player: PLAYER }) });
});

window.addEventListener('resize', () => { lastFit = { cols: null, rows: null, w: null, h: null }; });

poll();
setInterval(poll, 1000);
