// Assistant en direct du site : reçoit la conversation de la page, interroge Claude, renvoie la réponse.
// La clé ANTHROPIC_API_KEY est lue dans les variables d'environnement de Netlify, jamais dans le code.
// Version simple, à enrichir : connaissances, ton et garde-fous sont dans knowledge.mjs.

import { SYSTEM_PROMPT } from "./knowledge.mjs";

export const config = { path: "/api/chat" };

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const MAX_MESSAGES = 10;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 4000;
const TIMEOUT_MS = 9000; // les fonctions Netlify s'arrêtent à 10 s par défaut

const UNAVAILABLE =
  "L’assistant n’est pas disponible pour le moment. Écrivez-nous à [matthys@allia-link.fr](mailto:matthys@allia-link.fr).";

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// Ne garde que des messages propres, qui alternent et commencent par une question.
function cleanMessages(input) {
  if (!Array.isArray(input)) return null;
  const messages = input
    .slice(-MAX_MESSAGES)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, m.role === "user" ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS),
    }))
    .filter((m) => m.content);
  while (messages.length && messages[0].role !== "user") messages.shift();
  for (let i = 1; i < messages.length; i++) if (messages[i].role === messages[i - 1].role) return null;
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;
  return messages;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Méthode non autorisée." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY manquante dans les variables Netlify");
    return json(503, { error: UNAVAILABLE });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Requête illisible." });
  }
  const messages = cleanMessages(body?.messages);
  if (!messages) return json(400, { error: "Je n’ai pas compris la question, pouvez-vous la reformuler ?" });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM_PROMPT, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("Erreur API Anthropic", res.status, (await res.text()).slice(0, 500));
      return json(502, { error: UNAVAILABLE });
    }
    const data = await res.json();
    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!reply) return json(502, { error: UNAVAILABLE });
    return json(200, { reply });
  } catch (e) {
    console.error("Appel à l’API impossible", e?.name, e?.message);
    return json(504, { error: UNAVAILABLE });
  }
};
