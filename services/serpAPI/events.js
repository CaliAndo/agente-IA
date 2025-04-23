require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');

// Configuración PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

const apiKey = process.env.SERPAPI_KEY;
const fuente = 'https://serpapi.com';

async function fetchAndSaveEventos() {
  try {
    console.log('🔎 Consultando eventos desde SerpAPI...');

    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_events',
        q: 'eventos en Cali',
        hl: 'es',
        gl: 'co',
        api_key: apiKey
      }
    });

    const eventos = response.data.events_results || [];
    let insertados = 0;

    for (const ev of eventos) {
      const query = `
        INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, categoria, fuente)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `;

      await pool.query(query, [
        ev.title || 'Sin título',
        ev.description || '',
        ev.date?.start_date ? new Date(ev.date.start_date) : null,
        ev.address || '',
        'evento',
        fuente
      ]);
      insertados++;
    }

    console.log(`✅ ${insertados} eventos insertados en la base de datos desde SerpAPI.\n`);
  } catch (error) {
    console.error('❌ Error al obtener eventos de SerpAPI:', error.message);
  }
}

// Ejecutar inmediatamente
fetchAndSaveEventos();

// Programar para que corra cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando fetchAndSaveEventos programado...');
  fetchAndSaveEventos();
});
