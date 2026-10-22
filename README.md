# Site Allia Link

Site vitrine d'Allia Link, publié sur Cloudflare (application Workers avec fichiers statiques) à ch## Organisation

- `public/` : les pages et images du site, servies telles quelles.
- `public/fonts/` : la police Timeless des titres, au format web.
- `worker/index.js` : point d'entrée de l'application. Il envoie `/api/chat` à l'assistant et sert les pages pour tout le reste.
- `server/chat.mjs` : l'assistant en direct.
- `server/knowledge.mjs` : les consignes de l'assistant et ce qu'il sait d'Allia Link.
- `wrangler.jsonc` : configuration de l'application Cloudflare (nom, dossier des pages, base D1).
- `netlify/` et `netlify.toml` : ancienne version pour Netlify, à supprimer une fois la bascule terminée.

## Réglages de l'application Cloudflare

- Créée depuis Workers & Pages > Create application, en important le dépôt Matthys0973/site-allia-link.
- Nom de l'application : `site-allia-link`, identique au champ `name` de `wrangler.jsonc`. Branche de production : `main`.
- Commande de build : vide. Commande de déploiement : `npx wrangler deploy`. Dossier racine : vide.
- Secret `ANTHROPIC_API_KEY` (Settings > Variables and Secrets, type Secret) : la clé de l'API Claude. Elle ne doit jamais être ajoutée au dépôt.
- Base D1 `allia-link` : créée dans Storage & Databases > D1, puis déclarée dans `wrangler.jsonc` sous le nom `DB` avec son identifiant. Elle sert à la limite de questions et à l'historique anonyme. Les tables se créent seules au premier appel.
- Variables facultatives : `ANTHROPIC_MODEL` (par défaut `claude-haiku-5-5`), `CHAT_LIMIT_VISITOR` (25 questions par visiteur et par jour), `CHAT_LIMIT_TOTAL` (600 par jour), `CHAT_SALT`. `keep_vars` les préserve d'un déploiement à l'autre.

IT_TOTAL` (600 par jour), `CHAT_SALT`.

## Assistant en direct

Chaque réponse de `/api/chat` porte un numéro de version (`v`) et, en cas d'erreur, un code court (`api_…`, `vide_…`, `delai`, `reseau`, `cle_absente`).

Pour lire l'historique : tableau de bord Cloudflare, Storage & Databases, D1, base `allia-link`, onglet Console, par exemple `SELECT * FROM logs ORDER BY id DESC LIMIT 50`.

En cas de souci, on peut masquer le chat en passant `data-live-chat="on"` à `"off"` sur la balise `<body>` de `public/index.html` : la page affiche alors un exemple d'échange figé.

Quand le contenu du site change, penser à mettre à jour `server/knowledge.mjs` pour que l'assistant reste juste.

## Tester en local

```
npx wrangler dev
```

avec un fichier `.dev.vars` (ignoré par git) contenant `ANTHROPIC_API_KEY=...`.

## Façon de travailler

Chaque modification passe par une branche et une pull request. Cloudflare peut générer une version d'aperçu pour chaque branche.
