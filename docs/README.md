# Documentation — DJ Queue

Bienvenue dans la documentation complète du projet **DJ Queue**, une application web temps réel permettant aux invités d'une soirée de proposer des chansons à un DJ via leur smartphone.

---

## Table des matières

| Fichier | Description |
|---------|-------------|
| [architecture.md](./architecture.md) | Stack technique, structure du projet, cycle de vie d'une requête |
| [api.md](./api.md) | Référence complète des endpoints REST |
| [websockets.md](./websockets.md) | Événements Socket.IO (client ↔ serveur) |
| [database.md](./database.md) | Schéma de base de données, tables, relations, migrations |
| [deployment.md](./deployment.md) | Installation locale, variables d'environnement, déploiement o2switch |
| [security.md](./security.md) | CSRF, sessions, rate limiting, CSP, validation |
| [features.md](./features.md) | Guide fonctionnel complet (DJ, invités, preview, dons, stats…) |

---

## Présentation du projet

**DJ Queue** est une application Node.js/Express permettant :

- Aux **DJ** de créer et gérer des soirées, accepter/refuser des demandes, contrôler la lecture Spotify, voir des statistiques en temps réel.
- Aux **invités** de scanner un QR code, proposer des chansons Spotify, voter pour leurs préférées et être notifiés quand leur chanson est jouée.
- À la régie de bénéficier d’un **anti-abus intelligent** (score + throttle progressif), d’**analytics live avancées** (heatmap, tempos, skip, engagement, CSV) et d’une projection **BPM sync**.

### Flux principal

```
Invité scanne QR → ouvre /user/:eventId → cherche une chanson Spotify
     → propose → (optionnel : don) → DJ accepte/refuse
     → chanson ajoutée à la queue → jouée via Spotify Web Playback SDK
     → invité reçoit notification
```

### Accès rapide

| Rôle | URL |
|------|-----|
| Page d'accueil | `/` |
| Connexion DJ (Spotify) | `/login` |
| Dashboard DJ | `/dashboard` |
| Profil DJ | `/profile` |
| Interface DJ d'une soirée | `/dj/:eventId` |
| Page invité | `/user/:eventId` |
| Santé app (monitoring) | `GET /health` |
| Écran QR / grand écran | `/event/:eventId/qr` |
| Stats en direct | `/event/:eventId/stats` |

---

## Stack résumée

```
Frontend  : HTML5 + Tailwind CSS (CDN) + JavaScript vanilla
Backend   : Node.js 18+ / Express 4
Temps réel: Socket.IO 4
Auth      : Spotify OAuth 2.0 + express-session
DB        : MySQL 8 (mysql2)
Sessions  : Redis (connect-redis) en production
Lecture   : Spotify Web Playback SDK (Premium requis)
CI/CD     : GitHub Actions → FTP vers o2switch
```

---

## Démarrage rapide (développement)

```bash
# 1. Cloner et installer
git clone https://github.com/ton-user/djrequest.git
cd djrequest
npm install

# 2. Configurer l'environnement
cp env.example .env
# Éditer .env avec tes valeurs

# 3. Initialiser la base de données
mysql -u root -p < db/db.sql
mysql -u root -p dj_queue < db/migration_spotify_auth.sql
mysql -u root -p dj_queue < db/migration_spotify_tokens_dj.sql
mysql -u root -p dj_queue < db/migration_fallback_playlist.sql
mysql -u root -p dj_queue < db/migration_donation.sql
mysql -u root -p dj_queue < db/migration_user_bans.sql
mysql -u root -p dj_queue < db/migration_request_client_id.sql
mysql -u root -p dj_queue < db/migration_mod_token.sql
mysql -u root -p dj_queue < db/migration_starts_at.sql
mysql -u root -p dj_queue < db/migration_repeat_cooldown.sql
mysql -u root -p dj_queue < db/migration_projection_visuals.sql
mysql -u root -p dj_queue < db/migration_projection_visuals_auto.sql
mysql -u root -p dj_queue < db/migration_abuse_and_analytics.sql

# 4. Lancer en développement
npm run dev
```

> Voir [deployment.md](./deployment.md) pour les instructions complètes.
