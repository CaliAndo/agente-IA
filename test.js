const insertarEventosDesdeSheets = require('./services/GoogleSheets/GoogleSheets'); // Asegúrate de que la ruta sea correcta

// Llamada al scraper y ejecución
async function testScrapeSheets() {
  try {
    console.log("📥 Iniciando el scraping desde Google Sheets...");
    await insertarEventosDesdeSheets(); // Llama a la función que descarga los datos desde Google Sheets e inserta en la base de datos
    console.log("✅ Scraping completado y datos guardados en la base de datos.");
  } catch (err) {
    console.error("❌ Error al ejecutar el scraping desde Google Sheets:", err);
  }
}

testScrapeSheets(); // Ejecuta el test
