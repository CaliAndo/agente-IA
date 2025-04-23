const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// CONFIGURACIÓN DEL SHEET
const sheetId = '1MMUh5RjXAtRH9EJiPHVhOGxGGEEqhbEI10F5LciBMMg';
const hoja = 'Hoja1'; // asegúrese que sea el nombre correcto
const url = `https://opensheet.elk.sh/${sheetId}/${hoja}`;
const filePath = path.join(__dirname, 'data', 'sitios_cali_google.json');

// Crear carpeta 'data' si no existe
if (!fs.existsSync(path.dirname(filePath))) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

// FUNCION DE ACTUALIZACIÓN
async function actualizarDatosDesdeGoogleSheet() {
  try {
    console.log('🔄 Descargando datos desde Google Sheets...');
    const res = await axios.get(url);
    fs.writeFileSync(filePath, JSON.stringify(res.data, null, 2));
    console.log(`✅ Datos actualizados correctamente en ${filePath}`);
  } catch (err) {
    console.error('❌ Error al obtener datos del Sheet:', err.message);
  }
}

// Ejecutar inmediatamente al iniciar
actualizarDatosDesdeGoogleSheet();

// Programar tarea para que se ejecute cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', () => {
  console.log('🕛 Ejecutando tarea programada...');
  actualizarDatosDesdeGoogleSheet();
});
