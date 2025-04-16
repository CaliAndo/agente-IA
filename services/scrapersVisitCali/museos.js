const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config();

const apiKey = process.env.SCRAPERAPI_KEY;

async function scrapeMuseos() {
  const url = 'https://www.visitcali.travel/museos-y-teatros/';
  const encodedUrl = encodeURIComponent(url);
  const fullUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodedUrl}&render=true&country_code=co`;

  try {
    const res = await fetch(fullUrl);
    const html = await res.text();
    const $ = cheerio.load(html);

    const museos = [];

    $('h2.eael-entry-title a').each((i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      if (title && link) {
        museos.push({ title, link });
      }
    });

    console.log('🏛️ Museos encontrados:\n');
    museos.forEach((item, i) => {
      console.log(`${i + 1}. ${item.title}`);
      console.log(`🔗 ${item.link}\n`);
    });

    fs.writeFileSync('./data/museos.json', JSON.stringify(museos, null, 2));
    console.log('✅ Guardado en ./data/museos.json');

    return museos;
  } catch (err) {
    console.error('❌ Error al hacer scraping:', err.message);
    return [];
  }
}

// 👉 Exportamos para usarlo desde el data collector
module.exports = scrapeMuseos;
