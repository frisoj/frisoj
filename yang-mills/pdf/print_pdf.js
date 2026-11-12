// Print an HTML file to an A4 PDF with page numbers (Chromium via Playwright).
// Usage: node print_pdf.js <input.html> <output.pdf>
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node print_pdf.js <input.html> <output.pdf>');
    process.exit(2);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(input), { waitUntil: 'load' });
  // every image must have loaded: a missing figure is an error, not a blank box
  const broken = await page.evaluate(() =>
    Array.from(document.images).filter(i => !(i.complete && i.naturalWidth > 0)).map(i => i.src));
  if (broken.length) {
    console.error('images that did not load:\n  ' + broken.join('\n  '));
    await browser.close();
    process.exit(1);
  }
  await page.evaluate(() => document.fonts.ready);
  const footer =
    '<div style="font-family: Inter, DejaVu Sans, sans-serif; font-size: 9.5px; color: #5a626e; ' +
    'width: 100%; padding: 0 15mm; display: flex; justify-content: space-between;">' +
    '<span>Yang–Mills en de massakloof · numeriek bewijsmateriaal, geen bewijs</span>' +
    '<span>pagina <span class="pageNumber"></span> van <span class="totalPages"></span></span></div>';
  await page.pdf({
    path: output, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<div></div>', footerTemplate: footer,
    outline: true, tagged: true,   // bookmarks for the sections; tagged pdf with the document language
    margin: { top: '15mm', bottom: '17mm', left: '15mm', right: '15mm' },
  });
  await browser.close();
  console.log('wrote ' + output);
})().catch(e => { console.error(e); process.exit(1); });
