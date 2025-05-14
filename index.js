require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const Fuse    = require('fuse.js');

// ───────────────────────────────────────────────────────────────────────────────
// Servicios externos
// ───────────────────────────────────────────────────────────────────────────────
const { getDetallePorFuente }   = require('./services/db/getDetalle');
const { getLiveEvents }         = require('./services/googleEvents');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

// ───────────────────────────────────────────────────────────────────────────────
// Gemini Flash – enriquecedor de respuestas humanizadas
// ───────────────────────────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY;
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY);


/**
 * Envía snippets + pregunta a Gemini Flash y devuelve respuesta pulida.
 * @param {string} userMsg - Pregunta original del usuario
 * @param {Array<{texto:string, score:number}>} docs - Top-k snippets contextuales
 * @returns {Promise<string>} - Texto enriquecido
 */
async function enrichAnswer(userMsg, docs) {
  // Construir contexto
  const ctx = docs.map((d, i) =>
    `Doc ${i + 1} (score ${d.score.toFixed(2)}): ${d.texto.slice(0, 350)}`
  ).join('\n\n');

  // Prompt para Gemini Flash
  const prompt = `
Eres *CaliAndo*, un asistente caleño cercano.
Objetivo: responder la pregunta del usuario usando SOLO la info del contexto.
Reglas:
• ≤180 palabras.
• Tono amistoso, 1-2 emojis máx.
• Si el contexto no basta, dilo brevemente y sugiere volver a preguntar.

Pregunta:
"${userMsg}"

Contexto:
${ctx}
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 220, temperature: 0.75, topP: 0.9 }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '😔 No se pudo generar respuesta.';
}

// ───────────────────────────────────────────────────────────────────────────────
// Setup Express & WhatsApp Helpers
// ───────────────────────────────────────────────────────────────────────────────
const app          = express();
app.use(express.json());
const PORT         = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL  = process.env.FASTAPI_URL;
if (!WHATSAPP_TKN || !PHONE_ID) throw new Error('🚨 Falta configuración de WhatsApp en .env');
if (!FASTAPI_URL) throw new Error('🚨 Falta FASTAPI_URL en .env');

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

// ───────────────────────────────────────────────────────────────────────────────
// Utilities: normalize, timers, session
// ───────────────────────────────────────────────────────────────────────────────
function normalize(str) {
  return str.normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').toLowerCase().trim();
}

const sessionData  = {};
const eventosCache = {};
const inactTimers  = {};

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
    warning1: setTimeout(() => reply('🔔 Sigo aquí si necesitas ayuda. ¿Quieres algo más?'), 5 * 60000),
    warning2: setTimeout(() => reply('🔔 Estoy pendiente.'), 6 * 60000),
    close: setTimeout(() => { reply('🕒 Adiós por ahora. ¡Vuelve pronto! 👋'); resetUser(from); }, 7 * 60000)
  };
}

function parsePrice(str) {
  if (!str) return Infinity;
  const s = str.toLowerCase();
  if (s.includes('gratis')) return 0;
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? Infinity : n;
}

const FOOD_TERMS = ['comida','restaurante','barcito','almuerzo','cena','pizza','taco','postre','helado','bebida'];

// ───────────────────────────────────────────────────────────────────────────────
// Webhook
// ───────────────────────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);
  const from = msg.from;
  const reply = txt => sendText(from, txt);
  clearTimers(from);

  // 0) Interactive buttons
  if (msg.type === 'interactive' && msg.interactive.type === 'button_reply') {
    const id = msg.interactive.button_reply.id;
    if (id === 'VER_EVENTOS') {
      await reply('🔍 Buscando eventos en vivo…');
      const list = await getLiveEvents('eventos en vivo');
      if (!list.length) await reply('😔 No encontré eventos cercanos.');
      else {
        const out = list.map(ev =>
          `• *${ev.title}*\n  📅 ${ev.date}\n  📍 ${ev.venue}${ev.description ? `\n  📝 ${ev.description}` : ''}\n  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Eventos en vivo:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (id === 'DICCIONARIO') {
      resetUser(from);
      sessionData[from].context = 'diccionario';
      await reply('📚 Entraste al diccionario caleño. Envía la palabra que quieras.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
  }

  // Textual messages
  if (msg.type !== 'text') return res.sendStatus(200);
  const text = normalize(msg.text.body);

  try {
    // 1) Food filter
    if (FOOD_TERMS.some(t => text.includes(t))) {
      await reply('😔 Lo siento, no recomiendo comida. Puedo sugerir planes culturales o al aire libre.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 2) Greetings → menu
    const GREET = ['hola','buenas','hey','holi','buenos días','buenas tardes'];
    if (GREET.some(w => text.includes(w))) {
      resetUser(from);
      await sendButtons(from, '👋 ¡Hola! ¿Qué te interesa hoy?', [
        { id: 'VER_EVENTOS', title: 'Ver eventos en vivo' },
        { id: 'DICCIONARIO', title: 'Abrir diccionario' }
      ]);
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 3) Dictionary flow
    if (text.startsWith('diccionario') || sessionData[from]?.context === 'diccionario') {
      if (text.startsWith('diccionario')) {
        resetUser(from);
        sessionData[from].context = 'diccionario';
        sessionData[from].dictPages = null;
        sessionData[from].dictPageIdx = 0;
        await reply('📚 Entraste al diccionario caleño. Envía la palabra que quieras.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      if (text === 'ver mas' && Array.isArray(sessionData[from].dictPages)) {
        const idx = sessionData[from].dictPageIdx + 1;
        const pages = sessionData[from].dictPages;
        if (idx < pages.length) {
          sessionData[from].dictPageIdx = idx;
          await reply(pages[idx]);
          if (idx < pages.length - 1) await reply('💡 Envía "ver mas" para continuar...');
        } else {
          await reply('📜 No hay más páginas.');
        }
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const meaning = await getMeaningFromSerpAPI(text);
      if (!meaning) await reply(`😔 No encontré el significado de *${text}*.`);
      else {
        const pages = [];
        for (let i = 0; i < meaning.length; i += 800) pages.push(meaning.slice(i, i + 800));
        sessionData[from].dictPages = pages;
        sessionData[from].dictPageIdx = 0;
        await reply(`📚 *${text}*:\n\n${pages[0]}`);
        if (pages.length > 1) await reply('💡 Envía "ver mas" para continuar...');
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 4) Quick event search today/weekend
    if (/eventos?\s+(hoy|este fin de semana|finde)/.test(text)) {
      const when = text.match(/eventos?\s+(hoy|este fin de semana|finde)/)[1];
      await reply(`🔍 Buscando eventos ${when}…`);
      const list = await getLiveEvents(`eventos ${when}`);
      if (!list.length) await reply('😔 No encontré eventos para esa búsqueda.');
      else {
        const out = list.map(ev =>
          `• *${ev.title}*\n  📅 ${ev.date}\n  📍 ${ev.venue}${ev.description ? `\n  📝 ${ev.description}` : ''}\n  🔗 ${ev.link}`
        ).join('\n\n');
        await reply(`🎫 Aquí algunos eventos ${when}:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 5) Price filter in results context
    if (sessionData[from]?.context === 'resultados' && /(barat|caro)/.test(text)) {
      const subset = eventosCache[from].lista.filter(e => e.fuente === 'civitatis');
      const detalles = await Promise.all(subset.map(e => getDetallePorFuente(e.fuente, e.referencia_id)));
      const combinado = subset.map((e, i) => ({ nombre: e.nombre, precioStr: detalles[i]?.precio || '—', precioNum: parsePrice(detalles[i]?.precio) }));
      const asc = /(barat)/.test(text);
      combinado.sort((a, b) => asc ? a.precioNum - b.precioNum : b.precioNum - a.precioNum);
      const top5 = combinado.slice(0, 5);
      const header = asc ? '💸 5 planes más baratos:\n\n' : '💎 5 planes más caros:\n\n';
      await reply(header + top5.map(x => `• ${x.nombre} (${x.precioStr})`).join('\n'));
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 6) Selection & enrich with Gemini Flash
    if (sessionData[from]?.context === 'resultados') {
      const cache = eventosCache[from];
      if (text === 'ver mas') {
        cache.page = (cache.page || 0) + 1;
        const slice = cache.lista.slice(cache.page * 5, cache.page * 5 + 5);
        await reply(slice.length
          ? `🔎 Más recomendaciones:\n\n${slice.map(e => `• ${e.nombre}`).join('\n')}\n\nEscribe el nombre o "ver mas".`
          : '📜 No hay más resultados.'
        );
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const fuseRes = new Fuse(cache.lista, { keys: ['nombre'], threshold: 0.3 }).search(text);
      if (fuseRes.length) {
        const elegido = fuseRes[0].item;
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
        const docs = [{ texto: `${d.nombre}. ${d.descripcion || ''}`, score: 0 }];
        let answer;
        try { answer = await enrichAnswer(msg.text.body, docs); }
        catch (err) {
          console.error('⚠️ Gemini enrich error:', err);
          answer = `📚 *${d.nombre}*\n${d.descripcion || ''}`;
        }
        await reply(answer);
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      // fallback to API search if Fuse misses
      const fbResp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, { texto: msg.text.body, fuente: 'whatsapp', nombre: 'CaliAndo' });
      const dataFB = fbResp.data;
      if (!dataFB.ok || !dataFB.resultados.length) await reply('😔 No encontré nada.');
      else {
        eventosCache[from] = { lista: dataFB.resultados, page: 0 };
        const primeros = dataFB.resultados.slice(0, 5).map(e => `• ${e.nombre}`).join('\n');
        await reply(`🔎 Te recomiendo estos planes:\n\n${primeros}\n\nEscribe el nombre o "ver mas".`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // 7) Initial semantic search
    const resp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, { texto: msg.text.body, fuente: 'whatsapp', nombre: 'CaliAndo' });
    const data = resp.data;
    if (!data.ok || !data.resultados.length) {
      await reply('😔 No encontré nada. Prueba otra frase.');
    } else {
      eventosCache[from] = { lista: data.resultados, page: 0 };
      sessionData[from] = { context: 'resultados' };
      const primeros = data.resultados.slice(0, 5).map(e => `• ${e.nombre}`).join('\n');
      await reply(`🔎 Te recomiendo estos planes:\n\n${primeros}\n\nEscribe el nombre o "ver mas".`);
    }
    startInactivity(from, reply);
    return res.sendStatus(200);

  } catch (err) {
    console.error('💥 Error en webhook:', err);
    await reply('❌ Error interno. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`🚀 CaliAndo Bot escuchando en puerto ${PORT}`));
