const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService'); // asegúrate de que esta ruta sea válida
require('dotenv').config();

// Conexión Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Configuración del Google Sheet
const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const hoja = 'Hoja1';
const url = `https://opensheet.elk.sh/${sheetId}/${hoja}`;

async function insertarEventosDesdeSheets() {
  try {
    console.log('📥 Descargando datos desde Google Sheets...');
    const res = await axios.get(url);
    const data = res.data;

    if (!Array.isArray(data)) throw new Error('El formato de los datos no es válido');

    let insertados = 0;

    for (const item of data) {
      const nombre = item['Nombre del sitio'] || '';
      const descripcion = item['¿Qué puedes encontrar?'] || '';
      const ubicacion = item.Ubicacion || '';
      const tipo_de_lugar = item['Tipo de lugar'] || '';
      const redes_sociales = item['Redes sociales'] || '';
      const pagina_web = item['Página Web'] || '';
      const zona = item.Zona || '';
      const ingreso_permitido = item['Ingreso permitido a'] || '';

      if (!nombre) {
        console.log(`⚠️ Evento sin nombre. Saltando.`);
        continue;
      }

      let evento_id = await getEventoIdByTitulo(nombre);

      if (!evento_id) {
        console.log(`➕ Insertando nuevo evento: ${nombre}`);
        const texto = `${nombre}. ${descripcion}`;
        const embedding = await generarEmbedding(texto);

        const insertEventoQuery = `
          INSERT INTO eventos (nombre, descripcion, embedding)
          VALUES ($1, $2, $3)
          RETURNING id
        `;
        const insertEventoResult = await pool.query(insertEventoQuery, [nombre, descripcion, embedding]);
        evento_id = insertEventoResult.rows[0].id;

        console.log(`🧠 Embedding generado e insertado para evento ID: ${evento_id}`);
      }

      const insertDetalleQuery = `
        INSERT INTO sheets_detalles (evento_id, nombre, descripcion, ubicacion, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
      `;

      await pool.query(insertDetalleQuery, [
        evento_id, nombre, descripcion, ubicacion, tipo_de_lugar,
        redes_sociales, pagina_web, zona, ingreso_permitido
      ]);

      insertados++;
    }

    console.log(`✅ ${insertados} eventos procesados exitosamente.`);
  } catch (error) {
    console.error('❌ Error al insertar eventos:', error.message);
  }
}

async function getEventoIdByTitulo(nombre) {
  const res = await pool.query('SELECT id FROM eventos WHERE nombre = $1', [nombre]);
  return res.rows[0]?.id || null;
}

// Ejecutar cada 24 horas a medianoche
cron.schedule('0 0 * * *', () => {
  console.log('🕒 Ejecutando tarea programada para insertar eventos desde Sheets...');
  insertarEventosDesdeSheets();
});

console.log('✅ Sistema de actualización de Sheets activo cada 24 horas.');
