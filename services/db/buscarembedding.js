const pool = require('../../db'); 

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function buscarSimilaresDesdeEmbeddings(embedding) {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, descripcion, fuente, referencia_id,
              1 - (embedding <#> $1) AS similarity
       FROM embeddings_index
       ORDER BY embedding <#> $1
       LIMIT 5`,
      [embedding]
    );

    const resultados = [];

    for (const item of rows) {
      const { fuente, referencia_id } = item;

      const detalleRes = await pool.query(
        `SELECT * FROM ${fuente} WHERE id = $1 LIMIT 1`,
        [referencia_id]
      );

      if (detalleRes.rows.length > 0) {
        const realData = detalleRes.rows[0];
        resultados.push({
          nombre: realData.nombre || item.nombre,
          id: referencia_id,
          origen: fuente,
          descripcion: realData.descripcion || '',
        });
      }
    }

    return resultados;
  } catch (error) {
    console.error('❌ Error en búsqueda semántica:', error);
    return [];
  }
}

module.exports = { buscarSimilaresDesdeEmbeddings };
