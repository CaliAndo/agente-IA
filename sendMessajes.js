require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;

const app = express();

// Middleware para leer x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Webhook de recepción de mensajes
app.post('/webhook', (req, res) => {
  const mensaje = req.body.Body;
  const numero = req.body.From;

  console.log('🌐 Body recibido:', req.body);
  console.log(`📩 Mensaje de ${numero || 'desconocido'}: "${mensaje || 'sin contenido'}"`);

  const twiml = new MessagingResponse();

  if (mensaje && mensaje.toLowerCase().includes('hola')) {
    twiml.message('👋 ¡Hola! ¿Buscas un plan cultural para hoy en Cali?');
  } else {
    twiml.message('🎭 Aún estamos entrenando, pero pronto te recomendaré eventos increíbles.');
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot escuchando en http://localhost:${PORT}`);
});
