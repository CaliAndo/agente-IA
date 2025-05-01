const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const cron = require('node-cron');
const { generarEmbedding } = require('../services/ai/embeddingService'); // Ajusta la ruta si es diferente
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function scrapeCivitatis() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🧭 Navegando hacia Civitatis...');
  await page.goto('https://www.civitatis.com/es/cali/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForSelector('.comfort-card', { timeout: 30000 });
  console.log('📸 Página cargada y lista para el scraping');

  const tours = await page.evaluate(() => {
    const data = [];
    const cards = document.querySelectorAll('.comfort-card');

    cards.forEach(card => {
      const titulo = card.querySelector('.comfort-card__title')?.innerText.trim();
      const descEl = card.querySelector('.comfort-card__text');
      const descripcion = descEl ? descEl.innerText.replace(/\n/g, ' ').trim() : '';
      const viajeros = card.querySelector('.comfort-card__traveler-count_full')?.innerText.trim() || '';
      const precio = card.querySelector('.comfort-card__price')?.innerText.trim() || '';

      if (titulo) {
        data.push({ titulo, descripcion, viajeros, precio });
      }
    });

    return data;
  });

  await browser.close();
  console.log(`📝 Se han recopilado ${tours.length} tours.`);

  if (tours.length === 0) {
    console.warn('⚠️ No se encontró ningún tour.');
    return;
  }

  let insertados = 0;

  for (const tour of tours) {
    const evento_id = await getEventoIdByTitulo(tour.titulo);

    if (!evento_id) {
      console.log(`➕ Insertando nuevo evento: ${tour.titulo}`);

      // Generar embedding
      const texto = `${tour.titulo}. ${tour.descripcion}`;
      const embedding = await generarEmbedding(texto);

      const insertEventoQuery = `
        INSERT INTO eventos (nombre, descripcion, embedding)
        VALUES ($1, $2, $3)
        RETURNING id
      `;
      const insertEventoResult = await pool.query(insertEventoQuery, [tour.titulo, tour.descripcion, embedding]);
      const newEventoId = insertEventoResult.rows[0].id;

      console.log(`🧠 Embedding generado e insertado para evento ID: ${newEventoId}`);

      await insertCivitatis(newEventoId, tour);
      insertados++;
    } else {
      console.log(`➡️ Insertando tour vinculado a evento existente: ${evento_id}`);
      await insertCivitatis(evento_id, tour);
      insertados++;
    }
  }

  console.log(`✅ ${insertados} tours guardados en la base de datos.`);

  // Imprimir resumen
  tours.forEach((tour, i) => {
    console.log(`${i + 1}. ${tour.titulo}`);
    if (tour.descripcion) console.log(`📝 ${tour.descripcion}`);
    if (tour.viajeros) console.log(`👥 ${tour.viajeros}`);
    if (tour.precio) console.log(`💰 ${tour.precio}`);
    console.log();
  });
}

async function getEventoIdByTitulo(titulo) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1';
  const res = await pool.query(query, [titulo]);
  return res.rows[0]?.id || null;
}

async function insertCivitatis(evento_id, tour) {
  const query = `
    INSERT INTO civitatis (evento_id, titulo, descripcion, viajeros, precio, fuente)
    VALUES ($1, $2, $3, $4, $5, 'Civitatis')
  `;
  await pool.query(query, [evento_id, tour.titulo, tour.descripcion, tour.viajeros, tour.precio]);
}

// Programar ejecución diaria
cron.schedule('0 0 * * *', () => {
  console.log('🕒 Ejecutando scraping programado de Civitatis...');
  scrapeCivitatis();
});

console.log('✅ Sistema de scraping de Civitatis activo cada 24 horas.');
