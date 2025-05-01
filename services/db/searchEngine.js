const { Pool } = require('pg');
const { generarEmbedding } = require('../ia/embeddingService');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function buscarCoincidencias(mensajeUsuario) {
  try {
    if (!mensajeUsuario || mensajeUsuario.length < 2) return [];

    // Buscar si ya existe un embedding para este texto en cache
    const { rows: cacheRows } = await pool.query(
      `SELECT embedding FROM user_query_embeddings WHERE texto = $1 LIMIT 1;`,
      [mensajeUsuario]
    );

    let vectorPG;

    if (cacheRows.length > 0) {
      // Ya existe el embedding, lo usamos directamente
      vectorPG = cacheRows[0].embedding;
    } else {
      // No existe, lo generamos
      const userEmbedding = await generarEmbedding(mensajeUsuario);
      if (!userEmbedding) return [];

      vectorPG = `[${userEmbedding.join(',')}]`;

      // Guardar embedding en la tabla de cache
      await pool.query(
        `INSERT INTO user_query_embeddings (texto, embedding) VALUES ($1, $2)`,
        [mensajeUsuario, vectorPG]
      );
    }

    // Buscar los top 15 más similares
    const { rows } = await pool.query(
      `
      SELECT 
        id, 
        nombre, 
        descripcion, 
        fuente AS origen, 
        item_id,
        1 - (embedding <#> $1) AS similitud
      FROM embeddings_index
      ORDER BY embedding <#> $1
      LIMIT 15;
      `,
      [vectorPG]
    );

    return rows;
  } catch (err) {
    console.error('❌ Error en búsqueda semántica:', err);
    return [];
  }
}

module.exports = {
  buscarCoincidencias,
};
