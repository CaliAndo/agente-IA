require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { getDetallePorFuente }  = require('./services/db/getDetalle');
const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');

const app = express();
app.use(express.json());

// Health-check para Railway
app.get('/', (req, res) => res.status(200).send('🟢 CaliAndo Bot OK'));

const PORT           = process.env.PORT || 3000;
const VERIFY_TOKEN   = process.env.WHATSAPP_VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID       = process.env.WHATSAPP_PHONE_NUMBER_ID;
const FASTAPI_URL    = process.env.FASTAPI_URL;
if (!FASTAPI_URL) throw new Error("🚨 FASTAPI_URL no está definida");

// Estado por usuario
const sessionData       = {};
const eventosCache      = {};
const inactividadTimers = {};

function sendMessage(to, text) {
  return axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    { messaging_product: 'whatsapp', to, text: { body: text } },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
}

function normalize(text) {
  return text.normalize('NFD')
             .replace(/[\u0300-\u036f]/g, '')
             .trim()
             .toLowerCase();
}

function clearInactivity(num) {
  const t = inactividadTimers[num];
  if (t) {
    clearTimeout(t.warning);
    clearTimeout(t.close);
    delete inactividadTimers[num];
  }
}

function resetUser(num) {
  sessionData[num] = { context: 'inicio' };
  delete eventosCache[num];
  clearInactivity(num);
}

function startInactivity(num, reply, type = 'full') {
  clearInactivity(num);
  inactividadTimers[num] = {
    warning: type==='full' && setTimeout(() => reply('🔔 Sigo aquí si necesitas algo…'), 60_000),
    close:   setTimeout(() => {
               reply('🕒 No respondiste; vuelvo luego 👋');
               resetUser(num);
             }, type==='full'?120_000:60_000)
  };
}

app.post('/webhook', async (req, res) => {
  const msgObj = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msgObj || msgObj.type !== 'text') return res.sendStatus(200);

  const from    = msgObj.from;
  const textRaw = msgObj.text.body;
  const text    = normalize(textRaw);

  const reply = async txt => await sendMessage(from, txt);
  clearInactivity(from);

  try {
    // — SALUDO INICIAL SIN MENÚ —
    if (['hola','buenas','hey','holi'].includes(text)) {
      resetUser(from);
      await reply(
`👋 ¡Hola! Soy *CaliAndo* y estoy aquí para ayudarte a descubrir lo mejor de Cali.
Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos?
Además, recuerda que tengo un *diccionario caleño*: solo escribe "diccionario" + tu palabra.
🇨🇴💃`
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // — DICCIONARIO —
    if (text.includes('diccionario')) {
      sessionData[from] = { context: 'diccionario' };
      await reply('📚 Escribe la palabra caleña que quieras consultar.');
      startInactivity(from, reply);
      return res.sendStatus(200);
    }
    if (sessionData[from]?.context === 'diccionario') {
      const meaning = await getMeaningFromSerpAPI(text);
      await reply(
        meaning
          ? `📚 *${text}*: ${meaning}`
          : `😔 No encontré el significado de *${text}*.`
      );
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // — BÚSQUEDA SEMÁNTICA —
    const ctx = sessionData[from]?.context;
    if (!eventosCache[from] && (!ctx || ctx==='inicio' || ctx==='resultados')) {
      const { data } = await axios.post(`${FASTAPI_URL}/buscar-coincidencia`, {
        texto: text,
        fuente: 'whatsapp',
        nombre: 'CaliAndo'
      });
      if (!data.ok || !data.resultados.length) {
        await reply('😔 No encontré nada. Prueba con otra frase.');
        startInactivity(from, reply, 'closeOnly');
        return res.sendStatus(200);
      }
      eventosCache[from] = { lista: data.resultados, pagina: 0 };
      sessionData[from]   = { context: 'resultados' };

      const list = data.resultados.slice(0,5)
        .map((it,i) => `${i+1}. ${it.nombre}`)
        .join('\n\n');
      await reply(`🔎 Encontré:\n\n${list}\n\nEscribe el número para ver detalles.`);
      startInactivity(from, reply);
      return res.sendStatus(200);
    }

    // — DETALLE SELECCIÓN —
    if (!isNaN(text) && eventosCache[from]) {
      const idx  = parseInt(text,10)-1;
      const item = eventosCache[from].lista[idx];
      if (!item) {
        await reply('❌ Número inválido. Elige uno de la lista.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }
      const d = await getDetallePorFuente(item.fuente, item.referencia_id);
      if (!d) {
        await reply('❌ No encontré detalles.');
        startInactivity(from, reply);
        return res.sendStatus(200);
      }

      // Construye respuesta con todos los campos:
      let resMsg = `📚 *${d.nombre}*\n\n`;
      if (d.descripcion)       resMsg += `📜 ${d.descripcion}\n\n`;
      if (d.ubicacion)         resMsg += `📍 Ubicación: ${d.ubicacion}\n`;
      if (d.tipo_de_lugar)     resMsg += `🏷️ Tipo: ${d.tipo_de_lugar}\n`;
      if (d.redes_sociales)    resMsg += `🔗 Redes: ${d.redes_sociales}\n`;
      if (d.pagina_web)        resMsg += `🌐 Web: ${d.pagina_web}\n`;
      if (d.zona)              resMsg += `📌 Zona: ${d.zona}\n`;
      if (d.ingreso_permitido) resMsg += `🚪 Ingreso: ${d.ingreso_permitido}\n`;
      if (d.precio)            resMsg += `💰 Precio: ${d.precio}\n`;
      if (d.enlace)            resMsg += `🔗 Más info: ${d.enlace}\n`;

      await reply(resMsg);
      resetUser(from);
      return res.sendStatus(200);
    }

    // — SI YA HAY BÚSQUEDA ACTIVA —
    await reply('📌 Ya tienes búsqueda activa. Escribe un número o espera 2 minutos.');
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
