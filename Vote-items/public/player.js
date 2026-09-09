(function () {
  const num = window.location.pathname.match(/\/joueur(\d+)/)[1];
  let data = null;
  let saveTimers = {};
  let pendingSaves = 0;

  const subtitleEl = document.getElementById('player-subtitle');
  const errorCard = document.getElementById('error-card');
  const errorMsg = document.getElementById('error-msg');
  const lockedBanner = document.getElementById('locked-banner');
  const content = document.getElementById('content');
  const itemsList = document.getElementById('items-list');
  const answeredCountEl = document.getElementById('answered-count');
  const totalCountEl = document.getElementById('total-count');
  const progressFill = document.getElementById('progress-fill');
  const saveMsg = document.getElementById('save-msg');
  const validateHint = document.getElementById('validate-hint');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function load() {
    try {
      const res = await fetch(`/api/player/${num}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      data = json;
      subtitleEl.textContent = `Bonjour ${data.name} — /joueur${data.num}`;
      document.title = `Vote_items — ${data.name}`;
      content.style.display = 'block';
      lockedBanner.style.display = data.validated ? 'block' : 'none';
      renderItems();
      updateProgress();
    } catch (err) {
      errorCard.style.display = 'block';
      errorMsg.textContent = err.message;
    }
  }

  function renderItems() {
    itemsList.innerHTML = '';
    data.items.forEach((label, i) => {
      const value = data.values[i];
      const answered = typeof value === 'number';
      const div = document.createElement('div');
      div.className = 'item-row ' + (answered ? 'answered' : 'unanswered');
      div.dataset.index = i;

      const displayValue = answered ? value : 0;

      div.innerHTML = `
        <div class="item-title">
          <span>${i + 1}. ${escapeHtml(label)}</span>
          <span class="value-display">${answered ? formatVal(value) : '—'}</span>
        </div>
        <div class="slider-row">
          <button type="button" class="step-btn" data-action="minus">−</button>
          <input type="range" min="${data.min}" max="${data.max}" step="${data.step}" value="${displayValue}" ${data.validated ? 'disabled' : ''}>
          <button type="button" class="step-btn" data-action="plus">+</button>
        </div>
      `;
      itemsList.appendChild(div);

      const slider = div.querySelector('input[type=range]');
      const valueDisplay = div.querySelector('.value-display');
      const minusBtn = div.querySelector('[data-action=minus]');
      const plusBtn = div.querySelector('[data-action=plus]');

      function applyVote(v) {
        v = Math.max(data.min, Math.min(data.max, v));
        slider.value = v;
        valueDisplay.textContent = formatVal(v);
        div.classList.remove('unanswered');
        div.classList.add('answered');
        data.values[i] = v;
        scheduleSave(i, v);
      }

      slider.addEventListener('input', () => applyVote(parseFloat(slider.value)));
      minusBtn.addEventListener('click', () => applyVote(parseFloat(slider.value) - data.step));
      plusBtn.addEventListener('click', () => applyVote(parseFloat(slider.value) + data.step));
      if (data.validated) {
        minusBtn.disabled = true;
        plusBtn.disabled = true;
      }
    });
  }

  function formatVal(v) {
    return Number(v).toFixed(1).replace(/\.0$/, '');
  }

  function updateProgress() {
    const answered = data.values.filter((v) => typeof v === 'number').length;
    const total = data.items.length;
    answeredCountEl.textContent = answered;
    totalCountEl.textContent = total;
    progressFill.style.width = total > 0 ? Math.round((answered / total) * 100) + '%' : '0%';

    const btnValidate = document.getElementById('btn-validate');
    if (data.validated) {
      btnValidate.disabled = true;
      btnValidate.textContent = '✅ Votes validés';
      validateHint.textContent = '';
    } else if (answered < total) {
      btnValidate.disabled = true;
      validateHint.textContent = `Il reste ${total - answered} item(s) à voter avant de pouvoir valider.`;
    } else {
      btnValidate.disabled = false;
      validateHint.textContent = 'Une fois validé, vous ne pourrez plus modifier vos votes (sauf déverrouillage par l\'organisateur).';
    }
  }

  function scheduleSave(index, value) {
    clearTimeout(saveTimers[index]);
    saveMsg.textContent = 'Enregistrement…';
    saveMsg.className = 'status-msg';
    saveTimers[index] = setTimeout(() => doSave(index, value), 350);
  }

  async function doSave(index, value) {
    pendingSaves++;
    try {
      const res = await fetch(`/api/player/${num}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: index, value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur de sauvegarde');
      saveMsg.textContent = '✓ Enregistré — vous pouvez fermer et revenir plus tard.';
      saveMsg.className = 'status-msg success';
    } catch (err) {
      saveMsg.textContent = err.message;
      saveMsg.className = 'status-msg error';
    } finally {
      pendingSaves--;
      updateProgress();
    }
  }

  document.getElementById('btn-save').addEventListener('click', () => {
    // Les votes sont déjà sauvegardés automatiquement ; ce bouton confirme visuellement.
    saveMsg.textContent = pendingSaves > 0 ? 'Enregistrement en cours…' : '✓ Tout est enregistré.';
    saveMsg.className = 'status-msg success';
  });

  document.getElementById('btn-validate').addEventListener('click', async () => {
    if (!confirm('Valider définitivement vos votes ? Vous ne pourrez plus les modifier ensuite.')) return;
    try {
      const res = await fetch(`/api/player/${num}/validate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
      data.validated = true;
      lockedBanner.style.display = 'block';
      renderItems();
      updateProgress();
    } catch (err) {
      saveMsg.textContent = err.message;
      saveMsg.className = 'status-msg error';
    }
  });

  load();
})();
