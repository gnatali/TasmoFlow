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
    rules: 'Règles', rule_once: 'une seule fois', rule_stop: "arrêt sur erreur", rule_chars: 'caractères', rule_free: 'libres',
    rule_empty: '(vide)', rule_save: 'Enregistrer', rule_cancel: 'Annuler', rule_previous: 'Copie précédente', rule_restore: 'Restaurer cette copie',
    rule_confirmRestore: 'Remplacer le texte actuel par la copie précédente ? Le texte actuel devient la copie précédente.',
    rule_done: 'Fait.', rule_saved: 'Enregistré. La version précédente est gardée sur la passerelle.', rule_restored: 'Copie restaurée.',
    rule_berry: 'Règles Berry', rule_noBerry: 'Aucune règle Berry enregistrée.',
    rule_compressed: 'Plus de 512 caractères : Tasmota compresse le texte (environ 2 000 caractères au maximum).',
    rule_tooLong: 'Texte trop long pour une série de règles (environ 2 000 caractères au maximum).',
    rule_lintOn: 'Le texte doit commencer par « on ».', rule_lintDo: "Il manque « do » après le déclencheur.",
    rule_lintEndon: 'Il manque « endon » à la fin du bloc.', rule_lintBody: "Il n'y a aucune commande entre « do » et « endon ».",
    rule_backup: "Pas de place pour la copie de sauvegarde : rien n'a été modifié.", rule_write: "La passerelle n'a pas gardé le texte : l'ancien texte a été remis.",
    rule_length: 'Texte trop long.', rule_nobackup: 'Aucune copie précédente.', rule_chunk: "Transfert interrompu, réessayez.", rule_unknown: 'Série de règles inconnue.',
    rule_suggest: 'Suggestions', rule_view: 'Affichage', rule_sentences: 'Phrases', rule_text: 'Texte', rule_when: 'Quand', rule_if: 'Si', rule_then: 'Alors', rule_else: 'Sinon', rule_and: 'puis',
    rule_operator: 'Comparaison', rule_anyValue: 'à chaque fois', rule_value: 'Valeur', rule_addCmd: 'Ajouter une commande', rule_removeCmd: 'Retirer cette commande',
    rule_addBlock: 'Ajouter une règle', rule_editBlock: 'Modifier', rule_closeBlock: 'Fermer', rule_deleteBlock: 'Supprimer',
    rule_noSentence: "Ce texte n'est pas une suite de blocs « on … do … endon » : modifiez-le en mode Texte.",
    rule_rawBlock: "Ce bloc n'entre pas dans une phrase (plusieurs déclencheurs, conditions imbriquées…) : modifiez-le en mode Texte.",
    rule_lintTrigger: 'Le déclencheur est vide.',
    rule_vOn: 'allumer', rule_vOff: 'éteindre', rule_vToggle: 'basculer', rule_gwEvents: 'Événements de la passerelle', rule_commands: 'Commandes courantes',
    rule_zbSkipped: "Des appareils Zigbee dont le nom contient un espace ne peuvent pas servir de déclencheur : renommez-les (ZbName) ou désactivez SetOption83.",
    rule_finish: 'Terminé', rule_editTitle: 'Modifier la règle', rule_noCond: 'aucune condition', rule_noElse: 'aucune autre action',
    rule_custom: 'Personnalisé…', rule_list: 'Choisir dans la liste', rule_pickEvent: 'Choisir un événement', rule_pickAction: 'Choisir une action',
    rule_autoexecNone: "Aucun fichier autoexec.be sur la passerelle.", rule_autoexecCut: 'Début du fichier : {n} octets sur {size}.',
    rule_autoexecHelp: "Lecture seule : pour le modifier, utilisez le gestionnaire de fichiers de Tasmota (Console → Gestion du système de fichiers).",
    rule_conflicts: 'Règles qui peuvent se gêner', rule_tile: 'règle',
    rule_cCancel: "basculé deux fois : l'effet s'annule", rule_cContradict: 'ordres contraires', rule_cDuplicate: 'même ordre donné deux fois',
    updateAvailable: 'Une nouvelle version de TasmoFlow est disponible : {v}.', updateNow: 'Mettre à jour', updateLater: 'Plus tard',
    updateConfirm: "TasmoFlow va être mis à jour : la passerelle va redémarrer (environ 30 secondes à 1 minute) et l'interface sera indisponible pendant ce temps. Continuer ?",
    updateDownload: 'Téléchargement de la mise à jour…', updateUpload: 'Envoi à la passerelle…',
    updateRestart: 'Redémarrage de la passerelle… {s} s (attente de {max} s au plus). Ne fermez pas cette page.',
    updateTimeout: "Le redémarrage prend plus de temps que prévu. Ouvrez l'accueil de Tasmota pour vérifier la passerelle (l'ancienne version est gardée dans /.extensions/TasmoFlow.tapp.bak).",
    updateHome: "Accueil de Tasmota", updateBadFile: "Le fichier téléchargé n'a pas la taille annoncée.",
    update_hash: "Le contrôle d'intégrité du fichier a échoué : mise à jour annulée, rien n'a été changé.",
    update_space: 'Pas assez de place sur la passerelle pour la mise à jour.', update_offset: 'Transfert interrompu, réessayez.',
    update_size: 'Taille de fichier refusée.', update_format: "Le fichier n'est pas une extension Tasmota.",
    update_install: "Installation impossible : l'ancienne version est conservée.", update_incomplete: 'Transfert incomplet, réessayez.',
    update_path: "Chemin de l'extension inconnu : mettez à jour à la main.",
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
    rules: 'Rules', rule_once: 'once only', rule_stop: 'stop on error', rule_chars: 'characters', rule_free: 'free',
    rule_empty: '(empty)', rule_save: 'Save', rule_cancel: 'Cancel', rule_previous: 'Previous copy', rule_restore: 'Restore this copy',
    rule_confirmRestore: 'Replace the current text with the previous copy? The current text becomes the previous copy.',
    rule_done: 'Done.', rule_saved: 'Saved. The previous version is kept on the gateway.', rule_restored: 'Copy restored.',
    rule_berry: 'Berry rules', rule_noBerry: 'No Berry rule registered.',
    rule_compressed: 'More than 512 characters: Tasmota compresses the text (about 2,000 characters at most).',
    rule_tooLong: 'Text too long for a rule set (about 2,000 characters at most).',
    rule_lintOn: 'The text must start with "on".', rule_lintDo: 'A "do" is missing after the trigger.',
    rule_lintEndon: 'An "endon" is missing at the end of the block.', rule_lintBody: 'There is no command between "do" and "endon".',
    rule_backup: 'No room for the backup copy: nothing was changed.', rule_write: 'The gateway did not keep the text: the old text was put back.',
    rule_length: 'Text too long.', rule_nobackup: 'No previous copy.', rule_chunk: 'Transfer interrupted, try again.', rule_unknown: 'Unknown rule set.',
    rule_suggest: 'Suggestions', rule_view: 'View', rule_sentences: 'Sentences', rule_text: 'Text', rule_when: 'When', rule_if: 'If', rule_then: 'Then', rule_else: 'Else', rule_and: 'then',
    rule_operator: 'Comparison', rule_anyValue: 'every time', rule_value: 'Value', rule_addCmd: 'Add a command', rule_removeCmd: 'Remove this command',
    rule_addBlock: 'Add a rule', rule_editBlock: 'Edit', rule_closeBlock: 'Close', rule_deleteBlock: 'Delete',
    rule_noSentence: 'This text is not a list of "on ... do ... endon" blocks: edit it in Text view.',
    rule_rawBlock: 'This block does not fit a sentence (several triggers, nested conditions...): edit it in Text view.',
    rule_lintTrigger: 'The trigger is empty.',
    rule_vOn: 'turn on', rule_vOff: 'turn off', rule_vToggle: 'toggle', rule_gwEvents: 'Gateway events', rule_commands: 'Common commands',
    rule_zbSkipped: 'Zigbee devices whose name contains a space cannot be used as a trigger: rename them (ZbName) or turn SetOption83 off.',
    rule_finish: 'Done', rule_editTitle: 'Edit rule', rule_noCond: 'no condition', rule_noElse: 'no other action',
    rule_custom: 'Custom…', rule_list: 'Pick from the list', rule_pickEvent: 'Pick an event', rule_pickAction: 'Pick an action',
    rule_autoexecNone: 'No autoexec.be file on the gateway.', rule_autoexecCut: 'Start of the file: {n} of {size} bytes.',
    rule_autoexecHelp: "Read only: to change it, use Tasmota's file manager (Consoles → Manage File system).",
    rule_conflicts: 'Rules that may clash', rule_tile: 'rule',
    rule_cCancel: 'toggled twice: the effect cancels out', rule_cContradict: 'opposite orders', rule_cDuplicate: 'the same order given twice',
    updateAvailable: 'A new version of TasmoFlow is available: {v}.', updateNow: 'Update', updateLater: 'Later',
    updateConfirm: 'TasmoFlow will be updated: the gateway will restart (about 30 seconds to 1 minute) and the interface will be unavailable meanwhile. Continue?',
    updateDownload: 'Downloading the update…', updateUpload: 'Sending it to the gateway…',
    updateRestart: 'Restarting the gateway… {s} s (waiting {max} s at most). Do not close this page.',
    updateTimeout: 'The restart takes longer than expected. Open the Tasmota home page to check the gateway (the old version is kept in /.extensions/TasmoFlow.tapp.bak).',
    updateHome: 'Tasmota home page', updateBadFile: 'The downloaded file is not the size announced.',
    update_hash: "The file's integrity check failed: update cancelled, nothing was changed.",
    update_space: 'Not enough room on the gateway for the update.', update_offset: 'Transfer interrupted, try again.',
    update_size: 'File size refused.', update_format: 'The file is not a Tasmota extension.',
    update_install: 'Installation failed: the old version is kept.', update_incomplete: 'Transfer incomplete, try again.',
    update_path: "Extension path unknown: update by hand.",
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
