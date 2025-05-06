// services/db/getDetallePorFuente.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function getDetallePorFuente(origen, id) {
  if (!origen || !id) return null;

  try {
    // 1) Siempre partimos de la tabla 'eventos' para obtener nombre y descripción
    const eventoRes = await pool.query(
      `SELECT id, nombre, descripcion
         FROM eventos
        WHERE id = $1`,
      [id]
    );
    if (!eventoRes.rows.length) return null;
    const { nombre, descripcion } = eventoRes.rows[0];

    // 2) Campos específicos según la fuente
    let extra = {};  
    switch (origen) {
      case 'sheets_detalles':
        {
          const { rows } = await pool.query(`
            SELECT tipo_de_lugar,
                   redes_sociales,
                   pagina_web,
                   zona,
                   ingreso_permitido
              FROM sheets_detalles
             WHERE evento_id = $1
          `, [id]);
          extra = rows[0] || {};
        }
        break;

      case 'civitatis':
        {
          const { rows } = await pool.query(`
            SELECT precio,
                   fuente AS enlace
              FROM civitatis
             WHERE evento_id = $1
          `, [id]);
          extra = rows[0] || {};
        }
        break;

      case 'imperdibles':
        {
          const { rows } = await pool.query(`
            SELECT link AS enlace
              FROM imperdibles
             WHERE evento_id = $1
          `, [id]);
          extra = rows[0] || {};
        }
        break;

      case 'museos':
        {
          const { rows } = await pool.query(`
            SELECT link AS enlace
              FROM museos
             WHERE evento_id = $1
          `, [id]);
          extra = rows[0] || {};
        }
        break;

      // CASOS “GENÉRICOS” que deben devolver siempre el base de 'eventos'
      case 'eventos':
      case 'whatsapp':
      case 'api':
      default:
        // No hacemos nada, extra queda vacío
        extra = {};
        break;
    }

    // 3) Consolidamos la respuesta
    return {
      nombre,
      descripcion,
      // campos comunes a sheets_detalles
      tipo_de_lugar:        extra.tipo_de_lugar        || null,
      redes_sociales:       extra.redes_sociales       || null,
      pagina_web:           extra.pagina_web           || null,
      zona:                 extra.zona                 || null,
      ingreso_permitido:    extra.ingreso_permitido    || null,
      // campos comunes a civitatis, imperdibles, museos
      precio:               extra.precio               || null,
      enlace:               extra.enlace               || null,
    };
  } catch (err) {
    console.error('❌ Error al obtener detalle por fuente:', err);
    return null;
  }
}

module.exports = { getDetallePorFuente };
