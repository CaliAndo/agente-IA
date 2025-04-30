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
    const eventosBase = await pool.query(
      'SELECT id, nombre, descripcion, fecha FROM eventos'
    );

    const eventos = [];

    for (const evento of eventosBase.rows) {
      const detalles = await pool.query(`
        SELECT 'sheets_detalles' AS origen, descripcion, pagina_web AS fuente, NULL AS precio
        FROM sheets_detalles WHERE evento_id = $1

        UNION ALL

        SELECT 'imperdibles', link AS descripcion, link AS fuente, NULL
        FROM imperdibles WHERE evento_id = $1

        UNION ALL

        SELECT 'lugares_pdf', subtitulo AS descripcion, NULL, NULL
        FROM lugares_pdf WHERE evento_id = $1
      `, [evento.id]);

      eventos.push({
        id: evento.id,
        nombre: evento.nombre,
        descripcion: evento.descripcion,
        fecha: evento.fecha,
        detalles: detalles.rows, // array con todos los detalles relacionados
      });
    }

    return eventos;
  } catch (err) {
    console.error('❌ Error al obtener eventos:', err);
    return [];
  }
}

module.exports = { getAllEventos };
