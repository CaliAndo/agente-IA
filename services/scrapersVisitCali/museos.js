const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService'); // Ajusta si cambia la ruta
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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
      let evento_id = await getEventoIdByTitulo(item.title);

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
        evento_id = insertEventoResult.rows[0].id;

        console.log(`🧠 Embedding generado para evento ID: ${evento_id}`);
        await insertMuseo(evento_id, item);
        insertados++;
      } else {
        console.log(`➡️ Insertando museo vinculado a evento existente: ${evento_id}`);
        await insertMuseo(evento_id, item);
        insertados++;
      }
    }

    console.log(`✅ ${insertados} museos guardados en la base de datos.`);
  } catch (err) {
    console.error('❌ Error en scrapeMuseos:', err.message);
  }
}

async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1';
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

async function insertMuseo(evento_id, museo) {
  const query = `
    INSERT INTO museos (evento_id, title, link)
    VALUES ($1, $2, $3)
  `;
  await pool.query(query, [evento_id, museo.title, museo.link]);
}

// Ejecución inicial
scrapeMuseos()
  .then(() => console.log('🧪 Test completado.'))
  .catch(err => console.error('Error al ejecutar el test:', err.message));

// Programación diaria
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando tarea programada de scrapeMuseos...');
  scrapeMuseos();
});

module.exports = scrapeMuseos;
