const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDetallePorFuente(origen, id) {
  if (!origen || !id) return null;

  try {
    // 1. Datos base del evento
    const eventoRes = await pool.query(
      'SELECT id, nombre, descripcion FROM eventos WHERE id = $1',
      [id]
    );
    if (!eventoRes.rows.length) return null;
    const evento = eventoRes.rows[0];

    // 2. Campos extra según la fuente
    let detalle = {};
    switch (origen) {
      case 'sheets_detalles':
        {
          const sheetsRes = await pool.query(`
            SELECT 
              tipo_de_lugar,
              redes_sociales,
              pagina_web,
              zona,
              ingreso_permitido
            FROM sheets_detalles
            WHERE evento_id = $1
          `, [id]);
          detalle = sheetsRes.rows[0] || {};
        }
        break;

      case 'civitatis':
        {
          const civRes = await pool.query(`
            SELECT precio, fuente AS enlace
            FROM civitatis
            WHERE evento_id = $1
          `, [id]);
          detalle = civRes.rows[0] || {};
        }
        break;

      case 'imperdibles':
        {
          const impRes = await pool.query(`
            SELECT link AS enlace 
            FROM imperdibles 
            WHERE evento_id = $1
          `, [id]);
          detalle = impRes.rows[0] || {};
        }
        break;

      case 'museos':
        {
          const musRes = await pool.query(`
            SELECT link AS enlace 
            FROM museos 
            WHERE evento_id = $1
          `, [id]);
          detalle = musRes.rows[0] || {};
        }
        break;

      default:
        return null;
    }

    // 3. Consolidar todo en la respuesta
    return {
      nombre: evento.nombre,
      descripcion: evento.descripcion,
      
      // si la fuente es sheets_detalles, estos campos vendrán de `detalle`
      tipo_de_lugar: detalle.tipo_de_lugar || null,
      redes_sociales: detalle.redes_sociales || null,
      pagina_web: detalle.pagina_web     || null,
      zona: detalle.zona                 || null,
      ingreso_permitido: detalle.ingreso_permitido || null,

      // para otras fuentes
      precio: detalle.precio || null,
      enlace: detalle.enlace || null,
    };
  } catch (error) {
    console.error('❌ Error al obtener detalle por fuente:', error);
    return null;
  }
}

module.exports = { getDetallePorFuente };
