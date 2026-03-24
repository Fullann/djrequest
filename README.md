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
- 🎯 **Timer Prédictif** : Estimation du temps avant lecture
- 🎧 **Preview Audio** : Écoute d'extraits des morceaux

### 🎧 Pour les DJs
- 🎛️ **Dashboard Complet** : Vue d'ensemble des événements actifs
- ✅ **Gestion Queue** : Acceptation/refus des demandes
- 🔄 **Réorganisation** : Drag & drop pour modifier l'ordre
- 📈 **Statistiques Live** : Nombre de demandes, votes, taux d'acceptation
- 🎵 **Lecture Automatique** : Intégration Spotify Player
- 📊 **Historique Détaillé** : Stats complètes des événements passés
- ⚙️ **Paramètres Avancés** : 
  - Auto-accept des demandes
  - Activation/désactivation des votes
  - Gestion des doublons
  - Rate limiting configurable

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
- **QRCode** : Génération de QR codes dynamiques

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
│   └── server.js        # Point d'entrée
├── public/              # Assets statiques
├── .env                 # Variables d'environnement
├── .env.example         # Template .env
└── package.json
```

## 🔐 API Endpoints

### Authentification
```
POST   /api/auth/register      - Inscription DJ
POST   /api/auth/login         - Connexion DJ
POST   /api/auth/logout        - Déconnexion
GET    /api/auth/me            - Profil utilisateur
```

### Événements
```
POST   /api/events                          - Créer événement
GET    /api/events/:eventId                 - Info événement
GET    /api/events/:eventId/qrcode          - QR Code
GET    /api/events/:eventId/stats           - Statistiques
POST   /api/events/:eventId/end             - Terminer événement
POST   /api/events/:eventId/toggle-votes    - Activer/désactiver votes
POST   /api/events/:eventId/toggle-duplicates - Autoriser doublons
POST   /api/events/:eventId/toggle-auto-accept - Auto-accept
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
'join-event'        // Rejoindre un événement
'request-song'      // Demander une musique
'vote'              // Voter (up/down)
'accept-request'    // (DJ) Accepter demande
'reject-request'    // (DJ) Refuser demande
'reorder-queue'     // (DJ) Réorganiser queue
'mark-played'       // (DJ) Marquer comme jouée
```

### Server → Client
```javascript
'queue-updated'     // Queue mise à jour
'new-request'       // Nouvelle demande
'request-accepted'  // Demande acceptée
'request-rejected'  // Demande refusée
'vote-updated'      // Votes mis à jour
'event-ended'       // Événement terminé
```

## 🎨 Interface Utilisateur

### Pages Publiques
- `/login` - Connexion DJ
- `/register` - Inscription DJ
- `/user/:eventId` - Interface participant (scan QR)
- `/thank-you` - Page de fin d'événement

### Pages DJ (authentifiées)
- `/dashboard` - Liste événements actifs
- `/dj/:eventId` - Console DJ (gestion queue)
- `/qr-display/:eventId` - Affichage QR code
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
| Global | 500 req | 15 min | Toutes (prod) |
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

### Variables d'environnement Production
- `NODE_ENV=production`
- `BASE_URL=https://votre-domaine.com`
- Cookie `secure: true` automatique
- Redis obligatoire
- HTTPS requis

## 🧪 Tests

```bash
# TODO: Implémenter tests
npm test
```

## 📈 Roadmap

- [ ] Tests unitaires et intégration
- [ ] Docker Compose complet
- [ ] CI/CD avec GitHub Actions
- [ ] Monitoring avec Sentry
- [ ] Analytics événements
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