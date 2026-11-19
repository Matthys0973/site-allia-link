// Point d'entrée de l'application Cloudflare : l'assistant sur /api/chat, la page privée du salon sur /api/salon,
// la fiche contact sur /matthys.vcf, les pages du dossier public/ pour le reste.
import { handleChat } from "../server/chat.mjs";
import { handleSalon } from "../server/salon.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") return handleChat(request, env, ctx);
    if (url.pathname === "/api/salon") return handleSalon(request, env, ctx);
    if (url.pathname === "/matthys.vcf") {
      // Type vCard explicite : sur iPhone comme sur Android, le lien ouvre directement « Ajouter aux contacts »
      const file = await env.ASSETS.fetch(new Request(new URL("/contact/matthys.vcf", url), request));
      if (!file.ok) return file;
      return new Response(file.body, {
        headers: {
          "Content-Type": "text/vcard; charset=utf-8",
          "Content-Disposition": 'inline; filename="Matthys Houvenaghel - Allia Link.vcf"',
          "Cache-Control": "public, max-age=3600",
        },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
