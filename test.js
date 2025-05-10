const axios = require('axios');
const qs    = require('querystring');

const SERPAPI_KEY      = process.env.SERPAPI_KEY;
// Fallback a "Cali, Colombia" si no lo defines en .env
const DEFAULT_LOCATION = process.env.DEFAULT_EVENT_LOCATION || 'Cali, Colombia';

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_KEY en tu .env');
}

async function getLiveEvents(q, location = DEFAULT_LOCATION, limit = 5) {
  try {
    console.log('🔎 getLiveEvents:', { q, location, limit });
    const params = { engine:'google_events', api_key:SERPAPI_KEY, q, location, hl:'es' };
    const url    = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);
    console.log('📬 eventos recibidos:', data.events_results?.length);
    if (!Array.isArray(data.events_results)) return [];
    return data.events_results.slice(0, limit).map(ev => ({
      title:       ev.title,
      date:        ev.date,
      description: ev.description,
      venue:       ev.venue,
      link:        ev.link,
    }));
  } catch (err) {
    console.error('❌ Error en getLiveEvents:', err.message);
    return [];
  }
}

module.exports = { getLiveEvents };
