require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const fs = require('fs');

const { getMeaningFromSerpAPI } = require('./services/serpAPI/meanings');
const { getEventosSerpAPI } = require('./services/serpAPI/events');
const { detectarIntencion, buscarRecomendaciones } = require('./services/intencionHandler');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const sessionData = {};
const eventosCache = {}; //

app.post('/webhook', async (req, res) => {
  const mensaje = req.body.Body?.toLowerCase() || '';
  const numero = req.body.From || '';
  const twiml = new twilio.twiml.MessagingResponse();

  console.log('📨 Mensaje recibido:', mensaje);

  try {
    if (mensaje.includes('diccionario')) {
      sessionData[numero] = { context: 'diccionario' };
      twiml.message(`📚 Bienvenido al *diccionario caleño*. Escríbeme una palabra que quieras conocer.\nPor ejemplo: *borondo*, *ñapa*, *enguayabado*...`);

    } else if (sessionData[numero]?.context === 'diccionario') {
      const significado = await getMeaningFromSerpAPI(mensaje);
      if (significado) {
        twiml.message(`📖 ${significado}\n\n¿Quieres buscar otra palabra o volver al menú?`);
      } else {
        twiml.message('🤔 No encontré esa palabra. Prueba con otra como *borondo* o *enguayabado*.');
      }

    } else if (mensaje.includes('qué es') || mensaje.includes('qué significa') || mensaje.includes('significa')) {
      const significado = await getMeaningFromSerpAPI(mensaje);
      if (significado) {
        twiml.message(`📖 ${significado}`);
      } else {
        twiml.message('🤔 No encontré una definición clara. Prueba con otra palabra.');
      }

    } else if (mensaje.includes('ver mas') || mensaje.includes('ver más')) {
      const cache = eventosCache[numero];
      if (!cache) {
        twiml.message('ℹ️ Primero dime qué te gustaría hacer (por ejemplo: “quiero un tour”, “deseo comer algo típico”).');
      } else {
        const inicio = (cache.pagina + 1) * 5;
        const nuevos = cache.lista.slice(inicio, inicio + 5);
        if (nuevos.length > 0) {
          cache.pagina++;
          twiml.message(`📍 Más recomendaciones para ti:\n\n${nuevos.join('\n\n')}\n\n👉 Escribe *ver más* para continuar o *volver* para regresar.`);
        } else {
          twiml.message('📭 Ya viste todas las recomendaciones disponibles. ¡Pronto habrá más!');
        }
      }

    } else if (mensaje.includes('volver')) {
      sessionData[numero] = undefined;
      twiml.message(`👋 Bienvenido de vuelta a *CaliAndo*. ¿Qué quieres hacer hoy?\n\n- *comer* 🍽️\n- *cultura* 🎭\n- *eventos* 🎫\n- *diccionario* 📖`);

    } else {
      sessionData[numero] = undefined;

      const intencion = detectarIntencion(mensaje);
      if (intencion) {
        const recomendaciones = buscarRecomendaciones(intencion).slice(0, 5);
        if (recomendaciones.length > 0) {
          eventosCache[numero] = { lista: buscarRecomendaciones(intencion), pagina: 0 };
          twiml.message(`🔎 Aquí tienes algunas recomendaciones según lo que mencionaste:\n\n${recomendaciones.join('\n\n')}\n\n👉 Escribe *ver más* para seguir viendo o *volver* para regresar.`);
        } else {
          twiml.message('🤔 ¡Te entendí, pero aún no tengo contenido para eso! Puedes intentar con otra palabra como *tour*, *evento* o *comida*.');
        }
      } else {
        twiml.message(`👋 ¡Hola! Soy CaliAndo y estoy aquí para ayudarte a descubrir lo mejor de Cali. Cuéntame qué te gustaría hacer hoy: ¿te antoja algo cultural, quieres parchar con amigos o recorrer lugares nuevos? Estoy listo para mostrarte lo que esta ciudad sabrosa tiene para ti 💃`);
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
