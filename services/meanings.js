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
  
      if (answerBox?.answer) {
        return answerBox.answer;
      } else if (answerBox?.snippet) {
        return answerBox.snippet;
      } else if (snippet) {
        return snippet;
      } else {
        return null;
      }
    } catch (error) {
      console.error('❌ Error al buscar significado:', error.message);
      return null;
    }
  };
  module.exports = { getMeaningFromSerpAPI };