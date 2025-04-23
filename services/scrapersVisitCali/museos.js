const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// Configuración PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

// URL fuente
const pageUrl = 'https://www.visitcali.travel/museos-y-teatros/';

async function scrapeMuseos() {
  const apiKey = process.env.SCRAPERAPI_KEY;
  const encodedUrl = encodeURIComponent(pageUrl);
  const fullUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodedUrl}&render=true&country_code=co`;

  console.log(`🌐 Haciendo fetch a: ${fullUrl}`);

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

    console.log(`🏛️ Se encontraron ${museos.length} museos.`);

    let insertados = 0;
    for (const item of museos) {
      const query = `
        INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, categoria, fuente)
        VALUES ($1, '', null, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `;
      await pool.query(query, [item.title, item.link, 'museo', pageUrl]);
      insertados++;
    }

    console.log(`✅ ${insertados} museos insertados en la base de datos con fuente incluida.`);
  } catch (err) {
    console.error('❌ Error en scrapeMuseos:', err.message);
  }
}

// Ejecutar inmediatamente
scrapeMuseos();

// Programar cada 24h (medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando scrapeMuseos programado...');
  scrapeMuseos();
});
