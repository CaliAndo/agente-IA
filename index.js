require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Fuse = require('fuse.js');
const fetch = require('node-fetch'); // para usar fetch en Node.js

// Servicios externos
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getLiveEvents } = require('./services/googleEvents');
const { getMeaning } = require('./services/db/getDiccionario');
const { getdichoByIndex } = require('./services/db/getDicho');

// Validación de variables de entorno
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) throw new Error('🚨 Falta GEMINI_API_KEY en .env');

const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL = process.env.FASTAPI_URL;
if (!WHATSAPP_TKN || !PHONE_ID) throw new Error('🚨 Falta configuración de WhatsApp');
if (!FASTAPI_URL) throw new Error('🚨 Falta FASTAPI_URL');

// Inicialización de Express
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Estado en memoria (pendiente migrar a store con TTL)
const sessionData = {};
const eventosCache = {};
const inactTimers = {};

// --- Helpers WhatsApp ---
function sendText(to, body) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  );
}

function sendButtons(to, text, buttons) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.title } })) }
    }
  };
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${WHATSAPP_TKN}` } }
  );
}

// Menú principal reutilizable
function sendMainMenu(to) {
  return sendButtons(to,
    '¿Qué quieres hacer ahora?',
    [
      { id: 'VER_EVENTOS', title: 'Ver eventos en vivo' },
      { id: 'DICCIONARIO', title: 'Abrir diccionario caleño' },
      { id: 'DICHOS', title: 'Dichos caleños' }
    ]
  );
}

// Normalización y parsing
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .toLowerCase()
    .trim();
}

function parsePrice(str) {
  if (!str) return Infinity;
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? Infinity : n;
}

// Términos de comida para filtro
const FOOD_TERMS = [
  'comida','restaurante','pizza','taco','postre','helado','bebida',
  'hamburguesa','sandwich','hot dog','perro caliente','ensalada','sopa',
  'pollo','carne','pescado','mariscos','ceviche','arroz','pasta','lasagna',
  'empanada','arepa','tamal','antojito','snack','aperitivo','merienda',
  'desayuno','almuerzo','cena','brunch','cafeteria','cafe','te','vino',
  'cerveza','licor','cocktail','jugo','smoothie','batido','yogur','queso',
  'pan','galleta','torta','pastel','chocolate'
];

const EXIT_DICT_WORDS = ['salir','volver','regresar','eventos'];
const EXIT_DICHOS_WORDS = [...EXIT_DICT_WORDS];

// Manejo de inactividad y limpieza de sesión
function clearTimers(user) {
  const t = inactTimers[user];
  if (t) {
    clearTimeout(t.warning1);
    clearTimeout(t.warning2);
    clearTimeout(t.close);
    delete inactTimers[user];
  }
}

function resetSession(user) {
  sessionData[user] = { context: 'inicio' };
  delete eventosCache[user];
  delete sessionData[user].dictPages;
  delete sessionData[user].dictPageIdx;
  delete sessionData[user].dichoIndex;
  clearTimers(user);
}

function startInactivity(user, reply) {
  clearTimers(user);
  inactTimers[user] = {
    warning1: setTimeout(() => reply('🔔 Sigo aquí si necesitas algo.'), 5 * 60000),
    warning2: setTimeout(() => reply('🔔 Aún atento.'), 6 * 60000),
    close:    setTimeout(() => { reply('🕒 Hasta luego! 👋'); resetSession(user); }, 7 * 60000)
  };
}

// Función para enriquecer con Gemini
async function enrichAnswer(userPrompt, docs) {
  const ctx = docs.map((d, i) => `Plan ${i+1}: ${d.nombre}\nDescripción: ${d.descripcion}`).join('\n\n');
  const prompt = `Eres CaliAndo, un asistente caleño muy cercano y amigable.\n` +
                 `Responde de forma natural usando SOLO la información dada, sin exponer metadatos.\n` +
                 `Usa hasta 2 emojis y no más de 200 palabras.\n\n` +
                 `Usuario: "${userPrompt}"\n\nPlanes:\n${ctx}\n\nRespuesta:`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.7, topP: 0.9 }
    })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '😔 No pude generar respuesta.';
}

// Flujo enriquecido de eventos
async function fetchAndReplyEvents(user, reply) {
  await reply('🔍 Buscando eventos en vivo…');
  const list = await getLiveEvents('eventos en vivo');
  if (!list.length) {
    await reply('😔 No encontré eventos.');
    return sendMainMenu(user);
  }
  const docs = list.slice(0,5).map(ev => ({ nombre: ev.title, descripcion: ev.description || 'Sin más detalles, ¡pero suena genial!' }));
  let message;
  try {
    message = await enrichAnswer('Recomiéndame eventos en vivo', docs);
  } catch (e) {
    console.error('Gemini error', e);
    message = '✨ Opciones:\n' + docs.map(d => `• ${d.nombre}`).join('\n');
  }
  await reply(message);
  startInactivity(user, reply);
}

// Webhook principal
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);
  const user = msg.from;
  const reply = text => sendText(user, text);
  clearTimers(user);

  // Botones interactivos
  if (msg.type === 'interactive' && msg.interactive.type === 'button_reply') {
    const id = msg.interactive.button_reply.id;
    if (id === 'VER_EVENTOS') {
      await fetchAndReplyEvents(user, reply);
      return res.sendStatus(200);
    }
    if (id === 'DICCIONARIO') {
      resetSession(user);
      sessionData[user].context = 'diccionario';
      await reply('📚 Entraste al diccionario caleño. Envía la palabra.🔄 Salir: salir, regresar o eventos.');
      startInactivity(user, reply);
      return res.sendStatus(200);
    }
    if (id === 'DICHOS') {
      resetSession(user);
      sessionData[user].context = 'dichos';
      sessionData[user].dichoIndex = 0;
      const d = await getdichoByIndex(0);
      await reply(d ? `📜 *${d.dicho}*\n\n${d.significado}` : '😔 No hay dichos.');
      await sendMainMenu(user);
      startInactivity(user, reply);
      return res.sendStatus(200);
    }
  }

  if (msg.type !== 'text') return res.sendStatus(200);
  const text = normalize(msg.text.body);

  try {
    // Filtro comida
    if (FOOD_TERMS.some(t => text.includes(t))) {
      await reply('😔 No recomiendo comida. Puedo sugerir planes culturales.');
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Saludos
    const GREET = ['hola','buenas','hey','holi','buenos días','buenas tardes'];
    if (GREET.some(w => text.includes(w))) {
      resetSession(user);
      await sendButtons(user,
        '¡Hola! Soy CaliAndo, ¿qué te interesa hoy? 💃',
        [ { id:'VER_EVENTOS', title:'Ver eventos en vivo' }, { id:'DICCIONARIO', title:'Abrir diccionario caleño' }, { id:'DICHOS', title:'Dichos caleños' } ]
      );
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Contexto: diccionario
    if (sessionData[user]?.context === 'diccionario') {
      if (EXIT_DICT_WORDS.some(w => text.includes(w))) {
        resetSession(user);
        if (text.includes('evento')) await fetchAndReplyEvents(user, reply);
        else await sendMainMenu(user);
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      if (text === 'ver mas' && Array.isArray(sessionData[user].dictPages)) {
        const i = sessionData[user].dictPageIdx + 1;
        const pages = sessionData[user].dictPages;
        if (i < pages.length) {
          sessionData[user].dictPageIdx = i;
          await reply(pages[i]);
          if (i < pages.length - 1) await reply('💡 Ver más...');
        } else {
          await reply('📜 Fin del diccionario.');
        }
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      const meaning = await getMeaning(text);
      if (!meaning) {
        await reply(`😔 No encontré *${text}*.`);
      } else {
        const pages = [];
        for (let j = 0; j < meaning.length; j += 800) pages.push(meaning.slice(j, j + 800));
        sessionData[user].dictPages = pages;
        sessionData[user].dictPageIdx = 0;
        await reply(`📚 *${text}*:\n\n${pages[0]}`);
        if (pages.length > 1) await reply('💡 Ver más...');
      }
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Contexto: dichos
    if (sessionData[user]?.context === 'dichos') {
      if (EXIT_DICHOS_WORDS.some(w => text.includes(w))) {
        resetSession(user);
        if (text.includes('evento')) await fetchAndReplyEvents(user, reply);
        else await sendMainMenu(user);
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      if (text === 'otro dicho') {
        sessionData[user].dichoIndex++;
        const d = await getdichoByIndex(sessionData[user].dichoIndex);
        if (!d) {
          await reply('😔 No más dichos.');
          await sendMainMenu(user);
        } else {
          await reply(`📜 *${d.dicho}*\n\n${d.significado}`);
          await sendMainMenu(user);
        }
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      await reply('Escribe "otro dicho" o "salir" para volver.');
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Búsqueda rápida: hoy/fin de semana
    if (/eventos?\s+(hoy|fin de semana|finde)/.test(text)) {
      await fetchAndReplyEvents(user, reply);
      return res.sendStatus(200);
    }

    // Filtrado por precio
    if (sessionData[user]?.context === 'resultados' && /(barat|caro)/.test(text)) {
      const subset = eventosCache[user].lista.filter(e => e.fuente === 'civitatis');
      const detalles = await Promise.all(subset.map(e => getDetallePorFuente(e.fuente, e.referencia_id)));
      const list = subset.map((e,i) => ({ nombre: e.nombre, precio: parsePrice(detalles[i]?.precio) }));
      const asc = /barat/.test(text);
      list.sort((a,b) => asc ? a.precio - b.precio : b.precio - a.precio);
      await reply((asc? '💸 Más baratos:' : '💎 Más caros:') + '\n' + list.slice(0,5).map(x => `• ${x.nombre}`).join('\n'));
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Selección y enriquecimiento en resultados
    if (sessionData[user]?.context === 'resultados') {
      const cache = eventosCache[user];
      if (text === 'ver mas') {
        cache.page = (cache.page || 0) + 1;
        const slice = cache.lista.slice(cache.page * 5, cache.page * 5 + 5);
        await reply(slice.length ? `🔎 Más:\n${slice.map(e => `• ${e.nombre}`).join('\n')}` : '📜 Fin.');
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      const result = new Fuse(cache.lista, { keys:['nombre'], threshold:0.3 }).search(text);
      if (result.length) {
        const item = result[0].item;
        const d = await getDetallePorFuente(item.fuente, item.referencia_id);
        const docs = [{ nombre: d.nombre, descripcion: d.descripcion || 'Sin descripción.' }];
        let ans;
        try { ans = await enrichAnswer(msg.text.body, docs); }
        catch { ans = `📚 ${d.nombre}`; }
        await reply(ans);
        startInactivity(user, reply);
        return res.sendStatus(200);
      }
      // fallback API
      const fb = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, { texto: msg.text.body, fuente:'whatsapp', nombre:'CaliAndo' });
      if (!fb.data.ok || !fb.data.resultados.length) await reply('😔 No hallé nada.');
      else {
        eventosCache[user] = { lista: fb.data.resultados, page: 0 };
        await reply('✨ Recomendaciones:\n' + fb.data.resultados.slice(0,5).map(e => `• ${e.nombre}`).join('\n'));
      }
      startInactivity(user, reply);
      return res.sendStatus(200);
    }

    // Fallback semántico inicial
    const sem = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, { texto: msg.text.body, fuente:'whatsapp', nombre:'CaliAndo' });
    if (!sem.data.ok || !sem.data.resultados.length) await reply('😔 No entendí, intenta otra.');
    else {
      eventosCache[user] = { lista: sem.data.resultados, page: 0 };
      sessionData[user] = { context: 'resultados' };
      const docs = sem.data.resultados.slice(0,5).map(e => ({ nombre: e.nombre, descripcion: e.description || '' }));
      let enriched;
      try { enriched = await enrichAnswer(msg.text.body, docs); }
      catch { enriched = docs.map(d => `• ${d.nombre}`).join('\n'); }
      await reply(enriched);
    }
    startInactivity(user, reply);
    return res.sendStatus(200);
  } catch (error) {
    console.error('Webhook Error:', error);
    await reply('❌ Error interno. Intenta más tarde.');
    return res.sendStatus(500);
  }
});

app.listen(PORT, () => console.log(`🚀 CaliAndo Bot escuchando en puerto ${PORT}`));
