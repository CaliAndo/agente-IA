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

    // Generar embedding del mensaje del usuario
    const userEmbedding = await generarEmbedding(mensajeUsuario);
    if (!userEmbedding) return [];

    const vectorPG = `[${userEmbedding.join(',')}]`;

    // Buscar los top 15 más similares usando cosine_distance (menor = más similar)
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

    // Luego podemos buscar metadatos adicionales si se requiere, por ahora devolvemos lo básico
    return rows;
  } catch (err) {
    console.error('❌ Error en búsqueda semántica:', err);
    return [];
  }
}

module.exports = {
  buscarCoincidencias,
};
