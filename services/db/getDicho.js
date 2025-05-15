const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getRandomDicho(exclude = []) {
  const query = `
    SELECT id, dicho, significado
    FROM dichos_calenos
    WHERE id <> ALL($1)
    ORDER BY RANDOM()
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [exclude]);
  return rows.length > 0 ? rows[0] : null;
}

module.exports = { getRandomDicho };
