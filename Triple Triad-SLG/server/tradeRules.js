'use strict';

/**
 * Applique la règle de mise en fin de duel.
 * winnerOriginalDeck / loserOriginalDeck: les 5 cartes de départ de chaque joueur pour ce duel
 *   (toujours exactement 5 : la main réellement distribuée, pas le pool complet de l'adversaire).
 *   Une carte y figure même si elle n'a jamais été posée sur le plateau (le joueur qui commence en
 *   second ne place que 4 de ses 5 cartes) : elle reste éligible aux règles de mise ci-dessous,
 *   puisqu'elle faisait bien partie du jeu de ce joueur pour cette partie.
 *
 * tradeRule: 'none' | 'one' | 'direct' | 'diff' | 'all'
 * Retourne { winnerGains: [cardId...], loserGains: [cardId...] }
 * (loserGains reste vide sauf égalité gérée ailleurs)
 */
function applyTradeRule(tradeRule, { winnerOriginalDeck, loserOriginalDeck, scoreWinner, scoreLoser }) {
  const result = { winnerGains: [], loserGains: [] };

  switch (tradeRule) {
    case 'none':
      break;

    case 'one': {
      // Le gagnant prend 1 carte aléatoire parmi les 5 cartes de départ du perdant.
      const pick = loserOriginalDeck[Math.floor(Math.random() * loserOriginalDeck.length)];
      result.winnerGains.push(pick);
      break;
    }

    case 'direct': {
      // Le gagnant garde les cartes du perdant qu'il a effectivement capturées (géré côté appelant)
      // Ici on retourne un marqueur, la logique fine est faite par le serveur avec l'état du plateau.
      result.mode = 'direct';
      break;
    }

    case 'diff': {
      // Le nombre de cartes échangées = différence de score, piochées parmi les 5 cartes de départ
      // du perdant.
      const n = Math.max(1, Math.min(5, scoreWinner - scoreLoser));
      const shuffled = [...loserOriginalDeck].sort(() => Math.random() - 0.5);
      result.winnerGains.push(...shuffled.slice(0, n));
      break;
    }

    case 'all': {
      // Les 5 cartes de départ du perdant.
      result.winnerGains.push(...loserOriginalDeck);
      break;
    }

    default:
      break;
  }

  return result;
}

module.exports = { applyTradeRule };
