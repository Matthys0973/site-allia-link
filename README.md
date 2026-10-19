# Site Allia Link

Site vitrine d'Allia Link, publié sur Netlify à chaque mise à jour de la branche `main`.

## Organisation

- `public/` : les pages et images du site, servies telles quelles.
- `netlify/functions/` : la fonction serveur de l'assistant en direct (à ajouter).
- `netlify.toml` : réglages Netlify.

## Assistant en direct

L'assistant appelle `/api/chat`, une fonction Netlify qui interroge Claude avec la clé `ANTHROPIC_API_KEY`. Cette clé est rangée dans les variables d'environnement de Netlify et ne doit jamais être ajoutée au dépôt.

Tant que la fonction n'est pas en place, la page d'accueil affiche un exemple figé à la place du chat. Pour activer le chat, passer `data-live-chat="off"` à `"on"` sur la balise `<body>` de `public/index.html`.

## Façon de travailler

Chaque modification passe par une branche et une pull request. Netlify génère un lien d'aperçu pour la vérifier avant de la fusionner dans `main`.
