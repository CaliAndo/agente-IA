// 📁 services/db/getCultura.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getAllCultura() {
  try {
    const museos = await pool.query(`
      SELECT id, title AS nombre, fuente AS descripcion, 'museos' AS fuente 
      FROM museos
    `);
    
    const lugaresPdf = await pool.query(`
      SELECT id, titulo AS nombre, subtitulo AS descripcion, 'lugares_pdf' AS fuente 
      FROM lugares_pdf
    `);
    
    const detallesLugaresPdf = await pool.query(`
      SELECT id, subtitulo AS nombre, descripcion, 'detalles_lugares_pdf' AS fuente
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
