const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

(async () => {
  try {
    const result = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: "Esto es una prueba directa desde un archivo de test.",
    });
    console.log("✅ Embedding generado:", result.data[0].embedding.slice(0, 5), "...");
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
})();
