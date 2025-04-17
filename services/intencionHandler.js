// 📁 services/intencionHandler.js

const fs = require('fs');

// Cargar datos desde JSON local
const eventosLocales = JSON.parse(fs.readFileSync('./data/caliEventos.json', 'utf8'));
const tours = JSON.parse(fs.readFileSync('./data/civitatis_tours.json', 'utf8'));
const actividades = JSON.parse(fs.readFileSync('./data/tripadvisor_actividades.json', 'utf8'));
const secondaryactivities = JSON.parse(fs.readFileSync('./data/tripadvisor_cali.json', 'utf8'));
const thirdactivities = JSON.parse(fs.readFileSync('./data/tripadvisor_carousel.json', 'utf8'));

// Palabras clave por categoría
const categorias = {
  eventos: ['evento', 'salir', 'plan', 'rumba', 'fiesta', 'feria', 'musical', 'bailar', 'concierto', 'show'],
  cultura: ['cultura', 'arte', 'museo', 'historia', 'exposición', 'teatro'],
  comida: ['comida', 'hambre', 'cenar', 'almorzar', 'restaurante', 'antojado', 'sabroso', 'gastronomía'],
  tours: ['tour', 'visita', 'excursión', 'aventura', 'caminar', 'recorrido', 'explorar'],
};

function detectarIntencion(mensaje) {
  const lowerMsg = mensaje.toLowerCase();
  for (const [categoria, palabras] of Object.entries(categorias)) {
    if (palabras.some(p => lowerMsg.includes(p))) {
      return categoria;
    }
  }
  return null;
}

function buscarRecomendaciones(categoria) {
  if (categoria === 'eventos') {
    return eventosLocales.imperdibles.map(e => `📌 ${e.title}\n🔗 ${e.link}`);
  }
  if (categoria === 'cultura') {
    return eventosLocales.museos.map(e => `🏛️ ${e.title}\n🔗 ${e.link}`);
  }
  if (categoria === 'tours') {
    return [
      ...tours.map(t => `🚐 ${t.titulo}\n🔗 ${t.link}`),
      ...actividades.map(a => `🌄 ${a.title}\n🔗 ${a.link}`),
      ...secondaryactivities.map(a => `🎯 ${a.title}\n🔗 ${a.link}`),
      ...thirdactivities.map(a => `✨ ${a.title}\n🔗 ${a.link}`),
    ];
  }
  if (categoria === 'comida') {
    return [
      '🍽️ Puedes explorar la zona gastronómica de Granada, San Antonio o Ciudad Jardín. ¡Cali sabe a gloria!',
      '😋 ¿Te antoja algo típico? Prueba el champús, las marranitas o un buen sancocho en Pance.'
    ];
  }
  return [];
}

module.exports = {
  detectarIntencion,
  buscarRecomendaciones,
};
