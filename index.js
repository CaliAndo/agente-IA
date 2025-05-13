// index.js
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { getDetallePorFuente }   = require('./services/db/getDetallePorFuente');
const { getLiveEvents }         = require('./services/serpAPI/googleEvents');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health‐check
app.get('/', (_req, res) => res.send('🟢 CaliAndo Bot OK'));

const PORT         = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL  = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error('🚨 FASTAPI_URL no está definida');

// — State —
const sessionData  = {}; // sessionData[from] = { context, dictPages?, dictPageIdx? }
const eventosCache = {}; // eventosCache[from] = { lista, page }
const inactTimers  = {}; // inactivity timers

// — Helpers —
// envía texto simple
function sendText(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product:'whatsapp', to, text:{ body: text } },
    { headers:{ Authorization:`Bearer ${WHATSAPP_TKN}` } }
  );
}
// envía botones interactivos
function sendButtons(to, bodyText, buttons) {
  const interactive = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map(b => ({
        type: 'reply',
        reply: { id: b.id, title: b.title }
      }))
    }
  };
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product:'whatsapp', to, interactive },
    { headers:{ Authorization:`Bearer ${WHATSAPP_TKN}` } }
  );
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
  sessionData[from] = { context:'inicio' };
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
      reply('🕒 Parece que no hubo respuesta. ¡CaliAndo se despide! Vuelve cuando quieras 👋');
      resetUser(from);
    }, 120_000)
  };
}

function parsePrice(str) {
  if (!str) return Infinity;
  const s = str.toLowerCase();
  if (s.includes('gratis')) return 0;
  const digits = str.replace(/[^0-9]/g,'');
  return digits ? parseInt(digits,10) : Infinity;
}

// — Webhook —
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const from  = msg.from;
  const reply = txt => sendText(from, txt);
  clearTimers(from);

  // 0) Manejo de botones interactivos
  if (msg.type === 'interactive' && msg.interactive.type === 'button_reply') {
    const id = msg.interactive.button_reply.id;
    if (id === 'VER_EVENTOS') {
      // Botón: Ver eventos en vivo
      await reply('🔍 Buscando eventos en vivo…');
      const list = await getLiveEvents('eventos en vivo');
      if (!list.length) {
        await reply('😔 No encontré eventos cercanos.');
      } else {
        const out = list.map(ev =>
          `• *${ev.title}*\n` +
          `  📅 ${ev.date}\n` +
          `  📍 ${ev.venue}\n` +
          (ev.description?`  📝 ${ev.description}\n`:'') +
          `  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Eventos en vivo:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (id === 'DICCIONARIO') {
      // Botón: Abrir diccionario
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Entraste al *diccionario caleño*. Escríbeme la palabra que quieras consultar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
  }

  // Si no es interacción, seguimos con texto
  if (msg.type !== 'text') return res.sendStatus(200);
  const text = normalize(msg.text.body);

  try {
    // 1) Saludos → menú de botones
    const GREET = ['hola','buenas','hey','holi','buenos días','buenas tardes'];
    if (GREET.some(w => text.includes(w))) {
      resetUser(from);
      await sendButtons(from,
        '👋 ¡Hola! ¿Qué te interesa hoy?',
        [
          { id:'VER_EVENTOS', title:'Ver eventos en vivo' },
          { id:'DICCIONARIO', title:'Abrir diccionario' }
        ]
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 2) Diccionario
    if (text.startsWith('diccionario') || sessionData[from]?.context === 'diccionario') {
      if (!sessionData[from].dictPages) {
        const meaning = await getMeaningFromSerpAPI(text);
        if (!meaning) {
          await reply(`😔 No encontré el significado de *${text}*.`);
        } else {
          const pages = [];
          for (let i = 0; i < meaning.length; i += 800) {
            pages.push(meaning.slice(i, i + 800));
          }
          sessionData[from].dictPages = pages;
          sessionData[from].dictPageIdx = 0;
          await reply(`📚 *${text}*:\n\n${pages[0]}`);
          if (pages.length > 1) await reply('💡 Envía "ver mas" para continuar...');
        }
      } else if (text === 'ver mas') {
        const pages = sessionData[from].dictPages;
        let idx = sessionData[from].dictPageIdx + 1;
        if (idx < pages.length) {
          sessionData[from].dictPageIdx = idx;
          await reply(pages[idx]);
          if (idx < pages.length - 1) await reply('💡 Envía "ver mas" para continuar...');
        }
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 3) Eventos en texto (hoy, finde…)
    if (/eventos?\s+(hoy|este fin de semana|finde)/.test(text)) {
      const when = text.match(/eventos?\s+(hoy|este fin de semana|finde)/)[1];
      await reply(`🔍 Buscando eventos ${when}…`);
      const list = await getLiveEvents(`eventos ${when}`);
      if (!list.length) {
        await reply('😔 No encontré eventos para esa búsqueda.');
      } else {
        const out = list.map(ev =>
          `• *${ev.title}*\n` +
          `  📅 ${ev.date}\n` +
          `  📍 ${ev.venue}\n` +
          (ev.description?`  📝 ${ev.description}\n`:'') +
          `  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Aquí algunos eventos ${when}:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 4) Filtrado más baratos/caros tras resultados
    if (sessionData[from]?.context === 'resultados' &&
       (/(mas\s+barat[oa]s?|más\s+barat[oa]s?)/.test(text) ||
        /(mas\s+car[oa]s?|más\s+car[oa]s?)/.test(text))
    ) {
      const subset = eventosCache[from].lista.filter(e => e.fuente==='civitatis');
      const detalles = await Promise.all(
        subset.map(e=>getDetallePorFuente(e.fuente,e.referencia_id))
      );
      const combinado = subset.map((e,i)=>({
        nombre:   e.nombre,
        precioStr: detalles[i]?.precio||'—',
        precioNum: parsePrice(detalles[i]?.precio)
      })).filter(x=>!isNaN(x.precioNum));
      const asc = /(barat[oa])/.test(text);
      combinado.sort((a,b)=> asc? a.precioNum-b.precioNum : b.precioNum-a.precioNum);
      const top5 = combinado.slice(0,5);
      const header = asc
        ? '💸 5 planes más baratos:\n\n'
        : '💎 5 planes más caros:\n\n';
      const body = top5.map(x=>`• ${x.nombre} (${x.precioStr})`).join('\n');
      await reply(header + body);
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 5) Selección por nombre tras resultados
    if (sessionData[from]?.context==='resultados') {
      const cache = eventosCache[from];
      if (text === 'ver mas') {
        cache.page = (cache.page||0) + 1;
        const slice = cache.lista.slice(cache.page*5, cache.page*5+5);
        await reply(
          slice.length
            ? '🔎 Más recomendaciones:\n\n'+ slice.map(e=>`• ${e.nombre}`).join('\n') + '\n\nEscribe el nombre para ver detalle.'
            : '📜 No hay más resultados.'
        );
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const elegido = cache.lista.find(ev=>{
        const nm = normalize(ev.nombre);
        return text.includes(nm) || nm.includes(text);
      });
      if (elegido) {
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
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
        return res.sendStatus(200);
      }
      await reply('❌ No reconocí ese nombre. Escribe el nombre exacto o "ver mas".');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 6) Búsqueda semántica (nuevo flujo)
    const { data } = await axios.post(
      `${FASTAPI_URL}/buscar-coincidencia`,
      { texto: text, fuente:'whatsapp', nombre:'CaliAndo' }
    );
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada con esa frase. Prueba otra.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    eventosCache[from] = { lista:data.resultados, page:0 };
    sessionData[from]  = { context:'resultados' };
    const primeros = data.resultados.slice(0,5).map(e=>`• ${e.nombre}`).join('\n');
    await reply(`🔎 Te recomiendo estos planes:\n\n${primeros}\n\nEscribe el nombre o "ver mas".`);
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch(err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Ocurrió un error. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', ()=> {
  console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`);
});
