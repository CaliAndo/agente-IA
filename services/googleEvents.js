const axios = require('axios');
const qs    = require('querystring');

const SERPAPI_KEY      = process.env.SERPAPI_API_KEY;
const DEFAULT_LOCATION = process.env.DEFAULT_EVENT_LOCATION;

if (!SERPAPI_KEY) {
  throw new Error('🚨 Define SERPAPI_API_KEY en tu .env');
}

/**
 * Busca eventos en vivo o cercanos usando SerpApi Google Events.
 *
 * @param {string} q        — término de búsqueda (p.ej. "conciertos", "feria gastronómica")
 * @param {string} [location] — opcional, p.ej. "Cali, Colombia"
 * @param {number} [limit]    — cuántos resultados retornar (default 5)
 */
async function getLiveEvents(q, location = DEFAULT_LOCATION, limit = 5) {
  const params = {
    engine:   'google_events',
    api_key:  SERPAPI_KEY,
    q:        q,
    location: location,
    hl:       'es',
  };

  const url = `https://serpapi.com/search.json?${qs.stringify(params)}`;
  const { data } = await axios.get(url);

  if (!data.events_results?.length) return [];

  // Mapea resultados a un formato sencillo
  return data.events_results
    .slice(0, limit)
    .map(ev => ({
      title:       ev.title,
      date:        ev.date,        // p.ej. "Sáb, 10 Mayo 2025"
      description: ev.description, // resumen
      venue:       ev.venue,       // lugar
      link:        ev.link,        // URL al evento
    }));
}

module.exports = { getLiveEvents };
