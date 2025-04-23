const fs = require('fs');
const path = require('path');
const scrapeImperdibles = require('./services/scrapersVisitCali/imperdibles');
const scrapeMuseos = require('./services/scrapersVisitCali/museos');
const { getEventosSerpAPI } = require('./services/serpAPI/getEventosRaw');
const insertarEventos = require('./services/db/insertEventos');

async function runDataCollector() {
  console.log('🚀 Iniciando recopilación de datos...\n');

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log('📁 Carpeta /data creada');
  }

  const imperdibles = await scrapeImperdibles();
  const museos = await scrapeMuseos();
  const eventosSerpAPI = await getEventosSerpAPI();

  const allData = {
    imperdibles,
    museos,
    eventos_serpapi: eventosSerpAPI
  };

  const outputPath = path.join(dataDir, 'caliEventos.json');
  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
  console.log(`✅ Datos guardados en ${outputPath}`);

  // 🔁 Guardar también en la base de datos
  await insertarEventos(eventosSerpAPI);
}

runDataCollector();
