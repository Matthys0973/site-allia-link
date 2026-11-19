// Page privée du salon (route /api/salon), appelée par public/salon.html.
// Matthys tape le mail du contact et une note sur l'échange ; Claude rédige le mail de suivi,
// que Matthys relit puis envoie depuis sa propre messagerie.
//
// Réglages :
// - secret SALON_CODE (Cloudflare > Settings > Variables and Secrets) : le code demandé par la page.
//   Sans lui, la route refuse tout : personne d'autre ne peut l'utiliser.
// - secret ANTHROPIC_API_KEY, le même que pour l'assistant du site.
// - base D1 (DB) : chaque mail préparé est enregistré dans la table salon_leads, pour les relances.
//   Lire : SELECT at, email, note FROM salon_leads ORDER BY id DESC

const VERSION = "2026-11-19.1";
const TIMEOUT_MS = 25000;
const MAX_NOTE = 1500;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const PROMPT = `Tu rédiges, au nom de Matthys Houvenaghel (Allia Link), le mail qu'il envoie à une personne rencontrée quelques minutes plus tôt sur un salon professionnel. Elle reçoit le mail pendant qu'elle est encore devant lui : il doit être court, concret et parler de son cas à elle.

Tu reçois la note de Matthys sur l'échange (souvent dictée, avec des fautes : corrige-les sans rien inventer).

# Contenu du mail
1. « Bonjour Madame X, » ou « Bonjour Monsieur X, » si la note donne le nom et le genre, sinon « Bonjour, ».
2. Une phrase : merci pour l'échange sur le salon (le salon s'appelle Salon des Maires et des Collectivités Locales, seulement si la note ne dit pas autre chose), en rappelant en quelques mots son sujet à elle.
3. « Voici deux idées concrètes pour [sa structure] : » (ou trois si la note s'y prête vraiment), puis une liste avec des tirets simples « - ». Chaque idée tient en une ou deux phrases : ce que fait l'outil, sur quelles données ou quels documents, et ce que ça change pour son équipe. Utilise ses mots à elle et le vocabulaire de son métier.
4. Si une réalisation ci-dessous ressemble vraiment à une des idées, une phrase pour la citer avec son lien. Sinon, rien.
5. « Je peux vous montrer à quoi cela ressemblerait sur vos propres documents. N'hésitez pas à m'appeler pour en discuter. »
6. La signature, exactement :
Au plaisir,
Matthys Houvenaghel
Allia Link, allia-link.fr
06 52 43 09 21
Enregistrer mon contact : https://allia-link.fr/matthys.vcf

# Règles
- Vouvoiement, ton simple, direct et sobre. Pas de superlatifs, pas de formules commerciales (« révolutionner », « booster », « solution innovante »), pas de point d'exclamation, pas d'emoji.
- N'utilise jamais de tiret cadratin ni de tiret demi-cadratin.
- 150 mots au maximum hors signature.
- Aucun chiffre de prix, de délai ou de temps gagné, sauf s'il figure dans la note ou dans une réalisation citée.
- N'invente rien sur la structure de la personne : appuie-toi uniquement sur la note. Si la note est très vague, propose des idées prudentes, formulées comme des pistes (« par exemple »).
- Ne propose que ce qu'Allia Link sait faire (liste ci-dessous). Jamais de logiciel complet sur mesure, d'application mobile, de site web, de matériel ni d'objet connecté.
- Neo Eco est un client d'Allia Link, présent sur le même salon. Ne propose jamais toi-même d'étude territoriale, de veille des chantiers ou de carte des opérations du territoire. Si la note parle de Neo Eco ou de leur étude territoriale, ajoute seulement : « Pour l'étude territoriale, l'équipe Neo Eco revient vers vous. » et propose des idées sur d'autres sujets.

# Ce qu'Allia Link sait faire
- Automatiser les tâches répétitives : ressaisies, relances, données à extraire de PDF ou de mails, documents Word ou Excel à produire selon une trame (comptes rendus, rapports, courriers, fiches, délibérations, devis). L'outil prépare, l'équipe valide.
- Des tableaux de bord qui se mettent à jour seuls à partir des fichiers Excel, des logiciels métier ou des bases existantes.
- Un assistant qui répond aux questions des équipes à partir des documents internes (procédures, règlements, dossiers passés, marchés) et cite ses sources, dans Teams, un intranet ou un navigateur.
- Une veille automatique : presse, appels d'offres, publications officielles, avec un résumé de ce qui compte.
Les outils s'installent dans ce que la structure utilise déjà (Microsoft 365, SharePoint, Excel, logiciel métier), les données restent chez le client, et une personne valide avant tout usage.

# Réalisations que tu peux citer
- Tableau de bord de pilotage de la charge d'une équipe, mis à jour chaque semaine sans ressaisie : https://allia-link.fr/realisations.html#plan-de-charge
- Fiches techniques générées automatiquement à partir des rapports internes, 30 minutes par fiche au lieu de plusieurs heures : https://allia-link.fr/realisations.html#fiches
- Assistant dans Teams qui retrouve le bon document en une question, selon les droits de chacun : https://allia-link.fr/realisations.html#savoir

# Format de ta réponse
Première ligne : « Objet : » suivi d'un objet court et précis sur son sujet (pas de « Suite à notre échange » seul).
Puis une ligne vide, puis le corps du mail. Rien d'autre.`;

let tableReady = false;
async function saveLead(env, lead) {
  if (!env.DB) return;
  try {
    if (!tableReady) {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS salon_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, email TEXT, note TEXT, objet TEXT, corps TEXT)"
      ).run();
      tableReady = true;
    }
    await env.DB.prepare("INSERT INTO salon_leads (at, email, note, objet, corps) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(lead.at, lead.email, lead.note, lead.objet, lead.corps)
      .run();
  } catch (e) {
    console.error("Enregistrement du contact impossible", e?.message);
  }
}

// Comparaison en temps constant, pour ne pas laisser deviner le code caractère par caractère.
function sameCode(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Sépare « Objet : ... » du corps, et retire les tirets longs si le modèle en a quand même mis.
function parseMail(text) {
  const clean = text.replace(/\s*[—–]\s*/g, ", ").trim();
  const m = clean.match(/^\s*Objet\s*:\s*(.+)\n+([\s\S]+)$/i);
  if (!m) return { objet: "Suite à notre échange sur le salon", corps: clean };
  return { objet: m[1].trim(), corps: m[2].trim() };
}

export async function handleSalon(request, env, ctx) {
  if (request.method !== "POST") return json(405, { error: "Méthode non autorisée." });
  if (!env.SALON_CODE) return json(503, { error: "Page désactivée : le code SALON_CODE n'est pas réglé.", v: VERSION });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Requête illisible." });
  }
  if (!sameCode(String(body?.code || "").trim(), String(env.SALON_CODE).trim())) {
    return json(401, { error: "Code incorrect.", v: VERSION });
  }
  if (body?.check) return json(200, { ok: true, v: VERSION });

  const note = String(body?.note || "").trim().slice(0, MAX_NOTE);
  const email = String(body?.email || "").trim().slice(0, 200);
  if (note.length < 10) return json(400, { error: "La note est trop courte : décris en une phrase qui c'est et son besoin." });
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: "Clé de l'API absente.", v: VERSION });

  try {
    const res = await fetch(env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.SALON_MODEL || env.ANTHROPIC_MODEL || "claude-haiku-5-5",
        max_tokens: 900,
        system: PROMPT,
        messages: [{ role: "user", content: `Note de Matthys sur l'échange :\n${note}` }],
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("Erreur API Anthropic", res.status, (await res.text()).slice(0, 300));
      return json(502, { error: `L'IA ne répond pas (erreur ${res.status}). Réessaie.`, v: VERSION });
    }
    const data = await res.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return json(502, { error: "Réponse vide de l'IA. Réessaie.", v: VERSION });

    const mail = parseMail(text);
    ctx.waitUntil(saveLead(env, { at: new Date().toISOString(), email, note, ...mail }));
    return json(200, { ...mail, v: VERSION });
  } catch (e) {
    console.error("Appel à l'API impossible", e?.name, e?.message);
    return json(504, { error: e?.name === "TimeoutError" ? "L'IA met trop de temps. Réessaie." : "Pas de réseau. Réessaie.", v: VERSION });
  }
}
