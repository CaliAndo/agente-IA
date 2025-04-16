const fs = require('fs');
const path = require('path');

// 📥 Importamos scrapers individuales
const scrapeImperdibles = require('./services/scrapersVisitCali/imperdibles');
const scrapeMuseos = require('./services/scrapersVisitCali/museos');


async function runDataCollector() {
  console.log('🚀 Iniciando recopilación de datos...\n');

  // ✅ Asegurarse de que exista la carpeta 'data'
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
    console.log('📁 Carpeta /data creada');
  }

  const imperdibles = await scrapeImperdibles();
  const museos = await scrapeMuseos();

  const allData = {
    imperdibles,
    museos
  };

  const outputPath = path.join(dataDir, 'caliEventos.json');
  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
  console.log(`✅ Todos los datos han sido recopilados y guardados en ${outputPath}`);
}

runDataCollector();
