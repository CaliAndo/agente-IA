// 📁 scripts/insertarEmbeddingsCorrectos.js
require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');
const cron = require('node-cron');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Detecta a qué tabla secundaria pertenece un evento
async function detectarFuente(id) {
  const tablas = ['museos', 'civitatis', 'imperdibles', 'sheets_detalles'];
  for (const tabla of tablas) {
    let res = await pool.query(`SELECT 1 FROM ${tabla} WHERE evento_id = $1 LIMIT 1`, [id]);
    if (res.rows.length) return tabla;
    res = await pool.query(`SELECT 1 FROM ${tabla} WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length) return tabla;
  }
  return 'eventos';
}

// Carga todos los eventos y genera su embedding con la fuente correcta
async function insertarEmbeddings() {
  console.log('🕒 Iniciando proceso de embeddings a las', new Date().toLocaleString());
  const eventos = await pool.query('SELECT id, nombre, descripcion FROM eventos');

  for (const evento of eventos.rows) {
    const exists = await pool.query(
      'SELECT 1 FROM embeddings_index_384 WHERE referencia_id = $1',
      [evento.id]
    );
    if (exists.rows.length) {
      console.log(`⏭️ Ya existe embedding para: ${evento.nombre}`);
      continue;
    }
    const fuente = await detectarFuente(evento.id);
    console.log(`📦 Insertando embedding: ${evento.nombre} → fuente: ${fuente}`);
    try {
      await axios.post('http://localhost:8000/generar-embedding', {
        texto: evento.descripcion || evento.nombre,
        nombre: evento.nombre,
        referencia_id: evento.id,
        fuente,
      });
    } catch (err) {
      console.error(`❌ Error en ${evento.nombre}:`, err.message);
    }
  }

  console.log('✅ Proceso finalizado.');
}

// 1) Ejecutar inmediatamente al arrancar el script
insertarEmbeddings().catch((err) => {
  console.error('💥 Error inicial:', err);
});

// 2) Programar cron cada 24 h (a la medianoche)
cron.schedule('0 0 * * *', () => {
  insertarEmbeddings().catch((err) => {
    console.error('💥 Error en cron:', err);
  });
}, {
  timezone: 'America/Bogota'
});

