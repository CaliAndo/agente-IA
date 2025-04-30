const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function getAllCultura() {
  try {
    const museos = await pool.query(`
      SELECT id, title AS nombre, fuente AS descripcion, 'museos' AS origen 
      FROM museos
    `);

    const lugaresPdf = await pool.query(`
      SELECT id, titulo AS nombre, subtitulo AS descripcion, 'lugares_pdf' AS origen 
      FROM lugares_pdf
    `);

    const detallesLugaresPdf = await pool.query(`
      SELECT id, subtitulo AS nombre, descripcion, 'detalles_lugares_pdf' AS origen
      FROM detalles_lugares_pdf
    `);

    return [
      ...museos.rows,
      ...lugaresPdf.rows,
      ...detallesLugaresPdf.rows,
    ];
  } catch (err) {
    console.error('❌ Error al obtener cultura:', err);
    return [];
  }
}

module.exports = { getAllCultura };
