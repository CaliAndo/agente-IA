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

    let museos = [];  // Usamos let en lugar de const, ya que vamos a reasignar la variable

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
      // Verificar si el evento ya existe en la tabla `eventos`
      let evento_id = await getEventoIdByTitulo(item.title); // Cambié const por let aquí

      if (!evento_id) {
        console.log(`⚠️ No se encontró evento_id para el museo: ${item.title}. Insertando nuevo evento...`);
        // Si el evento no existe, insertamos el evento en `eventos`
        const insertEventoQuery = `
          INSERT INTO eventos (nombre)
          VALUES ($1)
          RETURNING id
        `;
        const insertEventoResult = await pool.query(insertEventoQuery, [item.title]);
        evento_id = insertEventoResult.rows[0].id;  // Ahora asignamos evento_id
        console.log(`Nuevo evento insertado con ID: ${evento_id}`);

        // Ahora insertamos el museo en la tabla `museos`
        await insertMuseo(evento_id, item);
        insertados++;
      } else {
        console.log(`➡️ Insertando museo con evento_id: ${evento_id}`);
        await insertMuseo(evento_id, item);
        insertados++;
      }
    }

    console.log(`✅ ${insertados} museos guardados en la base de datos.`);
  } catch (err) {
    console.error('❌ Error en scrapeMuseos:', err.message);
  }
}

// Función para obtener el ID del evento usando el título
async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1'; 
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

// Función para insertar los datos en la tabla `museos`
async function insertMuseo(evento_id, museo) {
  const query = `
    INSERT INTO museos (evento_id, title, link)
    VALUES ($1, $2, $3)
  `;
  await pool.query(query, [evento_id, museo.title, museo.link]);
}

// Test: Ejecutar una vez al inicio
scrapeMuseos().then(() => {
  console.log('Test completado.');
}).catch(err => {
  console.error('Error al ejecutar el test:', err.message);
});

// Programar ejecución automática cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando tarea programada de scrapeMuseos...');
  scrapeMuseos();
});

module.exports = scrapeMuseos;
