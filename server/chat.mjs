// Assistant en direct du site (route /api/chat), appelé par worker/index.js.
// Reçoit la conversation de la page, interroge Claude, renvoie la réponse.
// Consignes et connaissances : server/knowledge.mjs.
//
// Réglages :
// - secret ANTHROPIC_API_KEY, à saisir dans Cloudflare (application > Settings > Variables and Secrets)
// - base D1 liée sous le nom DB, déclarée dans wrangler.jsonc (facultative : sans elle, pas de limite
//   ni d'historique, l'assistant répond quand même)
// - variables facultatives : ANTHROPIC_MODEL, CHAT_LIMIT_VISITOR, CHAT_LIMIT_TOTAL, CHAT_SALT
//
// Base D1 (tables créées automatiquement au premier appel) :
// - limits : nombre de questions par jour et par visiteur. Le visiteur est une empreinte de son adresse IP
//   qui change chaque jour : l'adresse elle-même n'est jamais enregistrée.
// - logs : question, réponse et identifiant de conversation tiré au hasard par la page.

import { SYSTEM_PROMPT } from "./knowledge.mjs";

const VERSION = "2026-10-22.2"; // renvoyée dans chaque réponse, pour vérifier quelle version est en ligne
const MAX_MESSAGES = 12;
const MAX_USER_CHARS = 500;
const MAX_ASSISTANT_CHARS = 4000;
const MAX_TOKENS = 700;
// Arrêt net après le résumé, et si le modèle se met à écrire la réplique du visiteur à sa place
const STOPS = ["[[/RESUME]]", "\nVisiteur :", "\nVisiteur:", "\nUtilisateur :"];
const TIMEOUT_MS = 20000;

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

// Réponse coupée faute de place : on garde un résumé complet, ou au moins deux lignes, plutôt que de tout perdre.
function repairTruncated(reply) {
  const end = reply.indexOf("[[/RESUME]]");
  if (end >= 0) return reply.slice(0, end + "[[/RESUME]]".length);
  const start = reply.indexOf("[[RESUME]]");
  const before = trimToSentence(start >= 0 ? reply.slice(0, start) : reply);
  const lines = start >= 0 ? reply.slice(start + 10).split("\n").slice(0, -1).filter((l) => l.includes(":")) : [];
  return lines.length >= 2 ? `${before}\n\n[[RESUME]]\n${lines.join("\n")}\n[[/RESUME]]`.trim() : before;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let tablesReady = false;
async function ensureTables(db) {
  if (tablesReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS limits (day TEXT NOT NULL, who TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, who))"),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, conversation TEXT, turn INTEGER, question TEXT, reply TEXT)"
    ),
  ]);
  tablesReady = true;
}

// Compte une question. Renvoie false si une limite est atteinte. En cas de panne de la base, on laisse passer.
async function allowQuestion(env, ip, day) {
  const db = env.DB;
  if (!db) return true;
  try {
    await ensureTables(db);
    const perVisitor = Number(env.CHAT_LIMIT_VISITOR || 25);
    const perDay = Number(env.CHAT_LIMIT_TOTAL || 600);
    const who = (await sha256(`${env.CHAT_SALT || "allia-link"}|${day}|${ip || "inconnu"}`)).slice(0, 24);
    const bump = db.prepare(
      "INSERT INTO limits (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n"
    );
    const [visitor, total] = await db.batch([bump.bind(day, who), bump.bind(day, "_total")]);
    const v = visitor.results?.[0]?.n ?? 0;
    const t = total.results?.[0]?.n ?? 0;
    return v <= perVisitor && t <= perDay;
  } catch (e) {
    console.error("Compteur indisponible", e?.message);
    return true;
  }
}

async function logExchange(env, entry) {
  if (!env.DB) return;
  try {
    await ensureTables(env.DB);
    await env.DB.prepare("INSERT INTO logs (at, conversation, turn, question, reply) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(entry.at, entry.conversation, entry.turn, entry.question, entry.reply)
      .run();
  } catch (e) {
    console.error("Journal indisponible", e?.message);
  }
}

export async function handleChat(request, env, ctx) {
  if (request.method !== "POST") return json(405, { error: "Méthode non autorisée." });
  const waitUntil = (p) => ctx.waitUntil(p);
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY manquante dans les variables Cloudflare");
    return json(503, { error: UNAVAILABLE, code: "cle_absente", v: VERSION });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Requête illisible." });
  }
  const messages = cleanMessages(body?.messages);
  if (!messages) return json(400, { error: "Je n’ai pas compris la question, pouvez-vous la reformuler ?" });
  const conversation = typeof body?.conversation === "string" ? body.conversation.replace(/[^a-z0-9-]/gi, "").slice(0, 36) : "";

  const day = new Date().toISOString().slice(0, 10);
  if (!(await allowQuestion(env, request.headers.get("CF-Connecting-IP"), day))) {
    return json(429, { error: LIMIT_REACHED, v: VERSION });
  }

  try {
    const res = await fetch(env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      // Réflexion désactivée : sur Haiku 5.5 elle est active par défaut et ses tokens consomment le plafond de la réponse
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages,
        stop_sequences: STOPS,
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      console.error("Erreur API Anthropic", res.status, detail);
      const type = (detail.match(/"type"\s*:\s*"([a-z_]+_error)"/) || [])[1] || "";
      return json(502, { error: UNAVAILABLE, code: `api_${res.status}${type ? "_" + type : ""}`, v: VERSION });
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
      reply = repairTruncated(reply);
    }
    if (!reply) {
      const types = [...new Set((data.content || []).map((b) => b.type))].join("+") || "rien";
      console.error("Réponse vide", data.stop_reason, types);
      return json(502, { error: UNAVAILABLE, code: `vide_${data.stop_reason}_${types}`, v: VERSION });
    }

    // L'historique s'écrit après l'envoi de la réponse, sans la retarder
    waitUntil(
      logExchange(env, {
        at: new Date().toISOString(),
        conversation,
        turn: messages.filter((m) => m.role === "user").length,
        question: messages[messages.length - 1].content,
        reply,
      })
    );
    return json(200, { reply, v: VERSION });
  } catch (e) {
    console.error("Appel à l’API impossible", e?.name, e?.message);
    return json(504, { error: UNAVAILABLE, code: e?.name === "TimeoutError" ? "delai" : "reseau", v: VERSION });
  }
}
