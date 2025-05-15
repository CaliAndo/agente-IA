// services/db/getDiccionario.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getMeaning(word) {
  const query = `
    SELECT significado
    FROM diccionario
    WHERE LOWER(palabra) = LOWER($1)
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [word]);
  return rows.length > 0 ? rows[0].significado : null;
}

module.exports = { getMeaning };
