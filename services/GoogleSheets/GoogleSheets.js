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

// Función principal
async function insertarEventosDesdeSheets() {
  try {
    console.log('📥 Descargando datos desde Google Sheets...');
    const res = await axios.get(url);
    const data = res.data;

    if (!Array.isArray(data)) throw new Error('El formato de los datos no es válido');

    let insertados = 0;

    for (const item of data) {
      const titulo = item.titulo || '';
      const descripcion = item.descripcion || '';
      const fecha = item.fecha || null;
      const ubicacion = item.ubicacion || '';
      const categoria = 'sheet';

      const query = `
        INSERT INTO eventos (nombre, descripcion, fecha, ubicacion, categoria)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `;
      await pool.query(query, [titulo, descripcion, fecha, ubicacion, categoria]);
      insertados++;
    }

    console.log(`✅ Se insertaron ${insertados} eventos en la base de datos.`);
  } catch (error) {
    console.error('❌ Error al insertar eventos:', error.message);
  }
}

// Ejecutar una vez al iniciar
insertarEventosDesdeSheets();

// Ejecutar cada 24 horas (medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Tarea programada ejecutándose...');
  insertarEventosDesdeSheets();
});
