// SPDX-License-Identifier: GPL-3.0-only
import { createStore } from './store.js';

// Texts of the devices screen and the update; the other screens add theirs with addTexts()
// (i18n_full.js).
const TEXTS = {
  fr: {
    devices: 'Appareils', noConfig: 'Ouvrez TasmoFlow depuis la passerelle : http://<adresse de la passerelle>/tf',
    loading: 'Chargement…', noDevice: 'Aucun appareil.', live: 'en direct',
    reconnecting: 'reconnexion…', paused: 'en pause', resume: 'Reprendre',
    stopped: "Cette page ne reçoit plus les changements en direct : la passerelle en sert trois au plus, et une autre interface TasmoFlow vient de s'ouvrir.",
    toggle: 'Basculer', pair: 'Appairer (60 s)', lastSeen: 'vu', battery: 'batterie',
    unreachable: 'injoignable', ago: 'il y a', s: 's', min: 'min', h: 'h', d: 'j', error: 'Erreur',
    refresh: 'Actualiser', router: 'routeur', endDevice: 'sur batterie ou terminal', connected: 'connecté',
    disconnected: 'déconnecté', on: 'allumé', off: 'éteint',
    retry: 'Réessayer', speed: 'Vitesse', dimmer: 'Intensité', colortemp: 'Température de couleur',
    updateAvailable: 'Une nouvelle version de TasmoFlow est disponible : {v}. La passerelle redémarrera (30 secondes à 1 minute).', updateNow: 'Mettre à jour',
    updateLater: 'Plus tard',
    updateDownload: 'Téléchargement de la mise à jour…', updateUpload: 'Envoi à la passerelle…',
    updateRestart: 'Redémarrage de la passerelle… {s} s (attente de {max} s au plus). Ne fermez pas cette page.',
    updateTimeout: "Le redémarrage prend plus de temps que prévu. Ouvrez l'accueil de Tasmota pour vérifier la passerelle (l'ancienne version est gardée dans /.extensions/TasmoFlow.tapp.bak).",
    updateHome: "Accueil de Tasmota", updateBadFile: "Le fichier téléchargé n'a pas la taille annoncée.",
    update_hash: "Le contrôle d'intégrité du fichier a échoué : mise à jour annulée, rien n'a été changé.",
    update_space: 'Pas assez de place sur la passerelle pour la mise à jour.',
    updateSpaceDetail: "Il faut {need} Ko ({size} Ko de mise à jour et 20 Ko de marge), {free} Ko sont disponibles (dont {bak} Ko de l'ancienne copie .bak).",
    update_offset: 'Transfert interrompu, réessayez.', update_size: 'Taille de fichier refusée.',
    update_format: "Le fichier n'est pas une extension Tasmota.",
    update_install: "Installation impossible : l'ancienne version est conservée.",
    update_incomplete: 'Transfert incomplet, réessayez.',
    update_path: "Chemin de l'extension inconnu : mettez à jour à la main.",
    tuyaLowMem: 'Mémoire libre insuffisante pour lire la configuration Tuya : seuls les états booléens sont proposés.'
  },
  en: {
    devices: 'Devices', noConfig: 'Open TasmoFlow from the gateway: http://<gateway address>/tf', loading: 'Loading…',
    noDevice: 'No device.', live: 'live', reconnecting: 'reconnecting…', paused: 'paused', resume: 'Resume',
    stopped: 'This page no longer receives live changes: the gateway serves three at most, and another TasmoFlow interface has just opened.',
    toggle: 'Toggle', pair: 'Pair (60 s)', lastSeen: 'seen', battery: 'battery', unreachable: 'unreachable', ago: '',
    s: 's ago', min: 'min ago', h: 'h ago', d: 'd ago', error: 'Error', refresh: 'Refresh', router: 'router',
    endDevice: 'battery or end device', connected: 'connected', disconnected: 'disconnected', on: 'on', off: 'off',
    retry: 'Retry', speed: 'Speed', dimmer: 'Dimmer', colortemp: 'Colour temperature',
    updateAvailable: 'A new version of TasmoFlow is available: {v}. The gateway will restart (30 seconds to 1 minute).', updateNow: 'Update', updateLater: 'Later',
    updateDownload: 'Downloading the update…', updateUpload: 'Sending it to the gateway…',
    updateRestart: 'Restarting the gateway… {s} s (waiting {max} s at most). Do not close this page.',
    updateTimeout: 'The restart takes longer than expected. Open the Tasmota home page to check the gateway (the old version is kept in /.extensions/TasmoFlow.tapp.bak).',
    updateHome: 'Tasmota home page', updateBadFile: 'The downloaded file is not the size announced.',
    update_hash: "The file's integrity check failed: update cancelled, nothing was changed.",
    update_space: 'Not enough room on the gateway for the update.', update_offset: 'Transfer interrupted, try again.',
    updateSpaceDetail: '{need} KB are needed ({size} KB of update and a 20 KB margin), {free} KB are available ({bak} KB of them from the old .bak copy).',
    update_size: 'File size refused.', update_format: 'The file is not a Tasmota extension.',
    update_install: 'Installation failed: the old version is kept.',
    update_incomplete: 'Transfer incomplete, try again.', update_path: "Extension path unknown: update by hand.",
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
