const axios = require('axios');
require('dotenv').config(); // Por si acaso (por buenas prácticas)

const getMeaningFromSerpAPI = async (question) => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: question,
        hl: 'es',  // idioma español
        gl: 'co',  // país Colombia
        api_key: process.env.SERPAPI_KEY,
      }
    });

    const { answer_box, organic_results } = response.data;
    let result = null;

    if (answer_box?.answer) {
      result = answer_box.answer;
    } else if (answer_box?.snippet) {
      result = answer_box.snippet;
    } else if (organic_results?.[0]?.snippet) {
      result = organic_results[0].snippet;
    }

    if (result) {
      // Limitar el texto a máximo 3 líneas para WhatsApp
      const lines = result.split('\n');
      return lines.slice(0, 3).join('\n');
    } else {
      return null;
    }
  } catch (error) {
    console.error('❌ Error al buscar significado en SerpAPI:', error.message);
    return null;
  }
};

module.exports = { getMeaningFromSerpAPI };
