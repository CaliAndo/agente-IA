const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');  // Añadido para programar la tarea

// Configuración de PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'Agente IA',
  user: process.env.PG_USER || 'jay',
  password: process.env.PG_PASSWORD || 'Jay123'
});

// Ruta del archivo JSON
const jsonFilePath = path.join(__dirname, '../../data/cali_pdf.json');

// Leer el archivo JSON
const jsonData = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));

// Función para obtener el evento_id a partir del nombre del evento
async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1';
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

// Función para insertar datos en las tablas
async function insertarLugares() {
  try {
    for (const item of jsonData) {
      const titulo = item.titulo;
      const contenido = JSON.stringify(item.contenido); // Convertir el contenido a JSON

      // 1. Obtener el evento_id de la tabla eventos usando el nombre
      let evento_id = await getEventoIdByTitulo(titulo);

      // 2. Si no existe el evento_id, insertamos un nuevo evento en la tabla eventos
      if (!evento_id) {
        console.log(`⚠️ No se encontró evento_id para el lugar: ${titulo}. Insertando nuevo evento...`);
        const queryInsertEvento = `
          INSERT INTO eventos (nombre)
          VALUES ($1)
          RETURNING id
        `;
        const result = await pool.query(queryInsertEvento, [titulo]);
        evento_id = result.rows[0].id;  // Captura el nuevo ID insertado
        console.log(`Nuevo evento insertado con ID: ${evento_id}`);
      }

      // 3. Insertar el lugar en lugares_pdf con el evento_id correspondiente
      const queryInsertLugar = `
        INSERT INTO lugares_pdf (titulo, pagina, contenido, evento_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `;
      const resultLugar = await pool.query(queryInsertLugar, [titulo, item.pagina, contenido, evento_id]);
      const lugarId = resultLugar.rows[0].id;

      // Ahora insertamos los detalles del lugar en detalles_lugares_pdf
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

// Programar la ejecución cada 24 horas (esto ejecutará la función cada día a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕒 Ejecutando la tarea programada para actualizar los lugares...');
  insertarLugares();  // Llamamos la función para hacer la inserción de los lugares
});

console.log('✅ Sistema de actualización programada activo, ejecutando cada 24 horas.');
