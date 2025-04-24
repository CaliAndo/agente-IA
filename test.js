const scrapeMuseos= require('./services/scrapersVisitCali/museos'); // Importa la función desde sheet-scraper.js

async function testLugares() {
  try {
    console.log("🚀 Iniciando prueba de inserción de lugares...");
    await scrapeMuseos(); // Llama a la función para insertar los lugares en la base de datos
    console.log("✅ Prueba completada, los lugares se insertaron correctamente.");
  } catch (error) {
    console.error("❌ Error en la prueba de inserción de lugares:", error);
  }
}

testLugares(); // Ejecuta la prueba
