# Guide de déploiement

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 18.x |
| npm | 9.x |
| MySQL | 8.0 |
| Redis | 7.0 (production uniquement) |
| Git | 2.x |

---

## Installation locale (développement)

### 1. Cloner le projet

```bash
git clone https://github.com/ton-user/djrequest.git
cd djrequest
npm install
```

### 2. Configurer les variables d'environnement

```bash
cp env.example .env
```

Éditer `.env` (voir [Variables d'environnement](#variables-denvironnement) ci-dessous).

### 3. Démarrer la base de données avec Docker

```bash
cd db
docker-compose up -d
cd ..
```

> Ou utiliser un MySQL local/WAMP/MAMP.

### 4. Initialiser le schéma

```bash
# Schéma de base
mysql -u djuser -p dj_queue < db/db.sql

# Migrations (dans l'ordre — voir docs/database.md pour la liste complète)
mysql -u djuser -p dj_queue < db/migration_spotify_auth.sql
mysql -u djuser -p dj_queue < db/migration_spotify_tokens_dj.sql
mysql -u djuser -p dj_queue < db/migration_fallback_playlist.sql
mysql -u djuser -p dj_queue < db/migration_donation.sql
mysql -u djuser -p dj_queue < db/migration_user_bans.sql
mysql -u djuser -p dj_queue < db/migration_request_client_id.sql
mysql -u djuser -p dj_queue < db/migration_mod_token.sql
mysql -u djuser -p dj_queue < db/migration_starts_at.sql
mysql -u djuser -p dj_queue < db/migration_repeat_cooldown.sql
```

### 5. Lancer en développement

```bash
npm run dev
# → nodemon src/server.js
# → http://localhost:3000
```

---

## Variables d'environnement

Copier `env.example` en `.env` à la racine du projet.

| Variable | Obligatoire | Exemple | Description |
|----------|------------|---------|-------------|
| `NODE_ENV` | Oui | `development` | `development` ou `production` |
| `PORT` | Non | `3000` | Port d'écoute (défaut : 3000) |
| `HOST` | Non | `0.0.0.0` | Interface d'écoute |
| `BASE_URL` | Production | `https://dj-queue.fullann.ch` | URL publique (pour QR codes) |
| `DB_HOST` | Oui | `localhost` | Hôte MySQL |
| `DB_PORT` | Non | `3306` | Port MySQL |
| `DB_USER` | Oui | `djuser` | Utilisateur MySQL |
| `DB_PASSWORD` | Oui | `...` | Mot de passe MySQL |
| `DB_NAME` | Oui | `dj_queue` | Nom de la base de données |
| `SESSION_SECRET` | Oui | `64-hex-chars` | Secret de signature des sessions (min 32 bytes) |
| `REDIS_HOST` | Production | `localhost` | Hôte Redis |
| `REDIS_PORT` | Production | `6379` | Port Redis |
| `REDIS_PASSWORD` | Non | — | Mot de passe Redis |
| `REDIS_SOCKET_PATH` | Non | `/path/to/redis.sock` | Socket Unix Redis (alternative host:port) |
| `SPOTIFY_CLIENT_ID` | Oui | `f7980d37...` | Client ID de l'app Spotify Developer |
| `SPOTIFY_CLIENT_SECRET` | Oui | `15b05eb2...` | Client Secret de l'app Spotify |
| `SPOTIFY_REDIRECT_URI` | Oui | `http://localhost:3000/callback` | URI de redirection OAuth (par événement) |
| `SPOTIFY_LOGIN_REDIRECT_URI` | Oui | `http://localhost:3000/auth/spotify/callback` | URI de redirection OAuth (login DJ) |

### Générer un SESSION_SECRET sécurisé

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Configuration Spotify Developer

1. Créer une app sur [developer.spotify.com](https://developer.spotify.com/dashboard)
2. Ajouter les **Redirect URIs** suivants :
   - `http://localhost:3000/callback` (développement)
   - `http://localhost:3000/auth/spotify/callback` (développement)
   - `https://ton-domaine.com/callback` (production)
   - `https://ton-domaine.com/auth/spotify/callback` (production)
3. Activer **Web Playback SDK** dans les paramètres
4. Le DJ doit avoir un compte **Spotify Premium** pour la lecture

---

## Déploiement en production — o2switch

### Architecture de production

```
Internet
    │
    ▼
Nginx (o2switch) ── proxy_pass ──> Node.js (Passenger / PM2)
    │                                   │
    │                               Express App
    │                                   │
    ▼                          ┌────────┴────────┐
CDN / Static               MySQL (o2switch)   Redis (o2switch)
```

### CI/CD avec GitHub Actions

Le déploiement est automatisé via `.github/workflows/deploy.yml` :

**Déclencheurs :**
- Push sur la branche `main`
- Déclenchement manuel (`workflow_dispatch`)

**Étapes :**
1. Checkout du code
2. Copie des fichiers vers `deploy-dist/` (exclut `.git`, `.github`, `node_modules`, `.env`)
3. Déploiement via **FTP-Deploy-Action** (protocole `ftps`)

**Secrets GitHub requis :**

| Secret | Description |
|--------|-------------|
| `SFTP_HOST` | Hôte FTP (ex: `ftp.o2switch.net`) |
| `SFTP_USER` | Identifiant FTP |
| `SFTP_PASSWORD` | Mot de passe FTP |
| `SFTP_PORT` | Port FTP (défaut : 21) |
| `SFTP_TARGET_DIR` | Répertoire cible sur le serveur |

> ⚠️ `dangerous-clean-slate: true` est activé — cela supprime les fichiers non présents localement sur le serveur à chaque déploiement.

### Configurer les secrets GitHub

```
GitHub → Settings → Secrets and variables → Actions → New repository secret
```

### Après le déploiement

Après le premier déploiement, il faut :

1. **Installer les dépendances** sur le serveur :
```bash
cd /chemin/app && npm install --production
```

2. **Créer `.env`** sur le serveur (ne jamais le committer) :
```bash
nano /chemin/app/.env
# Copier et remplir avec les valeurs de production
NODE_ENV=production
BASE_URL=https://ton-domaine.com
...
```

3. **Appliquer les migrations DB** :
```bash
mysql -u user -p db_name < migration_spotify_auth.sql
# etc.
```

4. **Redémarrer l'application** :
```bash
npm run start
# ou via le panneau cPanel > Node.js Applications > Restart
```

---

## Commandes utiles

```bash
# Développement (avec rechargement automatique)
npm run dev

# Production
npm run start
# → node --no-experimental-fetch app.js

# Vérifier les logs (si PM2)
pm2 logs dj-queue

# Redémarrer (si PM2)
pm2 restart dj-queue

# Vérifier le statut des connexions DB
mysql -u djuser -p -e "SHOW PROCESSLIST;"
```

---

## Mise à jour de la base de données sur Docker

```bash
# Se connecter au container MySQL
docker exec -it db_mysql_1 mysql -u djuser -pdjpassword dj_queue

# Ou exécuter un fichier SQL directement
docker exec -i db_mysql_1 mysql -u djuser -pdjpassword dj_queue < migration_donation.sql
```

---

## Vérification du déploiement

Après un déploiement, vérifier :

- [ ] `GET https://ton-domaine.com/` → page d'accueil s'affiche
- [ ] `GET https://ton-domaine.com/health` → `200` et `"status":"ok"` (ou `503` si DB/Redis en panne — à investiguer)
- [ ] `GET https://ton-domaine.com/login` → bouton Spotify visible
- [ ] Connexion via Spotify → redirection vers `/dashboard`
- [ ] Création d'une soirée → QR code généré
- [ ] Accès à `/user/:eventId` → page invité chargée
- [ ] WebSocket connecté (icône verte dans la console navigateur)
- [ ] Recherche Spotify fonctionnelle

### Monitoring externe

Configurer une sonde HTTP (UptimeRobot, Better Stack, etc.) sur **`GET /health`** toutes les 1–5 minutes. Alerter sur code **503** ou timeout.

---

## Résolution de problèmes courants

### 503 Service Unavailable

**Cause probable :** Le processus Node.js a crashé ou a été tué par les limites de ressources.

1. Vérifier les logs serveur
2. Vérifier que Redis est démarré (en production)
3. Vérifier que `NODE_ENV=production` est défini

**À éviter :** ne jamais utiliser `io.engine.use(sessionMiddleware)` — utiliser `io.use()` pour ne charger la session qu'une fois par connexion socket (pas sur chaque poll HTTP).

### WebSocket "reserved bits are on"

**Cause :** Le proxy Nginx ne supporte pas la compression WebSocket (`perMessageDeflate`).

**Fix (déjà appliqué dans `server.js`) :**
```javascript
const io = require("socket.io")(http, {
  perMessageDeflate: false,
});
```

### Token CSRF invalide

**Cause :** Session expirée ou cookie perdu.

**Fix :** Se déconnecter et se reconnecter. Vérifier que `SESSION_SECRET` est identique entre les redémarrages.

### Spotify "No active device"

**Cause :** Le Web Playback SDK n'est pas encore connecté à Spotify.

**Fix :** Attendre que le player se charge (barre de progression visible) avant de lancer la lecture. Le SDK a besoin d'un token valide et d'une connexion Spotify Premium active.

### Google Fonts bloqués (CSP)

**Cause :** La directive `style-src` ne contient pas `https://fonts.googleapis.com`.

**Fix (déjà appliqué dans `security.js`) :**
```javascript
styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
fontSrc:  ["'self'", "data:", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
```
