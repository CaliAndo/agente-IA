// test-gemini.js  (CommonJS puro)
const apiKey = "AIzaSyBB8-XXLbQs91ZBU0-XfMzdw2HKkxbtGJE";

if (!apiKey) {
  console.error("❌ Falta GEMINI_API_KEY en tus variables de entorno.");
  process.exit(1);
}

async function askGemini(prompt) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.0-flash:generateContent?key=" + apiKey;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 120, temperature: 0.7 }
  };

  const res = await fetch(url, {                       // 👈 fetch global
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
}

(async () => {
  try {
    const reply = await askGemini("Dame dos planes al aire libre en Cali, Colombia.");
    console.log("✅ Respuesta de Gemini:\n", reply);
  } catch (err) {
    console.error("❌ Ocurrió un problema:", err.message);
  }
})();
