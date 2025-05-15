const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function getdichoByIndex(idx) {
  const query = `
    SELECT dicho, significado
    FROM dichos_calenos
    ORDER BY id
    OFFSET $1
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [idx]);
  if (rows.length === 0) return null;
  return rows[0]; // { dicho: "...", significado: "..." }
}
module.exports = { getdichoByIndex };
