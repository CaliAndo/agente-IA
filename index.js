// index.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getDetallePorFuente } = require('./services/db/getDetalle');

const app = express();
app.use(express.json());

// Health‐check
app.get('/', (_req, res) => res.status(200).send('🟢 CaliAndo Bot OK'));

const PORT         = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL  = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

// ——— State ———
const sessionData  = {}; // { from: { context, dictPages?, dictPageIdx? } }
const eventosCache = {}; // { from: { lista, page } }
const inactTimers  = {}; // { from: { warning, close } }

// ——— Helpers ———
function sendMessage(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  ).catch(console.error);
}

function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function clearTimers(from) {
  const t = inactTimers[from];
  if (t) {
    clearTimeout(t.warning);
    clearTimeout(t.close);
    delete inactTimers[from];
  }
}

function resetUser(from) {
  sessionData[from] = { context: 'inicio' };
  delete eventosCache[from];
  delete sessionData[from].dictPages;
  delete sessionData[from].dictPageIdx;
  clearTimers(from);
}

function startInactivity(from, reply) {
  clearTimers(from);
  inactTimers[from] = {
    warning: setTimeout(() => {
      reply('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?');
    }, 60_000),
    close: setTimeout(() => {
      reply('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUser(from);
    }, 120_000)
  };
}

// price parser
function parsePrice(str) {
  if (!str) return Infinity;
  const s = str.toLowerCase();
  if (s.includes('gratis')) return 0;
  const digits = str.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : Infinity;
}

// ——— Webhook ———
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') return res.sendStatus(200);

  const from  = msg.from;
  const text  = normalize(msg.text.body);
  const reply = txt => sendMessage(from, txt);

  clearTimers(from);

  // 0) FILTRADO “más barato(s)” / “más caro(s)”
  if (sessionData[from]?.context === 'resultados') {
    const cache = eventosCache[from].lista.filter(ev => ev.fuente === 'civitatis');
    // barato(a)(s)
    if (
      text.includes('mas barato') ||
      text.includes('más barato') ||
      text.includes('mas baratos') ||
      text.includes('más baratos')
    ) {
      cache.sort((a, b) => parsePrice(a.precio) - parsePrice(b.precio));
      const top5 = cache.slice(0, 5);
      await reply(
        '💸 5 planes Civitatis más baratos:\n\n' +
        top5.map(e => `• ${e.nombre} (${e.precio})`).join('\n')
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    // caro(a)(s)
    if (
      text.includes('mas caro') ||
      text.includes('más caro') ||
      text.includes('mas caros') ||
      text.includes('más caros')
    ) {
      cache.sort((a, b) => parsePrice(b.precio) - parsePrice(a.precio));
      const top5 = cache.slice(0, 5);
      await reply(
        '💎 5 planes Civitatis más caros:\n\n' +
        top5.map(e => `• ${e.nombre} (${e.precio})`).join('\n')
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
  }

  try {
    // 1) SALUDOS
    const SALUDOS = ['hola','buenas','hey','holi','buenas tardes','buenos días'];
    if (SALUDOS.some(w => text.includes(w))) {
      resetUser(from);
      await reply(
`👋 ¡Hola! Soy *CaliAndo*, tu guía de planes en Cali.
Escríbeme lo que quieras: un plan, un término caleño, o incluso el nombre de un evento para ver detalles.
Estoy listo para ayudarte. 🇨🇴💃`
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 2) DICCIONARIO
    if (text.startsWith('diccionario')) {
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Entraste al *diccionario caleño*. Escríbeme la palabra que quieras consultar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (sessionData[from]?.context === 'diccionario') {
      // … lógica de “ver mas” …
    }

    // 3) SELECCIÓN POR NOMBRE
    if (sessionData[from]?.context === 'resultados') {
      const cacheObj = eventosCache[from];
      // paginar “ver mas”
      if (text === 'ver mas') {
        const page = (cacheObj.page || 0) + 1;
        cacheObj.page = page;
        const next = cacheObj.lista.slice(page * 5, page * 5 + 5);
        if (next.length) {
          await reply(
            '🔎 Más recomendaciones:\n\n' +
            next.map(e => `• ${e.nombre}`).join('\n') +
            '\n\nEscribe el NOMBRE del plan para ver detalles.'
          );
        } else {
          await reply('📜 No hay más resultados.');
        }
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      // match por nombre
      const elegido = cacheObj.lista.find(ev => {
        const nm = normalize(ev.nombre);
        return text.includes(nm) || nm.includes(text);
      });
      if (elegido) {
        console.log('📌 [webhook] getDetallePorFuente →', elegido.fuente, elegido.referencia_id);
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
        console.log('📌 [webhook] detalle:', d);

        if (d) {
          let msg = `📚 *${d.nombre}*\n\n`;
          if (d.descripcion)       msg += `📜 ${d.descripcion}\n\n`;
          if (d.ubicacion)         msg += `📍 ${d.ubicacion}\n`;
          if (d.tipo_de_lugar)     msg += `🏷️ ${d.tipo_de_lugar}\n`;
          if (d.redes_sociales)    msg += `🔗 ${d.redes_sociales}\n`;
          if (d.pagina_web)        msg += `🌐 ${d.pagina_web}\n`;
          if (d.zona)              msg += `📌 ${d.zona}\n`;
          if (d.ingreso_permitido) msg += `🚪 ${d.ingreso_permitido}\n`;
          if (d.precio)            msg += `💰 ${d.precio}\n`;
          if (d.enlace)            msg += `🔗 Más info: ${d.enlace}\n`;

          await reply(msg);
          startInactivity(from, reply);
        } else {
          await reply('❌ No encontré detalles para esa opción.');
          startInactivity(from, reply);
        }
        // No reseteamos contexto para permitir nuevos filtros
        return res.sendStatus(200);
      }

      await reply('❌ No reconocí ese nombre. Escribe el NOMBRE exacto del plan o "ver mas".');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 4) BÚSQUEDA SEMÁNTICA
    const { data } = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
    );
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada con esa frase. Prueba otra.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    eventosCache[from]  = { lista: data.resultados, page: 0 };
    sessionData[from]   = { context: 'resultados' };

    const primeros = data.resultados.slice(0, 5);
    await reply(
      '🔎 Te recomiendo estos planes:\n\n' +
      primeros.map(e => `• ${e.nombre}`).join('\n') +
      '\n\nEscribe el NOMBRE del plan o "ver mas" para más.'
    );
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Ocurrió un error. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`);
  console.log(`🔗 FASTAPI_URL → ${FASTAPI_URL}`);
});
