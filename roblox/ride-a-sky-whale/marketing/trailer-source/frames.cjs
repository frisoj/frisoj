const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + process.cwd() + '/trailer.html');
  await page.evaluate(() => document.fonts.ready);
  const FPS = 30, TOTAL = 30 * FPS;
  const start = Date.now();
  for (let i = 0; i < TOTAL; i++) {
    await page.evaluate(t => window.render(t), i / FPS);
    await page.screenshot({ path: `frames/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  console.log('frames done in', ((Date.now() - start) / 1000).toFixed(0), 's; errors:', errors);
  await browser.close();
})();
