require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { buscarCoincidencias } = require('./services/db/searchEngine');
const { getMeaningFromSerpAPI } = require('./services/dictionary/getMeaningFromSerpAPI');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {};
const eventosCache = {};

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase().trim() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  try {
    if (!isNaN(mensaje) && eventosCache[numero]) {
      const indice = parseInt(mensaje) - 1;
      const lista = eventosCache[numero].lista;

      if (lista[indice]) {
        const item = lista[indice];
        let respuesta = `📚 *${item.nombre}*\n\n`;
        if (item.descripcion) {
          respuesta += `📝 ${item.descripcion}\n\n`;
        }
        respuesta += `👉 ¿Deseas buscar otra cosa o abrir el menú?\nEscribe *otra búsqueda* o *menú*.`;

        twiml.message(respuesta);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        return;
      } else {
        twiml.message('❌ No encontré esa opción. Intenta con un número válido de la lista.');
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        return;
      }
    }

    if (mensaje.includes('ver mas') || mensaje.includes('ver más')) {
      const cache = eventosCache[numero];
      if (!cache) {
        twiml.message('ℹ️ Primero dime qué te gustaría hacer (por ejemplo: “quiero salir”, “quiero hacer un tour” o “cultura”).');
      } else {
        const inicio = (cache.pagina + 1) * 5;
        const nuevos = cache.lista.slice(inicio, inicio + 5);
        if (nuevos.length > 0) {
          cache.pagina++;
          const respuesta = nuevos.map((r, idx) => `${inicio + idx + 1}. ${r.nombre}`).join('\n\n');
          twiml.message(`📍 Más recomendaciones para ti:\n\n${respuesta}\n\n👉 ¿Deseas buscar otra cosa o abrir el menú?\nEscribe *otra búsqueda* o *menú*.`);
        } else {
          twiml.message('📭 Ya viste todas las recomendaciones disponibles. ¡Pronto habrá más!');
        }
      }

    } else if (mensaje.includes('volver')) {
      sessionData[numero] = undefined;
      twiml.message(`👋 ¡Hola! Soy *CaliAndo* 🤖 y estoy aquí para ayudarte a descubrir lo mejor de Cali 🇨🇴💃

Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?

👉 *Escribe "menú" para ver las opciones disponibles.*`);

    } else if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      twiml.message(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.

Por ejemplo: *borondo*, *ñapa*, *enguayabado*...`);

    } else if (mensaje.includes('menu') || mensaje.includes('menú')) {
      twiml.message(`📋 *Opciones disponibles*:
- Cultura 🎭
- Eventos 🎫
- Tours 🚐
- Diccionario 📚

👉 Escríbeme lo que quieras explorar.`);

    } else {
      if (!sessionData[numero]) {
        sessionData[numero] = { context: 'inicio' };
        twiml.message(`👋 ¡Hola! Soy *CaliAndo* 🤖 y estoy aquí para ayudarte a descubrir lo mejor de Cali 🇨🇴💃

Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?

👉 *Escribe "menú" para ver las opciones disponibles.*`);
      } else if (sessionData[numero]?.context === 'diccionario') {
        const significado = await getMeaningFromSerpAPI(mensaje);

        if (significado) {
          twiml.message(`📚 Significado de *${mensaje}*:\n\n${significado}\n\n👉 ¿Deseas buscar otra palabra o abrir el menú?\nEscribe *otra búsqueda* o *menú*.`);
        } else {
          twiml.message(`😔 No encontré un significado claro para *${mensaje}*. Intenta otra palabra o escribe *menú* para ver opciones.`);
        }
      } else {
        const coincidencias = await buscarCoincidencias(mensaje);

        if (coincidencias.length > 0) {
          eventosCache[numero] = { lista: coincidencias, pagina: 0 };
          const respuesta = coincidencias.slice(0, 5).map((r, idx) => `${idx + 1}. ${r.nombre}`).join('\n\n');
          twiml.message(`🔎 Encontré algunas opciones para ti:\n\n${respuesta}\n\n👉 ¿Deseas buscar otra cosa o abrir el menú?\nEscribe *otra búsqueda* o *menú*.`);
        } else {
          twiml.message('😔 ¡No encontré resultados relacionados! Puedes intentar buscar *cultura*, *eventos*, *tours* o escribir *menú*.');
        }
      }
    }

  } catch (error) {
    console.error('💥 Error inesperado en el webhook:', error);
    twiml.message('❌ Algo salió mal. Intenta de nuevo más tarde.');
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://localhost:${PORT}`);
});
