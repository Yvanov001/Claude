# Différentiel — PWA

**Différentiel** est un outil d'aide au diagnostic différentiel par signes et
symptômes (référence clinique). L'application est un document HTML **autonome**
converti en **Progressive Web App** installable et pleinement fonctionnelle
**hors ligne**.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | L'application (HTML/CSS/JS autonome, ~2,3 Mo) + balises PWA et enregistrement du service worker. |
| `manifest.webmanifest` | Manifeste d'application web (nom, couleurs, icônes, `display: standalone`). |
| `sw.js` | Service worker : pré-cache l'app shell, sert hors ligne. |
| `icons/` | Icônes PWA (192/512 « any » + maskable, apple-touch, favicons). |
| `tools/` | Scripts de génération et de test (voir plus bas). |

## Stratégie de cache (service worker)

- **App shell** (`index.html`, manifeste, icônes) : pré-caché à l'installation,
  servi en **cache-first** → démarrage instantané et hors ligne fiable.
- **Navigations** : **network-first** avec repli sur l'`index.html` caché — les
  mises à jour s'appliquent en ligne, l'appli reste disponible hors ligne.
- **Polices Google** (cross-origin, best-effort) : **stale-while-revalidate**,
  jamais bloquant. En l'absence de réseau, l'appli se replie sur les polices
  système (Georgia / Segoe UI / Consolas) : seule l'esthétique change.

### Mise à jour

Incrémentez `CACHE_VERSION` dans `sw.js` à chaque déploiement : l'ancien cache
est purgé à l'activation et la page se recharge automatiquement pour appliquer
la nouvelle version.

## Installabilité

Le manifeste et le service worker remplissent les critères d'installabilité
(nom, icônes 192 + 512, `start_url`, `display: standalone`, service worker avec
gestion du `fetch`). L'appli peut être installée depuis Chrome/Edge (« Installer
l'application ») et iOS Safari (« Sur l'écran d'accueil »).

## Déploiement

Servez le dossier tel quel derrière **HTTPS** (obligatoire pour les service
workers ; `http://localhost` est toléré en développement). Tout hébergeur
statique convient (GitHub Pages, Netlify, un simple serveur de fichiers…).
Aucune étape de build n'est requise.

```bash
# Aperçu local
python3 -m http.server 8080
# puis ouvrir http://localhost:8080/
```

## Outils (dossier `tools/`)

- `generate_icons.py` — régénère les icônes (nécessite `Pillow`).
- `inject_pwa.py` — (ré)injecte les balises PWA + l'enregistrement du service
  worker dans `index.html` (idempotent). L'injection cible la **dernière**
  balise `</body>` : le document contient un `</body></html>` à l'intérieur d'un
  template JS (rapport téléchargeable) qu'il ne faut pas casser.
- `test_pwa.mjs` — test automatisé (Chromium/Playwright) : valide le manifeste,
  l'enregistrement/activation du service worker, la mise en cache, puis coupe le
  réseau et vérifie le **rechargement et l'interactivité hors ligne**.

```bash
node tools/test_pwa.mjs   # 22 contrôles, doit finir « Tous les contrôles PWA sont au vert »
```
