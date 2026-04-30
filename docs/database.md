# Base de données

**SGBD :** MySQL 8.0+  
**Nom de la base :** `dj_queue` (configurable via `DB_NAME`)  
**Driver Node.js :** `mysql2` avec pool de connexions

---

## Schéma complet

### Table `djs`

Comptes DJ (authentification via Spotify OAuth).

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `id` | INT AUTO_INCREMENT | Non | — | Clé primaire |
| `spotify_id` | VARCHAR(255) | Oui | NULL | ID Spotify unique du DJ |
| `name` | VARCHAR(255) | Non | — | Nom d'affichage |
| `email` | VARCHAR(255) | Oui | NULL | Email Spotify (nullable depuis migration) |
| `password` | VARCHAR(255) | Oui | NULL | Ancien champ mot de passe (désactivé) |
| `spotify_avatar` | TEXT | Oui | NULL | URL photo de profil Spotify |
| `sp_access_token` | TEXT | Oui | NULL | Token Spotify actuel du DJ |
| `sp_refresh_token` | TEXT | Oui | NULL | Refresh token Spotify |
| `sp_token_expires_at` | BIGINT | Oui | NULL | Timestamp expiration (ms) |
| `created_at` | DATETIME | Non | NOW() | Date de création |

**Index :** `UNIQUE(spotify_id)`, `INDEX(email)`

---

### Table `events`

Soirées créées par les DJs.

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `id` | VARCHAR(36) | Non | — | UUID v4, clé primaire |
| `name` | VARCHAR(255) | Non | — | Nom de la soirée |
| `dj_id` | INT | Oui | NULL | FK → `djs.id` |
| `created_at` | DATETIME | Non | NOW() | Date de création |
| `starts_at` | DATETIME | Oui | NULL | Planification : ouverture des demandes (migration `migration_starts_at.sql`) |
| `ended_at` | DATETIME | Oui | NULL | Date de fin (NULL = en cours) |
| `allow_duplicates` | TINYINT(1) | Non | 0 | Autoriser les chansons en double |
| `votes_enabled` | TINYINT(1) | Non | 1 | Activer le système de votes |
| `auto_accept_enabled` | TINYINT(1) | Non | 0 | Acceptation automatique |
| `rate_limit_max` | INT | Non | 3 | Max demandes par fenêtre |
| `rate_limit_window_minutes` | INT | Non | 15 | Durée de la fenêtre (minutes) |
| `repeat_cooldown_minutes` | INT UNSIGNED | Non | 0 | Anti-répétition : délai min. avant de reproposer une piste déjà jouée (`played_at`) ; 0 = off (migration `migration_repeat_cooldown.sql`) |
| `thank_you_message` | TEXT | Oui | NULL | Message de fin de soirée |
| `fallback_playlist_uri` | VARCHAR(255) | Oui | NULL | URI Spotify de la playlist de secours |
| `donation_enabled` | TINYINT(1) | Non | 0 | Activer le système de dons |
| `donation_required` | TINYINT(1) | Non | 0 | Don obligatoire avant de proposer |
| `donation_amount` | DECIMAL(10,2) | Non | 2.00 | Montant suggéré (€) |
| `donation_link` | VARCHAR(500) | Oui | NULL | URL du lien de paiement |
| `donation_message` | VARCHAR(500) | Oui | NULL | Message affiché aux invités |
| `mod_token` | VARCHAR(64) | Oui | NULL | Token modérateur (hex 64 car.) — NULL = aucun lien actif |

**FK :** `events.dj_id → djs.id`  
**Status :** `ended_at IS NULL` = soirée active, `ended_at IS NOT NULL` = terminée

---

### Table `requests`

Demandes de chansons par les invités.

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `id` | VARCHAR(36) | Non | — | UUID v4, clé primaire |
| `event_id` | VARCHAR(36) | Non | — | FK → `events.id` |
| `socket_id` | VARCHAR(255) | Non | — | Socket.IO ID de l'invité au moment de la demande |
| `client_id` | VARCHAR(255) | Oui | NULL | Identifiant persistant (localStorage) — utilisé pour le ban |
| `user_name` | VARCHAR(255) | Oui | 'Anonyme' | Prénom de l'invité |
| `song_name` | VARCHAR(255) | Non | — | Titre de la chanson |
| `artist` | VARCHAR(255) | Non | — | Artiste |
| `album` | VARCHAR(255) | Oui | NULL | Album |
| `image_url` | VARCHAR(512) | Oui | NULL | URL pochette (https://) |
| `preview_url` | VARCHAR(512) | Oui | NULL | URL preview 30s Spotify (https://) |
| `spotify_uri` | VARCHAR(255) | Non | — | URI Spotify (format: `spotify:track:...`) |
| `duration_ms` | INT | Oui | NULL | Durée en millisecondes |
| `status` | ENUM | Non | 'pending' | `pending` / `accepted` / `rejected` / `played` |
| `queue_position` | INT | Oui | NULL | Position dans la queue (NULL si pas en queue) |
| `created_at` | DATETIME | Non | NOW() | Date de la demande |
| `played_at` | DATETIME | Oui | NULL | Date de lecture |
| `play_started_at` | DATETIME | Oui | NULL | Date de démarrage de lecture (instrumentation live) |
| `skipped_at` | DATETIME | Oui | NULL | Date de skip (passage au morceau suivant) |

**FK :** `requests.event_id → events.id`  
**Index :** `(event_id, status)`, `(event_id, spotify_uri)` (pour les doublons), `(client_id)`

---

### Table `user_bans`

Invités bloqués par soirée.

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `id` | INT AUTO_INCREMENT | Non | — | Clé primaire |
| `event_id` | VARCHAR(36) | Non | — | FK → `events.id` |
| `client_id` | VARCHAR(255) | Non | — | `clientId` de l'invité banni |
| `user_name` | VARCHAR(255) | Oui | NULL | Prénom affiché au moment du ban |
| `banned_until` | BIGINT | Oui | NULL | Timestamp (ms) de fin du ban — `NULL` = toute la soirée |
| `created_at` | DATETIME | Non | NOW() | Date du ban |

**Contrainte :** `UNIQUE(event_id, client_id)` — un seul ban actif par invité par soirée  
**FK :** `user_bans.event_id → events.id ON DELETE CASCADE`  
**Comportement :** si `banned_until < NOW()` à la connexion, le ban est automatiquement supprimé.  
**Nettoyage serveur :** toutes les heures, un job supprime aussi les lignes avec `banned_until` non NULL et dépassé (`server.js` + même intervalle que le nettoyage des rate limits).

---

### Table `votes`

Votes des invités sur les chansons en queue.

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `id` | INT AUTO_INCREMENT | Non | — | Clé primaire |
| `request_id` | VARCHAR(36) | Non | — | FK → `requests.id` |
| `socket_id` | VARCHAR(255) | Non | — | Socket.IO ID du votant |
| `vote_type` | ENUM('up','down') | Non | — | Direction du vote |
| `created_at` | DATETIME | Non | NOW() | Date du vote |

**Contrainte :** `UNIQUE(request_id, socket_id)` — un vote par invité par chanson  
**Comportement :** voter deux fois dans le même sens annule le vote ; voter dans le sens opposé change le vote.

---

### Table `rate_limits`

Rate limiting par invité (identifié par `clientId` persistant).

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `socket_id` | VARCHAR(255) | Non | — | `clientId` persistant (localStorage), PK |
| `request_count` | INT | Non | 0 | Nombre de demandes dans la fenêtre |
| `reset_at` | BIGINT | Non | — | Timestamp (ms) de réinitialisation |
| `updated_at` | DATETIME | Non | NOW() | Dernière mise à jour |

> **Note :** le nom de colonne `socket_id` est un vestige historique — il contient désormais le `clientId` persistant.

**Nettoyage :** `cleanupExpired()` supprime les entrées expirées depuis plus d'1h (appelé toutes les heures via `setInterval` dans `server.js`, en même temps que la purge des bans expirés).

---

### Table `abuse_scores`

Score anti-abus par invité et par soirée (throttle progressif côté socket).

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `event_id` | VARCHAR(36) | Non | — | ID de soirée (indexé) |
| `client_id` | VARCHAR(255) | Non | — | Identifiant persistant invité |
| `score` | DECIMAL(8,2) | Non | 0 | Score de risque cumulé |
| `throttle_until` | BIGINT | Oui | NULL | Timestamp ms de fin de throttle |
| `updated_at` | DATETIME | Non | CURRENT_TIMESTAMP | Dernière mise à jour |

**Contrainte :** `PRIMARY KEY(event_id, client_id)`  
**Note prod :** la migration principale ne force pas de FK pour éviter les erreurs `#1005` en mutualisé.

---

### Table `track_audio_cache`

Cache local des métadonnées audio Spotify (analytics + projection BPM sync).

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `track_id` | VARCHAR(64) | Non | — | ID Spotify de la piste (PK) |
| `bpm` | INT | Oui | NULL | Tempo estimé |
| `energy` | DECIMAL(5,2) | Oui | NULL | Énergie (audio-features ou fallback popularité) |
| `popularity` | INT | Oui | NULL | Popularité Spotify (fallback) |
| `updated_at` | DATETIME | Non | CURRENT_TIMESTAMP | Dernière mise à jour |

---

### Table `spotify_tokens`

Tokens Spotify par événement (pour la lecture musicale).

| Colonne | Type | Null | Défaut | Description |
|---------|------|------|--------|-------------|
| `event_id` | VARCHAR(36) | Non | — | FK → `events.id`, PK |
| `access_token` | TEXT | Non | — | Token d'accès Spotify |
| `refresh_token` | TEXT | Oui | NULL | Token de rafraîchissement |
| `expires_at` | BIGINT | Non | — | Timestamp expiration (ms) |

**FK :** `spotify_tokens.event_id → events.id`  
**Refresh automatique :** géré par `spotifyToken.service.js` avec une marge de 5 minutes avant expiration.

---

## Vues SQL

### `event_history`

Vue pour l'historique des soirées terminées avec statistiques agrégées.

```sql
-- Colonnes retournées
event_id, event_name, dj_name, started_at, ended_at,
total_requests, played_count, rejected_count, pending_count, queue_count
```

### `request_stats`

Vue pour les statistiques détaillées par soirée.

---

## Requêtes fréquentes

```sql
-- Queue complète avec votes
SELECT r.*,
  COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
  COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes
FROM requests r
LEFT JOIN votes v ON r.id = v.request_id
WHERE r.event_id = ? AND r.status = 'accepted'
GROUP BY r.id
ORDER BY r.queue_position ASC;

-- Top 5 artistes d'un événement
SELECT artist, COUNT(*) AS total, SUM(status='played') AS played
FROM requests WHERE event_id = ?
GROUP BY artist ORDER BY total DESC LIMIT 5;

-- Vérification de doublon
SELECT id FROM requests
WHERE event_id = ? AND spotify_uri = ? AND status IN ('pending','accepted');
```

---

## Migrations

Appliquer dans cet ordre sur une base existante (schéma `db/db.sql`) :

| Ordre | Fichier | Description |
|-------|---------|-------------|
| 1 | `migration_spotify_auth.sql` | Ajoute `spotify_id`, `spotify_avatar` sur `djs` ; rend `email`/`password` nullable |
| 2 | `migration_spotify_tokens_dj.sql` | Ajoute `sp_access_token`, `sp_refresh_token`, `sp_token_expires_at` sur `djs` |
| 3 | `migration_fallback_playlist.sql` | Ajoute `fallback_playlist_uri` sur `events` |
| 4 | `migration_donation.sql` | Ajoute les 5 colonnes de dons sur `events` |
| 5 | `migration_user_bans.sql` | Crée la table `user_bans` (système de blocage) |
| 6 | `migration_request_client_id.sql` | Ajoute `client_id` sur `requests` (ban + rate limit persistant) |
| 7 | `migration_mod_token.sql` | Ajoute `mod_token` sur `events` (modération déléguée) |
| 8 | `migration_starts_at.sql` | Ajoute `starts_at` sur `events` (planification) |
| 9 | `migration_repeat_cooldown.sql` | Ajoute `repeat_cooldown_minutes` sur `events` (anti-répétition) |
| 10 | `migration_projection_visuals.sql` | Ajoute `projection_visuals_enabled` + `projection_visuals_mode` |
| 11 | `migration_projection_visuals_auto.sql` | Ajoute `projection_visuals_auto_per_track` |
| 12 | `migration_abuse_and_analytics.sql` | Crée `abuse_scores`, `track_audio_cache`, ajoute `play_started_at` + `skipped_at` |

```bash
# Appliquer toutes les migrations
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_spotify_auth.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_spotify_tokens_dj.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_fallback_playlist.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_donation.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_user_bans.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_request_client_id.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_mod_token.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_starts_at.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_repeat_cooldown.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_projection_visuals.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_projection_visuals_auto.sql
mysql -h 127.0.0.1 -u djuser -p dj_queue < db/migration_abuse_and_analytics.sql
```

> **Note :** sur o2switch ou tout serveur distant, utiliser `-h <host>` et le bon utilisateur MySQL.

### Erreur `#150` sur `migration_user_bans.sql` (clé étrangère)

MySQL exige que `user_bans.event_id` et `events.id` aient le **même charset et la même collation**, et que `events` soit en **InnoDB**.

1. `SHOW CREATE TABLE events\G` — noter `ENGINE` et le `COLLATE` de la colonne `id`.
2. Si le collationnement est `utf8mb4_unicode_ci` (fréquent sur MariaDB / mutualisé), appliquer **`db/migration_user_bans_o2switch_unicode.sql`** au lieu du fichier standard (ou après `DROP TABLE IF EXISTS user_bans` si la table vide a été créée).
3. Si `events` est encore en **MyISAM**, convertir d’abord : `ALTER TABLE events ENGINE=InnoDB;` (vérifier les contraintes existantes).
4. En dernier recours : **`db/migration_user_bans_no_fk.sql`** (pas de `FOREIGN KEY`, index sur `event_id` conservé).

### Erreur `#150` sur `abuse_scores` (clé étrangère)

Même cause (charset/collation/engine non alignés avec `events.id`).

- Migration recommandée en production mutualisée : **`db/migration_abuse_and_analytics.sql`** (sans FK, avec index `event_id`).
- Si tu veux absolument la FK, utiliser la variante alignée :
  - `db/migration_abuse_scores_fk_mysql8.sql` (`utf8mb4_0900_ai_ci`)
  - `db/migration_abuse_scores_fk_unicode.sql` (`utf8mb4_unicode_ci`)

---

## Démarrage local avec Docker

```bash
cd db
docker-compose up -d
```

Le `docker-compose.yml` lance :
- **MySQL 8** sur le port 3306 (user: `djuser`, password: `djpassword`, base: `dj_queue`)
- **Redis 7** sur le port 6379

Le fichier `db/init.sql` est monté comme script d'initialisation MySQL.

---

## Schéma relationnel

```
djs ─────────────────────────────── events
 │ id (PK)                           │ id (PK, UUID)
 │ spotify_id (UNIQUE)               │ dj_id (FK → djs.id)
 │ sp_access_token                   │ name
 │ sp_refresh_token                  │ ...settings...
 │ sp_token_expires_at               │ mod_token (NULL = pas de modérateur)
 └─────────────────────────────────>─┘
                                     │
          ┌──────────────────────────┼──────────────────────────────┐
          │                          │                              │
     requests                  spotify_tokens                  rate_limits
      │ id (PK)                 │ event_id (FK, PK)           │ socket_id (PK = clientId)
      │ event_id (FK)           │ access_token                │ request_count
      │ client_id               │ refresh_token               │ reset_at
      │ status                  │ expires_at
      │ spotify_uri
      │ queue_position
      │
      ├── votes                             user_bans
      │    │ id (PK)                         │ id (PK)
      │    │ request_id (FK → requests.id)   │ event_id (FK → events.id)
      │    │ socket_id                       │ client_id
      │    │ vote_type (up/down)             │ user_name
      │    └─ UNIQUE(request_id, socket_id)  │ banned_until (NULL = soirée entière)
      │                                      └─ UNIQUE(event_id, client_id)
```
