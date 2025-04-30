const stringSimilarity = require('string-similarity');

// Definimos las intenciones con palabras clave
const categorias = {
  rumba: ["bailar", "rumba", "fiesta", "concierto", "discoteca", "salir"],
  eventos: ["evento", "eventos", "show", "feria", "festival"],
  tours: ["tour", "paseo", "aventura", "excursión", "explorar","tours"],
  cultura: ["museo", "cultura", "historia", "arte", "teatro", "exposición"],
  recomendaciones: ["recomiéndame", "sugerencias", "qué hacer", "actividades"],
};

function detectarIntencionAvanzada(mensaje) {
  const palabrasMensaje = mensaje.toLowerCase().split(/\s+/);

  const puntajes = {
    rumba: 0,
    eventos: 0,
    tours: 0,
    cultura: 0,
    recomendaciones: 0,
  };

  palabrasMensaje.forEach(palabra => {
    for (const [categoria, palabrasClave] of Object.entries(categorias)) {
      const coincidencia = stringSimilarity.findBestMatch(palabra, palabrasClave);
      if (coincidencia.bestMatch.rating > 0.6) {
        puntajes[categoria] += coincidencia.bestMatch.rating;
      }
    }
  });

  const mejorCategoria = Object.entries(puntajes).sort((a, b) => b[1] - a[1])[0];

  if (mejorCategoria && mejorCategoria[1] > 0) {
    console.log(`🎯 Intención detectada: ${mejorCategoria[0]}`);
    return mejorCategoria[0];
  }

  console.log('🤔 No se detectó una intención clara.');
  return null;
}

module.exports = {
  detectarIntencionAvanzada,
};
