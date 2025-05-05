require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService');

// Conexión a Supabase (PostgreSQL + pgvector + SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Configuración de Google Sheets
const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const hoja = 'Hoja1';
const url = `https://opensheet.elk.sh/${sheetId}/${hoja}`;

// Auxiliar: busca ID de evento por nombre
async function getEventoIdByTitulo(nombre) {
  const res = await pool.query(
    'SELECT id FROM eventos WHERE nombre = $1',
    [nombre]
  );
  return res.rows[0]?.id || null;
}

// Función principal: descarga, inserta eventos, detalles y embeddings
async function procesarSheets() {
  console.log('📥 Descargando datos desde Google Sheets...');
  const { data } = await axios.get(url);
  if (!Array.isArray(data)) {
    throw new Error('Formato inválido al descargar Google Sheets');
  }

  let procesados = 0;
  for (const item of data) {
    const nombre = item['Nombre del sitio']?.trim();
    if (!nombre) continue;
    const descripcion       = item['¿Qué puedes encontrar?']?.trim() || '';
    const ubicacion         = item.Ubicacion?.trim() || '';
    const tipo_de_lugar     = item['Tipo de lugar']?.trim() || '';
    const redes_sociales    = item['Redes sociales']?.trim() || '';
    const pagina_web        = item['Página Web']?.trim() || '';
    const zona              = item.Zona?.trim() || '';
    const ingreso_permitido = item['Ingreso permitido a']?.trim() || '';

    // Obtener o crear evento
    let eventoId = await getEventoIdByTitulo(nombre);
    let embeddingArray;
    if (!eventoId) {
      console.log(`➕ Insertando evento: ${nombre}`);
      // Generar embedding para el evento
      embeddingArray = await generarEmbedding(`${nombre}. ${descripcion}`);
      if (!Array.isArray(embeddingArray)) {
        console.warn(`⚠️ Embedding inválido para: ${nombre}`);
        continue;
      }
      const vecStr = `[${embeddingArray.join(',')}]`;

      // Insertar en eventos con embedding
      const insertEvento = await pool.query(
        `INSERT INTO eventos (nombre, descripcion, embedding)
         VALUES ($1, $2, $3::vector)
         RETURNING id`,
        [nombre, descripcion, vecStr]
      );
      eventoId = insertEvento.rows[0].id;
      console.log(`🆔 Evento creado con ID: ${eventoId}`);
    }

    // Insertar detalles en sheets_detalles
    await pool.query(
      `INSERT INTO sheets_detalles
         (evento_id, nombre, descripcion, ubicacion, tipo_de_lugar,
          redes_sociales, pagina_web, zona, ingreso_permitido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (evento_id, nombre) DO NOTHING`,
      [
        eventoId,
        nombre,
        descripcion,
        ubicacion,
        tipo_de_lugar,
        redes_sociales,
        pagina_web,
        zona,
        ingreso_permitido
      ]
    );

    // Indexar embedding en embeddings_index_384 (si hay nuevo embedding o no existe index)
    if (!embeddingArray) {
      embeddingArray = await generarEmbedding(`${nombre}. ${descripcion}`);
    }
    const idxRes = await pool.query(
      `SELECT 1 FROM embeddings_index_384
       WHERE referencia_id = $1 AND fuente = 'sheets'`,
      [eventoId]
    );
    if (idxRes.rowCount === 0 && Array.isArray(embeddingArray)) {
      const vecStr = `[${embeddingArray.join(',')}]`;
      await pool.query(
        `INSERT INTO embeddings_index_384
           (nombre, descripcion, fuente, referencia_id, embedding)
         VALUES ($1, $2, 'sheets', $3, $4::vector)`,
        [nombre, descripcion, eventoId, vecStr]
      );
    }

    procesados++;
  }
  console.log(`✅ ${procesados} fila(s) procesada(s) desde Sheets.`);
}

// Programar la tarea: cada 24h a medianoche UTC
cron.schedule('0 0 * * *', async () => {
  console.log('🕒 Tarea programada: importación de Sheets iniciada.');
  try {
    await procesarSheets();
  } catch (err) {
    console.error('❌ Error en tarea programada:', err);
  }
});

console.log('✅ Cron inicializado: Sheets se procesará cada 24 horas.');
