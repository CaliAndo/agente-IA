const axios = require('axios');
const qs = require('querystring');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_KEY en tu .env');
}

async function getLiveEvents() {
  try {
    const params = {
      engine: 'google_events',
      api_key: SERPAPI_KEY,
      q: 'Eventos en Cali',
      location: 'Cali, Valle del Cauca, Colombia',
      hl: 'es',
    };

    const url = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);

    return data.events_results || [];
  } catch (err) {
    console.error('❌ Error en getLiveEvents:', err.message);
    return [];
  }
}

module.exports = { getLiveEvents };
