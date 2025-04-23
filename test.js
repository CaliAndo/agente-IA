// 📁 testImperdibles.js
const scrapeImperdibles = require('./services/scrapersVisitCali/imperdibles');

(async () => {
  await scrapeImperdibles();
  conslole.log('Scraping de imperdibles completado.');
})();
