# Bot de WhatsApp para Recomendaciones Culturales

Este es un **bot de WhatsApp** desarrollado usando **Twilio** y **Node.js** para recomendar planes y eventos culturales en la ciudad de Cali. El bot interactúa con los usuarios y responde con recomendaciones personalizadas basadas en sus intereses y preferencias.

## 📦 Requisitos

Antes de ejecutar el bot, asegúrate de tener lo siguiente:

- **Node.js** instalado (preferiblemente la versión LTS).
- **Twilio Account SID** y **Auth Token**.
- **ngrok** (para generar una URL pública para el webhook).
- **PostgreSQL** o **Supabase** (si deseas guardar las preferencias del usuario en una base de datos).

---

## 🛠️ Instalación

1. **Clona este repositorio**:

   ```bash
   git clone https://github.com/Jramirezzz/agente-IA.git
   cd nombre-del-repositorio
   ```

   1. **Instala las dependencias**:

   ```bash
   npm install
   ```
   
   
3. **Configura las variables de entorno**:
    ```bash
   PORT=3000
    TWILIO_ACCOUNT_SID=tu_account_sid
    TWILIO_AUTH_TOKEN=tu_auth_token
    VERIFY_TOKEN=tu_token_de_verificacion
   ```
4. **Configura ngrok**:
    ```bash
   npx ngrok http 3000
   ```

    
   

   

   

   
