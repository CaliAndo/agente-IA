const axios = require('axios');
const qs = require('querystring');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const DEFAULT_LOCATION = process.env.DEFAULT_EVENT_LOCATION || 'Cali, Colombia';

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_KEY en tu .env');
}

async function getLiveEvents(limit = 5) {
  try {
    const params = {
      engine: 'google_events',
      api_key: SERPAPI_KEY,
      q: 'Eventos en Cali',
      location: DEFAULT_LOCATION,
      hl: 'es',
      no_cache: true,
      htichips: 'date:today',
    };

    const url = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);

    const eventosRaw = data.events_results || [];

    const eventosFiltrados = eventosRaw.filter(ev => {
      const dir = Array.isArray(ev.address)
        ? ev.address.join(', ').toLowerCase()
        : (ev.address || '').toLowerCase();
      const venue = (ev.venue?.name || '').toLowerCase();
      return dir.includes('cali') || venue.includes('cali');
    });

    const vistos = new Set();
    const eventosUnicos = eventosFiltrados.filter(ev => {
      if (vistos.has(ev.title)) return false;
      vistos.add(ev.title);
      return true;
    });

    return eventosUnicos.slice(0, limit).map(ev => ({
      title: ev.title,
      date: ev.date?.when || ev.date?.start_date || 'Fecha desconocida',
      venue: ev.venue?.name || (Array.isArray(ev.address) ? ev.address.join(', ') : ev.address) || 'Lugar desconocido',
      description: ev.description || 'Descripción no disponible',
      link: ev.link || '',
      mapLink: ev.event_location_map?.link || '',
      thumbnail: ev.thumbnail || '',
    }));
  } catch (err) {
    console.error('❌ Error en getLiveEvents:', err.message);
    return [];
  }
}

module.exports = { getLiveEvents };
