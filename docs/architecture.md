# Architecture de TasmoFlow (v0.0)

Le prototype v0.0 garde le firmware intact : l'interface est une extension Berry
(`.tapp`) qui ouvre un second serveur HTTP sur la passerelle. Le serveur principal de
Tasmota ne permet pas d'ajouter des en-têtes depuis Berry, ce second serveur le permet.

Les constats ci-dessous viennent du code source de Tasmota, branche `development`,
commit `b7994b52c47777ea3f125723f2ba5db6d3669397` (5 novembre 2026). Ils restent à
confirmer sur une vraie ZB-GW03 (voir le [plan de test](#plan-de-test-sur-la-passerelle)).

## Deux serveurs sur la passerelle

| Port | Serveur | Rôle |
| --- | --- | --- |
| 80 | Serveur web de Tasmota | Bouton « TasmoFlow » du menu principal, page `/tf` protégée par le mot de passe web |
| 8384 | `tf_http.be`, serveur asynchrone Berry | API JSON, flux d'événements, copie locale de l'interface ; en-têtes CORS et `Content-Encoding` |

La page `/tf` transmet à l'interface l'adresse de l'API et un jeton de 128 bits, créé au
premier démarrage et gardé dans `persist`. Toutes les routes `/api/*` exigent ce jeton
(paramètre `t`) ; seule `/app.js` est publique.

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
  faut le jeton de B, à copier une fois depuis l'interface de B (prévu en v0.1).
- **Copie locale compressée** : servie avec `Content-Encoding: gzip`, le navigateur la
  décompresse lui-même.
- **Temps réel** : `/api/events` garde la connexion ouverte et pousse chaque message Zigbee
  dès sa réception, sans interrogation régulière.

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

## Plan de test sur la passerelle

À faire sur une ZB-GW03 avec le firmware `tasmota32-zbgw03-matter` pour clore la v0.0.

- [ ] Copier `TasmoFlow.tapp` dans `/.extensions/` (ou `/`) et redémarrer : le journal affiche `TFL: TasmoFlow 0.0.1, API sur le port 8384`
- [ ] Installer à chaud (`tasmota.load("/.extensions/TasmoFlow.tapp")` dans la console Berry) : le bouton et `/tf` répondent sans redémarrage
- [ ] Le bouton « TasmoFlow » apparaît dans le menu principal ; `/tf` demande le mot de passe web s'il est défini
- [ ] Sans accès Internet, `/tf` charge la copie locale (onglet Diagnostic : « local »)
- [ ] `open(tasmota.wd + "app.js.gz", "rb")` lit bien le fichier dans la `.tapp`, et le navigateur décompresse la copie locale
- [ ] La liste des appareils correspond à `ZbStatus1`
- [ ] Un appui sur un bouton Zigbee apparaît dans l'onglet Événements en moins de 2 s
- [ ] « Basculer » allume et éteint une lampe ; « Appairer » ouvre l'appairage 60 s
- [ ] Mémoire : noter `heap_free` avant installation, après démarrage, et après 10 minutes avec l'interface ouverte (cible : moins de 15 Ko consommés)
- [ ] Deux onglets ouverts plus un troisième : la passerelle reste stable, le plus ancien flux est fermé
- [ ] Une interface ouverte sur la passerelle A lit `/api/status` de la passerelle B (jeton de B)
- [ ] Chrome, Firefox, Safari sur iPhone : l'interface se charge et le flux d'événements reste ouvert
- [ ] Matter continue de fonctionner (Google Home commande toujours ses appareils)
