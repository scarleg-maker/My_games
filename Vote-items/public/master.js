(function () {
  const participantsEl = document.getElementById('participants');
  const itemsEl = document.getElementById('items');
  const participantsCountEl = document.getElementById('participants-count');
  const itemsCountEl = document.getElementById('items-count');
  const configMsg = document.getElementById('config-msg');

  const MAX_ITEMS = 30;

  function countLines(text) {
    return text.split('\n').map((s) => s.trim()).filter(Boolean).length;
  }

  function updateCounts() {
    participantsCountEl.textContent = countLines(participantsEl.value);
    const n = countLines(itemsEl.value);
    itemsCountEl.textContent = n;
    itemsCountEl.style.color = n > MAX_ITEMS ? '#ef4444' : '';
  }
  participantsEl.addEventListener('input', updateCounts);
  itemsEl.addEventListener('input', updateCounts);

  document.getElementById('btn-create').addEventListener('click', async () => {
    const participants = participantsEl.value.split('\n').map((s) => s.trim()).filter(Boolean);
    const items = itemsEl.value.split('\n').map((s) => s.trim()).filter(Boolean);

    if (items.length > MAX_ITEMS) {
      configMsg.textContent = `Maximum ${MAX_ITEMS} items (actuellement ${items.length}).`;
      configMsg.className = 'status-msg error';
      return;
    }
    if (participants.length === 0 || items.length === 0) {
      configMsg.textContent = 'Merci de renseigner au moins un participant et un item.';
      configMsg.className = 'status-msg error';
      return;
    }

    const proceed = state && state.configured
      ? confirm('Cela réinitialisera tous les votes déjà enregistrés. Continuer ?')
      : true;
    if (!proceed) return;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      configMsg.textContent = 'Session créée avec succès.';
      configMsg.className = 'status-msg success';
      editingConfig = false;
      document.getElementById('btn-cancel-edit').style.display = 'none';
      state = data;
      render();
    } catch (err) {
      configMsg.textContent = err.message;
      configMsg.className = 'status-msg error';
    }
  });

  document.getElementById('btn-edit-config').addEventListener('click', () => {
    editingConfig = true;
    document.getElementById('config-card').style.display = 'block';
    document.getElementById('btn-cancel-edit').style.display = 'inline-block';
    participantsEl.value = state.participants.join('\n');
    itemsEl.value = state.items.join('\n');
    configMsg.textContent = '';
    updateCounts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    editingConfig = false;
    document.getElementById('config-card').style.display = 'none';
    document.getElementById('btn-cancel-edit').style.display = 'none';
    configMsg.textContent = '';
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (!confirm('Réinitialiser complètement la session (participants, items et votes) ?')) return;
    const res = await fetch('/api/reset', { method: 'POST' });
    state = await res.json();
    participantsEl.value = '';
    itemsEl.value = '';
    updateCounts();
    render();
  });

  document.getElementById('restore-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const backupMsg = document.getElementById('backup-msg');
    if (!file) return;
    if (!confirm('Restaurer cette sauvegarde remplacera la session actuelle (participants, items et votes). Continuer ?')) {
      e.target.value = '';
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur de restauration');
      backupMsg.textContent = '✓ Sauvegarde restaurée avec succès.';
      backupMsg.className = 'status-msg success';
      editingConfig = false;
      state = json;
      render();
    } catch (err) {
      backupMsg.textContent = 'Impossible de restaurer ce fichier : ' + err.message;
      backupMsg.className = 'status-msg error';
    } finally {
      e.target.value = '';
    }
  });

  let state = null;
  let editingConfig = false; // true while the user has the config form open for editing

  function playerUrl(num) {
    return `${window.location.protocol}//${window.location.host}/joueur${num}`;
  }

  function render() {
    const configCard = document.getElementById('config-card');
    const summaryCard = document.getElementById('summary-card');
    const resultsCard = document.getElementById('results-card');

    if (!state.configured) {
      configCard.style.display = 'block';
      summaryCard.style.display = 'none';
      resultsCard.style.display = 'none';
      return;
    }

    // Une session existe déjà : ne pas toucher au formulaire de configuration
    // si l'utilisateur est en train de l'éditer (sinon le rafraîchissement
    // périodique referme le formulaire pendant la saisie).
    if (!editingConfig) {
      configCard.style.display = 'none';
    }
    summaryCard.style.display = 'block';
    resultsCard.style.display = 'block';

    document.getElementById('summary-participants-count').textContent = state.participants.length;
    document.getElementById('summary-items-count').textContent = state.items.length;

    const statusBody = document.getElementById('status-body');
    statusBody.innerHTML = '';
    state.status.forEach((p) => {
      const tr = document.createElement('tr');
      const pct = p.total > 0 ? Math.round((p.answered / p.total) * 100) : 0;
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td><div class="link-box"><a href="/joueur${p.num}" target="_blank">/joueur${p.num}</a></div></td>
        <td style="min-width:140px">
          ${p.answered}/${p.total}
          <div class="progress-bar"><div style="width:${pct}%"></div></div>
        </td>
        <td>${p.validated ? '<span class="badge ok">Validé</span>' : '<span class="badge pending">En cours</span>'}</td>
        <td>${p.validated ? `<button class="btn-secondary btn-small" data-unlock="${p.num}">Déverrouiller</button>` : ''}</td>
      `;
      statusBody.appendChild(tr);
    });

    statusBody.querySelectorAll('[data-unlock]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const num = btn.getAttribute('data-unlock');
        if (!confirm('Déverrouiller ce participant pour lui permettre de modifier ses votes ?')) return;
        await fetch(`/api/player/${num}/unlock`, { method: 'POST' });
        await refresh();
      });
    });

    document.getElementById('all-validated-banner').style.display = state.allValidated ? 'block' : 'none';

    // Résultats
    const head = document.getElementById('results-head');
    head.innerHTML = '<th>Item</th>' + state.participants.map((n) => `<th>${escapeHtml(n)}</th>`).join('') + '<th>Moyenne</th><th>Réponses</th>';

    const body = document.getElementById('results-body');
    body.innerHTML = '';
    state.results.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.highlight) tr.className = row.highlight;
      const cells = state.participants.map((n) => {
        const v = row.values[n];
        return `<td>${v === null || v === undefined ? '<span class="muted">–</span>' : v}</td>`;
      }).join('');
      tr.innerHTML = `<td>${escapeHtml(row.label)}</td>${cells}<td><strong>${row.average === null ? '–' : row.average.toFixed(2)}</strong></td><td class="muted">${row.count}/${state.participants.length}</td>`;
      body.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function refresh() {
    try {
      const res = await fetch('/api/state');
      state = await res.json();
      render();
    } catch (err) {
      // silencieux : nouvelle tentative au prochain intervalle
    }
  }

  refresh();
  setInterval(refresh, 3000);
})();
