let joueurs = 1;
let chiffres = 4;
let difficulte = 'facile';
let repetition = 'unique';
let typeJeu = 'chiffres';

// --- Noms des joueurs : mémorisés dans le navigateur d'une partie à l'autre ---
const champNomSolo = document.getElementById('champ-nom-solo');
const champNom1 = document.getElementById('champ-nom1');
const champNom2 = document.getElementById('champ-nom2');

champNomSolo.value = localStorage.getItem('mastermind-slg:nomSolo') || '';
champNom1.value = localStorage.getItem('mastermind-slg:nom1') || '';
champNom2.value = localStorage.getItem('mastermind-slg:nom2') || '';

champNomSolo.addEventListener('input', () => localStorage.setItem('mastermind-slg:nomSolo', champNomSolo.value));
champNom1.addEventListener('input', () => localStorage.setItem('mastermind-slg:nom1', champNom1.value));
champNom2.addEventListener('input', () => localStorage.setItem('mastermind-slg:nom2', champNom2.value));

function majAffichageNoms() {
  document.getElementById('groupe-nom-solo').style.display = joueurs === 1 ? 'block' : 'none';
  document.getElementById('groupe-noms-duo').style.display = joueurs === 2 ? 'block' : 'none';
}

function activer(groupeId, valeur, callback) {
  document.querySelectorAll(`#${groupeId} .choix-btn`).forEach((btn) => {
    btn.classList.toggle('actif', btn.dataset.valeur === String(valeur));
  });
  callback(valeur);
}

document.querySelectorAll('#grp-joueurs .choix-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    joueurs = Number(btn.dataset.valeur);
    activer('grp-joueurs', joueurs, () => {});
    majAffichageNoms();
  });
});

// --- Longueur : 3 à 6 chiffres, ou 4 à 7 lettres selon le type de jeu ---
const grpChiffres = document.getElementById('grp-chiffres');

function construireLongueurs() {
  const [min, max] = typeJeu === 'mots' ? [4, 7] : [3, 6];
  if (chiffres < min || chiffres > max) chiffres = 4;
  grpChiffres.innerHTML = '';
  for (let n = min; n <= max; n++) {
    const btn = document.createElement('button');
    btn.className = 'choix-btn' + (n === chiffres ? ' actif' : '');
    btn.dataset.valeur = String(n);
    btn.textContent = String(n);
    btn.addEventListener('click', () => {
      chiffres = n;
      activer('grp-chiffres', chiffres, () => {});
    });
    grpChiffres.appendChild(btn);
  }
  document.getElementById('label-longueur').textContent = typeJeu === 'mots' ? 'Nombre de lettres' : 'Nombre de chiffres';
  document.getElementById('groupe-repetition').style.display = typeJeu === 'mots' ? 'none' : 'block';
  document.getElementById('info-type').textContent = typeJeu === 'mots'
    ? 'Trouvez un mot secret (lettres de A à Z, sans accent ; une lettre peut se répéter).'
    : 'Trouvez un nombre secret (chiffres de 0 à 9).';
}

document.querySelectorAll('#grp-type .choix-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    typeJeu = btn.dataset.valeur;
    activer('grp-type', typeJeu, () => {});
    construireLongueurs();
  });
});
construireLongueurs();

const infoDifficulte = document.getElementById('info-difficulte');
document.querySelectorAll('#grp-difficulte .choix-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    difficulte = btn.dataset.valeur;
    activer('grp-difficulte', difficulte, () => {});
    infoDifficulte.textContent = difficulte === 'facile'
      ? 'Facile : vert = bon chiffre bon endroit, orange = bon chiffre mauvais endroit, rouge = absent.'
      : 'Difficile : vert = chiffre présent dans le nombre, rouge = chiffre absent (la position n\'est pas indiquée).';
  });
});

const infoRepetition = document.getElementById('info-repetition');
document.querySelectorAll('#grp-repetition .choix-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    repetition = btn.dataset.valeur;
    activer('grp-repetition', repetition, () => {});
    infoRepetition.textContent = repetition === 'unique'
      ? "Chaque chiffre n'apparaît qu'une seule fois dans le nombre."
      : 'Un même chiffre peut apparaître plusieurs fois (ex : 11223).';
  });
});

majAffichageNoms();

document.getElementById('btn-lancer').addEventListener('click', async () => {
  const btn = document.getElementById('btn-lancer');
  const erreurDiv = document.getElementById('erreur-creation');
  erreurDiv.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Préparation...';
  try {
    const res = await fetch('/api/salons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: joueurs,
        digits: chiffres,
        difficulty: difficulte,
        repetition: repetition,
        type: typeJeu,
        name: champNomSolo.value,
        names: [champNom1.value, champNom2.value],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');

    // Chaque partie vit dans son propre salon (code à 4 caractères) : on
    // redirige directement vers le salon qui vient d'être créé.
    window.location.href = data.redirect;
  } catch (e) {
    erreurDiv.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lancer la partie';
  }
});

/* ---------------------------------------------------------------
   Rejoindre un salon existant depuis son code
--------------------------------------------------------------- */

const champCode = document.getElementById('champ-code-rejoindre');
const resultatRejoindre = document.getElementById('resultat-rejoindre');

async function rejoindreParCode() {
  const code = champCode.value.trim().toUpperCase();
  resultatRejoindre.innerHTML = '';
  if (!code) return;

  try {
    const res = await fetch(`/api/salons/${encodeURIComponent(code)}`);
    const data = await res.json();
    if (!data.existe) {
      resultatRejoindre.innerHTML = `<p class="info" style="color:#D33F49;">Aucun salon « ${code} ». Vérifiez le code.</p>`;
      return;
    }
    if (data.mode === 'solo') {
      resultatRejoindre.innerHTML = `<p class="info">Le salon « ${code} » est une partie solo, personnelle : <a class="retour" href="/${code}/solo">y accéder</a>.</p>`;
      return;
    }
    resultatRejoindre.innerHTML = `<p class="info">Salon « ${code} » trouvé : <a class="retour" href="/${code}">rejoindre le salon</a>.</p>`;
  } catch {
    resultatRejoindre.innerHTML = `<p class="info" style="color:#D33F49;">Serveur injoignable.</p>`;
  }
}

document.getElementById('btn-rejoindre').addEventListener('click', rejoindreParCode);
champCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') rejoindreParCode();
});
