require('dotenv').config();
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generarEmbeddingConBackoff(texto, intento = 0) {
  const maxReintentos = 5;
  const delay = Math.pow(2, intento) * 1000; // backoff exponencial

  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: texto,
    });
    console.log('✅ Embedding generado:\n', response.data[0].embedding.slice(0, 5), '...');
    return response.data[0].embedding;
  } catch (error) {
    const status = error?.status || error?.response?.status;

    if (status === 429 && intento < maxReintentos) {
      const retryAfter = error.response?.headers?.['retry-after'];
      console.warn(`⚠️ Rate limit alcanzado. Retry-After: ${retryAfter || 'no especificado'}. Reintentando en ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return generarEmbeddingConBackoff(texto, intento + 1);
    } else {
      console.error('❌ Error generando embedding:', error.response?.data || error.message);
      return null;
    }
  }
}  

module.exports = { generarEmbeddingConBackoff };
