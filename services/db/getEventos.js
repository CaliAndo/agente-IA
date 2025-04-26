const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function getAllEventos() {
  try {
    const result = await pool.query('SELECT id, nombre, descripcion, fecha FROM eventos');
    return result.rows;
  } catch (err) {
    console.error('Error al obtener eventos:', err);
    return [];
  }
}

module.exports = {
  getAllEventos,
};
