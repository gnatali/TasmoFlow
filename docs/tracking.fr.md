# Suivi des travaux : TasmoFlow

*English version: [tracking.en.md](tracking.en.md)*

État du projet, décisions, mesures et prochaines étapes, pour reprendre le travail dans une
nouvelle session. Architecture et plan de test : [architecture.fr.md](architecture.fr.md).
Cahier des charges (en français, hors du dépôt) :
<https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix>.

## État (9 novembre 2026)

- **`.tapp` divisée par deux** (11 novembre 2026, branche `claude/tasmoflow-tapp-reduction-t5ofde`,
  demande de Guillaume) : 83 069 octets en v0.2.0, **40 920 octets** maintenant (-51 % ; budget de
  `pack_tapp.py` 41 534 octets, la moitié de la v0.2.0). L'interface légère ne garde que le
  pilotage des appareils et la mise à jour (règles, console et diagnostic en sont sortis :
  interface complète seulement), sans `preact/hooks` ; les fichiers Berry sont minifiés à
  l'assemblage (la CI les compile et passe le test du parseur sur le `tf_http.be` minifié). **Fonctionne sur
  la passerelle** (12 novembre, Guillaume). Ensuite le contrôle de place de la mise à jour, qui
  demandait encore deux nouvelles copies plus 20 Ko, a été refait d'après les tailles réelles
  (`/api/update_check`, taille de `latest.json`) : 21 tests de bout en bout passent, **vérifié sur
  la passerelle** (12 novembre, Guillaume). Détails :
  [architecture](architecture.fr.md#avant-le-18-novembre-2026--une-interface-légère-dans-la-tapp) ;
  depuis le 18 novembre 2026 la `.tapp` ne contient plus aucune interface
  ([copie locale](architecture.fr.md#copie-locale-de-linterface)).
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
- **Plantage des URL longues corrigé** (10 novembre, branche `ccr-77cdec39-duy9lp`) :
  cause trouvée dans le source de Tasmota (le moteur de `re` s'appelle lui-même une fois par
  caractère de l'URI et déborde la pile de 8 Ko de la boucle) ; `tf_http.be` lit désormais les
  requêtes avec `string.find()`. **Vérifié sur la passerelle** (12 novembre, Guillaume).
- **Vérifié sur la passerelle le 12 novembre** (Guillaume) : contrôle de place de la mise à jour,
  pilotes détectés à l'ouverture, URL longues, port 8384 fermé puis ré-écouté. Les 6 Ko de mémoire
  libre non rendus après la première ouverture : **pas poursuivis** (décision de Guillaume).
- **Suite** : dérouler les points `[ ]` du
  [plan de test](architecture.fr.md#plan-de-test-sur-la-passerelle) sur la ZB-GW03 (v0.1 et les
  nouveaux de la v0.2). Mémoire avec l'API des règles mesurée le 11 novembre (plus bas).

## Historique

| Date | Étape |
| --- | --- |
| 21 nov. | **Fiche des appareils Tuya : faisabilité** (plan de Guillaume) : [investigations/tuya-device-details-2026-11.md](investigations/tuya-device-details-2026-11.md) (en anglais). Go sans modifier le firmware pour l'identité, les codes, les valeurs en direct, les capteurs et les liens Matter (`TuyaConfig <appareil>`, `TuyaStatus`, événements) ; types et plages depuis un catalogue tuya-local (MIT, 2 018 identifiants produit, indexé par le `productKey` de `TuyaScan`) sur GitHub Pages ; API cloud depuis le navigateur : no-go (CORS limité aux sites de Tuya, règle sur les identifiants). Mesuré le 22 novembre : aucun coût mémoire durable (56-57 Ko libres après `TuyaConfig`, `TuyaStatus`, `TuyaScan 10`), un `product_key` pour chacun des 6 appareils Wi-Fi, mais des identifiants génériques partagés par des produits sans rapport : le catalogue doit se baser sur les DP (5 sur 6 trouvés ainsi, le sixième est une passerelle Tuya sans DP) |
| 21 nov. | **Plan de test v0.2, premier passage** (Guillaume) : vue Phrases, plusieurs déclencheurs et `elseif`, section Berry (les règles propres de TasmoFlow `Tuya`/`TuyaConnected`/`TuyaDisconnected` masquées, comme prévu) **vérifiés**. Trouvé : avec `SetOption83 1` les appareils nommés disparaissaient des sélecteurs, et une règle par adresse affichait le nom de l'appareil alors qu'elle ne peut jamais se déclencher. Corrigé : les noms avec un espace servent de clé de déclencheur (Tasmota prend le déclencheur jusqu'à ` DO `, `xdrv_10_rules.ino` ; le modèle et le renommage suivent), et un déclencheur dont la clé ne correspond pas à `SetOption83` est signalé sur sa tuile et dans le formulaire, avec **Corriger le déclencheur** (`keyMismatch()`) ; interface complète seulement, pas de `.tapp` à réinstaller. Puis **le `Power` d'un bouton absent** (SNZB-01P : `ZbInfo` ne garde que sa batterie) : les sélecteurs et le mode guidé proposent maintenant les attributs vus dans les événements et dans les jeux de règles, et `Power` pour un appareil qui n'a que sa batterie ; `BatteryLastSeenEpoch` n'est plus proposé. Reste : conflits (à refaire avec de vrais noms), mode guidé, déclencheurs *connecté*, cas d'échec de la mise à jour |
| 21 nov. | **Renommer des appareils** (demandé par Guillaume) : bouton **Renommer** sur les cartes Zigbee et Tuya (`rename.js`, `rename_model.js`), `ZbName` et la nouvelle commande `TuyaRename` du firmware (dépôt du firmware, même branche, scénario 30, endpoint Matter gardé) ; la réécriture des jeux de règles qui nomment l'appareil est proposée (`ZbReceived#<nom>#` avec `SetOption83`, `ZbSend`, `TuyaSend`, `TuyaConnected#Name=`), règles Berry listées ; conséquences et solutions dans l'[architecture](architecture.fr.md#renommer-des-appareils). 36 tests de bout en bout, 36 contrôles unitaires. Pas de `.tapp` à réinstaller (`app/src/` seulement) ; Tuya demande le nouveau firmware flashé. **Vérifié sur la passerelle** (Guillaume, `0.2.0-dev.1a7f51a`, firmware `4bf2549`) |
| 21 nov. | Test de T10 : `.tapp` `0.2.0-dev.de52476` installée à la main (Guillaume) ; builds de test faits pour deux mises à jour de suite. Première mise à jour (vers `0.2.0-dev.a6d0343`) : réussie, `one rename` ; seconde (vers `0.2.0-dev.fe5913e`) : réussie, `one rename`. **T10 vérifié sur la passerelle** (`.bak` correct, aucun `.new` restant) ; **T7 et T12 vérifiés** aussi. Heap libre 60 Ko (conditions à confirmer : 69 Ko au repos le 20 novembre) |
| 21 nov. | **Mémoire mesurée en une seule série** (Guillaume, `0.2.0-dev.fe5913e`, firmware `fd7f7cc`, après `Br tasmota.gc()`) : 67 Ko au repos (15 Ko), **43 Ko** interface ouverte (39 Ko ; 53 Ko le 20 novembre, sous les 45 Ko qu'il faut au driver Tuya pour démarrer), 63 Ko après fermeture (19 Ko). Les 10 Ko interface ouverte ne sont **pas poursuivis** (décision de Guillaume du 21 novembre 2026) |
| 21 nov. | **T10 corrigé** (analyse de bugs) : la mise à jour copie `TasmoFlow.tapp` en `.bak`, puis renomme le nouveau fichier par-dessus en une seule étape (littlefs remplace un fichier existant en un seul commit, vérifié dans les sources sur tout le chemin) : une coupure laisse l'ancienne ou la nouvelle version, jamais aucune ; les deux renommages d'avant restent en secours ; ligne du README sur le renommage du `.bak`. **La `.tapp` doit être installée à la main une fois** (le code de mise à jour a changé), puis une mise à jour dit quelle voie elle a prise (`TFL: update installed (one rename)`) |
| 21 nov. | **T7, T12 corrigés** (analyse de bugs) : un enregistrement de règle reçoit un numéro de `rule_set`, et les étapes d'un enregistrement plus ancien répondent `busy` (l'interface dit qu'une autre interface enregistre, n'écrit et ne restaure rien) ; noms d'en-têtes sans tenir compte de la casse, seule une requête avec le jeton garde le serveur éveillé, un EventSource qui se reconnecte reprend à son `Last-Event-ID` au lieu de rejouer l'historique. 34 tests de bout en bout. **La `.tapp` doit être réinstallée** (`extension/`) |
| 21 nov. | **Commande Tuya sans réponse : vérifiée sur la passerelle** (Guillaume), avec le firmware du 21 novembre (commit `fd7f7cc`, run 44893756664). Le premier build du firmware de ce correctif (20 novembre) ne démarrait pas : un membre de plus dans une classe solidifiée du driver ; réécrit sans (dépôt firmware, `berry-pitfalls.md`) |
| 20 nov. | **T5 vérifié sur la passerelle** (Guillaume). **Commande Tuya sans réponse** (son second essai : une lampe débranchée puis allumée avant que le driver ne s'en aperçoive) : `TuyaSend` répondait `Done` et rien ne s'affichait pendant 35 s. Les cartes Tuya attendent maintenant 5 s un événement de l'appareil après une commande répondue `Done`, sinon « L'appareil n'a pas répondu à la commande. » sous la carte (aussi pour un sous-appareil d'une passerelle Tuya, que le driver ne peut pas surveiller) ; son événement suivant l'efface. En plus, le driver du firmware considère comme perdu un appareil qui ne répond pas à une commande en 5 s (`no reply to command`, `TuyaDisconnected` ; dépôt firmware, branche `ccr-a1ed84c3-jng9nv`, 30/30 scénarios, firmware compilé : **à flasher**). Ici, interface seule, pas de `.tapp` à réinstaller. 34 tests de bout en bout |
| 20 nov. | **Appareil Zigbee qui ne répond pas** (retour de Guillaume, T11 essayé sur une prise Zigbee coupée) : Basculer affichait la réponse brute de Tasmota `{"0xF397":{"Reachable":false}}`, et une prise sur secteur affichait « batterie -1 % ». Désormais la carte affiche « L'appareil ne répond pas (injoignable). » en dessous et « injoignable » dans sa ligne dès que Tasmota publie `Reachable:false` (`attributes_final`, `Z_Unreachable` dans `xdrv_23_zigbee_6_0_commands.ino`), et revient à la normale au message suivant de l'appareil ; une batterie de -1 (inconnue, `zd_battery` dans `xdrv_52_3_berry_zigbee.ino`) n'est plus affichée. Interface seule, pas de `.tapp` à réinstaller. T5 reste à essayer avec un appareil **Tuya Wi-Fi** (la prise coupée était Zigbee). 34 tests de bout en bout |
| 20 nov. | **Mémoire mesurée en une seule série** (Guillaume, après `Br tasmota.gc()` ; 82 Ko libres sans TasmoFlow) : 69 Ko au repos (**13 Ko**), 53 Ko interface ouverte (**29 Ko**, 16 Ko de plus qu'au repos ; 8 Ko au-dessus des 45 Ko qu'il faut au driver Tuya pour démarrer), 66 Ko après la fermeture de tous les onglets et `TFL: API server stopped` (**16 Ko**, 3 Ko non rendus, 6 Ko avant). Les relevés précédents de 46 / 51 Ko venaient de séries mélangées. Le budget de 15 Ko tient au repos ; après la première ouverture il est dépassé d'1 Ko |
| 20 nov. | **Coût au repos mesuré** (Guillaume, 5 minutes après `Restart 1`, après `Br tasmota.gc()`) : 82 Ko libres sans TasmoFlow, 69 Ko avec : **13 Ko au repos**, dans le budget de 15 Ko. Les 58 Ko au repos de la ligne ci-dessous ont été relevés trop tôt après le redémarrage. Rapportés à 69 Ko, les 51 Ko après fermeture laisseraient 18 Ko non rendus (6 Ko avant) : à mesurer à nouveau en une seule série (repos, ouverte, plus de 5 minutes après la fermeture de tous les onglets, `TFL: API server stopped` dans le journal) |
| 20 nov. | **Mémoire mesurée** (Guillaume, après `Br tasmota.gc()`, firmware avec le driver Tuya solidifié) : 58 Ko libres au repos, 46 Ko interface ouverte (12 Ko), 51 Ko cinq minutes après sa fermeture (7 Ko non rendus, 5-6 Ko avant : le reliquat connu, non poursuivi). Pas comparable aux 75 Ko du 11 novembre : le firmware a changé depuis (driver Tuya du 18 novembre) ; le coût au repos demande un relevé sans TasmoFlow sur ce firmware. Interface ouverte, 46 Ko libres, c'est 1 Ko au-dessus de ce qu'il faut au driver Tuya pour démarrer (45 Ko), 16 Ko au-dessus de son seuil `tuya.json` (30 Ko) |
| 20 nov. | **Copie locale vérifiée sur la passerelle** (Guillaume) : hors ligne, suppression et mémoire passent. `HeapUsed` Berry : 46 Ko interface fermée, 63 Ko juste après son chargement (39 et 55 Ko à l'étape 1 de la v0.2) ; heap libre (`Status 4`) non relevé, le coût de TasmoFlow n'est donc pas calculé |
| 19 nov. | **Vérifié sur la passerelle** (Guillaume) : la `.tapp` T6/T9 installée par le bouton de mise à jour (mise à jour avec copie locale : réussie), T6 et T9 passent, la copie locale est enregistrée. Reste pour la copie locale : hors ligne, suppression, mémoire |
| 19 nov. | **T6, T9 corrigés** (analyse de bugs) : une quatrième interface ne fait plus s'évincer les interfaces toutes les 3 s (le plus ancien flux reçoit `event: stop`, sa page cesse de se reconnecter et propose **Reprendre**) ; le port 8384 garde 10 connexions au plus (503 au-delà), coupe une requête incomplète après 10 s et une réponse non prise 30 s après sa fin. 34 tests de bout en bout passent, `tests/tf_http_test.be` vérifie les délais et la limite. `.tapp` 29 405 octets. **La `.tapp` doit être réinstallée** (le bouton de mise à jour le fait) |
| 18 nov. | **Plus d'interface dans la `.tapp`, copie locale** (décision de Guillaume, qui remplace celle du 9 novembre) : l'interface légère (`lite.js.gz`, 14 Ko) disparaît, la `.tapp` fait **28 927 octets** (au lieu de 42 369). L'interface se charge depuis la copie locale de la passerelle quand elle en a une pour sa version (`TasmoFlow.tapp.js`, enregistrée depuis Diagnostic, SHA-256 contrôlé avec l'`APP_SHA` de la `.tapp`), sinon depuis GitHub ; sans l'une ni l'autre, `/tf` le dit en une ligne. Le bandeau de mise à jour est dans l'interface (un clic, sans confirmation ; **Plus tard** le masque), et après une mise à jour la copie est réenregistrée d'elle-même. Zopfli et `tools/requirements.txt` supprimés. 33 tests de bout en bout passent. **La `.tapp` doit être réinstallée à la main** (le code de mise à jour a changé), puis enregistrer la copie une fois (Diagnostic) |
| 18 nov. | **T5, T8, T11 corrigés** (analyse de bugs) : les cartes Tuya suivent `TuyaConnected` / `TuyaDisconnected` du pilote (les sous-appareils suivent leur passerelle), sans « Actualiser » ; l'interface légère est chargée en `/lite.js?v=<version>`, donc le cache du navigateur ne lance jamais l'ancienne après une mise à jour ; « Basculer » et « Appairer » (Zigbee) affichent la réponse de Tasmota quand elle n'est pas `Done`, comme les cartes Tuya. Points robustesse et redémarrage du plan de test vérifiés par Guillaume (13 Ko avec l'interface ouverte). `.tapp` 42 369 octets (131 octets de marge). **La `.tapp` doit être réinstallée** (`extension/`, le chargeur et l'interface légère) |
| 18 nov. | **Configuration Tuya appareil par appareil** (fin de T4) : avec le firmware du même jour (`TuyaConfig <appareil>` lu entrée par entrée, sous-appareils trouvés), l'interface demande `TuyaConfig <nom>` pour chaque appareil pas encore connu ; jamais tout `tuya.json`, plus de seuil mémoire. Firmware plus ancien : configuration entière lue une fois pour les sous-appareils. `.tapp` 41 988 octets. **La `.tapp` doit être réinstallée**, et le firmware flashé (dépôt du firmware, branche `claude/awesome-planck-mow2gg`) |
| 18 nov. | **T2 à T4 corrigés** (analyse de bugs ; T4 en partie) : un gestionnaire de l'API qui lève une exception reçoit maintenant une réponse 500 (garde dans `tf_http.be`, `cmdv()` sûr), l'interface abandonne une requête après 15 s ; un flux d'événements avec plus de 6 Ko non envoyés est fermé et l'historique est limité à 4 Ko ; `/api/devices` est envoyé un appareil à la fois ; `TuyaConfig` est lu une fois par passerelle (puis appareil par appareil, entrée suivante). `lite.js.gz` compressé avec Zopfli (`pip install -r tools/requirements.txt`), minifieur Berry plus serré ; **budget de la `.tapp` relevé à 42 500 octets par Guillaume** (41 962 octets). **La `.tapp` doit être réinstallée** (`extension/` et interface légère). À vérifier et mesurer sur la passerelle (plan de test) |
| 18 nov. | **T1 corrigé** (analyse de bugs) : après un redémarrage de la passerelle, une interface ouverte n'ignore plus les événements. Quand le flux d'événements revient après une coupure, l'interface relit tout, et repart de l'événement 0 quand le compteur de la passerelle a reculé. Passerelle simulée : un redémarrage renumérote les événements à partir de 1. 30 tests de bout en bout. `.tapp` 41 526 octets (8 octets de marge) ; **la `.tapp` doit être réinstallée** (`state.js` fait partie de l'interface légère). À vérifier sur la passerelle (plan de test) |
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
| 12 nov. | **Pilotes détectés à l'ouverture** (demandé par Guillaume) : `S.drivers` (`zigbee`, `tuya` : running, starting, disabled, absent), `zigbee_state` ajouté à `/api/status` ; un pilote qui ne tourne pas a ses fonctions désactivées avec une note. Interface complète : relit toutes les 5 s tant qu'un pilote démarre (2 minutes au plus) et l'active toute seule ; interface légère : désactivé dans tous les cas, demande de recharger la page, aucune boucle. `.tapp` 41 352 octets (budget 41 534). 24 tests de bout en bout. **La `.tapp` doit être réinstallée** (`extension/` et interface légère modifiés) ; à essayer sur la passerelle (élément « pilotes à l'ouverture » du plan de test) |
| 12 nov. | Builds de test (`--dev`) : Berry minifié comme une release, mais sans budget de taille (la release de chaque commit reste contrôlée par la CI). Essayé sur un build : `.tapp` de test avec les sources telles quelles (77 Ko), abandonné à la demande de Guillaume |
| 12 nov. | **Vérifié sur la passerelle** (Guillaume, version de test 78) : onglets, roue et curseurs de la `light3`, cadran d'arc de la `light2`, luminosité 1-100 %, valeur tenue sans clignotement, options masquées lampe éteinte ou déconnectée, noms avec virgule, variateur de l'interface légère. Reste pour la v0.1 : coupure de courant pendant la mise à jour, `sha256` faux, mémoire de `TuyaConfig` (32 Ko) |
| 12 nov. | Panneau `light2` / `light3` : une valeur qu'on vient de régler reste affichée jusqu'à ce que l'appareil la signale (3 s au plus), plus de clignotement nouvelle / ancienne / nouvelle ; options masquées tant que la lampe est éteinte ou déconnectée ; le simulateur répond maintenant 0,4 s plus tard. Interface complète seulement |
| 12 nov. | Température de couleur (DP 23) en cadran d'arc ouvert (270 degrés, du chaud au froid) dans le panneau `light2` et dans l'onglet Blanc d'une `light3` avec `dp_ct` ; interface complète seulement, pas de `.tapp` à réinstaller pour cela |
| 12 nov. | Panneau `light2` comme `light3` (luminosité + température de couleur du chaud au froid, mode blanc envoyé d'abord en sortant d'une scène) et curseurs de luminosité de 1 % à 100 % (jamais 0, comme l'application Tuya), aussi dans l'interface légère : le `.tapp` est à réinstaller (41 457 octets, 77 octets de marge) |
| 12 nov. | Restes de la v0.1 écrits : couleur des liaisons `light3` (interface complète seulement, `tuya_colour.js` branché par `EXTRA.refine` ; refait comme l'application Tuya : onglets Blanc / Couleur qui suivent le mode de l'appareil, roue de teinte, curseurs de saturation et de luminosité, luminosité en Blanc, pas de température de couleur sans `dp_ct`) et appareils Tuya dont le nom contient une virgule (adressés par leur `id`, `sendName`). Passerelle simulée : une `light3`, deux appareils avec virgule. 24 tests de bout en bout, 24 contrôles unitaires. La `.tapp` est à réinstaller ; deux nouveaux points dans le plan de test |
| 12 nov. | **Vérifié sur la passerelle** (Guillaume) : contrôle de place de la mise à jour, pilotes à l'ouverture, URL longues, port 8384 fermé puis ré-écouté. Les 6 Ko de mémoire non rendus après la première ouverture : abandonnés, plus d'enquête |
| 12 nov. | **Fichier `VERSION` supprimé, le tag git est la seule source de la version** (le job `release` échouait chaque fois qu'un tag différait du fichier). `tools/version.py` la résout (`TF_VERSION`, tag de release, dernier tag, `0.0.0`) ; le workflow récupère les tags et reconstruit `dist/` après les tests, qui utilisent une version fixe ; pas de `.tapp` à réinstaller (`extension/` inchangé) |
| 12 nov. | `.tapp` réduite vérifiée sur la passerelle (Guillaume). Le contrôle de place de la mise à jour ne suivait pas les tailles réelles (deux nouvelles copies plus 20 Ko) : maintenant `/api/update_check?size=` (taille de `latest.json`), avant le téléchargement puis au premier morceau, compare l'espace libre, la `.bak` et un `.new` resté à la nouvelle taille plus 20 Ko ; la `.bak` n'est supprimée qu'en cas de besoin. `.tapp` 40 920 octets. 21 tests de bout en bout |
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
| **v0.2**, sans TasmoFlow, 5 minutes après `Restart 1` (20 novembre) | 82 Ko | | |
| **v0.2**, avec TasmoFlow, 5 minutes après `Restart 1` (20 novembre) | 69 Ko | | **13 Ko** |
| **v0.2**, avec TasmoFlow, interface ouverte (20 novembre, même série) | 53 Ko | | **29 Ko** |
| **v0.2**, avec TasmoFlow, après fermeture de tous les onglets, serveur API arrêté (20 novembre, même série) | 66 Ko | | **16 Ko** |
| **v0.2**, build T7/T10/T12, au repos (21 novembre) | 67 Ko | | **15 Ko** |
| **v0.2**, build T7/T10/T12, interface ouverte (21 novembre, même série ; non poursuivi) | 43 Ko | | **39 Ko** |
| **v0.2**, build T7/T10/T12, après fermeture de tous les onglets (21 novembre, même série) | 63 Ko | | **19 Ko** |
| **v0.2**, pas d'interface dans la `.tapp`, au repos après `Restart 1` (20 novembre, firmware avec le driver Tuya solidifié) | 58 Ko | non relevé | |
| **v0.2**, pas d'interface dans la `.tapp`, interface ouverte (20 novembre) | 46 Ko | 63 Ko | 12 Ko de plus qu'au repos |
| **v0.2**, pas d'interface dans la `.tapp`, 5 minutes après sa fermeture (20 novembre) | 51 Ko | 46 Ko | 7 Ko de plus qu'au repos |

Le budget de 15 Ko est tenu avec l'API des règles : **8 à 9 Ko au repos, 14 Ko cinq minutes après la fermeture de l'interface** (15 Ko en v0.1). Interface ouverte, le coût est de 32 Ko (25 Ko en v0.1) : `tf_rules.be` et le corps POST ajoutent 7 Ko tant que le serveur tourne. Le pilote Tuya demande 45 Ko libres pour démarrer : 52 Ko laissent 7 Ko de marge. `HeapUsed` de Berry revient à 39 Ko après la fermeture, comme en v0.1. Environ 6 Ko de mémoire libre ne sont toujours pas rendus après la première ouverture (75 à 70 Ko, comme en v0.1 : 75 à 69 Ko), cause inconnue et **pas poursuivie** (décision du 12 novembre 2026).

Cible : 15 Ko. Tailles (19 novembre 2026, sans interface dans la `.tapp`) : `TasmoFlow.tapp` 28,7 Ko (29 405 octets, budget **42 500 octets**,
relevé par Guillaume le 18 novembre depuis 41 534, la moitié des 83 Ko de la v0.2.0 : 13,1 Ko de marge), `app.js.gz` 36,3 Ko (37 193 octets, budget 120 Ko ; c'est aussi la copie locale, sur le système de fichiers de la passerelle quand elle est enregistrée). Pistes pour gagner plus : [investigations/tapp-size-2026-11.md](investigations/tapp-size-2026-11.md) (en anglais).

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
   retient encore la classe `tf_http`. **Abandonné le 12 novembre 2026**, plus d'enquête.
3. **Appareils Tuya dans le tableau de bord** (F7.1 à F7.3) : interrupteurs, variateurs,
   température de couleur, vitesse de ventilateur, mesures, mise à jour en direct, masqués sans
   le pilote.
4. **Plusieurs passerelles** (F1) : écran Passerelles, lien à copier, réveil d'un serveur arrêté.

Reste pour la v0.1 (petit) :

- **Panneau `light3`** (`colour_data_v2`) : **écrit** (12 novembre 2026) comme l'application Tuya (onglets Blanc / Couleur, roue de teinte, saturation et luminosité), interface complète seulement (`tuya_colour.js`), **vérifié sur la passerelle** (12 novembre 2026), avec le cadran d'arc de la `light2`, la valeur tenue et les options masquées lampe éteinte.
- **Noms Tuya avec une virgule** : **écrit** (12 novembre 2026) : un tel appareil est adressé par son `id` (appareils Wi-Fi et passerelles Tuya) ; un sous-appareil de passerelle n'en a pas et montre seulement ses mesures. **Vérifié sur la passerelle** (12 novembre 2026). La `.tapp` a dû être réinstallée (`tuya.js` et `tuya_model.js` sont dans l'interface légère).
- **La version est le tag git** (12 novembre 2026, plus de fichier `VERSION`) : rien à modifier avant de tagger.
- **Vérifications sur la passerelle** : les points `[ ]` marqués v0.1 du plan de test (le
  `tcpserver` du port 8384 fermé puis ré-écouté a été vérifié le 12 novembre), en particulier la
  mémoire utilisée par `TuyaConfig`.

**Mode guidé** (accepté le 11 novembre 2026, **écrit** le 12 novembre 2026) : une tuile *Règle guidée* ouvre une fenêtre en deux étapes (choisir un appareil, dire en mots ce qui lui arrive, choisir quoi faire), où un déclencheur Zigbee peut s'apprendre en appuyant sur le bouton (l'interface écoute le flux d'événements et écrit le déclencheur d'après ce qu'elle vient de voir). Interface complète seulement, pas de `.tapp` à réinstaller ; **à essayer sur la passerelle avec le vrai bouton** (plan de test). Pour plus tard : conditions dans la fenêtre guidée, déclencheurs Tuya et Matter.

**`elseif`, plusieurs déclencheurs et un déclencheur *appareil connecté*** (12 novembre 2026) : **écrits**, interface complète seulement ; à essayer sur la passerelle (plan de test). Tasmota n'a pas de `and`/`or` entre déclencheurs : plusieurs déclencheurs sont donc plusieurs blocs aux mêmes actions. *Connecté* est `ZbState#ShortAddr` pour Zigbee (l'annonce de l'appareil : appareils sur secteur seulement), et `TuyaConnected#Name` / `TuyaDisconnected#Name` pour Tuya, ce qui **demande le nouveau pilote du dépôt du firmware** (branche à compiler et à flasher) ; voir l'[architecture](architecture.fr.md).

La v0.2.0 est taguée (12 novembre 2026). Ensuite : mesurer la mémoire de la version publiée (au repos, interface ouverte, après fermeture) et essayer sur la passerelle les nouveaux points du plan de test.

v0.2, ce qui reste après l'étape 4 : le **mode guidé** (écrit, à essayer sur la passerelle), Matter dans les
sélecteurs, les **actions** (une
automatisation TasmoFlow devient une règle Tasmota ou du Berry, les déclencheurs Tuya demandent du
Berry), la **modification** des règles Berry et d'`autoexec.be` avec copie avant écriture et contrôle de
compilation. Les étapes 2 à 4 (éditeur en phrases, sélecteurs, vue Berry et conflits) sont écrites et
en partie essayées sur la passerelle, voir le plan de test.

## Points à vérifier

- **Une URL longue fait redémarrer la passerelle** (port 8384, ligne de requête de 152 caractères
  ou plus) : cause trouvée et corrigée (10 novembre, voir
  [Lecture des requêtes sans expressions régulières](architecture.fr.md#lecture-des-requêtes-sans-expressions-régulières)
  et [investigations/long-url-crash.md](investigations/long-url-crash.md), en anglais). **Vérifié sur la
  passerelle le 12 novembre.** Rien à faire ; la fausse passerelle répond 414 au-delà de 512
  caractères, comme la vraie.

- Écriture d'un DP d'un appareil Tuya Zigbee (TS0601, cluster `EF00`) avec `ZbSend` : à essayer
  sur un appareil réel (nécessaire pour la v0.3).

- **Analyse de bugs du 15 novembre 2026**
  ([investigations/bug-analysis-2026-11.md](investigations/bug-analysis-2026-11.md), en anglais) :
  12 constats classés par priorité et 10 pistes d'amélioration. **T1 à T4 corrigés** le 18
  novembre 2026 (T4 avec le firmware du même jour : `TuyaConfig <appareil>` lu entrée par
  entrée), vérifiés sur la passerelle par Guillaume ; **T5, T8, T11 corrigés** le même soir, à
  vérifier (T8 est parti avec l'interface légère) ; **T6, T9 corrigés** le 19 novembre, vérifiés sur la passerelle par Guillaume ; T5 et T11 vérifiés le 20 novembre ; T7, T10 et T12 corrigés et vérifiés le 21 novembre : tous les points sont corrigés et vérifiés.
  Ensuite : T7, T10, T12.

- **Réduire le `.tapp`** (18 novembre 2026) :
  [investigations/tapp-size-2026-11.md](investigations/tapp-size-2026-11.md) (en anglais) liste
  les pistes et leurs gains. Zopfli a été fait, puis le budget relevé à 42 500 octets ; le même soir
  l'interface légère a quitté la `.tapp` (28 927 octets, 13,6 Ko de marge) : plus rien à faire pour
  l'instant.

## Liens

| Quoi | Où |
| --- | --- |
| Dépôt | <https://github.com/gnatali/TasmoFlow> |
| Firmware | <https://github.com/gnatali/tasmota32-zbgw03-matter> (pilote Tuya : `docs/tuya-local.fr.md`) |
| Cahier des charges et feuille de route | <https://claude.ai/artifact/14CHvnBUKENcDnqUBfBnix> |
| Release v0.0.1 | <https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1> |
| Interface sur GitHub Pages | `https://gnatali.github.io/TasmoFlow/v0.0.1/app.js` |
