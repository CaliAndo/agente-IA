require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

const PORT           = process.env.PORT || 3000;
const VERIFY_TOKEN   = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const FASTAPI_URL    = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

// Estado por usuario
// context: 'inicio' | 'diccionario' | 'resultados' | 'closed'
const sessionData      = {};
const eventosCache     = {};
const inactividadTimers = {};

const normalizar = txt =>
  txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

// Cancela timers
function clearInactivity(num) {
  if (!inactividadTimers[num]) return;
  clearTimeout(inactividadTimers[num].warning);
  clearTimeout(inactividadTimers[num].close);
  delete inactividadTimers[num];
}

// Cierra sesión (cierre definitivo)
function closeSession(num) {
  clearInactivity(num);
  sessionData[num] = { context: 'closed' };
  delete eventosCache[num];
}

// Resetea para nueva sesión
function resetSession(num) {
  clearInactivity(num);
  sessionData[num] = { context: 'inicio' };
  delete eventosCache[num];
}

/**
 * Inactividad:
 * - warning a 1 minuto
 * - cierre a 2 minutos
 * tipo = 'completo'  → warning + cierre
 * tipo = 'soloCierre' → solo cierre
 */
function iniciarInactividad(num, tipo = 'completo') {
  clearInactivity(num);
  const warningMs = 1 * 60 * 1000;   // 1 minuto
  const closeMs   = 2 * 60 * 1000;   // 2 minutos

  inactividadTimers[num] = {
    warning: tipo === 'completo'
      ? setTimeout(() => {
          sendMessage(num,
            '🔔 Sigo aquí si necesitas algo más. Escribe antes de 1 minuto.'
          ).catch(console.error);
        }, warningMs)
      : null,

    close: setTimeout(() => {
      sendMessage(num,
        '🕒 No hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋'
      ).catch(console.error);
      closeSession(num);
    }, closeMs)
  };
}

// Verificación webhook
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') return res.sendStatus(200);

  const numero = msg.from;
  const texto  = normalizar(msg.text.body);
  const ctx    = sessionData[numero]?.context || 'inicio';

  // Si está cerrado, solo reabre con saludo
  if (ctx === 'closed') {
    if (['hola','buenas','hey','holi'].includes(texto)) {
      resetSession(numero);
    } else {
      return res.sendStatus(200);
    }
  }

  // detiene timers previos
  clearInactivity(numero);

  // Detección de despedida
  const despedidas = ['adios','adiós','hasta luego','chau','bye','nos vemos'];
  if (despedidas.some(w => texto.includes(w))) {
    await sendMessage(numero, '👋 ¡Hasta luego! Cuando quieras vuelves a escribir.');
    closeSession(numero);
    return res.sendStatus(200);
  }

  try {
    // Entrar al diccionario
    if (texto.includes('diccionario') && ctx !== 'diccionario') {
      sessionData[numero] = { context: 'diccionario' };
      await sendMessage(numero,
        '📚 Entraste al *diccionario caleño*. Escríbeme una palabra para explicártela.\n' +
        'Para salir, escribe "salir" o "menu".'
      );
      iniciarInactividad(numero, 'completo');
      return res.sendStatus(200);
    }

    // Modo diccionario
    if (sessionData[numero].context === 'diccionario') {
      if (['salir','menu'].includes(texto)) {
        resetSession(numero);
        await sendMessage(numero,
          '✅ Saliste del diccionario. Ahora escribe cualquier texto para buscar eventos.'
        );
        iniciarInactividad(numero, 'completo');
        return res.sendStatus(200);
      }
      const significado = await getMeaningFromSerpAPI(texto);
      if (significado) {
        await sendMessage(numero, `📚 *${texto}*:\n\n${significado}`);
      } else {
        await sendMessage(numero, `😔 No encontré el significado de *${texto}*.`);
      }
      iniciarInactividad(numero, 'soloCierre');
      return res.sendStatus(200);
    }

    // Si es número y hay cache → detalle
    if (!isNaN(texto) && eventosCache[numero]) {
      const idx  = parseInt(texto, 10) - 1;
      const item = eventosCache[numero].lista[idx];
      if (!item) {
        await sendMessage(numero, '❌ Opción inválida. Envía otro número.');
        iniciarInactividad(numero, 'soloCierre');
        return res.sendStatus(200);
      }
      const det = await getDetallePorFuente(item.fuente, item.referencia_id);
      if (det) {
        let r = `📚 *${det.nombre}*\n\n`;
        if (det.descripcion) r += `📜 ${det.descripcion}\n\n`;
        if (det.precio)       r += `💰 Precio: ${det.precio}\n`;
        if (det.ubicacion)    r += `📍 Lugar: ${det.ubicacion}\n`;
        if (det.enlace)       r += `🔗 Más info: ${det.enlace}\n`;
        await sendMessage(numero, r);
      } else {
        await sendMessage(numero, '❌ No encontré detalles.');
      }
      iniciarInactividad(numero, 'soloCierre');
      return res.sendStatus(200);
    }

    // Chat libre: consulta embeddings
    const apiResp = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto, fuente:'whatsapp', nombre:'CaliAndo' }
    );
    const lista = apiResp.data.resultados || [];
    if (!apiResp.data.ok || lista.length === 0) {
      await sendMessage(numero, '😔 No encontré nada con esa frase.');
      iniciarInactividad(numero, 'soloCierre');
      return res.sendStatus(200);
    }
    eventosCache[numero] = { lista, pagina: 0 };
    const primeros = lista.slice(0, 5)
      .map((it, i) => `${i+1}. ${it.nombre}`)
      .join('\n\n');
    await sendMessage(numero,
      `🔎 Encontré:\n\n${primeros}\n\n` +
      `Responde con el número para ver detalles.`
    );
    iniciarInactividad(numero, 'completo');
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en el webhook:', err);
    await sendMessage(numero, '❌ Algo falló. Intenta más tarde.');
    iniciarInactividad(numero, 'soloCierre');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 CaliAndo Bot en puerto ${PORT}`)
);
