const axios = require('axios');
const { Pool } = require('pg');
const cron = require('node-cron');

// Configuración de PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'Agente IA',
  user: process.env.PG_USER || 'jay',
  password: process.env.PG_PASSWORD || 'Jay123'
});

// Configuración del Sheet
const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const hoja = 'Hoja1';
const url = `https://opensheet.elk.sh/${sheetId}/${hoja}`;

// Función principal para insertar eventos desde Google Sheets
async function insertarEventosDesdeSheets() {
  try {
    console.log('📥 Descargando datos desde Google Sheets...');
    const res = await axios.get(url);
    const data = res.data;

    if (!Array.isArray(data)) throw new Error('El formato de los datos no es válido');

    let insertados = 0;

    for (const item of data) {
      const nombre = item['Nombre del sitio'] || '';  // Ahora se usa "Nombre del sitio"
      const descripcion = item['¿Qué puedes encontrar?'] || '';  // O ajusta esta clave según tu hoja
      const ubicacion = item.Ubicacion || '';
      const tipo_de_lugar = item['Tipo de lugar'] || '';
      const redes_sociales = item['Redes sociales'] || '';
      const pagina_web = item['Página Web'] || '';
      const zona = item.Zona || '';
      const ingreso_permitido = item['Ingreso permitido a'] || '';
      const categoria = 'sheet';
      
      // Validar que el nombre no esté vacío
      if (!nombre) {
        console.log(`⚠️ Evento sin nombre para: ${nombre}. No se insertará.`);
        continue; // Si el nombre está vacío, no insertamos el evento
      }

      // 1. Obtener el `evento_id` de la tabla `eventos` usando el nombre
      let evento_id = await getEventoIdByTitulo(nombre);
      
      // 2. Si no existe el `evento_id`, inserta un nuevo evento en la tabla `eventos`
      if (!evento_id) {
        console.log(`⚠️ No se encontró evento_id para el sitio: ${nombre}. Insertando nuevo evento...`);
        const queryInsertEvento = `
          INSERT INTO eventos (nombre, descripcion)
          VALUES ($1, $2)
          RETURNING id
        `;
        const result = await pool.query(queryInsertEvento, [nombre, descripcion]);
        evento_id = result.rows[0].id;  // Captura el nuevo ID insertado
        console.log(`Nuevo evento insertado con ID: ${evento_id}`);
      }

      // 3. Insertar en `sheets_detalles` con el `evento_id` correspondiente
      const query = `
        INSERT INTO "sheets_detalles" (evento_id, nombre, descripcion, ubicacion, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
      `;
      
      await pool.query(query, [evento_id, nombre, descripcion, ubicacion, tipo_de_lugar, redes_sociales, pagina_web, zona, ingreso_permitido]);
      insertados++;
    }

    console.log(`✅ Se insertaron ${insertados} eventos en la base de datos.`);
  } catch (error) {
    console.error('❌ Error al insertar eventos:', error.message);
  }
}

// Función para obtener el evento_id a partir del nombre
async function getEventoIdByTitulo(nombre) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1'; 
  const res = await pool.query(query, [nombre]);
  return res.rows[0]?.id || null;
}

// Programar la ejecución cada 24 horas (esto ejecutará la función cada día a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕒 Ejecutando la tarea programada para actualizar los eventos...');
  insertarEventosDesdeSheets();  // Llamamos la función para insertar los eventos
});

console.log('✅ Sistema de actualización programada activo, ejecutando cada 24 horas.');
