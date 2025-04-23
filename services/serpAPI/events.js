// 📁 services/serpAPI/serpapi_eventFetcher.js
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const filePath = path.join(__dirname, '../../data/serpapi_eventos.json');
const apiKey = process.env.SERPAPI_KEY;

async function fetchAndSaveEventos() {
  try {
    console.log('🔎 Consultando eventos desde SerpAPI...');

    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_events',
        q: 'eventos en Cali',
        hl: 'es',
        gl: 'co',
        api_key: apiKey
      }
    });

    const eventos = response.data.events_results || [];

    const formatoFinal = eventos.map(ev => ({
      title: ev.title,
      date: ev.date?.start_date || '',
      location: ev.address || '',
      description: ev.description || '',
      link: ev.link || ''
    }));

    fs.writeFileSync(filePath, JSON.stringify(formatoFinal, null, 2));
    console.log(`✅ ${formatoFinal.length} eventos guardados en ${filePath}\n`);
  } catch (error) {
    console.error('❌ Error al obtener eventos de SerpAPI:', error.message);
  }
}

// Ejecutar inmediatamente
fetchAndSaveEventos();

// Programar para que corra cada 24 horas (a medianoche)
cron.schedule('0 0 * * *', fetchAndSaveEventos);
