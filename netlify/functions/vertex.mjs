// Netlify serverless function that proxies Google Gemini (Vertex) calls.
// The API key stays server-side (Netlify env var VERTEX_API_KEY) and is never
// shipped to the browser. Mirrors the Electron main-process handlers in main.cjs.

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body) {
  return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify(body) };
}
function bad(status, message) {
  return { statusCode: status, headers: JSON_HEADERS, body: JSON.stringify({ error: message }) };
}

async function embed(text, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      outputDimensionality: 768,
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini Embedding API returned ${response.status}: ${await response.text()}`);
  }
  const result = await response.json();
  const vector = result.embedding?.values;
  if (!vector) throw new Error("Invalid response structure from Gemini Embedding API");
  return vector;
}

async function chat(messages, { responseMimeType, maxOutputTokens } = {}, apiKey) {
  const contents = [];
  let systemInstruction = null;
  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxOutputTokens || 8192,
        ...(responseMimeType ? { responseMimeType } : {}),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini API returned ${response.status}: ${await response.text()}`);
  }
  const result = await response.json();
  const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!responseText) throw new Error("Invalid response structure from Gemini AI");
  return responseText;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return bad(405, "Method not allowed");
  }

  const apiKey = process.env.VERTEX_API_KEY;
  if (!apiKey) {
    return bad(503, "VERTEX_API_KEY not configured on the server");
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return bad(400, "Invalid JSON body");
  }

  const { action } = payload;
  try {
    if (action === "embed") {
      return ok({ result: await embed(payload.text ?? "", apiKey) });
    }
    if (action === "chat") {
      return ok({
        result: await chat(payload.messages ?? [], payload.options ?? {}, apiKey),
      });
    }
    return bad(400, `Unknown action: ${action}`);
  } catch (err) {
    console.error("[vertex function] error:", err);
    return bad(502, err.message || "Upstream error");
  }
}
