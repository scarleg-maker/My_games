/**
 * Sphere Break — solveur d'indice.
 *
 * Le plateau ne comporte jamais plus de ~16 jetons en jeu (4 jetons d'entrée +
 * 12 jetons de bord maximum), donc une recherche exhaustive de tous les
 * sous-ensembles (2^16 = 65536 au pire) est instantanée. Le solveur sert
 * uniquement au bouton "Indice" : il ne joue jamais à la place du joueur.
 */

const SphereSolver = (() => {

  /**
   * @param {Array} entryCoins  [{id, value}] toujours disponibles
   * @param {Array} borderCoins [{id, value}] jetons de bord encore en jeu
   * @param {number} coreNumber le nombre tiré ce tour
   * @returns {{ids: string[], sum: number, multiplier: number} | null}
   *          la combinaison valide qui utilise le plus de jetons de bord
   *          (donc qui rapporte le plus de quota), ou null si aucune n'existe.
   */
  function findBestCombo(entryCoins, borderCoins, coreNumber) {
    if (!coreNumber) return null;

    let best = null;

    // On explore les sous-ensembles de jetons de bord (masque binaire),
    // puis pour chacun on essaie d'ajouter un jeton d'entrée qui complète
    // la somme jusqu'à un multiple du coreNumber.
    const n = borderCoins.length;
    const total = 1 << n;

    for (let mask = 0; mask < total; mask++) {
      let borderSum = 0;
      const usedBorderIds = [];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          borderSum += borderCoins[i].value;
          usedBorderIds.push(borderCoins[i].id);
        }
      }

      for (const entry of entryCoins) {
        const sum = borderSum + entry.value;
        if (sum > 0 && sum % coreNumber === 0) {
          if (!best || usedBorderIds.length > best.borderCount) {
            best = {
              ids: [entry.id, ...usedBorderIds],
              sum,
              multiplier: sum / coreNumber,
              borderCount: usedBorderIds.length
            };
          }
        }
      }
    }

    if (!best) return null;
    return { ids: best.ids, sum: best.sum, multiplier: best.multiplier };
  }

  return { findBestCombo };
})();
