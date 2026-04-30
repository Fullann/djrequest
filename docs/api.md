# Référence API REST

Toutes les routes API sont préfixées par `/api/`. Les requêtes mutatives (POST, PUT, DELETE) nécessitent le header CSRF :

```
X-CSRF-Token: <valeur du cookie XSRF-TOKEN>
```

Le fichier `src/public/js/csrf.js` injecte automatiquement ce header dans tous les `fetch()` des pages HTML.

---

## Authentification (`/api/auth`)

### `GET /api/auth/spotify/login`

Redirige vers Spotify pour l'authentification OAuth du DJ.

**Auth requise :** Non  
**Réponse :** Redirection HTTP 302 vers `accounts.spotify.com/authorize`

---

### `POST /api/auth/mod-logout`

Détruit la session modérateur (efface `session.modAccess`).

**Auth requise :** Non (harmless si absente)  
**Réponse :**
```json
{ "success": true }
```

---

### `POST /api/auth/logout`

Détruit la session du DJ et efface le cookie.

**Auth requise :** Oui  
**Corps :** Vide  
**Réponse :**
```json
{ "success": true }
```

---

### `GET /api/auth/me`

Retourne le profil du DJ connecté.

**Auth requise :** Oui  
**Réponse :**
```json
{
  "dj": {
    "id": 1,
    "name": "DJ Nathan",
    "spotify_id": "spotify_user_id",
    "spotify_avatar": "https://i.scdn.co/...",
    "email": "dj@example.com",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### `PATCH /api/auth/me`

Met à jour le **nom d’affichage** du DJ (champ `name` en base).

**Auth requise :** Oui  
**Corps :**
```json
{ "name": "Mon pseudo DJ" }
```
**Validation :** 2 à 80 caractères (trim).  
**Réponse :** `{ "success": true, "name": "..." }`

---

### `GET /api/auth/stats`

Agrégats globaux pour le DJ connecté.

**Auth requise :** Oui  
**Réponse :**
```json
{
  "stats": {
    "events_total": 12,
    "events_live": 2,
    "requests_total": 450
  }
}
```

---

### `POST /api/auth/spotify/disconnect`

Met à `NULL` les colonnes `sp_access_token`, `sp_refresh_token`, `sp_token_expires_at` du DJ.  
Les jetons déjà copiés dans `spotify_tokens` par événement ne sont pas modifiés.

**Auth requise :** Oui  
**Réponse :** `{ "success": true }`

---

## DJ (`/api/dj`)

### `GET /api/dj/dashboard`

Retourne la liste des soirées actives du DJ connecté.

**Auth requise :** Oui  
**Réponse :**
```json
{
  "events": [
    {
      "id": "uuid-...",
      "name": "Soirée Tech",
      "created_at": "...",
      "ended_at": null,
      "request_count": 42,
      "pending_count": 3
    }
  ]
}
```

---

### `GET /api/dj/history`

Retourne les soirées terminées du DJ avec leurs statistiques.

**Auth requise :** Oui  
**Réponse :** tableau d'événements avec stats (`total_requests`, `played_count`, etc.)

---

### `GET /api/dj/event/:eventId/stats`

Statistiques détaillées d'une soirée terminée.

**Auth requise :** Oui  
**Params :** `eventId` (UUID)

---

## Événements (`/api/events`)

### `POST /api/events/`

Crée une nouvelle soirée et génère le QR code.

**Auth requise :** Oui  
**Corps :**
```json
{ "name": "Soirée Anniversaire" }
```
**Validation :** nom entre 3 et 100 caractères.  
**Réponse :**
```json
{
  "eventId": "uuid-...",
  "qrCode": "data:image/svg+xml;base64,...",
  "djUrl": "/dj/uuid-...",
  "userUrl": "https://monsite.com/user/uuid-..."
}
```

> Le QR est généré en **SVG** avec le nom de la soirée ; un logo optionnel peut être ajouté via le fichier `src/public/images/qr-logo.png`.

---

### `GET /api/events/:eventId`

Retourne les informations complètes d'un événement avec sa queue.

**Auth requise :** Non (lecture publique)  
**Réponse :**
```json
{
  "id": "uuid-...",
  "name": "Soirée Tech",
  "created_at": "...",
  "votes_enabled": true,
  "auto_accept_enabled": false,
  "allow_duplicates": false,
  "rate_limit_max": 3,
  "rate_limit_window_minutes": 15,
  "fallback_playlist_uri": "spotify:playlist:...",
  "donation_enabled": false,
  "donation_required": false,
  "donation_amount": 2.00,
  "donation_link": null,
  "donation_message": null,
  "repeat_cooldown_minutes": 0,
  "queue": [
    {
      "id": "request-uuid",
      "song_name": "Track Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "image_url": "https://i.scdn.co/...",
      "spotify_uri": "spotify:track:...",
      "preview_url": "https://p.scdn.co/...",
      "duration_ms": 210000,
      "user_name": "Alice",
      "queue_position": 1,
      "upvotes": 3,
      "downvotes": 0,
      "net_votes": 3
    }
  ]
}
```

---

### `GET /api/events/:eventId/trends`

Tendances **publiques** pour la page invité (top 5 artistes + top 5 titres demandés).

**Auth requise :** Non  
**Réponse :**
```json
{
  "eventName": "Soirée Tech",
  "topArtists": [{ "artist": "Daft Punk", "total": 12, "played": 4 }],
  "topSongs": [{ "song_name": "One More Time", "artist": "Daft Punk", "total": 5 }]
}
```

---

### `GET /api/events/:eventId/guest-history/:clientId`

Historique des demandes d’un invité pour cette soirée (même `clientId` que `localStorage` / socket).

**Auth requise :** Non  
**Params :** `clientId` alphanumérique + `._-`, longueur 4–128.  
**Réponse :**
```json
{
  "requests": [
    {
      "id": "uuid-...",
      "song_name": "...",
      "artist": "...",
      "status": "played",
      "created_at": "..."
    }
  ]
}
```

---

### `PATCH /api/events/:eventId/settings`

Met à jour des réglages d’événement (au moins un champ requis).

**Auth requise :** Oui + propriétaire de l’événement  
**Corps (champs optionnels) :**
```json
{
  "votes_enabled": true,
  "repeat_cooldown_minutes": 30,
  "projection_visuals_enabled": true,
  "projection_visuals_mode": "bpm-sync",
  "projection_visuals_auto_per_track": false
}
```
- `repeat_cooldown_minutes` : entier **0–240** ; **0** = anti-répétition désactivée. Si > 0, un invité ne peut pas reproposer une piste déjà **jouée** (`status = played`, `played_at`) avant l’expiration du délai (vérifié à la demande, côté socket `request-song`).
- `projection_visuals_mode` : `aurora | pulse | strobe | spectrum | nebula | laser | vortex | party | dvd | bpm-sync`.

**Réponse :** `{ "success": true, "event": { ... } }` (ligne `events` complète après UPDATE).

---

### `GET /api/events/:eventId/qrcode`

Régénère le QR code de l'événement.

**Auth requise :** Non  
**Réponse :**
```json
{
  "qrCode": "data:image/svg+xml;base64,...",
  "userUrl": "https://monsite.com/user/uuid-..."
}
```

---

### `GET /api/events/:eventId/stats`

Statistiques globales de l'événement (fonctionne pendant et après).

**Auth requise :** Non  
**Réponse :**
```json
{
  "total_requests": 87,
  "played_count": 23,
  "rejected_count": 5,
  "pending_count": 2,
  "top_songs": [...],
  "top_artists": [...]
}
```

---

### `GET /api/events/:eventId/live-stats`

Statistiques temps réel enrichies (disponibles pendant et après la soirée).

**Auth requise :** Oui + propriétaire de l'événement  
**Réponse :**
```json
{
  "event": {
    "id": "uuid-...",
    "name": "Soirée Tech",
    "created_at": "...",
    "isLive": true,
    "durationMin": 127
  },
  "counts": {
    "total": 87,
    "played": 23,
    "pending": 2,
    "accepted": 5,
    "rejected": 8,
    "named_users": 34,
    "unique_users": 40
  },
  "topArtists": [
    { "artist": "Daft Punk", "total": 12, "played": 4 }
  ],
  "topSongs": [
    { "song_name": "Get Lucky", "artist": "Daft Punk", "image_url": "...", "total": 6, "played": 2 }
  ],
  "hotPending": {
    "song_name": "Harder Better Faster",
    "artist": "Daft Punk",
    "image_url": "...",
    "up": 8,
    "down": 1
  },
  "timeline": [
    { "slot": 0, "label": "+0min", "count": 5 },
    { "slot": 1, "label": "+15min", "count": 12 }
  ],
  "recentRequests": [...],
  "hourlyHeatmap": [
    { "hour": 21, "label": "21h", "count": 14 }
  ],
  "topTempos": [
    { "bpm_bucket": "110-129", "total": 26 }
  ],
  "skip": {
    "playedTotal": 40,
    "skippedTotal": 9,
    "skipRate": 22.5
  },
  "voteEngagement": {
    "totalVotes": 140,
    "uniqueVoters": 42,
    "votedRequests": 31,
    "votesPerRequest": 1.75
  }
}
```

---

### `GET /api/events/:eventId/live-stats.csv`

Export CSV des stats de soirée (ligne par demande), prêt pour tableur/BI.

**Auth requise :** Oui + propriétaire de l'événement  
**Réponse :** `text/csv` avec colonnes :
`created_at, played_at, skipped_at, status, user_name, song_name, artist, spotify_uri, bpm, energy, upvotes, downvotes`.

---

### `GET /api/events/:eventId/display-data`

Données publiques pour l'écran grand format (QR display).

**Auth requise :** Non  
**Réponse :**
```json
{
  "event": { "id": "...", "name": "..." },
  "upcomingQueue": [...],
  "recentPlayed": [...]
}
```

---

### `GET /api/events/:eventId/pending`

Liste des demandes en attente de validation.

**Auth requise :** Non (lecture publique)  
**Réponse :**
```json
{
  "pending": [
    {
      "id": "request-uuid",
      "song_name": "...",
      "artist": "...",
      "spotify_uri": "spotify:track:...",
      "preview_url": "https://p.scdn.co/...",
      "image_url": "...",
      "user_name": "Bob",
      "status": "pending",
      "created_at": "..."
    }
  ]
}
```

---

### `POST /api/events/:eventId/add-song-dj`

Ajoute directement une chanson à la queue (action DJ, statut `accepted` immédiat).

**Auth requise :** Oui + propriétaire de l'événement  
**Corps :**
```json
{
  "songData": {
    "name": "Track Name",
    "artist": "Artist",
    "album": "Album",
    "uri": "spotify:track:...",
    "image": "https://i.scdn.co/...",
    "duration_ms": 210000,
    "preview_url": "https://p.scdn.co/..."
  },
  "userName": "DJ"
}
```
**Réponse :**
```json
{ "success": true, "requestId": "uuid-...", "queuePosition": 3 }
```
**Side effect :** émet `queue-updated` à tous les clients de la room.

---

### `POST /api/events/:eventId/toggle-votes`

Active/désactive le système de votes.

**Auth requise :** Oui + propriétaire  
**Corps :** `{ "enabled": true }`

---

### `POST /api/events/:eventId/toggle-duplicates`

Autorise/interdit les chansons en double dans la queue.

**Auth requise :** Oui + propriétaire  
**Corps :** aucun (toggle simple)

---

### `POST /api/events/:eventId/toggle-auto-accept`

Active/désactive l'acceptation automatique des demandes.

**Auth requise :** Oui + propriétaire

---

### `POST /api/events/:eventId/update-rate-limit`

Modifie les limites de demandes par invité.

**Auth requise :** Oui + propriétaire  
**Corps :**
```json
{ "max": 3, "window": 15 }
```
**Validation :** `max` entre 1 et 50, `window` entre 1 et 120 minutes.

---

### `POST /api/events/:eventId/thank-you-message`

Définit le message de fin de soirée.

**Auth requise :** Oui + propriétaire  
**Corps :** `{ "message": "Merci à tous !" }`

---

### `POST /api/events/:eventId/generate-mod-token`

Génère un token modérateur pour cet événement et retourne le lien complet.

**Auth requise :** Oui + propriétaire de l'événement  
**Réponse :**
```json
{
  "token":  "a3f9c2...",
  "modUrl": "https://monsite.com/mod/uuid-...?token=a3f9c2..."
}
```

> Si un token existait déjà, il est remplacé. Partager le nouveau lien aux modérateurs.

---

### `POST /api/events/:eventId/revoke-mod-token`

Révoque le token modérateur (met `mod_token = NULL`).

**Auth requise :** Oui + propriétaire de l'événement  
**Réponse :**
```json
{ "success": true }
```

---

### `POST /api/events/:eventId/end`

Termine la soirée : marque `ended_at`, notifie tous les invités.

**Auth requise :** Oui + propriétaire  
**Réponse :**
```json
{
  "success": true,
  "stats": {
    "total_requests": 87,
    "played_count": 23,
    "rejected_count": 5,
    "pending_count": 0,
    "queue_count": 2
  }
}
```

---

### `GET /api/events/history`

Historique des soirées terminées du DJ connecté.

**Auth requise :** Oui

---

### `GET /api/events/:eventId/detailed-stats`

Statistiques détaillées post-événement (top artistes, top chansons, timeline).

**Auth requise :** Oui

---

## Spotify (`/api/spotify`)

> Toutes les routes Spotify opèrent sur le token de l'événement, automatiquement rafraîchi si nécessaire par `spotifyToken.service.js`.

### `GET /api/spotify/search?q=...&eventId=...`

Recherche des chansons sur Spotify.

**Auth requise :** Non  
**Params query :** `q` (min 2 chars), `eventId` (UUID)  
**Réponse :**
```json
{
  "tracks": [
    {
      "id": "spotify_track_id",
      "name": "Track Name",
      "artist": "Artist Name",
      "album": "Album Name",
      "image": "https://i.scdn.co/...",
      "uri": "spotify:track:...",
      "duration_ms": 210000,
      "preview_url": "https://p.scdn.co/..."
    }
  ]
}
```

---

### `GET /api/spotify/status/:eventId`

Vérifie si Spotify est connecté pour cet événement.

**Auth requise :** Non  
**Réponse :**
```json
{ "connected": true }
// ou
{ "connected": false, "reason": "Token expiré ou absent" }
```

---

### `GET /api/spotify/token/:eventId`

Retourne un access token Spotify valide pour le Spotify Web Playback SDK.

**Auth requise :** Oui + propriétaire de l'événement  
**Réponse :**
```json
{ "access_token": "BQA..." }
```

---

### `GET /api/spotify/login/:eventId`

Retourne l'URL d'autorisation Spotify pour connecter un événement.

**Auth requise :** Non  
**Réponse :**
```json
{ "authUrl": "https://accounts.spotify.com/authorize?..." }
```

---

### `POST /api/spotify/play/:eventId`

Lance la lecture d'une piste sur l'appareil Spotify actif.

**Auth requise :** Oui + propriétaire  
**Corps :**
```json
{
  "uri": "spotify:track:...",
  "device_id": "optional-device-id"
}
```
**Réponse :** `{ "success": true }`  
**Erreurs possibles :**
- `404` : aucun appareil actif (`NO_ACTIVE_DEVICE`)
- `403` : Spotify Premium requis

---

### `GET /api/spotify/audio-features/:eventId?ids=id1,id2,...`

Retourne le BPM, l'énergie et la tonalité pour une liste de pistes.

**Auth requise :** Oui + propriétaire  
**Params query :** `ids` (liste d'IDs Spotify séparés par virgule, max 50)  
**Réponse :**
```json
{
  "spotify_track_id": {
    "bpm": 128,
    "energy": 0.85,
    "key": 5,
    "mode": 1
  }
}
```
> Si l'endpoint `audio-features` est restreint (apps créées après nov. 2024), retourne la popularité comme proxy d'énergie : `{ "bpm": null, "energy": 0.76, "popularity": 76 }`
>
> Les données sont aussi mises en cache en base (`track_audio_cache`) pour alimenter les analytics live et le mode projection BPM sync.

---

### `GET /api/spotify/playlist/:eventId/:playlistId`

Retourne une piste aléatoire de la playlist de secours.

**Auth requise :** Oui + propriétaire  
**Réponse :**
```json
{
  "id": "spotify_track_id",
  "name": "Track Name",
  "artist": "Artist",
  "uri": "spotify:track:...",
  "image": "https://i.scdn.co/...",
  "duration_ms": 210000,
  "playlistName": "Ma Playlist"
}
```

---

## Routes racine (hors préfixe `/api`)

Ces URLs sont servies par Express directement (`src/server.js`). Pas de header CSRF requis (méthodes GET).

### `GET /health`

Sonde de supervision (UptimeRobot, Better Stack, etc.).

**Réponse `200` :**
```json
{
  "status": "ok",
  "uptime": 3600,
  "db": "ok",
  "redis": "ok"
}
```

- `uptime` : secondes depuis le démarrage du processus Node (`process.uptime()`).
- En **développement**, `redis` vaut en général `"skipped"`.
- En **production**, si Redis est configuré mais injoignable, `redis` vaut `"error"` → réponse **`503`** et `"status": "degraded"`.
- Si MySQL échoue sur `SELECT 1`, `db` vaut `"error"` → **`503`**.

Le rate limiter **global** en production n’applique pas de quota sur `/health` (voir `security.js`).

---

### `GET /manifest-user.json?e=<eventUuid>`

Manifest Web App pour l’installation PWA depuis la page invité.

**Query :** `e` = UUID de l’événement (obligatoire).  
**Réponse :** JSON `application/manifest+json` avec `start_url` pointant vers `/user/<uuid>`.

---

### `GET /sw-user.js`

Fichier statique : service worker minimal (`src/public/sw-user.js`), enregistré par `/user/:eventId` pour permettre « Ajouter à l’écran d’accueil ».

---

## Codes d'erreur

| Code | Signification |
|------|--------------|
| `400` | Paramètre invalide (format, longueur) |
| `401` | Non authentifié (session absente ou invalide) |
| `403` | Accès refusé (mauvais propriétaire, token CSRF invalide) |
| `404` | Ressource non trouvée |
| `500` | Erreur serveur interne |

Format d'erreur standard :
```json
{ "error": "Message d'erreur lisible" }
```
