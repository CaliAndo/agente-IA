require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SERPAPI_URL = 'https://serpapi.com/search.json';

// 🔁 Para llevar la cuenta por número
const sessionData = {}; // { [numero]: { offset: 0, eventos: [] } }

// 🔍 Función para buscar eventos una sola vez
const getEvents = async () => {
  try {
    const response = await axios.get(SERPAPI_URL, {
      params: {
        engine: 'google_events',
        q: 'eventos en Cali',
        hl: 'es',
        gl: 'co',
        api_key: process.env.SERPAPI_KEY,
      }
    });

    return response.data.events_results || [];
  } catch (error) {
    console.error('❌ Error al buscar eventos con SerpAPI:', error.response?.data || error.message);
    return [];
  }
};

// 📩 Webhook de Twilio
app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);
  console.log('📱 Número:', numero);

  const isVerMas = mensaje.includes('ver más') || mensaje.includes('más eventos');

  if (mensaje.includes('eventos') || isVerMas) {
    // Si ya tiene eventos guardados
    if (sessionData[numero] && sessionData[numero].eventos.length > 0) {
      // Mostrar los siguientes
      sessionData[numero].offset += 5;
    } else {
      // Buscar eventos y guardar
      const eventos = await getEvents();
      if (eventos.length === 0) {
        twiml.message('😕 No encontré eventos disponibles en Cali en este momento. Intenta más tarde.');
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        return;
      }

      sessionData[numero] = {
        eventos,
        offset: 0
      };
    }

    const { eventos, offset } = sessionData[numero];
    const siguientes = eventos.slice(offset, offset + 5);

    if (siguientes.length === 0) {
      twiml.message('🚫 Ya viste todos los eventos disponibles por ahora.\nIntenta de nuevo más tarde.');
    } else {
      let msg = '🎭 *Eventos en Cali:*\n';
      siguientes.forEach((evento, i) => {
        msg += `\n${offset + i + 1}. *${evento.title}*\n📍 ${evento.address || 'Ubicación no disponible'}\n🗓 ${evento.date?.start_date || 'Fecha no disponible'}\n🔗 ${evento.link || 'Sin enlace'}\n`;
      });

      // Sugerencia para ver más
      if (offset + 5 < eventos.length) {
        msg += `\n🔎 ¿Quieres más? Responde con *"ver más eventos"*`;
      } else {
        msg += `\n🚫 Ya viste todos los eventos por ahora.`;
      }

      twiml.message(msg);
    }
  } else {
    // Reinicia la sesión si se habla de otra cosa
    sessionData[numero] = undefined;

    // Menú de bienvenida
    twiml.message(
      `👋 ¡Hola! Soy el bot de *Cali Ando*, tu guía de eventos en Cali.\n\n` +
      `Escribe *eventos* para ver qué hay hoy.\n` +
      `Luego puedes escribir *ver más eventos* para descubrir más planes.`
    );
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// 🚀 Inicia el servidor
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});
