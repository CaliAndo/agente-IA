const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function buscarCoincidencias(mensajeUsuario) {
  try {
    if (!mensajeUsuario || mensajeUsuario.length < 2) return [];

    const queries = [
      // 🟢 eventos + ubicación (de sheets_detalles)
      pool.query(`
        SELECT 
          e.id, 
          e.nombre, 
          e.descripcion, 
          NULL AS precio, 
          s.ubicacion, 
          s.pagina_web AS enlace
        FROM eventos e
        LEFT JOIN sheets_detalles s ON s.evento_id = e.id
        WHERE e.nombre ILIKE $1 OR e.descripcion ILIKE $1
      `, [`%${mensajeUsuario}%`]),

      // 🟢 civitatis (tiene precio, fuente como enlace, ubicación no)
      pool.query(`
        SELECT 
          id, 
          titulo AS nombre, 
          descripcion, 
          precio, 
          NULL AS ubicacion, 
          fuente AS enlace
        FROM civitatis
        WHERE titulo ILIKE $1 OR descripcion ILIKE $1
      `, [`%${mensajeUsuario}%`]),

      // 🟢 imperdibles (link como descripción y enlace)
      pool.query(`
        SELECT 
          id, 
          titulo AS nombre, 
          link AS descripcion, 
          NULL AS precio, 
          NULL AS ubicacion, 
          link AS enlace
        FROM imperdibles
        WHERE titulo ILIKE $1 OR link ILIKE $1
      `, [`%${mensajeUsuario}%`]),

      // 🟢 museos (fuente como descripción, link como enlace)
      pool.query(`
        SELECT 
          id, 
          title AS nombre, 
          fuente AS descripcion, 
          NULL AS precio, 
          NULL AS ubicacion, 
          link AS enlace
        FROM museos
        WHERE title ILIKE $1 OR fuente ILIKE $1
      `, [`%${mensajeUsuario}%`]),

      // 🟢 sheets_detalles (tiene ubicación, pagina_web como enlace)
      pool.query(`
        SELECT 
          id, 
          nombre, 
          descripcion, 
          NULL AS precio, 
          ubicacion, 
          pagina_web AS enlace
        FROM sheets_detalles
        WHERE nombre ILIKE $1 OR descripcion ILIKE $1
      `, [`%${mensajeUsuario}%`]),
    ];

    const respuestas = await Promise.all(queries);
    const resultados = [];

    respuestas.forEach((res) => {
      resultados.push(...res.rows);
    });

    return resultados.slice(0, 25); // puedes ajustar el límite si deseas
  } catch (err) {
    console.error('❌ Error en búsqueda manual:', err);
    return [];
  }
}

module.exports = {
  buscarCoincidencias,
};
