const fetch = require('node-fetch');
const cheerio = require('cheerio');
require('dotenv').config();

async function scrapeImperdibles() {
  const apiKey = process.env.SCRAPERAPI_KEY;
  const url = 'https://www.visitcali.travel/imperdibles-de-cali/';
  const encodedUrl = encodeURIComponent(url);
  const fullUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodedUrl}&render=true&country_code=co`;

  try {
    const res = await fetch(fullUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    const imperdibles = [];

    $('h2.eael-entry-title a').each((i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      if (title && link) {
        imperdibles.push({ title, link });
      }
    });

    return imperdibles;
  } catch (err) {
    console.error('❌ Error en scrapeImperdibles:', err.message);
    return [];
  }
}

module.exports = scrapeImperdibles;