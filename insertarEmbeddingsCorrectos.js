// 📁 scripts/insertarEmbeddingsCorrectos.js
const { Pool } = require('pg');
const axios = require('axios');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Detecta a qué tabla secundaria pertenece un evento
async function detectarFuente(id) {
  const tablas = ['museos', 'civitatis', 'imperdibles', 'sheets_detalles'];

  for (const tabla of tablas) {
    // Intenta por evento_id
    let res = await pool.query(`SELECT 1 FROM ${tabla} WHERE evento_id = $1 LIMIT 1`, [id]);
    if (res.rows.length) return tabla;

    // Intenta por id (fallback)
    res = await pool.query(`SELECT 1 FROM ${tabla} WHERE id = $1 LIMIT 1`, [id]);
    if (res.rows.length) return tabla;
  }

  return 'eventos';
}

// Carga todos los eventos y genera su embedding con la fuente correcta
async function insertarEmbeddings() {
  const eventos = await pool.query('SELECT id, nombre, descripcion FROM eventos');

  for (const evento of eventos.rows) {
    // Evitar duplicados
    const yaExiste = await pool.query(
      'SELECT 1 FROM embeddings_index_384 WHERE referencia_id = $1',
      [evento.id]
    );
    if (yaExiste.rows.length) {
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
        fuente: fuente,
      });
    } catch (error) {
      console.error(`❌ Error al insertar embedding para ${evento.nombre}:`, error.message);
    }
  }

  console.log('✅ Proceso finalizado.');
  await pool.end();
}

insertarEmbeddings();
