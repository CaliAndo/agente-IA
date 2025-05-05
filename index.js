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
const inactividadTimers = {};  // timers de warning y cierre por número

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

/**
 * Inicia timers de inactividad:
 * - warning a 1'
 * - cierre a 2'
 * tipo = 'completo'  → warning + cierre
 * tipo = 'soloCierre' → solo cierre
 */
function iniciarInactividad(numero, sendMessage, tipo = 'completo') {
  clearInactivity(numero);

  inactividadTimers[numero] = {
    warning: tipo === 'completo'
      ? setTimeout(async () => {
          await sendMessage('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?');
        }, 60_000)
      : null,
    close: setTimeout(async () => {
      await sendMessage('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUserState(numero);
    }, tipo === 'completo' ? 120_000 : 60_000)
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
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
    );
  };

  clearInactivity(numero);

  try {
    // — MENÚ PRINCIPAL —
    if (['menu','volver','otra busqueda'].some(w => mensaje.includes(w))) {
      resetUserState(numero);
      await sendMessage(
        `📋 Menú principal:\n• *Eventos*\n• *Cultura*\n• *Tour*\n• *Salsa*\n\nEscribe tu opción.`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // — SALUDO INICIAL —
    if (['hola','buenas','hey','holi'].includes(mensaje)) {
      resetUserState(numero);
      await sendMessage(
        `👋 ¡Hola! Soy *CaliAndo* y estoy aquí para mostrarte lo mejor de Cali 🇨🇴`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // — DETALLE POR NÚMERO —
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
      if (detalle.descripcion)       resp += `📜 ${detalle.descripcion}\n\n`;
      if (detalle.ubicacion)         resp += `📍 Ubicación: ${detalle.ubicacion}\n`;
      if (detalle.tipo_de_lugar)     resp += `🏷️ Tipo: ${detalle.tipo_de_lugar}\n`;
      if (detalle.redes_sociales)    resp += `🔗 Redes: ${detalle.redes_sociales}\n`;
      if (detalle.pagina_web)        resp += `🌐 Web: ${detalle.pagina_web}\n`;
      if (detalle.zona)              resp += `📌 Zona: ${detalle.zona}\n`;
      if (detalle.ingreso_permitido) resp += `🚪 Ingreso: ${detalle.ingreso_permitido}\n`;
      if (detalle.precio)            resp += `💰 Precio: ${detalle.precio}\n`;
      if (detalle.enlace)            resp += `🔗 Más info: ${detalle.enlace}\n`;
      resp += `\n🔀 Escribe *otra búsqueda* o *menú* para continuar.`;

      resetUserState(numero);
      await sendMessage(resp);
      return res.sendStatus(200);
    }

    // — VER MÁS RESULTADOS —
    if (mensaje.includes('ver mas')) {
      const cache = eventosCache[numero];
      if (!cache) {
        await sendMessage('ℹ️ No hay búsqueda activa. Escribe *tour* o *eventos*.');
        iniciarInactividad(numero, sendMessage);
        return res.sendStatus(200);
      }
      const start = (++cache.pagina) * 5;
      const next  = cache.lista.slice(start, start + 5);
      if (next.length) {
        const listText = next.map((r, i) => `${start + i + 1}. ${r.nombre}`).join('\n\n');
        await sendMessage(`📍 Más recomendaciones:\n\n${listText}\n\n🔀 Número o *otra búsqueda*.`);
      } else {
        await sendMessage('📜 Ya viste todos los resultados disponibles.');
      }
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // — DICCIONARIO —
    if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      await sendMessage('📚 Bienvenido al *diccionario caleño*. Escribe una palabra.');
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }
    if (sessionData[numero]?.context === 'diccionario') {
      const significado = await getMeaningFromSerpAPI(mensaje);
      await sendMessage(
        significado
          ? `📚 *${mensaje}*: ${significado}`
          : `😔 No encontré el significado de *${mensaje}*.`
      );
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // — NUEVA BÚSQUEDA EMBEDDINGS —
    const ctx = sessionData[numero]?.context;
    if (!eventosCache[numero] && (!ctx || ctx === 'inicio' || ctx === 'resultados')) {
      const { data } = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: mensaje,
        fuente: 'whatsapp',
        nombre: 'CaliAndo'
      });
      const lista = data.resultados || [];
      if (!data.ok || lista.length === 0) {
        await sendMessage('😔 No encontré nada. Prueba con *eventos*, *tour*.');
        iniciarInactividad(numero, sendMessage, 'soloCierre');
        return res.sendStatus(200);
      }
      eventosCache[numero] = { lista, pagina: 0 };
      sessionData[numero]   = { context: 'resultados' };
      const primeros = lista.slice(0, 5).map((it, i) => `${i + 1}. ${it.nombre}`).join('\n\n');
      await sendMessage(`🔎 Opciones:\n\n${primeros}\n\n🔀 Número o *ver mas*.`);
      iniciarInactividad(numero, sendMessage);
      return res.sendStatus(200);
    }

    // — FLUJO ACTIVO —
    await sendMessage('📌 Ya tienes búsqueda activa. Número, *ver mas* o *otra búsqueda*.');
    iniciarInactividad(numero, sendMessage);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en el webhook:', err);
    await sendMessage('❌ Ocurrió un error. Intenta de nuevo más tarde.');
    iniciarInactividad(req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from, sendMessage, 'soloCierre');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en http://0.0.0.0:${PORT}`);
});
