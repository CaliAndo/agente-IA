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

const sessionData      = {};  // contextos por número
const eventosCache     = {};  // resultados de búsqueda por número
const inactividadTimers = {}; // timers de warning y cierre por número

// Cancela ambos timers para un número
function clearInactivity(numero) {
  if (!inactividadTimers[numero]) return;
  clearTimeout(inactividadTimers[numero].warning);
  clearTimeout(inactividadTimers[numero].close);
  delete inactividadTimers[numero];
}

// Resetea estado completo tras cierre
function resetUserState(numero) {
  sessionData[numero] = { context: 'inicio' };
  delete eventosCache[numero];
  clearInactivity(numero);
}

// Normaliza texto (quita tildes, lower case, trim)
const normalizar = txt =>
  txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * Programa los timers de inactividad:
 * - warning a 1 minuto (60 000 ms)
 * - cierre a 2 minutos (120 000 ms)
 * tipo = 'completo'  → warning + cierre
 * tipo = 'soloCierre' → solo cierre a 2'
 */
function iniciarInactividad(numero, sendMessage, tipo = 'completo') {
  clearInactivity(numero);

  const warningDelay = 1 * 60 * 1000;   // 1 minuto
  const closeDelay   = 2 * 60 * 1000;   // 2 minutos

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

// Verificación del webhook
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

// Recepción de mensajes
app.post('/webhook', async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== 'text') {
    return res.sendStatus(200);
  }

  const numero     = message.from;
  const rawMensaje = message.text.body;
  const mensaje    = normalizar(rawMensaje);

  // función para enviar mensajes por WhatsApp
  const sendMessage = async text => {
    await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', to: numero, text: { body: text } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
  };

  // al recibir cualquier mensaje, cancelamos timers previos
  clearInactivity(numero);

  try {
    // Comandos de menú
    if (['menu','volver','otra busqueda'].some(w => mensaje.includes(w))) {
      resetUserState(numero);
      await sendMessage(
        `📋 Menú principal:\n\nPuedes escribirme algo como:\n• *eventos*\n• *cultura*\n• *tour*\n• *salsa*\n\nY te mostraré lo mejor de Cali 🇨🇴`
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
      const idx  = parseInt(mensaje,10) - 1;
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
      if (detalle.descripcion) resp += `📜 ${detalle.descripcion}\n\n`;
      if (detalle.precio && detalle.precio!=='null') resp += `💰 Precio: ${detalle.precio}\n`;
      if (detalle.ubicacion && detalle.ubicacion!=='null') resp += `📍 Lugar: ${detalle.ubicacion}\n`;
      if (detalle.enlace && detalle.enlace!=='null') resp += `🔗 Más info: ${detalle.enlace}\n`;
      resp += `\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`;
      resetUserState(numero);
      await sendMessage(resp);
      return res.sendStatus(200);
    }

    // Ver más resultados
    if (mensaje.includes('ver mas')) {
      const cache = eventosCache[numero];
      if (!cache) {
        await sendMessage('ℹ️ No hay resultados activos. Escribe algo como *tour* o *eventos*.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }
      const start = (++cache.pagina) * 5;
      const next  = cache.lista.slice(start, start + 5);
      if (next.length) {
        const listText = next.map((r,i)=>`${start+i+1}. ${r.nombre}`).join('\n\n');
        await sendMessage(`📍 Más recomendaciones:\n\n${listText}\n\n🔀 Escribe un número o *otra búsqueda* para continuar.`);
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
    if (!eventosCache[numero] && (!ctx || ctx==='inicio' || ctx==='resultados')) {
      const resp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: mensaje,
        fuente: 'whatsapp',
        nombre: 'CaliAndo'
      });
      const lista = resp.data.resultados || [];
      if (!resp.data.ok || lista.length === 0) {
        await sendMessage('😔 No encontré nada con esas palabras. Intenta con *eventos*, *tour*, *salsa*, etc.');
        iniciarInactividad(numero, sendMessage, 'soloCierre');
        return res.sendStatus(200);
      }
      eventosCache[numero] = { lista, pagina: 0 };
      sessionData[numero] = { context: 'resultados' };
      const primeros = lista.slice(0,5).map((i,idx)=>`${idx+1}. ${i.nombre}`).join('\n\n');
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