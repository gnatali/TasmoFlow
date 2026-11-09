# Suivi des travaux : TasmoFlow

*English version: [tracking.en.md](tracking.en.md)*

État du projet, décisions, mesures et prochaines étapes, pour reprendre le travail dans une
nouvelle session. Architecture et plan de test : [architecture.fr.md](architecture.fr.md).
Cahier des charges (en français, hors du dépôt) :
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## État (9 novembre 2026)

- **v0.0 (prototype) terminée**, publiée en
  [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) et vérifiée sur la
  passerelle (ZB-GW03 avec le pilote Tuya local). L'interface se charge depuis GitHub Pages
  (en-tête « v0.0.1 · github ») et se rabat sur la copie locale.
- [PR #1](https://github.com/gnatali/TasmoFlow/pull/1) fusionnée (fichiers de suivi,
  `.claude/rules/`).
- **v0.1 (pilotage) écrite, à vérifier sur la passerelle** (branche
  `claude/modest-pascal-8854i4`, pas encore fusionnée) : interface Preact + htm, serveur d'API à
  la demande, écran Passerelles, appareils Tuya dans le tableau de bord. Tout passe contre la
  fausse passerelle (`node tests/e2e.js`, 9 tests) ; **rien n'a encore tourné sur une vraie
  passerelle**, et les changements Berry ont seulement été relus, pas compilés (la CI vérifie
  la syntaxe).
- **Suite** : installer la `.tapp` v0.1 sur la ZB-GW03, dérouler les nouveaux points `[ ]` du
  [plan de test](architecture.fr.md#plan-de-test-sur-la-passerelle), mesurer la mémoire ; puis la v0.2.

## Historique

| Date | Étape |
| --- | --- |
| 5 nov. 2026 | Revue de l'existant (aucun projet ne réunit hébergement GitHub, éditeur sans code et gestion d'une passerelle Zigbee), 20 décisions, cahier des charges et feuille de route, nom TasmoFlow |
| 5 nov. | Constats tirés du code de Tasmota : pas d'en-têtes de réponse depuis le `webserver` de Berry, classe `webserver_async` compilée mais pas exposée, serveur WebSocket à recompiler, format `.tapp`, catalogue de l'Extension Manager déduit d'`OtaUrl` |
| 5 nov. | Prototype v0.0 écrit : extension Berry (ports 80 et 8384), interface sans dépendance, `pack_tapp.py`, passerelle simulée, CI |
| 5-6 nov. | Déplacement du dépôt du firmware vers `gnatali/TasmoFlow` ; CI corrigée (`libreadline-dev`, commentaires en bloc `#-` trouvés par le contrôle Berry) |
| 6 nov. | Premier chargement sur la passerelle : `'re' undeclared` dans `tf_http.be` (`import re` manquant, masqué par le contrôle de la CI qui déclarait `re`) |
| 6 nov. | Premiers tests sur la passerelle : 10 sur 11 validés. `/tf` corrigé pour les adresses tapées et les favoris (`Referer` exigé par Tasmota) |
| 9 nov. | Le firmware intègre un pilote Tuya local : cahier des charges, architecture et feuille de route étendus aux appareils Tuya (module F7) |
| 9 nov. | Décision : TasmoFlow gère **toutes les règles** (`Rule1` à `Rule3`, Berry, ses propres actions) |
| 9 nov. | `CLAUDE.md` ajouté ; règle de langue appliquée (code, docs et messages en anglais ; traduction française de la documentation utilisateur) |
| 9 nov. | Tous les points de la v0.0 validés, mémoire mesurée après `tasmota.gc()` ; tag v0.0.1 créé par Guillaume, GitHub Pages activé |
| 9 nov. | v0.1 : **Preact + htm retenu** (même écran : 6,6 Ko gzip contre 6,3 Ko pour Lit, 5,4 Ko pour le prototype sans dépendance) ; interface assemblée avec esbuild (12,9 Ko gzip, puis 14,6 Ko avec Tuya) |
| 9 nov. | v0.1 : serveur d'API à la demande (`/tf`, `/tf?w=1`, 5 minutes d'inactivité), `tf_http.be` compilé à la demande et allégé ; écran Passerelles ; appareils Tuya (`TuyaEnable`, `TuyaStatus`, `TuyaConfig`, `TuyaSend`, règle `Tuya` sur le flux d'événements) ; pilote Tuya simulé et tests |

## Mesures sur la passerelle

Après `tasmota.gc()`, passerelle avec le pilote Tuya (9 novembre 2026) :

| Moment | Mémoire libre | `HeapUsed` de Berry | Coût de TasmoFlow |
| --- | --- | --- | --- |
| Avant installation | 84 Ko | 25 Ko | |
| Extension chargée | 67 Ko | 47 Ko | 17 Ko |
| Interface ouverte | 65 Ko | 48 Ko | 19 Ko |
| **v0.1**, extension chargée (serveur d'API non démarré) | 75 Ko | 35 Ko | **9 Ko** |
| **v0.1**, interface ouverte (`import` en cache) | 63 Ko | 48 Ko | 21 Ko |
| **v0.1**, interface ouverte (chargement sans cache) | 59 Ko | 48 Ko | 25 Ko |
| **v0.1**, 5 minutes après sa fermeture | 69 Ko | 39 Ko | **15 Ko** |

Cible : 15 Ko. Tailles : `TasmoFlow.tapp` 45 Ko (budget 150 Ko), `app.js.gz` 5,4 Ko (budget
120 Ko).

## Décisions encore ouvertes

- **Catalogue de l'Extension Manager** : soumettre TasmoFlow au catalogue officiel de Tasmota,
  ou en publier un sur `gnatali.github.io/extensions/` (exige un `OtaUrl` sur cet hôte), ou
  garder l'installation manuelle.

## v0.1 : ce qui est écrit, ce qui reste

Fait dans le code et la fausse passerelle (voir l'[architecture](architecture.fr.md)) :

1. **Preact + htm** (décision du 9 novembre), `app/src/`, `npm run build`.
2. **Mémoire** : serveur d'API à la demande, chargement de `tf_http.be` à la demande et sans
   cache, événements enregistrés seulement pendant qu'il tourne, code inutilisé retiré. **Mesuré :
   9 Ko au repos, 15 Ko après la première utilisation** (cible : 15 Ko), 25 Ko avec une interface
   ouverte. Le chargement sans cache rend 10 Ko sur 16 à l'arrêt du serveur ; **6 Ko (Berry :
   4 Ko) restent alloués, cause inconnue**. Pistes, à départager avec la console Berry : le
   pilote Tuya qui garde des données après `TuyaConfig` / `TuyaStatus` (les lancer à la main,
   puis `Br tasmota.gc()`), des modules chargés à la première utilisation (`re`, `introspect`,
   `sys`), ou une référence qui retient encore la classe `tf_http`.
3. **Appareils Tuya dans le tableau de bord** (F7.1 à F7.3) : interrupteurs, variateurs,
   température de couleur, vitesse de ventilateur, mesures, mise à jour en direct, masqués sans
   le pilote.
4. **Plusieurs passerelles** (F1) : écran Passerelles, lien à copier, réveil d'un serveur arrêté.

Reste pour la v0.1 (petit) :

- **Couleur des liaisons `light3`** (`colour_data_v2`, `hhhhssssvvvv`) : pas encore proposée.
- **Noms de sous-appareils Tuya** contenant une virgule, que `TuyaSend` ne sait pas adresser.
- **Passer `VERSION` à `0.1.0`** quand Guillaume tague la release (l'en-tête affiche encore 0.0.1).
- **Vérifications sur la passerelle** : les points `[ ]` marqués v0.1 du plan de test, en
  particulier que le `tcpserver` du port 8384 peut être fermé puis ré-écouté, et la mémoire
  utilisée par `TuyaConfig`.

Ensuite la v0.2 : toutes les règles (`Rule1` à `Rule3`, Berry, actions), éditeur en phrases,
sauvegarde avant écriture.

## Points à vérifier

- Écriture d'un DP d'un appareil Tuya Zigbee (TS0601, cluster `EF00`) avec `ZbSend` : à essayer
  sur un appareil réel (nécessaire pour la v0.3).

## Liens

| Quoi | Où |
| --- | --- |
| Dépôt | <https://github.com/gnatali/TasmoFlow> |
| Firmware | <https://github.com/gnatali/tasmota32-zbgw03-matter> (pilote Tuya : `docs/tuya-local.fr.md`) |
| Cahier des charges et feuille de route | <https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix> |
| Release v0.0.1 | <https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1> |
| Interface sur GitHub Pages | `https://gnatali.github.io/TasmoFlow/v0.0.1/app.js` |
