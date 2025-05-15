require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Fuse = require('fuse.js');
const fetch = require('node-fetch'); // para usar fetch en Node.js

// Servicios externos
const { getDetallePorFuente } = require('./services/db/getDetalle');
const { getLiveEvents } = require('./services/googleEvents');
const { getMeaning } = require('./services/db/getDiccionario');

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) throw new Error('🚨 Falta GEMINI_API_KEY en .env');

// Función para enriquecer la respuesta con Gemini Flash
async function enrichAnswer(userMsg, docs) {
  const ctx = docs.map((d, i) => {
    let base = `Evento ${i + 1}: ${d.nombre}`;
    if (d.date) base += ` | Fecha: ${d.date}`;
    if (d.venue) base += ` | Lugar: ${d.venue}`;
    if (d.link) base += ` | Más info: ${d.link}`;
    base += `\nDescripción: ${d.descripcion || 'Sin descripción disponible.'}`;
    return base;
  }).join('\n\n');

  const prompt = `
Eres CaliAndo, un asistente caleño muy cercano y amigable.
Tu tarea es responder la pregunta del usuario usando SOLO la información del contexto (los eventos listados).
Debes ser cálido, usar emojis (máximo 2), y que la respuesta no supere 200 palabras.

Pregunta:
"${userMsg}"

Contexto:
${ctx}

Respuesta:`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 250, temperature: 0.7, topP: 0.9 }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '😔 No pude generar respuesta.';
}

// Setup Express y helpers WhatsApp
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const WHATSAPP_TKN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL = process.env.FASTAPI_URL;
if (!WHATSAPP_TKN || !PHONE_ID) throw new Error('🚨 Falta configuración de WhatsApp');
if (!FASTAPI_URL) throw new Error('🚨 Falta FASTAPI_URL');

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

// Utilities y sesiones
const sessionData = {};
const eventosCache = {};
const inactTimers = {};

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
    warning1: setTimeout(() => reply('🔔 Aquí sigo si necesitas algo más!'), 5 * 60000),
    warning2: setTimeout(() => reply('🔔 Seguimos atentos.'), 6 * 60000),
    close: setTimeout(() => {
      reply('🕒 Hasta luego! 👋');
      resetUser(from);
    }, 7 * 60000),
  };
}
function normalize(str) {
  return str.normalize('NFD').replace(/[^\p{L}\p{N} ]/gu, '').toLowerCase().trim();
}
function parsePrice(str) {
  if (!str) return Infinity;
  const n = parseInt(str.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? Infinity : n;
}
const FOOD_TERMS = ['comida', 'restaurante', 'pizza', 'taco', 'postre', 'helado', 'bebida'];

// Webhook principal
app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);
  const from = msg.from;
  const reply = (txt) => sendText(from, txt);
  clearTimers(from);

  // Botones interactivos básicos (eventos vivo o diccionario)
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

  if (msg.type !== 'text') return res.sendStatus(200);
  const text = normalize(msg.text.body);

  try {
    // Filtro comida simple
    if (FOOD_TERMS.some(t => text.includes(t))) {
      await reply('😔 Lo siento, no recomiendo comida. Puedo sugerir planes culturales o al aire libre.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Saludos: menú amigable con texto enriquecido
    const GREET = ['hola', 'buenas', 'hey', 'holi', 'buenos días', 'buenas tardes'];
    if (GREET.some(w => text.includes(w))) {
      resetUser(from);
      await sendButtons(
        from,
        '¡Hola! Soy CaliAndo y estoy aquí para ayudarte a descubrir lo mejor de Cali. Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos? Estoy listo para mostrarte lo que esta ciudad sabrosa tiene para ti 💃',
        [
          { id: 'VER_EVENTOS', title: 'Ver eventos en vivo' },
          { id: 'DICCIONARIO', title: 'Abrir diccionario' },
        ]
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Comandos para salir o cambiar contexto
    if (['salir', 'volver', 'menu'].includes(text)) {
      resetUser(from);
      await sendButtons(
        from,
        '¿Qué quieres hacer ahora? Aquí te dejo opciones:',
        [
          { id: 'VER_EVENTOS', title: 'Ver eventos en vivo' },
          { id: 'DICCIONARIO', title: 'Abrir diccionario' },
        ]
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Flujo diccionario
    if (sessionData[from]?.context === 'diccionario') {
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

      const significado = await getMeaning(text);
      if (!significado) {
        await reply(`😔 No encontré el significado de *${text}* en el diccionario.`);
      } else {
        const pages = [];
        for (let i = 0; i < significado.length; i += 800) {
          pages.push(significado.slice(i, i + 800));
        }
        sessionData[from].dictPages = pages;
        sessionData[from].dictPageIdx = 0;
        await reply(`📚 *${text}*:\n\n${pages[0]}`);
        if (pages.length > 1) await reply('💡 Envía "ver mas" para continuar...');
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Búsqueda rápida eventos hoy/fin de semana
    if (/eventos?\s+(hoy|este fin de semana|finde)/.test(text)) {
      const when = text.match(/eventos?\s+(hoy|este fin de semana|finde)/)[1];
      await reply(`🔍 Buscando eventos ${when}…`);
      const list = await getLiveEvents(`eventos ${when}`);
      if (!list.length) await reply('😔 No encontré eventos para esa búsqueda.');
      else {
        const out = list
          .map(
            (ev) =>
              `• *${ev.title}*\n  📅 ${ev.date}\n  📍 ${ev.venue}${
                ev.description ? `\n  📝 ${ev.description}` : ''
              }\n  🔗 ${ev.link}`
          )
          .join('\n\n');
        await reply(`🎫 Aquí algunos eventos ${when}:\n\n${out}`);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Filtro precio en contexto resultados
    if (sessionData[from]?.context === 'resultados' && /(barat|caro)/.test(text)) {
      const subset = eventosCache[from].lista.filter((e) => e.fuente === 'civitatis');
      const detalles = await Promise.all(subset.map((e) => getDetallePorFuente(e.fuente, e.referencia_id)));
      const combinado = subset.map((e, i) => ({
        nombre: e.nombre,
        precioStr: detalles[i]?.precio || '—',
        precioNum: parsePrice(detalles[i]?.precio),
      }));
      const asc = /(barat)/.test(text);
      combinado.sort((a, b) => (asc ? a.precioNum - b.precioNum : b.precioNum - a.precioNum));
      const top5 = combinado.slice(0, 5);
      const header = asc ? '💸 5 planes más baratos:\n\n' : '💎 5 planes más caros:\n\n';
      await reply(header + top5.map((x) => `• ${x.nombre} (${x.precioStr})`).join('\n'));
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Selección y enriquecimiento con Gemini Flash
    if (sessionData[from]?.context === 'resultados') {
      const cache = eventosCache[from];
      if (text === 'ver mas') {
        cache.page = (cache.page || 0) + 1;
        const slice = cache.lista.slice(cache.page * 5, cache.page * 5 + 5);
        await reply(
          slice.length
            ? `🔎 Más recomendaciones:\n\n${slice.map((e) => `• ${e.nombre}`).join('\n')}\n\nEscribe el nombre o "ver mas".`
            : '📜 No hay más resultados.'
        );
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const fuseRes = new Fuse(cache.lista, { keys: ['nombre'], threshold: 0.3 }).search(text);
      if (fuseRes.length) {
        const elegido = fuseRes[0].item;
        const d = await getDetallePorFuente(elegido.fuente, elegido.referencia_id);
        const docs = [
          {
            texto: `${d.nombre}. ${d.descripcion || ''}`,
            score: 0,
            link: d.enlace,
            date: d.fecha,
            venue: d.lugar,
            nombre: d.nombre,
            descripcion: d.descripcion,
          },
        ];
        let answer;
        try {
          answer = await enrichAnswer(msg.text.body, docs);
        } catch (err) {
          console.error('⚠️ Gemini enrich error:', err);
          answer = `📚 *${d.nombre}*\n${d.descripcion || ''}`;
        }
        await reply(answer);
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      // fallback a búsqueda API si Fuse falla
      const fbResp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: msg.text.body,
        fuente: 'whatsapp',
        nombre: 'CaliAndo',
      });
      const dataFB = fbResp.data;
      if (!dataFB.ok || !dataFB.resultados.length) await reply('😔 No encontré nada.');
      else {
        eventosCache[from] = { lista: dataFB.resultados, page: 0 };
        const primeros = dataFB.resultados
          .slice(0, 5)
          .map((e) => {
            return (
              `✨ *${e.nombre}*\n` +
              `📅 Fecha: ${e.date || 'Por confirmar'}\n` +
              `📍 Lugar: ${e.venue || 'Por confirmar'}\n` +
              (e.link ? `🔗 Más info: ${e.link}\n` : '')
            );
          })
          .join('\n');

        const mensaje = `¡Hola! 😊 Aquí te dejo algunas recomendaciones que seguro te van a encantar:\n\n${primeros}\n
¿Quieres que te cuente más de algún plan? Solo escribe el nombre o dime "ver más". ¡Estoy aquí para ayudarte! 🚀`;

        await reply(mensaje);
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // Búsqueda semántica inicial (fallback final)
    const resp = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
      texto: msg.text.body,
      fuente: 'whatsapp',
      nombre: 'CaliAndo',
    });
    const data = resp.data;

    if (!data.ok || !data.resultados.length) {
      await reply('😔 Uy, no pude encontrar nada con eso. ¿Quieres probar con otra frase? Estoy aquí para ayudarte.');
    } else {
      eventosCache[from] = { lista: data.resultados, page: 0 };
      sessionData[from] = { context: 'resultados' };

      const primeros = data.resultados.slice(0, 5).map((e) => `• ${e.nombre}`).join('\n');

      const mensajesIntro = [
        '¡Hola! Aquí algunas ideas para disfrutar Cali a tope:',
        '✨ Te recomiendo estos planes que seguro te van a encantar:',
        '🎉 Si quieres pasarla bien, prueba con estos planes:',
        '¿Buscas algo para hacer? Mira estas opciones:',
      ];

      const intro = mensajesIntro[Math.floor(Math.random() * mensajesIntro.length)];

      const mensaje = `${intro}\n\n${primeros}\n\n¿Quieres que te cuente más sobre alguno? Solo dime el nombre o escribe "ver más".`;

      await reply(mensaje);
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
