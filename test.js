const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { generarEmbeddingConBackoff } = require('./services/ia/embeddingService');

async function testInsertEmbedding() {
  const texto = "quiero bailar salsa";
  const embedding = await generarEmbeddingConBackoff(texto);

  if (!embedding) {
    console.error("❌ No se pudo generar el embedding");
    return;
  }

  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO embeddings_index (nombre, descripcion, fuente, referencia_id, embedding)
      VALUES ($1, $2, $3, $4, $5)
    `;
    const values = [
      'Texto de prueba',
      texto,
      'test_manual',
      9999,
      embedding, // debe ser un array de floats si usas pgvector
    ];

    await client.query(query, values);
    console.log('✅ Embedding insertado correctamente en la tabla.');
  } catch (err) {
    console.error('❌ Error al insertar en PostgreSQL:', err.message);
  } finally {
    client.release();
  }
}

testInsertEmbedding();
