// 📁 services/db/insertEventos.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // o usa user, host, db, password, port manualmente
});

async function insertarEventos(eventos) {
  for (const evento of eventos) {
    const { title, description, date, location, link } = evento;
    const query = `
      INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, link, categoria)
      VALUES ($1, $2, $3, $4, $5, 'evento')
      ON CONFLICT DO NOTHING
    `;
    try {
      await pool.query(query, [title, description, date || null, location, link]);
    } catch (err) {
      console.error('❌ Error insertando evento:', title, err.message);
    }
  }
  console.log(`✅ ${eventos.length} eventos insertados`);
}

module.exports = insertarEventos;
