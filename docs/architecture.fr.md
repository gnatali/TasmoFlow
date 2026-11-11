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
| 8384 | `tf_http.be`, serveur asynchrone Berry | API JSON, flux d'événements, interface légère ; en-têtes CORS et `Content-Encoding` ; [seulement pendant qu'une interface est ouverte](#serveur-dapi-à-la-demande) |

La page `/tf` transmet à l'interface l'adresse de l'API et un jeton de 128 bits, créé au
premier démarrage et gardé dans `persist`. Toutes les routes `/api/*` exigent ce jeton
(paramètre `t`) ; seule `/lite.js` est publique.

### Serveur d'API à la demande

La RAM est la ressource critique : le serveur du port 8384 (`tf_http.be`) n'est pas démarré au
boot (v0.1) :

- `/tf`, une fois le mot de passe vérifié, le démarre. `tf_http.be` est compilé à ce moment
  (`load_module()`, `introspect.module('tf_http', true)` : chargé **sans cache**, donc
  `tasmota.gc()` le libère quand le serveur s'arrête) : aucune RAM n'est dépensée tant
  qu'aucune interface n'est ouverte. Un simple `import` mettrait le module en cache pour
  toujours, et échoue de toute façon à l'exécution : Tasmota ne garde le dossier de la `.tapp`
  dans `sys.path` que pendant le chargement de l'extension, `load_module()` le remet donc
  autour de l'appel. `tf_rules.be` (API des règles, v0.2) est chargé de la même façon, avec le
  serveur, et libéré avec lui.
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
- **Interface légère compressée** : servie avec `Content-Encoding: gzip`, le navigateur la
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
   `http://<passerelle>:8384/lite.js`, l'**interface légère** contenue, en gzip, dans la
   `.tapp`. Un bandeau le signale et propose de réessayer.
4. Si les deux échouent, la page l'affiche.

Le script se protège d'un double démarrage : la copie GitHub peut arriver après le délai,
quand l'interface légère tourne déjà.

### Version de test

Le `workflow_dispatch` de `build.yml` (job `preview`) publie `dev/app.js` et `dev/TasmoFlow.tapp`
sur GitHub Pages (`tools/publish_pages.sh`, branche `gh-pages`, verrou partagé avec le job de
release). `pack_tapp.py --dev` donne à cette `.tapp` `DIR = "dev"` et un `SRI` vide : la page
`/tf` ajoute `?t=<millis>` à l'adresse (jamais en cache) et aucun `integrity`. La version s'écrit
`X.Y.Z-dev.<commit>` et l'en-tête de l'interface affiche son propre build (`TF_BUILD`, `define`
d'esbuild). Volontairement non épinglée : pour les essais seulement, la `.tapp` des releases reste
épinglée (voir « Pas de version libre » plus bas). Réinstaller la `.tapp` n'est utile que si `extension/` ou
l'interface légère ont changé.

### Interface complète

Décision du 9 novembre 2026 (option B de l'analyse ; elle remplace « la même copie complète aux
deux endroits » de la v0.0) :

| | Interface complète (`dist/app.js`) | Interface légère (`dist/lite.js`) |
| --- | --- | --- |
| Où | GitHub Pages seulement, `vX.Y.Z/`, figée par la `.tapp` avec son empreinte SRI | Dans la `.tapp` sous le nom `lite.js.gz`, servie sur le port 8384 |
| Utilisée | Normalement | Quand le navigateur ne joint pas GitHub (pas d'internet, GitHub en panne, empreinte fausse) |
| Contenu | Tout : appareils, événements, console, Passerelles, puis règles, éditeur en phrases, scènes, administration | Appareils (Zigbee et Tuya, interrupteurs, curseurs, appairage), console, diagnostic, français et anglais |
| Source | `app/src/main.js` | `app/src/main_lite.js` : même code, moins d'onglets (`boot.js`) |
| Budget (gzip) | 120 Ko | 25 Ko |

Interface légère, depuis la v0.2 : activer ou désactiver une règle et restaurer la copie
précédente d'une règle, pour que les règles restent gérables sans GitHub. Jamais dans
l'interface légère : éditeur de phrases, groupes, scènes, plugins Zigbee, administration (OTA),
plusieurs passerelles.

Pourquoi :

- C'est le **navigateur**, pas la passerelle, qui a besoin d'internet pour charger l'interface
  complète. Les règles et automatisations tournent sur la passerelle : sans internet rien ne
  s'arrête, seule l'édition est indisponible. Les pages de Tasmota restent le dernier recours
  (liste Zigbee, console, `/tuya`, Matter).
- **Système de fichiers** : `UfsFree` valait 148 Ko sur 320 Ko (9 novembre 2026), et l'interface
  complète va grossir (éditeur de règles et de phrases, scènes, administration). Une copie
  complète locale mangerait la place dont ont besoin les copies de règles (avant chaque
  écriture), `tuya.json.bak` et les imports.
- **Pas de version libre** : l'interface complète reste figée à la version installée avec son
  empreinte SRI. Une interface non figée exécuterait ce que GitHub sert, dans un navigateur qui
  détient le jeton et le contrôle total de Tasmota. La mettre à jour demande toujours une
  nouvelle `.tapp`. Un bouton « mettre à jour l'interface » pourrait plus tard écrire la
  nouvelle version et son empreinte dans `persist` après accord de l'utilisateur : il
  découplerait les deux en gardant SRI (l'interface complète devrait alors rester compatible
  avec les anciennes API).
- **Gardé en local, léger** : GitHub (compte, Pages, dépôt) ne doit pas être un point de
  défaillance unique pour piloter la passerelle.
- L'interface légère est un autre point d'entrée des mêmes sources : pas de seconde base de
  code, même client d'API, même modèle Tuya, mêmes textes. Aujourd'hui elle n'est que 1 Ko plus
  petite (13,7 contre 14,9 Ko gzip) ; l'écart grandira avec l'interface complète.
- L'interface complète ne peut pas passer sur `https://gnatali.github.io` pour gérer les
  passerelles depuis un seul endroit : une page HTTPS qui appelle `http://<passerelle>` est
  bloquée (contenu mixte, Private Network Access). Elle doit rester chargée par la page HTTP de
  la passerelle.
- Qui ne veut aucun GitHub (`pack_tapp.py --cdn ''`) n'a que l'interface légère.

## API du port 8384

| Route | Réponse |
| --- | --- |
| `GET /lite.js` | Interface légère (gzip), envoyée par blocs de 1 Ko |
| `GET /api/status?t=` | Versions, mémoire libre, système de fichiers, état de Zigbee, nombre d'appareils |
| `GET /api/devices?t=` | Appareils Zigbee : adresse, nom, modèle, fabricant, LQI, batterie, dernier message, derniers attributs |
| `POST /api/cmd?t=` | Exécute la commande Tasmota du corps et renvoie sa réponse JSON (`GET /api/cmd?t=&c=` marche encore pour une commande courte) |
| `GET /api/rules?t=` | Les trois jeux de règles Tasmota (état, options, texte, place libre, copie précédente) et les règles Berry (`tf_rules.be`) |
| `POST /api/rule_set?t=&n=` | Envoie le nouveau texte du jeu `n` (corps de la requête) |
| `GET /api/rule_apply?t=&n=&step=` | L'applique en trois requêtes : `bak` (copie du texte actuel), `put` (`Rule<n>`), `check` (relecture) ; en cas d'échec l'interface appelle `rule_restore` |
| `GET /api/rule_restore?t=&n=` | Remet la copie précédente du jeu `n` |
| `GET /api/events?t=&since=` | Flux SSE ; renvoie d'abord les événements gardés après `since` (50 au plus) |

Les événements portent un numéro de séquence et un `type` : `zigbee` (`device`, `name`,
`attrs`) et `tuya` (`name`, `dps`, issu de la règle `Tuya` du pilote).

Le serveur asynchrone traite `GET` et `POST` (un corps de 3 000 octets au plus, lu d'après
`Content-Length` et remis une fois complet). Ni un `GET` sans en-tête personnalisé ni un `POST`
en `text/plain` n'entraînent de requête préalable `OPTIONS`. Une requête qu'il ne traitera pas
reçoit une erreur au format de l'API, puis la connexion est fermée : ligne de requête de plus de
512 caractères `414 {"error":"uri_too_long"}`, ligne de requête invalide `400 bad_request`,
en-têtes de plus de 4 Ko `431 headers_too_long`, corps de plus de 3 000 octets
`413 body_too_long`. La connexion n'est pas fermée aussitôt après une telle réponse : le reste de
la requête est lu et jeté jusqu'à ce que l'émetteur se soit tu 200 ms (2 s au plus). Fermer une
prise qui contient des données non lues fait envoyer une réinitialisation par lwIP, et le
navigateur affichait alors `ERR_CONNECTION_RESET` au lieu du 414 (constaté sur la passerelle le 11
novembre 2026 avec une URL de 900 caractères ; la ligne de journal `TFL: port 8384 request refused
(414 uri_too_long)` était là, sans redémarrage). Correctif pas encore vérifié sur la passerelle.

### Lecture des requêtes sans expressions régulières

Jusqu'au 10 novembre 2026, `tf_http.be` lisait la ligne de requête avec l'expression régulière
de Tasmota `^(\w+) (\S+) HTTP\/(\d\.\d)\r\n`, et une ligne de requête de 152 caractères ou plus
faisait redémarrer la passerelle (`Software reset CPU`, comme après une panique ; 112 passaient).
Cause, lue dans le source de Tasmota du firmware (commit `TASMOTA_REF`) :

- `re.match2()` exécute le motif avec `re1_5_recursiveloopprog()`
  (`lib/libesp32/berry/default/be_re_lib.c`), sans limite de profondeur : `re1_5_stack_chk()`
  est une macro vide (`lib/libesp32/re1.5/re1.5.h`).
- Un `e+` gourmand se compile en `L: e; RSplit L` (`lib/libesp32/re1.5/compilecode.c`) et
  `recursiveloop()` s'appelle elle-même à chaque `RSplit` (`lib/libesp32/re1.5/recursiveloop.c`) :
  `(\S+)` prend **un cadre de pile C par caractère de l'URI**.
- Le serveur du port 8384 tourne dans la tâche de boucle de Tasmota (`fast_loop`), dont la pile
  fait **8 Ko** (`SET_ESP32_STACK_SIZE` dans `tasmota/my_user_config.h`,
  `getArduinoLoopTaskStackSize()` dans `tasmota/tasmota_support/support_esp32.ino`), déjà en
  partie occupée par la boucle, la VM Berry et le rappel : une URI de 99 caractères passait, une de
  139 la débordait.
- Le `(.*?)` paresseux des valeurs d'en-têtes essaie la fin de ligne avant chaque caractère et
  reste à la même profondeur : c'est pourquoi de longs `User-Agent` ou `Referer` n'ont jamais
  planté. Un **nom** d'en-tête long (`[A-Za-z0-9-]+`) aurait planté de la même façon.

Depuis, la ligne de requête et les en-têtes sont lus avec `string.find()` (`strstr()`, sans
récursion : `lib/libesp32/berry/src/be_strlib.c`) et des tranches ; `tcpclientasync.read()`
renvoie une chaîne (`tasmota/tasmota_xdrv_driver/xdrv_52_3_berry_tcpclientasync.ino`). TasmoFlow
ne charge plus le module `re`. `tests/tf_http_test.be` exécute l'analyseur de `tf_http.be` sur le
Berry standard dans la CI (en mode strict, comme Tasmota compile) : requêtes d'un bloc et octet par
octet, lignes de requête de 112 à 900 caractères, corps POST, lignes et en-têtes invalides. La pile
d'un PC est bien plus grande : ce test ne peut pas montrer le plantage lui-même, cette
vérification se fait sur la passerelle (plan de test).

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
retire le code inutilisé de `tf_http.be` (encodage par blocs, deux fonctions utilitaires). Mesuré
le 9 novembre 2026 après `tasmota.gc()`, sur la même base de 84 Ko / 25 Ko :

| Moment | Mémoire libre | `HeapUsed` de Berry | Coût de TasmoFlow |
| --- | --- | --- | --- |
| v0.1, extension chargée (serveur d'API non démarré) | 75 Ko | 35 Ko | **9 Ko** |
| v0.1, interface ouverte (`import` en cache) | 63 Ko | 48 Ko | 21 Ko |
| v0.1, interface ouverte (chargement sans cache) | 59 Ko | 48 Ko | 25 Ko |
| v0.1, 5 minutes après sa fermeture (`TFL: API server stopped`) | 69 Ko | 39 Ko | **15 Ko** |

Au repos, la cible de 15 Ko est tenue (17 Ko avant). Avec une interface ouverte, le coût dépasse
de 2 à 6 Ko celui de la v0.0 : `tf_http.be` compilé (environ 12 Ko) plus le serveur ; la mémoire
libre dépend aussi des connexions ouvertes à ce moment. Le chargement sans cache fonctionne :
après l'arrêt du serveur, 10 Ko des 16 Ko ajoutés reviennent (Berry : 9 sur 13 Ko). **Environ 6 Ko
(Berry : 4 Ko) restent alloués** par rapport à l'état d'avant la première ouverture ; la cause
n'est pas encore identifiée (voir `docs/tracking.fr.md`). Après la première utilisation, le coût
est de 15 Ko, pile sur la cible. `UfsFree` valait 148 Ko sur 320 Ko sur la même passerelle.

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

Plan (v0.2 étape 1, **écrite**, à vérifier sur la passerelle : l'écran **Règles**, `extension/tf_rules.be`,
`app/src/rules.js`, `rules_lint.js` ; l'éditeur en phrases et les automatisations viennent ensuite) :

- **Lecture.** Les trois jeux de règles (texte, état, options), les déclencheurs Berry chargés
  et `autoexec.be` (seuls les deux premiers pour l'instant ; la règle Tuya `tasmoflow` de
  TasmoFlow n'est pas affichée). Un `on … do … endon` dont la syntaxe est reconnue s'affiche en phrase ; les
  autres restent en texte.
- **Écriture.** Toute modification passe par une copie de l'ancienne version sur la passerelle
  (restauration en un clic), un contrôle de syntaxe (règle Tasmota) ou une compilation (Berry)
  avant l'enregistrement, et l'affichage de la place restante dans le jeu de règles. Réalisé : la
  passerelle copie le texte actuel dans `/tf_rule<n>.bak` (une copie précédente par jeu de
  règles), écrit `Rule<n> <texte>`, relit le jeu et remet l'ancien texte s'il diffère. Le nouveau texte voyage dans un **corps de requête POST** (`/api/rule_set`, `Content-Length`, 3 000 octets au plus ; `tf_http.be` le remet une fois complet). L'écriture est découpée en requêtes séparées (`rule_set`, puis `bak`, `put`, `check`) pour nommer l'étape qui échoue. **Les données longues vont dans un corps POST, jamais dans une URL** : le 9 novembre 2026, une ligne de requête de 152 caractères ou plus a fait redémarrer la passerelle (`RestartReason` « Software reset CPU », `ERR_CONNECTION_RESET`), 112 caractères passaient ; une requête `/api/rule_set` avec un texte de 67 caractères suffisait, alors que les mêmes commandes tapées dans la console fonctionnaient. La cause, trouvée le 10 novembre, était l'expression régulière qui lisait la ligne de requête dans `tf_http.be` (`\S+`, un cadre de pile par caractère), remplacée depuis par un traitement de chaînes simple (voir [Lecture des requêtes sans expressions régulières](#lecture-des-requêtes-sans-expressions-régulières)) ; une ligne de requête est limitée à 512 caractères. `/api/cmd` prend aussi sa commande dans un corps POST, que l'interface utilise toujours. Une restauration échange les deux textes : elle s'annule. **Aucun saut de ligne ne part vers
  la passerelle** (par prudence : les premiers échecs ont été attribués aux sauts de ligne, mais l'URL trop longue était la cause ; un texte avec sauts de ligne n'a jamais été essayé en POST, et la réponse de Tasmota à `Rule<n>` peut alors être du JSON invalide, que `tf_rules.rule()` sait lire). Un jeu de règles est stocké sur une ligne et affiché avec un
  bloc `on … endon` par ligne (`showRule()`, `flatRule()`).
  L'interface vérifie `on <déclencheur> do … endon` (à titre indicatif, `rules_lint.js`) ; le
  moteur de règles de Tasmota n'a pas de commande de contrôle de syntaxe. Le contrôle par
  compilation Berry viendra avec l'édition du Berry.
- **Éditeur en phrases** (v0.2 étape 2, écrit ; la vue **Phrases** d'un jeu de règles, interface
  complète seulement : `rules_model.js`, `rules_editor.js`, enregistré par `main.js` pour que
  l'interface légère ne le contienne pas ; rien ne change sur la passerelle). Un bloc
  `on <déclencheur> [if (<condition>)] do <commandes> [else <commandes>] endon` se lit
  *Quand* `Sujet#Clé` *op valeur*, *Si* `condition`, *Alors* commandes, *Sinon* commandes ;
  `Backlog a; b` est une liste de commandes. Tout le reste reste un **bloc brut** affiché en
  texte (plusieurs déclencheurs avec `and`/`or`, `elseif`, `if` imbriqués, opérateur sans
  valeur, corps vide), et un jeu de règles qui n'est pas une suite de blocs ne s'ouvre qu'en
  vue Texte. Ouvrir un jeu de règles ne le réécrit jamais : un bloc n'est réécrit qu'une fois
  modifié (`src` conservé). Déclencheurs et commandes sont du texte libre avec des suggestions.
  `tests/rules_model_test.js` (CI) vérifie la lecture, l'écriture de chaque forme et l'absence de
  réécriture. Pas encore : sélecteurs d'appareils (Zigbee, Tuya, Matter), noms lisibles des
  déclencheurs et des commandes, `elseif`, plusieurs déclencheurs, déplacement d'un bloc.
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
- [x] Sans accès Internet, `/tf` charge la copie locale (onglet Diagnostic : « local ») ; depuis la v0.1 cette copie est l'interface légère (bandeau, en-tête « · lite »), à revérifier
- [x] `open(tasmota.wd + "app.js.gz", "rb")` lit bien le fichier dans la `.tapp`, et le navigateur décompresse la copie locale (`lite.js.gz` depuis la v0.1)
- [ ] v0.1 : navigateur hors ligne (ou `gnatali.github.io` bloqué), `/tf` affiche l'interface légère : les appareils avec leurs bascules, la console et le diagnostic fonctionnent, les onglets Passerelles et Événements sont absents, « Réessayer » charge l'interface complète dès que GitHub répond
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
- [x] v0.1 : après un redémarrage, le port 8384 ne répond pas tant que `/tf` n'est pas ouverte ; le journal affiche `TFL: API server started on port 8384`, puis `TFL: API server stopped` 5 minutes après la fermeture du dernier onglet, et `/tf` le redémarre (le port peut être de nouveau écouté)
- [ ] v0.1 : `curl "http://<passerelle>/tf?w=1"` répond `ok` sans mot de passe et démarre le serveur
- [ ] v0.1 : les cartes Tuya correspondent à `TuyaStatus` ; un interrupteur, un variateur et une vitesse de ventilateur agissent sur les vrais appareils ; un changement fait sur un appareil (bouton, Smart Life) arrive dans l'interface en moins de 2 s
- [ ] v0.1 : avec le pilote Tuya désactivé (`TuyaEnable 0`) ou absent, la section Tuya est masquée
- [x] v0.1 : mémoire au repos après `tasmota.gc()` : 75 Ko libres, Berry 35 Ko, soit 9 Ko (cible : 15 Ko) ; interface ouverte 63 Ko / 48 Ko (`import` en cache, voir [Mémoire](#mémoire))
- [x] v0.1 : avec le chargement sans cache, la mémoire revient en partie 5 minutes après la fermeture du dernier onglet : 59 Ko libres / Berry 48 Ko interface ouverte, 69 Ko / 39 Ko après (75 Ko / 35 Ko avant la première ouverture)
- [ ] v0.2 : vue Phrases : un jeu de règles saisi en vue Texte s'affiche en phrases ; modifier la valeur d'un déclencheur, ajouter un `if` / `else` et une deuxième commande, ajouter et supprimer une règle, puis Enregistrer donne le texte attendu (`Rule<n>` dans la console) ; une règle qui n'entre dans aucune phrase reste en texte
- [x] v0.2 (10 novembre 2026) : écran Règles : les trois jeux affichent le texte de `Rule1` à `Rule3` ; enregistrer une règle de plus de 600 caractères (corps POST) se relit à l'identique quand elle est saisie sur plusieurs lignes (stockée sur une ligne, affichée un bloc par ligne ; sinon l'ancien texte est remis et une erreur s'affiche) ; « Copie précédente » puis « Restaurer » remet l'ancien texte
- [ ] v0.2 : l'activation/désactivation, « une seule fois » et « arrêt sur erreur » agissent sur le vrai jeu de règles ; la liste des règles Berry correspond à `Br print(tasmota._rules)`
- [ ] v0.2 : l'interface légère (GitHub bloqué) montre l'onglet Règles avec activation/désactivation et restauration, sans l'éditeur
- [x] v0.2 (11 novembre 2026) : mémoire avec l'API des règles chargée (`tf_rules.be` est compilé avec le serveur d'API), après `tasmota.gc()` : au repos 75-76 Ko libres / Berry 39 Ko (8 à 9 Ko), interface ouverte 52 Ko / 55 Ko (32 Ko), 5 minutes après la fermeture 70 Ko / 39 Ko (14 Ko, budget 15 Ko)
- [ ] v0.2 : URL longues (version de test avec l'analyseur à base de chaînes, `.tapp` réinstallé, `Restart 1`) : `http://<passerelle>:8384/api/status?t=<jeton>&p=<a répété 130 fois>`, puis 90 et 50, renvoient l'état ; des lignes de requête de 190 et 512 caractères répondent aussi ; une de 900 caractères renvoie `{"error":"uri_too_long"}` ; la passerelle ne redémarre jamais (`Status 1` : `RestartReason` inchangée, la durée de fonctionnement continue d'augmenter) ; l'interface marche toujours (appareils, console, écran Règles : enregistrer et restaurer)
- [ ] v0.1 : trouver ce qui reste alloué après la première ouverture (6 Ko de mémoire libre, 4 Ko de Berry), et vérifier que `TuyaConfig` via l'interface ne fait pas refuser le pilote (seuil de 32 Ko)
