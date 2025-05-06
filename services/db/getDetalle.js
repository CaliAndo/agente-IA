const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL + '?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

/**
 * Devuelve los detalles de un evento según su fuente.
 * Si la fuente es 'eventos', retorna solo el nombre y descripción.
 */
async function getDetallePorFuente(origen, id) {
  if (!id) return null;

  try {
    // 1️⃣ Obtener datos base del evento
    const eventoRes = await pool.query(
      'SELECT id, nombre, descripcion FROM eventos WHERE id = $1',
      [id]
    );
    if (!eventoRes.rows.length) return null;
    const { nombre, descripcion } = eventoRes.rows[0];

    let detalle = {};

    // 2️⃣ Obtener datos adicionales según la fuente
    switch (origen) {
      case 'sheets_detalles': {
        const res = await pool.query(
          `SELECT 
             tipo_de_lugar,
             redes_sociales,
             pagina_web,
             zona,
             ingreso_permitido
           FROM sheets_detalles
           WHERE evento_id = $1`,
          [id]
        );
        detalle = res.rows[0] || {};
        break;
      }
      case 'civitatis': {
        const res = await pool.query(
          `SELECT precio, fuente AS enlace
             FROM civitatis
            WHERE evento_id = $1`,
          [id]
        );
        detalle = res.rows[0] || {};
        break;
      }
      case 'imperdibles': {
        const res = await pool.query(
          `SELECT link AS enlace
             FROM imperdibles
            WHERE evento_id = $1`,
          [id]
        );
        detalle = res.rows[0] || {};
        break;
      }
      case 'museos': {
        const res = await pool.query(
          `SELECT link AS enlace
             FROM museos
            WHERE evento_id = $1`,
          [id]
        );
        detalle = res.rows[0] || {};
        break;
      }
      case 'eventos':
      default:
        // No hay tablas secundarias: solo datos base
        detalle = {};
        break;
    }

    // 3️⃣ Consolidar respuesta
    return {
      nombre,
      descripcion,
      // Campos específicos de sheets_detalles
      tipo_de_lugar: detalle.tipo_de_lugar || null,
      redes_sociales: detalle.redes_sociales || null,
      pagina_web: detalle.pagina_web || null,
      zona: detalle.zona || null,
      ingreso_permitido: detalle.ingreso_permitido || null,
      // Para otras fuentes
      precio: detalle.precio || null,
      enlace: detalle.enlace || null,
    };
  } catch (error) {
    console.error('❌ Error al obtener detalle por fuente:', error);
    return null;
  }
}

module.exports = { getDetallePorFuente };
