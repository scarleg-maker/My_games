let joueurs = 1;
let chiffres = 4;
let difficulte = 'facile';
let repetition = 'unique';

// --- Noms des joueurs : mémorisés dans le navigateur d'une partie à l'autre ---
const champNomSolo = document.getElementById('champ-nom-solo');
const champNom1 = document.getElementById('champ-nom1');
const champNom2 = document.getElementById('champ-nom2');

champNomSolo.value = localStorage.getItem('mastermind:nomSolo') || '';
champNom1.value = localStorage.getItem('mastermind:nom1') || '';
champNom2.value = localStorage.getItem('mastermind:nom2') || '';

champNomSolo.addEventListener('input', () => localStorage.setItem('mastermind:nomSolo', champNomSolo.value));
champNom1.addEventListener('input', () => localStorage.setItem('mastermind:nom1', champNom1.value));
champNom2.addEventListener('input', () => localStorage.setItem('mastermind:nom2', champNom2.value));

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

document.querySelectorAll('#grp-chiffres .choix-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    chiffres = Number(btn.dataset.valeur);
    activer('grp-chiffres', chiffres, () => {});
  });
});

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
  btn.disabled = true;
  btn.textContent = 'Préparation...';
  try {
    const res = await fetch('/api/new-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: joueurs,
        digits: chiffres,
        difficulty: difficulte,
        repetition: repetition,
        name: champNomSolo.value,
        names: [champNom1.value, champNom2.value],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');

    if (data.mode === 'solo') {
      window.location.href = data.redirect;
      return;
    }

    const carte = document.getElementById('carte-liens');
    const liste = document.getElementById('liens-joueurs');
    liste.innerHTML = '';
    data.links.forEach((lien, i) => {
      const a = document.createElement('a');
      a.href = lien;
      a.target = '_blank';
      a.textContent = `Joueur ${i + 1} → ${lien}`;
      liste.appendChild(a);
    });
    carte.style.display = 'block';
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Lancer la partie';
  }
});
