const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService'); // Ajusta si la ruta cambia
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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
      const evento_id = await getEventoIdByTitulo(item.title);

      if (!evento_id) {
        console.log(`➕ Insertando nuevo evento: ${item.title}`);

        const texto = `${item.title}. Más info: ${item.link}`;
        const embedding = await generarEmbedding(texto);

        const insertEventoQuery = `
          INSERT INTO eventos (nombre, embedding)
          VALUES ($1, $2)
          RETURNING id
        `;
        const insertEventoResult = await pool.query(insertEventoQuery, [item.title, embedding]);
        const newEventoId = insertEventoResult.rows[0].id;

        console.log(`🧠 Embedding generado para evento ID: ${newEventoId}`);

        await insertImperdible(newEventoId, item);
        insertados++;
      } else {
        console.log(`➡️ Insertando imperdible con evento_id: ${evento_id}`);
        await insertImperdible(evento_id, item);
        insertados++;
      }
    }

    console.log(`✅ ${insertados} imperdibles guardados en la base de datos.`);
  } catch (err) {
    console.error('❌ Error en scrapeImperdibles:', err.message);
  }
}

asyn
