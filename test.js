require('dotenv').config();
const axios = require('axios');

const apiKey = process.env.OPENAI_API_KEY;

async function testEmbedding() {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        input: 'quiero bailar salsa',
        model: 'text-embedding-ada-002'
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }
      }
    );

    console.log('✅ Embedding generado:');
    console.log(response.data);
  } catch (error) {
    console.error('❌ Error al conectar con OpenAI:', error.response?.data || error.message);
  }
}

testEmbedding();
