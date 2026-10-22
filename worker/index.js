// Point d'entrée de l'application Cloudflare : l'assistant sur /api/chat, les pages du dossier public/ pour le reste.
import { handleChat } from "../server/chat.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
