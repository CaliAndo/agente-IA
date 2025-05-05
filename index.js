require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { getDetallePorFuente }  = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health‐check
app.get('/', (_req, res) => res.status(200).send('🟢 CaliAndo Bot OK'));

const PORT           = process.env.PORT || 3000;
const VERIFY_TOKEN   = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID       = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL    = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

// Estado por usuario
const sessionData       = {};  // { from: { context, dictPages?, dictPageIdx? } }
const eventosCache      = {};  // { from: { lista } }
const inactividadTimers = {};  // { from: { warning, close } }

function sendMessage(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  ).catch(console.error);
}

function normalize(s) {
  return s.normalize('NFD')
          .replace(/[\u0300-\u036f]/g,'')
          .trim()
          .toLowerCase();
}

function clearTimers(from) {
  const t = inactividadTimers[from];
  if (t) {
    clearTimeout(t.warning);
    clearTimeout(t.close);
    delete inactividadTimers[from];
  }
}

function resetUser(from) {
  sessionData[from] = { context: 'inicio' };
  delete eventosCache[from];
  delete sessionData[from].dictPages;
  delete sessionData[from].dictPageIdx;
  clearTimers(from);
}

/**
 * Warning a 1' y cierre a 2', siempre reseteando tras el cierre.
 */
function startInactivity(from, reply) {
  clearTimers(from);
  inactividadTimers[from] = {
    warning: setTimeout(() => {
      reply('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?');
    }, 60_000),
    close: setTimeout(() => {
      reply('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUser(from);
    }, 120_000)
  };
}

app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') return res.sendStatus(200);

  const from = msg.from;
  const text = normalize(msg.text.body);
  const reply = txt => sendMessage(from, txt);

  clearTimers(from);

  try {
    // — SALUDO INICIAL —
    if (['hola','buenas','hey','holi'].includes(text)) {
      resetUser(from);
      await reply(
`👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali.
Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?
Además, recuerda que tengo un *diccionario caleño*: escribe "diccionario" + tu palabra.
🇨🇴💃`
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // — INICIO DICCIONARIO —
    if (text.startsWith('diccionario')) {
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Diccionario caleño: envíame la palabra que quieras consultar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // — DICCIONARIO: fragmentado —
    if (sessionData[from]?.context === 'diccionario') {
      // crear fragmentos
      if (!sessionData[from].dictPages) {
        const meaning = await getMeaningFromSerpAPI(text);
        if (!meaning) {
          await reply(`😔 No encontré el significado de *${text}*.`);
          startInactivity(from, reply);
          return res.sendStatus(200);
        }
        const pages = [];
        for (let i = 0; i < meaning.length; i += 800) {
          pages.push(meaning.slice(i, i + 800));
        }
        sessionData[from].dictPages   = pages;
        sessionData[from].dictPageIdx = 0;

        await reply(`📚 *${text}*:\n\n${pages[0]}`);
        if (pages.length > 1) await reply('💡 Envía "ver mas" para continuar...');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      // páginas siguientes
      if (text === 'ver mas') {
        const idx   = sessionData[from].dictPageIdx + 1;
        const pages = sessionData[from].dictPages;
        if (idx < pages.length) {
          sessionData[from].dictPageIdx = idx;
          await reply(pages[idx]);
          if (idx < pages.length - 1) {
            await reply('💡 Envía "ver mas" para más...');
          }
        }
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
    }

    // — DETALLE SI ES NÚMERO —
    if (!isNaN(text) && eventosCache[from]) {
      const idx  = parseInt(text, 10) - 1;
      const item = eventosCache[from].lista[idx];
      if (!item) {
        await reply('❌ Número inválido. Elige uno de la lista.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const d = await getDetallePorFuente(item.fuente, item.referencia_id);
      if (!d) {
        await reply('❌ No encontré detalles para esa opción.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      let msgText = `📚 *${d.nombre}*\n\n`;
      if (d.descripcion)       msgText += `📜 ${d.descripcion}\n\n`;
      if (d.ubicacion)         msgText += `📍 Ubicación: ${d.ubicacion}\n`;
      if (d.tipo_de_lugar)     msgText += `🏷️ Tipo: ${d.tipo_de_lugar}\n`;
      if (d.redes_sociales)    msgText += `🔗 Redes: ${d.redes_sociales}\n`;
      if (d.pagina_web)        msgText += `🌐 Web: ${d.pagina_web}\n`;
      if (d.zona)              msgText += `📌 Zona: ${d.zona}\n`;
      if (d.ingreso_permitido) msgText += `🚪 Ingreso: ${d.ingreso_permitido}\n`;
      if (d.precio)            msgText += `💰 Precio: ${d.precio}\n`;
      if (d.enlace)            msgText += `🔗 Más info: ${d.enlace}\n`;
      await reply(msgText);
      resetUser(from);
      return res.sendStatus(200);
    }

    // — NUEVA BÚSQUEDA SEMÁNTICA —
    const { data } = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
    );
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada. Prueba con otra frase.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    eventosCache[from] = { lista: data.resultados };
    sessionData[from]   = { context: 'resultados' };

    const list = data.resultados
      .slice(0, 5)
      .map((it, i) => `${i+1}. ${it.nombre}`)
      .join('\n\n');
    await reply(`🔎 Encontré:\n\n${list}\n\nResponde con el número para ver detalles.`);
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Ocurrió un error. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

// Arranque
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`);
  console.log(`🔗 FASTAPI_URL → ${FASTAPI_URL}`);
});
