require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const { detectarIntencionAvanzada } = require('./services/intencionHandler');
const { getAllEventos } = require('./services/db/getEventos');
const { getAllTours } = require('./services/db/getTours');
const { getAllCultura } = require('./services/db/getCultura');
const { getAllRecomendaciones } = require('./services/db/getRecomendaciones');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {};
const eventosCache = {};

function enviarMensajeBienvenida(twiml) {
  twiml.message(`👋 ¡Hola! Soy *CaliAndo* 🤖.\n\nPuedes decirme qué quieres hacer:\n- Buscar *eventos* 🎫\n- Explorar *cultura* 🎭\n- Descubrir *tours* 🚐\n- O escribir *diccionario* 📖 para palabras típicas.\n\n¡Te escucho! 🔥`);
}

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  try {
    if (!isNaN(mensaje) && eventosCache[numero]) {
      const indice = parseInt(mensaje) - 1;
      const lista = eventosCache[numero].lista;

      if (lista[indice]) {
        const item = lista[indice];
        let respuesta = `📚 *${item.nombre}*\n\n`;

          if (item.descripcion) {
            // Detectamos si la descripcion parece ser un link (empieza con http o https)
            if (item.descripcion.startsWith('http')) {
              respuesta += `🌐 [Más información aquí](${item.descripcion})\n\n`;
            } else {
              respuesta += `📝 ${item.descripcion}\n\n`;
            }
          }

          if (item.extra) {
            respuesta += `📌 Info adicional: ${item.extra}\n\n`;
          }
          if (item.precio) {
            respuesta += `💲 Precio estimado: ${item.precio}\n\n`;
          }
          if (item.fuente) {
            respuesta += `🌐 Fuente: ${item.fuente}\n\n`;
          }
          if (item.fecha) {
            respuesta += `📅 Fecha: ${item.fecha}\n\n`;
          }

          respuesta += `👉 Escribe *ver más* para seguir viendo o *volver* para regresar.`;


        twiml.message(respuesta);
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        return;
      } else {
        twiml.message('❌ No encontré esa opción. Intenta con un número válido de la lista.');
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(twiml.toString());
        return;
      }
    }

    if (mensaje.includes('ver mas') || mensaje.includes('ver más')) {
      const cache = eventosCache[numero];
      if (!cache) {
        twiml.message('ℹ️ Primero dime qué te gustaría hacer (por ejemplo: “quiero ir de rumba”, “quiero hacer un tour” o “diccionario”).');
      } else {
        const inicio = (cache.pagina + 1) * 5;
        const nuevos = cache.lista.slice(inicio, inicio + 5);
        if (nuevos.length > 0) {
          cache.pagina++;
          const respuesta = nuevos.map((r, idx) => `${inicio + idx + 1}. ${r.nombre}`).join('\n\n');
          twiml.message(`📍 Más recomendaciones para ti:\n\n${respuesta}\n\n👉 Escribe *ver más* para seguir viendo o *volver* para regresar.`);
        } else {
          twiml.message('📭 Ya viste todas las recomendaciones disponibles. ¡Pronto habrá más!');
        }
      }
    } else if (mensaje.includes('volver')) {
      sessionData[numero] = undefined;
      enviarMensajeBienvenida(twiml);
    } else if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      twiml.message(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.\nPor ejemplo: *borondo*, *ñapa*, *enguayabado*...`);
    } else {
      if (!sessionData[numero]) {
        sessionData[numero] = { context: 'inicio' };
        enviarMensajeBienvenida(twiml);
      } else {
        const intencion = detectarIntencionAvanzada(mensaje);

        if (!intencion) {
          twiml.message('🤔 No entendí bien lo que quieres. ¿Me puedes decir si quieres ver eventos, cultura, tours o usar el diccionario?');
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(twiml.toString());
          return;
        }

        let resultados = [];

        if (intencion === 'rumba' ) {
          resultados = await getAllEventos();
        } else if (intencion === 'tours') {
          resultados = await getAllTours();
        } else if (intencion === 'cultura') {
          resultados = await getAllCultura();
        } else if (intencion === 'recomendaciones'|| intencion === 'eventos') {
          resultados = await getAllRecomendaciones();
        }

        if (resultados.length > 0) {
          eventosCache[numero] = { lista: resultados, pagina: 0 };
          const respuesta = resultados.slice(0, 5).map((r, idx) => `${idx + 1}. ${r.nombre}`).join('\n\n');
          twiml.message(`🔎 Encontré algunas opciones para ti:\n\n${respuesta}\n\n👉 Escribe *ver más* para seguir viendo o *volver* para regresar.`);
        } else {
          twiml.message('🤔 ¡No encontré resultados en este momento! Puedes intentar otra búsqueda o escribir *diccionario* 📖.');
        }
      }
    }
  } catch (error) {
    console.error('💥 Error inesperado en el webhook:', error);
    twiml.message('❌ Algo salió mal. Intenta de nuevo más tarde.');
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});
