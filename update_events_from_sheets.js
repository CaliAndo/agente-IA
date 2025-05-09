#!/usr/bin/env node
// update_events_from_sheets.js
// Script para sincronizar eventos desde Google Sheets (opensheet.elk.sh) a Postgres y generar embeddings

require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');

// URL pública de tu Google Sheet convertida a JSON
const SHEET_ID  = process.env.GOOGLE_SHEET_ID || '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const SHEET_URL = `https://opensheet.elk.sh/${SHEET_ID}/Hoja1`;

// Endpoint de tu servicio de embeddings
const FASTAPI_URL = process.env.FASTAPI_URL; // e.g. http://localhost:8000

// Conexión a Postgres (Supabase + pgvector)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Función auxiliar: obtiene o crea el evento en 'eventos' y devuelve su id
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

// Lógica principal
async function sync() {
  console.log('📥 Descargando datos de Google Sheets…');
  const res = await axios.get(SHEET_URL);
  const data = res.data;
  if (!Array.isArray(data)) {
    throw new Error('Formato inválido: esperaba un array de filas');
  }

  let nuevosEmbeddings = 0;
  for (const item of data) {
    const nombre            = (item['Nombre del sitio']          || '').trim();
    const descripcion       = (item['¿Qué puedes encontrar?']    || '').trim();
    const tipo_de_lugar     = (item['Tipo de lugar']             || '').trim();
    const redes_sociales    = (item['Redes sociales']            || '').trim();
    const pagina_web        = (item['Página Web']                || '').trim();
    const zona              = (item['Zona']                      || '').trim();
    const ingreso_permitido = (item['Ingreso permitido a']       || '').trim();

    if (!nombre) continue; // saltar si no hay nombre

    // 1) Obtener o crear evento
    const eventoId = await obtenerOCrearEvento(nombre, descripcion);

    // 2) Upsert en sheets_detalles
    const detRes = await pool.query(
      'SELECT evento_id FROM sheets_detalles WHERE evento_id = $1',
      [eventoId]
    );

    if (detRes.rows.length) {
      // Actualizar registro existente
      await pool.query(
        `UPDATE sheets_detalles
           SET tipo_de_lugar    = $1,
               descripcion      = $2,
               redes_sociales   = $3,
               pagina_web       = $4,
               zona             = $5,
               ingreso_permitido = $6
         WHERE evento_id = $7`,
        [tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido, eventoId]
      );
    } else {
      // Insertar nuevo registro
      await pool.query(
        `INSERT INTO sheets_detalles
           (evento_id, tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [eventoId, tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido]
      );
    }

    // 3) Indexar embedding en embeddings_index_384 si no existe
    const { rowCount } = await pool.query(
      `SELECT 1
         FROM embeddings_index_384
        WHERE referencia_id = $1
          AND fuente = 'sheets'`,
      [eventoId]
    );
    if (rowCount === 0) {
      // Generar embedding a través del servicio FastAPI
      const textoEmb = `${nombre}. ${descripcion}`;
      try {
        await axios.post(
          `${FASTAPI_URL}/generar-embedding`,
          { texto: textoEmb, nombre, referencia_id: eventoId, fuente: 'sheets' }
        );
        nuevosEmbeddings++;
        console.log(`✅ Embedding creado para evento ${eventoId} (${nombre})`);
      } catch (err) {
        console.error(`❌ Error embed evento ${eventoId}:`, err.message);
      }
    }
  }

  console.log(`🏁 Sincronización completa. ${nuevosEmbeddings} nuevo(s) embedding(s) insertado(s).`);
  await pool.end();
}

// Ejecuta el script con: node update_events_from_sheets.js
sync().catch(err => {
  console.error('❌ Script falló:', err);
  process.exit(1);
});
