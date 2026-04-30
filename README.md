# 🎵 DJ Queue App

Une application web temps réel permettant aux participants d'une soirée de proposer des musiques au DJ via QR code, avec système de votes et lecture automatique Spotify.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![License](https://img.shields.io/badge/license-MIT-orange.svg)

## ✨ Fonctionnalités

### 👥 Pour les Participants
- 📱 **Accès QR Code** : Scan et accès instantané sans compte
- 🔍 **Recherche Spotify** : Recherche de musiques en temps réel
- 📊 **Système de Votes** : Vote pour/contre les musiques proposées
- ⏱️ **Suivi Temps Réel** : Statut des demandes (en attente/accepté/refusé)
- 📜 **Historique de la soirée** : Liste des demandes déjà faites sur cet appareil
- 📈 **Onglet Tendances** : Top artistes et titres les plus demandés (`/api/events/:id/trends`)
- 📲 **PWA** : Manifest dynamique + service worker (`/manifest-user.json?e=…`, `/sw-user.js`) pour « Ajouter à l’écran d’accueil »
- 🎯 **Timer Prédictif** : Estimation du temps avant lecture
- 🎧 **Preview Audio** : Écoute d'extraits des morceaux

### 🎧 Pour les DJs
- 🎛️ **Dashboard Complet** : Vue d'ensemble des événements actifs
- 👤 **Page Profil** (`/profile`) : Nom d’affichage, stats globales, déconnexion Spotify
- ✅ **Gestion Queue** : Acceptation/refus des demandes
- ⚡ **Actions en masse** : Tout accepter / tout refuser les demandes en attente
- ↩️ **Annuler un refus** : Barre « Annuler » quelques secondes après un refus (socket `undo-reject-request`)
- 🔄 **Réorganisation** : Drag & drop pour modifier l'ordre
- 🔁 **Anti-répétition** : Délai configurable avant de reproposer un morceau déjà joué (`repeat_cooldown_minutes`, basé sur `played_at`)
- 📈 **Statistiques Live** : Nombre de demandes, votes, taux d'acceptation
- 🛡️ **Anti-abus intelligent** : Score par invité (spam/doublons/refus), throttle progressif et quota dynamique
- 📊 **Analytics live avancées** : Heatmap horaire, top tempos, taux de skip, engagement votes + export CSV
- 🎵 **Lecture Automatique** : Intégration Spotify Player
- 📊 **Historique Détaillé** : Stats complètes des événements passés
- 🖼️ **QR personnalisé** : SVG avec nom de soirée + logo optionnel (`src/public/images/qr-logo.png`)
- ⚙️ **Paramètres Avancés** : 
  - Auto-accept des demandes
  - Activation/désactivation des votes
  - Gestion des doublons
  - Rate limiting configurable
  - Visuels projection (dont mode `bpm-sync`)

## 🚀 Technologies

### Backend
- **Node.js** + **Express** : Serveur HTTP et API REST
- **Socket.IO** : Communication temps réel bidirectionnelle
- **MySQL** : Base de données relationnelle
- **Redis** : Session store (production)

### Sécurité
- **Helmet** : Protection contre les vulnérabilités web
- **Bcrypt** : Hachage sécurisé des mots de passe
- **Express Rate Limit** : Protection DDoS et brute force
- **Express Validator** : Validation des entrées
- **Sanitize HTML** : Protection XSS

### Intégrations
- **Spotify Web API** : Recherche et métadonnées
- **Spotify Web Playback SDK** : Lecture dans le navigateur
- **QRCode** : Génération de QR codes (SVG brandé : titre + logo optionnel)

## 📋 Prérequis

- Node.js >= 18.0.0
- MySQL >= 8.0
- Redis >= 6.0 (optionnel, recommandé en production)
- Compte Spotify Developer (pour API)

## 🛠️ Installation

### 1. Cloner le repository
```bash
git clone https://github.com/Fullann/dj-queue-app.git
cd dj-queue-app
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Configuration de la base de données
```bash
# Se connecter à MySQL
mysql -u root -p

# Créer la base de données
CREATE DATABASE dj_queue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'djuser'@'localhost' IDENTIFIED BY 'votre_mot_de_passe';
GRANT ALL PRIVILEGES ON dj_queue.* TO 'djuser'@'localhost';
FLUSH PRIVILEGES;

# Importer le schéma
mysql -u djuser -p dj_queue < db/db.sql
```

### 4. Configuration Spotify
1. Aller sur [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Créer une nouvelle application
3. Ajouter `http://localhost:3000/callback` aux Redirect URIs
4. Noter le Client ID et Client Secret

### 5. Variables d'environnement
```bash
cp .env.example .env
# Éditer .env avec vos valeurs
```

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=
PORT=3000

# Configuration MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=user
DB_PASSWORD=password
DB_NAME=

# Rate Limiting
RATE_LIMIT_MAX_REQUESTS=3
RATE_LIMIT_WINDOW_MINUTES=15

SESSION_SECRET=4ac8819610014adfe9fbdc35e1872ff5e7c5d33278d98a3d3402b459588256d3

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 6. Lancer l'application
```bash
# Développement (avec nodemon)
npm run dev

# Production
npm start
```

L'application sera accessible sur `http://localhost:3000`

## 📁 Structure du Projet

```
dj-queue-app/
├── src/
│   ├── config/          # Configuration (DB, Redis, Session)
│   ├── controllers/     # Logique métier
│   ├── middlewares/     # Auth, Sécurité, Validation
│   ├── routes/          # Routes API
│   ├── services/        # Services métier (Queue, RateLimit)
│   ├── sockets/         # Gestion WebSocket
│   ├── validators/      # Schémas de validation
│   ├── views/           # Pages HTML
│   ├── public/          # CSS, JS, SW PWA (`sw-user.js`)
│   └── server.js        # Point d'entrée
├── db/                  # Schéma + migrations SQL
├── .env                 # Variables d'environnement
├── .env.example         # Template .env
└── package.json
```

## 🔐 API Endpoints

### Authentification
```
GET    /api/auth/spotify/login   - OAuth Spotify (connexion DJ)
POST   /api/auth/logout          - Déconnexion session
GET    /api/auth/me              - Profil DJ connecté
PATCH  /api/auth/me              - Mettre à jour le nom d’affichage
GET    /api/auth/stats           - Stats globales (soirées, demandes)
POST   /api/auth/spotify/disconnect - Révoquer les jetons Spotify stockés (table djs)
```

### Événements
```
POST   /api/events                          - Créer événement
GET    /api/events/:eventId                 - Info événement (+ queue)
GET    /api/events/:eventId/trends          - Tendances publiques (top artistes / titres)
GET    /api/events/:eventId/guest-history/:clientId - Historique des demandes d’un invité
PATCH  /api/events/:eventId/settings       - Réglages (votes, anti-répétition…) — DJ propriétaire
GET    /api/events/:eventId/qrcode          - QR Code (data URL SVG brandé)
GET    /api/events/:eventId/stats           - Statistiques
GET    /api/events/:eventId/live-stats      - Stats live (propriétaire)
GET    /api/events/:eventId/live-stats.csv  - Export CSV des stats live (propriétaire)
POST   /api/events/:eventId/end             - Terminer événement
POST   /api/events/:eventId/toggle-votes    - Activer/désactiver votes
POST   /api/events/:eventId/toggle-duplicates - Autoriser doublons
POST   /api/events/:eventId/toggle-auto-accept - Auto-accept
```

### Monitoring & PWA (hors `/api`)
```
GET    /health                   - Santé app : { status, uptime, db, redis }
GET    /manifest-user.json?e=<UUID> - Manifest Web App (page invité)
GET    /sw-user.js               - Service worker minimal (enregistré par la page invité)
```

### Dashboard DJ
```
GET    /api/dj/dashboard                    - Events actifs + stats
GET    /api/dj/history                      - Events terminés
GET    /api/dj/:eventId/detailed-stats      - Stats détaillées
```

### Spotify
```
GET    /api/spotify/search                  - Recherche musiques
GET    /api/spotify/status/:eventId         - Statut connexion
GET    /api/spotify/login/:eventId          - URL auth Spotify
GET    /api/spotify/token/:eventId          - Token pour player
POST   /api/spotify/play/:eventId           - Lire musique
```

## 🔌 WebSocket Events

### Client → Server
```javascript
'join-event'             // Rejoindre un événement
'request-song'           // Demander une musique
'vote'                   // Voter (up/down)
'accept-request'         // (DJ) Accepter une demande
'reject-request'         // (DJ) Refuser une demande
'undo-reject-request'    // (DJ) Annuler un refus récent → repasse en pending
'accept-all-pending'     // (DJ) Accepter toutes les demandes en attente
'reject-all-pending'     // (DJ) Refuser toutes les demandes en attente
'reorder-queue'          // (DJ) Réorganiser queue
'mark-played'            // (DJ) Marquer comme jouée
'mark-skipped'           // (DJ) Marquer un skip (next avant ~85%)
'update-event-settings'  // (DJ) Incl. repeatCooldownMinutes (anti-répétition)
```

### Server → Client
```javascript
'queue-updated'               // Queue mise à jour
'new-request'               // Nouvelle demande (ou retour pending après undo)
'request-accepted'          // Demande acceptée
'request-rejected'          // Demande refusée
'reject-undone'             // Refus annulé côté room
'your-request-pending-again'// Invité : sa demande est à nouveau en attente
'request-error'             // Erreur demande (incl. repeat-cooldown / abuse-throttle)
'vote-updated'              // Votes mis à jour
'event-ended'               // Événement terminé
```

## 🎨 Interface Utilisateur

### Pages Publiques
- `/login` - Connexion DJ
- `/register` - Inscription DJ
- `/user/:eventId` - Interface participant (scan QR)
- `/thank-you` - Page de fin d'événement

### Pages DJ (authentifiées)
- `/dashboard` - Liste événements actifs
- `/profile` - Profil DJ (nom, stats, Spotify)
- `/dj/:eventId` - Console DJ (gestion queue)
- `/event/:eventId/qr` - Affichage QR / grand écran (selon routes serveur)
- `/history` - Historique événements
- `/event/:eventId/stats` - Statistiques détaillées

## 🔒 Sécurité

- ✅ Hachage bcrypt avec 12 rounds
- ✅ Helmet avec CSP configuré
- ✅ Rate limiting multi-niveaux
- ✅ Sanitization des inputs
- ✅ Validation stricte des données
- ✅ Sessions sécurisées (httpOnly, sameSite)
- ✅ Protection CSRF (double-submit cookie + vérification serveur)
- ✅ Requêtes SQL préparées
- ✅ HTTPS obligatoire en production

## 📊 Rate Limiting

| Type | Limite | Fenêtre | Routes |
|------|--------|---------|--------|
| Global | 500 req | 15 min | Toutes (prod) — `GET /health` exclu |
| Auth | 10 req | 15 min | Login/Register |
| API | 60 req | 1 min | /api/* |
| User Requests | 3 req | 15 min | Demandes musique (configurable) |

## 🚀 Déploiement

### Avec Docker (recommandé)
```bash
# TODO: Créer docker-compose.yml
docker-compose up -d
```

### Manuel
1. Configurer MySQL + Redis sur le serveur
2. Cloner et installer dépendances
3. Configurer `.env` pour production
4. Build (si applicable)
5. Utiliser PM2 pour process management
```bash
npm install -g pm2
pm2 start src/server.js --name dj-queue
pm2 startup
pm2 save
```

### Déploiement automatique (GitHub Actions + o2switch FTPS)

Le workflow est fourni dans `.github/workflows/deploy-o2switch.yml`.

Il déploie automatiquement sur push `main` (et manuellement via `workflow_dispatch`) via FTPS.

#### 1) Secrets GitHub à créer

Dans `Settings > Secrets and variables > Actions`, ajoute:
- `SFTP_HOST` : hôte FTP/FTPS o2switch
- `SFTP_PORT` : port FTP/FTPS (souvent `21`)
- `SFTP_USER` : utilisateur FTP
- `SFTP_PASSWORD` : mot de passe FTP
- `SFTP_TARGET_DIR` : dossier cible (ex: `/www/`)

#### 2) Préparer le serveur o2switch

```bash
# Créer le .env en production (non versionné)
nano /chemin/vers/votre/app/.env

# Installer PM2 (si pas déjà fait)
npm install -g pm2
```

#### 3) Premier lancement PM2 (une seule fois)

```bash
cd /chemin/vers/votre/app
npm ci --omit=dev
pm2 start src/server.js --name dj-queue
pm2 save
```

Ensuite, chaque push sur `main` déclenche le déploiement automatique.

### Variables d'environnement Production
- `NODE_ENV=production`
- `BASE_URL=https://votre-domaine.com`
- Cookie `secure: true` automatique
- Redis obligatoire
- HTTPS requis

### Monitoring
- Sonde HTTP recommandée : `GET https://votre-domaine.com/health`
- Réponse typique : `{ "status": "ok", "uptime": 12345, "db": "ok", "redis": "ok" | "skipped" }`
- Code **503** si MySQL ou Redis (production) est en erreur

## 🧪 Tests

```bash
# TODO: Implémenter tests
npm test
```

## 📈 Roadmap

- [x] Endpoint `/health` pour monitoring externe (UptimeRobot, Better Stack…)
- [ ] Tests unitaires et intégration
- [ ] Docker Compose complet
- [ ] CI/CD avec GitHub Actions
- [ ] Monitoring avec Sentry
- [ ] Analytics événements
- [x] Analytics live avancées + export CSV
- [ ] Mode playlist automatique
- [ ] Support multi-langues
- [ ] Application mobile (React Native)
- [ ] Intégration YouTube Music
- [ ] Système de modération automatique
- [ ] Thèmes personnalisables

## 🤝 Contribution

Les contributions sont les bienvenues !

1. Fork le projet
2. Créer une branche (`git checkout -b feature/amazing-feature`)
3. Commit les changements (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing-feature`)
5. Ouvrir une Pull Request

## 📝 License

MIT License - voir [LICENSE](LICENSE)

## 👨‍💻 Auteur

Créé pour gérer les demandes musicales lors des soirées de la société de gym.

## 🙏 Remerciements

- Spotify Web API
- Socket.IO
- Express.js
- Toute la communauté open source

---

⭐ Si ce projet t'aide, n'hésite pas à lui donner une étoile sur GitHub !