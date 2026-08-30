'use strict';

/**
 * Applique la règle de mise en fin de duel.
 * winnerHand / loserHand: cartes encore "possédées" par chaque joueur pour ce duel
 *   (les 5 cartes de départ, indépendamment de qui les contrôle sur le plateau à la fin).
 * capturedByWinner: cartes du perdant capturées pendant la partie (celles restées côté gagnant sur le plateau)
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
      // Le gagnant prend 1 carte aléatoire du perdant
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
      // Le nombre de cartes échangées = différence de score
      const n = Math.max(1, Math.min(5, scoreWinner - scoreLoser));
      const shuffled = [...loserOriginalDeck].sort(() => Math.random() - 0.5);
      result.winnerGains.push(...shuffled.slice(0, n));
      break;
    }

    case 'all': {
      result.winnerGains.push(...loserOriginalDeck);
      break;
    }

    default:
      break;
  }

  return result;
}

module.exports = { applyTradeRule };
