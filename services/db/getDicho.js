const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getRandomDicho() {
  const query = `
    SELECT dicho, significado
    FROM dichos_calenos
    ORDER BY RANDOM()
    LIMIT 1
  `;
  const { rows } = await pool.query(query);
  return rows[0] || null;
}

module.exports = { getRandomDicho };
