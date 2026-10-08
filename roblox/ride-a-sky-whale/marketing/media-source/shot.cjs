// Gebruik: node shot.cjs cover.html#cover 1920 1080 uit.png [schaal]
// Rendert op `schaal` x de resolutie; scale.py schaalt daarna terug voor scherpe randen.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const [page_, w, h, out, scale] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(scale || 1) });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + process.cwd() + '/' + page_);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  if (errors.length) console.log('errors:', errors);
  await browser.close();
})();
