# TasmoFlow

**Français** · [English](README.md)

Interface web sans code pour piloter et administrer une passerelle Zigbee Tasmota, et
créer des actions entre appareils. Première cible : la passerelle eWeLink ZB-GW03 avec le
firmware [tasmota32-zbgw03-matter](https://github.com/gnatali/tasmota32-zbgw03-matter).

> **État : prototype v0.0, pas encore testé sur une passerelle réelle.** Il sert à
> vérifier l'architecture avant d'écrire les fonctions. L'interface et le chargeur sont
> testés dans Chromium contre une passerelle simulée ; le code Berry n'a pas encore tourné
> sur un ESP32.

## Ce que fait la v0.0

- Ajoute un bouton **TasmoFlow** au menu principal de Tasmota et une page `/tf`.
- Charge l'interface depuis GitHub Pages (version figée, empreinte SRI), ou depuis la
  copie locale de l'extension si GitHub ne répond pas en 3 s.
- Liste les appareils Zigbee et les met à jour en direct.
- Bascule une lampe, ouvre l'appairage, envoie une commande Tasmota, affiche un
  diagnostic (mémoire, système de fichiers, provenance de l'interface).
- Français et anglais, ordinateur et mobile, thèmes clair et sombre.

Le firmware n'est pas modifié. Le fonctionnement est détaillé dans
[docs/architecture.md](docs/architecture.md).

## Installation sur la passerelle

1. Assembler l'extension (Python 3, sans dépendance) :

   ```sh
   python3 tools/pack_tapp.py
   ```

   La commande produit `dist/TasmoFlow.tapp` et affiche les tailles et les budgets.

2. Dans Tasmota : **Outils → Gestion du système de fichiers**, envoyer
   `dist/TasmoFlow.tapp` (à la racine, ou dans `/.extensions/`).
3. Redémarrer la passerelle, puis ouvrir `http://<adresse de la passerelle>/tf` ou cliquer
   sur **TasmoFlow** dans le menu principal.

L'API écoute sur le port **8384** de la passerelle.

Pour désinstaller : supprimer `TasmoFlow.tapp` et redémarrer.

## Développement sans passerelle

```sh
python3 tools/pack_tapp.py --cdn ''
python3 tools/mock_gateway.py
```

Puis ouvrir <http://localhost:8080/tf>. La fausse passerelle sert la vraie page `/tf`,
extraite de `extension/tasmoflow.be`, et la même API, avec trois appareils fictifs qui
envoient des événements.

## Organisation

| Chemin | Contenu |
| --- | --- |
| `app/app.js` | Interface, sans dépendance ni compilation (référence avant le choix Preact ou Lit) |
| `extension/tasmoflow.be` | Extension Berry : bouton, page `/tf`, API, événements |
| `extension/tf_http.be` | Serveur HTTP asynchrone, copié de Tasmota |
| `extension/autoexec.be`, `manifest.json` | Point d'entrée et description de la `.tapp` |
| `tools/pack_tapp.py` | Assemblage de la `.tapp` et contrôle des budgets de taille |
| `tools/mock_gateway.py` | Fausse passerelle pour le développement |
| `tools/check_syntax.be` | Vérification de la syntaxe Berry |
| `ci/build.yml` | Contrôles, assemblage, release et publication sur GitHub Pages (à placer dans `.github/workflows/` du nouveau dépôt) |

## Feuille de route

| Version | Contenu |
| --- | --- |
| v0.0 | Prototype : architecture vérifiée sur la passerelle |
| v0.1 | Pilotage : plusieurs passerelles, tableau de bord |
| v0.2 | Actions sans code, exécutées sur la passerelle |
| v0.3 | Zigbee avancé (groupes, scènes, bindings) et Matter |
| v0.4 | Administration : OTA, sauvegardes, réseau, console |
| v1.0 | Version stable |

## Publication

À chaque tag `vX.Y.Z` (égal au contenu de `VERSION`), le workflow publie
`TasmoFlow.tapp` dans une release et l'interface sous `https://gnatali.github.io/tasmoflow/vX.Y.Z/`.
Les versions précédentes restent en ligne.

## Licence

GPL v3, comme Tasmota. `extension/tf_http.be` est une copie de `webserver_async.be`
(Stephan Hadinger et Theo Arends, projet Tasmota).
