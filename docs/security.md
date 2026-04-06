# Sécurité

Ce document décrit toutes les mesures de sécurité implémentées dans DJ Queue.

---

## Vue d'ensemble

```
Couche              Mécanisme
─────────────────────────────────────────────────────────────
Headers HTTP        Helmet 8.1 (CSP, HSTS, X-Frame-Options…)
Rate limiting HTTP  express-rate-limit (global + auth)
Sessions            express-session (cookie httpOnly, secure, signed)
CSRF                Double-submit cookie (XSRF-TOKEN ↔ X-CSRF-Token)
Authentification    Spotify OAuth 2.0 (pas de mot de passe local)
Modération          Token hex 64 chars (crypto.randomBytes) par événement
Autorisation HTTP   requireAuth + requireEventOwnership
Autorisation Socket verifyEventAccess (DJ ou modérateur) + verifyDjOwnsRequest
Validation          express-validator + custom validators
Sanitisation        sanitize-html (tous les inputs)
Fichiers statiques  /views non exposé directement (pas d'accès direct aux templates)
Ban invités         Table user_bans (clientId persistant, vérification à join-event)
```

---

## Headers HTTP — Helmet

Configuré dans `src/middlewares/security.js`.

### Content Security Policy (CSP)

```javascript
contentSecurityPolicy: {
  directives: {
    defaultSrc:  ["'self'"],
    styleSrc:    ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
    scriptSrc:   ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://sdk.scdn.co"],
    scriptSrcAttr: ["'unsafe-inline'"],
    imgSrc:      ["'self'", "data:", "https://i.scdn.co", "https://mosaic.scdn.co", "https://lineup-images.scdn.co"],
    connectSrc:  ["'self'", "wss:", "https://accounts.spotify.com", "https://api.spotify.com"],
    fontSrc:     ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
    mediaSrc:    ["'self'", "https://p.scdn.co", "blob:"],
    frameSrc:    ["https://sdk.scdn.co"],
    objectSrc:   ["'none'"],
    workerSrc:   ["'self'"],       // service worker PWA (page invité)
    manifestSrc: ["'self'"],       // /manifest-user.json
  }
}
```

> Les directives exactes peuvent évoluer (scripts CDN, Socket.IO, etc.) — se référer à `src/middlewares/security.js`.

### Autres headers Helmet activés

| Header | Valeur | Description |
|--------|--------|-------------|
| `X-Frame-Options` | `SAMEORIGIN` | Protection clickjacking |
| `X-Content-Type-Options` | `nosniff` | Pas de MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Contrôle des referers |
| `HSTS` | `max-age=31536000; includeSubDomains` | HTTPS forcé (production) |
| `X-XSS-Protection` | Activé | Protection XSS navigateur |

---

## Rate Limiting HTTP

### Rate limiter global

Appliqué à toutes les routes. Configuré dans `security.js`.

| Environnement | Max requêtes | Fenêtre |
|---------------|-------------|---------|
| Développement | 500 req | 15 min |
| Production | 100 req | 15 min |

Réponse en cas de dépassement :
```json
{ "error": "Trop de requêtes. Réessayez plus tard." }
```

### Rate limiter authentification

Appliqué spécifiquement à `/api/auth/*` :

| Max requêtes | Fenêtre |
|-------------|---------|
| 10 req | 15 min |

---

## Rate Limiting Socket (côté invités)

Géré par `src/services/rateLimit.service.js` en base de données MySQL.

### Identifiant persistant (`clientId`)

Chaque invité est identifié par un `clientId` généré une fois et stocké dans `localStorage`. Ce `clientId` est envoyé avec chaque `join-event` et `request-song`. Le serveur utilise ce `clientId` (et non le `socket.id` volatile) pour le rate limiting.

```javascript
// Côté client (user.html)
let clientId = localStorage.getItem("djClientId");
if (!clientId) {
  clientId = "client_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  localStorage.setItem("djClientId", clientId);
}
```

### Paramètres par événement

Chaque soirée définit ses propres limites via :
- `rate_limit_max` (défaut: 3 demandes)
- `rate_limit_window_minutes` (défaut: 15 minutes)

### Comportement

1. À chaque `request-song`, le serveur vérifie la table `rate_limits` pour le `clientId`.
2. Si la fenêtre est expirée, elle est réinitialisée.
3. Si `count >= max`, la demande est refusée avec l'événement `request-error { type: "rate-limit" }`.
4. Le statut est renvoyé au client via `rate-limit-status` à la connexion et `request-created.rateLimitStatus` après chaque demande.

---

## Sessions Express

Configuré dans `src/config/session.js`.

```javascript
session({
  name:   "djqueue.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",   // HTTPS uniquement en prod
    sameSite: "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000,                // 7 jours
  },
  store: new RedisStore({ client: redisClient }),     // persistance Redis en production
})
```

**En développement :** store mémoire (MemoryStore), données perdues au redémarrage.  
**En production :** RedisStore — les sessions survivent aux redémarrages.

### Données stockées en session

| Clé | Type | Description |
|-----|------|-------------|
| `djId` | number | ID MySQL du DJ connecté (absent pour les modérateurs) |
| `djName` | string | Nom d'affichage du DJ |
| `spotifyId` | string | ID Spotify du DJ |
| `spotifyAvatar` | string | URL photo de profil Spotify |
| `csrfToken` | string | Token CSRF de la session |
| `modAccess.eventId` | string | UUID de l'événement pour lequel cette session est modérateur |
| `modAccess.eventName` | string | Nom de l'événement (affichage) |

> `djId` et `modAccess` sont mutuellement exclusifs : une session ne peut pas être à la fois DJ et modérateur.

---

## Protection CSRF

Mécanisme : **double-submit cookie**.

### Fonctionnement

1. À chaque nouvelle session, un token aléatoire est généré :
   ```javascript
   req.session.csrfToken = crypto.randomBytes(32).toString("hex");
   ```
2. Ce token est mis dans un cookie `XSRF-TOKEN` (accessible par JS).
3. Les requêtes POST/PUT/DELETE doivent inclure ce token dans le header `X-CSRF-Token`.
4. Le middleware vérifie que `header === session.csrfToken`.

### Implémentation côté client

Le fichier `src/public/js/csrf.js` est chargé sur toutes les pages et injecte automatiquement le header :

```javascript
// Monkey-patch de fetch() pour injecter le header CSRF
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = getCookie("XSRF-TOKEN");
    if (token) {
      options.headers = {
        ...options.headers,
        "X-CSRF-Token": token,
      };
    }
  }
  return originalFetch(url, options);
};
```

### Routes exemptées

- `GET /api/auth/spotify/login` (redirection OAuth)
- `GET /auth/spotify/callback` (callback OAuth)
- `GET /callback` (callback Spotify par événement)

---

## Authentification — Spotify OAuth

Aucun mot de passe local n'est stocké. L'authentification est déléguée entièrement à Spotify.

### Flux de login DJ

```
1. DJ clique "Se connecter avec Spotify"
2. GET /api/auth/spotify/login
3. Redirection → accounts.spotify.com/authorize
   - scope: user-read-private, user-read-email,
             streaming, user-modify-playback-state,
             user-read-playback-state, playlist-read-private
4. Spotify redirige → /auth/spotify/callback?code=...&state=...
5. Server échange code → access_token + refresh_token
6. Upsert dans table djs (spotify_id, name, email, avatar, tokens)
7. Session créée : req.session.djId = dj.id
8. Redirection → /dashboard
```

### Sécurité du callback OAuth

Le paramètre `state` est utilisé pour lier le callback à l'identité du DJ. Si le DJ tente d'accéder à un événement qui ne lui appartient pas via le callback OAuth de l'événement, il reçoit une erreur 403.

### Refresh automatique des tokens DJ

Lors de l'utilisation de `spotifyToken.service.js`, si le token d'accès expire dans moins de 5 minutes, le service appelle automatiquement `POST https://accounts.spotify.com/api/token` avec le `refresh_token` et met à jour les colonnes `sp_access_token`, `sp_token_expires_at` dans la table `djs`.

---

## Autorisation — Routes HTTP

### `requireAuth` (`src/middlewares/auth.js`)

Vérifie que `req.session.djId` est défini. Sinon : redirection vers `/`.

```javascript
module.exports.requireAuth = (req, res, next) => {
  if (!req.session || !req.session.djId) {
    return res.redirect("/");
  }
  next();
};
```

### `requireEventOwnership`

Vérifie que le DJ connecté est propriétaire de l'événement.

```javascript
module.exports.requireEventOwnership = async (req, res, next) => {
  const eventId = req.params.eventId || req.body.eventId;
  const [rows] = await db.query(
    "SELECT id FROM events WHERE id = ? AND dj_id = ?",
    [eventId, req.session.djId]
  );
  if (rows.length === 0) return res.status(403).json({ error: "Accès refusé" });
  next();
};
```

---

## Autorisation — Socket.IO

### Partage de session

La session Express est partagée avec Socket.IO sans surcharge :

```javascript
// ✅ Correct — session chargée une seule fois par connexion socket
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// ❌ Incorrect — chargerait la session à chaque poll HTTP (provoque des 503)
// io.engine.use(sessionMiddleware);
```

### `verifyEventAccess(socket, eventId)`

Accepte le DJ propriétaire **ou** un modérateur authentifié via token.

```javascript
async function verifyEventAccess(socket, eventId) {
  const session = socket.request?.session;

  // DJ check
  const djId = session?.djId;
  if (djId) {
    const [rows] = await db.query(
      "SELECT id FROM events WHERE id = ? AND dj_id = ?", [eventId, djId]
    );
    if (rows.length > 0) return { authorized: true, role: "dj" };
  }

  // Modérateur check
  const modAccess = session?.modAccess;
  if (modAccess?.eventId === eventId) return { authorized: true, role: "moderator" };

  socket.emit("error", { message: "Accès refusé" });
  return { authorized: false, role: null };
}
```

### `verifyDjOwnsEvent(socket, eventId)` — alias

Conservé pour rétrocompatibilité ; retourne simplement `verifyEventAccess(...).authorized`.

### `verifyDjOwnsRequest(socket, requestId)`

Accepte le DJ **ou** le modérateur de l'événement auquel appartient la demande.

```javascript
async function verifyDjOwnsRequest(socket, requestId) {
  // DJ : vérifie via JOIN events+requests
  const djId = session?.djId;
  if (djId) {
    const [rows] = await db.query(
      `SELECT r.event_id, r.socket_id FROM requests r
       JOIN events e ON r.event_id = e.id
       WHERE r.id = ? AND e.dj_id = ?`, [requestId, djId]
    );
    if (rows.length > 0) return rows[0];
  }
  // Modérateur : vérifie que la demande appartient à son event
  const modEventId = session?.modAccess?.eventId;
  if (modEventId) {
    const [rows] = await db.query(
      "SELECT event_id, socket_id FROM requests WHERE id = ? AND event_id = ?",
      [requestId, modEventId]
    );
    if (rows.length > 0) return rows[0];
  }
  return null;
}
```

---

## Validation et Sanitisation des entrées

### Backend HTTP (express-validator)

Les routes utilisent des chaînes de validators définies dans `src/validators/` :

```javascript
// Exemple : création d'événement
body("name").trim().isLength({ min: 3, max: 100 }).withMessage("Nom entre 3 et 100 caractères")
```

Tout résultat est vérifié par `handleValidationErrors` avant d'atteindre le contrôleur.

### Backend Socket.IO (manuel)

Dans `eventHandlers.js`, les données de `request-song` sont validées et sanitisées :

```javascript
// Vérification du format URI Spotify
if (!/^spotify:track:[A-Za-z0-9]+$/.test(songData.uri)) {
  socket.emit("request-error", { message: "URI invalide" });
  return;
}

// Limitation de longueur
const safeName    = songData.name.trim().slice(0, 255);
const safeArtist  = songData.artist.trim().slice(0, 255);
const safeImage   = (songData.image || "").startsWith("https://") 
                      ? songData.image.slice(0, 512) : null;

// Sanitisation HTML
const sanitize = require("sanitize-html");
const safeUser = sanitize(userName || "Anonyme", { allowedTags: [], allowedAttributes: {} })
                   .trim().slice(0, 100) || "Anonyme";
```

### Middleware global de sanitisation

`sanitizeInput` dans `security.js` nettoie automatiquement `req.body`, `req.query`, et `req.params` sur toutes les requêtes :

```javascript
const sanitizeObject = (obj) => {
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === "string") {
      obj[key] = sanitize(obj[key], { allowedTags: [], allowedAttributes: {} });
    }
  }
};
```

---

## Exposition des fichiers statiques

**Important :** le dossier `/views` (templates HTML) n'est PAS exposé directement. Chaque page HTML est servie via une route Express dédiée qui vérifie les autorisations.

```javascript
// ✅ Correct
app.use(express.static(path.join(__dirname, "public")));

// ❌ Supprimé (exposait les templates sans vérification)
// app.use("/views", express.static(path.join(__dirname, "/views")));
```

---

## Checklist de sécurité

| Mesure | Statut |
|--------|--------|
| HTTPS en production | ✅ (Helmet HSTS) |
| Pas de mot de passe stocké | ✅ (Spotify OAuth) |
| Cookies httpOnly + secure | ✅ |
| Protection CSRF | ✅ (double-submit) |
| Rate limiting HTTP | ✅ |
| Rate limiting Socket | ✅ (clientId persistant) |
| Validation des inputs | ✅ (express-validator + manuel) |
| Sanitisation HTML | ✅ (sanitize-html) |
| Vérification propriété événement | ✅ (HTTP + Socket — DJ et modérateur) |
| CSP correctement configurée | ✅ |
| Templates non exposés en statique | ✅ |
| Tokens Spotify non exposés au frontend | ✅ |
| Sessions Redis en production | ✅ |
| Gestion des erreurs non catchées | ✅ (unhandledRejection, uncaughtException) |
| Système de ban invités (persistant) | ✅ (clientId + table user_bans) |
| Lien modérateur révocable | ✅ (token 256 bits, révocation immédiate) |
