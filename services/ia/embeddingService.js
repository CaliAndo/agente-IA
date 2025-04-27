// 📁 services/ai/embeddingService.js

const OpenAI = require('openai'); // Nueva forma
require('dotenv').config();

// Crear instancia de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generarEmbedding(texto) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: texto,
    });

    return response.data[0].embedding; 
  } catch (error) {
    console.error('Error generando embedding:', error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  generarEmbedding,
};
