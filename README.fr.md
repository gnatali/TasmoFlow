# TasmoFlow

**Français** · [English](README.md)

Interface web sans code pour piloter et administrer une passerelle Zigbee Tasmota, ses
appareils Zigbee et Tuya, et créer des actions entre eux. Première cible : la passerelle
eWeLink ZB-GW03 avec le firmware
[tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter).

> **État : prototype v0.0, en test sur une vraie passerelle depuis le 6 novembre 2026.** Il
> sert à vérifier l'architecture avant d'écrire les fonctions. Résultats et vérifications
> restantes : voir le [plan de test](docs/architecture.fr.md#plan-de-test-sur-la-passerelle).

## Ce que fait la v0.0

- Ajoute un bouton **TasmoFlow** au menu principal de Tasmota et une page `/tf`.
- Charge l'interface depuis GitHub Pages (version figée, empreinte SRI), ou depuis la copie
  locale de l'extension si GitHub ne répond pas en 3 s.
- Liste les appareils Zigbee et les met à jour en direct.
- Bascule une lampe, ouvre l'appairage, envoie une commande Tasmota, affiche un diagnostic
  (mémoire, système de fichiers, provenance de l'interface).
- Français et anglais, ordinateur et mobile, thèmes clair et sombre.

Le firmware n'est pas modifié. Fonctionnement : [docs/architecture.fr.md](docs/architecture.fr.md).

## Installation sur la passerelle

1. Assembler l'extension (Python 3, sans dépendance) :

   ```sh
   python3 tools/pack_tapp.py
   ```

   La commande produit `dist/TasmoFlow.tapp` et affiche les tailles et leurs budgets.

2. Dans Tasmota : **Outils → Gestion du système de fichiers**, envoyer `dist/TasmoFlow.tapp`
   (à la racine, ou dans `/.extensions/`).
3. Redémarrer la passerelle, puis ouvrir `http://<adresse de la passerelle>/tf` ou cliquer sur
   **TasmoFlow** dans le menu principal.

L'API écoute sur le port **8384** de la passerelle.

Pour désinstaller : supprimer `TasmoFlow.tapp` et redémarrer.

## Développement sans passerelle

```sh
python3 tools/pack_tapp.py --cdn ''
python3 tools/mock_gateway.py
```

Puis ouvrir <http://localhost:8080/tf>. La fausse passerelle sert la vraie page `/tf`,
extraite de `extension/tasmoflow.be`, et la même API, avec trois appareils fictifs qui envoient
des événements.

Tests de bout en bout (Playwright) : `node tests/e2e.js`. Ils lancent eux-mêmes deux fausses
passerelles et vérifient le chargeur (GitHub, empreinte SRI fausse, GitHub lent, tout absent),
puis un parcours de l'interface.

## Organisation du dépôt

| Chemin | Contenu |
| --- | --- |
| `app/app.js` | Interface, sans dépendance ni compilation (référence avant le choix Preact ou Lit) |
| `extension/tasmoflow.be` | Extension Berry : bouton, page `/tf`, API, événements |
| `extension/tf_http.be` | Serveur HTTP asynchrone, copié de Tasmota |
| `extension/autoexec.be`, `manifest.json` | Point d'entrée et description de la `.tapp` |
| `tools/pack_tapp.py` | Assemblage de la `.tapp` et contrôle des budgets de taille |
| `tools/mock_gateway.py` | Fausse passerelle pour le développement |
| `tools/check_syntax.be` | Vérification de la syntaxe Berry |
| `tests/e2e.js` | Tests de bout en bout dans Chromium, contre la fausse passerelle |
| `.github/workflows/build.yml` | Contrôles, assemblage, release et publication sur GitHub Pages |
| `docs/architecture.fr.md` | Architecture, constats tirés du code de Tasmota, plan de test |

## Feuille de route

TasmoFlow gère trois familles d'appareils : Zigbee, Tuya Zigbee appairé à la passerelle
(TS0601) et Tuya local (Wi-Fi et passerelle Tuya), ce dernier par le pilote Tuya du firmware
(voir [docs/architecture.fr.md](docs/architecture.fr.md#appareils-tuya)).

| Version | Contenu |
| --- | --- |
| v0.0 | Prototype : architecture vérifiée sur la passerelle (en test depuis le 6 novembre 2026) |
| v0.1 | Pilotage : plusieurs passerelles, tableau de bord Zigbee et Tuya, extension sous 15 Ko de RAM |
| v0.2 | Toutes les règles (`Rule1` à `Rule3`, Berry, actions TasmoFlow) : lecture, éditeur en phrases, sauvegarde avant écriture ; déclencheurs et actions Zigbee et Tuya |
| v0.3 | Zigbee et Tuya avancés : groupes, scènes, bindings, découverte et import Tuya, plugins TS0601, Matter |
| v0.4 | Administration : OTA, sauvegardes, réseau, console |
| v1.0 | Version stable |

## Publication

À chaque tag `vX.Y.Z` (égal au contenu de `VERSION`), le workflow publie `TasmoFlow.tapp`
dans une release et l'interface sous `https://gnatali.github.io/TasmoFlow/vX.Y.Z/`. Les
versions précédentes restent en ligne.

Au premier tag, activer GitHub Pages une fois : **Settings → Pages → Build and deployment →
Deploy from a branch**, branche `gh-pages`, dossier `/ (root)`.

## Licence

GPL v3, comme Tasmota. `extension/tf_http.be` est une copie de `webserver_async.be` (Stephan
Hadinger et Theo Arends, projet Tasmota).
