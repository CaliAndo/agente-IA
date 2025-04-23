const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// PostgreSQL config
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

async function scrapeImperdibles() {
  const apiKey = process.env.SCRAPERAPI_KEY;
  const url = 'https://www.visitcali.travel/imperdibles-de-cali/';
  const encodedUrl = encodeURIComponent(url);
  const fullUrl = `https://api.scraperapi.com/?api_key=${apiKey}&url=${encodedUrl}&render=true&country_code=co`;

  console.log(`🌐 Haciendo fetch a: ${fullUrl}`);

  try {
    const res = await fetch(fullUrl);
    console.log(`✅ Fetch completado con status: ${res.status}`);
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

    console.log(`🔍 Se encontraron ${imperdibles.length} imperdibles.`);

    let insertados = 0;
    for (const item of imperdibles) {
      const query = `
        INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, categoria)
        VALUES ($1, '', null, $2, $3)
        ON CONFLICT DO NOTHING
      `;
      await pool.query(query, [item.title, item.link, 'imperdible',pageUrl]);
      insertados++;
    }

    console.log(`✅ ${insertados} eventos imperdibles insertados en la base de datos.`);
  } catch (err) {
    console.error('❌ Error en scrapeImperdibles:', err.message);
  }
}

// ✅ Ejecutar una vez al inicio
scrapeImperdibles();

// 🔁 Ejecutar automáticamente cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando tarea programada de scrapeImperdibles...');
  scrapeImperdibles();
});
