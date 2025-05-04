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
const sessionData      = {};  // { [numero]: { context: 'inicio'|'diccionario'|'resultados' } }
const eventosCache     = {};  // { [numero]: { lista, pagina } }
const inactividadTimers = {}; // { [numero]: { warning, close } }

const normalizar = txt =>
  txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

function clearInactivity(num) {
  if (!inactividadTimers[num]) return;
  clearTimeout(inactividadTimers[num].warning);
  clearTimeout(inactividadTimers[num].close);
  delete inactividadTimers[num];
}

function resetUserState(num) {
  sessionData[num] = { context: 'inicio' };
  delete eventosCache[num];
  clearInactivity(num);
}

/**
 * Inactividad:
 * - warning a 1 minuto
 * - close a 2 minutos
 * tipo = 'completo' → warning + close
 * tipo = 'soloCierre' → solo close
 */
function iniciarInactividad(num, sendMessage, tipo = 'completo') {
  clearInactivity(num);
  const warningMs = 1 * 60 * 1000;
  const closeMs   = 2 * 60 * 1000;
  inactividadTimers[num] = {
    warning: tipo === 'completo'
      ? setTimeout(() => sendMessage(
          '🔔 Sigo aquí si necesitas algo más.'
        ).catch(console.error), warningMs)
      : null,
    close: setTimeout(() => {
      sendMessage(
        '🕒 No hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋'
      ).catch(console.error);
      resetUserState(num);
    }, closeMs)
  };
}

async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
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

  // reinicia timers
  clearInactivity(numero);

  // contexto actual
  const ctx = sessionData[numero]?.context || 'inicio';

  try {
    // Comando para entrar al diccionario
    if (texto.includes('diccionario') && ctx !== 'diccionario') {
      sessionData[numero] = { context: 'diccionario' };
      await sendMessage(numero,
        `📚 Entraste al *diccionario caleño*. Escríbeme una palabra para explicártela.\n\n` +
        `Para salir, responde *salir* o *menu*.`
      );
      iniciarInactividad(numero, n => sendMessage(n,''));
      return res.sendStatus(200);
    }

    // En modo diccionario
    if (ctx === 'diccionario') {
      // comando para salir
      if (['salir','menu'].includes(texto)) {
        resetUserState(numero);
        await sendMessage(numero, '✅ Saliste del diccionario. Escribe cualquier texto para buscar eventos.');
        iniciarInactividad(numero, n => sendMessage(n,''));
        return res.sendStatus(200);
      }
      // buscar definición
      const significado = await getMeaningFromSerpAPI(texto);
      if (significado) {
        await sendMessage(numero, `📚 *${texto}*:\n\n${significado}`);
      } else {
        await sendMessage(numero, `😔 No encontré el significado de *${texto}*.`);
      }
      iniciarInactividad(numero, n => sendMessage(n,'')); // solo close
      return res.sendStatus(200);
    }

    // Si el texto es un número y hay lista en cache → muestro detalle
    if (!isNaN(texto) && eventosCache[numero]) {
      const idx  = parseInt(texto,10)-1;
      const item = eventosCache[numero].lista[idx];
      if (!item) {
        await sendMessage(numero, '❌ Opción inválida. Envía otro número.');
        iniciarInactividad(numero, n => sendMessage(n,''), true);
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
      iniciarInactividad(numero, n => sendMessage(n,''), true);
      return res.sendStatus(200);
    }

    // Chat libre: consulta embeddings
    const resp = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto, fuente:'whatsapp', nombre:'CaliAndo' }
    );
    const lista = resp.data.resultados || [];
    if (!resp.data.ok || lista.length===0) {
      await sendMessage(numero, '😔 No encontré nada con esa frase.');
      iniciarInactividad(numero, n => sendMessage(n,''), true);
      return res.sendStatus(200);
    }
    // guardo lista y muestro primeros 5
    eventosCache[numero] = { lista, pagina: 0 };
    const primerosTxt = lista.slice(0,5)
      .map((it,i)=>`${i+1}. ${it.nombre}`).join('\n\n');
    await sendMessage(numero,
      `🔎 Encontré:\n\n${primerosTxt}\n\n` +
      `Responde con el número para ver detalles.`
    );
    iniciarInactividad(numero, n => sendMessage(n,''), false);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en el webhook:', err);
    await sendMessage(numero,'❌ Algo falló. Intenta más tarde.');
    iniciarInactividad(numero, n => sendMessage(n,''), true);
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`🚀 CaliAndo Bot en puerto ${PORT}`)
);
