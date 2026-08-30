/**
 * Extrait fidèlement le tableau RAW et la table EFF directement depuis
 * l'ancien fichier HTML autonome d'origine (au lieu de les retranscrire à la
 * main, source d'erreurs) et régénère data/pokemon/pokedex.json + data/pokemon/bat.json.
 *
 * Usage : node scripts/extract_from_original.js <chemin-vers-le-fichier-html-d-origine>
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const srcPath = process.argv[2];
if (!srcPath) {
  console.error("Usage: node scripts/extract_from_original.js <chemin-vers-le-fichier-html-d-origine>");
  process.exit(1);
}
const html = fs.readFileSync(srcPath, "utf8");

function extractConst(name, endMarker) {
  const startIdx = html.indexOf(`const ${name} = `);
  if (startIdx === -1) throw new Error(`Introuvable: const ${name}`);
  const exprStart = startIdx + `const ${name} = `.length;
  const endIdx = html.indexOf(endMarker, exprStart);
  if (endIdx === -1) throw new Error(`Marqueur de fin introuvable pour ${name}`);
  const exprText = html.slice(exprStart, endIdx);
  return exprText;
}

const rawText = extractConst("RAW", "\n];");
const effText = extractConst("EFF", "\n};");

const RAW = vm.runInNewContext("(" + rawText + "\n])");
const EFF = vm.runInNewContext("(" + effText + "\n})");

console.log(`RAW: ${RAW.length} entrées extraites.`);
console.log(`EFF: ${Object.keys(EFF).length} types extraits.`);

function toImageFile(name) {
  return name + ".png";
}

const pokedex = RAW.map(([name, t1, t2, gen, stage, color]) => ({
  name,
  types: [t1, t2].filter(Boolean),
  gen,
  stage,
  color,
  image: toImageFile(name),
}));

const bat = {};
for (const type of Object.keys(EFF)) {
  bat[type] = EFF[type].weak;
}

const outDir = path.join(__dirname, "..", "data", "pokemon");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "pokedex.json"), JSON.stringify(pokedex, null, 2) + "\n");
fs.writeFileSync(path.join(outDir, "bat.json"), JSON.stringify(bat, null, 2) + "\n");

console.log(`OK: ${pokedex.length} Pokémon écrits dans data/pokemon/pokedex.json`);
console.log(`OK: table de bataille (${Object.keys(bat).length} types) écrite dans data/pokemon/bat.json`);

const names = new Set();
let dupes = 0;
for (const p of pokedex) {
  if (names.has(p.name)) dupes++;
  names.add(p.name);
}
console.log(dupes === 0 ? "Aucun doublon de nom." : `${dupes} doublon(s) de nom détecté(s).`);
