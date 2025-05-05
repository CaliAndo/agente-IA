require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health-check para Railway
app.get('/', (req, res) => {
  res.status(200).send('🟢 CaliAndo Bot OK');
});

const PORT              = process.env.PORT || 3000;
const VERIFY_TOKEN      = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN    = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL       = process.env.FASTAPI_URL;

if (!WHATSAPP_TOKEN)    console.warn('⚠️ WHATSAPP_TOKEN no está definido');
if (!VERIFY_TOKEN)      console.warn('⚠️ WHATSAPP_VERIFY_TOKEN no está definido');
if (!WHATSAPP_PHONE_ID) console.warn('⚠️ WHATSAPP_PHONE_NUMBER_ID no está definido');
if (!FASTAPI_URL)       console.error('🚨 FASTAPI_URL no está definida');

const sessionData       = {};  // contextos por número
const eventosCache      = {};  // resultados de búsqueda por número
const inactividadTimers = {};  // timers de warning y cierre por número

function clearInactivity(numero) {
  const t = inactividadTimers[numero];
  if (t) {
    clearTimeout(t.warning);
    clearTimeout(t.close);
    delete inactividadTimers[numero];
  }
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
  const warningDelay = 60_000;   // 1 min
  const closeDelay   = 120_000;  // 2 min

  inactividadTimers[numero] = {
    warning: tipo === 'completo'
      ? setTimeout(() => sendMessage('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?'), warningDelay)
      : null,
    close: setTimeout(() => {
      sendMessage('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUserState(numero);
    }, closeDelay)
  };
}

// Verificación del webhook
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('🟢 Webhook verificado correctamente');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recepción de mensajes
app.post('/webhook', async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message || message.type !== 'text') {
      return res.sendStatus(200);
    }

    const numero     = message.from;
    const rawMensaje = message.text.body;
    const mensaje    = normalizar(rawMensaje);

    const sendMessage = async text => {
      await axios.post(
        `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
        { messaging_product: 'whatsapp', to: numero, text: { body: text } },
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );
    };

    clearInactivity(numero);

    // Menú principal
    if (['menu','volver','otra busqueda'].some(w => mensaje.includes(w))) {
      resetUserState(numero);
      await sendMessage(
        `📋 Menú principal:\n• Eventos\n• Cultura\n• Tour\n• Salsa\n\nEscribe tu opción.`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Saludo inicial
    if (['hola','buenas','hey','holi'].includes(mensaje)) {
      resetUserState(numero);
      await sendMessage(`👋 ¡Hola! Soy *CaliAndo*. ¿Qué quieres descubrir hoy en Cali?`);
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Detalle por número
    if (!isNaN(mensaje) && eventosCache[numero]) {
      const idx  = parseInt(mensaje, 10) - 1;
      const item = eventosCache[numero].lista[idx];
      if (!item) {
        await sendMessage('❌ Opción inválida. Escribe un número válido.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }

      const detalle = await getDetallePorFuente(item.fuente, item.referencia_id);
      if (!detalle) {
        await sendMessage('❌ No encontré detalles para esa opción.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }

      // Construcción de la respuesta con todas las columnas
      let resp = `📚 *${detalle.nombre}*\n\n`;
      if (detalle.descripcion)        resp += `📜 ${detalle.descripcion}\n\n`;
      if (detalle.ubicacion)          resp += `📍 Ubicación: ${detalle.ubicacion}\n`;
      if (detalle.tipo_de_lugar)      resp += `🏷️ Tipo: ${detalle.tipo_de_lugar}\n`;
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
        await sendMessage('ℹ️ No hay búsqueda activa. Escribe “tour” o “eventos”.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }
      const start = (++cache.pagina) * 5;
      const next  = cache.lista.slice(start, start + 5);
      if (next.length) {
        const text = next.map((r,i) => `${start + i + 1}. ${r.nombre}`).join('\n\n');
        await sendMessage(`📍 Más:\n\n${text}\n\n🔀 Número o *otra búsqueda*.`);
      } else {
        await sendMessage('📜 Ya no quedan más resultados.');
      }
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Diccionario
    if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      await sendMessage('📚 Diccionario caleño: escribe la palabra.');
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }
    if (sessionData[numero]?.context === 'diccionario') {
      const sign = await getMeaningFromSerpAPI(mensaje);
      await sendMessage(
        sign
          ? `📚 *${mensaje}*: ${sign}`
          : `😔 No encontré significado de “${mensaje}”.`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Nueva búsqueda con FastAPI
    const ctx = sessionData[numero]?.context;
    if (!eventosCache[numero] && (!ctx || ctx === 'inicio' || ctx === 'resultados')) {
      if (!FASTAPI_URL) {
        await sendMessage('❌ Error interno: FASTAPI_URL no configurada.');
        return res.sendStatus(500);
      }
      const { data } = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: mensaje,
        fuente: 'whatsapp',
        nombre: 'CaliAndo'
      });
      if (!data.ok || !data.resultados.length) {
        await sendMessage('😔 No encontré nada. Prueba con “eventos” o “tour”.');
        iniciarInactividad(numero, sendMessage, 'soloCierre');
        return res.sendStatus(200);
      }
      eventosCache[numero] = { lista: data.resultados, pagina: 0 };
      sessionData[numero]   = { context: 'resultados' };
      const primeros = data.resultados.slice(0,5)
        .map((it,i) => `${i+1}. ${it.nombre}`)
        .join('\n\n');
      await sendMessage(`🔎 Opciones:\n\n${primeros}\n\n🔀 Número o *ver mas*.`);
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // Flujo activo
    await sendMessage('📌 Ya tienes búsqueda activa. Número, *ver mas* o *otra búsqueda*.');
    iniciarInactividad(numero, sendMessage);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en /webhook:', err);
    return res.sendStatus(500);
  }
});

// Arranca el servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://0.0.0.0:${PORT}`);
  console.log(`🔗 Conectado a FASTAPI_URL → ${FASTAPI_URL}`);
});
