// Rendert alle winkelplaatjes op 2x en schaalt ze terug naar 512x512 (marketing/items/*.png).
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + __dirname + '/items.html');
  const keys = await page.evaluate(() => window.ITEM_KEYS);
  fs.mkdirSync(__dirname + '/../items', { recursive: true });
  for (const key of keys) {
    await page.goto('file://' + __dirname + '/items.html#' + key);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    const tmp = `/tmp/item-${key}.png`;
    await page.screenshot({ path: tmp });
    execFileSync('python3', [__dirname + '/scale.py', tmp, `${__dirname}/../items/${key}.png`, '512', '512']);
  }
  console.log(keys.length, 'plaatjes; fouten:', errors);
  await browser.close();
})();
