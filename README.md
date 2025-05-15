# 😉 CaliAndo Bot

Este es un **bot de WhatsApp** desarrollado usando **gemini** y **Node.js** para recomendar planes y eventos culturales en la ciudad de Cali. 
El bot interactúa de manera conversacional con los usuarios y responde con recomendaciones personalizadas basadas en sus intereses.

---

## 📦 Requisitos

Antes de ejecutar este bot, asegúrate de tener:

- Node.js (versión LTS recomendada).
- Base de datos Supabase.
- Clave de SerpAPI (para el Diccionario Caleño).
---

## ✨ Instalación

### 1. 🔄 Clona este repositorio

```bash
git clone https://github.com/Jramirezzz/agente-IA.git
cd agente-IA
```

### 2. ⚡ Instala las dependencias

```bash
npm install
```

### 3. ⚖️ Configura las variables de entorno (`.env`)

Crea un archivo llamado `.env` en la raíz del proyecto con el siguiente contenido:

```dotenv
PORT=3000

TWILIO_ACCOUNT_SID=tu_account_sid
TWILIO_AUTH_TOKEN=tu_auth_token
TWILIO_PHONE_NUMBER=whatsapp: tu_numero

SERPAPI_KEY=tu_serpapi_key
SCRAPERAPI_KEY=tu_scraperapi_key

OPENAI_API_KEY=tu_openai_key (opcional si deseas IA)
HUGGINGFACE_API_TOKEN=tu_huggingface_key (opcional si deseas IA)

DB_HOST=localhost
DB_PORT= tu_puerto
DB_DATABASE= tu_database
DB_USER=tu_usuario_pg
DB_PASSWORD=tu_contraseña_pg
```

### 4. 🔗 Ejecuta ngrok

```bash
npx ngrok http 3000
```

Copia la URL generada (ejemplo: `https://xxxxx.ngrok.io`) y configúrala en el **Webhook de Twilio**.

---

## 🔄 Flujo de Conversación

- Cuando el usuario escribe:
  - **"cultura"**, **"eventos"**, **"tours"**: el bot recomienda planes culturales según la base de datos.
  - **"diccionario"**: busca el significado de palabras caleñas usando SerpAPI.
  - **"ver más"**: muestra más opciones si hay.
  - **"volver"**: regresa al menú principal.

---

## 📝 Tecnologías utilizadas

- **Node.js**
- **Express**
- **WhatsApp API**
- **supabase**
- **SerpAPI**
- **gemini o HuggingFace** para mejor interpretación de mensajes

---

## 🚀 Próximos pasos

- Implementar inteligencia artificial para entender mensajes de forma aún más precisa.
- Mejorar el flujo de conversación agregando botones (Quick Replies).
- Implementar cacheo de resultados para mejorar la velocidad.

---

## 🎉 Hecho por Jramirezzz

❤️ #CaliEsSabor #CaliAndoBot

---

¡Listo para disfrutar de los mejores planes de Cali! 🚶‍♂️🍻🎨
