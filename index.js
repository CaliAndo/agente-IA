require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const FASTAPI_URL = process.env.FASTAPI_URL;

if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

const sessionData = {};
const eventosCache = {};
const inactividadTimers = {};

const resetUserState = (numero) => {
  sessionData[numero] = { context: 'inicio' };
  delete eventosCache[numero];
  clearTimeout(inactividadTimers[numero]?.warning);
  clearTimeout(inactividadTimers[numero]?.close);
  delete inactividadTimers[numero];
};

const normalizar = (txt) =>
  txt.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const iniciarInactividad = async (numero, sendMessage, tipo = 'completo') => {
  clearTimeout(inactividadTimers[numero]?.warning);
  clearTimeout(inactividadTimers[numero]?.close);

  inactividadTimers[numero] = {
    warning: tipo === 'completo' ? setTimeout(async () => {
      await sendMessage('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?');
    }, 60000) : null,
    close: setTimeout(async () => {
      await sendMessage('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUserState(numero);
    }, tipo === 'completo' ? 120000 : 60000)
  };
};

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

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object) {
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message && message.type === 'text') {
      const numero = message.from;
      const rawMensaje = message.text.body;
      const mensaje = normalizar(rawMensaje);

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

      clearTimeout(inactividadTimers[numero]?.warning);
      clearTimeout(inactividadTimers[numero]?.close);

      try {
        if (["menu", "volver", "otra busqueda"].some(p => mensaje.includes(p))) {
          resetUserState(numero);
          await sendMessage(`📋 Menú principal:\n\nPuedes escribirme algo como:\n• *eventos*\n• *cultura*\n• *tour*\n• *salsa*\n\nY te mostraré lo mejor de Cali 🇨🇴`);
          return res.sendStatus(200);
        }

        if (["hola", "buenas", "hey", "holi"].includes(mensaje)) {
          resetUserState(numero);
          await sendMessage(`👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali.\n\nCuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?\n\nEstoy listo para mostrarte lo que esta ciudad sabrosa tiene para ti 🇨🇴💃`);
          iniciarInactividad(numero, sendMessage);
          return res.sendStatus(200);
        }

        if (!isNaN(mensaje) && eventosCache[numero]) {
          const index = parseInt(mensaje) - 1;
          const item = eventosCache[numero].lista[index];

          if (item) {
            const detalle = await getDetallePorFuente(item.fuente, item.referencia_id);

            if (!detalle) {
              await sendMessage('❌ No encontré detalles para esa opción.');
              return res.sendStatus(200);
            }

            let respuesta = `📚 *${detalle.nombre}*\n\n`;
            if (detalle.descripcion) respuesta += `📜 ${detalle.descripcion}\n\n`;
            if (detalle.precio && detalle.precio !== 'null') respuesta += `💰 Precio: ${detalle.precio}\n`;
            if (detalle.ubicacion && detalle.ubicacion !== 'null') respuesta += `📍 Lugar: ${detalle.ubicacion}\n`;
            if (detalle.enlace && detalle.enlace !== 'null') respuesta += `🔗 Más info: ${detalle.enlace}\n`;

            respuesta += `\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`;
            resetUserState(numero);
            await sendMessage(respuesta);
            return res.sendStatus(200);
          } else {
            await sendMessage('❌ Opción inválida. Escribe un número de la lista.');
            return res.sendStatus(200);
          }
        }

        if (mensaje.includes('ver mas')) {
          const cache = eventosCache[numero];
          if (!cache) {
            await sendMessage('ℹ️ No hay resultados activos. Escribe algo como *tour* o *eventos*.');
            return res.sendStatus(200);
          }

          const inicio = (cache.pagina + 1) * 5;
          const nuevos = cache.lista.slice(inicio, inicio + 5);

          if (nuevos.length > 0) {
            cache.pagina++;
            const respuesta = nuevos.map((r, i) => `${inicio + i + 1}. ${r.nombre}`).join('\n\n');
            await sendMessage(`📍 Más recomendaciones:\n\n${respuesta}\n\n🔀 Escribe un número o *otra búsqueda* para continuar.`);
          } else {
            await sendMessage('📜 Ya viste todos los resultados disponibles.');
          }
          iniciarInactividad(numero, sendMessage);
          return res.sendStatus(200);
        }

        if (mensaje.includes('diccionario')) {
          sessionData[numero] = { context: 'diccionario' };
          await sendMessage(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra para explicártela.\n\nEj: *ñapa*, *enguayabado*, *borondo*`);
          iniciarInactividad(numero, sendMessage);
          return res.sendStatus(200);
        }

        if (sessionData[numero]?.context === 'diccionario') {
          const significado = await getMeaningFromSerpAPI(mensaje);
          if (significado) {
            await sendMessage(`📚 *${mensaje}*:\n\n${significado}\n\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`);
          } else {
            await sendMessage(`😔 No encontré el significado de *${mensaje}*. Prueba otra palabra.`);
          }
          iniciarInactividad(numero, sendMessage);
          return res.sendStatus(200);
        }

        const contexto = sessionData[numero]?.context;
        if (!eventosCache[numero] && (contexto === 'inicio' || contexto === 'resultados' || !contexto)) {
          const respuesta = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
            texto: mensaje,
            fuente: "whatsapp",
            nombre: "CaliAndo"
          });

          const lista = respuesta.data.resultados || [];
          if (!respuesta.data.ok || lista.length === 0) {
            await sendMessage('😔 No encontré nada con esas palabras. Intenta con *eventos*, *tour*, *salsa*, etc.');
            iniciarInactividad(numero, sendMessage, 'soloCierre');
            return res.sendStatus(200);
          }

          eventosCache[numero] = { lista, pagina: 0 };
          sessionData[numero] = { context: 'resultados' };

          const primeros = lista.slice(0, 5);
          const texto = primeros.map((item, i) => `${i + 1}. ${item.nombre}`).join('\n\n');
          await sendMessage(`🔎 Encontré estas opciones:\n\n${texto}\n\n🔀 Escribe un número para ver más detalles o *ver más* para más opciones.`);
          iniciarInactividad(numero, sendMessage);
          return res.sendStatus(200);
        }

        await sendMessage('📌 Ya tienes una búsqueda activa. Escribe un número, *ver más* o *otra búsqueda* para continuar.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);

      } catch (error) {
        console.error('💥 Error en el webhook:', error);
        await sendMessage('❌ Ocurrió un error. Intenta de nuevo más tarde.');
        iniciarInactividad(numero, sendMessage, 'soloCierre');
        return res.sendStatus(500);
      }
    } else {
      return res.sendStatus(200);
    }
  } else {
    return res.sendStatus(404);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://0.0.0.0:${PORT}`);
});
