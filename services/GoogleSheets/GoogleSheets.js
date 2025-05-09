#!/usr/bin/env node
require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');

const SHEET_ID  = process.env.GOOGLE_SHEET_ID;
const SHEET_URL = `https://opensheet.elk.sh/${SHEET_ID}/Hoja1`;
const FASTAPI_URL = process.env.FASTAPI_URL;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function obtenerOCrearEvento(nombre, descripcion) {
  const { rows } = await pool.query(
    'SELECT id FROM eventos WHERE nombre = $1',
    [nombre]
  );
  if (rows.length) {
    const id = rows[0].id;
    await pool.query(
      'UPDATE eventos SET descripcion = $1 WHERE id = $2',
      [descripcion, id]
    );
    return id;
  }
  const ins = await pool.query(
    `INSERT INTO eventos (nombre, descripcion)
     VALUES ($1, $2)
     RETURNING id`,
    [nombre, descripcion]
  );
  return ins.rows[0].id;
}

async function sync() {
  console.log('📥 Descargando datos de Google Sheets…');
  const res  = await axios.get(SHEET_URL);
  const data = res.data;
  if (!Array.isArray(data)) throw new Error('Hoja con formato inesperado');

  let nuevosEmb = 0;
  for (const item of data) {
    const nombre            = (item['Nombre del sitio']       || '').trim();
    const descripcion       = (item['¿Qué puedes encontrar?'] || '').trim();
    const tipo_de_lugar     = (item['Tipo de lugar']          || '').trim();
    const redes_sociales    = (item['Redes sociales']         || '').trim();
    const pagina_web        = (item['Página Web']             || '').trim();
    const zona              = (item['Zona']                   || '').trim();
    const ingreso_permitido = (item['Ingreso permitido a']    || '').trim();

    if (!nombre) continue;

    // 1) eventos
    const eventoId = await obtenerOCrearEvento(nombre, descripcion);

    // 2) sheets_detalles (sin columna `descripcion`)
    const detRes = await pool.query(
      'SELECT evento_id FROM sheets_detalles WHERE evento_id = $1',
      [eventoId]
    );
    if (detRes.rows.length) {
      await pool.query(
        `UPDATE sheets_detalles
           SET tipo_de_lugar     = $1,
               redes_sociales    = $2,
               pagina_web        = $3,
               zona              = $4,
               ingreso_permitido = $5
         WHERE evento_id = $6`,
        [tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido, eventoId]
      );
    } else {
      await pool.query(
        `INSERT INTO sheets_detalles
           (evento_id, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [eventoId, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido]
      );
    }

    // 3) embeddings_index_384
    const { rowCount } = await pool.query(
      `SELECT 1
         FROM embeddings_index_384
        WHERE referencia_id = $1
          AND fuente = 'sheets'`,
      [eventoId]
    );
    if (rowCount === 0) {
      try {
        await axios.post(
          `${FASTAPI_URL}/generar-embedding`,
          {
            texto: `${nombre}. ${descripcion}`,
            nombre,
            referencia_id: eventoId,
            fuente: 'sheets'
          }
        );
        nuevosEmb++;
        console.log(`✅ Embedding creado para evento ${eventoId} (${nombre})`);
      } catch (err) {
        console.error(`❌ Error embed evento ${eventoId}:`, err.message);
      }
    }
  }

  console.log(`🏁 Sincronización completa. ${nuevosEmb} embeddings nuevos.`);
  await pool.end();
}

sync().catch(err => {
  console.error('❌ Script falló:', err);
  process.exit(1);
});
