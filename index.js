// index.js
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const chrono  = require('chrono-node');
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getLiveEvents }       = require('./services/googleEvents');

const app = express();
app.use(express.json());

// Health‐check
app.get('/', (_req, res) => res.status(200).send('🟢 CaliAndo Bot OK'));

const PORT         = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL  = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

// Estado por usuario
const sessionData  = {};
const eventosCache = {};
const inactTimers  = {};

// Helpers
function sendMessage(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  ).catch(console.error);
}

function normalize(str) {
  return str.normalize('NFD')
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
    }, 5 * 60_000),
    close: setTimeout(() => {
      reply('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋');
      resetUser(from);
    }, 6 * 60_000),
  };
}

function parsePrice(str) {
  if (!str) return Infinity;
  const s = str.toLowerCase();
  if (s.includes('gratis')) return 0;
  const digits = str.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : Infinity;
}

// Webhook
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') return res.sendStatus(200);

  const from  = msg.from;
  const text  = normalize(msg.text.body);
  const reply = txt => sendMessage(from, txt);

  clearTimers(from);

  try {
    // 0) Detección de tiempo natural: hoy, mañana, finde...
    const times = chrono.parse(text, new Date(), { forwardDate: true });
    if (times.length) {
      const whenText = times[0].text;
      console.log('[Debug] detectado periodo:', whenText);
      await reply(`🔍 Buscando eventos ${whenText}…`);
      const live = await getLiveEvents(`eventos ${whenText}`);
      if (!live.length) {
        await reply('😔 No encontré eventos para ese periodo. Prueba otra frase.');
      } else {
        const list = live.map(ev =>
          `• *${ev.title}*\n` +
          `  📅 ${ev.date}\n` +
          `  📍 ${ev.venue}\n` +
          (ev.description ? `  📝 ${ev.description}\n` : '') +
          `  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Aquí algunos eventos ${whenText}:\n\n${list}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 1) Filtro precio
    if (
      sessionData[from]?.context === 'resultados' &&
      (/(mas\s+barat[oa]s?|más\s+barat[oa]s?)/.test(text) ||
       /(mas\s+car[oa]s?|más\s+car[oa]s?)/.test(text))
    ) {
      const subset = eventosCache[from].lista.filter(ev => ev.fuente === 'civitatis');
      const detalles = await Promise.all(
        subset.map(ev => getDetallePorFuente(ev.fuente, ev.referencia_id))
      );
      const combinado = subset.map((ev, i) => ({
        nombre:    ev.nombre,
        precioStr: detalles[i]?.precio || '—',
        precioNum: parsePrice(detalles[i]?.precio)
      })).filter(x => !isNaN(x.precioNum));
      const asc = /(barat[oa])/.test(text);
      combinado.sort((a,b)=> asc? a.precioNum-b.precioNum : b.precioNum-a.precioNum);
      const top5 = combinado.slice(0,5);
      const header = asc
        ? '💸 5 más baratos:\n\n'
        : '💎 5 más caros:\n\n';
      await reply(header + top5.map(x=>`• ${x.nombre} (${x.precioStr})`).join('\n'));
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 2) Saludos
    const SALUDOS = ['hola','buenas','hey','holi','buenas tardes','buenos dias'];
    if (SALUDOS.some(w => text.includes(w))) {
      resetUser(from);
      await reply(
`👋 ¡Hola! Soy *CaliAndo*, tu guía de planes en Cali.
Escríbeme lo que quieras: un plan, un término caleño o el nombre de un evento.
Estoy listo para ayudarte. 🇨🇴`
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 3) Diccionario
    if (text.startsWith('diccionario')) {
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Entraste al diccionario caleño. ¿Qué palabra buscas?');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (sessionData[from]?.context === 'diccionario') {
      // paginación "ver mas"
      return res.sendStatus(200);
    }

    // 4) Selección por nombre
    if (sessionData[from]?.context === 'resultados') {
      const cache = eventosCache[from];
      if (text === 'ver mas') {
        cache.page = (cache.page||0)+1;
        const slice = cache.lista.slice(cache.page*5, cache.page*5+5);
        await reply(
          slice.length
            ? '🔎 Más recomendaciones:\n\n' +
              slice.map(e=>`• ${e.nombre}`).join('\n') +
              '\n\nEscribe el NOMBRE del plan para ver detalles.'
            : '📜 No hay más resultados.'
        );
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const elegido = cache.lista.find(ev=>{
        const nm = normalize(ev.nombre);
        return text.includes(nm)|| nm.includes(text);
      });
      if (elegido) {
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
        if (d) {
          let msg = `📚 *${d.nombre}*\n\n`;
          if (d.descripcion) msg+=`📜 ${d.descripcion}\n\n`;
          if (d.ubicacion) msg+=`📍 ${d.ubicacion}\n`;
          if (d.tipo_de_lugar) msg+=`🏷️ ${d.tipo_de_lugar}\n`;
          if (d.redes_sociales) msg+=`🔗 ${d.redes_sociales}\n`;
          if (d.pagina_web) msg+=`🌐 ${d.pagina_web}\n`;
          if (d.zona) msg+=`📌 ${d.zona}\n`;
          if (d.ingreso_permitido) msg+=`🚪 ${d.ingreso_permitido}\n`;
          if (d.precio) msg+=`💰 ${d.precio}\n`;
          if (d.enlace) msg+=`🔗 Más info: ${d.enlace}\n`;
          await reply(msg);
        } else {
          await reply('❌ No encontré detalles.');
        }
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      await reply('❌ No reconocí ese nombre. Usa el nombre exacto o "ver mas".');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 5) Búsqueda semántica
    const { data } = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
    );
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada. Prueba otra frase.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    eventosCache[from] = { lista:data.resultados, page:0 };
    sessionData[from]  = { context:'resultados' };
    await reply(
      '🔎 Te recomiendo estos planes:\n\n' +
      data.resultados.slice(0,5).map(e=>`• ${e.nombre}`).join('\n') +
      '\n\nEscribe el NOMBRE del plan o "ver mas" para más.'
    );
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch(err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Ocurrió un error. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`);
});
