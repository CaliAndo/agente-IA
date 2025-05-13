// index.js
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const Fuse    = require('fuse.js');

// Términos de comida para filtrar
const FOOD_TERMS = [
  'comida', 'comer', 'culinario',
  'restaurante', 'restaurantes', 'barcito', 'almuerzo', 'cena', 'desayuno', 'aperitivo',
  'pizzería', 'pizza', 'hamburguesa', 'antojito',
  'taco', 'postre', 'helado',
  'bebida', 'vino', 'foodtruck',
  'antojitos', 'snack', 'degustación'
];

const { getDetallePorFuente }   = require('./services/db/getDetalle');
const { getLiveEvents }         = require('./services/googleEvents');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health-check
app.get('/', (_req, res) => res.send('🟢 CaliAndo Bot OK'));

const PORT         = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL  = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error('🚨 FASTAPI_URL no está definida');

// — State —
const sessionData  = {}; // { from: { context, dictPages?, dictPageIdx? } }
const eventosCache = {}; // { from: { lista, page } }
const inactTimers  = {}; // { from: { warning1, warning2, close } }

// — Helpers —
function sendText(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  );
}

function sendButtons(to, bodyText, buttons) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) }
    }
  };
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  );
}

function normalize(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function clearTimers(from) {
  const t = inactTimers[from];
  if (t) {
    clearTimeout(t.warning1);
    clearTimeout(t.warning2);
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
    warning1: setTimeout(() => reply('🔔 Sigo aquí si necesitas ayuda. ¿Quieres que te recomiende algo más?'), 5 * 60000),
    warning2: setTimeout(() => reply('🔔 Todavía estoy aquí para lo que necesites.'),               6 * 60000),
    close:    setTimeout(() => { reply('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide por ahora! Vuelve cuando quieras 👋'); resetUser(from); }, 7 * 60000)
  };
}

function parsePrice(str) {
  if (!str) return Infinity;
  const s = str.toLowerCase();
  if (s.includes('gratis')) return 0;
  const digits = str.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : Infinity;
}

// — Webhook —
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const from  = msg.from;
  const reply = txt => sendText(from, txt);
  clearTimers(from);

  // 0) Botones interactivos
  if (msg.type === 'interactive' && msg.interactive.type === 'button_reply') {
    const id = msg.interactive.button_reply.id;
    if (id === 'VER_EVENTOS') {
      await reply('🔍 Buscando eventos en vivo…');
      const list = await getLiveEvents('eventos en vivo');
      if (!list.length) await reply('😔 No encontré eventos cercanos.');
      else {
        const out = list.map(ev =>
          `• *${ev.title}*\n` +
          `  📅 ${ev.date}\n` +
          `  📍 ${ev.venue}\n` +
          (ev.description ? `  📝 ${ev.description}\n` : '') +
          `  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Eventos en vivo:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (id === 'DICCIONARIO') {
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Entraste al *diccionario caleño*. Escríbeme la palabra que quieras consultar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
  }

  if (msg.type !== 'text') return res.sendStatus(200);
  const text = normalize(msg.text.body);

  try {
    // 0.5) Filtrado comida/restaurantes
    if (FOOD_TERMS.some(term => text.includes(term))) {
      await reply(
        '😔 Lo siento, CaliAndo no ofrece recomendaciones de comida. ' +
        'Pero puedo sugerirte paseos culturales, museos o actividades al aire libre. ' +
        '¿Te interesa algo así?'
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 1) Saludos → menú
    const GREET = ['hola','buenas','hey','holi','buenos días','buenas tardes'];
    if (GREET.some(w => text.includes(w))) {
      resetUser(from);
      await sendButtons(
        from,
        '👋 ¡Hola! ¿Qué te interesa hoy? Puedo mostrarte eventos en vivo o abrir el diccionario.',
        [ { id: 'VER_EVENTOS', title: 'Ver eventos en vivo' }, { id: 'DICCIONARIO', title: 'Abrir diccionario' } ]
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 2) Diccionario
    if (text.startsWith('diccionario') || sessionData[from]?.context === 'diccionario') {
      if (text.startsWith('diccionario')) {
        resetUser(from);
        sessionData[from].context    = 'diccionario';
        sessionData[from].dictPages  = null;
        sessionData[from].dictPageIdx = 0;
        await reply('📚 Entraste al *diccionario caleño*. Escríbeme la palabra que quieras consultar.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      if (text === 'ver mas' && Array.isArray(sessionData[from].dictPages)) {
        const idx   = sessionData[from].dictPageIdx + 1;
        const pages = sessionData[from].dictPages;
        if (idx < pages.length) {
          sessionData[from].dictPageIdx = idx;
          await reply(pages[idx]);
          if (idx < pages.length - 1) await reply('💡 Envía "ver mas" para continuar...');
        } else {
          await reply('📜 Ya no hay más páginas.');
        }
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const meaning = await getMeaningFromSerpAPI(text);
      if (!meaning) await reply(`😔 No encontré el significado de *${text}*.`);
      else {
        const pages = [];
        for (let i = 0; i < meaning.length; i += 800) pages.push(meaning.slice(i, i + 800));
        sessionData[from].dictPages   = pages;
        sessionData[from].dictPageIdx = 0;
        await reply(`📚 *${text}*:\n\n${pages[0]}`);
        if (pages.length > 1) await reply('💡 Envía "ver mas" para continuar...');
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 3) Eventos hoy/find
    if (/eventos?\s+(hoy|este fin de semana|finde)/.test(text)) {
      const when = text.match(/eventos?\s+(hoy|este fin de semana|finde)/)[1];
      await reply(`🔍 Buscando eventos ${when}…`);
      const list = await getLiveEvents(`eventos ${when}`);
      if (!list.length) await reply('😔 No encontré eventos para esa búsqueda.');
      else {
        const out = list.map(ev =>
          `• *${ev.title}*\n  📅 ${ev.date}\n  📍 ${ev.venue}\n${ev.description ? `  📝 ${ev.description}\n` : ''}  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Aquí algunos eventos ${when}:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 4) Filtrado precio
    if (sessionData[from]?.context === 'resultados' &&
       (/(mas\s+barat[oa]s?|más\s+barat[oa]s?)/.test(text) ||
        /(mas\s+car[oa]s?|más\s+car[oa]s?)/.test(text))) {
      const subset = eventosCache[from].lista.filter(e => e.fuente === 'civitatis');
      const detalles = await Promise.all(subset.map(e => getDetallePorFuente(e.fuente, e.referencia_id)));
      const combinado = subset.map((e, i) => ({ nombre: e.nombre, precioStr: detalles[i]?.precio || '—', precioNum: parsePrice(detalles[i]?.precio) })).filter(x => !isNaN(x.precioNum));
      const asc = /(barat[oa])/.test(text);
      combinado.sort((a, b) => asc ? a.precioNum - b.precioNum : b.precioNum - a.precioNum);
      const top5 = combinado.slice(0, 5);
      const header = asc ? '💸 5 planes más baratos:\n\n' : '💎 5 planes más caros:\n\n';
      await reply(header + top5.map(x => `• ${x.nombre} (${x.precioStr})`).join('\n'));
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 5) Selección o búsqueda (Fuse.js)
    if (sessionData[from]?.context === 'resultados') {
      const cache = eventosCache[from];
      if (text === 'ver mas') {
        cache.page = (cache.page || 0) + 1;
        const slice = cache.lista.slice(cache.page * 5, cache.page * 5 + 5);
        await reply(
          slice.length
            ? '🔎 Más recomendaciones:\n\n' + slice.map(e => `• ${e.nombre}`).join('\n') + '\n\nEscribe el nombre o "ver mas".'
            : '📜 No hay más resultados.'
        );
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const fuse = new Fuse(cache.lista, { keys: ['nombre'], threshold: 0.3, ignoreLocation: true });
      const fRes = fuse.search(text);
      if (fRes.length) {
        const elegido = fRes[0].item;
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
        let msg = `📚 *${d.nombre}*\n\n`;
        if (d.descripcion) msg += `📜 ${d.descripcion}\n\n`;
        ['ubicacion', 'tipo_de_lugar', 'redes_sociales', 'pagina_web', 'zona', 'ingreso_permitido', 'precio', 'enlace'].forEach(key => {
          if (d[key]) msg += `${key.replace(/_/g, ' ')}: ${d[key]}\n`;
        });
        await reply(msg);
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const { data } = await axios.post(
        `${FASTAPI_URL}/buscar-coincidencia`,
        { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
      );
      if (!data.ok || !data.resultados.length) await reply('😔 No encontré nada con esa frase. Prueba otra.');
      else {
        eventosCache[from] = { lista: data.resultados, page: 0 };
        const primeros = data.resultados.slice(0, 5).map(e => `• ${e.nombre}`).join('\n');
        await reply(`🔎 Te recomiendo estos planes:\n\n${primeros}\n\nEscribe el nombre o "ver mas".`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 6) Búsqueda semántica inicial
    const { data } = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
    );
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada con esa frase. Prueba otra.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    eventosCache[from] = { lista: data.resultados, page: 0 };
    sessionData[from]  = { context: 'resultados' };
    const primeros = data.resultados.slice(0, 5).map(e => `• ${e.nombre}`).join('\n');
    await reply(`🔎 Te recomiendo estos planes:\n\n${primeros}\n\nEscribe el nombre o "ver mas".`);
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Ocurrió un error. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`));
