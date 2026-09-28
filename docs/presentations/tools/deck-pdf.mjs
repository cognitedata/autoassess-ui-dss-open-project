import { chromium } from 'playwright-core';
const [src, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: 'light' });
await page.goto('file://' + src, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: `
  html, body { height: auto !important; padding: 0 !important; margin: 0 !important; background: #fff !important; }
  :root { padding: 0 !important; }
  .deck { display: block !important; max-width: none !important; padding: 0 !important; height: auto !important; }
  .stage { aspect-ratio: auto !important; container-type: normal !important; }
  .controls, .notes-panel { display: none !important; }
  .slide { --u: 12.8px; position: relative !important; inset: auto !important; display: flex !important;
           width: 1280px; height: 720px; border-radius: 0 !important; box-shadow: none !important;
           break-after: page; animation: none !important; }
  .slide:last-child { break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);
await page.pdf({ path: out, width: '1280px', height: '720px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log('wrote', out);
