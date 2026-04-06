# Architecture du projet

## Stack technique

| Couche | Technologie | Version | Rôle |
|--------|------------|---------|------|
| Runtime | Node.js | 18+ | Serveur JavaScript |
| Framework HTTP | Express | 4.18 | Routing, middlewares |
| Temps réel | Socket.IO | 4.6 | WebSocket bidirectionnel |
| Base de données | MySQL | 8.0 | Persistance (events, requests, votes…) |
| Cache / Sessions | Redis | 7+ | Sessions persistantes en production |
| Authentification | Spotify OAuth 2.0 | — | Login DJ, tokens Spotify |
| Lecture audio | Spotify Web Playback SDK | — | Lecture dans le navigateur du DJ |
| Sécurité | Helmet | 8.1 | Headers HTTP (CSP, HSTS…) |
| Sessions | express-session + connect-redis | — | Session serveur signée |
| Validation | express-validator | 7.3 | Validation des entrées HTTP |
| Sanitisation | sanitize-html | 2.17 | Nettoyage des inputs |
| Rate limiting | express-rate-limit | 8.2 | Limitation des requêtes HTTP |
| QR Code | qrcode + `utils/qrBranded.js` | 1.5 | QR invité (SVG : titre soirée, logo optionnel) |
| Frontend | HTML5 + Tailwind CSS (CDN) | — | Interface utilisateur |
| Déploiement | GitHub Actions + FTP | — | CI/CD vers o2switch |

---

## Structure des dossiers

```
djrequest/
├── app.js                        # Point d'entrée (require src/server.js)
├── src/
│   ├── server.js                 # Express app, middlewares, routes HTML, Socket.IO
│   ├── config/
│   │   ├── database.js           # Pool de connexions MySQL (mysql2)
│   │   ├── redis.js              # Client Redis (connect-redis)
│   │   └── session.js            # Configuration express-session (RedisStore en prod)
│   ├── controllers/
│   │   ├── auth.controller.js    # OAuth DJ, /me, PATCH nom, stats, disconnect Spotify
│   │   ├── dj.controller.js      # Dashboard, historique, stats DJ
│   │   └── events.controller.js  # CRUD événements, stats, fin de soirée
│   ├── middlewares/
│   │   ├── auth.js               # requireAuth, requireEventOwnership, requireEventAccess
│   │   ├── security.js           # helmetConfig, globalLimiter, authLimiter, sanitizeInput
│   │   └── validation.js         # handleValidationErrors (express-validator)
│   ├── routes/
│   │   ├── auth.routes.js        # /api/auth/*
│   │   ├── dj.routes.js          # /api/dj/*
│   │   ├── events.routes.js      # /api/events/*
│   │   └── spotify.routes.js     # /api/spotify/*
│   ├── services/
│   │   ├── queue.service.js      # Requêtes DB : queue, votes, positions
│   │   ├── rateLimit.service.js  # Rate limiting par clientId (DB-backed)
│   │   └── spotifyToken.service.js # Refresh automatique des tokens Spotify
│   ├── sockets/
│   │   └── eventHandlers.js      # Tous les handlers Socket.IO
│   ├── validators/
│   │   ├── auth.validator.js     # Validateurs login/register
│   │   └── events.validator.js   # Validateurs événements et settings
│   ├── utils/
│   │   ├── time.utils.js         # Formatage durées, estimation temps d'attente
│   │   └── qrBranded.js          # Data URL SVG pour QR dashboard / API
│   ├── public/
│   │   ├── sw-user.js            # Service worker minimal (PWA page invité)
│   │   ├── css/app.css           # Variables CSS (thème), classes utilitaires
│   │   └── js/
│   │       ├── csrf.js           # Lecture du cookie XSRF-TOKEN, injection header
│   │       ├── theme.js          # Toggle dark/light mode + localStorage
│   │       └── time-utils.js     # Fonctions JS partagées côté client
│   └── views/
│       ├── index.html            # Page d'accueil publique
│       ├── login.html            # Connexion DJ (bouton Spotify)
│       ├── dashboard.html        # Dashboard DJ (liste des soirées)
│       ├── profile.html          # Profil DJ (nom, stats, Spotify)
│       ├── dj.html               # Interface DJ temps réel
│       ├── mod.html              # Interface modérateur (sans contrôles Spotify)
│       ├── user.html             # Interface invité (mobile-first)
│       ├── qr-display.html       # Écran grand format (maintenant en cours, queue)
│       ├── event-stats.html      # Statistiques live et post-événement
│       ├── history.html          # Historique des soirées terminées
│       ├── error.html            # Page d'erreur branded (404, 403, ended…)
│       └── thank-you.html        # Page de fin de soirée pour les invités
├── db/
│   ├── db.sql                    # Schéma complet initial
│   ├── migration_spotify_auth.sql
│   ├── migration_spotify_tokens_dj.sql
│   ├── migration_fallback_playlist.sql
│   ├── migration_donation.sql
│   ├── migration_user_bans.sql
│   ├── migration_request_client_id.sql
│   ├── migration_mod_token.sql
│   ├── migration_starts_at.sql
│   ├── migration_repeat_cooldown.sql
│   └── docker-compose.yml        # MySQL + Redis en local
├── .github/workflows/deploy.yml  # CI/CD GitHub Actions → FTP o2switch
└── env.example                   # Template variables d'environnement
```

---

## Composants et responsabilités

### `src/server.js`

Point central de l'application :
- Instancie Express, `http.Server`, Socket.IO
- Applique les middlewares dans l'ordre : Helmet → JSON → URLEncoded → CookieParser → Sanitize → RateLimit → Session → CSRF → Static
- Définit les routes HTML (avec contrôle de session)
- Lance Socket.IO via `setupSocketHandlers(io)`
- Gère les erreurs globales (404, 500)
- Contient la route `/callback` OAuth Spotify par événement
- Expose `GET /health` (supervision) et `GET /manifest-user.json` (PWA invité)
- `setInterval` horaire : nettoyage rate limits expirés + purge des bans `user_bans` expirés

### `src/sockets/eventHandlers.js`

Cœur du temps réel. Un seul fichier gère tous les événements Socket.IO :
- Validation d'accès via `verifyEventAccess()` — accepte le DJ propriétaire **ou** un modérateur authentifié (`session.modAccess`)
- `verifyDjOwnsRequest()` — idem, pour les actions portant sur une demande spécifique
- Gestion du rate limiting côté socket (`clientId` persistant)
- Gestion des bans (`user_bans` en base, vérification à `join-event` pour persistance cross-refresh)
- Cache `nowPlayingCache` (Map en mémoire) — envoie l'état "en cours" aux nouveaux clients
- Anti-répétition (`repeat_cooldown_minutes` + dernière ligne `played` par URI)
- Actions groupées : `accept-all-pending`, `reject-all-pending` ; annulation de refus : `undo-reject-request` (fenêtre mémoire courte)

### `src/services/spotifyToken.service.js`

Service singleton qui garantit un access token Spotify valide pour un événement donné. Il rafraîchit automatiquement le token 5 minutes avant expiration et met à jour les tokens du DJ en base.

---

## Cycle de vie d'une demande de chanson

```
[Invité - user.html]
   1. Saisit une recherche → fetch GET /api/spotify/search?q=...&eventId=...
   2. Sélectionne un morceau → bottom sheet "prénom"
   3. (si don obligatoire) → affiche donationGate
   4. socket.emit("request-song", { eventId, songData, userName, clientId })

[Serveur - eventHandlers.js]
   5. Vérifie rate limit (clientId → table rate_limits)
   6. Vérifie doublons (si allow_duplicates=false)
   7. Insère en DB : requests (status="pending" ou "accepted")
   8. Incrémente rate limit
   9. Émet "request-created" → invité
  10. Émet "new-request" ou "queue-updated" → room

[DJ - dj.html]
  11. Reçoit "new-request" → affiche dans liste pending
  12. (optionnel) Écoute preview 30s via /api/spotify/preview_url
  13. Clique "Accepter" → socket.emit("accept-request", { requestId })

[Serveur]
  14. verifyDjOwnsRequest() → vérifie propriété
  15. UPDATE requests SET status='accepted', queue_position=N
  16. Émet "queue-updated" → room
  17. Émet "your-request-accepted" → invité

[Invité]
  18. Reçoit "your-request-accepted" → notification (vibration + titre clignotant)
  19. Voit sa position dans la queue en temps réel

[DJ]
  20. Clique "Jouer" → fetch POST /api/spotify/play/:eventId
      OU crossfade automatique → performCrossfade(uri)
  21. Spotify Web Playback SDK joue la chanson
  22. player_state_changed → socket.emit("broadcast-now-playing", {...})
  23. socket.emit("mark-played", { eventId, requestId })

[Invité]
  24. Reçoit "now-playing" → barre "En cours" mise à jour
  25. Reçoit "queue-updated" (status=played) → notification "en train de jouer"
```

---

## Sécurité : vue d'ensemble

```
Requête HTTP
    │
    ├─ Helmet (headers: CSP, HSTS, X-Frame-Options…)
    ├─ express-rate-limit (global: 500 req/15min en prod)
    ├─ sanitize-html (tous les body/query string params)
    ├─ express-session (cookie httpOnly, secure en prod, sameSite lax)
    ├─ CSRF double-submit cookie (XSRF-TOKEN ↔ X-CSRF-Token header)
    │
    ├─ Routes DJ  → requireAuth (vérifie req.session.djId)
    │              → requireEventOwnership (vérifie dj_id en DB)
    │
    ├─ Route /mod/:eventId → vérifie mod_token en DB → session.modAccess
    │
Socket.IO
    ├─ io.use() → session Express partagée (une fois par connexion)
    ├─ verifyEventAccess()   → DJ (session.djId) OU modérateur (session.modAccess)
    ├─ verifyDjOwnsRequest() → idem pour les actions portant sur une demande
    └─ join-event → vérification ban actif (user_bans), envoi cache now-playing
```

---

## Thème visuel

Le design utilise un système de variables CSS défini dans `src/public/css/app.css` :

```css
/* Exemple de variables du thème sombre (défaut) */
--bg-base:      #0f0f11   /* fond principal */
--bg-surface:   #18181b   /* cartes, panels */
--bg-elevated:  #27272a   /* inputs, hover */
--accent:       #6366f1   /* indigo - couleur principale */
--text-primary: #fafafa
--text-secondary:#a1a1aa
--border:       rgba(255,255,255,0.08)
--green:        #22c55e
--red:          #ef4444
```

Toggle dark/light géré par `src/public/js/theme.js` avec persistence `localStorage`.
