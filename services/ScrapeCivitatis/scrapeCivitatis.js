const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeCivitatis() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🧭 Navegando hacia Civitatis...');
  await page.goto('https://www.civitatis.com/es/cali/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  await page.waitForSelector('.comfort-card', { timeout: 30000 });
  await page.screenshot({ path: 'screenshot_civitatis.png', fullPage: true });
  console.log('📸 Captura tomada: screenshot_civitatis.png');

  const tours = await page.evaluate(() => {
    const data = [];
    const cards = document.querySelectorAll('.comfort-card');

    cards.forEach(card => {
      const titulo = card.querySelector('.comfort-card__title')?.innerText.trim();

      // Nuevo: obtener el link directo del <a>
      const aTag = card.querySelector('a');
      const rawHref = aTag?.getAttribute('href') || '';
      const link = rawHref.startsWith('http') ? rawHref : `https://www.civitatis.com${rawHref}`;

      const descEl = card.querySelector('.comfort-card__text');
      const descripcion = descEl ? descEl.innerText.replace(/\n/g, ' ').trim() : '';

      const viajeros = card.querySelector('.comfort-card__traveler-count_full')?.innerText.trim() || '';
      const precio = card.querySelector('.comfort-card__price')?.innerText.trim() || '';

      if (titulo && link) {
        data.push({ titulo, descripcion, link, viajeros, precio });
      }
    });

    return data;
  });

  await browser.close();

  if (tours.length === 0) {
    console.warn('⚠️ No se encontró ningún tour.');
  } else {
    const filePath = './data/civitatis_tours.json';
    fs.writeFileSync(filePath, JSON.stringify(tours, null, 2));
    console.log(`✅ ${tours.length} tours guardados en ${filePath}`);
  }

  tours.forEach((tour, i) => {
    console.log(`${i + 1}. ${tour.titulo}`);
    console.log(`🔗 ${tour.link}`);
    if (tour.descripcion) console.log(`📝 ${tour.descripcion}`);
    if (tour.viajeros) console.log(`👥 ${tour.viajeros}`);
    if (tour.precio) console.log(`💰 ${tour.precio}`);
    console.log();
  });
}

scrapeCivitatis().catch(err => {
  console.error('❌ Error al hacer scraping:', err);
});
