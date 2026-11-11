// SPDX-License-Identifier: GPL-3.0-only
import { createStore } from './store.js';

// Texts of the light interface (the copy kept in the .tapp: devices and update). The full interface
// adds its own with addTexts() (i18n_full.js), so the light bundle only carries what it shows.
const TEXTS = {
  fr: {
    devices: 'Appareils', noConfig: 'Ouvrez TasmoFlow depuis la passerelle : http://<adresse de la passerelle>/tf',
    loading: 'Chargement…', noDevice: 'Aucun appareil.', zigbeeOff: "Zigbee n'est pas démarré.", live: 'en direct',
    reconnecting: 'reconnexion…', toggle: 'Basculer', pair: 'Appairer (60 s)', lastSeen: 'vu', battery: 'batterie',
    unreachable: 'injoignable', ago: 'il y a', s: 's', min: 'min', h: 'h', d: 'j', error: 'Erreur',
    refresh: 'Actualiser', router: 'routeur', endDevice: 'sur batterie ou terminal', connected: 'connecté',
    disconnected: 'déconnecté', on: 'allumé', off: 'éteint',
    liteBanner: "Version légère, servie par la passerelle : l'interface complète n'a pas pu être chargée depuis GitHub (pas d'accès à internet ?).",
    retry: 'Réessayer', speed: 'Vitesse', dimmer: 'Intensité', colortemp: 'Température de couleur',
    updateAvailable: 'Une nouvelle version de TasmoFlow est disponible : {v}.', updateNow: 'Mettre à jour',
    updateLater: 'Plus tard',
    updateConfirm: "TasmoFlow va être mis à jour : la passerelle va redémarrer (environ 30 secondes à 1 minute) et l'interface sera indisponible pendant ce temps. Continuer ?",
    updateDownload: 'Téléchargement de la mise à jour…', updateUpload: 'Envoi à la passerelle…',
    updateRestart: 'Redémarrage de la passerelle… {s} s (attente de {max} s au plus). Ne fermez pas cette page.',
    updateTimeout: "Le redémarrage prend plus de temps que prévu. Ouvrez l'accueil de Tasmota pour vérifier la passerelle (l'ancienne version est gardée dans /.extensions/TasmoFlow.tapp.bak).",
    updateHome: "Accueil de Tasmota", updateBadFile: "Le fichier téléchargé n'a pas la taille annoncée.",
    update_hash: "Le contrôle d'intégrité du fichier a échoué : mise à jour annulée, rien n'a été changé.",
    update_space: 'Pas assez de place sur la passerelle pour la mise à jour.',
    update_offset: 'Transfert interrompu, réessayez.', update_size: 'Taille de fichier refusée.',
    update_format: "Le fichier n'est pas une extension Tasmota.",
    update_install: "Installation impossible : l'ancienne version est conservée.",
    update_incomplete: 'Transfert incomplet, réessayez.',
    update_path: "Chemin de l'extension inconnu : mettez à jour à la main.", tuyaWaiting: 'Pilote Tuya en attente :',
    tuyaLowMem: 'Mémoire libre insuffisante pour lire la configuration Tuya : seuls les états booléens sont proposés.'
  },
  en: {
    devices: 'Devices', noConfig: 'Open TasmoFlow from the gateway: http://<gateway address>/tf', loading: 'Loading…',
    noDevice: 'No device.', zigbeeOff: 'Zigbee is not started.', live: 'live', reconnecting: 'reconnecting…',
    toggle: 'Toggle', pair: 'Pair (60 s)', lastSeen: 'seen', battery: 'battery', unreachable: 'unreachable', ago: '',
    s: 's ago', min: 'min ago', h: 'h ago', d: 'd ago', error: 'Error', refresh: 'Refresh', router: 'router',
    endDevice: 'battery or end device', connected: 'connected', disconnected: 'disconnected', on: 'on', off: 'off',
    liteBanner: 'Light version, served by the gateway: the full interface could not be loaded from GitHub (no internet access?).',
    retry: 'Retry', speed: 'Speed', dimmer: 'Dimmer', colortemp: 'Colour temperature',
    updateAvailable: 'A new version of TasmoFlow is available: {v}.', updateNow: 'Update', updateLater: 'Later',
    updateConfirm: 'TasmoFlow will be updated: the gateway will restart (about 30 seconds to 1 minute) and the interface will be unavailable meanwhile. Continue?',
    updateDownload: 'Downloading the update…', updateUpload: 'Sending it to the gateway…',
    updateRestart: 'Restarting the gateway… {s} s (waiting {max} s at most). Do not close this page.',
    updateTimeout: 'The restart takes longer than expected. Open the Tasmota home page to check the gateway (the old version is kept in /.extensions/TasmoFlow.tapp.bak).',
    updateHome: 'Tasmota home page', updateBadFile: 'The downloaded file is not the size announced.',
    update_hash: "The file's integrity check failed: update cancelled, nothing was changed.",
    update_space: 'Not enough room on the gateway for the update.', update_offset: 'Transfer interrupted, try again.',
    update_size: 'File size refused.', update_format: 'The file is not a Tasmota extension.',
    update_install: 'Installation failed: the old version is kept.',
    update_incomplete: 'Transfer incomplete, try again.', update_path: "Extension path unknown: update by hand.",
    tuyaWaiting: 'Tuya driver waiting:',
    tuyaLowMem: 'Not enough free memory to read the Tuya configuration: only boolean states are offered.'
  }
};

function detect() {
  const l = (localStorage.getItem('tf-lang') || navigator.language || 'fr').slice(0, 2);
  return l === 'en' ? 'en' : 'fr';
}

export const L = createStore({ lang: detect() });
document.documentElement.lang = L.get().lang;

export const t = k => TEXTS[L.get().lang][k] || k;

// more texts, { fr: {...}, en: {...} }: the full interface's screens (i18n_full.js)
export function addTexts(more) {
  for (const l in more) Object.assign(TEXTS[l], more[l]);
}

export function toggleLang() {
  const lang = L.get().lang === 'fr' ? 'en' : 'fr';
  localStorage.setItem('tf-lang', lang);
  document.documentElement.lang = lang;
  L.set({ lang });
}
