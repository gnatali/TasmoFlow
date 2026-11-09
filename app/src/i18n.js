// SPDX-License-Identifier: GPL-3.0-only
import { createStore } from './store.js';

const TEXTS = {
  fr: {
    devices: 'Appareils', events: 'Événements', console: 'Console', gateways: 'Passerelles', diag: 'Diagnostic',
    noConfig: 'Ouvrez TasmoFlow depuis la passerelle : http://<adresse de la passerelle>/tf',
    loading: 'Chargement…', noDevice: 'Aucun appareil.', zigbeeOff: "Zigbee n'est pas démarré.",
    live: 'en direct', reconnecting: 'reconnexion…', toggle: 'Basculer', pair: 'Appairer (60 s)',
    send: 'Envoyer', cmdPlaceholder: 'Commande Tasmota, ex. ZbInfo', lastSeen: 'vu', battery: 'batterie',
    unreachable: 'injoignable', noEvent: "Aucun événement depuis l'ouverture.", source: 'Interface chargée depuis',
    loadTime: "Démarrage de l'interface", heap: 'Mémoire libre', ufs: 'Système de fichiers libre',
    ago: 'il y a', s: 's', min: 'min', h: 'h', d: 'j', error: 'Erreur', refresh: 'Actualiser',
    router: 'routeur', endDevice: 'sur batterie ou terminal', gateway: 'Passerelle',
    thisGateway: 'Cette passerelle', thisGatewayHelp: "Pour utiliser cette passerelle depuis l'interface d'une autre, copiez ce lien et collez-le dans l'écran Passerelles de l'autre.",
    link: 'Lien de connexion', show: 'Afficher', hide: 'Masquer', copy: 'Copier', copied: 'Copié',
    others: 'Autres passerelles', noOthers: 'Aucune autre passerelle enregistrée.',
    use: 'Utiliser', test: 'Tester', remove: 'Supprimer', confirmRemove: 'Supprimer cette passerelle de la liste ?',
    add: 'Ajouter une passerelle', name: 'Nom', pasteLink: 'Lien copié depuis cette passerelle : adresse:port#jeton',
    invalidLink: 'Lien invalide : attendu adresse[:port]#jeton (32 caractères hexadécimaux).',
    duplicate: 'Cette passerelle est déjà dans la liste.', ok: 'joignable', waking: 'réveil de la passerelle…',
    memory: 'mémoire', connected: 'connecté', disconnected: 'déconnecté', on: 'allumé', off: 'éteint',
    liteBanner: "Version légère, servie par la passerelle : l'interface complète n'a pas pu être chargée depuis GitHub (pas d'accès à internet ?).", retry: 'Réessayer',
    speed: 'Vitesse', dimmer: 'Intensité', colortemp: 'Température de couleur',
    tuyaWaiting: 'Pilote Tuya en attente :', tuyaLowMem: 'Mémoire libre insuffisante pour lire la configuration Tuya : seuls les états booléens sont proposés.'
  },
  en: {
    devices: 'Devices', events: 'Events', console: 'Console', gateways: 'Gateways', diag: 'Diagnostics',
    noConfig: 'Open TasmoFlow from the gateway: http://<gateway address>/tf',
    loading: 'Loading…', noDevice: 'No device.', zigbeeOff: 'Zigbee is not started.',
    live: 'live', reconnecting: 'reconnecting…', toggle: 'Toggle', pair: 'Pair (60 s)',
    send: 'Send', cmdPlaceholder: 'Tasmota command, e.g. ZbInfo', lastSeen: 'seen', battery: 'battery',
    unreachable: 'unreachable', noEvent: 'No event since opening.', source: 'Interface loaded from',
    loadTime: 'Interface start-up', heap: 'Free memory', ufs: 'Free file system',
    ago: '', s: 's ago', min: 'min ago', h: 'h ago', d: 'd ago', error: 'Error', refresh: 'Refresh',
    router: 'router', endDevice: 'battery or end device', gateway: 'Gateway',
    thisGateway: 'This gateway', thisGatewayHelp: "To use this gateway from another one's interface, copy this link and paste it in the other's Gateways screen.",
    link: 'Connection link', show: 'Show', hide: 'Hide', copy: 'Copy', copied: 'Copied',
    others: 'Other gateways', noOthers: 'No other gateway saved.',
    use: 'Use', test: 'Test', remove: 'Remove', confirmRemove: 'Remove this gateway from the list?',
    add: 'Add a gateway', name: 'Name', pasteLink: 'Link copied from that gateway: address:port#token',
    invalidLink: 'Invalid link: expected address[:port]#token (32 hexadecimal characters).',
    duplicate: 'This gateway is already in the list.', ok: 'reachable', waking: 'waking the gateway…',
    memory: 'memory', connected: 'connected', disconnected: 'disconnected', on: 'on', off: 'off',
    liteBanner: 'Light version, served by the gateway: the full interface could not be loaded from GitHub (no internet access?).', retry: 'Retry',
    speed: 'Speed', dimmer: 'Dimmer', colortemp: 'Colour temperature',
    tuyaWaiting: 'Tuya driver waiting:', tuyaLowMem: 'Not enough free memory to read the Tuya configuration: only boolean states are offered.'
  }
};

function detect() {
  const l = (localStorage.getItem('tf-lang') || navigator.language || 'fr').slice(0, 2);
  return l === 'en' ? 'en' : 'fr';
}

export const L = createStore({ lang: detect() });
document.documentElement.lang = L.get().lang;

export const t = k => TEXTS[L.get().lang][k] || k;

export function toggleLang() {
  const lang = L.get().lang === 'fr' ? 'en' : 'fr';
  localStorage.setItem('tf-lang', lang);
  document.documentElement.lang = lang;
  L.set({ lang });
}
