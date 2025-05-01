const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
async function getAllTours() {
  try {
    const civitatis = await pool.query(`
      SELECT id, titulo AS nombre, descripcion, 'civitatis' AS origen
      FROM civitatis
    `);

    const lugaresPdf = await pool.query(`
      SELECT id, titulo AS nombre, subtitulo AS descripcion, 'lugares_pdf' AS origen
      FROM lugares_pdf
    `);

    return [
      ...civitatis.rows,
      ...lugaresPdf.rows,
    ];
  } catch (err) {
    console.error('❌ Error al obtener tours:', err);
    return [];
  }
}

module.exports = { getAllTours };
