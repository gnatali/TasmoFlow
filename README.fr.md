# TasmoFlow

**Français** · [English](README.md)

Interface web sans code pour piloter et administrer une passerelle Zigbee Tasmota, ses
appareils Zigbee et Tuya, et créer des actions entre eux. Première cible : la passerelle
eWeLink ZB-GW03 avec le firmware
[tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter).

> **État : v0.1 (pilotage) en cours**, au-dessus du prototype v0.0, publié en
> [v0.0.1](https://github.com/gnatali/TasmoFlow/releases/tag/v0.0.1) et vérifié sur une vraie
> passerelle le 9 novembre 2026. Reste à vérifier sur la passerelle :
> [plan de test](docs/architecture.fr.md#plan-de-test-sur-la-passerelle) et
> [suivi](docs/tracking.fr.md).

## Ce que fait la v0.0

- Ajoute un bouton **TasmoFlow** au menu principal de Tasmota et une page `/tf`.
- Charge l'interface depuis la copie locale de la passerelle, si elle en a une pour sa version,
  sinon depuis GitHub Pages (version figée, empreinte SRI). L'extension elle-même ne contient
  plus d'interface (depuis le 18 novembre 2026).
- Liste les appareils Zigbee et les met à jour en direct.
- Bascule une lampe, ouvre l'appairage, envoie une commande Tasmota, affiche un diagnostic
  (mémoire, système de fichiers, provenance de l'interface).
- Français et anglais, ordinateur et mobile, thèmes clair et sombre.

## Ce qu'ajoute la v0.1 (en cours)

- Interface reconstruite sur Preact + htm, compilée avec esbuild en un seul paquet (environ 36 Ko
  gzip, GitHub Pages). La `.tapp` ne contient pas d'interface : environ 29 Ko (83 Ko en v0.2.0).
  Pour une passerelle sans accès à internet, l'écran Diagnostic y enregistre une **copie
  locale** de l'interface (environ 36 Ko de son système de fichiers), chargée en premier ensuite.
- Le serveur d'API du port 8384 ne tourne que pendant qu'une interface est ouverte (la RAM est
  la ressource critique).
- Écran **Passerelles** : utiliser plusieurs passerelles depuis une seule interface (copier le
  lien d'une passerelle, le coller dans l'écran d'une autre).
- Appareils Tuya locaux à côté des appareils Zigbee, par le pilote Tuya du firmware :
  interrupteurs, variateurs, température de couleur, vitesse de ventilateur, mesures, mise à
  jour en direct ; masqués si le pilote est absent ou désactivé.

Le firmware n'est pas modifié. Fonctionnement : [docs/architecture.fr.md](docs/architecture.fr.md).

## Installation sur la passerelle

1. Assembler l'extension (Node 22 et Python 3), ou prendre `TasmoFlow.tapp` dans une release :

   ```sh
   npm ci
   npm run build
   python3 tools/pack_tapp.py
   ```

   `npm run build` assemble l'interface (`app/src/`) en `dist/app.js` (pour GitHub Pages).
   `pack_tapp.py` produit `dist/TasmoFlow.tapp`, avec les fichiers Berry d'`extension/` minifiés
   (sans commentaires), et `dist/pages/` (ce que publie GitHub Pages : `app.js`, `app.js.gz` pour
   la copie locale, la `.tapp` et le manifeste de mise à jour), et affiche les tailles et leurs
   budgets (un build de test, `--dev` plus bas, est minifié lui aussi mais sans budget de taille).

2. Dans Tasmota : **Outils → Gestion du système de fichiers**, envoyer `dist/TasmoFlow.tapp`
   (à la racine, ou dans `/.extensions/`).
3. Redémarrer la passerelle, puis ouvrir `http://<adresse de la passerelle>/tf` ou cliquer sur
   **TasmoFlow** dans le menu principal.

L'API écoute sur le port **8384** de la passerelle, seulement pendant qu'une interface est
ouverte : ouvrir `/tf` la démarre, et elle s'arrête après 5 minutes sans client.

Pour désinstaller : supprimer `TasmoFlow.tapp` (et `TasmoFlow.tapp.js`, la copie locale, s'il y en
a une) et redémarrer.

### Sans accès à internet : la copie locale

La page `/tf` charge l'interface depuis GitHub Pages : le navigateur a donc besoin d'un accès à
internet. Pour une passerelle utilisée sans, ouvrir une fois (avec internet) **Diagnostic → Copie
locale de l'interface → Enregistrer une copie locale** : l'interface de la version installée
(`app.js.gz`, environ 36 Ko) est enregistrée à côté de la `.tapp` sous `TasmoFlow.tapp.js`, après
que la passerelle a contrôlé son SHA-256 avec celui écrit dans sa `.tapp`. Ensuite `/tf` la charge
en premier, avec ou sans internet. Après une mise à jour, la copie est celle de l'ancienne
version : la page charge GitHub et enregistre d'elle-même celle de la nouvelle. **Supprimer la
copie** revient à GitHub seul. Sans l'un ni l'autre (ni internet ni copie), `/tf` n'affiche qu'un
message : les pages et la console de Tasmota fonctionnent toujours.

### Mise à jour

Quand une version plus récente est publiée, l'interface affiche un bandeau avec un bouton
**Mettre à jour** (**Plus tard** le masque pour cette visite). Le bouton télécharge la nouvelle `TasmoFlow.tapp` sur
GitHub Pages, l'envoie à la passerelle, qui contrôle sa taille et son SHA-256 et l'installe (la
précédente est gardée sous `TasmoFlow.tapp.bak` à côté), puis redémarre : la page attend (2 minutes
au plus, puis elle renvoie à l'accueil de Tasmota) et se recharge sur la nouvelle version. Un build
de test cherche le dernier build de test (un commit différent compte comme une mise à jour). La
première mise à jour vers une version qui a cette fonction se fait à la main, comme ci-dessus.

## Développement sans passerelle

```sh
npm ci
npm run build
python3 tools/mock_gateway.py --full
```

Puis ouvrir <http://localhost:8080/tf> (sans `--full`, rien n'est trouvé tant qu'aucune copie
locale n'est enregistrée, comme quand GitHub est inaccessible). La fausse passerelle sert la vraie page `/tf`,
extraite de `extension/tasmoflow.be`, et la même API, avec trois appareils Zigbee fictifs qui
envoient des événements et quatre appareils Tuya fictifs qui répondent comme le pilote du
firmware (`--no-tuya` : une passerelle sans le pilote).

Tests de bout en bout (Playwright) : `node tests/e2e.js` (compile d'abord l'interface et la
`.tapp`). Ils lancent eux-mêmes de fausses passerelles et vérifient le chargeur (copie locale,
GitHub, empreinte SRI fausse, GitHub lent, tout absent), la copie locale, la mise à jour, un parcours de l'interface, les appareils
Tuya et l'écran Passerelles.

## Organisation du dépôt

| Chemin | Contenu |
| --- | --- |
| `app/src/` | Interface (Preact + htm), assemblée par `tools/build_app.js` en `dist/app.js` (`main.js`) |
| `package.json` | Dépendances de l'interface (`preact`, `htm`) et de sa compilation (`esbuild`) |
| `extension/tasmoflow.be` | Extension Berry : bouton, page `/tf`, API, événements |
| `extension/tf_http.be` | Serveur HTTP asynchrone, copié de Tasmota |
| `extension/autoexec.be`, `manifest.json` | Point d'entrée et description de la `.tapp` |
| `tools/build_app.js` | Assemble l'interface (`npm run build`) |
| `tools/pack_tapp.py` | Assemblage de la `.tapp` et contrôle des budgets de taille |
| `tools/mock_gateway.py` | Fausse passerelle pour le développement |
| `tools/check_syntax.be` | Vérification de la syntaxe Berry |
| `tests/e2e.js` | Tests de bout en bout dans Chromium, contre la fausse passerelle |
| `.github/workflows/build.yml` | Contrôles, assemblage, release et publication sur GitHub Pages |
| `docs/architecture.fr.md` | Architecture, constats tirés du code de Tasmota, plan de test |
| `docs/tracking.fr.md` | Avancement, mesures, décisions ouvertes et prochaines étapes |
| `CLAUDE.md`, `.claude/rules/` | Instructions pour Claude Code |

## Feuille de route

TasmoFlow gère trois familles d'appareils : Zigbee, Tuya Zigbee appairé à la passerelle
(TS0601) et Tuya local (Wi-Fi et passerelle Tuya), ce dernier par le pilote Tuya du firmware
(voir [docs/architecture.fr.md](docs/architecture.fr.md#appareils-tuya)).

| Version | Contenu |
| --- | --- |
| v0.0 | Prototype : architecture vérifiée sur la passerelle (terminé, v0.0.1, 9 novembre 2026) |
| v0.1 | Pilotage : plusieurs passerelles, tableau de bord Zigbee et Tuya, extension sous 15 Ko de RAM |
| v0.2 | Toutes les règles (`Rule1` à `Rule3`, Berry, actions TasmoFlow) : lecture, éditeur en phrases, sauvegarde avant écriture ; déclencheurs et actions Zigbee et Tuya |
| v0.3 | Zigbee et Tuya avancés : groupes, scènes, bindings, découverte et import Tuya, plugins TS0601, Matter |
| v0.4 | Administration : OTA, sauvegardes, réseau, console |
| v1.0 | Version stable |

## Publication

À chaque tag `vX.Y.Z`, le workflow publie `TasmoFlow.tapp`
dans une release et l'interface sous `https://gnatali.github.io/TasmoFlow/vX.Y.Z/`. Les
versions précédentes restent en ligne.

Le tag **est** la version : il n'y a pas de fichier de version à modifier. Le build la lit dans le tag
(`tools/version.py`), donc la `.tapp`, l'interface et `latest.json` portent toujours la version du tag.
Les builds qui ne sont pas un tag (pull request, `main`, local) portent la version du dernier tag, ou `0.0.0`
si le clone n'a aucun tag (`TF_VERSION=X.Y.Z` en impose une).

Créer le tag soit avec git (`git tag vX.Y.Z origin/main && git push origin vX.Y.Z` : le
workflow crée la release), soit sur github.com par **Releases → Draft a new release → Choose a
tag → Create new tag** sur `main`, puis **Publish release** (le workflow joint `TasmoFlow.tapp`
à cette release). GitHub n'a pas d'écran pour créer un tag sans release.

Chaque tag publie aussi `latest.json` (version, taille, SHA-256) et une copie de `TasmoFlow.tapp`
sur GitHub Pages : c'est ce que lit le bouton de mise à jour. Les builds de test publient `dev/latest.json` de la même façon.

Au premier tag, activer GitHub Pages une fois : **Settings → Pages → Build and deployment →
Deploy from a branch**, branche `gh-pages`, dossier `/ (root)`.

### Version de test (sans release ni tag)

Pour essayer une modification sur la passerelle sans release : **Actions → Build → Run
workflow**, sur la branche à essayer. Une fois les tests passés, le workflow publie l'interface
sur `https://gnatali.github.io/TasmoFlow/dev/app.js` (remplacée à chaque lancement ;
l'en-tête affiche le build, par exemple `dev.1a2b3c4`) et une extension de test sur
`https://gnatali.github.io/TasmoFlow/dev/TasmoFlow.tapp`.

Installer cette `.tapp` une fois (elle remplace `TasmoFlow.tapp`, puis `Restart 1`). Elle charge
l'interface `dev/` à chaque ouverture, sans épinglage SRI ni cache : un nouveau lancement
suffit, il reste à recharger la page. Ne réinstaller la `.tapp` que si `extension/` a changé
(je le signale). Une passerelle avec une copie locale continue de l'utiliser : supprimer la copie
(Diagnostic) pour voir l'interface d'un nouveau lancement. À réserver aux essais : la `.tapp` des releases
reste épinglée à sa version et à son empreinte.

## Licence

GPL v3, comme Tasmota. `extension/tf_http.be` est une copie de `webserver_async.be` (Stephan
Hadinger et Theo Arends, projet Tasmota).
