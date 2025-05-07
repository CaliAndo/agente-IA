// services/db/getDetalle.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Dada la cadena 'origen' (puede ser URL, nombre de fuente, etc.)
 * devuelve el nombre de la tabla donde buscar los campos extra.
 */
function whichTable(origen) {
  if (!origen) return null;
  origen = origen.toLowerCase();
  if (origen.includes('civitatis.com'))    return 'civitatis';
  if (origen.includes('visitcali.travel'))  return 'museos';
  if (origen.includes('imperdibles'))       return 'imperdibles';
  if (origen === 'sheets_detalles')         return 'sheets_detalles';
  // agrega más mapeos si tienes otras fuentes...
  return null;
}

/**
 * Recupera el detalle completo de un evento:
 *   - Siempre parte de la tabla 'eventos' (nombre, descripción)
 *   - Luego busca en la tabla secundaria según la fuente
 */
async function getDetallePorFuente(origen, id) {
  if (!origen || !id) return null;

  try {
    // 1) Datos base del evento
    const evtRes = await pool.query(
      `SELECT nombre, descripcion
         FROM eventos
        WHERE id = $1`,
      [id]
    );
    if (!evtRes.rows.length) return null;
    const { nombre, descripcion } = evtRes.rows[0];

    // 2) Determinar tabla secundaria y buscar allí
    const tabla = whichTable(origen);
    let extra = {};

    if (tabla === 'civitatis') {
      const r = await pool.query(
        `SELECT precio,
                fuente AS enlace
           FROM civitatis
          WHERE evento_id = $1`,
        [id]
      );
      extra = r.rows[0] || {};

    } else if (tabla === 'museos') {
      const r = await pool.query(
        `SELECT link AS enlace
           FROM museos
          WHERE evento_id = $1`,
        [id]
      );
      extra = r.rows[0] || {};

    } else if (tabla === 'imperdibles') {
      const r = await pool.query(
        `SELECT link AS enlace
           FROM imperdibles
          WHERE evento_id = $1`,
        [id]
      );
      extra = r.rows[0] || {};

    } else if (tabla === 'sheets_detalles') {
      const r = await pool.query(
        `SELECT tipo_de_lugar,
                redes_sociales,
                pagina_web,
                zona,
                ingreso_permitido
           FROM sheets_detalles
          WHERE evento_id = $1`,
        [id]
      );
      extra = r.rows[0] || {};
    }

    // 3) Unificar y devolver
    return {
      nombre,
      descripcion,
      // campos de sheets_detalles
      tipo_de_lugar:     extra.tipo_de_lugar      || null,
      redes_sociales:    extra.redes_sociales     || null,
      pagina_web:        extra.pagina_web         || null,
      zona:              extra.zona               || null,
      ingreso_permitido: extra.ingreso_permitido  || null,
      // campos de las otras tablas
      precio:            extra.precio             || null,
      enlace:            extra.enlace             || null,
    };
  } catch (err) {
    console.error('❌ Error al obtener detalle por fuente:', err);
    return null;
  }
}

module.exports = { getDetallePorFuente };
