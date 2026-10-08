// Logique pure de la roulette europeenne (aucune dependance, aucun etat) :
// numeros/couleurs, validation des mises, calcul des gains, statistiques.
// Utilisee par server.js ; les salons ne partagent aucun etat.

// ---------------------------------------------------------------------------
// Roulette constants
// ---------------------------------------------------------------------------
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function colorOf(n) {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

// Every 2x2 "corner" (carre) block on the classic 3x12 table, referenced by
// the 4 numbers it covers. Layout (row0=top=3,6,9..36 / row1=mid=2,5,8..35 / row2=bottom=1,4,7..34)
function buildGridNumbers() {
  const rows = [[], [], []]; // row0 top ... row2 bottom
  for (let col = 0; col < 12; col++) {
    const base = col * 3;
    rows[2][col] = base + 1; // bottom
    rows[1][col] = base + 2; // middle
    rows[0][col] = base + 3; // top
  }
  return rows;
}
const GRID = buildGridNumbers();

// Position of a number (1-36) on the table: column 1-12, and row 0(top)/1(mid)/2(bottom)
// matching GRID above (row0=3,6,9.. / row1=2,5,8.. / row2=1,4,7..)
function numberPos(n) {
  const col = Math.ceil(n / 3);
  const rem = n - (col - 1) * 3;
  const row = rem === 1 ? 2 : rem === 2 ? 1 : 0;
  return { col, row };
}

// ---------------------------------------------------------------------------
// Bet evaluation - full French/European roulette bet set
// key formats:
//   straight-<n>                     numero plein            x36
//   split-<a>-<b>                    cheval (2 adjacents, incl. 0-1/0-2/0-3) x18
//   trio-0-1-2 | trio-0-2-3          trio (3 numeros avec 0) x12
//   street-<col>                     transversale simple (3)  x12
//   doublestreet-<col>               transversale double (6)  x6
//   corner-a-b-c-d                   carre (4 numeros)        x9
//   column-<1|2|3>                   colonne (12 numeros)     x3
//   dozen-<1|2|3>                    tiers / douzaine (12)    x3
//   color-red | color-black          chance simple            x2
//   parity-even | parity-odd         chance simple            x2
//   range-low | range-high           manque(1-18)/passe(19-36) x2
// ---------------------------------------------------------------------------
function evaluateBet(key, amount, winNumber) {
  const winColor = colorOf(winNumber);
  if (key.startsWith('straight-')) {
    const n = parseInt(key.split('-')[1], 10);
    return n === winNumber ? amount * 36 : 0;
  }
  if (key.startsWith('split-')) {
    const nums = key.split('-').slice(1).map(Number);
    return nums.includes(winNumber) ? amount * 18 : 0;
  }
  if (key.startsWith('doublestreet-')) {
    const col = parseInt(key.split('-')[1], 10);
    const nums = [1,2,3,4,5,6].map(o => (col - 1) * 3 + o);
    return nums.includes(winNumber) ? amount * 6 : 0;
  }
  if (key.startsWith('street-')) {
    const col = parseInt(key.split('-')[1], 10);
    const nums = [1,2,3].map(o => (col - 1) * 3 + o);
    return nums.includes(winNumber) ? amount * 12 : 0;
  }
  if (key.startsWith('corner-')) {
    const nums = key.split('-').slice(1).map(Number);
    return nums.includes(winNumber) ? amount * 9 : 0;
  }
  if (key === 'trio-0-1-2') return [0, 1, 2].includes(winNumber) ? amount * 12 : 0;
  if (key === 'trio-0-2-3') return [0, 2, 3].includes(winNumber) ? amount * 12 : 0;
  if (key.startsWith('column-')) {
    if (winNumber === 0) return 0;
    const rem = parseInt(key.split('-')[1], 10); // 1, 2 or 3 (0 means "3")
    const winRem = winNumber % 3 === 0 ? 3 : winNumber % 3;
    return winRem === rem ? amount * 3 : 0;
  }
  if (key.startsWith('dozen-')) {
    if (winNumber === 0) return 0;
    const d = parseInt(key.split('-')[1], 10);
    const inDozen = winNumber >= (d - 1) * 12 + 1 && winNumber <= d * 12;
    return inDozen ? amount * 3 : 0;
  }
  if (key === 'color-red') return winColor === 'red' ? amount * 2 : 0;
  if (key === 'color-black') return winColor === 'black' ? amount * 2 : 0;
  if (key === 'parity-even') return (winNumber !== 0 && winNumber % 2 === 0) ? amount * 2 : 0;
  if (key === 'parity-odd') return (winNumber !== 0 && winNumber % 2 === 1) ? amount * 2 : 0;
  if (key === 'range-low') return (winNumber >= 1 && winNumber <= 18) ? amount * 2 : 0;
  if (key === 'range-high') return (winNumber >= 19 && winNumber <= 36) ? amount * 2 : 0;
  return 0;
}

function isValidBetKey(key) {
  if (key.startsWith('straight-')) {
    const n = parseInt(key.split('-')[1], 10);
    return Number.isInteger(n) && n >= 0 && n <= 36;
  }
  if (key.startsWith('split-')) {
    const parts = key.split('-').slice(1).map(Number);
    if (parts.length !== 2) return false;
    const [a, b] = parts;
    if (a === 0 || b === 0) {
      // 0 physically touches only 1, 2 and 3 on the table
      const other = a === 0 ? b : a;
      return a !== b && [1, 2, 3].includes(other);
    }
    if ([a, b].some(n => !Number.isInteger(n) || n < 1 || n > 36)) return false;
    const pa = numberPos(a), pb = numberPos(b);
    const sameColAdjacentRow = pa.col === pb.col && Math.abs(pa.row - pb.row) === 1;
    const sameRowAdjacentCol = pa.row === pb.row && Math.abs(pa.col - pb.col) === 1;
    return sameColAdjacentRow || sameRowAdjacentCol;
  }
  if (key.startsWith('doublestreet-')) {
    const col = parseInt(key.split('-')[1], 10);
    return Number.isInteger(col) && col >= 1 && col <= 11;
  }
  if (key.startsWith('street-')) {
    const col = parseInt(key.split('-')[1], 10);
    return Number.isInteger(col) && col >= 1 && col <= 12;
  }
  if (key.startsWith('corner-')) {
    const parts = key.split('-').slice(1);
    return parts.length === 4 && parts.every(p => Number.isInteger(parseInt(p, 10)));
  }
  if (key.startsWith('column-')) return ['column-1', 'column-2', 'column-3'].includes(key);
  if (key.startsWith('dozen-')) return ['dozen-1', 'dozen-2', 'dozen-3'].includes(key);
  if (key === 'trio-0-1-2' || key === 'trio-0-2-3') return true;
  if (key === 'color-red' || key === 'color-black') return true;
  if (key === 'parity-even' || key === 'parity-odd') return true;
  if (key === 'range-low' || key === 'range-high') return true;
  return false;
}

const CHIP_VALUES = [1, 2, 5, 10, 25, 50];

// The three "chances simples" pairs that each cover the entire non-zero
// range on their own: betting both sides at once is disallowed.
const OPPOSITE_BETS = {
  'color-red': 'color-black',
  'color-black': 'color-red',
  'parity-even': 'parity-odd',
  'parity-odd': 'parity-even',
  'range-low': 'range-high',
  'range-high': 'range-low'
};
const BET_LABELS = {
  'color-red': 'Rouge', 'color-black': 'Noir',
  'parity-even': 'Pair', 'parity-odd': 'Impair',
  'range-low': 'Manque (1-18)', 'range-high': 'Passe (19-36)'
};

function totalBetOf(p) {
  return Object.values(p.bets).reduce((a, b) => a + b, 0);
}

// hist = historique des tirages (le plus recent en premier), deja plafonne a 200.
function computeStats(hist) {
  const counts = new Array(37).fill(0);
  let red = 0, black = 0, green = 0, even = 0, odd = 0;
  const dozen = [0, 0, 0];

  hist.forEach(h => {
    counts[h.number]++;
    if (h.number === 0) {
      green++;
    } else {
      if (h.color === 'red') red++; else black++;
      if (h.number % 2 === 0) even++; else odd++;
      dozen[Math.ceil(h.number / 12) - 1]++;
    }
  });

  const total = hist.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  const arr = counts.map((c, n) => ({ n, c }));
  const hot = [...arr].sort((a, b) => b.c - a.c || a.n - b.n).slice(0, 5);
  const cold = [...arr].sort((a, b) => a.c - b.c || a.n - b.n).slice(0, 5);

  return {
    hot, cold, counts,
    percentages: {
      total,
      red, black, green,
      redPct: pct(red), blackPct: pct(black), greenPct: pct(green),
      even, odd, evenPct: pct(even), oddPct: pct(odd),
      dozen1: dozen[0], dozen2: dozen[1], dozen3: dozen[2],
      dozen1Pct: pct(dozen[0]), dozen2Pct: pct(dozen[1]), dozen3Pct: pct(dozen[2])
    }
  };
}

module.exports = {
  WHEEL_ORDER, RED_NUMBERS, colorOf, GRID, numberPos,
  evaluateBet, isValidBetKey, CHIP_VALUES, OPPOSITE_BETS, BET_LABELS,
  totalBetOf, computeStats
};
