const axios = require('axios');
const qs    = require('querystring');

const SERPAPI_KEY      = process.env.SERPAPI_KEY;
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
  try {
    const params = {
      engine:  'google_events',
      api_key: SERPAPI_KEY,
      q,
      location,
      hl:      'es',
    };
    const url  = `https://serpapi.com/search.json?${qs.stringify(params)}`;
    const { data } = await axios.get(url);

    if (!Array.isArray(data.events_results)) return [];
    return data.events_results
      .slice(0, limit)
      .map(ev => ({
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
