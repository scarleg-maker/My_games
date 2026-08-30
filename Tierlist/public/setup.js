const rowCountInput = document.getElementById('rowCount');
const rowsConfigEl = document.getElementById('rowsConfig');
const maxPerRowSelect = document.getElementById('maxPerRow');
const modeRadios = document.querySelectorAll('input[name=mode]');
const multiBlock = document.getElementById('multiBlock');
const playerCountSelect = document.getElementById('playerCount');
const playersConfigEl = document.getElementById('playersConfig');
const suddenDeathBtn = document.getElementById('suddenDeathBtn');
const lastChanceBtn = document.getElementById('lastChanceBtn');
let suddenDeathActive = false;
let lastChanceActive = false;

function updateModeButtons() {
  suddenDeathBtn.classList.toggle('active', suddenDeathActive);
  lastChanceBtn.classList.toggle('active', lastChanceActive);
}
suddenDeathBtn.addEventListener('click', () => {
  suddenDeathActive = !suddenDeathActive;
  if (suddenDeathActive) lastChanceActive = false;
  updateModeButtons();
});
lastChanceBtn.addEventListener('click', () => {
  lastChanceActive = !lastChanceActive;
  if (lastChanceActive) suddenDeathActive = false;
  updateModeButtons();
});
const contentRadios = document.querySelectorAll('input[name=contentType]');
const zipBlock = document.getElementById('zipBlock');
const namesBlock = document.getElementById('namesBlock');

let lastPlayerNames = [];

// build 1..25 + Infini for max per row
for (let i = 1; i <= 25; i++) {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = i;
  maxPerRowSelect.appendChild(opt);
}
maxPerRowSelect.value = 'infini';

function defaultLabel(index) {
  if (index === 0) return 'S';
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return alphabet[(index - 1) % alphabet.length];
}

function rainbowColor(index, total) {
  const hue = total <= 1 ? 0 : (index / (total - 1)) * 240; // 0=rouge -> 240=bleu
  return hslToHex(hue, 80, 50);
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// keep custom edits when regenerating row count (only add/remove at the end)
function renderRowsConfig() {
  const total = Math.max(4, Math.min(25, parseInt(rowCountInput.value, 10) || 4));
  const existing = Array.from(rowsConfigEl.querySelectorAll('.row-config-item')).map(el => ({
    name: el.querySelector('.rname').value
  }));
  rowsConfigEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const prev = existing[i];
    const name = prev ? prev.name : defaultLabel(i);
    const color = rainbowColor(i, total); // always recomputed so the rainbow stays consistent when rows are added/removed
    const item = document.createElement('div');
    item.className = 'row-config-item';
    item.innerHTML = `
      <span class="pill">Ligne ${i + 1}</span>
      <input type="text" class="rname" value="${name.replace(/"/g, '&quot;')}" maxlength="20">
      <input type="color" class="rcolor" value="${color}">
    `;
    rowsConfigEl.appendChild(item);
  }
}
rowCountInput.addEventListener('input', renderRowsConfig);
renderRowsConfig();

// content type toggle
contentRadios.forEach(r => r.addEventListener('change', () => {
  const val = document.querySelector('input[name=contentType]:checked').value;
  zipBlock.style.display = val === 'zip' ? 'block' : 'none';
  namesBlock.style.display = val === 'names' ? 'block' : 'none';
}));

// mode toggle
modeRadios.forEach(r => r.addEventListener('change', () => {
  const val = document.querySelector('input[name=mode]:checked').value;
  multiBlock.style.display = val === 'multi' ? 'block' : 'none';
}));

function renderPlayersConfig() {
  const n = parseInt(playerCountSelect.value, 10);
  const existing = Array.from(playersConfigEl.querySelectorAll('.pname')).map(el => el.value);
  playersConfigEl.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const name = existing[i] || lastPlayerNames[i] || `Joueur ${i + 1}`;
    const item = document.createElement('div');
    item.className = 'row-config-item';
    item.innerHTML = `<span class="pill">J${i + 1}</span><input type="text" class="pname" value="${name.replace(/"/g, '&quot;')}" maxlength="30">`;
    playersConfigEl.appendChild(item);
  }
}
playerCountSelect.addEventListener('change', renderPlayersConfig);

// mutually exclusive mode buttons are handled above (updateModeButtons)

fetch('/api/last-players').then(r => r.json()).then(d => {
  lastPlayerNames = d.names || [];
  renderPlayersConfig();
}).catch(() => renderPlayersConfig());

document.getElementById('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';

  const title = document.getElementById('title').value.trim() || 'Ma Tier List';
  const rows = Array.from(rowsConfigEl.querySelectorAll('.row-config-item')).map(el => ({
    name: el.querySelector('.rname').value.trim() || '?',
    color: el.querySelector('.rcolor').value
  }));
  const maxPerRow = maxPerRowSelect.value;
  const mode = document.querySelector('input[name=mode]:checked').value;
  const contentType = document.querySelector('input[name=contentType]:checked').value;

  const fd = new FormData();
  fd.append('title', title);
  fd.append('rows', JSON.stringify(rows));
  fd.append('maxPerRow', maxPerRow);
  fd.append('mode', mode);

  if (contentType === 'zip') {
    const f = document.getElementById('zipfile').files[0];
    if (!f) { showError("Sélectionne une archive ZIP d'images."); return; }
    fd.append('zipfile', f);
  } else {
    const names = document.getElementById('namesList').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (names.length === 0) { showError('Ajoute au moins un nom.'); return; }
    fd.append('namesList', JSON.stringify(names));
  }

  if (mode === 'multi') {
    const players = Array.from(playersConfigEl.querySelectorAll('.pname')).map(el => el.value.trim() || 'Joueur');
    fd.append('players', JSON.stringify(players));
    fd.append('suddenDeath', suddenDeathActive ? 'true' : 'false');
    fd.append('lastChance', lastChanceActive ? 'true' : 'false');
  }

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Création en cours...';

  try {
    const res = await fetch('/api/setup', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Erreur inconnue.'); submitBtn.disabled = false; submitBtn.textContent = 'Valider et créer la partie'; return; }

    if (data.mode === 'solo') {
      window.location.href = data.redirect;
      return;
    }

    const resultBlock = document.getElementById('resultBlock');
    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = `
      <p>Partage un lien à chaque joueur (ouvre chacun dans un onglet différent) :</p>
      <div class="link-list">
        ${data.playerLinks.map(p => `<a href="${p.url}" target="_blank">${p.name} → localhost:9500${p.url}</a>`).join('')}
      </div>
      <p style="margin-top:14px;"><a href="/jeu.html" target="_blank">Ouvrir en mode spectateur / écran commun</a></p>
    `;
    resultBlock.style.display = 'block';
    resultBlock.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showError('Erreur réseau : ' + err.message);
  }
  submitBtn.disabled = false;
  submitBtn.textContent = 'Valider et créer la partie';
});

document.getElementById('replaceContentCb').addEventListener('change', () => {
  document.getElementById('replaceContentBlock').style.display =
    document.getElementById('replaceContentCb').checked ? 'block' : 'none';
});
document.querySelectorAll('input[name=loadContentType]').forEach(r => r.addEventListener('change', () => {
  const val = document.querySelector('input[name=loadContentType]:checked').value;
  document.getElementById('loadZipBlock').style.display = val === 'zip' ? 'block' : 'none';
  document.getElementById('loadNamesBlock').style.display = val === 'names' ? 'block' : 'none';
}));

document.getElementById('loadBtn').addEventListener('click', () => {
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';
  const f = document.getElementById('loadFile').files[0];
  if (!f) { showError('Sélectionne un fichier de sauvegarde (.txt).'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    let save;
    try {
      save = JSON.parse(e.target.result);
    } catch (err) {
      showError('Le fichier sélectionné n\'est pas une sauvegarde valide.');
      return;
    }

    const replaceContent = document.getElementById('replaceContentCb').checked;
    const fd = new FormData();
    fd.append('save', JSON.stringify(save));
    fd.append('replaceContent', replaceContent ? 'true' : 'false');

    if (replaceContent) {
      const contentType = document.querySelector('input[name=loadContentType]:checked').value;
      if (contentType === 'zip') {
        const zf = document.getElementById('loadZipFile').files[0];
        if (!zf) { showError('Sélectionne une nouvelle archive ZIP.'); return; }
        fd.append('zipfile', zf);
      } else {
        const names = document.getElementById('loadNamesList').value.split('\n').map(s => s.trim()).filter(Boolean);
        if (names.length === 0) { showError('Ajoute au moins un nom de remplacement.'); return; }
        fd.append('namesList', JSON.stringify(names));
      }
    }

    try {
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { showError(data.error || 'Impossible de charger cette sauvegarde.'); return; }

      if (data.mode === 'solo') {
        window.location.href = data.redirect;
        return;
      }

      const resultBlock = document.getElementById('resultBlock');
      const resultContent = document.getElementById('resultContent');
      resultContent.innerHTML = `
        <p>Partie rechargée ! Repartage un lien à chaque joueur :</p>
        <div class="link-list">
          ${data.playerLinks.map(p => `<a href="${p.url}" target="_blank">${p.name} → localhost:9500${p.url}</a>`).join('')}
        </div>
        <p style="margin-top:14px;"><a href="/jeu.html" target="_blank">Ouvrir en mode spectateur / écran commun</a></p>
      `;
      resultBlock.style.display = 'block';
      resultBlock.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showError('Erreur réseau : ' + err.message);
    }
  };
  reader.readAsText(f);
});

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth' });
}
