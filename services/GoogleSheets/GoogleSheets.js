#!/usr/bin/env node
require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const { generarEmbedding } = require('../services/ai/embeddingService');

// 1) Conexión a Supabase (PostgreSQL + pgvector + SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  if (!Array.isArray(embeddingArray)) {
    throw new Error('Embedding inválido para: ' + nombre);
  }
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
  console.log('📥 Descargando datos de Google Sheets…');
  const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
  const url     = `https://opensheet.elk.sh/${sheetId}/Hoja1`;

  const { data } = await axios.get(url);
  if (!Array.isArray(data)) {
    throw new Error('Formato de datos inválido al descargar Sheets');
  }

  let nuevos = 0;
  for (const item of data) {
    const nombre            = item['Nombre del sitio']?.trim();
    const descripcion       = item['¿Qué puedes encontrar?']?.trim() || '';
    const ubicacion         = item.Ubicacion?.trim() || '';
    const tipo_de_lugar     = item['Tipo de lugar']?.trim() || '';
    const redes_sociales    = item['Redes sociales']?.trim() || '';
    const pagina_web        = item['Página Web']?.trim() || '';
    const zona              = item.Zona?.trim() || '';
    const ingreso_permitido = item['Ingreso permitido a']?.trim() || '';

    if (!nombre) continue; // Saltar filas sin nombre

    // 3.1) Obtener o crear evento
    const eventoId = await obtenerOCrearEvento(nombre, descripcion);

    // 3.2) Insertar detalles de Sheets si no existen
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

    // 3.3) Indexar embedding en embeddings_index_384 si no existe ya
    const { rowCount } = await pool.query(
      `
      SELECT 1
        FROM embeddings_index_384
       WHERE referencia_id = $1
         AND fuente = 'sheets'
      `,
      [eventoId]
    );
    if (rowCount === 0) {
      const textoEmb = `${nombre}. ${descripcion}`;
      const embArr    = await generarEmbedding(textoEmb);
      const vecStr    = `[${embArr.join(',')}]`;

      await pool.query(
        `
        INSERT INTO embeddings_index_384
          (nombre, descripcion, fuente, referencia_id, embedding)
        VALUES ($1, $2, 'sheets', $3, $4::vector)
        `,
        [nombre, descripcion, eventoId, vecStr]
      );
      nuevos++;
    }
  }

  console.log(`✅ ${nuevos} nuevo(s) embedding(s) insertado(s) desde Sheets.`);
}

(async () => {
  try {
    await insertarDesdeSheetsYIndex();
    console.log('🏁 Proceso finalizado.');
  } catch (err) {
    console.error('❌ Error al procesar Sheets:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
