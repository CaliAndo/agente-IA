// scripts/importarDesdeSheetsConEmbeddings.js

require('dotenv').config();
const axios    = require('axios');
const { Pool } = require('pg');
const { generarEmbedding } = require('./embeddingService');

// 1) Conexión a Supabase (PostgreSQL + pgvector + SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL + '?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

/**
 * Obtiene el ID de un evento por nombre o lo crea si no existe.
 * Devuelve el ID resultante.
 */
async function obtenerOCrearEvento(nombre, descripcion) {
  // a) Intentar recuperar
  const { rows: existentes } = await pool.query(
    `SELECT id FROM eventos WHERE nombre = $1`,
    [nombre]
  );
  if (existentes.length) {
    return existentes[0].id;
  }

  // b) Generar embedding
  const textoEmbedding = `${nombre}. ${descripcion}`;
  const arr = await generarEmbedding(textoEmbedding);
  const vectorStr = `[${arr.join(',')}]`;

  // c) Insertar en tabla `eventos`
  const { rows } = await pool.query(
    `
    INSERT INTO eventos (nombre, descripcion, embedding)
      VALUES ($1, $2, $3::vector)
    RETURNING id
    `,
    [nombre, descripcion, vectorStr]
  );
  return rows[0].id;
}

/**
 * Descarga datos de Google Sheets e inserta:
 *  1) Eventos en la tabla `eventos`
 *  2) Detalles en `sheets_detalles`
 *  3) Índice de embeddings en `embeddings_index_384`
 */
async function insertarDesdeSheetsYIndex() {
  try {
    console.log('📥 Descargando datos de Google Sheets…');
    const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
    const url     = `https://opensheet.elk.sh/${sheetId}/Hoja1`;
    const { data } = await axios.get(url);

    if (!Array.isArray(data)) {
      throw new Error('Formato de datos inválido (no es un Array)');
    }

    let nuevos = 0;

    for (const item of data) {
      const nombre      = item['Nombre del sitio'] || '';
      const descripcion = item['¿Qué puedes encontrar?'] || '';

      if (!nombre) {
        console.log('⚠️  Línea sin "Nombre del sitio", se omite.');
        continue;
      }

      // 1) Obtener o crear evento
      const eventoId = await obtenerOCrearEvento(nombre, descripcion);

      // 2) Insertar en sheets_detalles (columnas reales)
      await pool.query(
        `
        INSERT INTO sheets_detalles
          (evento_id, nombre, tipo_de_lugar,
           redes_sociales, pagina_web, zona, ingreso_permitido)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (evento_id, nombre) DO NOTHING
        `,
        [
          eventoId,
          nombre,
          item['Tipo de lugar']       || null,
          item['Redes sociales']      || null,
          item['Página Web']          || null,
          item.Zona                   || null,
          item['Ingreso permitido a'] || null
        ]
      );

      // 3) Indexar embedding en embeddings_index_384 si no existe
      const { rows: idxExists } = await pool.query(
        `
        SELECT 1
          FROM embeddings_index_384
         WHERE referencia_id = $1
           AND fuente = 'sheets'
        `,
        [eventoId]
      );

      if (idxExists.length === 0) {
        const textoE = `${nombre}. ${descripcion}`;
        const arr2   = await generarEmbedding(textoE);
        const vstr   = `[${arr2.join(',')}]`;

        await pool.query(
          `
          INSERT INTO embeddings_index_384
            (nombre, descripcion, fuente, referencia_id, embedding)
          VALUES
            ($1, $2, 'sheets', $3, $4::vector)
          `,
          [nombre, descripcion, eventoId, vstr]
        );

        nuevos++;
      }
    }

    console.log(`✅ ${nuevos} nuevo(s) embedding(s) insertado(s) desde Sheets.`);
  } catch (err) {
    console.error('❌ Error al procesar Sheets:', err);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Ejecutar inmediatamente al invocar este script
(async () => {
  console.log('🔄 Iniciando importación e indexación de embeddings desde Sheets…');
  await insertarDesdeSheetsYIndex();
})();
