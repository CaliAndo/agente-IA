require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { buscarCoincidencias } = require('./services/db/searchEngine');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');
const { getDetallePorFuente } = require('./services/db/getDetalle');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const sessionData = {};
const eventosCache = {};

// 🌐 Verificación del webhook (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('🟢 Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 📩 Recepción de mensajes (POST)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object) {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.type === 'text') {
      const numero = message.from;
      const mensaje = message.text.body.toLowerCase().trim();
      console.log('📨 Mensaje recibido:', mensaje);

      const sendMessage = async (text) => {
        await axios.post(
          `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: 'whatsapp',
            to: numero,
            text: { body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              'Content-Type': 'application/json',
            },
          }
        );
      };

      try {
        // 🟠 Usuario respondió con un número
        if (!isNaN(mensaje) && eventosCache[numero]) {
          const indice = parseInt(mensaje) - 1;
          const lista = eventosCache[numero].lista;

          if (lista[indice]) {
            const item = lista[indice];
            const detalle = await getDetallePorFuente(item.origen, item.id);

            let respuesta = `📚 *${detalle.nombre}*

`;
            if (detalle.descripcion) respuesta += `📝 ${detalle.descripcion}

`;
            if (detalle.precio && detalle.precio !== 'null') respuesta += `💰 Precio: ${detalle.precio}
`;
            if (detalle.ubicacion && detalle.ubicacion !== 'null') respuesta += `📍 Lugar: ${detalle.ubicacion}
`;
            if (detalle.enlace && detalle.enlace !== 'null') respuesta += `🔗 Más info: ${detalle.enlace}
`;

            respuesta += `
👉 ¿Deseas buscar otra cosa o abrir el menú?
Escribe *otra búsqueda* o *menú*.`;
            await sendMessage(respuesta);
            return res.sendStatus(200);
          } else {
            await sendMessage('❌ No encontré esa opción. Intenta con un número válido de la lista.');
            return res.sendStatus(200);
          }
        }

        // 🎉 Bienvenida
        if (['hola', 'buenas', 'hey', 'holi'].includes(mensaje)) {
          sessionData[numero] = { context: 'inicio' };
          await sendMessage(`👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali 🇨🇴💃\n\n👉 *Escribe "menú" para ver opciones o cuéntame qué te interesa*.`);
          return res.sendStatus(200);
        }

        // 👋 Despedida
        if (['gracias', 'chao', 'nos vemos', 'bye'].includes(mensaje)) {
          await sendMessage(`🙌 ¡Gracias por usar CaliAndo! Espero que disfrutes tu experiencia por Cali. 💃 Si necesitas algo más, solo escríbeme. ¡Hasta pronto!`);
          return res.sendStatus(200);
        }

        // 🔁 Ver más
        if (mensaje.includes('ver mas') || mensaje.includes('ver más')) {
          const cache = eventosCache[numero];
          if (!cache) {
            await sendMessage('ℹ️ Primero dime qué te gustaría hacer (ej: “quiero salir”, “tour”, “cultura”)');
          } else {
            const inicio = (cache.pagina + 1) * 5;
            const nuevos = cache.lista.slice(inicio, inicio + 5);
            if (nuevos.length > 0) {
              cache.pagina++;
              const respuesta = nuevos.map((r, idx) => `${inicio + idx + 1}. ${r.nombre}`).join('\n\n');
              await sendMessage(`📍 Más recomendaciones para ti:\n\n${respuesta}\n\n👉 ¿Deseas buscar otra cosa o abrir el menú?\nEscribe *otra búsqueda* o *menú*.`);
            } else {
              await sendMessage('📭 Ya viste todas las recomendaciones disponibles. ¡Pronto habrá más!');
            }
          }

        // 🔁 Volver
        } else if (mensaje.includes('volver')) {
          sessionData[numero] = undefined;
          await sendMessage(`👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali 🇨🇴💃\n\n👉 *Escribe "menú" para ver opciones.*`);

        // 📚 Diccionario
        } else if (mensaje.includes('diccionario')) {
          sessionData[numero] = { context: 'diccionario' };
          await sendMessage(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.\n\nEj: *borondo*, *ñapa*, *enguayabado*`);

        // 📋 Menú
        } else if (mensaje.includes('menu') || mensaje.includes('menú')) {
          await sendMessage(`📋 *Opciones disponibles*:\n- Cultura 🎭\n- Eventos 🎫\n- Tours 🚐\n- Diccionario 📚\n\n👉 Escríbeme lo que quieras explorar.`);

        // 🌐 Diccionario activo
        } else if (sessionData[numero]?.context === 'diccionario') {
          const significado = await getMeaningFromSerpAPI(mensaje);
          if (significado) {
            await sendMessage(`📚 *${mensaje}*:\n\n${significado}\n\n👉 Escribe *otra búsqueda* o *menú*.`);
          } else {
            await sendMessage(`😔 No encontré un significado claro para *${mensaje}*. Intenta otra palabra o escribe *menú*.`);
          }

        // 🎯 Búsqueda general
        } else {
          let tipo = '';
          if (mensaje.includes('evento')) tipo = 'eventos';
          else if (mensaje.includes('cultura')) tipo = 'cultura';
          else if (mensaje.includes('tour')) tipo = 'tours';
          else tipo = 'general';

          const resultados = await buscarCoincidencias(mensaje, tipo);
          if (resultados.length > 0) {
            eventosCache[numero] = { lista: resultados, pagina: 0 };
            const respuesta = resultados.slice(0, 5).map((r, idx) => `${idx + 1}. ${r.nombre}`).join('\n\n');
            await sendMessage(`🔎 Opciones encontradas:\n\n${respuesta}\n\n👉 Escribe el número para ver más información o escribe *ver más*, *menú*, u *otra búsqueda*.`);
          } else {
            await sendMessage('😔 ¡No encontré resultados! Intenta con *cultura*, *eventos*, *tours* o escribe *menú*.');
          }
        }

        res.sendStatus(200);
      } catch (error) {
        console.error('💥 Error en el webhook:', error);
        await sendMessage('❌ Ocurrió un error. Intenta más tarde.');
        res.sendStatus(500);
      }
    } else {
      res.sendStatus(200);
    }
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://localhost:${PORT}`);
});
