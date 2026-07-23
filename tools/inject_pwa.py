#!/usr/bin/env python3
"""Injecte les balises PWA dans index.html (idempotent)."""
import io, os, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
PATH = os.path.join(ROOT, "index.html")

HEAD_TAGS = """
<!-- ===== PWA ===== -->
<meta name="description" content="Aide au diagnostic différentiel par signes et symptômes. Référence clinique fonctionnant hors ligne.">
<meta name="theme-color" content="#8B3A3A" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#8B3A3A" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="icons/favicon-16.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Différentiel">
<meta name="application-name" content="Différentiel">
<!-- ===== /PWA ===== -->
"""

SW_SNIPPET = """
<!-- ===== PWA : enregistrement du service worker ===== -->
<script>
(function () {
  if (!('serviceWorker' in navigator)) return;

  // Y a-t-il déjà un contrôleur ? Si oui, un changement de contrôleur
  // signifiera une MISE À JOUR (nouveau SW) → on recharge pour l'appliquer.
  // Sinon (première visite, prise de contrôle initiale via clients.claim),
  // on NE recharge PAS : cela éviterait un rechargement inutile au 1er chargement.
  var hadController = !!navigator.serviceWorker.controller;
  var refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Enregistrement immédiat (ce script est en fin de <body>, le DOM est prêt).
  // On ne défère PAS à window.load : sur ce document volumineux, un éventuel
  // @import de polices distant peut retarder l'évènement load, ce qui
  // retarderait inutilement la mise en cache hors ligne.
  navigator.serviceWorker.register('sw.js', { scope: './' })
    .catch(function (err) {
      console.warn('Service worker non enregistré :', err);
    });
})();
</script>
<!-- ===== /PWA ===== -->
"""

MARK_HEAD = "<!-- ===== PWA ===== -->"
MARK_SW = "<!-- ===== PWA : enregistrement du service worker ===== -->"

with io.open(PATH, "r", encoding="utf-8") as f:
    html = f.read()

changed = False

if MARK_HEAD not in html:
    anchor = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
    if anchor not in html:
        print("ERREUR : balise viewport introuvable", file=sys.stderr); sys.exit(1)
    html = html.replace(anchor, anchor + "\n" + HEAD_TAGS.strip() + "\n", 1)
    changed = True
    print("head PWA injecté")
else:
    print("head PWA déjà présent")

if MARK_SW not in html:
    # ATTENTION : le document contient un template literal (rapport HTML
    # téléchargeable) qui inclut un "</body></html>" AVANT la vraie balise de
    # fermeture. On injecte donc avant la DERNIÈRE occurrence de </body>, sinon
    # on casserait cette chaîne JS ("Unexpected end of input").
    idx = html.rfind("</body>")
    if idx == -1:
        print("ERREUR : </body> introuvable", file=sys.stderr); sys.exit(1)
    html = html[:idx] + SW_SNIPPET.strip() + "\n" + html[idx:]
    changed = True
    print("enregistrement SW injecté (avant la dernière balise </body>)")
else:
    print("enregistrement SW déjà présent")

if changed:
    with io.open(PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print("index.html mis à jour")
else:
    print("aucune modification")
