const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

// Configuración de PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

// Función para hacer scraping de Civitatis
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
      // Verificar si el evento ya existe en la tabla `eventos`
      const evento_id = await getEventoIdByTitulo(item.title);

      if (!evento_id) {
        console.log(`⚠️ No se encontró evento_id para el imperdible: ${item.title}. Insertando nuevo evento...`);
        // Si el evento no existe, insertamos el evento en `eventos`
        const insertEventoQuery = `
          INSERT INTO eventos (nombre)
          VALUES ($1)
          RETURNING id
        `;
        const insertEventoResult = await pool.query(insertEventoQuery, [item.title]);
        const newEventoId = insertEventoResult.rows[0].id;
        console.log(`Nuevo evento insertado con ID: ${newEventoId}`);

        // Ahora insertamos el imperdible en la tabla `imperdibles`
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

// Función para obtener el ID del evento usando el título
async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1'; 
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

// Función para insertar los datos en la tabla `imperdibles`
async function insertImperdible(evento_id, imperdible) {
  const query = `
    INSERT INTO imperdibles (evento_id, titulo, link)
    VALUES ($1, $2, $3)
  `;
  await pool.query(query, [evento_id, imperdible.title, imperdible.link]);
}

// Test: Ejecutar una vez al inicio
scrapeImperdibles().then(() => {
  console.log('Test completado.');
}).catch(err => {
  console.error('Error al ejecutar el test:', err.message);
});

// Programar ejecución automática cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando tarea programada de scrapeImperdibles...');
  scrapeImperdibles();
});

module.exports = scrapeImperdibles; 