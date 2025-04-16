const fs = require('fs');
const path = require('path');

const CATEGORIAS_PATH = path.join(__dirname, '../data/categorias.json');
const categorias = fs.existsSync(CATEGORIAS_PATH)
  ? JSON.parse(fs.readFileSync(CATEGORIAS_PATH, 'utf-8'))
  : {};

function detectarCategoria(mensaje) {
  const lowerMsg = mensaje.toLowerCase();

  for (const [categoria, palabras] of Object.entries(categorias)) {
    for (const palabra of palabras) {
      if (lowerMsg.includes(palabra)) {
        console.log(`🔍 Se detectó categoría "${categoria}" por coincidencia con: "${palabra}"`);
        return categoria;
      }
    }
  }

  return null;
}

module.exports = { detectarCategoria };
