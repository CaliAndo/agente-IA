const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generarEmbedding(texto) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texto,
    });

    if (response?.data?.length > 0 && response.data[0].embedding) {
      return response.data[0].embedding;
    } else {
      throw new Error('No se obtuvo embedding válido');
    }
  } catch (error) {
    console.error('❌ Error generando embedding para texto:', texto.slice(0, 100));
    console.error('🔧 Detalle:', error.response?.data || error.message);
    return null;
  }
}

module.exports = {
  generarEmbedding,
};
