// 📁 index.js
require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { getEvents } = require('./services/events');
const { getMeaningFromSerpAPI } = require('./services/meanings');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {}; // Para manejo de "ver más"

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  const isVerMas = mensaje.includes('ver más') || mensaje.includes('más eventos');

  if (mensaje.includes('eventos') || isVerMas) {
    twiml.message('🔎 Buscando los mejores eventos para ti...');
    if (sessionData[numero] && sessionData[numero].eventos.length > 0) {
      sessionData[numero].offset += 5;
    } else {
      const eventos = await getEvents();
      if (eventos.length === 0) {
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
      let msg = '🎭 *Eventos en Cali:*"'
      siguientes.forEach((evento, i) => {
        msg += `\n${offset + i + 1}. *${evento.title}*\n📍 ${evento.address || 'Ubicación no disponible'}\n🗓 ${evento.date?.start_date || 'Fecha no disponible'}\n🔗 ${evento.link || 'Sin enlace'}\n`;
      });
      if (offset + 5 < eventos.length) {
        msg += `\n🔎 ¿Quieres más? Responde con *\"ver más eventos\"*`;
      }
      twiml.message(msg);
    }
  } else if (mensaje.includes('qué es') || mensaje.includes('qué significa') || mensaje.includes('significa')) {
    const significado = await getMeaningFromSerpAPI(mensaje);
    if (significado) {
      twiml.message(`📖 ${significado}`);
    } else {
      twiml.message('🤔 No encontré una definición clara, pero puedes intentar con otra palabra.');
    }
  } else {
    sessionData[numero] = undefined;
    twiml.message(
      `👋 ¡Hola! Soy el bot de *Cali Ando*, tu guía de eventos y cultura caleña.\n\n` +
      `Escribe *eventos* para ver qué hay hoy en Cali 🎉\n` +
      `O pregúntame qué significa una palabra como *borondo*, *ñapa*, *enguayabado* 🗣️.`
    );
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});