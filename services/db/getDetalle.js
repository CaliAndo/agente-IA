// services/db/getDetallePorFuente.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Devuelve un objeto con:
 *  - nombre, descripcion            (siempre desde eventos)
 *  - tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido (si fuente==='sheets_detalles')
 *  - precio, enlace                (si fuente==='civitatis')
 *  - enlace                        (si fuente==='imperdibles' o 'museos')
 *
 * @param {string} fuente  nombre de la tabla secundaria
 * @param {number} id      evento_id
 */
async function getDetallePorFuente(fuente, id) {
  if (!fuente || !id) return null;

  try {
    // 1) Base: siempre sacamos nombre y descripcion de eventos
    const evt = await pool.query(
      `SELECT nombre, descripcion
         FROM eventos
        WHERE id = $1`,
      [id]
    );
    if (!evt.rows.length) return null;
    const { nombre, descripcion } = evt.rows[0];

    // 2) Campos extra según la tabla 'fuente'
    let extra = {};
    switch (fuente) {
      case 'sheets_detalles':
        {
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
          extra = res.rows[0] || {};
        }
        break;

      case 'civitatis':
        {
          const res = await pool.query(
            `SELECT 
                precio,
                fuente
               FROM civitatis
              WHERE evento_id = $1`,
            [id]
          );
          extra = res.rows[0] || {};
        }
        break;

      case 'imperdibles':
        {
          const res = await pool.query(
            `SELECT 
                link AS enlace
               FROM imperdibles
              WHERE evento_id = $1`,
            [id]
          );
          extra = res.rows[0] || {};
        }
        break;

      case 'museos':
        {
          const res = await pool.query(
            `SELECT 
                link AS enlace
               FROM museos
              WHERE evento_id = $1`,
            [id]
          );
          extra = res.rows[0] || {};
        }
        break;

      default:
        // si la fuente no coincide, no añadimos extra
        extra = {};
        break;
    }

    // 3) Devolvemos todo consolidados
    return {
      nombre,
      descripcion,
      // de sheets_detalles
      tipo_de_lugar:     extra.tipo_de_lugar      || null,
      redes_sociales:    extra.redes_sociales     || null,
      pagina_web:        extra.pagina_web         || null,
      zona:              extra.zona               || null,
      ingreso_permitido: extra.ingreso_permitido  || null,
      // de civitatis / imperdibles / museos
      precio:            extra.precio             || null,
      enlace:            extra.enlace             || null,
    };
  } catch (err) {
    console.error('❌ Error al obtener detalle por fuente:', err);
    return null;
  }
}

module.exports = { getDetallePorFuente };
