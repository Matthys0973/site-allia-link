// Assistant en direct du site : reçoit la conversation de la page, interroge Claude, renvoie la réponse.
// La clé ANTHROPIC_API_KEY est lue dans les variables d'environnement de Netlify, jamais dans le code.
// Consignes et connaissances : knowledge.mjs.
//
// Stockage (Netlify Blobs, store "assistant") :
// - limits/<jour>/<empreinte> : nombre de questions du jour pour un visiteur. L'empreinte est un hachage
//   de son adresse IP qui change chaque jour : l'adresse elle-même n'est jamais enregistrée.
// - logs/<jour>/<heure>-<id> : question, réponse et identifiant de conversation tiré au hasard par la page.
//   Rien ne permet de relier une conversation à une personne, sauf ce qu'elle aurait écrit elle-même.

import { createHash, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { SYSTEM_PROMPT } from "./knowledge.mjs";

export const config = { path: "/api/chat" };

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const MAX_MESSAGES = 12;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 4000;
const MAX_TOKENS = 700;
// Arrêt net après le résumé, et si le modèle se met à écrire la réplique du visiteur à sa place
const STOPS = ["[[/RESUME]]", "\nVisiteur :", "\nVisiteur:", "\nUtilisateur :"];
const TIMEOUT_MS = 9000; // les fonctions Netlify s'arrêtent à 10 s par défaut
const PER_VISITOR_PER_DAY = Number(process.env.CHAT_LIMIT_VISITOR || 25);
const PER_DAY_TOTAL = Number(process.env.CHAT_LIMIT_TOTAL || 600);

const UNAVAILABLE =
  "L’assistant n’est pas disponible pour le moment. Écrivez-nous à [matthys@allia-link.fr](mailto:matthys@allia-link.fr).";
const LIMIT_REACHED =
  "Vous avez atteint la limite de questions pour aujourd’hui. Pour aller plus loin, [réservez un diagnostic gratuit](#diagnostic) ou écrivez à [matthys@allia-link.fr](mailto:matthys@allia-link.fr).";

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

// Si la réponse a été coupée faute de place, on la ramène à la dernière phrase complète.
function trimToSentence(text) {
  const cut = Math.max(text.lastIndexOf(". "), text.lastIndexOf(".\n"), text.lastIndexOf("?"), text.lastIndexOf("!"));
  return cut > 40 ? text.slice(0, cut + 1).trim() : text.trim();
}

function openStore() {
  try {
    return getStore("assistant");
  } catch (e) {
    console.error("Stockage indisponible", e?.message);
    return null;
  }
}

// Compte une question. Renvoie false si une limite est atteinte. En cas de panne du stockage, on laisse passer.
async function allowQuestion(store, ip, day) {
  if (!store) return true;
  try {
    const salt = process.env.CHAT_SALT || "allia-link";
    const who = createHash("sha256").update(`${salt}|${day}|${ip || "inconnu"}`).digest("hex").slice(0, 24);
    const keyVisitor = `limits/${day}/${who}`;
    const keyTotal = `limits/${day}/_total`;
    const [visitor, total] = await Promise.all([store.get(keyVisitor, { type: "json" }), store.get(keyTotal, { type: "json" })]);
    const v = (visitor?.n || 0) + 1;
    const t = (total?.n || 0) + 1;
    if (v > PER_VISITOR_PER_DAY || t > PER_DAY_TOTAL) return false;
    await Promise.all([store.setJSON(keyVisitor, { n: v }), store.setJSON(keyTotal, { n: t })]);
    return true;
  } catch (e) {
    console.error("Compteur indisponible", e?.message);
    return true;
  }
}

async function logExchange(store, day, entry) {
  if (!store) return;
  try {
    const time = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    await store.setJSON(`logs/${day}/${time}-${randomUUID().slice(0, 8)}`, entry);
  } catch (e) {
    console.error("Journal indisponible", e?.message);
  }
}

export default async (req, context) => {
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
  const conversation = typeof body?.conversation === "string" ? body.conversation.replace(/[^a-z0-9-]/gi, "").slice(0, 36) : "";

  const day = new Date().toISOString().slice(0, 10);
  const store = openStore();
  if (!(await allowQuestion(store, context?.ip, day))) return json(429, { error: LIMIT_REACHED });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages, stop_sequences: STOPS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      console.error("Erreur API Anthropic", res.status, detail);
      const type = (detail.match(/"type"\s*:\s*"([a-z_]+_error)"/) || [])[1] || "";
      return json(502, { error: UNAVAILABLE, code: `api_${res.status}${type ? "_" + type : ""}` });
    }
    const data = await res.json();
    let reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (data.stop_reason === "stop_sequence" && data.stop_sequence === "[[/RESUME]]") reply += "\n[[/RESUME]]";
    if (data.stop_reason === "max_tokens") {
      console.error("Réponse coupée faute de place", reply.length, "caractères");
      const end = reply.indexOf("[[/RESUME]]");
      if (end >= 0) reply = reply.slice(0, end + "[[/RESUME]]".length);
      else {
        // Résumé inachevé : on garde le texte avant lui, et le résumé s'il a au moins deux lignes complètes
        const start = reply.indexOf("[[RESUME]]");
        const before = trimToSentence(start >= 0 ? reply.slice(0, start) : reply);
        const lines = start >= 0 ? reply.slice(start + 10).split("\n").slice(0, -1).filter((l) => l.includes(":")) : [];
        reply = lines.length >= 2 ? `${before}\n\n[[RESUME]]\n${lines.join("\n")}\n[[/RESUME]]`.trim() : before;
      }
    }
    if (!reply) {
      console.error("Réponse vide", data.stop_reason, JSON.stringify(data.content || []).slice(0, 300));
      return json(502, { error: UNAVAILABLE, code: `vide_${data.stop_reason}` });
    }

    await logExchange(store, day, {
      at: new Date().toISOString(),
      conversation,
      turn: messages.filter((m) => m.role === "user").length,
      question: messages[messages.length - 1].content,
      reply,
    });
    return json(200, { reply });
  } catch (e) {
    console.error("Appel à l’API impossible", e?.name, e?.message);
    return json(504, { error: UNAVAILABLE, code: e?.name === "TimeoutError" ? "delai" : "reseau" });
  }
};
