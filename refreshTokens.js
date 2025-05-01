// refreshToken.js
require('dotenv').config();
const fs = require('fs');
const axios = require('axios');
const path = require('path');

const {
  WHATSAPP_TOKEN,
  APP_ID,
  APP_SECRET,
  ENV_PATH = '.env',
} = process.env;

async function refreshToken() {
  try {
    const url = `https://graph.facebook.com/v22.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${APP_ID}` +
      `&client_secret=${APP_SECRET}` +
      `&fb_exchange_token=${WHATSAPP_TOKEN}`;

    const res = await axios.get(url);
    const newToken = res.data.access_token;

    // Leer y actualizar .env
    let envContent = fs.existsSync(ENV_PATH)
      ? fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)
      : [];

    let tokenUpdated = false;
    envContent = envContent.map(line => {
      if (line.startsWith('WHATSAPP_TOKEN=')) {
        tokenUpdated = true;
        return `WHATSAPP_TOKEN=${newToken}`;
      }
      return line;
    });

    if (!tokenUpdated) {
      envContent.push(`WHATSAPP_TOKEN=${newToken}`);
    }

    fs.writeFileSync(ENV_PATH, envContent.join('\n'), 'utf-8');
    console.log('✅ Token actualizado exitosamente');
  } catch (err) {
    console.error('❌ Error actualizando token:', err.response?.data || err.message);
  }
}

refreshToken();
