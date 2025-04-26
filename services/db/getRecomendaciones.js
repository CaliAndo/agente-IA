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
      SELECT id, titulo AS nombre, link AS descripcion 
      FROM imperdibles
    `);

    const sheetsDetalles = await pool.query(`
      SELECT id, nombre, descripcion 
      FROM sheets_detalles
    `);

    const resultados = [
      ...imperdibles.rows,
      ...sheetsDetalles.rows,
    ];

    return resultados;
  } catch (err) {
    console.error('Error al obtener recomendaciones:', err);
    return [];
  }
}

module.exports = {
  getAllRecomendaciones,
};
