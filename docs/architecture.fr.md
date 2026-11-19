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
(paramètre `t`) ; seule `/local.js` (la copie locale de l'interface) est publique.

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

1. Le navigateur ouvre `http://<passerelle>/tf`. La page indique si la passerelle a une **copie
   locale** de l'interface pour sa version (`copy` : 0 aucune, 1 celle de cette version, 2 celle
   d'une autre version).
2. Avec une copie de cette version, la page charge `http://<passerelle>:8384/local.js?v=<version>`
   (la copie, en gzip, à côté de la `.tapp` ; sans SRI : la passerelle a contrôlé son SHA-256 à
   l'enregistrement). La version dans l'adresse évite qu'un cache du navigateur lance la copie
   d'une autre version.
3. Sinon, ou si la copie ne se charge pas, elle charge
   `https://gnatali.github.io/TasmoFlow/vX.Y.Z/app.js` avec l'empreinte SRI calculée à
   l'assemblage. Une page HTTP peut charger un script HTTPS. Pas de délai : il ne reste rien
   d'autre à essayer.
4. Si cela échoue aussi (ni internet ni copie, ou empreinte fausse), la page le dit en une ligne.
   Les pages et la console de Tasmota fonctionnent toujours.

Le script se protège d'un double démarrage dans une même page.

### Version de test

Le `workflow_dispatch` de `build.yml` (job `preview`) publie `dev/app.js` et `dev/TasmoFlow.tapp`
sur GitHub Pages (`tools/publish_pages.sh`, branche `gh-pages`, verrou partagé avec le job de
release). `pack_tapp.py --dev` donne à cette `.tapp` `DIR = "dev"` et un `SRI` vide : la page
`/tf` ajoute `?t=<millis>` à l'adresse (jamais en cache) et aucun `integrity`. La version s'écrit
`X.Y.Z-dev.<commit>` et l'en-tête de l'interface affiche son propre build (`TF_BUILD`, `define`
d'esbuild). Volontairement non épinglée : pour les essais seulement, la `.tapp` des releases reste
épinglée (voir « Pas de version libre » plus bas). Réinstaller la `.tapp` n'est utile que si `extension/` a
changé. Une copie locale n'est acceptée que par la `.tapp` du même lancement (`APP_SHA`), et une
passerelle qui en a une continue de l'utiliser : la supprimer (Diagnostic) pour voir l'interface
d'un nouveau lancement.

### Mise à jour de la .tapp

Décision du 11 novembre 2026 : une mise à jour simple depuis l'interface, avec le **navigateur
comme relais**. Le client HTTPS de la passerelle (`webclient`, `xdrv_52_3_berry_webclient.ino` de
Tasmota, commit `a281cece`) réserve un tampon de réception de 16 Ko d'un seul tenant, accepte
n'importe quel certificat, et la mémoire libre est de 52 Ko interface ouverte (le pilote Tuya en
veut 45) ; la connexion HTTPS du navigateur est vérifiée et ne coûte rien à la passerelle.

1. **Publication.** Chaque tag publie sur GitHub Pages `latest.json` (`version`, `size`, `sha256`,
   `tapp`) et `vX.Y.Z/TasmoFlow.tapp` (`pack_tapp.py`) ; un build de test publie `dev/latest.json` à
   côté de `dev/TasmoFlow.tapp`. Une pièce jointe de release GitHub n'est pas lisible par le
   navigateur (pas de CORS, redirection), Pages l'est.
2. **Détection** (`app/src/update.js`, `initUpdate()`, depuis le 18 novembre 2026 ; le chargeur
   le faisait avant) : l'interface lit le manifeste de son canal (`cfg.upd`, sans cache) une fois
   démarrée. *Version publiée* : mise à jour si la version du manifeste est numériquement plus
   récente. *Build de test* (`X.Y.Z-dev.<commit>`) : mise à jour si le commit diffère (les commits
   ne sont pas ordonnés). Dans ce cas un bandeau au-dessus de chaque écran propose **Mettre à
   jour** (un clic : pas de confirmation, le bandeau dit que la passerelle redémarrera) et **Plus
   tard** (le masque pour cette visite). Il ne s'affiche que quand la passerelle de la page est
   affichée ; un manifeste illisible ne change rien.
3. **Place, puis transfert** (`app/src/update.js`) : d'abord
   `/api/update_check?size=` avec la taille annoncée par `latest.json` ; si elle ne tient pas, la page
   le dit avec les tailles (nécessaire, disponible, dont l'ancienne `.bak`) et ne télécharge rien.
   Puis téléchargement de la `.tapp` sur Pages, et morceaux de 1 500 octets en base64 (2 000
   caractères, sous `MAX_BODY`) vers `POST /api/update?off=&size=`.
4. **Installation** (`extension/tf_update.be`, compilé à la première requête `/api/update*`,
   libéré avec le serveur : la marge de 7 Ko d'une interface ouverte n'en permet pas plus) : écrit
   `<tapp>.new`, puis `/api/update_apply?size=&sha256=` contrôle la taille, l'en-tête zip et le
   SHA-256 (1 Ko à la fois), renomme `<tapp>` en `<tapp>.bak` et `<tapp>.new` en `<tapp>` (la copie
   est remise si cela échoue : `path.rename`, `path.remove`, `path.exists`,
   `be_path_tasmota_lib.c`), répond, et lance `Restart 1` 1,5 s plus tard. Les copies ne finissent
   jamais par `.tapp` : Tasmota charge tout `*.tapp` de `/` et de `/.extensions/`. Le gestionnaire
   d'extensions officiel (`extension_manager.be`) écrit sur le fichier vivant sans fichier temporaire
   ni contrôle ; ici non. **Place** (`room()`, depuis le 12 novembre 2026, d'après les tailles
   réelles) : pendant l'écriture du nouveau fichier la `.tapp` installée reste, puis un simple
   renommage en fait la `.bak` ; le nouveau fichier demande donc sa taille (celle de `latest.json`)
   plus 20 Ko d'espace libre (`UfsFree`). Un `.new` laissé par une mise à jour interrompue et
   l'ancienne `.bak` comptent comme disponibles : le `.new` est supprimé, la `.bak` seulement si
   l'espace libre seul ne suffit pas (la `.tapp` installée n'est jamais touchée). Le contrôle a lieu
   avant le téléchargement (`/api/update_check`) et de nouveau au premier morceau. Avant, il fallait
   la place de deux nouvelles copies plus 20 Ko, quel que soit le poids de l'ancienne `.tapp` et de
   la `.bak`.
5. **Attente** : la page interroge `/api/status` toutes les 2 s (en réveillant le serveur d'API par
   `/tf?w=1`) jusqu'à ce que `tasmoflow` soit la nouvelle version, puis recharge ; au bout de 120 s
   (`UPDATE_WAIT_MS`) elle dit que le redémarrage est long et renvoie à l'accueil de Tasmota.

Confiance : GitHub Pages, comme pour l'interface ; la passerelle contrôle l'intégrité (le SHA-256
du manifeste), pas l'authenticité. La première mise à jour vers une version qui a cette fonction
est manuelle.

### Copie locale de l'interface

Décision du 18 novembre 2026 (Guillaume), qui remplace celle du 9 novembre (plus bas) : la `.tapp`
ne contient plus d'interface. L'interface légère faisait 14 Ko de ses 42 Ko et ne pilotait que les
appareils ; la `.tapp` fait maintenant environ 29 Ko. Pour un navigateur sans accès à internet, la
passerelle garde, si on le demande, une **copie locale de toute l'interface** à côté de la `.tapp`.

- **Publication** : `pack_tapp.py` compresse `app.js` en gzip (niveau 9, date fixe : le même
  `app.js` donne toujours le même fichier) dans `vX.Y.Z/app.js.gz` (`dev/app.js.gz` pour un build
  de test), et écrit son SHA-256 dans `tasmoflow.be` (`APP_SHA`), comme l'empreinte SRI de `app.js`.
- **Enregistrement** (écran Diagnostic, *Copie locale de l'interface*, `CopyPanel` dans
  `update.js`) : le navigateur télécharge `app.js.gz` sur Pages (à côté de `cfg.cdn`) et l'envoie
  par les routes de la mise à jour avec `f=js` (`tf_update.be`) : contrôle de la place (le fichier
  plus 20 Ko ; l'ancienne copie et un `.js.new` abandonné comptent comme disponibles),
  `<tapp>.js.new` par morceaux, puis `update_apply?f=js` contrôle l'en-tête gzip (`1f 8b 08`) et que
  le SHA-256 est **l'`APP_SHA` de la `.tapp` elle-même** (pas une empreinte donnée par le
  navigateur), le renomme en `<tapp>.js` et note l'empreinte dans `persist` (`tasmoflow_js`). Pas de
  redémarrage. Le nom finit par `.js`, jamais par `.tapp`.
- **Utilisation** : `/tf` donne `copy` (`copy_state()` : 1 si `<tapp>.js` existe et que
  `persist.tasmoflow_js` vaut `APP_SHA`, 2 s'il existe avec une autre empreinte, sinon 0) et le
  chargeur charge `/local.js` en premier (envoyé par blocs de 1 Ko, comme tout fichier).
  `/api/status` donne aussi `copy`.
- **Après une mise à jour de la `.tapp`** : la nouvelle `.tapp` a un autre `APP_SHA`, la copie est
  donc celle d'une autre version (2) : jamais chargée ; la page charge GitHub et, sauf si une autre
  mise à jour est proposée, enregistre d'elle-même la copie de cette version (`initUpdate()`).
- **Suppression** : *Supprimer la copie* (`/api/update_drop`) efface `<tapp>.js` et `.js.new` et
  vide `persist.tasmoflow_js`.
- **Place** : environ 36 Ko des 320 Ko du système de fichiers (`UfsFree` 248 Ko le 18 novembre
  2026), contre environ 28 Ko gagnés par la `.tapp` plus petite et sa `.bak`.
- **Sans internet et sans copie** (première ouverture, copie supprimée, place insuffisante), il n'y
  a plus aucune interface TasmoFlow, seulement une ligne sur la page : le coût accepté de la
  décision. Les règles continuent de tourner sur la passerelle ; les pages de Tasmota restent le
  dernier recours.

### Avant le 18 novembre 2026 : une interface légère dans la .tapp

Décision du 9 novembre 2026 (remplacée, voir plus haut) : l'interface complète sur GitHub Pages
seulement, une **légère** (`app/src/main_lite.js`, mêmes sources, un seul écran) gardée en gzip
dans la `.tapp` sous `lite.js.gz` et servie quand GitHub était injoignable, ou pour proposer une
mise à jour. Le 11 novembre 2026, Guillaume a demandé une `.tapp` de la moitié de sa taille en
v0.2.0 (83 069 octets) : l'interface légère ne gardait que le pilotage des appareils et la mise à
jour. Les raisons d'alors (système de fichiers juste : `UfsFree` 148 Ko sur 320 Ko le 9 novembre
2026 ; GitHub pas point de défaillance unique pour piloter la passerelle) ont cédé devant la taille
de la `.tapp` : 13,9 Ko de ses 42,4 Ko, avec 131 octets de marge dans son budget.

Ce qui reste de cette décision :

- **Pas de version libre** : l'interface venue de GitHub reste figée à la version installée avec
  son empreinte SRI, et la copie locale à son SHA-256. Une interface non figée exécuterait ce que
  GitHub sert, dans un navigateur qui détient le jeton et le contrôle total de Tasmota. La mettre à
  jour demande une nouvelle `.tapp`, ce que fait le bouton de mise à jour (voir [Mise à jour de la
  .tapp](#mise-à-jour-de-la-tapp)).
- L'interface ne peut pas passer sur `https://gnatali.github.io` pour gérer les passerelles depuis
  un seul endroit : une page HTTPS qui appelle `http://<passerelle>` est bloquée (contenu mixte,
  Private Network Access). Elle doit rester chargée par la page HTTP de la passerelle.
- Les fichiers Berry sont **minifiés** par `pack_tapp.py` (`minify_berry()`), dans une `.tapp` de
  release comme de test (`--dev`) ; le budget de taille ne vaut que pour la release, que la CI
  assemble à chaque commit (un build de test peut le dépasser). Minifiés : sans commentaires,
  sans indentation, sans blanc entre un mot et un signe ; chaînes intactes, sauts de ligne gardés.
  Il vérifie que la suite de jetons est celle de la source, et la CI compile les copies minifiées
  et passe `tests/tf_http_test.be` sur le `tf_http.be` minifié. Les sources commentées restent dans
  `extension/` ; un numéro de ligne dans un message d'erreur de la passerelle désigne le fichier
  minifié.
- Les magasins d'état (`store.js`) n'ont pas de `use()` : après chaque `set()` l'interface se
  redessine depuis sa racine (`boot.js`, une fois par tâche) et Preact ne change que ce qui diffère.

| Taille (octets) | v0.2.0 | 12 novembre 2026 | 18 novembre 2026 (sans interface) |
| --- | --- | --- | --- |
| `tasmoflow.be` | 19 516 | 10 741 | 11 536 |
| `tf_http.be` | 25 710 | 7 421 | 7 659 |
| `tf_rules.be` | 9 095 | 4 330 | 4 277 |
| `tf_update.be` | 6 384 | 3 803 | 4 556 |
| `lite.js.gz` | 21 086 | 13 630 | aucune |
| **`TasmoFlow.tapp`** | **83 069** | **40 920** | **28 927** (budget 42 500) |

Qui ne veut aucun GitHub (`pack_tapp.py --cdn ''`) n'a plus aucun moyen d'obtenir l'interface (la
copie se télécharge sur GitHub Pages) : l'option ne reste que pour les essais.

## API du port 8384

| Route | Réponse |
| --- | --- |
| `GET /local.js?v=` | La copie locale de l'interface (`<tapp>.js`, gzip), envoyée par blocs de 1 Ko ; 404 sans elle |
| `GET /api/status?t=` | Versions, mémoire libre, système de fichiers, état de Zigbee (`zigbee`, et `zigbee_state` : `absent`, `starting` ou `running`), nombre d'appareils |
| `GET /api/devices?t=` | Appareils Zigbee : adresse, nom, modèle, fabricant, LQI, batterie, dernier message, derniers attributs |
| `POST /api/cmd?t=` | Exécute la commande Tasmota du corps et renvoie sa réponse JSON (`GET /api/cmd?t=&c=` marche encore pour une commande courte) |
| `GET /api/rules?t=` | Les trois jeux de règles Tasmota (état, options, texte, place libre, copie précédente) et les règles Berry (`tf_rules.be`) |
| `POST /api/rule_set?t=&n=` | Envoie le nouveau texte du jeu `n` (corps de la requête) |
| `GET /api/rule_apply?t=&n=&step=` | L'applique en trois requêtes : `bak` (copie du texte actuel), `put` (`Rule<n>`), `check` (relecture) ; en cas d'échec l'interface appelle `rule_restore` |
| `GET /api/autoexec?t=` | `/autoexec.be` en texte, en lecture seule, 6 000 octets au plus (`{"exists":false}` sans lui). Le seul fichier que l'API lit : les autres (`tuya.json`…) contiennent des clés |
| `GET /api/update_check?t=&size=` | Place pour une `.tapp` de `size` octets : `{free, tapp, bak, js, stale, need, room}` en octets (voir [Mise à jour de la .tapp](#mise-à-jour-de-la-tapp)) |
| `POST /api/update?t=&off=&size=` | Un morceau (base64, corps de la requête) de la nouvelle `.tapp`, écrit dans `<tapp>.new` |
| `GET /api/update_apply?t=&size=&sha256=` | Contrôle `<tapp>.new`, l'installe (`<tapp>.bak` gardé), redémarre |
| `GET /api/update_abort?t=` | Supprime `<tapp>.new` |
| les quatre mêmes avec `&f=js` | La copie locale de l'interface : `<tapp>.js.new`, contrôlée avec `APP_SHA` et renommée `<tapp>.js`, sans redémarrage (voir [Copie locale](#copie-locale-de-linterface)) |
| `GET /api/update_drop?t=` | Supprime la copie locale |
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

Depuis le 19 novembre 2026 (analyse de bugs T6 et T9), le serveur garde aussi **10 connexions** au
plus : une de plus reçoit `503 {"error":"busy"}`. Une requête encore incomplète 10 s après
l'ouverture de la connexion est coupée sans réponse, de même qu'une réponse que le client n'a pas
prise 30 s après sa fin (un flux n'a pas ce délai). L'extension garde **trois flux d'événements** :
un quatrième fait recevoir `event: stop` au plus ancien, qui est ensuite fermé ; cette interface
cesse de se reconnecter, dit pourquoi et propose **Reprendre** (qui met à son tour en pause le plus
ancien des autres). Avant, le flux évincé se reconnectait 3 s plus tard et évinçait le suivant, sans
fin.

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
passe par `TuyaConfig`. Depuis le firmware du 18 novembre 2026, `TuyaConfig <appareil>` lit
`tuya.json` entrée par entrée (`each_device()`) et trouve aussi un sous-appareil d'une passerelle
Tuya ; `TuyaConfig` seul charge toujours tout le fichier (`read_conf()`, refusé sous 30 Ko libres).

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
   pilote ; `Enabled: false` = désactivé ; un `State` autre que `running` = le pilote démarre
   (voir [Pilotes à l'ouverture](#pilotes-à-louverture)). Sans pilote, **aucun écran Tuya n'est
   affiché**.
2. `TuyaStatus` : chaque appareil et sous-appareil (nom, `Connected`, `Ip`, `Version`, `Dps`).
3. `TuyaConfig <nom>` pour chaque appareil de `TuyaStatus` pas encore connu (depuis le 18
   novembre 2026, `loadTuya()` dans `state.js`) : l'entrée d'une passerelle Tuya apporte ses
   sous-appareils. La configuration est gardée pour la passerelle et redemandée seulement pour un
   appareil qui y manque. Avec le nouveau firmware, rien n'est refusé faute de mémoire. Un
   firmware plus ancien charge tout le fichier pour chaque appareil et refuse sous 30 Ko libres :
   les cartes retombent alors sur des bascules pour les DP booléens et le disent ; il ne trouve
   pas non plus un sous-appareil seul, la configuration entière est alors lue une fois.

Les changements arrivent par le flux d'événements : l'extension ajoute une règle Berry
`tasmota.add_rule("Tuya", fermeture, 'tasmoflow')` tant que son serveur tourne (une fermeture,
car `check_not_method` refuse les méthodes ; l'identifiant permet à `remove_rule` de ne retirer
que la règle de TasmoFlow ; `tasmota_class.be`). Sa valeur est la table `{"Name","Dps"}` elle-même.

Les contrôles viennent des liaisons Matter de `tuya.json` (`controlsFor` dans
`app/src/tuya_model.js`) :

| `type` de la liaison | Contrôles |
| --- | --- |
| `relay`, `relay_power` | interrupteur sur `dp` (1 par défaut) ; `relay_power` : mesures de puissance, tension, courant (`dp_power`, `div_power`...) |
| `light0` à `light3` | interrupteur sur `dp` (20 par défaut) ; `light1`+ : variateur sur `dp_bri` (22, de `bri_min` 10 à `bri_max` 1000, affiché 1-100 % comme l'application Tuya, brut 10 = 1 %, jamais 0) ; `light2` : température de couleur sur `dp_ct` (23, 0-1000) |
| `fan` | interrupteur sur `dp` (60) et vitesse sur `dp_speed` (62, de `speed_min` 1 à `speed_max` 6) |
| `temp`, `humidity` | mesure sur `dp`, divisée par `div` (10) |
| `sensors` (appareil) | une mesure par libellé : `[dp, diviseur, unité]` |
| aucune | `toggle` sur chaque DP booléen |

`TuyaSend <appareil>,<dp>,toggle` inverse un interrupteur ; les curseurs envoient la valeur
brute. L'état affiché est celui que l'appareil renvoie (pas d'affichage optimiste).

**Panneau `light3`** (interface complète seulement, `app/src/tuya_colour.js`, branché sur les cartes par
`EXTRA.refine` de `tuya.js`), présenté comme l'application Tuya. **Onglets Blanc /
Couleur** : ils suivent le mode que l'appareil signale (`dp_mode`, 21 : `white` ou `colour` ; pas
d'affichage optimiste) ; un onglet envoie le mode (`TuyaSend <appareil>,21,white|colour`) ; un autre
mode (scène, musique) ou aucun connu ne sélectionne aucun onglet et montre le contenu blanc. **Blanc** :
curseur de luminosité sur `dp_bri` (de `bri_min` à `bri_max`, affiché en %), plus un curseur de
température de couleur en cadran d'arc (voir `light2`) seulement si la liaison porte elle-même `dp_ct` (une `light3` comme les lampes
`Pergola` n'a pas de DP 23 : pas de contrôle qui ne fait rien). **Couleur** : une **roue de teinte**
(teinte 0 à 3 heures, sens inverse des aiguilles comme dans l'application Tuya ; le repère suit le
pointeur, la couleur part au relâchement ; les flèches le déplacent de 5 degrés) et deux curseurs,
luminosité (la valeur de la couleur, 10 à 1000) et saturation (0 à 1000). La couleur est `dp_colour` (24),
`colour_data_v2` = `hhhhssssvvvv` en hexadécimal (teinte 0 à 360, saturation et valeur 0 à 1000) ;
chaque changement envoie d'abord le mode (quand l'appareil en signale un et n'est pas en mode couleur)
puis la couleur entière en chaîne JSON (`TuyaSend <appareil>,24,"hhhhssssvvvv"`, entre guillemets car
une valeur faite uniquement de chiffres serait lue comme un nombre). Les valeurs affichées demandent
`"keep": [21, 22, 24]` dans `tuya.json` quand la liaison est désactivée (voir plus bas).
Pas proposés : scènes (`scene_data_v2`, DP 25), minuteries, ne pas déranger, modes réveil et sommeil.

**Valeur tenue et options masquées** (panneaux `light2` et `light3`) : une valeur qu'on vient de régler
(teinte, saturation, luminosité, température) reste affichée jusqu'à ce que l'appareil la signale, 3 s au
plus, pour que l'ancienne valeur ne revienne pas entre la commande et l'événement de l'appareil (un par
DP, un instant plus tard) ; un événement plus ancien d'une autre valeur ne casse pas la tenue. Après 3 s,
l'état réel s'affiche de nouveau. Les onglets de mode montrent toujours l'état de l'appareil seul. Tant que la lampe est éteinte (DP d'interrupteur, 20, à faux) ou
l'appareil déconnecté, le panneau (onglets, roue, arc, curseurs) est masqué et seul le bouton
d'alimentation de la carte reste ; un état d'interrupteur inconnu laisse le panneau visible.

**Panneau `light2`** (même module) : une lampe blanche seule (température de couleur, pas de couleur) a un
seul panneau avec un **cadran en arc ouvert** pour la température de couleur (`dp_ct`, 23, 0 à 1000
affiché en % : 270 degrés ouverts en bas, chaud en bas à gauche, froid en bas à droite, anneau dégradé,
repère ; un clic dans l'ouverture va à l'extrémité la plus proche ; les flèches le déplacent de 5 % ;
envoyé au relâchement comme la roue de teinte) et le curseur de luminosité (`dp_bri`) dessous, sans
onglets ni roue de teinte. Une `light3` avec `dp_ct` montre le même cadran dans son onglet Blanc. Un changement quand la lampe est
dans un autre mode (scène, musique) envoie d'abord `white` sur `dp_mode`. Les curseurs de luminosité
vont de 1 % à 100 % (brut `bri_min` 10 à `bri_max` 1000), comme l'application Tuya, jamais 0 % : le
variateur des cartes suit la même règle.

**Noms avec une virgule** : `TuyaSend` coupe son argument aux deux premières virgules
(`string.split(payload, ",", 2)` dans le pilote), un tel nom ne peut donc pas être donné. Le pilote
accepte aussi un **identifiant d'appareil** (`find_node`), que `TuyaConfig` renvoie pour les
appareils Wi-Fi et les passerelles Tuya : TasmoFlow l'utilise à la place du nom (`sendName` dans
`tuya_model.js`) et affiche le nom dans les phrases. Un sous-appareil d'une passerelle Tuya n'a pas
d'`id` (seulement un `cid`, que `find_node` ne compare pas), et une passerelle dont `TuyaConfig` n'a
pas été lue non plus : un tel appareil montre ses mesures mais n'offre aucun contrôle.
L'identifiant n'est pas un secret (la clé locale en est un, et n'arrive jamais dans l'interface).

**`"enabled": false`** sur une liaison Matter retire seulement le point de terminaison de Matter (et
de `TuyaActive`) : TasmoFlow se sert quand même de la liaison pour savoir ce que veulent dire les DP
(constaté sur la passerelle le 11 novembre 2026 : un `light3` et un récepteur à quatre relais, toutes
liaisons désactivées, s'affichaient en interrupteurs `DP 20`, `DP 34`… sans variateur ni noms).
Conséquence : le pilote ne garde alors aucune valeur pour les DP d'une liaison désactivée (il n'a
gardé que les DP 20 et 34 du `light3`), donc un curseur dont la valeur est inconnue est marqué `?`
jusqu'à ce que l'appareil signale un changement ; `"keep": [21, 22, 24]` dans `tuya.json` les
conserve.

### Pilotes à l'ouverture

Une fois l'état et celui de Tuya lus, `detect()` (`app/src/state.js`) remplit `S.drivers` : `zigbee`
et `tuya` valent `running`, `starting`, `disabled` ou `absent` (plus `tuyaWhy`, le `State` du
pilote, par ex. `waiting for Zigbee`). Zigbee vient de `zigbee_state` dans `/api/status` (`absent` :
pas de global `zigbee`, `starting` : présent mais `started()` est faux ; Tasmota ne permet pas de
distinguer un Zigbee désactivé d'un Zigbee en cours de démarrage ; une ancienne `.tapp` n'envoie que
le booléen `zigbee`, lu comme running ou starting). Tuya vient de `TuyaEnable` (`waiting` vaut
`starting`).

Un pilote qui n'est pas `running` a ses fonctions désactivées (appairage, ses appareils, les
sélecteurs de l'éditeur de phrases) et l'écran Appareils dit pourquoi (`DriverNote`, `views.js`).
Un pilote `absent` n'est simplement pas affiché. Tant qu'un pilote est `starting`, `drivers_full.js` le relit toutes les 5 secondes
  (seulement ce qui démarre : l'état pour Zigbee, `TuyaEnable` pour Tuya, jamais `TuyaConfig`),
  charge les appareils quand Zigbee démarre et active les fonctions sans clic. Elle abandonne au
  bout de 2 minutes (un Zigbee qui ne démarre jamais) et propose « Réessayer ». Un pilote
  `disabled` n'est pas relu ; « Actualiser » relit tout. (L'interface légère, jusqu'au
  18 novembre 2026, demandait seulement de recharger la page.)

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
  (`TuyaEnable 0`), les cartes Tuya ne sont pas affichées (un pilote absent ne laisse aucune trace, un pilote désactivé une note : voir [Pilotes à l'ouverture](#pilotes-à-louverture)).

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
- **Disposition de l'écran Règles** (11 novembre 2026) : un **accordéon** : une section par jeu de
  règles (`Rule1` à `Rule3`, avec un point pour son état) et une pour les règles Berry, chacune
  s'ouvrant et se fermant seule (des onglets ont été essayés puis remplacés). Le composant de section
  est défini au niveau du fichier : un composant créé dans la fonction de rendu est un nouveau type à
  chaque fois et Preact reconstruit tout ce qu'il contient, le texte en cours de saisie compris, à
  chaque événement reçu (testé). En
  vue *Phrases*, chaque bloc est une **tuile** (lignes Quand / Si / Alors / Sinon) ; *Modifier* ouvre
  le formulaire dans une **fenêtre par-dessus la page** (`<dialog>` natif : Échap et le fond la
  ferment, le bouton *Terminé* reste visible sur téléphone), et non sur place ; deux tuiles en
  pointillés ajoutent une règle : une règle **guidée** (ci-dessous) ou une règle **libre** (le formulaire).
- **Texte non enregistré et options** (12 novembre 2026) : allumé/éteint, *une seule fois* et *arrêt sur erreur* agissent aussitôt sur la passerelle, puis la carte est reconstruite d'après ce qu'elle contient, ce qui faisait perdre un texte non enregistré (une nouvelle règle comprise). Avec un tel texte, l'interface propose maintenant de l'enregistrer d'abord (puis applique l'option) ; en cas de refus, rien ne se passe et la case est remise comme elle était ; si le texte est invalide (ou trop long), elle le dit et ne fait rien. La même question (qui nomme le jeu de règles, un par un) précède tout ce qui ferait perdre le texte : fermer la section du jeu de règles, changer d'écran ou de passerelle (`guardLeave()` dans `state.js`, que l'écran Règles enregistre tant qu'il est affiché ; un refus ou un texte invalide laisse l'écran tel quel, et le sélecteur de passerelle est redessiné avec la bonne valeur), et fermer ou recharger la page (la question propre au navigateur, `beforeunload`). Le garde est dans `state.js`.
- **Éditeur en phrases** (v0.2 étape 2, écrit ; la vue **Phrases** d'un jeu de règles, interface
  complète seulement : `rules_model.js`, `rules_editor.js`, enregistré par `main.js` pour que
  l'interface légère ne le contienne pas ; rien ne change sur la passerelle). Un bloc
  `on <déclencheur> [if (<condition>)] do <commandes> [else <commandes>] endon` se lit
  *Quand* `Sujet#Clé` *op valeur*, *Si* `condition`, *Alors* commandes, *Sinon* commandes ;
  `Backlog a; b` est une liste de commandes. Tout le reste reste un **bloc brut** affiché en
  texte (déclencheurs reliés par `and`/`or`, `if` imbriqués, opérateur sans
  valeur, corps vide, branche vide), et un jeu de règles qui n'est pas une suite de blocs ne s'ouvre qu'en
  vue Texte. Ouvrir un jeu de règles ne le réécrit jamais : un bloc n'est réécrit qu'une fois
  modifié (`src` conservé). Déclencheurs et commandes utilisent un **champ à choix** : fermé, il se lit comme la tuile (`Lampe salon · Power`) ; ouvert, il liste tout en arbre (un groupe par appareil) avec l'élément courant en évidence ; La liste flotte par-dessus tout (`position: fixed`, placée d'après le champ, au-dessus quand il y a plus de place, suivant le champ quand la fenêtre défile) : dans la fenêtre qui défile, une liste en position absolue était coupée. *Personnalisé…* le transforme en champ texte, donc tout déclencheur ou toute commande Tasmota reste écrivable. Un `<select>` affiche le même texte ouvert et fermé, et un `<datalist>` ne propose que ce qui correspond au texte déjà saisi : aucun des deux ne convient.
  `tests/rules_model_test.js` (CI) vérifie la lecture, l'écriture de chaque forme et l'absence de
  réécriture. **Sélecteurs
  d'appareils** (`rules_devices.js`) : à côté de chaque champ de déclencheur et de commande, une liste
  propose les valeurs courantes, puis les appareils de la passerelle. *Déclencheurs Zigbee* :
  `ZbReceived#<clé>#<attribut>` pour chaque attribut qu'un appareil a signalé ; d'après le code de
  Tasmota (`tasmota/tasmota_xdrv_driver/xdrv_23_zigbee_2a_devices_impl.ino`,
  `Z_Device::jsonPublishAttrList`, commit du firmware `a281cece`), `<clé>` est le nom convivial
  seulement si `SetOption83` est actif et que l'appareil en a un, sinon l'adresse courte
  `0x%04X` ; l'éditeur lit donc `SetOption83` et écrit la bonne clé ; un nom avec un espace ne peut
  pas servir de déclencheur, il est écarté avec une indication. *Actions Zigbee* :
  `ZbSend {"device":"0x1234","send":{"Power":"On"}}` (allumer, éteindre, basculer ; par adresse, qui
  ne change jamais) pour les appareils qui ont un attribut `Power`. *Actions Tuya* :
  `TuyaSend <nom>,<dp>,true|false|toggle` par interrupteur, `TuyaSend <nom>,<dp>,` à compléter pour
  un curseur (un nom avec virgule passe par son identifiant, ou est écarté sans lui). Pas de *déclencheurs Tuya* : la règle `Tuya#Dps#<dp>` ne
  voit pas le nom de l'appareil (les règles Berry le feront). Les phrases se lisent en langage clair
  quand le motif est connu (`Lampe · Power = 1`, `basculer Lampe`). Les attributs listés sont ceux
  qu'un appareil a signalés depuis l'ouverture de l'interface ou dans son dernier état : un bouton
  montre `Click` après son premier appui. Pas encore : Matter, déplacement d'un bloc, noms clairs
  pour les événements propres à la passerelle.
- **`elseif`, plusieurs déclencheurs, appareil connecté** (v0.2, écrit le 12 novembre 2026 ; interface
  complète seulement, rien ne change sur la passerelle pour TasmoFlow lui-même). Vérifié dans la source de
  Tasmota (commit du firmware `43d9409`, `tasmota/tasmota_xdrv_driver/xdrv_10_rules.ino`) :
  - **`elseif`** : `if (c1) a elseif (c2) b else c endif` est géré (`ProcessIfStatement`), autant de
    `elseif` que voulu, chacun avec sa condition et ses commandes. La phrase gagne des lignes *Sinon si*
    (condition, puis ses commandes) ; un `if` imbriqué, un `elseif` sans condition ou une branche vide
    reste un bloc brut.
  - **Plusieurs déclencheurs** : Tasmota n'a **pas de `and`/`or` entre déclencheurs**. `RuleSetProcess`
    donne tout le texte entre `on` et `do` à `RulesRuleMatch`, qui lit un seul `nom <op> valeur` : `on a#b=1
    and c#d=2 do` ne se déclenche jamais. Plusieurs déclencheurs sont donc **plusieurs blocs `on ... do ...
    endon` aux mêmes actions** (n'importe lequel déclenche la règle, la phrase dit *ou*). L'éditeur écrit un
    bloc par déclencheur et relit les blocs voisins aux actions identiques comme **une seule phrase**
    (`more` dans `rules_model.js`) ; le texte d'origine de chaque bloc est gardé, donc ouvrir un jeu de
    règles ne le réécrit toujours jamais. Le même déclencheur deux fois reste deux blocs (le conflit est
    signalé) ; la détection de conflits regarde chaque déclencheur d'une phrase et chaque branche. Le prix
    est la place des règles (les actions sont écrites une fois par déclencheur : 512 caractères, 2 000
    compressés).
  - **Appareil connecté** (un déclencheur proposé pour chaque appareil, dans la liste des déclencheurs) :
    - *Zigbee* : quand un appareil appairé est remis sous tension (ou rejoint le réseau), Tasmota publie
      `{"ZbState":{"Status":30,"IEEEAddr":...,"ShortAddr":"0x1234",...}}` et lance les règles dessus
      (`Z_ReceiveEndDeviceAnnonce`, `xdrv_23_zigbee_8_parsers.ino`) : le déclencheur est
      `ZbState#ShortAddr=0x1234` (les chaînes se comparent sans tenir compte de la casse, l'hexadécimal
      compris). C'est l'**annonce** de l'appareil : les appareils sur secteur (ampoules, prises, routeurs)
      l'envoient en revenant, **pas les appareils sur batterie**. Un déclencheur teste une seule valeur,
      donc les autres messages `ZbState` de l'appareil (étapes de l'appairage) le déclenchent aussi. Il
      n'y a pas d'autre événement « de retour » : `Reachable` n'est publié qu'à `false`, après un `ZbPing`
      ou une lecture sans réponse (`Z_Unreachable`, `xdrv_23_zigbee_6_0_commands.ino`), et repasse à vrai
      sans rien publier.
    - *Tuya* : le pilote du firmware ne publiait rien quand un appareil se connecte ou se déconnecte (une
      ligne de log seulement). Le pilote du dépôt du firmware publie maintenant
      `{"TuyaConnected":{"Name":"<appareil>"}}` quand un appareil est prêt et
      `{"TuyaDisconnected":{"Name":"<appareil>"}}` quand un appareil prêt est perdu (branche de ce dépôt, à
      compiler et à flasher) : les déclencheurs sont `TuyaConnected#Name=<appareil>` et
      `TuyaDisconnected#Name=<appareil>`. Sans le nouveau firmware ils sont proposés mais ne se déclenchent
      jamais. Un nom qui contient `= < > ! | $ %` ou ` do ` ne peut pas s'écrire dans un déclencheur et est
      écarté. Ils se déclenchent aussi au démarrage du pilote, quand il connecte tous les appareils.
    - Dans les phrases, un appareil qui se connecte se lit `Lampe salon · connecté` / `Ventilateur ·
      déconnecté` et sa comparaison est masquée (elle fait partie du déclencheur).
    - `tests/rules_model_test.js` vérifie le modèle (elseif sous toutes ses formes, fusion et écriture de
      plusieurs déclencheurs, conflits) et les sélecteurs ; `tests/e2e.js` la fenêtre.
- **Mode guidé** (v0.2, écrit le 12 novembre 2026 ; interface complète seulement : `rules_guided.js`,
  logique dans `rules_guided_model.js`, fenêtre partagée avec le formulaire dans `rules_modal.js` ; rien ne
  change sur la passerelle, pas de `.tapp` à réinstaller). La tuile *Règle guidée* ouvre une fenêtre en deux
  étapes. **1. Quand** : la liste des appareils Zigbee qui peuvent déclencher une règle (la même que pour
  les sélecteurs : un nom avec un espace est écarté), puis *Que se passe-t-il ?* en mots : pour `Power` « il
  s'allume » (`=1`), « il s'éteint » (`=0`), « il change d'état » ; pour tout autre attribut « à chaque
  message » et les valeurs vues pour cet appareil (messages reçus depuis l'ouverture de l'interface, et
  dernier état ; valeurs d'un seul mot). **Apprentissage** : *Apprendre : appuyez sur le bouton* écoute le
  flux d'événements (`S.events`, les mêmes Server-Sent Events que l'écran Événements) et, au premier message
  de l'appareil choisi (ou de n'importe quel appareil si aucun n'est choisi, en écartant les mesures qu'un
  appareil envoie seul comme `Temperature` ou `BatteryPercentage`), remplit l'appareil, l'attribut et la
  valeur (`Click = single`) ; rien n'est écrit avant que l'utilisateur ait vérifié. **2. Alors** : une
  ligne par commande, un appareil puis une action (les mêmes listes que le formulaire, sans les commandes
  courantes ; un curseur demande sa valeur). La phrase obtenue s'affiche (`Quand Bouton salon · Click =
  single, alors basculer Lampe salon`) et *Créer la règle* ajoute le bloc comme un autre, que *Modifier*
  permet ensuite d'affiner (condition, autres commandes) ; *Passer en règle libre* ouvre le formulaire.
  Pas dans le mode guidé : conditions, déclencheurs Tuya (l'événement de règle `Tuya` ne porte pas le nom de
  l'appareil), Matter. `tests/rules_model_test.js` vérifie la logique (appareils, valeurs vues,
  apprentissage, bloc écrit) et `tests/e2e.js` la fenêtre, l'apprentissage depuis le faux bouton et son
  affichage sur un écran de 360 px.
- **Règles Berry et `autoexec.be`** (v0.2 étape 4, lecture seule) : la section Berry liste les
  déclencheurs de `tasmota._rules` (motif et propriétaire : l'identifiant, ou la classe de l'objet qui
  l'a enregistré ; `nil` et `None` ne s'affichent pas) et montre `/autoexec.be`, d'où viennent
  d'habitude ces règles. Pas encore de modification : un script qui ne compile pas ou qui plante peut
  arrêter Berry au démarrage, donc l'écriture demande la copie avant écriture et le contrôle de
  compilation prévus pour elle (pour plus tard).
- **Règles qui se gênent** (`rules_conflicts.js`, interface complète, sans coût sur la passerelle) :
  la liste au-dessus des jeux de règles nomme les blocs de jeux actifs qui se déclenchent sur le même
  événement et agissent sur le même appareil : deux bascules (l'effet s'annule), un *allumer* et un
  *éteindre* (ordres contraires), ou le même ordre deux fois. Seules les commandes qui nomment leur
  cible sont comparées (`Power<n> on|off|toggle`, `ZbSend` avec `Power`, `TuyaSend` avec
  `true|false|toggle`) ; les autres déclencheurs et commandes sont ignorés, ainsi que les
  automatisations Matter / Google Home que la passerelle ne voit pas. Les jeux concernés portent aussi
  un ⚠ dans leur en-tête d'accordéon, pour que l'avertissement se voie où que la page soit défilée (la
  liste elle-même est en haut de l'écran).
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
- [ ] (Obsolète depuis le 18 novembre 2026 : plus d'interface légère, voir le point de la copie locale plus bas.) v0.1 : navigateur hors ligne (ou `gnatali.github.io` bloqué), `/tf` affiche l'interface légère : les appareils avec leurs bascules, la console et le diagnostic fonctionnent, les onglets Passerelles et Événements sont absents, « Réessayer » charge l'interface complète dès que GitHub répond (la console et le diagnostic ont quitté l'interface légère le 11 novembre 2026 : voir le point suivant)
- [ ] v0.2, `.tapp` réduite (11 novembre 2026, build de test, `.tapp` réinstallée, `Restart 1`) : la `.tapp` fait environ 40 Ko ; le journal de démarrage affiche `TFL: TasmoFlow <version>, API on port 8384 once an interface is opened` (le Berry minifié se charge) ; GitHub bloqué, `/tf` n'affiche que les appareils, sans barre d'onglets : une bascule Zigbee, « Appairer », un interrupteur et un curseur Tuya fonctionnent et leur état revient, le bouton de langue fonctionne, « Réessayer » charge l'interface complète dès que GitHub répond ; GitHub joignable, l'interface complète marche comme avant (Règles : enregistrer et restaurer, règles Berry, `autoexec.be` ; console ; diagnostic ; passerelles) ; une mise à jour depuis l'interface légère fonctionne toujours ; mémoire au repos et interface ouverte inchangée ou plus basse (12 novembre 2026 : fonctionne sur la passerelle, Guillaume)
- [x] v0.2, place pour la mise à jour (12 novembre 2026, vérifié sur la passerelle par Guillaume, la `.tapp` avec `/api/update_check` installée une fois à la main) : avec assez d'espace libre la mise à jour passe et l'ancienne `TasmoFlow.tapp.bak` reste jusqu'au contrôle du nouveau fichier ; avec peu d'espace libre mais une `.bak`, la `.bak` est supprimée et la mise à jour passe ; avec trop peu de place même sans la `.bak`, le bandeau le dit avec les tailles (nécessaire, disponible) avant tout téléchargement, et rien ne change
- [x] La liste des appareils correspond à `ZbStatus1`
- [x] Un appui sur un bouton Zigbee apparaît dans l'onglet Événements en moins de 2 s
- [x] « Basculer » allume et éteint une lampe ; « Appairer » ouvre l'appairage 60 s
- [x] Mémoire, chaque fois après `tasmota.gc()` dans la console Berry : 84 Ko libres avant installation, 67 Ko avec l'extension chargée, 65 Ko avec l'interface ouverte, soit 17 puis 19 Ko (cible : 15 Ko, voir [Mémoire](#mémoire))
- [x] Deux onglets ouverts plus un troisième : la passerelle reste stable (3 onglets Chrome et 1 Android)
- [x] 19 novembre 2026 (T6, vérifié sur la passerelle par Guillaume) : un quatrième onglet ouvert : le premier dit qu'il ne reçoit plus les changements en direct, son badge indique « en pause », les trois autres restent « en direct » ; **Reprendre** le rétablit et met en pause le plus ancien des autres ; le journal de la passerelle ne montre pas de reconnexion toutes les 3 s
- [x] 19 novembre 2026 (T9, vérifié sur la passerelle par Guillaume) : `nc <passerelle> 8384` (sous Windows, un `TcpClient` PowerShell) laissé ouvert sans rien envoyer est fermé au bout de 10 s ; l'interface fonctionne toujours avec trois onglets ouverts
- [ ] Une interface ouverte sur la passerelle A lit `/api/status` de la passerelle B (jeton de B, écran Passerelles) ; avec le serveur d'API de B arrêté, l'écran le réveille par `/tf?w=1`
- [x] GitHub Pages activé (tag `v0.0.1`), `/tf` charge la copie GitHub (en-tête : « v0.0.1 · github »)
- [x] Chrome, Firefox, Safari sur iPhone : l'interface se charge et le flux d'événements reste ouvert
- [x] Matter continue de fonctionner (Google Home commande toujours ses appareils)
- [x] Le pilote Tuya démarre toujours au boot avec TasmoFlow installé (`TuyaEnable` : `"State":"running"`)
- [x] v0.1 : après un redémarrage, le port 8384 ne répond pas tant que `/tf` n'est pas ouverte ; le journal affiche `TFL: API server started on port 8384`, puis `TFL: API server stopped` 5 minutes après la fermeture du dernier onglet, et `/tf` le redémarre (le port peut être de nouveau écouté)
- [ ] v0.1 : `curl "http://<passerelle>/tf?w=1"` répond `ok` sans mot de passe et démarre le serveur
- [ ] v0.1 : les cartes Tuya correspondent à `TuyaStatus` ; un interrupteur, un variateur et une vitesse de ventilateur agissent sur les vrais appareils ; un changement fait sur un appareil (bouton, Smart Life) arrive dans l'interface en moins de 2 s
- [ ] v0.1 : avec le pilote Tuya absent, la section Tuya est masquée ; désactivé (`TuyaEnable 0`), elle affiche « Tuya est désactivé » (changé le 12 novembre 2026, voir l'élément suivant)
- [x] v0.2, pilotes à l'ouverture (12 novembre 2026, vérifié sur la passerelle par Guillaume, version de test, `.tapp` réinstallé, `Restart 1`) : ouvrir `/tf` juste après un redémarrage : l'interface complète dit « Zigbee démarre » avec l'appairage désactivé, puis « Tuya démarre (waiting for Zigbee) », et active chacun toute seule dans les 5 secondes qui suivent son démarrage, sans recharger ; l'interface légère (GitHub bloqué) dit « Zigbee n'est pas prêt » / « Tuya n'est pas prêt », garde l'appairage et les cartes Tuya désactivés et ne fait rien avant « Recharger » ; `TuyaEnable 0` : l'interface complète dit que Tuya est désactivé, la légère qu'il n'est pas prêt, aucune n'affiche de carte
- [x] v0.1 : mémoire au repos après `tasmota.gc()` : 75 Ko libres, Berry 35 Ko, soit 9 Ko (cible : 15 Ko) ; interface ouverte 63 Ko / 48 Ko (`import` en cache, voir [Mémoire](#mémoire))
- [x] v0.1 : avec le chargement sans cache, la mémoire revient en partie 5 minutes après la fermeture du dernier onglet : 59 Ko libres / Berry 48 Ko interface ouverte, 69 Ko / 39 Ko après (75 Ko / 35 Ko avant la première ouverture)
- [x] v0.2 (11 novembre 2026, deux mises à jour de suite, `dev.1688247` puis `dev.e00d0d6` puis `dev.f34f8c7`) : mise à jour (`.tapp` du build de test précédent installée, puis relancer `Build`) : `/tf` affiche l'interface légère avec le bandeau et **Mettre à jour** ; le bouton envoie le fichier, la page attend puis se recharge sur le nouveau build (`dev.<commit>` dans l'en-tête), `TasmoFlow.tapp.bak` existe à côté de `TasmoFlow.tapp`, aucun `.new` ne reste, aucune `.tapp` dans `/` et `/.extensions/` à la fois ; **Plus tard** ouvre l'interface habituelle ; mémoire au repos et interface ouverte inchangées (`tf_update.be` n'est compilé que lorsqu'on s'en sert)
- [ ] v0.2 : mise à jour, cas d'échec : coupure de courant pendant le transfert (le `.new` n'est pas chargé au démarrage), un `sha256` faux dans `latest.json` (refusé, rien ne change)
- [ ] v0.2 : section Berry : la liste correspond à `Br print(tasmota._rules)` avec leur propriétaire, et `autoexec.be` s'affiche en texte (`.tapp` réinstallée, `Restart 1` ; la route est nouvelle)
- [ ] v0.2 : conflits : deux jeux de règles actifs qui basculent la même lumière sur le même déclencheur affichent le bandeau « Règles qui peuvent se gêner » ; il disparaît quand l'un est éteint
- [ ] v0.2 : sélecteurs d'appareils : dans une nouvelle règle, la liste des déclencheurs propose vos appareils Zigbee (attributs signalés) et les listes de commandes proposent `ZbSend` (allumer, éteindre, basculer) et vos appareils Tuya ; avec `SetOption83` actif et un appareil nommé, le déclencheur porte le nom (`ZbReceived#Lampe#Power`), sinon l'adresse ; la règle enregistrée fonctionne (appui sur le bouton, la lumière bascule) ; la phrase se lit `Lampe · Power = 1` / `basculer Lampe`
- [ ] v0.2 : mode guidé : *Règle guidée*, choisir le vrai bouton, *Apprendre : appuyez sur le bouton*, appuyer : l'appareil, `Click` et la valeur envoyée sont remplis et la phrase se lit bien ; choisir une lampe comme action, *Créer la règle*, Enregistrer : appuyer sur le bouton bascule la lampe (sur la passerelle, interface fermée) ; l'apprentissage sans appareil choisi ignore les mesures périodiques d'un capteur et prend le premier appui sur un bouton
- [ ] v0.2 : appareil connecté (Zigbee) : une règle `on ZbState#ShortAddr=0x<lampe> do ...` (choisie comme *connecté* dans la liste des déclencheurs d'une lampe) : débrancher la lampe, la rebrancher : la règle se déclenche (ligne de log `RUL: ZBSTATE#SHORTADDR=...`) ; un capteur sur batterie ne la déclenche jamais
- [ ] v0.2 : appareil connecté (Tuya, demande le firmware avec `TuyaConnected` / `TuyaDisconnected`) : `on TuyaConnected#Name=<appareil> do ...` se déclenche quand l'appareil est rallumé, et `TuyaDisconnected#Name=<appareil>` quand il est éteint ; un nom avec une virgule fonctionne
- [ ] v0.2 : plusieurs déclencheurs et sinon si : trois déclencheurs sur une phrase donnent trois blocs `on ... endon` en vue Texte et une seule tuile à la relecture ; une branche `elseif` s'exécute quand sa condition est vraie (`Var1`)
- [ ] v0.2 : vue Phrases : un jeu de règles saisi en vue Texte s'affiche en phrases ; modifier la valeur d'un déclencheur, ajouter un `if` / `else` et une deuxième commande, ajouter et supprimer une règle, puis Enregistrer donne le texte attendu (`Rule<n>` dans la console) ; une règle qui n'entre dans aucune phrase reste en texte
- [x] v0.2 (10 novembre 2026) : écran Règles : les trois jeux affichent le texte de `Rule1` à `Rule3` ; enregistrer une règle de plus de 600 caractères (corps POST) se relit à l'identique quand elle est saisie sur plusieurs lignes (stockée sur une ligne, affichée un bloc par ligne ; sinon l'ancien texte est remis et une erreur s'affiche) ; « Copie précédente » puis « Restaurer » remet l'ancien texte
- [x] v0.2 : l'activation/désactivation, « une seule fois » et « arrêt sur erreur » agissent sur le vrai jeu de règles ; la liste des règles Berry correspond à `Br print(tasmota._rules)`
- [x] v0.2 : l'interface légère (GitHub bloqué) montre l'onglet Règles avec activation/désactivation et restauration, sans l'éditeur (retiré le 11 novembre 2026 : les règles ne sont plus que dans l'interface complète)
- [x] v0.2 (11 novembre 2026) : mémoire avec l'API des règles chargée (`tf_rules.be` est compilé avec le serveur d'API), après `tasmota.gc()` : au repos 75-76 Ko libres / Berry 39 Ko (8 à 9 Ko), interface ouverte 52 Ko / 55 Ko (32 Ko), 5 minutes après la fermeture 70 Ko / 39 Ko (14 Ko, budget 15 Ko)
- [x] v0.2 : URL longues (version de test avec l'analyseur à base de chaînes, `.tapp` réinstallé, `Restart 1`) : `http://<passerelle>:8384/api/status?t=<jeton>&p=<a répété 130 fois>`, puis 90 et 50, renvoient l'état ; des lignes de requête de 190 et 512 caractères répondent aussi ; une de 900 caractères renvoie `{"error":"uri_too_long"}` ; la passerelle ne redémarre jamais (`Status 1` : `RestartReason` inchangée, la durée de fonctionnement continue d'augmenter) ; l'interface marche toujours (appareils, console, écran Règles : enregistrer et restaurer)
- [x] v0.1 (12 novembre 2026, `.tapp` réinstallée, interface légère modifiée) : un appareil Tuya dont le nom contient une virgule (Wi-Fi ou passerelle, listé par `TuyaConfig` avec son `id`) se commande depuis sa carte dans les deux interfaces (`TuyaSend <id>,<dp>,toggle` dans le journal) et apparaît dans les sélecteurs de règles sous son nom ; un sous-appareil de passerelle dont le nom contient une virgule montre ses mesures sans contrôle (vérifié par Guillaume sur la passerelle, le 12 novembre 2026)
- [x] v0.1 (12 novembre 2026, version de test) : la carte d'une `light3` de l'interface complète (version de test, pas de `.tapp` à réinstaller pour cela, sauf pour la luminosité 1-100 % de l'interface légère) montre les onglets Blanc / Couleur (pas l'interface légère) ; l'onglet sélectionné suit le mode réglé depuis l'application Tuya ; la roue de teinte et les curseurs de saturation et de luminosité changent la lampe et la carte suit l'état renvoyé ; en Blanc, le curseur de luminosité correspond à celui de l'application Tuya ; une lampe sans `dp_ct` n'affiche pas de température de couleur; la même carte pour une `light2` (`Entrée-Porche`) : cadran en arc ouvert pour la température de couleur et luminosité de 1 % à 100 % ; une valeur qu'on vient de régler reste affichée jusqu'à ce que l'appareil la signale (plus de clignotement nouvelle / ancienne / nouvelle) ; les options sont masquées tant que la lampe est éteinte ou déconnectée et reviennent à l'allumage (vérifié par Guillaume sur la passerelle, le 12 novembre 2026)
- [ ] v0.1 : vérifier que `TuyaConfig` via l'interface ne fait pas refuser le pilote (seuil de 32 Ko)
- [x] v0.2, configuration Tuya appareil par appareil (18 novembre 2026, firmware du même jour flashé, `.tapp` réinstallée) : les cartes Tuya montrent leurs commandes (variateur, couleur, vitesse...), sous-appareils de la passerelle Tuya compris ; le journal de la passerelle montre des commandes `TuyaConfig <nom>` et aucun `TuyaConfig` seul ; avec moins de 30 Ko libres les commandes sont toujours là (pas de note « mémoire insuffisante »)
- [x] v0.2, robustesse (18 novembre 2026, bugs T2 à T4, `.tapp` réinstallée ; vérifié par Guillaume le même jour : 67 Ko libres au repos, 54 Ko avec l'interface complète ouverte, 13 Ko des 15 Ko du budget) : l'interface s'ouvre comme avant et la mémoire `Status 4`, après `Br tasmota.gc()`, au repos et avec une interface ouverte est inchangée ou plus basse ; la liste des appareils est complète (même nombre que `ZbStatus1`) ; avec une interface ouverte sur un téléphone, couper son Wi-Fi 5 minutes pendant que des appareils envoient des événements : la mémoire ne baisse pas (le flux est fermé dès que 6 Ko attendent), et la page suit de nouveau à son retour ; « Actualiser » ne relance plus `TuyaConfig` (niveau de log 3)
- [x] v0.2, redémarrage de la passerelle avec une page ouverte (18 novembre 2026, bug T1, `.tapp` réinstallée) : ouvrir `/tf` (interface complète et légère), l'utiliser quelques minutes pour que des événements arrivent, puis `Restart 1` depuis la console Tasmota ; le badge passe à « reconnexion… », puis revient à « en direct » ; juste après, un appui sur un bouton Zigbee et un changement Tuya (bouton, Smart Life) apparaissent sur les cartes (et dans l'onglet Événements de l'interface complète) en moins de 2 s, sans recharger la page
- [ ] v0.2, connexion Tuya, erreurs Zigbee (18 novembre 2026, bugs T5, T11, `.tapp` réinstallée) : écran Appareils ouvert, couper un appareil Tuya au mur : sa carte indique « déconnecté » et ses commandes sont grisées en quelques secondes (le pilote remarque la perte), puis de nouveau « connecté » à son retour, sans « Actualiser » (une passerelle Tuya : ses sous-appareils la suivent) ; « Basculer » sur un appareil Zigbee qui ne répond pas, ou « Appairer » quand Zigbee le refuse, affiche la réponse de Tasmota sous la carte ou le bouton (T8, le cache de l'interface légère, est parti avec elle)
- [ ] v0.2, pas d'interface dans la `.tapp`, copie locale (18 novembre 2026, `.tapp` réinstallée à la main, `Restart 1` ; **enregistrement de la copie vérifié par Guillaume le 19 novembre 2026**, reste : hors ligne, suppression, mémoire) : la `.tapp` fait environ 29 Ko ; `/tf` charge l'interface depuis GitHub (Diagnostic : source `github`), et l'écran Diagnostic indique « Aucune copie » ; **Enregistrer une copie locale** : la barre de progression avance, puis « La passerelle a une copie de cette version », `TasmoFlow.tapp.js` (environ 36 Ko) est à côté de `TasmoFlow.tapp`, et le journal montre `TFL: local copy of the interface saved` ; recharger : source `local` ; navigateur hors ligne (ou `gnatali.github.io` bloqué) : `/tf` ouvre toujours toute l'interface (Règles, Événements, Console...) et les appareils répondent ; **Supprimer la copie** : « Aucune copie », le fichier a disparu, et hors ligne `/tf` n'affiche que la ligne « GitHub cannot be reached and this gateway has no local copy » ; mémoire au repos et interface ouverte (après `Br tasmota.gc()`) inchangée (13 Ko interface ouverte le 18 novembre 2026)
- [x] v0.2, mise à jour avec une copie locale (au build de test suivant le point ci-dessus ; vérifié par Guillaume le 19 novembre 2026, mise à jour vers le build T6/T9) : le bandeau propose la mise à jour au-dessus de chaque écran, **Mettre à jour** l'installe sans confirmation et la page revient sur le nouveau build ; l'ancienne copie n'est pas chargée (source `github`), et en quelques secondes Diagnostic indique de nouveau « La passerelle a une copie de cette version » (enregistrée d'elle-même) ; **Plus tard** masque le bandeau
- [x] v0.1 : ce qui reste alloué après la première ouverture (6 Ko de mémoire libre, 4 Ko de Berry) : pas poursuivi, abandonné à la demande de Guillaume (12 novembre 2026)
