const numPlayersInput = document.getElementById('numPlayers');
const playerNamesDiv = document.getElementById('playerNames');
const numThemesInput = document.getElementById('numThemes');
const themesGridDiv = document.getElementById('themesGrid');
const themesInfo = document.getElementById('themesInfo');
const createBtn = document.getElementById('createBtn');
const errorMsg = document.getElementById('errorMsg');
const linksPanel = document.getElementById('linksPanel');
const linkList = document.getElementById('linkList');

let availableThemes = [];
let customThemes = [];
let selectedThemes = new Set();

function allThemes() {
  return [...availableThemes, ...customThemes];
}

function renderPlayerNames() {
  let n = parseInt(numPlayersInput.value, 10);
  if (isNaN(n)) n = 2;
  n = Math.max(2, Math.min(25, n));
  numPlayersInput.value = n;

  const existing = Array.from(playerNamesDiv.querySelectorAll('input')).map(i => i.value);
  playerNamesDiv.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const wrap = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = `Joueur ${i + 1}`;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Nom du joueur ${i + 1}`;
    input.value = existing[i] || '';
    input.dataset.idx = i;
    wrap.appendChild(label);
    wrap.appendChild(input);
    playerNamesDiv.appendChild(wrap);
  }
}

function renderThemes() {
  let max = parseInt(numThemesInput.value, 10);
  if (isNaN(max)) max = 2;
  max = Math.max(2, Math.min(10, max));
  numThemesInput.value = max;

  // Trim selection if it exceeds new max
  if (selectedThemes.size > max) {
    selectedThemes = new Set(Array.from(selectedThemes).slice(0, max));
  }

  themesGridDiv.innerHTML = '';
  allThemes().forEach(theme => {
    const chip = document.createElement('div');
    chip.className = 'theme-chip';
    const isCustom = customThemes.includes(theme);
    chip.textContent = theme + (isCustom ? ' ✎' : '');
    if (isCustom) chip.classList.add('custom');
    const isSelected = selectedThemes.has(theme);
    if (isSelected) chip.classList.add('selected');
    if (!isSelected && selectedThemes.size >= max) chip.classList.add('disabled');

    chip.addEventListener('click', () => {
      if (selectedThemes.has(theme)) {
        selectedThemes.delete(theme);
      } else {
        if (selectedThemes.size >= max) return;
        selectedThemes.add(theme);
      }
      renderThemes();
    });
    themesGridDiv.appendChild(chip);
  });

  themesInfo.textContent = `${selectedThemes.size} / ${max} thèmes sélectionnés`;
}

numPlayersInput.addEventListener('input', renderPlayerNames);
numThemesInput.addEventListener('input', renderThemes);

fetch('/api/themes')
  .then(r => r.json())
  .then(themes => {
    availableThemes = themes;
    renderThemes();
  });

renderPlayerNames();

const customThemeInput = document.getElementById('customThemeInput');
const addCustomThemeBtn = document.getElementById('addCustomThemeBtn');

function addCustomTheme() {
  errorMsg.textContent = '';
  const raw = customThemeInput.value.trim();
  if (!raw) return;

  const exists = allThemes().some(t => t.toLowerCase() === raw.toLowerCase());
  if (exists) {
    errorMsg.textContent = `Le thème "${raw}" existe déjà dans la liste.`;
    return;
  }

  customThemes.push(raw);
  customThemeInput.value = '';

  const max = parseInt(numThemesInput.value, 10) || 2;
  if (selectedThemes.size < max) {
    selectedThemes.add(raw);
  }
  renderThemes();
  customThemeInput.focus();
}

addCustomThemeBtn.addEventListener('click', addCustomTheme);
customThemeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCustomTheme();
  }
});

createBtn.addEventListener('click', async () => {
  errorMsg.textContent = '';
  const playerInputs = Array.from(playerNamesDiv.querySelectorAll('input'));
  const playerNames = playerInputs.map((inp, i) => inp.value.trim() || `Joueur ${i + 1}`);
  const themes = Array.from(selectedThemes);
  const timePerRound = document.getElementById('timePerRound').value;

  const maxThemes = parseInt(numThemesInput.value, 10);
  if (themes.length !== maxThemes) {
    errorMsg.textContent = `Merci de sélectionner exactement ${maxThemes} thème(s).`;
    return;
  }

  try {
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerNames, themes, timePerRound })
    });
    const data = await res.json();
    if (!res.ok) {
      errorMsg.textContent = data.error || 'Erreur.';
      return;
    }

    const base = `${location.protocol}//${location.host}`;
    linkList.innerHTML = '';
    for (let i = 1; i <= data.numPlayers; i++) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = playerNames[i - 1];
      const a = document.createElement('a');
      a.href = `${base}/joueur${i}`;
      a.target = '_blank';
      a.textContent = `${base}/joueur${i}`;
      li.appendChild(label);
      li.appendChild(a);
      linkList.appendChild(li);
    }
    linksPanel.style.display = 'block';
    linksPanel.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    errorMsg.textContent = 'Impossible de contacter le serveur.';
  }
});
