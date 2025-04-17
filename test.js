require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');

const SERPAPI_KEY = process.env.SERPAPI_KEY; // Asegúrate de tener tu clave en el archivo .env
const query = 'actividades en Cali site:tripadvisor.com';

const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&hl=es&gl=co&api_key=${SERPAPI_KEY}`;

fetch(url)
  .then(res => res.json())
  .then(data => {
    const results = data.organic_results || [];
    const actividades = results.map((r, i) => ({
      titulo: r.title,
      descripcion: r.snippet || '',
      link: r.link
    }));

    console.log('📌 Actividades encontradas:');
    actividades.forEach((actividad, i) => {
      console.log(`${i + 1}. ${actividad.titulo}`);
      console.log(`🔗 ${actividad.link}`);
      if (actividad.descripcion) console.log(`📝 ${actividad.descripcion}`);
      console.log();
    });

    fs.writeFileSync('./data/tripadvisor_actividades.json', JSON.stringify(actividades, null, 2));
    console.log('✅ Guardado en ./data/tripadvisor_actividades.json');
  })
  .catch(err => {
    console.error('❌ Error al hacer scraping:', err.message);
  });
