// Capture d'écran de routes connectées (compte de démo). Usage : node scripts/snap.mjs <route>... (sortie : ./.snaps/)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: process.env.DARK ? 'dark' : 'light' });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push(String(e)));
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto('http://localhost:3000/login', { waitUntil: 'networkidle', timeout: 90000 });
await p.fill('#email', 'demo@agence-os.dev'); await p.fill('#password', 'Demo-agence-2026!');
await p.click('button[type=submit], .btn-primary');
await p.waitForURL(/\/w\//, { timeout: 90000 });
for (const r of process.argv.slice(2)) {
  await p.goto('http://localhost:3000/w/studio-demo' + (r === 'home' ? '' : '/' + r), { waitUntil: 'networkidle', timeout: 120000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `.snaps/app-${r.replace(/[\/?=&]/g, '_') || 'home'}.png` });
}
console.log(errors.length ? 'ERREURS:\n' + [...new Set(errors)].slice(0, 15).join('\n') : 'aucune erreur console');
await b.close();
