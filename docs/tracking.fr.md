# Suivi des travaux : TasmoFlow

*English version: [tracking.en.md](tracking.en.md)*

État du projet, décisions, mesures et prochaines étapes, pour reprendre le travail dans une
nouvelle session. Architecture et plan de test : [architecture.fr.md](architecture.fr.md).
Cahier des charges (en français, hors du dépôt) :
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## État (9 novembre 2026)

- **`.tapp` divisée par deux** (11 novembre 2026, branche `claude/tasmoflow-tapp-reduction-t5ofde`,
  demande de Guillaume) : 83 069 octets en v0.2.0, **39 807 octets** maintenant (-52 % ; budget de
  `pack_tapp.py` 41 534 octets, la moitié de la v0.2.0). L'interface légère ne garde que le
  pilotage des appareils et la mise à jour (règles, console et diagnostic en sont sortis :
  interface complète seulement), sans `preact/hooks` ; les fichiers Berry sont minifiés à
  l'assemblage (la CI les compile et passe le test du parseur sur le `tf_http.be` minifié). Les 19
  tests de bout en bout passent ; **pas encore essayée sur la passerelle** : build de test, `.tapp`
  à réinstaller (point « v0.2, `.tapp` réduite » du plan de test). Détails :
  [architecture](architecture.fr.md#interface-complète).
- **v0.1 publiée** : tag `v0.1.0`, `.tapp` jointe à la release, interface publiée sur GitHub
  Pages (PR n° 1 à 3 fusionnées). Installée sur la passerelle : démarrage/arrêt du serveur,
  mémoire et interface légère après redémarrage vérifiés ; les autres points `[ ]` du plan de
  test restent à faire.
- **v0.2 commencée** (branche `claude/modest-pascal-8854i4`) : étape 1 **écrite et vérifiée sur
  la passerelle** (modification, copie précédente, restauration) : l'écran **Règles** (`Rule1` à `Rule3` et règles Berry, édition, copie de la
  version précédente avant chaque écriture, restauration, activation/désactivation, aussi dans
  l'interface légère). Passe contre la fausse passerelle (`node tests/e2e.js`, 10 tests) ; le
  code Berry (`extension/tf_rules.be`) a seulement été relu, pas compilé. Ensuite : éditeur en
  phrases, actions, édition des règles Berry avec contrôle de compilation, `autoexec.be`.

- **v0.0 (prototype) terminée**, publiée en
  [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) et vérifiée sur la
  passerelle (ZB-GW03 avec le pilote Tuya local). L'interface se charge depuis GitHub Pages
  (en-tête « v0.0.1 · github ») et se rabat sur la copie locale.
- [PR #1](https://github.com/gnatali/TasmoFlow/pull/1) fusionnée (fichiers de suivi,
  `.claude/rules/`).
- **v0.1 (pilotage)** : interface Preact + htm, serveur d'API à la demande, écran Passerelles,
  appareils Tuya dans le tableau de bord (détails plus bas).
- **Plantage des URL longues corrigé dans le code** (10 novembre, branche `ccr-77cdec39-duy9lp`) :
  cause trouvée dans le source de Tasmota (le moteur de `re` s'appelle lui-même une fois par
  caractère de l'URI et déborde la pile de 8 Ko de la boucle) ; `tf_http.be` lit désormais les
  requêtes avec `string.find()`. À vérifier sur la passerelle avec une version de test (`.tapp` à
  réinstaller) : voir le point « URL longues » du plan de test.
- **Suite** : dérouler les points `[ ]` du
  [plan de test](architecture.fr.md#plan-de-test-sur-la-passerelle) sur la ZB-GW03 (v0.1 et les
  nouveaux de la v0.2). Mémoire avec l'API des règles mesurée le 11 novembre (plus bas).

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
| 9 nov. | v0.1 : **option B décidée** : interface complète sur GitHub Pages seulement (figée, SRI), interface légère (13,7 Ko gzip, appareils + console + diagnostic) dans la `.tapp` ; second point d'entrée esbuild des mêmes sources. Raison : `UfsFree` 148 Ko sur 320 Ko et une interface complète qui va grossir |
| 11 nov. | **`.tapp` divisée par deux** (83 069 à 39 807 octets) : interface légère réduite au pilotage des appareils et à la mise à jour (ses règles, sa console et son diagnostic sont partis : interface complète seulement) ; ses textes, styles et écrans séparés de ceux de la complète (`i18n_full.js`, `style_full.css`, `views_full.js`), plus de `preact/hooks` (les magasins d'état redessinent depuis la racine) ; Berry minifié par `pack_tapp.py` (contrôle des jetons), compilé et testé en CI ; budgets 41 534 octets (`.tapp`) et 14 Ko (`lite.js.gz`) |
| 11 nov. | Bouton de mise à jour (décision : le navigateur relaie la `.tapp` depuis GitHub Pages) : manifestes `latest.json` / `dev/latest.json`, l'interface légère propose la mise à jour quand le canal a une version plus récente (builds de test : un commit différent), la passerelle contrôle taille et SHA-256 et se remplace (`tf_update.be`, `.bak` gardé), la page attend le redémarrage (120 s au plus). Passerelle simulée : 414 au-delà de 512 caractères au lieu de couper la connexion |
| 11 nov. | v0.2 fusionnée (PR n° 5). Le tag `v0.2.0` créé sur github.com a fait échouer le job `release` (« Tag matches the VERSION file » : `VERSION` valait encore `0.1.0`) ; `VERSION` passée à `0.2.0`, il faut ensuite déplacer le tag sur le nouveau `main` |
| 11 nov. | **Bouton de mise à jour validé sur la passerelle** (deux mises à jour de suite, l'ancien `.bak` remplacé la seconde fois, rien ne reste). Restent à essayer : la mémoire avant et après, la coupure de courant pendant l'envoi et un `sha256` faux |
| 11 nov. | Bouton de mise à jour : troisième build de test publié (encore un commit qui ne touche que la documentation) pour répéter la mise à jour sur la passerelle |
| 11 nov. | Bouton de mise à jour : le premier essai a échoué sur `bytes.tohex()` en majuscules (le contrôle de l'en-tête zip refusait tout fichier) ; corrigé, la `.tapp` corrigée installée à la main, deuxième essai avec un autre commit qui ne touche que la documentation |
| 11 nov. | Bouton de mise à jour : premier essai sur la passerelle lancé avec un second build de test (un commit qui ne touche que la documentation, pour donner au manifeste une autre version) |
| 11 nov. | v0.2 étape 4 : section Berry (propriétaire de chaque règle, `autoexec.be` en lecture seule : nouvelle route, `.tapp` à réinstaller) et bandeau des conflits (même déclencheur, même appareil : bascules qui s'annulent, ordres contraires, doublons) |
| 11 nov. | Écran Règles encore après un deuxième essai : accordéon au lieu d'onglets ; les champs de déclencheur et de commande forment un seul champ à choix (nom lisible fermé, arbre avec l'élément courant en évidence ouvert) ; correction d'une reconstruction du texte en cours de saisie à chaque événement reçu |
| 11 nov. | Écran Règles refait après essai sur la passerelle (ordinateur et téléphone) : onglets par jeu de règles, tuiles en vue Phrases, formulaire de modification dans une fenêtre ; les informations d'appareil (`IEEEAddr`, `ModelId`…) ne sont plus proposées comme déclencheur |
| 11 nov. | v0.2 étape 3 : sélecteurs d'appareils dans l'éditeur en phrases (déclencheurs Zigbee et actions `ZbSend`, actions Tuya `TuyaSend`, lecture de `SetOption83` pour la clé du déclencheur, phrases en langage clair) ; les liaisons Tuya `enabled: false` servent maintenant aux contrôles ; listes de suggestions toujours complètes (select, pas datalist) |
| 10 nov. | v0.2 étape 2 : éditeur en phrases (vue **Phrases** d'un jeu de règles : Quand / Si / Alors / Sinon, les blocs bruts restent en texte, rien n'est réécrit tant qu'il n'est pas modifié) ; tests unitaires du modèle de règles en CI ; aucun changement sur la passerelle |
| 10 nov. | v0.2 étape 1 vérifiée sur la passerelle (version de test) : modification, enregistrement, copie précédente et restauration fonctionnent. Découvert en chemin : **une ligne de requête de 152 caractères ou plus fait redémarrer la passerelle** (112 passaient), donc les données longues passent dans un corps POST (`tf_http.be` remet les corps `Content-Length` ; `/api/cmd` et `/api/rule_set` les lisent) |
| 10 nov. | Plantage des URL longues expliqué par le source de Tasmota : `re.match2()` exécute `recursiveloop()` de re1.5, qui s'appelle elle-même une fois par caractère de `(\S+)` sans limite de profondeur, dans la pile de 8 Ko de la tâche de boucle. `tf_http.be` lit la ligne de requête et les en-têtes avec `string.find()` (ligne de requête jusqu'à 512 caractères, sinon 414 ; en-têtes 4 Ko, sinon 431 ; corps 3 000 octets, sinon 413) ; `tests/tf_http_test.be` exécute l'analyseur sur le Berry standard dans la CI |
| 9 nov. | Version de test sans release : un lancement manuel de `Build` publie `dev/app.js` et une `.tapp` de test (sans SRI) sur GitHub Pages ; la `.tapp` n'est réinstallée que si `extension/` ou l'interface légère changent |
| 9 nov. | v0.1 publiée (tag `v0.1.0`) ; v0.2 commencée : écran Règles, `tf_rules.be` (lecture, écriture par morceaux, copie de la version précédente, restauration), contrôle de syntaxe des jeux de règles dans l'interface, règles dans l'interface légère |
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
| **v0.2** étape 1 (Règles, POST), extension chargée, aucune interface ouverte (11 novembre) | 75 Ko, 76 Ko | 39 Ko, 39 Ko | **8 à 9 Ko** |
| **v0.2** étape 1, interface ouverte (10 novembre) | 52 Ko | 55 Ko | 32 Ko |
| **v0.2** étape 1, 5 minutes après sa fermeture (11 novembre, deux essais) | 70 Ko, 70 Ko | 39 Ko, 39 Ko | **14 Ko** |

Le budget de 15 Ko est tenu avec l'API des règles : **8 à 9 Ko au repos, 14 Ko cinq minutes après la fermeture de l'interface** (15 Ko en v0.1). Interface ouverte, le coût est de 32 Ko (25 Ko en v0.1) : `tf_rules.be` et le corps POST ajoutent 7 Ko tant que le serveur tourne. Le pilote Tuya demande 45 Ko libres pour démarrer : 52 Ko laissent 7 Ko de marge. `HeapUsed` de Berry revient à 39 Ko après la fermeture, comme en v0.1. Environ 6 Ko de mémoire libre ne sont toujours pas rendus après la première ouverture (75 à 70 Ko, comme en v0.1 : 75 à 69 Ko), cause inconnue (voir le point ouvert du plan de test).

Cible : 15 Ko. Tailles (11 novembre 2026) : `TasmoFlow.tapp` 39,8 Ko (budget 41,5 Ko, la moitié
des 83 Ko de la v0.2.0), `lite.js.gz` 13,4 Ko (budget 14 Ko), `app.js.gz` 26,4 Ko (budget 120 Ko).

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
   puis `Br tasmota.gc()`), des modules chargés à la première utilisation (`re`, que
   `tf_http.be` n'utilise plus depuis le 10 novembre ; `introspect`, `sys`), ou une référence qui
   retient encore la classe `tf_http`.
3. **Appareils Tuya dans le tableau de bord** (F7.1 à F7.3) : interrupteurs, variateurs,
   température de couleur, vitesse de ventilateur, mesures, mise à jour en direct, masqués sans
   le pilote.
4. **Plusieurs passerelles** (F1) : écran Passerelles, lien à copier, réveil d'un serveur arrêté.

Reste pour la v0.1 (petit) :

- **Couleur des liaisons `light3`** (`colour_data_v2`, `hhhhssssvvvv`) : pas encore proposée.
- **Noms de sous-appareils Tuya** contenant une virgule, que `TuyaSend` ne sait pas adresser.
- **`VERSION` vaut `0.2.0`** (11 novembre 2026). La passer dans une pull request **avant** de tagger une
  version : le job `release` refuse un tag différent de `VERSION` (le premier tag `v0.2.0` a échoué ainsi).
- **Vérifications sur la passerelle** : les points `[ ]` marqués v0.1 du plan de test, en
  particulier que le `tcpserver` du port 8384 peut être fermé puis ré-écouté, et la mémoire
  utilisée par `TuyaConfig`.

**Accepté le 11 novembre 2026, à faire plus tard** (pas commencé) : un **mode guidé simple** pour la fenêtre de règle (choisir un appareil, dire en mots ce qui lui arrive, choisir quoi faire), où les événements Zigbee s'apprennent en appuyant sur le bouton (l'interface écoute le flux d'événements et écrit le déclencheur d'après ce qu'elle vient de voir).

Ensuite, dans cet ordre (à confirmer avec Guillaume) : mesurer la mémoire de cette version (au repos, interface ouverte, après fermeture) ; ouvrir la pull request (la branche a une quarantaine de commits d'avance sur `main`) ; passer `VERSION` à `0.2.0` avant le tag, sinon `latest.json` et le bouton de mise à jour ne font rien pour les passerelles en release.

v0.2, ce qui reste après l'étape 4 : le **mode guidé** (accepté, plus tard), Matter dans les
sélecteurs, `elseif` et plusieurs déclencheurs dans l'éditeur en phrases, les **actions** (une
automatisation TasmoFlow devient une règle Tasmota ou du Berry, les déclencheurs Tuya demandent du
Berry), la **modification** des règles Berry et d'`autoexec.be` avec copie avant écriture et contrôle de
compilation. Les étapes 2 à 4 (éditeur en phrases, sélecteurs, vue Berry et conflits) sont écrites et
en partie essayées sur la passerelle, voir le plan de test.

## Points à vérifier

- **Une URL longue fait redémarrer la passerelle** (port 8384, ligne de requête de 152 caractères
  ou plus) : cause trouvée et corrigée dans le code (10 novembre, voir
  [Lecture des requêtes sans expressions régulières](architecture.fr.md#lecture-des-requêtes-sans-expressions-régulières)
  et [investigations/long-url-crash.md](investigations/long-url-crash.md), en anglais). Vérifié sur la
  passerelle le 11 novembre ; la fausse passerelle répond maintenant 414 au-delà de 512 caractères,
  comme la vraie.

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
