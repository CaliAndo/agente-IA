const axios = require('axios');
const qs = require('querystring');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const DEFAULT_LOCATION = process.env.DEFAULT_EVENT_LOCATION || 'Cali, Colombia';

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_KEY en tu .env');
}

async function getLiveEvents() {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
          params: {
            engine: 'google',
            q: "Eventos en Cali",
            location: 'Cali, Valle del Cauca, Colombia',
            hl: 'es',
            gl: 'co',
            api_key: apiKey,
          }
        });

    const url = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);

    const eventosRaw = data.events_results || [];

    // Filtra eventos cuya dirección mencione "Cali"
    const eventosFiltrados = eventosRaw.filter(ev => {
      const dir = Array.isArray(ev.address)
        ? ev.address.join(', ').toLowerCase()
        : (ev.address || '').toLowerCase();

      return dir.includes('cali');
    });

    // Quita duplicados por título
    const vistos = new Set();
    const eventosUnicos = eventosFiltrados.filter(ev => {
      if (vistos.has(ev.title)) return false;
      vistos.add(ev.title);
      return true;
    });

    // Mapea los resultados
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
