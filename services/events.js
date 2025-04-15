// 📁 services/events.js
const axios = require('axios');

const getEvents = async () => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_events',
        q: 'eventos en Cali',
        hl: 'es',
        gl: 'co',
        api_key: process.env.SERPAPI_KEY,
      }
    });

    return response.data.events_results || [];
  } catch (error) {
    console.error('❌ Error al buscar eventos:', error.message);
    return [];
  }
};

module.exports = { getEvents }; // <--- esto es lo que lo expone correctamente
