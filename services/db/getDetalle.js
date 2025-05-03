const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDetallePorFuente(origen, id) {
  if (!origen || !id) return null;

  try {
    // 1. Obtener datos base del evento
    const eventoResult = await pool.query(
      'SELECT id, nombre, descripcion FROM eventos WHERE id = $1',
      [id]
    );

    if (!eventoResult.rows.length) return null;
    const evento = eventoResult.rows[0];
    let detalle = {};

    // 2. Detalles según la fuente
    switch (origen) {
      case 'sheets_detalles':
        const sheets = await pool.query(`
          SELECT tipo_de_lugar, redes_sociales, pagina_web, zona
          FROM sheets_detalles 
          WHERE evento_id = $1
        `, [id]);
        detalle = sheets.rows[0] || {};
        break;

      case 'civitatis':
        const civ = await pool.query(`
          SELECT precio, fuente AS enlace
          FROM civitatis 
          WHERE evento_id = $1
        `, [id]);
        detalle = civ.rows[0] || {};
        break;

      case 'imperdibles':
        const imp = await pool.query(`
          SELECT link AS enlace 
          FROM imperdibles 
          WHERE evento_id = $1
        `, [id]);
        detalle = imp.rows[0] || {};
        break;

      case 'museos':
        const mus = await pool.query(`
          SELECT link AS enlace 
          FROM museos 
          WHERE evento_id = $1
        `, [id]);
        detalle = mus.rows[0] || {};
        break;

      default:
        return null;
    }

    // 3. Consolidar respuesta
    return {
      nombre: evento.nombre,
      descripcion: evento.descripcion,
      precio: detalle.precio || null,
      enlace: detalle.enlace || null,
    };
  } catch (error) {
    console.error('❌ Error al obtener detalle por fuente:', error);
    return null;
  }
}

module.exports = { getDetallePorFuente };
