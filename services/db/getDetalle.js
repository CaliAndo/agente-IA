// 📁 services/db/getDetallePorFuente.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDetallePorFuente(origen, id) {
  if (!origen || !id) return null;

  try {
    let query = '';
    switch (origen) {
      case 'museos':
        query = 'SELECT * FROM museos WHERE id = $1';
        break;
      case 'imperdibles':
        query = 'SELECT * FROM imperdibles WHERE id = $1';
        break;
      case 'civitatis':
        query = 'SELECT * FROM civitatis WHERE id = $1';
        break;
      case 'sheets_detalles':
        query = 'SELECT * FROM sheets_detalles WHERE id = $1';
        break;
      case 'lugares_pdf':
        query = 'SELECT * FROM lugares_pdf WHERE id = $1';
        break;
      case 'detalles_lugares_pdf':
        query = 'SELECT * FROM detalles_lugares_pdf WHERE id = $1';
        break;
      default:
        return null;
    }

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('❌ Error al obtener detalle por fuente:', error);
    return null;
  }
}

module.exports = { getDetallePorFuente };
