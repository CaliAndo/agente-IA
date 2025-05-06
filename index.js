// index.js
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { getDetallePorFuente }  = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health‐check
app.get('/', (_req, res) => res.status(200).send('🟢 CaliAndo Bot OK'));

// Webhook verify
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode']==='subscribe' &&
      req.query['hub.verify_token']===process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

const PORT           = process.env.PORT || 3000;
const PHONE_ID       = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const FASTAPI_URL    = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error('🚨 FASTAPI_URL no está definida');

// Estado
const sessionData       = {};  // { from: { context, greeted?, dictPages?, dictPageIdx? } }
const eventosCache      = {};  // { from: { lista, pagina } }
const inactividadTimers = {};

// Envía por WhatsApp
function sendMessage(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  ).catch(console.error);
}

// Normaliza texto
function normalize(s) {
  return s.normalize('NFD')
          .replace(/[\u0300-\u036f]/g,'')
          .trim()
          .toLowerCase();
}

// Limpia timers
function clearTimers(from) {
  const t = inactividadTimers[from];
  if (t) {
    clearTimeout(t.warning);
    clearTimeout(t.close);
    delete inactividadTimers[from];
  }
}

// Reset estado (conservar greeted)
function resetUser(from) {
  const greeted = sessionData[from]?.greeted;
  sessionData[from] = { context: 'inicio', greeted };
  delete eventosCache[from];
  delete sessionData[from].dictPages;
  delete sessionData[from].dictPageIdx;
  clearTimers(from);
}

// Warning y cierre
function startInactivity(from, reply) {
  clearTimers(from);
  const WARNING = 2 * 60 * 1000;  // 2 min
  const CLOSE   = 5 * 60 * 1000;  // 5 min
  inactividadTimers[from] = {
    warning: setTimeout(() => {
      reply('🔔 Sigo aquí si necesitas algo. ¿Quieres que te recomiende algo?');
    }, WARNING),
    close: setTimeout(() => {
      reply('🕒 No recibí respuesta, cierro chat. ¡Vuelve pronto! 👋');
      resetUser(from);
    }, CLOSE)
  };
}

app.post('/webhook', async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg || msg.type !== 'text') {
    return res.sendStatus(200);
  }

  const from  = msg.from;
  const text  = normalize(msg.text.body);
  const reply = txt => sendMessage(from, txt);

  // Primer mensaje → saludo
  if (!sessionData[from]?.greeted) {
    sessionData[from] = { context: 'inicio', greeted: true };
    await reply(
`👋 ¡Hola! Soy *CaliAndo*, tu guía de planes en Cali.
Escríbeme lo que quieras: un plan, un término caleño, o incluso el nombre de un evento para ver detalles.
Estoy listo para ayudarte. 🇨🇴💃`
    );
    startInactivity(from, reply);
    return res.sendStatus(200);
  }

  clearTimers(from);

  // Despedida
  if (/^(adios|hasta luego|bye|nos vemos)/i.test(msg.text.body)) {
    await reply('👋 ¡Hasta luego! Cuando quieras vuelves a escribirme.');
    resetUser(from);
    return res.sendStatus(200);
  }

  // Diccionario
  if (text.startsWith('diccionario')) {
    sessionData[from].context = 'diccionario';
    await reply('📚 Diccionario caleño: dime la palabra que quieres conocer.');
    startInactivity(from, reply);
    return res.sendStatus(200);
  }

  // Diccionario en páginas
  if (sessionData[from]?.context === 'diccionario') {
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
      if (pages.length > 1) {
        await reply('💡 Envía "ver mas" para continuar...');
      }
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
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

  // Paginación semántica: "ver mas"
  if (text.includes('ver mas') && sessionData[from]?.context === 'resultados') {
    const cache = eventosCache[from];
    if (!cache) {
      await reply('ℹ️ No hay búsqueda activa. Escribe algo para buscar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    const nextPage  = cache.pagina + 1;
    const startIdx  = nextPage * 5;
    const items     = cache.lista.slice(startIdx, startIdx + 5);
    if (items.length === 0) {
      await reply('📜 No hay más resultados.');
    } else {
      cache.pagina = nextPage;
      const listText = items.map(it => it.nombre).join(', ').replace(/, ([^,]*)$/, ' y $1');
      await reply(
        `📍 Te sugiero: ${listText}.\n\n` +
        `Escríbeme el nombre que te interese o "ver mas" para seguir.`
      );
    }
    startInactivity(from, reply);
    return res.sendStatus(200);
  }

  // Selección por nombre
  if (sessionData[from]?.context === 'resultados') {
    const match = eventosCache[from]?.lista.find(e => normalize(e.nombre) === text);
    if (match) {
      const d = await getDetallePorFuente(match.fuente, match.referencia_id);
      let out = `📚 *${d.nombre}*\n\n`;
      if (d.descripcion)       out += `📜 ${d.descripcion}\n\n`;
      if (d.tipo_de_lugar)     out += `🏷️ Tipo: ${d.tipo_de_lugar}\n`;
      if (d.redes_sociales)    out += `🔗 Redes: ${d.redes_sociales}\n`;
      if (d.pagina_web)        out += `🌐 Web: ${d.pagina_web}\n`;
      if (d.zona)              out += `📌 Zona: ${d.zona}\n`;
      if (d.ingreso_permitido) out += `🚪 Ingreso: ${d.ingreso_permitido}\n`;
      if (d.precio)            out += `💰 Precio: ${d.precio}\n`;
      if (d.enlace)            out += `🔗 Más info: ${d.enlace}\n`;
      await reply(out);
      resetUser(from);
      return res.sendStatus(200);
    }
  }

  // Nueva búsqueda semántica
  const { data } = await axios.post(
    `${FASTAPI_URL}/buscar-coincidencia`,
    { texto: text, fuente: 'whatsapp', nombre: 'CaliAndo' }
  );
  if (!data.ok || !data.resultados.length) {
    await reply('😔 No encontré nada. Prueba con otra frase.');
    startInactivity(from, reply);
    return res.sendStatus(200);
  }

  // Guardar y mostrar primeros 5 en forma natural
  eventosCache[from] = { lista: data.resultados, pagina: 0 };
  sessionData[from]   = { context: 'resultados', greeted: sessionData[from].greeted };

  const opciones = data.resultados.slice(0, 5).map(it => it.nombre);
  const listaNatural = opciones.join(', ').replace(/, ([^,]*)$/, ' y $1');
  await reply(
    `🔎 Te recomiendo estos planes: ${listaNatural}.\n\n` +
    `¿Cuál te interesa más? Escríbeme el nombre o "ver mas" para descubrir más.`
  );
  startInactivity(from, reply);
  return res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CaliAndo Bot escuchando en 0.0.0.0:${PORT}`);
  console.log(`🔗 FASTAPI_URL → ${FASTAPI_URL}`);
});
