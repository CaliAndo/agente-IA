// scripts/importarDesdeSheetsConEmbeddings.js

require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');
const { generarEmbedding } = require('../services/ai/embeddingService');

// 1) Conexión a Supabase (PostgreSQL + pgvector + SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL + '?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

// 2) Auxiliar: obtener o crear evento y devolver su ID
async function obtenerOCrearEvento(nombre, descripcion) {
  // 2.1) Intentar recuperar
  const { rows: existentes } = await pool.query(
    `SELECT id FROM eventos WHERE nombre = $1`,
    [nombre]
  );
  if (existentes.length) return existentes[0].id;

  // 2.2) Generar embedding
  const textoEmbedding = `${nombre}. ${descripcion}`;
  const embeddingArray = await generarEmbedding(textoEmbedding);
  const vectorStr = `[${embeddingArray.join(',')}]`;

  // 2.3) Insertar en 'eventos'
  const { rows } = await pool.query(
    `
    INSERT INTO eventos (nombre, descripcion, embedding)
    VALUES ($1, $2, $3::vector)
    RETURNING id
    `,
    [nombre, descripcion, vectorStr]
  );
  return rows[0].id;
}

// 3) Función principal: descarga de Sheets e inserción en BD + índice de embeddings
async function insertarDesdeSheetsYIndex() {
  try {
    console.log('📥 Descargando datos de Google Sheets…');
    const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
    const url     = `https://opensheet.elk.sh/${sheetId}/Hoja1`;
    const { data } = await axios.get(url);
    if (!Array.isArray(data)) throw new Error('Formato de datos inválido');

    let nuevos = 0;
    for (const item of data) {
      const nombre      = item['Nombre del sitio'] || '';
      const descripcion = item['¿Qué puedes encontrar?'] || '';
      const ubicacion   = item.Ubicacion || '';
      const tipo_de_lugar     = item['Tipo de lugar'] || '';
      const redes_sociales    = item['Redes sociales'] || '';
      const pagina_web        = item['Página Web'] || '';
      const zona              = item.Zona || '';
      const ingreso_permitido = item['Ingreso permitido a'] || '';

      if (!nombre) continue;

      // 3.1) Obtener o crear evento
      const eventoId = await obtenerOCrearEvento(nombre, descripcion);

      // 3.2) Insertar en sheets_detalles si no existe
      await pool.query(
        `
        INSERT INTO sheets_detalles
          (evento_id, nombre, descripcion, ubicacion, tipo_de_lugar,
           redes_sociales, pagina_web, zona, ingreso_permitido)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (evento_id, nombre) DO NOTHING
        `,
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

      // 3.3) Indexar embedding en embeddings_index_384
      // Solo si no existe ya una entrada para este evento
      const { rows: idxExists } = await pool.query(
        `
        SELECT 1
          FROM embeddings_index_384
         WHERE referencia_id = $1
           AND fuente = 'sheets'
        `,
        [eventoId]
      );
      if (idxExists.length === 0) {
        const textoEmbedding = `${nombre}. ${descripcion}`;
        const embeddingArray = await generarEmbedding(textoEmbedding);
        const vectorStr = `[${embeddingArray.join(',')}]`;

        await pool.query(
          `
          INSERT INTO embeddings_index_384
            (nombre, descripcion, fuente, referencia_id, embedding)
          VALUES ($1, $2, $3, $4, $5::vector)
          `,
          [nombre, descripcion, 'sheets', eventoId, vectorStr]
        );
        nuevos++;
      }
    }

    console.log(`✅ ${nuevos} nuevo(s) embedding(s) insertado(s) desde Sheets.`);
  } catch (err) {
    console.error('❌ Error al procesar Sheets:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Ejecutar inmediatamente al invocar este script
(async () => {
  console.log('🔄 Iniciando importación e indexación de embeddings desde Sheets…');
  await insertarDesdeSheetsYIndex();
  console.log('🏁 Proceso finalizado.');
  process.exit(0);
})();
