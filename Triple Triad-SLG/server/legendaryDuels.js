'use strict';
const saveManager = require('./saveManager');
const sets = require('./sets');
const engine = require('./engine');

// ============================================================================================
// Combats uniques niveau 9 : un adversaire par carte, portant son nom, la détenant dans son deck.
// Accès débloqué via achat en boutique (voir server/shop.js, 400 pts / 40 victoires par carte).
// Cartes de remplissage (niveau 6-7, hors cartes légendaires) pour compléter les decks de 5 cartes —
// chaque adversaire n'existe que pour ce combat précis, en dehors du système de paliers classique.
// ============================================================================================
const LVL9_DUEL_OPPONENTS = {
  ffviii: {
    carbuncle_ffviii: { name: 'Carbuncle', deck: ['carbuncle_ffviii', 'goliath_ffviii', 'ecorche_ffviii', 'omniborg_ffviii', 'mithra_ffviii', 'catoblepas_ffviii', 'tiamat_ffviii', 'attila_ffviii', 'monarch_ffviii'] },
    diablos_ffviii: { name: 'Diablos', deck: ['diablos_ffviii', 'hornet_ffviii', 'krystal_ffviii', 'acron_ffviii', 'anokronox_ffviii', 'catoblepas_ffviii', 'tiamat_ffviii', 'mithra_ffviii', 'attila_ffviii'] },
    leviathan_ffviii: { name: 'Leviathan', deck: ['leviathan_ffviii', 'sulfura_ffviii', 'fujin_raijin_ffviii', 'acron_ffviii', 'tiamat_ffviii', 'agamemnon_ffviii', 'anokronox_ffviii', 'catoblepas_ffviii', 'monarch_ffviii'] },
    odin_ffviii: { name: 'Odin', deck: ['odin_ffviii', 'cyanide_ffviii', 'lygus_ffviii', 'agamemnon_ffviii', 'pampa_sr._ffviii', 'acron_ffviii', 'catoblepas_ffviii', 'anokronox_ffviii', 'monarch_ffviii'] },
    zephyr_ffviii: { name: 'Zéphyr', deck: ['zephyr_ffviii', 'cyanide_ffviii', 'fujin_raijin_ffviii', 'attila_ffviii', 'tiamat_ffviii', 'catoblepas_ffviii', 'agamemnon_ffviii', 'pampa_sr._ffviii', 'monarch_ffviii'] },
    cerberus_ffviii: { name: 'Cerberus', deck: ['cerberus_ffviii', 'flotix_ffviii', 'iguanor_ffviii', 'pampa_sr._ffviii', 'attila_ffviii', 'catoblepas_ffviii', 'tiamat_ffviii', 'monarch_ffviii', 'mithra_ffviii'] },
    alexander_ffviii: { name: 'Alexander', deck: ['alexander_ffviii', 'cyanide_ffviii', 'ecorche_ffviii', 'attila_ffviii', 'catoblepas_ffviii', 'alienator_ffviii', 'pampa_sr._ffviii', 'mithra_ffviii', 'acron_ffviii'] },
    phoenix_ffviii: { name: 'Phoenix', deck: ['phoenix_ffviii', 'norg_ffviii', 'cyanide_ffviii', 'alienator_ffviii', 'omniborg_ffviii', 'agamemnon_ffviii', 'catoblepas_ffviii', 'attila_ffviii', 'anokronox_ffviii'] },
    bahamut_ffviii: { name: 'Bahamut', deck: ['bahamut_ffviii', 'hornet_ffviii', 'cyanide_ffviii', 'monarch_ffviii', 'pampa_sr._ffviii', 'omniborg_ffviii', 'alienator_ffviii', 'mithra_ffviii', 'attila_ffviii'] },
    helltrain_ffviii: { name: 'Helltrain', deck: ['helltrain_ffviii', 'krystal_ffviii', 'hornet_ffviii', 'omniborg_ffviii', 'anokronox_ffviii', 'alienator_ffviii', 'pampa_sr._ffviii', 'agamemnon_ffviii', 'acron_ffviii'] },
    orbital_ffviii: { name: 'Orbital', deck: ['orbital_ffviii', 'goliath_ffviii', 'fujin_raijin_ffviii', 'omniborg_ffviii', 'monarch_ffviii', 'alienator_ffviii', 'mithra_ffviii', 'tiamat_ffviii', 'anokronox_ffviii'] },
  },
  ffix: {
    ramuh_ffix: { name: 'Ramuh', deck: ['ramuh_ffix', 'amduscias_ffix', 'chimaira_ffix', 'larvalar_ffix', 'blambourine_ffix', 'gisamark_ffix', 'lovecraft_ffix', 'hornet_ffix', 'lamie_ffix'] },
    shiva_ffix: { name: 'Shiva', deck: ['shiva_ffix', 'grimlock_ffix', 'catoblepas_ffix', 'behemoth_ffix', 'pile_face_ffix', 'lovecraft_ffix', 'belhamel_ffix', 'lamie_ffix', 'valseur_n_1_2_3_ffix'] },
    ifrit_ffix: { name: 'Ifrit', deck: ['ifrit_ffix', 'coeurl_ffix', 'ekarissor_ffix', 'behemoth_ffix', 'belhamel_ffix', 'hectoculus_ffix', 'gisamark_ffix', 'lamie_ffix', 'lovecraft_ffix'] },
    fenrir_ffix: { name: 'Fenrir', deck: ['fenrir_ffix', 'ekarissor_ffix', 'coeurl_ffix', 'pile_face_ffix', 'belhamel_ffix', 'hornet_ffix', 'lamie_ffix', 'gisamark_ffix', 'valseur_n_1_2_3_ffix'] },
    phenix_ffix: { name: 'Phénix', deck: ['phenix_ffix', 'coeurl_ffix', 'chimaira_ffix', 'hornet_ffix', 'larvalar_ffix', 'pile_face_ffix', 'blambourine_ffix', 'lamie_ffix', 'gisamark_ffix'] },
    leviathan_ffix: { name: 'Leviathan', deck: ['leviathan_ffix', 'pampa_ffix', 'grand_dragon_ffix', 'behemoth_ffix', 'larvalar_ffix', 'belhamel_ffix', 'gisamark_ffix', 'blambourine_ffix', 'valseur_n_1_2_3_ffix'] },
    carbuncle_ffix: { name: 'Carbuncle', deck: ['carbuncle_ffix', 'ekarissor_ffix', 'amduscias_ffix', 'lovecraft_ffix', 'blambourine_ffix', 'pile_face_ffix', 'valseur_n_1_2_3_ffix', 'hectoculus_ffix', 'larvalar_ffix'] },
    odin_ffix: { name: 'Odin', deck: ['odin_ffix', 'amduscias_ffix', 'ao_ffix', 'hornet_ffix', 'pile_face_ffix', 'belhamel_ffix', 'hectoculus_ffix', 'gisamark_ffix', 'blambourine_ffix'] },
    bahamut_ffix: { name: 'Bahamut', deck: ['bahamut_ffix', 'tomberry_ffix', 'ao_ffix', 'pile_face_ffix', 'belhamel_ffix', 'lovecraft_ffix', 'hectoculus_ffix', 'gisamark_ffix', 'larvalar_ffix'] },
    marthym_ffix: { name: 'Marthym', deck: ['marthym_ffix', 'amduscias_ffix', 'pampa_ffix', 'gisamark_ffix', 'behemoth_ffix', 'hornet_ffix', 'blambourine_ffix', 'pile_face_ffix', 'larvalar_ffix'] },
    arkh_ffix: { name: 'Arkh', deck: ['arkh_ffix', 'fourmilion_ffix', 'grimlock_ffix', 'blambourine_ffix', 'pile_face_ffix', 'gisamark_ffix', 'lamie_ffix', 'hornet_ffix', 'valseur_n_1_2_3_ffix'] },
  },
  dsbb: {
    midir_le_devoreur_de_tenebres_dsbb: { name: 'Midir', set: 'DS3', deck: ['midir_le_devoreur_de_tenebres_dsbb', 'elana_la_reine_souillee_dsbb', 'kalameet_le_dragon_noir_dsbb', 'anthropophage_dsbb', 'logarius_le_martyr_dsbb', 'sif_le_grand_loup_gris_dsbb', 'vieux_roi_de_fer_dsbb', 'chevalier_miroir_dsbb'] },
    chevalier_des_fumees_dsbb: { name: 'Chevalier Fumerolle', set: 'DS2', deck: ['chevalier_des_fumees_dsbb', 'priscilla_l_hybride_dsbb', 'vieux_moine_dsbb', 'aava_l_animal_du_roi_dsbb', 'anthropophage_dsbb', 'nourrice_de_mergo_dsbb', 'quatre_rois_dsbb', 'logarius_le_martyr_dsbb'] },
    freja_la_bien_aimee_du_duc_dsbb: { name: 'Freja', set: 'DS2', deck: ['freja_la_bien_aimee_du_duc_dsbb', 'aava_l_animal_du_roi_dsbb', 'armure_pourfendeuse_de_dragons_dsbb', 'kalameet_le_dragon_noir_dsbb', 'vieux_moine_dsbb', 'logarius_le_martyr_dsbb', 'pontife_sulyvahn_dsbb', 'quatre_rois_dsbb'] },
    seath_le_sans_ecailles_dsbb: { name: 'Seath', set: 'DS1', deck: ['seath_le_sans_ecailles_dsbb', 'anthropophage_dsbb', 'elana_la_reine_souillee_dsbb', 'priscilla_l_hybride_dsbb', 'vieux_roi_de_fer_dsbb', 'chevalier_miroir_dsbb', 'kalameet_le_dragon_noir_dsbb', 'aava_l_animal_du_roi_dsbb'] },
    sire_alonne_dsbb: { name: 'Sir Alonne', set: 'DS2', deck: ['sire_alonne_dsbb', 'elana_la_reine_souillee_dsbb', 'pontife_sulyvahn_dsbb', 'priscilla_l_hybride_dsbb', 'aava_l_animal_du_roi_dsbb', 'quatre_rois_dsbb', 'armure_pourfendeuse_de_dragons_dsbb', 'vieux_moine_dsbb'] },
    dieu_dragon_dsbb: { name: 'Dieu Dragon', set: 'DeS', deck: ['dieu_dragon_dsbb', 'anthropophage_dsbb', 'chevalier_miroir_dsbb', 'aava_l_animal_du_roi_dsbb', 'kalameet_le_dragon_noir_dsbb', 'nourrice_de_mergo_dsbb', 'quatre_rois_dsbb', 'elana_la_reine_souillee_dsbb'] },
    aldrich_devoreur_de_dieux_dsbb: { name: 'Aldrich', set: 'DS3', deck: ['aldrich_devoreur_de_dieux_dsbb', 'logarius_le_martyr_dsbb', 'anthropophage_dsbb', 'armure_pourfendeuse_de_dragons_dsbb', 'vieux_roi_de_fer_dsbb', 'priscilla_l_hybride_dsbb', 'pontife_sulyvahn_dsbb', 'aava_l_animal_du_roi_dsbb'] },
    demon_des_tempetes_dsbb: { name: 'Démon des Tempêtes', set: 'DeS', deck: ['demon_des_tempetes_dsbb', 'quatre_rois_dsbb', 'pontife_sulyvahn_dsbb', 'aava_l_animal_du_roi_dsbb', 'priscilla_l_hybride_dsbb', 'sif_le_grand_loup_gris_dsbb', 'chevalier_miroir_dsbb', 'nourrice_de_mergo_dsbb'] },
    lorian_et_lothric_dsbb: { name: 'Lorian & Lothric', set: 'DS3', deck: ['lorian_et_lothric_dsbb', 'vieux_roi_de_fer_dsbb', 'aava_l_animal_du_roi_dsbb', 'pontife_sulyvahn_dsbb', 'armure_pourfendeuse_de_dragons_dsbb', 'sif_le_grand_loup_gris_dsbb', 'logarius_le_martyr_dsbb', 'nourrice_de_mergo_dsbb'] },
    roi_d_ivoire_calcine_dsbb: { name: 'Roi d\'ivoire', set: 'DS2', deck: ['roi_d_ivoire_calcine_dsbb', 'vieux_roi_de_fer_dsbb', 'vieux_moine_dsbb', 'aava_l_animal_du_roi_dsbb', 'anthropophage_dsbb', 'pontife_sulyvahn_dsbb', 'chevalier_miroir_dsbb', 'sif_le_grand_loup_gris_dsbb'] },
    yhorm_le_geant_dsbb: { name: 'Yhorm', set: 'DS3', deck: ['yhorm_le_geant_dsbb', 'elana_la_reine_souillee_dsbb', 'logarius_le_martyr_dsbb', 'vieux_moine_dsbb', 'aava_l_animal_du_roi_dsbb', 'chevalier_miroir_dsbb', 'anthropophage_dsbb', 'sif_le_grand_loup_gris_dsbb'] },
    nito_seigneur_des_tombes_dsbb: { name: 'Nito', set: 'DS1', deck: ['nito_seigneur_des_tombes_dsbb', 'nourrice_de_mergo_dsbb', 'logarius_le_martyr_dsbb', 'vieux_roi_de_fer_dsbb', 'pontife_sulyvahn_dsbb', 'kalameet_le_dragon_noir_dsbb', 'sif_le_grand_loup_gris_dsbb', 'armure_pourfendeuse_de_dragons_dsbb'] },
    ludwig_le_maudit_dsbb: { name: 'Ludwig', set: 'BB', deck: ['ludwig_le_maudit_dsbb', 'vieux_roi_de_fer_dsbb', 'chevalier_miroir_dsbb', 'anthropophage_dsbb', 'nourrice_de_mergo_dsbb', 'quatre_rois_dsbb', 'logarius_le_martyr_dsbb', 'vieux_moine_dsbb'] },
    astraea_la_pucelle_et_garl_vinland_dsbb: { name: 'Astraea & Garl', set: 'DeS', deck: ['astraea_la_pucelle_et_garl_vinland_dsbb', 'chevalier_miroir_dsbb', 'logarius_le_martyr_dsbb', 'anthropophage_dsbb', 'elana_la_reine_souillee_dsbb', 'pontife_sulyvahn_dsbb', 'vieux_moine_dsbb', 'aava_l_animal_du_roi_dsbb'] },
  },
};

const IMPOSED_RULES = {
  same: false, plus: false, combo: false, suddenDeath: false,
  elemental: false, wallAce: false, open: false, random: false,
};

function getDuelOpponent(setId, cardId) {
  const bySet = LVL9_DUEL_OPPONENTS[setId];
  return (bySet && bySet[cardId]) || null;
}

module.exports = { LVL9_DUEL_OPPONENTS, IMPOSED_RULES, getDuelOpponent };
