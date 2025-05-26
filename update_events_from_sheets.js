#!/usr/bin/env node
// update_events_from_sheets.js
// Script para sincronizar eventos desde Google Sheets a Postgres y generar embeddings
require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');
const cron     = require('node-cron');

// URL pública de tu Google Sheet convertida a JSON
const SHEET_ID  = process.env.GOOGLE_SHEET_ID || '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const SHEET_URL = `https://opensheet.elk.sh/${SHEET_ID}/Hoja1`;

const FASTAPI_URL = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error('🚨 Falta FASTAPI_URL en .env');

// Conexión a Postgres (Supabase + pgvector)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Obtiene o crea el evento y devuelve su id
async function obtenerOCrearEvento(nombre, descripcion) {
  const { rows } = await pool.query(
    'SELECT id FROM eventos WHERE nombre = $1',
    [nombre]
  );
  if (rows.length) {
    const id = rows[0].id;
    await pool.query('UPDATE eventos SET descripcion = $1 WHERE id = $2', [descripcion, id]);
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

// Función principal de sincronización + embeddings
async function syncSheets() {
  console.log(`🕒 [${new Date().toLocaleString()}] Iniciando sincronización de Sheets…`);
  try {
    const res = await axios.get(SHEET_URL);
    const data = res.data;
    if (!Array.isArray(data)) throw new Error('Formato inválido: esperaba un array');

    let nuevos = 0;
    for (const item of data) {
      const nombre            = (item['Nombre del sitio']       || '').trim();
      const descripcion       = (item['¿Qué puedes encontrar?'] || '').trim();
      const tipo_de_lugar     = (item['Tipo de lugar']          || '').trim();
      const redes_sociales    = (item['Redes sociales']         || '').trim();
      const pagina_web        = (item['Página Web']             || '').trim();
      const zona              = (item['Zona']                   || '').trim();
      const ingreso_permitido = (item['Ingreso permitido a']    || '').trim();

      if (!nombre) continue;

      // 1) Evento
      const eventoId = await obtenerOCrearEvento(nombre, descripcion);

      // 2) Detalle en sheets_detalles
      const det = await pool.query(
        'SELECT 1 FROM sheets_detalles WHERE evento_id = $1',
        [eventoId]
      );
      if (det.rows.length) {
        await pool.query(
          `UPDATE sheets_detalles
             SET tipo_de_lugar     = $1,
                 descripcion       = $2,
                 redes_sociales    = $3,
                 pagina_web        = $4,
                 zona              = $5,
                 ingreso_permitido = $6
           WHERE evento_id = $7`,
          [tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido, eventoId]
        );
      } else {
        await pool.query(
          `INSERT INTO sheets_detalles
             (evento_id, tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [eventoId, tipo_de_lugar, descripcion, redes_sociales, pagina_web, zona, ingreso_permitido]
        );
      }

      // 3) Embedding si no existe
      const emb = await pool.query(
        `SELECT 1 FROM embeddings_index_384
          WHERE referencia_id = $1 AND fuente = 'sheets'`,
        [eventoId]
      );
      if (emb.rowCount === 0) {
        const payload = {
          texto: `${nombre}. ${descripcion}`,
          nombre,
          referencia_id: eventoId,
          fuente: 'sheets'
        };
        try {
          await axios.post(`${FASTAPI_URL}/generar-embedding`, payload);
          nuevos++;
          console.log(`✅ Embedding [sheets] creado para ${eventoId} (${nombre})`);
        } catch (err) {
          console.error(`❌ Error embedding ${eventoId}:`, err.message);
        }
      }
    }

    console.log(`🏁 Sincronización completada. ${nuevos} embedding(s) nuevos.`);
  } catch (err) {
    console.error('❌ Error en syncSheets:', err);
  }
}

// --- Ejecuciones programadas ---

// 1) Ejecutar al arrancar
syncSheets();

// 2) Ejecutar cada día a las 00:00 (hora Bogotá)
cron.schedule('0 0 * * *', () => {
  syncSheets();
}, {
  timezone: 'America/Bogota'
});
