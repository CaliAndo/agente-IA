const axios = require('axios');

const apiKey = process.env.SERPAPI_KEY;

async function getLiveEvents(query = 'Eventos en Cali') {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: query,
        location: 'Cali, Valle del Cauca, Colombia',
        hl: 'es',
        gl: 'co',
        api_key: apiKey,
      }
    });

    const rawEventos = response.data.events_results || [];

    // Filtramos por eventos con dirección en Cali
    const eventos = rawEventos.filter(ev => {
      const addr = Array.isArray(ev.address) ? ev.address.join(', ') : ev.address || '';
      return addr.toLowerCase().includes('cali');
    });

    // Normalizamos formato
    return eventos.map(ev => ({
      title: ev.title || 'Sin título',
      date: ev.date?.when || 'Fecha por confirmar',
      venue: Array.isArray(ev.address) ? ev.address.join(', ') : ev.address || 'Lugar por confirmar',
      description: ev.description || '',
      link: ev.link || '',
      fuente: 'serpapi'
    }));
  } catch (err) {
    console.error('❌ Error buscando en SerpAPI:', err.message);
    return [];
  }
}

module.exports = { getLiveEvents };
