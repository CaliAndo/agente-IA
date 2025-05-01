const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { generarEmbedding } = require('../services/ai/embeddingService'); // ajusta si la ruta es distinta
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const jsonFilePath = path.join(__dirname, '../../data/cali_pdf.json');
const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));

async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1';
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

async function insertarLugares() {
  try {
    for (const item of jsonData) {
      const titulo = item.titulo;
      const contenido = JSON.stringify(item.contenido);

      let evento_id = await getEventoIdByTitulo(titulo);

      if (!evento_id) {
        console.log(`➕ Insertando nuevo evento: ${titulo}`);

        const texto = `${titulo}. ${item.contenido.map(c => c.subtitulo || '').join('. ')}`;
        const embedding = await generarEmbedding(texto);

        const queryInsertEvento = `
          INSERT INTO eventos (nombre, embedding)
          VALUES ($1, $2)
          RETURNING id
        `;
        const result = await pool.query(queryInsertEvento, [titulo, embedding]);
        evento_id = result.rows[0].id;

        console.log(`🧠 Embedding generado e insertado para evento ID: ${evento_id}`);
      }

      const queryInsertLugar = `
        INSERT INTO lugares_pdf (titulo, pagina, contenido, evento_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const resultLugar = await pool.query(queryInsertLugar, [titulo, item.pagina, contenido, evento_id]);
      const lugarId = resultLugar.rows[0].id;

      for (const contenidoItem of item.contenido) {
        if (contenidoItem.tipo === "subtitulo") {
          const subtitulo = contenidoItem.subtitulo;
          const detalleContenido = contenidoItem.contenido ? JSON.stringify(contenidoItem.contenido) : null;
          const lugares = contenidoItem.lugares ? JSON.stringify(contenidoItem.lugares) : null;

          const queryInsertDetalle = `
            INSERT INTO detalles_lugares_pdf (lugar_id, subtitulo, descripcion, lugares)
            VALUES ($1, $2, $3, $4)
          `;
          await pool.query(queryInsertDetalle, [lugarId, subtitulo, detalleContenido, lugares]);
        }
      }

      console.log(`✅ Lugar insertado con ID: ${lugarId} y vinculado al evento con ID: ${evento_id}`);
    }
  } catch (error) {
    console.error('❌ Error al insertar lugares:', error.message);
  }
}

// Ejecución manual
insertarLugares();
