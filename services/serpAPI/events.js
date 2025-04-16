// 📁 services/serpAPI/events.js
require('dotenv').config();
const axios = require('axios');

async function getEventosSerpAPI() {
  const apiKey = process.env.SERPAPI_KEY;

  try {
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
    return eventos.map(ev => ({
      title: ev.title,
      date: ev.date?.start_date || '',
      location: ev.address || '',
      description: ev.description || '',
      link: ev.link || ''
    }));
  } catch (error) {
    console.error('❌ Error en getEventosSerpAPI:', error.message);
    return [];
  }
}

module.exports = { getEventosSerpAPI }; // 👈 importante que sea un objeto con la función
