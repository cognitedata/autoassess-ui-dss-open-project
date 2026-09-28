import { chromium } from 'playwright-core';
import fs from 'node:fs';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1160, height: 800 } });
for (const f of process.argv.slice(2)) {
  await p.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@112,700&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Mono&display=swap"><body style="margin:0;background:#f2f4f3">${fs.readFileSync(f, 'utf8')}</body>`, { waitUntil: 'networkidle' });
  await p.locator('svg').screenshot({ path: f.replace('.svg', '.png') });
}
await b.close();
