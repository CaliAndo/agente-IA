// 📁 services/db/searchEngine.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,      // ← CAMBIAR A DB_
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

async function buscarCoincidencias(mensajeUsuario) {
  try {
    if (!mensajeUsuario || mensajeUsuario.length < 2) {
      return [];
    }

    const queries = [
      pool.query(`SELECT id, nombre, descripcion FROM eventos WHERE nombre ILIKE $1 OR descripcion ILIKE $1`, [`%${mensajeUsuario}%`]),
      pool.query(`SELECT id, titulo AS nombre, link AS descripcion FROM imperdibles WHERE titulo ILIKE $1 OR link ILIKE $1`, [`%${mensajeUsuario}%`]),
      pool.query(`SELECT id, titulo AS nombre, descripcion FROM civitatis WHERE titulo ILIKE $1 OR descripcion ILIKE $1`, [`%${mensajeUsuario}%`]),
      pool.query(`SELECT id, title AS nombre, fuente AS descripcion FROM museos WHERE title ILIKE $1 OR fuente ILIKE $1`, [`%${mensajeUsuario}%`]),
      pool.query(`SELECT id, nombre, descripcion FROM sheets_detalles WHERE nombre ILIKE $1 OR descripcion ILIKE $1`, [`%${mensajeUsuario}%`]),
    ];

    const respuestas = await Promise.all(queries);
    const resultados = [];

    respuestas.forEach(r => {
      resultados.push(...r.rows);
    });

    return resultados.slice(0, 10);
  } catch (err) {
    console.error('Error en búsqueda manual:', err);
    return [];
  }
}

module.exports = {
  buscarCoincidencias,
};
