# Architecture de TasmoFlow

*English version: [architecture.en.md](architecture.en.md)*

TasmoFlow garde le firmware intact : l'interface est une extension Berry (`.tapp`) qui ouvre
un second serveur HTTP sur la passerelle. Le serveur principal de Tasmota ne permet pas
d'ajouter des en-têtes depuis Berry, ce second serveur le permet.

Les constats ci-dessous viennent du code source de Tasmota, branche `development`,
commit `b7994b52c47777ea3f125723f2ba5db6d3669397` (5 novembre 2026). Ils restent à
confirmer sur une vraie ZB-GW03 (voir le [plan de test](#plan-de-test-sur-la-passerelle)).

## Deux serveurs sur la passerelle

| Port | Serveur | Rôle |
| --- | --- | --- |
| 80 | Serveur web de Tasmota | Bouton « TasmoFlow » du menu principal, page `/tf` protégée par le mot de passe web |
| 8384 | `tf_http.be`, serveur asynchrone Berry | API JSON, flux d'événements, copie locale de l'interface ; en-têtes CORS et `Content-Encoding` ; [seulement pendant qu'une interface est ouverte](#serveur-dapi-à-la-demande) |

La page `/tf` transmet à l'interface l'adresse de l'API et un jeton de 128 bits, créé au
premier démarrage et gardé dans `persist`. Toutes les routes `/api/*` exigent ce jeton
(paramètre `t`) ; seule `/app.js` est publique.

### Serveur d'API à la demande

La RAM est la ressource critique : le serveur du port 8384 (`tf_http.be`) n'est pas démarré au
boot (v0.1) :

- `/tf`, une fois le mot de passe vérifié, le démarre. `tf_http.be` est compilé à ce moment
  (`import` dans `start_api()`) : aucune RAM n'est dépensée avant la première ouverture de
  l'interface.
- `/tf?w=1` le démarre aussi, **sans mot de passe et sans renvoyer aucune donnée**. Elle permet
  à une interface ouverte sur une autre passerelle de réveiller celle-ci (voir
  [Plusieurs passerelles](#plusieurs-passerelles)) ; l'API elle-même exige toujours le jeton.
- Le serveur s'arrête après 5 minutes (`IDLE_MS`) sans requête et sans flux d'événements
  ouvert. Les événements et les gestionnaires Zigbee et Tuya n'existent que pendant qu'il tourne.
- Une interface ouverte dont le flux d'événements tombe rappelle `/tf?w=1` (au plus toutes les
  10 s), ce qui couvre un redémarrage de la passerelle.

### Accès à la page `/tf`

`webserver.check_privileged_access()` appelle `HttpCheckPriviledgedAccess()` : authentification
HTTP Basic si `WebPassword` est défini, puis contrôle de l'en-tête `Referer`, qui doit venir de
la passerelle (sauf `SetOption128 1`). Sans `Referer`, Tasmota refuse et ne renvoie rien
(`xdrv_01_9_webserver.ino`). `/tf` renvoie donc d'abord une page qui se recharge elle-même
quand l'en-tête manque.

### Pourquoi un second port

- `webserver.content_open()` n'envoie que les en-têtes de `WSHeaderSend()` : `Server`,
  `Cache-Control`, `Pragma`, `Expires`. Le CORS n'y est ajouté qu'avec `USE_CORS` à la
  compilation, absent du build officiel (`tasmota/tasmota_xdrv_driver/xdrv_01_9_webserver.ino`).
- Le module Berry `webserver` n'a aucune fonction pour ajouter un en-tête de réponse
  (`lib/libesp32/berry_tasmota/src/be_webserver_lib.c`).
- Le firmware compile la classe `webserver_async`, qui gère les en-têtes, le CORS et les
  réponses en continu, mais ne l'expose pas en Berry. L'extension officielle Leds Panel en
  embarque sa propre copie ; TasmoFlow fait de même (`extension/tf_http.be`).
- Le serveur WebSocket Berry (`be_wsserver_lib.c`) exige `CONFIG_HTTPD_WS_SUPPORT` à la
  compilation : le temps réel passe donc par des Server-Sent Events sur le port 8384.

Conséquences :

- **Plusieurs passerelles** : une interface ouverte sur la passerelle A peut appeler l'API
  de la passerelle B, puisque le port 8384 envoie `Access-Control-Allow-Origin: *`. Il lui
  faut le jeton de B (voir ci-dessous).
- **Copie locale compressée** : servie avec `Content-Encoding: gzip`, le navigateur la
  décompresse lui-même.
- **Temps réel** : `/api/events` garde la connexion ouverte et pousse chaque message Zigbee
  dès sa réception, sans interrogation régulière.

### Plusieurs passerelles

L'écran **Passerelles** de l'interface (v0.1) :

- **Cette passerelle** : un lien `adresse:port#jeton` (le jeton est masqué tant qu'on ne
  l'affiche pas), à copier puis coller dans l'interface d'une autre passerelle. La copie
  retombe sur `execCommand` car l'API Clipboard exige un contexte sécurisé, ce que n'est pas
  `http://<passerelle>`.
- **Autres passerelles** : nom, adresse et jeton gardés dans le navigateur (`localStorage` de
  l'adresse de la page : une liste est propre à l'adresse, IP ou nom, utilisée pour joindre la
  passerelle). Tester, utiliser, supprimer. L'en-tête reçoit un sélecteur dès qu'une passerelle
  est enregistrée.
- Changer de passerelle ferme le flux d'événements, vide les appareils et recharge tout depuis
  l'autre API. Le serveur de B peut être arrêté : l'interface envoie d'abord `/tf?w=1` au port 80
  de B (requête opaque `no-cors` : seul son effet compte), puis relit `/api/status` pendant 5 s.
- Le port 80 est supposé pour le serveur principal des autres passerelles.
- Les jetons ne sont pas des secrets entre passerelles d'un même administrateur, mais ils ne
  s'affichent que sur demande et ne figurent pas dans `/api/status`.

## Chargement de l'interface

1. Le navigateur ouvre `http://<passerelle>/tf`.
2. La page charge `https://gnatali.github.io/TasmoFlow/vX.Y.Z/app.js` avec l'empreinte SRI
   calculée à l'assemblage. Une page HTTP peut charger un script HTTPS.
3. Si GitHub ne répond pas en 3 s, ou si l'empreinte ne correspond pas, la page charge
   `http://<passerelle>:8384/app.js`, la copie gzip contenue dans la `.tapp`.
4. Si les deux échouent, la page l'affiche.

Le script se protège d'un double démarrage : la copie GitHub peut arriver après le délai,
quand la copie locale tourne déjà.

## API du port 8384

| Route | Réponse |
| --- | --- |
| `GET /app.js` | Copie locale de l'interface (gzip), envoyée par blocs de 1 Ko |
| `GET /api/status?t=` | Versions, mémoire libre, système de fichiers, état de Zigbee, nombre d'appareils |
| `GET /api/devices?t=` | Appareils Zigbee : adresse, nom, modèle, fabricant, LQI, batterie, dernier message, derniers attributs |
| `GET /api/cmd?t=&c=` | Exécute une commande Tasmota (`c`, encodée) et renvoie sa réponse JSON |
| `GET /api/events?t=&since=` | Flux SSE ; renvoie d'abord les événements gardés après `since` (50 au plus) |

Les événements portent un numéro de séquence et un `type` : `zigbee` (`device`, `name`,
`attrs`) et `tuya` (`name`, `dps`, issu de la règle `Tuya` du pilote).

Le serveur asynchrone ne traite que `GET` : les commandes passent dans l'adresse. Une
requête `GET` sans en-tête personnalisé n'entraîne pas de requête préalable `OPTIONS`.

## Format de l'extension

- Une `.tapp` est un zip **sans compression**, comme les extensions officielles
  (`https://ota.tasmota.com/extensions/tapp/`).
- `manifest.json` contient `name`, `version` (format Tasmota, `0x00000100` pour 0.0.1),
  `description`, `author`, `min_tasmota`.
- Au démarrage, Tasmota charge les `.tapp` de `/.extensions/`, puis celles de `/`
  (`embedded/tapp.be`). Un fichier interne se lit avec `open(tasmota.wd + "fichier")`.

### Catalogue de l'Extension Manager

L'Extension Manager construit l'adresse de son catalogue à partir de l'hôte de `OtaUrl` :
`<schéma>//<hôte>/extensions/extensions.jsonl`. Si ce fichier n'existe pas, il revient au
catalogue officiel (`embedded/extension_manager.be`, `load_manifest()`).

Avec l'`OtaUrl` actuel du firmware (`github.com`), c'est le catalogue officiel qui
s'affiche. Trois voies :

1. Soumettre TasmoFlow au catalogue officiel de Tasmota.
2. Publier un catalogue sur `https://gnatali.github.io/extensions/` (dépôt `extensions`
   avec GitHub Pages) et faire pointer `OtaUrl` vers le même hôte, par exemple un firmware
   publié sur `gnatali.github.io`. C'est un réglage, pas une recompilation.
3. Installer la `.tapp` à la main avec le gestionnaire de fichiers de Tasmota, ce que fait
   le prototype.

## API Zigbee en Berry

| Besoin | API |
| --- | --- |
| Liste des appareils | `for d: zigbee` ; `zigbee.find(adresse ou nom)` |
| Champs d'un appareil | `shortaddr`, `longaddr`, `name`, `model`, `manufacturer`, `lqi`, `battery`, `battery_lastseen`, `lastseen`, `reachable`, `router`, `hidden` ; `d.info()` pour les derniers attributs |
| Événements | `zigbee.add_handler(objet)` ; méthodes `frame_received`, `attributes_raw`, `attributes_refined`, `attributes_final` |
| Réseau | `zigbee.info()` : canal, PAN ID, adresses du coordinateur |
| Commandes | `tasmota.cmd("ZbSend ...")`, `ZbBind`, `ZbPermitJoin`, `ZbName`… |

TasmoFlow écoute `attributes_final`, appelé une fois par message décodé
(`xdrv_23_zigbee_2a_devices_impl.ino`).

## Appareils Tuya

Depuis le 9 novembre 2026, le firmware `tasmota32-zbgw03-matter` intègre un pilote Tuya
local ([guide du pilote](https://github.com/gnatali/tasmota32-zbgw03-matter/blob/main/docs/tuya-local.fr.md),
[exemples](https://github.com/gnatali/tasmota32-zbgw03-matter/blob/main/docs/tuya-local-examples.fr.md)).
TasmoFlow passe toujours par ce pilote : il ne réimplémente pas le protocole Tuya et ne
manipule jamais de clé locale.

### Trois familles d'appareils dans une même liste

| Famille | État | Commande | Événements |
| --- | --- | --- | --- |
| Zigbee appairé à la ZB-GW03 | API Berry `zigbee` | `ZbSend` | `attributes_final` |
| Tuya Zigbee appairé à la ZB-GW03 (TS0601, cluster EF00) | API Berry `zigbee` ; DP traduits par un plugin `.zb` | `ZbSend` (écriture des DP à vérifier) | `attributes_final` |
| Tuya Wi-Fi (protocoles 3.3, 3.4, 3.5) | `TuyaStatus` | `TuyaSend` | règle `Tuya` |
| Sous-appareil Zigbee d'une passerelle Tuya | `TuyaStatus` | `TuyaSend` | règle `Tuya` |

### API du pilote utilisée par TasmoFlow

| Besoin | Commande ou événement | Réponse |
| --- | --- | --- |
| État du pilote | `TuyaEnable` | `{"TuyaEnable":{"Enabled":true,"State":"running"}}` (`State` : `running`, `disabled`, `waiting for Zigbee`…) |
| État des appareils | `TuyaStatus [appareil]` | `Connected`, `Ip`, `Version`, `Dps` (DP gardés en mémoire seulement) |
| Configuration sans les clés | `TuyaConfig [appareil]` | entrées de `tuya.json`, clé remplacée par `***` |
| Commande | `TuyaSend <appareil>,<dp ou code>,<valeur\|toggle>` | `{"TuyaSend":"Done"}` ou l'erreur (`Device not connected`…) |
| Activer, désactiver | `TuyaActive <nom>[,<nom>…],<0\|1>` | appareils, sous-appareils ou liaisons Matter |
| Ajouter, modifier, supprimer | `TuyaAdd <json>` (`"key":"***"` garde la clé), `TuyaDel`, `TuyaReload` | |
| Découverte, import | `TuyaScan [s]`, `TuyaImport [fichier] [all\|ids]`, `TuyaCloud` (identifiants enregistrés) | résultat publié à la fin : `{"TuyaScan":{...}}`, `{"TuyaCloud":{...}}` |
| Matter | `TuyaMatter [noms]` | points de terminaison créés, `Restart 1` nécessaire |
| Changement d'état | `tasmota.add_rule("Tuya", ...)` | `{"Tuya":{"Name":"Ventilateur","Dps":{"62":3}}}` |
| Mesures | télémétrie `SENSOR` | `{"Tuya":{"Pince":{"Puissance":592,...}}}` |

La règle Tasmota `Tuya#Dps#<dp>` ne voit pas le nom de l'appareil : TasmoFlow filtre en Berry,
comme le recommande la documentation du pilote.

### Sens des DP

Le pilote ne garde que les DP utilisés : ceux des liaisons Matter (`relay`, `relay_power`,
`light0` à `light3`, `fan`, `temp`, `humidity`), des `sensors`, les DP booléens et ceux de
`keep`. Les liaisons Matter donnent leur sens : TasmoFlow en déduit les commandes à afficher
(interrupteur, variateur, température de blanc, couleur, vitesse). Sans liaison, il propose la
bascule des DP booléens. La table `codes` (appareils importés) reste dans `tuya.json` : la lire
passe par `TuyaConfig`, qui charge tout le fichier.

### Tuya Zigbee appairé à la ZB-GW03

Les appareils Tuya TS0601 envoient leurs DP dans le cluster `EF00`. Sans plugin, Tasmota les
affiche bruts (`EF00/0401`). Un plugin `.zb` du système de fichiers les traduit en attributs
standard ; Tasmota en fournit une dizaine (`tasmota/zigbee/` de son dépôt) :

```
#Z2Tv1
:TS0601,_TZE200_3towulqd
EF00/0401=0406/0000   # Occupancy
EF00/020C=0400/0000   # Illuminance
EF00/0204=0001/0021,mul:2
```

TasmoFlow (v0.3) signalera les DP bruts, proposera un plugin de la bibliothèque de Tasmota ou en
créera un avec un éditeur de correspondance, puis le chargera (`ZbLoad`).

### Dans l'interface (v0.1)

`loadTuya()` s'exécute après les appareils Zigbee, une commande à la fois (chacune charge des
données du pilote) :

1. `TuyaEnable` : pas de clé `TuyaEnable` dans la réponse (`{"Command":"Unknown"}`) = pas de
   pilote ; `Enabled: false` = désactivé ; un `State` autre que `running` s'affiche comme une
   attente. Dans les deux premiers cas, **aucun écran Tuya n'est affiché**.
2. `TuyaStatus` : chaque appareil et sous-appareil (nom, `Connected`, `Ip`, `Version`, `Dps`).
3. `/api/status`, puis `TuyaConfig` **seulement si au moins 32 Ko sont libres** (le pilote
   refuse sous 30 Ko, et `TuyaConfig` charge tout `tuya.json`). Sinon les cartes retombent sur
   des bascules pour les DP booléens et le disent.

Les changements arrivent par le flux d'événements : l'extension ajoute une règle Berry
`tasmota.add_rule("Tuya", fermeture, 'tasmoflow')` tant que son serveur tourne (une fermeture,
car `check_not_method` refuse les méthodes ; l'identifiant permet à `remove_rule` de ne retirer
que la règle de TasmoFlow ; `tasmota_class.be`). Sa valeur est la table `{"Name","Dps"}` elle-même.

Les contrôles viennent des liaisons Matter de `tuya.json` (`controlsFor` dans
`app/src/tuya_model.js`) :

| `type` de la liaison | Contrôles |
| --- | --- |
| `relay`, `relay_power` | interrupteur sur `dp` (1 par défaut) ; `relay_power` : mesures de puissance, tension, courant (`dp_power`, `div_power`...) |
| `light0` à `light3` | interrupteur sur `dp` (20 par défaut) ; `light1`+ : variateur sur `dp_bri` (22, de `bri_min` 10 à `bri_max` 1000, affiché 0-100 %) ; `light2` : température de couleur sur `dp_ct` (23, 0-1000) |
| `fan` | interrupteur sur `dp` (60) et vitesse sur `dp_speed` (62, de `speed_min` 1 à `speed_max` 6) |
| `temp`, `humidity` | mesure sur `dp`, divisée par `div` (10) |
| `sensors` (appareil) | une mesure par libellé : `[dp, diviseur, unité]` |
| aucune | `toggle` sur chaque DP booléen |

`TuyaSend <appareil>,<dp>,toggle` inverse un interrupteur ; les curseurs envoient la valeur
brute. L'état affiché est celui que l'appareil renvoie (pas d'affichage optimiste). La couleur
des `light3` n'est pas encore proposée. Un nom d'appareil qui contient une virgule ne peut pas
être adressé par `TuyaSend`.

### Mémoire

Le pilote attend **45 Ko libres** pour démarrer, et exige **30 Ko** pour modifier `tuya.json`,
**35 Ko** pour l'import cloud. TasmoFlow vérifie la mémoire libre (`tasmota.memory()`) avant ces
actions. Mesuré sur une passerelle qui fait tourner le pilote et TasmoFlow, chaque fois après
`tasmota.gc()` (`Heap` et `HeapUsed` de Berry dans `Status 4`, 9 novembre 2026) :

| Moment | Mémoire libre | `HeapUsed` de Berry | Coût de TasmoFlow |
| --- | --- | --- | --- |
| Avant installation | 84 Ko | 25 Ko | |
| Extension chargée | 67 Ko | 47 Ko | 17 Ko |
| Interface ouverte | 65 Ko | 48 Ko | 19 Ko |

Les premières mesures du 6 novembre, sans `tasmota.gc()` (90,4, 66,1 puis 60,6 Ko), comptaient
des déchets que Berry n'avait pas encore libérés. TasmoFlow dépassait de 2 à 4 Ko sa cible de
15 Ko. La v0.1 ne démarre le serveur du port 8384 que pendant qu'une interface est ouverte,
compile `tf_http.be` à ce moment, n'enregistre les événements que pendant qu'il tourne, et
retire le code inutilisé de `tf_http.be` (encodage par blocs, deux fonctions utilitaires). **Pas
encore mesuré** : refaire le tableau ci-dessus après `tasmota.gc()`, extension chargée, puis
interface ouverte, puis 5 minutes après sa fermeture.

### Ce que TasmoFlow ne fait pas

- Afficher, stocker ou transmettre une clé locale ou les identifiants du cloud Tuya : leur
  saisie reste sur la page du pilote (`/tuya`).
- Fonctionner sans le pilote : sur un Tasmota sans pilote Tuya, ou pilote désactivé
  (`TuyaEnable 0`), les écrans Tuya sont masqués.

## Règles

TasmoFlow gère toutes les règles de la passerelle (décision du 9 novembre 2026) : les jeux de
règles Tasmota, les règles Berry et ses propres actions. Constats tirés du code de Tasmota au
commit `a281cece` du firmware (`tasmota/include/tasmota.h`, `xdrv_10_rules.ino`,
`embedded/tasmota_class.be`) :

| Élément | Limite | Commandes |
| --- | --- | --- |
| Jeux de règles Tasmota | 3 (`Rule1` à `Rule3`), 512 caractères chacun ; au-delà, compression Unishox jusqu'à 2 Ko environ | `Rule<n> <texte>`, `Rule<n> +<texte>` (ajout), `Rule<n> ""` (effacer) ; `0`/`1`/`2` arrêt, marche, bascule ; `4`/`5`/`6` option « une fois » ; `8`/`9`/`10` option « arrêt sur erreur » |
| Variables | `Var1` à `Var16` (perdues au redémarrage), `Mem1` à `Mem16` (gardées) | `Var<n>`, `Mem<n>` |
| Minuteries | `RuleTimer1` à `RuleTimer8` | `RuleTimer<n> <s>` |
| Règles Berry | sans limite ; `tasmota._rules` liste chaque déclencheur (`trig.rule`) et son identifiant | `tasmota.add_rule`, `tasmota.remove_rule` |

Plan :

- **Lecture.** Les trois jeux de règles (texte, état, options), les déclencheurs Berry chargés
  et `autoexec.be`. Un `on … do … endon` dont la syntaxe est reconnue s'affiche en phrase ; les
  autres restent en texte.
- **Écriture.** Toute modification passe par une copie de l'ancienne version sur la passerelle
  (restauration en un clic), un contrôle de syntaxe (règle Tasmota) ou une compilation (Berry)
  avant l'enregistrement, et l'affichage de la place restante dans le jeu de règles.
- **Moteur au choix.** Une action TasmoFlow devient une règle Tasmota (indépendante de Berry,
  place limitée) ou du Berry (sans limite, conditions et minuteries avancées).
- **Conflits.** Deux règles qui agissent sur le même appareil sont signalées : par exemple une
  règle Tasmota et une automatisation Google Home qui basculent la même lampe s'annulent.
- **Protection anti-plantage.** Après plusieurs plantages rapides, Tasmota démarre sans Berry
  et désactive toutes les règles : TasmoFlow le signale et propose de les réactiver.

## Plan de test sur la passerelle

Résultats des 6 et 9 novembre 2026 (passerelle avec le pilote Tuya). `[x]` validé, `[ ]` à faire. La v0.0 est terminée ; les points ouverts ci-dessous relèvent de la v0.1.

- [x] Copier `TasmoFlow.tapp` dans `/.extensions/` (ou `/`) et redémarrer : le journal affiche `TFL: TasmoFlow 0.0.1, API on port 8384` (`API sur le port 8384` dans la version testée le 6 novembre)
- [x] Installer à chaud (`tasmota.load("/.extensions/TasmoFlow.tapp")` dans la console Berry) : le bouton et `/tf` répondent sans redémarrage
- [x] Le bouton « TasmoFlow » apparaît dans le menu principal
- [x] Avec `WebPassword` défini, dans une fenêtre de navigation privée (sinon le navigateur renvoie le mot de passe déjà saisi pour Tasmota), `/tf` demande le mot de passe ; `curl -i "http://<passerelle>/tf?r=1"` répond `401 Unauthorized`
- [x] `http://<passerelle>/tf` tapé dans la barre d'adresse (sans passer par le bouton) ouvre l'interface
- [x] Sans accès Internet, `/tf` charge la copie locale (onglet Diagnostic : « local »)
- [x] `open(tasmota.wd + "app.js.gz", "rb")` lit bien le fichier dans la `.tapp`, et le navigateur décompresse la copie locale
- [x] La liste des appareils correspond à `ZbStatus1`
- [x] Un appui sur un bouton Zigbee apparaît dans l'onglet Événements en moins de 2 s
- [x] « Basculer » allume et éteint une lampe ; « Appairer » ouvre l'appairage 60 s
- [x] Mémoire, chaque fois après `tasmota.gc()` dans la console Berry : 84 Ko libres avant installation, 67 Ko avec l'extension chargée, 65 Ko avec l'interface ouverte, soit 17 puis 19 Ko (cible : 15 Ko, voir [Mémoire](#mémoire))
- [x] Deux onglets ouverts plus un troisième : la passerelle reste stable (3 onglets Chrome et 1 Android)
- [ ] Une interface ouverte sur la passerelle A lit `/api/status` de la passerelle B (jeton de B, écran Passerelles) ; avec le serveur d'API de B arrêté, l'écran le réveille par `/tf?w=1`
- [x] GitHub Pages activé (tag `v0.0.1`), `/tf` charge la copie GitHub (en-tête : « v0.0.1 · github »)
- [x] Chrome, Firefox, Safari sur iPhone : l'interface se charge et le flux d'événements reste ouvert
- [x] Matter continue de fonctionner (Google Home commande toujours ses appareils)
- [x] Le pilote Tuya démarre toujours au boot avec TasmoFlow installé (`TuyaEnable` : `"State":"running"`)
- [ ] v0.1 : après un redémarrage, le port 8384 ne répond pas tant que `/tf` n'est pas ouverte ; le journal affiche `TFL: API server started on port 8384`, puis `TFL: API server stopped` 5 minutes après la fermeture du dernier onglet, et `/tf` le redémarre (le port peut être de nouveau écouté)
- [ ] v0.1 : `curl "http://<passerelle>/tf?w=1"` répond `ok` sans mot de passe et démarre le serveur
- [ ] v0.1 : les cartes Tuya correspondent à `TuyaStatus` ; un interrupteur, un variateur et une vitesse de ventilateur agissent sur les vrais appareils ; un changement fait sur un appareil (bouton, Smart Life) arrive dans l'interface en moins de 2 s
- [ ] v0.1 : avec le pilote Tuya désactivé (`TuyaEnable 0`) ou absent, la section Tuya est masquée
- [ ] v0.1 : mémoire après `tasmota.gc()` (cible : 15 Ko, voir [Mémoire](#mémoire)) ; `TuyaConfig` via l'interface ne fait pas refuser le pilote (seuil de 32 Ko)
