const axios = require('axios');
const qs = require('querystring');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const DEFAULT_LOCATION = process.env.DEFAULT_EVENT_LOCATION || 'Cali, Colombia';

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_KEY en tu .env');
}

async function getLiveEvents(q, location = DEFAULT_LOCATION, limit = 5) {
  try {
    console.log('🔎 getLiveEvents:', { q, location, limit });
    const params = {
      engine: 'google_events',
      api_key: SERPAPI_KEY,
      q,
      location,
      hl: 'es',
    };
    const url = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);

    console.log('📬 eventos recibidos:', data.events_results?.length);

    if (!Array.isArray(data.events_results)) return [];

    // Mapea los eventos
    return data.events_results.slice(0, limit).map(ev => ({
      title: ev.title,
      date: ev.date?.when || ev.date?.start_date || 'Fecha desconocida',
      venue: ev.venue?.name || ev.address?.join(', ') || 'Lugar desconocido',
      description: ev.description || 'Descripción no disponible',
      link: ev.link || 'No disponible',
      mapLink: ev.event_location_map?.link || 'No disponible',
      thumbnail: ev.thumbnail || 'No disponible'
    }));
  } catch (err) {
    console.error('❌ Error en getLiveEvents:', err.message);
    return [];
  }
}

module.exports = { getLiveEvents };
