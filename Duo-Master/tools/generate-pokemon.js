#!/usr/bin/env node
/*
 * Génère themes/pokemon.json (noms français, types actuels) à partir des CSV de PokeAPI.
 *
 *   node tools/generate-pokemon.js            -> télécharge les CSV depuis GitHub
 *   CSV_DIR=/chemin/vers/csv node tools/generate-pokemon.js   -> utilise des CSV déjà présents
 *
 * Les formes alternatives (Méga, Alola, Galar, Hisui, Paldea, Motisma...) sont ajoutées
 * uniquement si leurs types diffèrent de ceux de l'espèce de base.
 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const OUT = path.join(__dirname, '..', 'themes', 'pokemon.json');
const FR = '5'; // local_language_id du français

const TYPES = [
  { id: 'Normal',   label: 'Normal',   color: '#A8A878', emoji: '⚪' },
  { id: 'Feu',      label: 'Feu',      color: '#F08030', emoji: '🔥' },
  { id: 'Eau',      label: 'Eau',      color: '#6890F0', emoji: '💧' },
  { id: 'Plante',   label: 'Plante',   color: '#78C850', emoji: '🌿' },
  { id: 'Électrik', label: 'Électrik', color: '#F8D030', emoji: '⚡' },
  { id: 'Glace',    label: 'Glace',    color: '#98D8D8', emoji: '❄️' },
  { id: 'Combat',   label: 'Combat',   color: '#C03028', emoji: '🥊' },
  { id: 'Poison',   label: 'Poison',   color: '#A040A0', emoji: '☠️' },
  { id: 'Sol',      label: 'Sol',      color: '#E0C068', emoji: '⛰️' },
  { id: 'Vol',      label: 'Vol',      color: '#A890F0', emoji: '🕊️' },
  { id: 'Psy',      label: 'Psy',      color: '#F85888', emoji: '🔮' },
  { id: 'Insecte',  label: 'Insecte',  color: '#A8B820', emoji: '🐛' },
  { id: 'Roche',    label: 'Roche',    color: '#B8A038', emoji: '🪨' },
  { id: 'Spectre',  label: 'Spectre',  color: '#705898', emoji: '👻' },
  { id: 'Dragon',   label: 'Dragon',   color: '#7038F8', emoji: '🐉' },
  { id: 'Ténèbres', label: 'Ténèbres', color: '#705848', emoji: '🌑' },
  { id: 'Acier',    label: 'Acier',    color: '#B8B8D0', emoji: '⚙️' },
  { id: 'Fée',      label: 'Fée',      color: '#EE99AC', emoji: '✨' },
];

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function loadCsv(name) {
  if (process.env.CSV_DIR) return parseCsv(fs.readFileSync(path.join(process.env.CSV_DIR, name + '.csv'), 'utf8'));
  const res = await fetch(BASE + name + '.csv');
  if (!res.ok) throw new Error(`Téléchargement impossible : ${name}.csv (${res.status})`);
  return parseCsv(await res.text());
}

(async () => {
  const [pokemon, pokemonTypes, speciesNames, forms, formNames, typeNames] = await Promise.all([
    'pokemon', 'pokemon_types', 'pokemon_species_names', 'pokemon_forms', 'pokemon_form_names', 'type_names',
  ].map(loadCsv));

  const typeById = {};
  typeNames.filter(r => r.local_language_id === FR).forEach(r => { typeById[r.type_id] = r.name; });
  const known = new Set(TYPES.map(t => t.id));

  const typesOf = {};
  pokemonTypes.sort((a, b) => a.slot - b.slot).forEach(r => {
    const name = typeById[r.type_id];
    if (!known.has(name)) return; // ignore Stellaire, ???, Obscur
    (typesOf[r.pokemon_id] ||= []).push(name);
  });

  const speciesFr = {};
  speciesNames.filter(r => r.local_language_id === FR).forEach(r => { speciesFr[r.pokemon_species_id] = r.name; });

  const formByPokemon = {};
  forms.forEach(f => { formByPokemon[f.pokemon_id] = f; });
  const formFr = {};
  formNames.filter(r => r.local_language_id === FR).forEach(r => { formFr[r.pokemon_form_id] = r; });

  const key = arr => [...arr].sort().join('+');
  const baseKey = {};
  pokemon.filter(p => p.is_default === '1').forEach(p => { baseKey[p.species_id] = key(typesOf[p.id] || []); });

  const answers = [];
  const seen = new Set();

  pokemon.filter(p => p.is_default === '1').sort((a, b) => a.species_id - b.species_id).forEach(p => {
    const name = speciesFr[p.species_id];
    if (!name || !typesOf[p.id]) return;
    answers.push({ name, info: '#' + String(p.species_id).padStart(4, '0'), types: typesOf[p.id] });
    seen.add(name + '|' + key(typesOf[p.id]));
  });

  pokemon.filter(p => p.is_default !== '1').sort((a, b) => a.species_id - b.species_id || a.id - b.id).forEach(p => {
    const t = typesOf[p.id];
    if (!t || key(t) === baseKey[p.species_id]) return;
    const f = formByPokemon[p.id];
    const name = (f && formFr[f.id] && formFr[f.id].pokemon_name) || null;
    if (!name || seen.has(name + '|' + key(t))) return;
    seen.add(name + '|' + key(t));
    const kind = f && f.is_mega === '1' ? 'Méga' : 'Forme alternative';
    answers.push({ name, info: '#' + String(p.species_id).padStart(4, '0') + ' · ' + kind, types: t });
  });

  const line = o => '    ' + JSON.stringify(o);
  const typeLine = t => '      ' + JSON.stringify({ name: t.id, color: t.color, emoji: t.emoji });
  const out = [
    '{',
    '  "name": "Pokémon",',
    '  "emoji": "🔴",',
    '  "description": "Deux types tirés au hasard : trouvez un Pokémon qui a exactement ces types (Feu + Feu = Pokémon de type Feu pur).",',
    '  "answerMode": "set",',
    '  "skipEmpty": true,',
    '  "lists": {',
    '    "types": [',
    TYPES.map(typeLine).join(',\n'),
    '    ]',
    '  },',
    '  "slots": [',
    '    { "id": "type1", "label": "Type 1", "list": "types" },',
    '    { "id": "type2", "label": "Type 2", "list": "types" }',
    '  ],',
    '  "answers": [',
    answers.map(a => line({ name: a.name, tags: a.types, info: a.info })).join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(OUT, out);
  console.log(`themes/pokemon.json écrit : ${answers.length} entrées.`);
})().catch(e => { console.error(e.message); process.exit(1); });
