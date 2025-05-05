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

const sessionData       = {};  // contextos por número
const eventosCache      = {};  // resultados de búsqueda por número
const inactividadTimers = {}; // timers de warning y cierre por número

function clearInactivity(numero) {
  if (!inactividadTimers[numero]) return;
  clearTimeout(inactividadTimers[numero].warning);
  clearTimeout(inactividadTimers[numero].close);
  delete inactividadTimers[numero];
}

function resetUserState(numero) {
  sessionData[numero] = { context: 'inicio' };
  delete eventosCache[numero];
  clearInactivity(numero);
}

const normalizar = txt =>
  txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function iniciarInactividad(numero, sendMessage, tipo = 'completo') {
  clearInactivity(numero);
  const warningDelay = 60_000;   // 1 minuto
  const closeDelay   = 120_000;  // 2 minutos

  inactividadTimers[numero] = {
    warning: tipo === 'completo'
      ? setTimeout(async () => {
          await sendMessage(
            '🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?'
          );
        }, warningDelay)
      : null,

    close: setTimeout(async () => {
      await sendMessage(
        '🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋'
      );
      resetUserState(numero);
    }, closeDelay)
  };
}

app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('🟢 Webhook verificado correctamente');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') {
    return res.sendStatus(200);
  }

  const numero     = message.from;
  const rawMensaje = message.text.body;
  const mensaje    = normalizar(rawMensaje);

  const sendMessage = async text => {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to: numero, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  };

  clearInactivity(numero);

  try {
    // Menú principal
    if (['menu','volver','otra busqueda'].some(w => mensaje.includes(w))) {
      resetUserState(numero);
      await sendMessage(
        `📋 Menú principal:\n\nPuedes escribirme algo como:\n• *Eventos*\n• *Cultura*\n• *Tour*\n• *Salsa*\n\nY te mostraré lo mejor de Cali 🇨🇴`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Saludo inicial
    if (['hola','buenas','hey','holi'].includes(mensaje)) {
      resetUserState(numero);
      await sendMessage(
        `👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali.\n\nCuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?\n\nEstoy listo para mostrarte lo que esta ciudad sabrosa tiene para ti 🇨🇴💃`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Detalle por número
    if (!isNaN(mensaje) && eventosCache[numero]) {
      const idx  = parseInt(mensaje, 10) - 1;
      const item = eventosCache[numero].lista[idx];
      if (!item) {
        await sendMessage('❌ Opción inválida. Escribe un número de la lista.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }

      const detalle = await getDetallePorFuente(item.fuente, item.referencia_id);
      if (!detalle) {
        await sendMessage('❌ No encontré detalles para esa opción.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }

      let resp = `📚 *${detalle.nombre}*\n\n`;
      if (detalle.descripcion)        resp += `📜 ${detalle.descripcion}\n\n`;
      if (detalle.ubicacion)          resp += `📍 Ubicación: ${detalle.ubicacion}\n`;
      if (detalle.tipo_de_lugar)      resp += `🏷️ Tipo de lugar: ${detalle.tipo_de_lugar}\n`;
      if (detalle.redes_sociales)     resp += `🔗 Redes: ${detalle.redes_sociales}\n`;
      if (detalle.pagina_web)         resp += `🌐 Web: ${detalle.pagina_web}\n`;
      if (detalle.zona)               resp += `📌 Zona: ${detalle.zona}\n`;
      if (detalle.ingreso_permitido)  resp += `🚪 Ingreso permitido: ${detalle.ingreso_permitido}\n`;
      if (detalle.precio)             resp += `💰 Precio: ${detalle.precio}\n`;
      if (detalle.enlace)             resp += `🔗 Más info: ${detalle.enlace}\n`;
      resp += `\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`;

      resetUserState(numero);
      await sendMessage(resp);
      return res.sendStatus(200);
    }

    // Ver más resultados
    if (mensaje.includes('ver mas')) {
      const cache = eventosCache[numero];
      if (!cache) {
        await sendMessage('ℹ️ No hay resultados activos. Escribe algo como *Tour* o *Eventos*.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }
      const start = (++cache.pagina) * 5;
      const next  = cache.lista.slice(start, start + 5);
      if (next.length) {
        const listText = next.map((r, i) => `${start + i + 1}. ${r.nombre}`).join('\n\n');
        await sendMessage(`📍 Más recomendaciones:\n\n${listText}\n\n🔀 Escribe un número o *Otra búsqueda* para continuar.`);
      } else {
        await sendMessage('📜 Ya viste todos los resultados disponibles.');
      }
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Diccionario
    if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      await sendMessage(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra para explicártela.\n\nEj: *ñapa*, *enguayabado*, *borondo*`);
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }
    if (sessionData[numero]?.context === 'diccionario') {
      const sign = await getMeaningFromSerpAPI(mensaje);
      if (sign) {
        await sendMessage(`📚 *${mensaje}*:\n\n${sign}\n\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`);
      } else {
        await sendMessage(`😔 No encontré el significado de *${mensaje}*. Prueba otra palabra.`);
      }
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Nueva búsqueda
    const ctx = sessionData[numero]?.context;
    if (!eventosCache[numero] && (!ctx || ctx === 'inicio' || ctx === 'resultados')) {
      const resp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: mensaje,
        fuente: 'whatsapp',
        nombre: 'CaliAndo'
      });
      const lista = resp.data.resultados || [];
      if (!resp.data.ok || lista.length === 0) {
        await sendMessage('😔 No encontré nada con esas palabras. Intenta con *Eventos*, *Tour* etc.');
        iniciarInactividad(numero, sendMessage, 'soloCierre');
        return res.sendStatus(200);
      }
      eventosCache[numero] = { lista, pagina: 0 };
      sessionData[numero] = { context: 'resultados' };
      const primeros = lista.slice(0, 5).map((i, idx) => `${idx + 1}. ${i.nombre}`).join('\n\n');
      await sendMessage(`🔎 Encontré estas opciones:\n\n${primeros}\n\n🔀 Escribe un número para ver más detalles o *ver más*.`);
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Flujo activo
    await sendMessage('📌 Ya tienes una búsqueda activa. Escribe un número, *ver más* o *otra búsqueda* para continuar.');
    iniciarInactividad(numero, sendMessage);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en el webhook:', err);
    await sendMessage('❌ Ocurrió un error. Intenta de nuevo más tarde.');
    iniciarInactividad(numero, sendMessage, 'soloCierre');
    return res.sendStatus(500);
  }
});

// Arranca el servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://0.0.0.0:${PORT}`);
});
