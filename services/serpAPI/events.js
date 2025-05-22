require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService'); // Ajusta si cambia la ruta

// Configuración PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const apiKey = process.env.SERPAPI_KEY;
const fuente = 'https://serpapi.com';

async function fetchAndSaveEventos() {
  try {
    console.log('🔎 Consultando eventos desde SerpAPI...');

    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: 'Eventos en Cali',
        location: 'Cali, Valle Del Cauca, Colombia',
        hl: 'es',
        gl: 'co',
        api_key: apiKey,
      },
    });

    const rawEventos = response.data.events_results || [];

    // Filtramos solo los que claramente tienen dirección en Cali
    const eventos = rawEventos.filter(ev => {
      const address = Array.isArray(ev.address) ? ev.address.join(', ') : ev.address || '';
      return address.toLowerCase().includes('cali');
    });

    if (!eventos.length) {
      console.log('⚠️ No se encontraron eventos relevantes para Cali.');
      return;
    }

    let insertados = 0;

    for (const ev of eventos) {
      const nombre = ev.title?.trim() || 'Sin título';
      const descripcion = ev.description?.trim() || '';
      const fechaTexto = ev.date?.start_date || null;
      const fecha = fechaTexto ? new Date(`${fechaTexto} ${new Date().getFullYear()}`) : null;
      const ubicacion = Array.isArray(ev.address) ? ev.address.join(', ') : ev.address || '';
      const link = ev.link || null;

      // Verificar si el evento ya existe por nombre
      const res = await pool.query('SELECT id FROM eventos WHERE nombre = $1', [nombre]);
      if (res.rowCount > 0) continue;

      const texto = `${nombre}. ${descripcion}`;
      const embedding = await generarEmbedding(texto);

      const insertQuery = `
        INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, categoria, fuente, enlace, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await pool.query(insertQuery, [
        nombre,
        descripcion,
        fecha,
        ubicacion,
        'evento',
        fuente,
        link,
        embedding,
      ]);

      insertados++;
    }

    console.log(`✅ ${insertados} eventos insertados desde SerpAPI.\n`);
  } catch (error) {
    console.error('❌ Error al obtener o guardar eventos de SerpAPI:', error.message);
  }
}

// Ejecutar inmediatamente
fetchAndSaveEventos();

// Programar ejecución diaria a medianoche
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando fetchAndSaveEventos programado...');
  fetchAndSaveEventos();
});
