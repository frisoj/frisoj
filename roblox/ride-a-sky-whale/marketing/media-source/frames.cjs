// node frames.cjs                 -> alle beelden (FPS hieronder) in frames/
// node frames.cjs preview 1 5.5 9 -> losse voorbeeldbeelden in preview/
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const FPS = +(process.env.FPS || 60), DUR = 30;
(async () => {
  const preview = process.argv[2] === 'preview';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +(process.env.SCALE || 1) });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + process.cwd() + '/trailer.html');
  await page.evaluate(() => document.fonts.ready);
  const dir = process.env.OUT || (preview ? 'preview' : 'frames');
  fs.mkdirSync(dir, { recursive: true });
  // START/END (beeldnummers) verdelen het werk over meerdere processen; bestaande beelden worden overgeslagen
  const first = +(process.env.START || 0), last = +(process.env.END || FPS * DUR);
  const idx = preview ? process.argv.slice(3).map(Number) : [...Array(last - first).keys()].map(i => i + first);
  const times = preview ? idx : idx.map(i => i / FPS);
  const start = Date.now();
  for (let i = 0; i < times.length; i++) {
    const name = preview ? `${dir}/t${times[i].toFixed(2)}.png` : `${dir}/f${String(idx[i]).padStart(5, '0')}.png`;
    if (!preview && fs.existsSync(name)) continue;
    await page.evaluate(t => window.render(t), times[i]);
    await page.screenshot({ path: name });
    if (!preview && i % 300 === 0) console.log('frame', i, ((Date.now() - start) / 1000).toFixed(0) + 's');
  }
  console.log('klaar in', ((Date.now() - start) / 1000).toFixed(1), 's; fouten:', errors);
  await browser.close();
})();
