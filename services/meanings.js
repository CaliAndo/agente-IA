const axios = require('axios');

const getMeaningFromSerpAPI = async (question) => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: question,
        hl: 'es',
        gl: 'co',
        api_key: process.env.SERPAPI_KEY
      }
    });

    const answerBox = response.data.answer_box;
    const snippet = response.data.organic_results?.[0]?.snippet;

    let result = null;

    if (answerBox?.answer) {
      result = answerBox.answer;
    } else if (answerBox?.snippet) {
      result = answerBox.snippet;
    } else if (snippet) {
      result = snippet;
    }

    if (result) {
      // Limitar a máximo 3 líneas
      const lines = result.split('\n');
      return lines.slice(0, 3).join('\n');
    } else {
      return null;
    }
  } catch (error) {
    console.error('❌ Error al buscar significado:', error.message);
    return null;
  }
};

module.exports = { getMeaningFromSerpAPI };
