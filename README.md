# Site Allia Link

Site vitrine d'Allia Link, publié sur Netlify à chaque mise à jour de la branche `main`.

## Organisation

- `public/` : les pages et images du site, servies telles quelles.
- `public/fonts/` : la police Timeless des titres, au format web.
- `netlify/functions/chat/` : la fonction serveur de l'assistant en direct. `knowledge.mjs` contient ses consignes et ce qu'il sait d'Allia Link.
- `netlify.toml` : réglages Netlify.

## Assistant en direct

L'assistant appelle `/api/chat`, une fonction Netlify qui interroge Claude avec la clé `ANTHROPIC_API_KEY`. Cette clé est rangée dans les variables d'environnement de Netlify et ne doit jamais être ajoutée au dépôt.

Le modèle utilisé est `claude-haiku-5-5`, modifiable avec la variable Netlify `ANTHROPIC_MODEL`.

En cas de souci, on peut masquer le chat en passant `data-live-chat="on"` à `"off"` sur la balise `<body>` de `public/index.html` : la page affiche alors un exemple d'échange figé.

Quand le contenu du site change, penser à mettre à jour `knowledge.mjs` pour que l'assistant reste juste.

## Façon de travailler

Chaque modification passe par une branche et une pull request. Netlify génère un lien d'aperçu pour la vérifier avant de la fusionner dans `main`.
