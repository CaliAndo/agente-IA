const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function getAllRecomendaciones() {
  try {
    const imperdibles = await pool.query(`
      SELECT id, titulo AS nombre, link AS descripcion, 'imperdibles' AS origen
      FROM imperdibles
    `);

    const lugaresPdf = await pool.query(`
      SELECT id, titulo AS nombre, subtitulo AS descripcion, 'lugares_pdf' AS origen
      FROM lugares_pdf
    `);

    const sheetsDetalles = await pool.query(`
      SELECT id, nombre, descripcion, 'sheets_detalles' AS origen
      FROM sheets_detalles
    `);

    return [
      ...imperdibles.rows,
      ...lugaresPdf.rows,
      ...sheetsDetalles.rows,
    ];
  } catch (err) {
    console.error('Error al obtener recomendaciones:', err);
    return [];
  }
}

module.exports = {
  getAllRecomendaciones,
};
