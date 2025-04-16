require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');

const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');
const { detectarCategoria } = require('./services/categories');
const { getEventosSerpAPI } = require('./services/serpAPI/events');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {};
const eventosCache = {}; // { numero: { lista: [], pagina: 0 } }

let imperdibles = [];
let museos = [];

try {
  const rawData = fs.readFileSync('./data/caliEventos.json', 'utf8');
  const json = JSON.parse(rawData);
  imperdibles = json.imperdibles || [];
  museos = json.museos || [];
} catch (e) {
  console.error('❌ No se pudo leer caliEventos.json:', e.message);
}

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  try {
    if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      twiml.message(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.\nPor ejemplo: *borondo*, *ñapa*, *enguayabado*...`);

    } else if (sessionData[numero]?.context === 'diccionario') {
      const significado = await getMeaningFromSerpAPI(mensaje);
      if (significado) {
        twiml.message(`📖 ${significado}\n\n¿Quieres buscar otra palabra o volver al menú?`);
      } else {
        twiml.message('🤔 No encontré esa palabra. Prueba con otra como *borondo* o *enguayabado*.');
      }

    } else if (mensaje.includes('qué es') || mensaje.includes('qué significa') || mensaje.includes('significa')) {
      const significado = await getMeaningFromSerpAPI(mensaje);
      if (significado) {
        twiml.message(`📖 ${significado}`);
      } else {
        twiml.message('🤔 No encontré una definición clara, prueba con otra palabra.');
      }

    } else if (mensaje.includes('comer') || mensaje.includes('comida')) {
      twiml.message(`😋 ¿Qué tipo de comida te provoca hoy?\n\n1️⃣ Comida típica caleña\n2️⃣ Casual y económica\n3️⃣ Gourmet o romántica\n4️⃣ Con buena vista o ambiente`);

    } else if (mensaje.includes('cultura') || mensaje.includes('arte')) {
      const eventos = museos.map(e => `🏛️ ${e.title}\n🔗 ${e.link}`);
      twiml.message(`🎨 ¡Plan cultural activado! Aquí tienes algunos museos en Cali:\n\n${eventos.slice(0, 5).join('\n\n')}\n\n👈 Escribe 'volver' para regresar al menú.`);

    } else if (mensaje.includes('eventos')) {
      const serpEventos = await getEventosSerpAPI();
      const todosEventos = [
        ...serpEventos.map(e => `🎫 ${e.title} (${e.date || 'Fecha no disponible'})\n${e.link || ''}`),
        ...imperdibles.map(e => `📌 ${e.title}\n🔗 ${e.link}`)
      ];

      eventosCache[numero] = { lista: todosEventos, pagina: 0 };
      const primeros = todosEventos.slice(0, 5).join('\n\n');

      twiml.message(`🎉 Eventos en Cali:\n\n${primeros}\n\n👉 Responde con *ver mas* para seguir viendo o *volver* para regresar.`);

    } else if (mensaje.includes('ver mas')) {
      const cache = eventosCache[numero];
      if (!cache) {
        twiml.message('ℹ️ Primero escribe *eventos* para ver la lista disponible.');
      } else {
        const inicio = (cache.pagina + 1) * 5;
        const nuevos = cache.lista.slice(inicio, inicio + 5);
        if (nuevos.length > 0) {
          cache.pagina++;
          twiml.message(`📍 ver mas:\n\n${nuevos.join('\n\n')}\n\n👉 Escribe *ver mas* para seguir o *volver* para regresar.`);
        } else {
          twiml.message('📭 Ya viste todos los eventos disponibles. ¡Pronto habrá más!');
        }
      }

    } else if (mensaje.includes('volver')) {
      sessionData[numero] = undefined;
      twiml.message(`👋 Bienvenido de vuelta a *CaliAndo*. ¿Qué quieres hacer hoy?\n\n- *comer* 🍽️\n- *cultura* 🎭\n- *eventos* 🎫\n- *diccionario* 📖`);

    } else {
      sessionData[numero] = undefined;
      twiml.message(`👋 ¡Hola! Soy *CaliAndo*. ¿Qué quieres hacer hoy en Cali?\n\n- *comer* 🍽️\n- *cultura* 🎭\n- *eventos* 🎫\n- *diccionario* 📖`);
    }
  } catch (error) {
    console.error('💥 Error inesperado en el webhook:', error);
    twiml.message('❌ Algo salió mal. Intenta de nuevo más tarde.');
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});
