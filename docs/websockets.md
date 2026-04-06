# Événements Socket.IO

DJ Queue utilise Socket.IO 4 pour la communication temps réel. Tous les clients (DJ et invités) rejoignent une **room** identifiée par l'`eventId`.

---

## Connexion et authentification

### Partage de session

La session Express est partagée avec Socket.IO via `io.use()` (une seule fois à la connexion, pas sur chaque poll) :

```javascript
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});
```

Deux types d'identités sont reconnus dans la session :
- `session.djId` — DJ connecté via Spotify OAuth
- `session.modAccess.eventId` — Modérateur connecté via token

### `verifyEventAccess(socket, eventId)`

Remplace l'ancien `verifyDjOwnsEvent()`. Autorise DJ **et** modérateurs :

```javascript
async function verifyEventAccess(socket, eventId) {
  // Vérifie d'abord le DJ (propriétaire)
  const djId = session?.djId;
  if (djId) {
    const [rows] = await db.query("SELECT id FROM events WHERE id=? AND dj_id=?", [eventId, djId]);
    if (rows.length > 0) return { authorized: true, role: "dj" };
  }
  // Vérifie ensuite le modérateur (session.modAccess)
  const modAccess = session?.modAccess;
  if (modAccess?.eventId === eventId) return { authorized: true, role: "moderator" };
  return { authorized: false, role: null };
}
```

Les actions réservées au DJ seul (lecture Spotify, fin de soirée) vérifient `role === "dj"` après l'appel.

### Rejoindre une room

À chaque connexion (et reconnexion), le client émet `join-event` :

```javascript
// Page invité
socket.emit("join-event", { eventId: "uuid-...", clientId: "persistent-client-id" });

// Page DJ ou QR
socket.emit("join-event", "uuid-...");
```

---

## Événements CLIENT → SERVEUR

### `join-event`

Inscrit le socket dans la room de l'événement et retourne l'état du rate limit.

```typescript
// Payload
string | { eventId: string; clientId: string }
```

**Réponse serveur :** `rate-limit-status`

---

### `request-song`

Demande une chanson (action invité).

```typescript
{
  eventId:  string;
  songData: {
    name:        string;   // max 255 chars
    artist:      string;   // max 255 chars
    uri:         string;   // format "spotify:track:[A-Za-z0-9]+"
    album?:      string;   // max 255 chars
    image?:      string;   // URL https://, max 512 chars
    preview_url?: string;  // URL https://, max 512 chars
    duration_ms?: number;  // entier positif
  };
  userName?:  string;   // max 100 chars, défaut "Anonyme"
  clientId?:  string;   // identifiant persistant (localStorage)
}
```

**Validations côté serveur :**
- URI doit correspondre à `/^spotify:track:[A-Za-z0-9]+$/`
- `image` et `preview_url` doivent commencer par `https://`
- Rate limit par `clientId` en base de données
- Vérification des doublons (si `allow_duplicates=false`)
- **Anti-répétition** : si `repeat_cooldown_minutes > 0` sur l’événement, refus si une demande avec le même `spotify_uri` a déjà été jouée (`status = played`, `played_at` non NULL) dans la fenêtre de temps ; l’invité reçoit `request-error` avec `type: "repeat-cooldown"`

---

### `vote`

Vote pour/contre une chanson (action invité, si votes activés).

```typescript
{
  requestId: string;
  voteType:  "up" | "down";
}
```

---

### `accept-request`

Accepte une demande en attente (DJ ou modérateur).

```typescript
{ requestId: string }
```

**Auth :** `verifyEventAccess()` — DJ ou modérateur de l'événement concerné.

---

### `reject-request`

Refuse une demande en attente (DJ ou modérateur).

```typescript
{ requestId: string }
```

**Auth :** idem `accept-request`.  
**Mémoire courte :** l’ID de la demande est mémorisé quelques secondes pour permettre `undo-reject-request` (voir ci-dessous).

---

### `undo-reject-request`

Remet une demande **récemment refusée** en statut `pending` (DJ ou modérateur).

```typescript
{ requestId: string }
```

**Auth :** `verifyDjOwnsRequest()` — même périmètre qu’`accept-request`.  
**Fenêtre :** ~8 secondes après le refus (stockage en mémoire du processus Node — perdu au redémarrage).  
**Side effects :** `reject-undone`, `new-request` (payload complet), `your-request-pending-again` vers le socket de l’invité si connu.

---

### `accept-all-pending`

Accepte **toutes** les demandes `pending` de l’événement, dans l’ordre chronologique.

```typescript
{ eventId: string }
```

**Auth :** `verifyDjOwnsEvent()`  
**Side effects :** pour chaque demande acceptée : `request-accepted`, `your-request-accepted` (invité), puis `queue-updated` global.

---

### `reject-all-pending`

Refuse **toutes** les demandes `pending` (pas d’undo groupé).

```typescript
{ eventId: string }
```

**Auth :** `verifyDjOwnsEvent()`  
**Side effects :** pour chaque ligne : `request-rejected`, `your-request-rejected` si `socket_id` connu.

---

### `mark-played`

Marque une chanson de la queue comme jouée (**DJ uniquement**).

```typescript
{ eventId: string; requestId: string }
```

**Auth :** `verifyEventAccess()` avec `role === "dj"` requis.

---

### `reorder-queue`

Réorganise l'ordre des chansons dans la queue par drag & drop (DJ ou modérateur).

```typescript
{
  eventId:  string;
  newQueue: Array<{ id: string }>; // nouvelles positions dans l'ordre du tableau
}
```

**Auth :** `verifyEventAccess()`

---

### `broadcast-now-playing`

Diffuse la chanson en cours de lecture aux invités (émis automatiquement depuis `player_state_changed` du SDK Spotify, avec debounce 300ms). **DJ uniquement.**

```typescript
{
  eventId:   string;
  track: {
    name:       string;
    artist:     string;
    albumArt:   string;    // URL image pochette
    durationMs: number;
  };
  positionMs: number;       // position actuelle en ms
  isPlaying:  boolean;
  timestamp:  number;       // Date.now() au moment de l'émission (pour interpolation côté invité)
}
```

**Auth :** `verifyEventAccess()` avec `role === "dj"` requis.

---

### `dj-message`

Envoie un message texte à tous les invités (bannière toast sur les téléphones). DJ ou modérateur.

```typescript
{ eventId: string; message: string }   // message max 200 chars
```

**Auth :** `verifyEventAccess()`

---

### `update-event-settings`

Met à jour un ou plusieurs paramètres de l'événement (DJ ou modérateur — les paramètres de dons et de playlist de secours sont réservés au DJ).

```typescript
{
  eventId:          string;
  // Champs optionnels — seuls ceux présents sont mis à jour
  votesEnabled?:         boolean;
  autoAcceptEnabled?:    boolean;
  fallbackPlaylistUri?:  string | null;   // DJ uniquement
  donationEnabled?:      boolean;         // DJ uniquement
  donationRequired?:     boolean;         // DJ uniquement
  donationAmount?:       number;          // DJ uniquement (entre 0.50 et 50.00)
  donationLink?:         string;          // DJ uniquement (URL https://)
  donationMessage?:      string;          // DJ uniquement (max 500 chars)
  repeatCooldownMinutes?: number;         // 0–240, anti-répétition (0 = désactivé)
}
```

**Auth :** `verifyEventAccess()`  
**Side effect :** émet `event-settings-updated` à tous les clients de la room.

---

### `ban-user`

Bloque un invité pour une durée donnée ou toute la soirée (DJ ou modérateur).

```typescript
{
  eventId:   string;
  requestId: string;    // ID d'une demande pour retrouver le clientId de l'invité
  duration:  number;    // durée en minutes ; 0 = ban permanent (toute la soirée)
}
```

**Auth :** `verifyEventAccess()`  
**Side effect :** supprime les demandes `pending` de l'invité, émet `you-are-banned` à l'invité, `queue-updated` à la room, `banned-users-updated` au DJ/modérateur.

---

### `unban-user`

Débloque un invité (DJ ou modérateur).

```typescript
{
  eventId:  string;
  clientId: string;   // clientId de l'invité à débloquer
}
```

**Auth :** `verifyEventAccess()`  
**Side effect :** émet `banned-users-updated`.

---

### `get-banned-users`

Récupère la liste des invités bloqués pour une soirée.

```typescript
{ eventId: string }
```

**Auth :** `verifyEventAccess()`  
**Réponse :** `banned-users-updated`

---

## Événements SERVEUR → CLIENT

### `rate-limit-status`

État du rate limit envoyé à un invité spécifique lors du `join-event`.

```typescript
// Cas autorisé
{
  allowed:   true;
  count:     number;    // demandes faites dans la fenêtre
  max:       number;    // maximum autorisé
  remaining: number;    // restantes
}

// Cas bloqué
{
  allowed:        false;
  count:          number;
  max:            number;
  remainingMs:    number;   // ms avant réinitialisation
  remainingMinutes: number;
}
```

---

### `request-created`

Confirmation de création d'une demande, envoyé à l'invité auteur.

```typescript
{
  requestId:       string;
  songName:        string;
  artist:          string;
  image:           string | null;
  status:          "pending" | "accepted";
  rateLimitStatus: RateLimitStatus;  // voir request-error pour la structure
}
```

---

### `request-error`

Erreur lors d'une demande (rate limit, doublon, ban, anti-répétition, événement non trouvé).

```typescript
{
  type?:       "rate-limit" | "duplicate" | "banned" | "repeat-cooldown";
  message:     string;
  remainingMs?: number;   // si type="banned" et ban temporaire
}
```

---

### `your-request-pending-again`

L’invité est informé que sa demande, après un refus, est revenue en **pending** (annulation du refus par le DJ).

```typescript
{ requestId: string }
```

---

### `reject-undone`

Émis à toute la room lorsqu’un refus a été annulé (avant émission de `new-request` avec le détail de la demande).

```typescript
{ requestId: string }
```

---

### `your-request-accepted`

Notifie l'invité que SA demande a été acceptée.

```typescript
{
  requestId: string;
  position:  number;  // position dans la queue
}
```

---

### `your-request-rejected`

Notifie l'invité que SA demande a été refusée.

```typescript
{ requestId: string }
```

---

### `new-request`

Nouvelle demande en attente de validation (broadcast à toute la room — surtout pour le DJ).

```typescript
// Objet request complet depuis la DB (avec upvotes, downvotes)
{
  id:           string;
  song_name:    string;
  artist:       string;
  image_url:    string;
  preview_url:  string;
  spotify_uri:  string;
  duration_ms:  number;
  user_name:    string;
  status:       "pending";
  created_at:   string;
  upvotes:      number;
  downvotes:    number;
}
```

---

### `request-accepted`

Confirme qu'une demande a changé de statut `pending` → `accepted`.

```typescript
{ requestId: string }
```

---

### `request-rejected`

Confirme qu'une demande a changé de statut `pending` → `rejected`.

```typescript
{ requestId: string }
```

---

### `queue-updated`

Mise à jour complète de la queue (envoyé après tout changement de queue).

```typescript
{
  queue: Array<{
    id:             string;
    song_name:      string;
    artist:         string;
    album:          string;
    image_url:      string;
    spotify_uri:    string;
    preview_url:    string;
    duration_ms:    number;
    user_name:      string;
    queue_position: number;
    status:         "accepted";
    upvotes:        number;
    downvotes:      number;
    net_votes:      number;
  }>
}
```

---

### `vote-updated`

Mise à jour des votes pour une chanson spécifique.

```typescript
{
  requestId: string;
  upvotes:   number;
  downvotes: number;
}
```

---

### `vote-error`

Erreur lors d'un vote (votes désactivés).

```typescript
{ message: string }
```

---

### `now-playing`

Morceau en cours de lecture (broadcast aux invités, PAS au DJ qui a émis).

```typescript
{
  eventId:   string;
  track: {
    name:       string;
    artist:     string;
    albumArt:   string;
    durationMs: number;
  };
  positionMs: number;
  isPlaying:  boolean;
  timestamp:  number;    // Date.now() côté DJ → permet l'interpolation côté invité
}
```

**Utilisation côté invité (`user.html`) :**
```javascript
// Position interpolée en temps réel
const elapsed  = Date.now() - data.timestamp;
const position = data.positionMs + (data.isPlaying ? elapsed : 0);
const progress = position / data.track.durationMs * 100;
```

---

### `dj-message`

Message du DJ en broadcast vers tous les invités.

```typescript
{ message: string }
```

**Comportement côté invité :** bannière animée en haut de l'écran, disparaît après 8 secondes, vibration `[30, 20, 30]`.

---

### `event-settings-updated`

Mise à jour des paramètres de l'événement en temps réel.

```typescript
{
  votesEnabled?:     boolean;
  autoAcceptEnabled?: boolean;
  donationEnabled?:  boolean;
  donationRequired?: boolean;
  donationAmount?:   number;
  donationLink?:     string;
  donationMessage?:  string;
}
```

---

### `you-are-banned`

Notifie un invité qu'il est bloqué (à la connexion si ban persistant, ou en temps réel si ban déclenché).

```typescript
{
  permanent:          boolean;    // true = ban toute la soirée
  remainingMs:        number | null;  // null si permanent
  cancelledRequestIds?: string[];     // IDs des demandes annulées suite au ban
}
```

**Comportement côté invité :** overlay de ban affiché, recherche désactivée, demandes annulées.

---

### `banned-users-updated`

Liste actualisée des invités bloqués (envoyée au DJ/modérateur après chaque ban/unban).

```typescript
{
  bans: Array<{
    client_id:    string;
    user_name:    string | null;
    banned_until: number | null;   // timestamp ms, null = soirée entière
  }>
}
```

---

### `event-ended`

La soirée est terminée (émis par `POST /api/events/:eventId/end`).

```typescript
{ message: string }
```

**Comportement :** les invités sont redirigés vers `/event/:eventId/thank-you` après 2 secondes.

---

## Diagramme de séquence — vue d'ensemble

```
Invité          Serveur (Socket.IO)         DJ / Modérateur
  │                     │                         │
  │── join-event ───────>│<── join-event ──────────│
  │<── rate-limit-status─│                         │
  │<── now-playing ──────│  (cache serveur)        │
  │<── you-are-banned ───│  (si ban actif)         │
  │                      │                         │
  │── request-song ──────>│                         │
  │<── request-created ───│── new-request ─────────>│
  │                      │                         │
  │                      │<── accept-request ───────│
  │<── your-request-accepted                        │
  │<──────── queue-updated (broadcast) ─────────────│
  │                      │                         │
  │── vote ──────────────>│                         │
  │<──────── vote-updated (broadcast) ──────────────│
  │                      │                         │
  │                      │<── ban-user ─────────────│
  │<── you-are-banned ───│                         │
  │<──────── queue-updated (annulation demandes) ───│
  │                      │── banned-users-updated ─>│
  │                      │                         │
  │                      │<── mark-played ──────────│  (DJ uniquement)
  │<──────── queue-updated (broadcast) ─────────────│
  │                      │                         │
  │                      │<── broadcast-now-playing ─│  (DJ uniquement)
  │<── now-playing ───────│                         │
  │                      │                         │
  │                      │<── dj-message ───────────│
  │<── dj-message ────────│                         │
```
