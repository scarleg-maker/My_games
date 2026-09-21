'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** Liste, triée par ordre alphabétique, tous les fichiers data/<prefix>.json et data/<prefix>_*.json. */
function listMatchingFiles(prefix) {
  return fs.readdirSync(DATA_DIR)
    .filter(f => (f === `${prefix}.json` || (f.startsWith(`${prefix}_`) && f.endsWith('.json'))))
    .sort();
}

function readJsonFile(file) {
  const filePath = path.join(DATA_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new Error(`Erreur de lecture de data/${file} : ${e.message}`);
  }
}

/**
 * Fusionne tous les fichiers data/<prefix>.json + data/<prefix>_*.json contenant chacun un
 * TABLEAU JSON (ex: cards.json, cards_ffviii.json, cards_ffix.json...). Les tableaux sont
 * concaténés. Si `uniqueKey` est fourni, une erreur claire est levée si la même valeur de clé
 * apparaît dans deux fichiers différents (en indiquant les deux fichiers en cause).
 */
function loadMergedArray(prefix, { uniqueKey } = {}) {
  const files = listMatchingFiles(prefix);
  const merged = [];
  const seenKeys = new Map(); // valeur de clé -> nom du fichier où elle a été vue en premier

  for (const file of files) {
    const content = readJsonFile(file);
    if (!Array.isArray(content)) {
      throw new Error(`data/${file} doit contenir un tableau JSON (reçu : ${typeof content}).`);
    }
    for (const item of content) {
      if (uniqueKey) {
        const key = item[uniqueKey];
        if (seenKeys.has(key)) {
          throw new Error(
            `Doublon détecté : "${key}" (champ "${uniqueKey}") apparaît à la fois dans data/${seenKeys.get(key)} ` +
            `et data/${file}. Chaque valeur de "${uniqueKey}" doit être unique dans tous les fichiers ${prefix}*.json.`
          );
        }
        seenKeys.set(key, file);
      }
      merged.push(item);
    }
  }
  return { items: merged, sourceFiles: files };
}

/**
 * Fusionne spécifiquement des fichiers "opponents" (tableau de paliers { tier, label, opponents }).
 * Les paliers portant le même numéro "tier" dans des fichiers différents sont automatiquement
 * regroupés (leurs listes d'adversaires sont concaténées), permettant à chaque set d'ajouter ses
 * propres adversaires à un palier déjà utilisé par un autre set sans jamais éditer son fichier.
 */
function loadMergedTiers(prefix) {
  const files = listMatchingFiles(prefix);
  const tiersByNumber = new Map();

  for (const file of files) {
    const content = readJsonFile(file);
    if (!Array.isArray(content)) {
      throw new Error(`data/${file} doit contenir un tableau JSON de paliers.`);
    }
    for (const tierData of content) {
      if (!tiersByNumber.has(tierData.tier)) {
        tiersByNumber.set(tierData.tier, { tier: tierData.tier, label: tierData.label, opponents: [] });
      }
      tiersByNumber.get(tierData.tier).opponents.push(...tierData.opponents);
    }
  }

  const merged = [...tiersByNumber.values()].sort((a, b) => a.tier - b.tier);
  return { items: merged, sourceFiles: files };
}

/**
 * Fusionne des fichiers contenant chacun un OBJET JSON clé -> valeur (ex: starterDeck.json,
 * starterDeck_ffviii.json...). Erreur claire si la même clé (ex: le même id de set) apparaît dans
 * deux fichiers différents.
 */
function loadMergedObject(prefix) {
  const files = listMatchingFiles(prefix);
  const merged = {};
  const seenKeys = new Map();

  for (const file of files) {
    const content = readJsonFile(file);
    if (typeof content !== 'object' || Array.isArray(content) || content === null) {
      throw new Error(`data/${file} doit contenir un objet JSON (clé -> valeur), pas un tableau.`);
    }
    for (const key of Object.keys(content)) {
      if (seenKeys.has(key)) {
        throw new Error(
          `Doublon détecté : la clé "${key}" apparaît à la fois dans data/${seenKeys.get(key)} et data/${file}.`
        );
      }
      seenKeys.set(key, file);
      merged[key] = content[key];
    }
  }
  return { items: merged, sourceFiles: files };
}

module.exports = { loadMergedArray, loadMergedTiers, loadMergedObject, DATA_DIR };
