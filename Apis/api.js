const axios = require('axios');

const getPlaces = async (query) => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_maps',
        q: query, // Ej: 'lugares turísticos en Cali'
        location: 'Cali, Colombia',
        type: 'search',
        api_key: process.env.SERPAPI_KEY,
      }
    });

    // Puedes usar local_results o place_results, dependiendo del tipo de búsqueda
    return response.data.local_results || [];
  } catch (error) {
    console.error('❌ Error al buscar lugares con SerpAPI:', error);
    return [];
  }
};
