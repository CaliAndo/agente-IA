#!/usr/bin/env node
// update_events_from_sheets_simple.js
// Script para sincronizar eventos desde Google Sheets (via opensheet.elk.sh) a Postgres y generar embeddings

require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');
const { generarEmbedding } = require('../services/ai/embeddingService');

// 1) Configuración de conexión a Postgres (Supabase/pgvector)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 2) Función auxiliar: obtiene o crea un evento, guarda embedding en la tabla eventos
async function obtenerOCrearEvento(nombre, descripcion) {
  // Verificar si ya existe
  const { rows } = await pool.query(
    'SELECT id FROM eventos WHERE nombre = $1',
    [nombre]
  );
  if (rows.length) return rows[0].id;

  // Generar embedding
  const textoEmb = `${nombre}. ${descripcion}`;
  const embArr    = await generarEmbedding(textoEmb);
  if (!Array.isArray(embArr)) throw new Error('Embedding inválido para: ' + nombre);
  const vecStr    = `[${embArr.join(',')}]`;

  // Insertar en eventos con embedding
  const res = await pool.query(
    `INSERT INTO eventos (nombre, descripcion, embedding)
     VALUES ($1, $2, $3::vector)
     RETURNING id`,
    [nombre, descripcion, vecStr]
  );
  return res.rows[0].id;
}

// 3) Función principal: descarga la hoja pública y sincroniza
async function insertarDesdeSheetsYIndex() {
  console.log('📥 Descargando datos de Google Sheets…');
  const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
  const url     = `https://opensheet.elk.sh/${sheetId}/Hoja1`;

  const { data } = await axios.get(url);
  if (!Array.isArray(data)) throw new Error('Formato inesperado de la hoja');

  let count = 0;
  for (const item of data) {
    const nombre            = (item['Nombre del sitio'] || '').trim();
    const descripcion       = (item['¿Qué puedes encontrar?'] || '').trim();
    const ubicacion         = (item['Ubicacion'] || '').trim();
    const tipo_de_lugar     = (item['Tipo de lugar'] || '').trim();
    const redes_sociales    = (item['Redes sociales'] || '').trim();
    const pagina_web        = (item['Página Web'] || '').trim();
    const zona              = (item['Zona'] || '').trim();
    const ingreso_permitido = (item['Ingreso permitido a'] || '').trim();

    if (!nombre) continue;

    // 3.1) Obtener o crear el evento y su embedding
    const eventoId = await obtenerOCrearEvento(nombre, descripcion);

    // 3.2) Upsert en sheets_detalles
    await pool.query(
      `INSERT INTO sheets_detalles
         (evento_id, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (evento_id) DO UPDATE
         SET tipo_de_lugar = EXCLUDED.tipo_de_lugar,
             redes_sociales = EXCLUDED.redes_sociales,
             pagina_web = EXCLUDED.pagina_web,
             zona = EXCLUDED.zona,
             ingreso_permitido = EXCLUDED.ingreso_permitido`,
      [eventoId, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido]
    );

    // 3.3) Indexar embedding en embeddings_index_384
    const { rowCount } = await pool.query(
      `SELECT 1 FROM embeddings_index_384 WHERE referencia_id = $1 AND fuente = 'sheets'`,
      [eventoId]
    );
    if (rowCount === 0) {
      const textoEmb2 = `${nombre}. ${descripcion}`;
      const embArr2   = await generarEmbedding(textoEmb2);
      const vecStr2   = `[${embArr2.join(',')}]`;
      await pool.query(
        `INSERT INTO embeddings_index_384
           (nombre, descripcion, fuente, referencia_id, embedding)
         VALUES ($1,$2,'sheets',$3,$4::vector)`,
        [nombre, descripcion, eventoId, vecStr2]
      );
      count++;
    }
  }

  console.log(`✅ ${count} nuevo(s) embedding(s) insertado(s) desde Sheets.`);
}

// Ejecutar manualmente: node update_events_from_sheets_simple.js
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
