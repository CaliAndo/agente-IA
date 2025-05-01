// test.js
require('dotenv').config();
const { Pool } = require('pg');
const { generarEmbedding } = require('./services/ia/embeddingService');
const { getAllEventos } = require('./services/db/getEventos');
const { getAllRecomendaciones } = require('./services/db/getRecomendaciones');
const { getAllTours } = require('./services/db/getTours');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function insertarEmbedding(origen, item) {
  try {
    if (!origen) {
      console.warn(`⚠️ Origen nulo para ${item.nombre}, omitiendo...`);
      return;
    }

    const texto = `${item.nombre}. ${item.descripcion || ''}`;
    const embedding = await generarEmbedding(texto);

    if (!embedding) {
      console.warn(`❌ Error generando embedding para texto: ${item.nombre}`);
      return;
    }

    const vectorPG = `[${embedding.join(',')}]`;

    await pool.query(`
      INSERT INTO embeddings_index (fuente, referencia_id, nombre, descripcion, embedding)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT DO NOTHING
    `, [origen, item.id, item.nombre, item.descripcion, vectorPG]);

    console.log(`✅ Embedding insertado para: ${item.nombre}`);
  } catch (err) {
    console.error('❌ Error en la generación de embeddings:', err);
  }
}

async function generarTodosLosEmbeddings() {
  const eventos = await getAllEventos();
  const recomendaciones = await getAllRecomendaciones();
  const tours = await getAllTours();

  for (const ev of eventos) {
    await insertarEmbedding('eventos', ev);
    for (const detalle of ev.detalles) {
      await insertarEmbedding(detalle.origen || 'desconocido', {
        id: ev.id,
        nombre: ev.nombre,
        descripcion: detalle.descripcion,
      });
    }
  }

  for (const rec of recomendaciones) {
    await insertarEmbedding(rec.origen || 'desconocido', rec);
  }

  for (const tour of tours) {
    await insertarEmbedding(tour.origen || 'desconocido', tour);
  }

  console.log('🎉 Proceso de generación de embeddings finalizado.');
  process.exit(0);
}

generarTodosLosEmbeddings();
