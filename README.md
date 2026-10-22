# Site Allia Link

Site vitrine d'Allia Link, publié sur Cloudflare Pages à chaque mise à jour de la branche `main`.

## Organisation

- `public/` : les pages et images du site, servies telles quelles.
- `public/fonts/` : la police Timeless des titres, au format web.
- `functions/api/chat.js` : la fonction serveur de l'assistant en direct, appelée sur `/api/chat`.
- `server/knowledge.mjs` : les consignes de l'assistant et ce qu'il sait d'Allia Link.
- `netlify/` et `netlify.toml` : ancienne version pour Netlify, à supprimer une fois la bascule terminée.

## Réglages du projet Cloudflare Pages

- Dépôt : Matthys0973/site-allia-link, branche de production `main`.
- Préréglage : aucun. Commande de build : vide. Dossier de sortie : `public`. Dossier racine : vide.
- Variable secrète `ANTHROPIC_API_KEY` : la clé de l'API Claude. Elle ne doit jamais être ajoutée au dépôt.
- Liaison D1 nommée `DB` vers la base `allia-link` : sert à la limite de questions et à l'historique anonyme. Les tables se créent seules au premier appel.
- Variables facultatives : `ANTHROPIC_MODEL` (par défaut `claude-haiku-5-5`), `CHAT_LIMIT_VISITOR` (25 questions par visiteur et par jour), `CHAT_LIMIT_TOTAL` (600 par jour), `CHAT_SALT`.

## Assistant en direct

Chaque réponse de `/api/chat` porte un numéro de version (`v`) et, en cas d'erreur, un code court (`api_…`, `vide_…`, `delai`, `reseau`, `cle_absente`).

Pour lire l'historique : tableau de bord Cloudflare, Storage & Databases, D1, base `allia-link`, onglet Console, par exemple `SELECT * FROM logs ORDER BY id DESC LIMIT 50`.

En cas de souci, on peut masquer le chat en passant `data-live-chat="on"` à `"off"` sur la balise `<body>` de `public/index.html` : la page affiche alors un exemple d'échange figé.

Quand le contenu du site change, penser à mettre à jour `server/knowledge.mjs` pour que l'assistant reste juste.

## Tester en local

```
npx wrangler pages dev public --d1 DB=allia-link
```

avec un fichier `.dev.vars` (ignoré par git) contenant `ANTHROPIC_API_KEY=...`.

## Façon de travailler

Chaque modification passe par une branche et une pull request. Cloudflare génère un lien d'aperçu pour chaque branche.
