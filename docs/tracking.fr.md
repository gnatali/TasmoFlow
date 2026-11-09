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
- **[PR #1](https://github.com/gnatali/TasmoFlow/pull/1) ouverte** (branche
  `claude/tasmota-web-interface-dumj56`) : résultats des tests du 9 novembre, mémoire après
  `tasmota.gc()`, v0.0 marquée terminée, ces fichiers de suivi et les modules `.claude/rules/`.
  À fusionner avant de commencer la v0.1 (`main` n'accepte que des pull requests).
- **Suite** : v0.1 (pilotage), en commençant par le choix entre Preact et Lit.

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

## Mesures sur la passerelle

Après `tasmota.gc()`, passerelle avec le pilote Tuya (9 novembre 2026) :

| Moment | Mémoire libre | `HeapUsed` de Berry | Coût de TasmoFlow |
| --- | --- | --- | --- |
| Avant installation | 84 Ko | 25 Ko | |
| Extension chargée | 67 Ko | 47 Ko | 17 Ko |
| Interface ouverte | 65 Ko | 48 Ko | 19 Ko |

Cible : 15 Ko. Tailles : `TasmoFlow.tapp` 45 Ko (budget 150 Ko), `app.js.gz` 5,4 Ko (budget
120 Ko).

## Décisions encore ouvertes

- **Preact ou Lit** pour l'interface : écrire le même écran avec les deux, comparer la taille
  compressée, puis décider avec Guillaume.
- **Catalogue de l'Extension Manager** : soumettre TasmoFlow au catalogue officiel de Tasmota,
  ou en publier un sur `gnatali.github.io/extensions/` (exige un `OtaUrl` sur cet hôte), ou
  garder l'installation manuelle.

## Prochaines étapes (v0.1, par priorité)

1. **Preact ou Lit** (voir ci-dessus).
2. **Mémoire sous 15 Ko** : ne démarrer le serveur du port 8384 que pendant qu'une interface
   est ouverte (première requête sur `/tf`), l'arrêter après quelques minutes sans client ;
   retirer le code inutilisé de `tf_http.be`. Remesurer après `tasmota.gc()`.
3. **Appareils Tuya dans le tableau de bord** (F7.1 à F7.3) : `TuyaEnable`, `TuyaStatus`,
   événements de la règle `Tuya` poussés dans le flux SSE (`tasmota.add_rule("Tuya", ...)`),
   commandes déduites des liaisons Matter de `TuyaConfig`, `TuyaSend` (y compris `toggle`).
   Masquer les écrans Tuya quand le pilote est absent ou désactivé.
4. **Plusieurs passerelles** (F1) : liste gardée dans le navigateur, écran pour copier le jeton
   d'une passerelle, vérifier que la passerelle A lit l'API de la passerelle B (dernier point
   ouvert du plan de test).
5. Ensuite la v0.2 : toutes les règles (`Rule1` à `Rule3`, Berry, actions), éditeur en phrases,
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
