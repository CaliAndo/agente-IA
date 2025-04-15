// 📁 index.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {}; // Para manejo de "ver más"

const getEvents = async () => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_events',
        q: 'eventos en Cali',
        hl: 'es',
        gl: 'co',
        api_key: process.env.SERPAPI_KEY,
      },
    });
    console.log('✅ Eventos recibidos:', response.data.events_results);
    return response.data.events_results || [];
  } catch (error) {
    console.error('❌ Error al buscar eventos:', error.message);
    return [];
  }
};

const getMeaningFromSerpAPI = async (question) => {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google',
        q: question,
        hl: 'es',
        gl: 'co',
        api_key: process.env.SERPAPI_KEY,
      },
    });

    const answerBox = response.data.answer_box;
    const snippet = response.data.organic_results?.[0]?.snippet;

    let result = null;
    if (answerBox?.answer) result = answerBox.answer;
    else if (answerBox?.snippet) result = answerBox.snippet;
    else if (snippet) result = snippet;

    if (result) {
      const lines = result.split('\n').slice(0, 3).join('\n');
      return lines.length > 300 ? lines.slice(0, 297) + '...' : lines;
    } else {
      return null;
    }
  } catch (error) {
    console.error('❌ Error al buscar significado:', error.message);
    return null;
  }
};

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  const isVerMas = mensaje.includes('ver más') || mensaje.includes('más eventos');

  try {
    if (mensaje.includes('eventos') || isVerMas) {
      let respuestaInicial = '🔎 Buscando los mejores eventos para ti...\n';

      if (sessionData[numero] && sessionData[numero].eventos.length > 0) {
        sessionData[numero].offset += 5;
      } else {
        const eventos = await getEvents();

        if (!eventos || eventos.length === 0) {
          twiml.message('😕 No encontré eventos disponibles en Cali en este momento. Intenta más tarde.');
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(twiml.toString());
          return;
        }

        sessionData[numero] = { eventos, offset: 0 };
      }

      const { eventos, offset } = sessionData[numero];
      const siguientes = eventos.slice(offset, offset + 5);

      if (siguientes.length === 0) {
        twiml.message('🚫 Ya viste todos los eventos disponibles por ahora.');
      } else {
        let msg = respuestaInicial + '\n🎭 *Eventos en Cali:*';
        siguientes.forEach((evento, i) => {
          msg += `\n${offset + i + 1}. *${evento.title}*\n📍 ${evento.address || 'Ubicación no disponible'}\n🗓 ${evento.date?.start_date || 'Fecha no disponible'}\n🔗 ${evento.link || 'Sin enlace'}\n`;
        });
        if (offset + 5 < eventos.length) {
          msg += `\n🔎 ¿Quieres más? Responde con *\"ver más eventos\"*`;
        }
        twiml.message(msg);
      }
    } else if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      twiml.message(
        `📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.\n` +
        `Por ejemplo: *borondo*, *ñapa*, *enguayabado*...`
      );
    } else if (sessionData[numero]?.context === 'diccionario') {
      const significado = await getMeaningFromSerpAPI(mensaje);
      if (significado) {
        twiml.message(`📖 ${significado}\n\n¿Quieres buscar otra palabra o volver al menú?`);
      } else {
        twiml.message('🤔 No encontré esa palabra, pero puedes probar con otra como *borondo* o *enguayabado*.');
      }
    } else if (mensaje.includes('qué es') || mensaje.includes('qué significa') || mensaje.includes('significa')) {
      const significado = await getMeaningFromSerpAPI(mensaje);
      console.log('📚 Significado:', significado);
      if (significado) {
        twiml.message(`📖 ${significado}`);
      } else {
        twiml.message('🤔 No encontré una definición clara, pero puedes intentar con otra palabra.');
      }
    } else if (mensaje.includes('comer') || mensaje.includes('comida')) {
      twiml.message(
        `😋 ¡Qué delicia! En Cali se come sabroso.\n¿Qué tipo de comida te provoca hoy?\n\n1️⃣ Comida típica caleña\n2️⃣ Casual y económica\n3️⃣ Gourmet o romántica\n4️⃣ Con buena vista o ambiente`
      );
    } else if (mensaje.includes('cultura') || mensaje.includes('arte')) {
      twiml.message(
        `🎨 ¡Plan cultural, me gusta!\n¿Qué te interesa más?\n\n1️⃣ Teatro\n2️⃣ Música en vivo\n3️⃣ Museos o exposiciones\n4️⃣ Recorridos históricos`
      );
    } else {
      sessionData[numero] = undefined;
      twiml.message(
        `👋 ¡Hola! Soy CaliAndo y estoy aquí para ayudarte a descubrir lo mejor de Cali. Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos? Estoy listo para mostrarte lo que esta ciudad sabrosa tiene para ti 🇨🇴💃\n\nEscribe una palabra clave para comenzar:\n- *eventos* 🎟️\n- *comer* 🍽️\n- *cultura* 🎭\n- *diccionario* 📖`
      );
    }
  } catch (error) {
    console.error('💥 Error inesperado en el webhook:', error);
    twiml.message('❌ Algo salió mal. Por favor, intenta de nuevo más tarde.');
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});
