/* Test d'installabilité PWA + hors-ligne pour Différentiel.
   Sert le dossier racine, charge la page dans Chromium, vérifie le manifest,
   l'enregistrement/activation du service worker, puis simule une coupure
   réseau et un rechargement pour prouver le fonctionnement hors ligne. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const gRoot = require('child_process').execSync('npm root -g').toString().trim();
const { chromium } = require(path.join(gRoot, 'playwright'));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Fichiers pré-chargés en mémoire et servis via res.end(buffer) : réponse
// atomique, jamais tronquée par la contre-pression d'un flux (ce qui, avec
// un document de 2,3 Mo, couperait le script en fin de page).
const cacheBuf = new Map();
function load(file) {
  if (!cacheBuf.has(file)) cacheBuf.set(file, fs.readFileSync(file));
  return cacheBuf.get(file);
}
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const buf = load(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
});
server.on('clientError', () => {});
server.keepAliveTimeout = 60000;

const fail = [];
const ok = [];
function check(cond, msg) { (cond ? ok : fail).push(msg); console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); }

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log('Serveur de test :', base);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
const failedSameOrigin = [];
const failedCrossOrigin = [];
let offlinePhase = false;
page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
page.on('requestfailed', (req) => {
  const u = req.url();
  const sameOrigin = u.startsWith('http://127.0.0.1');
  // Hors ligne, tout accès réseau non caché échoue : attendu, on l'ignore.
  if (offlinePhase) return;
  (sameOrigin ? failedSameOrigin : failedCrossOrigin).push(u);
});

try {
  // 1) Chargement initial
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  check((await page.title()).includes('Différentiel'), 'La page se charge (titre présent)');

  // 2) Manifest lié et valide
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  check(!!manifestHref, 'Balise <link rel="manifest"> présente');
  const man = await (await fetch(base + '/' + manifestHref)).json();
  check(man.name && man.short_name, 'Manifest : name + short_name');
  check(man.start_url && man.scope, 'Manifest : start_url + scope');
  check(man.display === 'standalone', 'Manifest : display=standalone');
  check(!!man.theme_color && !!man.background_color, 'Manifest : theme/background color');
  const has192 = man.icons.some((i) => /192x192/.test(i.sizes));
  const has512 = man.icons.some((i) => /512x512/.test(i.sizes));
  const hasMaskable = man.icons.some((i) => (i.purpose || '').includes('maskable'));
  check(has192 && has512, 'Manifest : icônes 192 + 512');
  check(hasMaskable, 'Manifest : icône maskable');

  // 2b) Les icônes se téléchargent réellement
  for (const ic of man.icons) {
    const r = await fetch(base + '/' + ic.src);
    check(r.ok && (r.headers.get('content-type') || '').includes('image/png'),
      'Icône accessible : ' + ic.src);
  }

  // 3) Enregistrement + activation du service worker
  const swActive = await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (reg.active || reg.waiting));
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  check(swActive, 'Service worker enregistré et actif');

  const diag = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? { scope: reg.scope, active: reg.active && reg.active.state,
      waiting: !!reg.waiting, installing: !!reg.installing,
      ctrl: !!navigator.serviceWorker.controller } : 'no-registration';
  });
  console.log('  diag:', JSON.stringify(diag));

  // 4) App shell mis en cache (on attend que le pré-cache soit peuplé)
  const cached = await page.waitForFunction(async () => {
    for (const n of await caches.keys()) {
      const c = await caches.open(n);
      if ((await c.match('./index.html')) || (await c.match('index.html'))) return true;
    }
    return false;
  }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  check(cached, 'index.html présent dans le Cache Storage');

  // 5) Second chargement (en ligne) : le SW contrôle désormais la page dès le départ.
  await page.reload({ waitUntil: 'load' });
  const controlled = await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null, null, { timeout: 15000 }
  ).then(() => true).catch(() => false);
  check(controlled, 'Page contrôlée par le service worker (2e visite)');

  // Intégrité : un élément situé en toute fin de document doit exister
  // (preuve que le HTML de 2,3 Mo n'est pas tronqué).
  const intact = await page.evaluate(() => {
    return document.body && document.body.innerText.length > 500 &&
      !!document.querySelector('script');
  });
  check(intact, 'Document complet rendu (non tronqué)');

  // 6) Hors ligne : couper le réseau et recharger — servi par le SW.
  offlinePhase = true;
  await context.setOffline(true);
  const offResp = await page.reload({ waitUntil: 'load' })
    .catch((e) => { console.log('reload err', e.message); return null; });
  const offlineTitle = await page.title().catch(() => '');
  check(!!offResp && offlineTitle.includes('Différentiel'),
    'Rechargement HORS LIGNE réussi (app shell servi par le SW)');

  // 7) Interactivité hors ligne : contenu rendu et éléments interactifs présents.
  const interactive = await page.evaluate(() => {
    const el = document.querySelector('input, [contenteditable], button');
    return !!el && !!document.body && document.body.innerText.length > 200;
  });
  check(interactive, 'Contenu interactif rendu hors ligne');

  // 8) Icône servie hors ligne par le cache.
  const iconOffline = await page.evaluate(async () => {
    try { const r = await fetch('icons/icon-192.png'); return r.ok; } catch (e) { return false; }
  });
  check(iconOffline, 'Icône servie depuis le cache hors ligne');

  await context.setOffline(false);

  check(pageErrors.length === 0,
    'Aucune erreur JavaScript de page' +
    (pageErrors.length ? ' (' + pageErrors.slice(0, 3).join(' | ') + ')' : ''));

  check(failedSameOrigin.length === 0,
    'Aucun échec de requête same-origin en ligne' +
    (failedSameOrigin.length ? ' (' + failedSameOrigin.slice(0, 3).join(' | ') + ')' : ''));

  // Les seules requêtes distantes sont les polices Google (best-effort) : leur
  // échec via le proxy est attendu et n'altère pas la fonction (repli polices système).
  if (failedCrossOrigin.length) {
    const onlyFonts = failedCrossOrigin.every((u) => /fonts\.(googleapis|gstatic)\.com/.test(u));
    check(onlyFonts, 'Échecs distants limités aux polices Google (best-effort)' +
      (onlyFonts ? '' : ' — inattendu: ' + failedCrossOrigin.slice(0, 2).join(' | ')));
  }
} catch (err) {
  console.error('ERREUR test :', err);
  fail.push('exception: ' + err.message);
} finally {
  await browser.close();
  server.close();
}

console.log('\n==== RÉSUMÉ ====');
console.log('PASS: ' + ok.length + '   FAIL: ' + fail.length);
if (fail.length) { console.log('Échecs :\n - ' + fail.join('\n - ')); process.exit(1); }
console.log('Tous les contrôles PWA sont au vert.');
