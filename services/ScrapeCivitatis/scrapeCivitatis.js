const puppeteer = require('puppeteer');
const { Pool } = require('pg');
require('dotenv').config();

// Configuración de PostgreSQL
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

async function scrapeCivitatis() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🧭 Navegando hacia Civitatis...');
  await page.goto('https://www.civitatis.com/es/cali/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForSelector('.comfort-card', { timeout: 30000 });
  console.log('📸 Página cargada y lista para el scraping');

  const tours = await page.evaluate(() => {
    const data = [];
    const cards = document.querySelectorAll('.comfort-card');
    console.log(`Se encontraron ${cards.length} tours en la página.`);

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
  } else {
    let insertados = 0;
    for (const tour of tours) {
      console.log(`➡️ Insertando: ${tour.titulo}`);

      // Verificar si el evento ya existe en la tabla `eventos`
      const evento_id = await getEventoIdByTitulo(tour.titulo);

      if (!evento_id) {
        console.log(`⚠️ No se encontró evento_id para el tour: ${tour.titulo}. Insertando nuevo evento...`);
        // Si el evento no existe, insertar el evento en `eventos`
        const insertEventoQuery = `
          INSERT INTO eventos (nombre, descripcion)
          VALUES ($1, $2)
          RETURNING id
        `;
        const insertEventoResult = await pool.query(insertEventoQuery, [tour.titulo, tour.descripcion]);
        const newEventoId = insertEventoResult.rows[0].id;
        console.log(`Nuevo evento insertado con ID: ${newEventoId}`);

        // Ahora insertamos el tour en `civitatis` usando el `evento_id` recién insertado
        await insertCivitatis(newEventoId, tour);
        insertados++;
      } else {
        console.log(`➡️ Insertando tour con evento_id: ${evento_id}`);
        await insertCivitatis(evento_id, tour);
        insertados++;
      }
    }

    console.log(`✅ ${insertados} tours guardados en la base de datos.`);
  }

  tours.forEach((tour, i) => {
    console.log(`${i + 1}. ${tour.titulo}`);
    if (tour.descripcion) console.log(`📝 ${tour.descripcion}`);
    if (tour.viajeros) console.log(`👥 ${tour.viajeros}`);
    if (tour.precio) console.log(`💰 ${tour.precio}`);
    console.log();
  });
}

// Función para obtener el ID del evento usando el título
async function getEventoIdByTitulo(titulo) {
  const query = 'SELECT id FROM eventos WHERE nombre = $1'; 
  const res = await pool.query(query, [titulo]);
  return res.rows[0]?.id || null;
}

// Función para insertar los detalles del tour en `civitatis`
async function insertCivitatis(evento_id, tour) {
  const query = `
    INSERT INTO civitatis (evento_id, titulo, descripcion, viajeros, precio, fuente)
    VALUES ($1, $2, $3, $4, $5, 'Civitatis')
  `;
  await pool.query(query, [evento_id, tour.titulo, tour.descripcion, tour.viajeros, tour.precio]);
}

scrapeCivitatis().catch(err => {
  console.error('❌ Error al hacer scraping:', err);
});

module.exports = scrapeCivitatis;
