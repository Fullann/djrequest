# Guide fonctionnel

Description complète de toutes les fonctionnalités de DJ Queue.

---

## Pages et interfaces

| Page | URL | Public | Description |
|------|-----|--------|-------------|
| Accueil | `/` | Oui | Présentation + lien connexion Spotify |
| Connexion DJ | `/login` | Oui | Bouton "Se connecter avec Spotify" |
| Dashboard | `/dashboard` | DJ | Gestion des soirées actives |
| Profil DJ | `/profile` | DJ | Nom affiché, stats globales, déconnexion Spotify |
| Interface DJ | `/dj/:eventId` | DJ | Contrôle temps réel de la soirée |
| Interface modérateur | `/mod/:eventId?token=...` | Modérateur (lien) | Gestion des demandes déléguée |
| Page invité | `/user/:eventId` | Invité | Proposer des chansons, voter |
| Écran grand format | `/event/:eventId/qr` | Public | Affichage TV/projecteur |
| Statistiques | `/event/:eventId/stats` | DJ | Stats live et post-événement |
| Historique | `/history` | DJ | Soirées terminées |
| Erreur | `/error?code=...` | Tous | Page d'erreur branded |

---

## Dashboard DJ

**URL :** `/dashboard`

### Fonctionnalités

- **Liste des soirées actives** : nom, date, nombre de demandes, demandes en attente
- **Création d'une soirée** : saisir un nom → génération automatique du **QR brandé** (nom de la soirée sur l’image ; logo optionnel : fichier `src/public/images/qr-logo.png`) et des liens
- **Accès rapide** : boutons "Ouvrir DJ", "QR Code", "Stats" pour chaque soirée
- **Lien invité** : URL à partager ou QR code à projeter
- **Fin de soirée** : bouton "Terminer" qui clôt la soirée et notifie les invités
- **Mise à jour en temps réel** : une nouvelle soirée apparaît immédiatement sans rafraîchissement
- **Lien Profil** : accès à `/profile` depuis la barre latérale (desktop) et le menu mobile

---

## Profil DJ

**URL :** `/profile`

- Modifier le **nom d’affiché** (`PATCH /api/auth/me`)
- Voir des **statistiques globales** : nombre de soirées, soirées encore actives, total de demandes (`GET /api/auth/stats`)
- **Déconnecter Spotify** : efface les jetons sur la ligne `djs` (`POST /api/auth/spotify/disconnect`) — les soirées en cours peuvent nécessiter une nouvelle liaison Spotify pour la lecture
- **Déconnexion session** : comme sur le dashboard

---

## Interface DJ

**URL :** `/dj/:eventId`

### Queue de lecture

La queue affiche les chansons acceptées dans leur ordre de lecture. Chaque carte contient :
- Pochette, titre, artiste
- Métadonnées musicales : BPM (ou popularité si BPM indisponible), tonalité, énergie
- Durée formatée
- Bouton **Play** (lecture immédiate)
- Bouton **Preview** (écoute 30s sur sortie séparée, voir [Preview](#preview-30-secondes))
- Poignée de drag & drop pour réorganiser l'ordre

### Trier la queue

Bouton "Trier" : trie les chansons acceptées par BPM décroissant (ou popularité si BPM non disponible), facilitant les transitions harmonieuses.

### Demandes en attente

Liste des demandes `pending` avec :
- Infos chanson + invité
- Boutons **Accepter** / **Refuser**
- **Tout accepter** / **Tout refuser** : traite toutes les demandes en attente d’un coup (socket `accept-all-pending` / `reject-all-pending`)
- Après un **refus unitaire**, une barre **Annuler** permet de remettre la demande en `pending` pendant quelques secondes (`undo-reject-request`)
- Bouton **Preview** (écouter avant de décider)
- Votes (upvotes / downvotes) si les votes sont activés

### Crossfade automatique

Lorsque `crossfadeEnabled` est actif dans les réglages :
- 20 secondes avant la fin de la chanson en cours, la suivante commence à monter progressivement
- Le volume de la chanson en cours descend de 100% à 0% en 15 secondes
- La chanson suivante monte de 0% à 100% en 15 secondes
- Implémenté via l'API `setVolume()` du Spotify Web Playback SDK

### Playlist de secours

Configuration d'une playlist Spotify à jouer automatiquement quand la queue est vide :
- Coller l'URI Spotify de la playlist (`spotify:playlist:...`)
- Une chanson aléatoire est choisie dans la playlist
- S'active aussi au chargement de la page si la queue est vide
- Drapeaux `isFallbackFetching` et `isAutoPlayLocked` empêchent les lectures multiples simultanées

### Panneau de réglages

Accessible via le bouton "Réglages" (icône engrenage) :

| Réglage | Type | Description |
|---------|------|-------------|
| Votes invités | Toggle | Activer/désactiver le système de vote |
| Acceptation auto | Toggle | Accepter automatiquement toutes les demandes |
| Chansons en double | Toggle | Autoriser la même chanson plusieurs fois |
| Max demandes / invité | Nombre | Nombre max de demandes par fenêtre |
| Fenêtre (minutes) | Nombre | Durée de la fenêtre de rate limit |
| Anti-répétition (minutes) | Nombre | Délai minimum avant de reproposer un morceau déjà **joué** (0 = désactivé). Basé sur `played_at` + même `spotify_uri`. |
| Playlist de secours | Texte | URI de la playlist Spotify de secours |
| Crossfade | Toggle | Activer le fondu enchaîné |
| Système de dons | Section | Voir [Dons](#système-de-dons) |
| Lien modérateur | Section | Générer/révoquer un lien de modération déléguée |

### Message DJ → invités

Champ texte en haut de l'interface DJ pour envoyer un message instantané à tous les invités connectés :
- Apparaît comme une bannière animée sur les téléphones des invités
- Déclenche une vibration `[30, 20, 30]`
- Disparaît automatiquement après 8 secondes (ou fermeture manuelle)

### Statistiques live

Bouton "Stats" : ouvre `/event/:eventId/stats` qui affiche :
- KPIs en temps réel (total demandes, jouées, en attente, personnes connectées)
- Top 5 artistes les plus demandés
- Top 5 chansons les plus demandées
- Chanson la plus votée en attente
- Timeline des demandes par tranche de 15 minutes

---

## Preview 30 secondes

**Fonctionnalité DJ uniquement**

Permet au DJ d'écouter un extrait 30s d'une chanson sur une **sortie audio séparée** avant de l'accepter ou de la jouer.

### Utilisation

1. Cliquer sur l'icône casque 🎧 sur une carte (demande en attente ou queue)
2. Un mini-player apparaît en bas de l'écran avec :
   - Pochette + titre + artiste
   - Barre de progression
   - Bouton Play/Pause
   - Sélecteur de sortie audio (utilise l'API `setSinkId()`)
3. Sélectionner la sortie audio souhaitée (ex: casque DJ vs enceintes salle)

### Prérequis

- La piste doit avoir une `preview_url` (30s Spotify). Certains titres n'en ont pas.
- `setSinkId()` nécessite le flag `audiooutput` dans les permissions du navigateur.

---

## Interface invité (mobile-first)

**URL :** `/user/:eventId`

Conçue pour une utilisation sur smartphone.

### Recherche et proposition

1. Saisir un titre ou un artiste dans la barre de recherche
2. Les résultats Spotify s'affichent (pochette, titre, artiste, durée)
3. Appuyer sur une chanson → bottom sheet apparaît pour saisir son prénom
4. Si un don est requis → voir [Dons](#système-de-dons) d'abord
5. Appuyer sur "Proposer" → confirmation affichée

### Statut de la demande

Après proposition, la carte "Mon statut" affiche en temps réel :
- ⏳ **En attente** : la demande attend la validation du DJ
- ✅ **Acceptée** : position dans la queue
- ❌ **Refusée**
- 🎵 **En lecture** : la chanson est jouée !

Si le DJ **annule** un refus rapidement, l’invité repasse en **En attente** (événement socket `your-request-pending-again`).

### Onglet Tendances

- **Top artistes** et **top titres** les plus demandés sur la soirée (données `GET /api/events/:eventId/trends`)
- Pas besoin d’être connecté en tant que DJ

### Historique des demandes

Bloc **« Tes demandes ce soir »** : liste des dernières propositions de **cet appareil** (`clientId` persistant), avec statut (en attente, acceptée, refusée, jouée). Alimenté par `GET /api/events/:eventId/guest-history/:clientId`.

### PWA (Ajouter à l’écran d’accueil)

- Lien manifest injecté : `/manifest-user.json?e=<eventId>`
- Enregistrement du service worker `/sw-user.js` (cache minimal, installation)
- Métas `apple-mobile-web-app-*` déjà présentes pour iOS

### Notifications

À chaque changement de statut :
- **Vibration** du téléphone (`navigator.vibrate`)
- **Titre de la page** clignote (`document.title` alterne entre le statut et "DJ Queue")
- **Notification système** (si permission accordée)

### Indicateur de rate limit

Jauge visuelle en bas de la page affichant :
- Nombre de demandes restantes dans la fenêtre
- Temps avant réinitialisation (si limite atteinte)
- Barre de progression colorée (vert → orange → rouge)

### Musique en cours

Bande "En cours" fixée sous le header, affichant :
- Pochette de l'album
- Titre + artiste
- Barre de progression animée (interpolée en temps réel)

### Votes

Si les votes sont activés, les invités voient la queue et peuvent voter ↑ ou ↓ pour influencer l'ordre de lecture.

### Reconnexion transparente

Si la connexion réseau est coupée, à la reconnexion :
- `join-event` est ré-émis automatiquement
- `resyncState()` recharge l'état complet depuis l'API (`/api/events/:eventId` + `/api/events/:eventId/pending`)

---

## Système de dons

Le DJ peut activer un système de dons pour demander une contribution financière aux invités avant qu'ils puissent proposer des chansons.

### Configuration DJ (panneau réglages)

| Paramètre | Description |
|-----------|-------------|
| Activer les dons | Affiche la bannière/modal de don |
| Don obligatoire | Bloque les demandes tant que le don n'est pas confirmé |
| Montant suggéré | Montant affiché (0.50€ à 50.00€) |
| Lien de paiement | URL HTTPS (PayPal, Lydia, Sumeria, etc.) |
| Message personnalisé | Texte affiché aux invités (ex: "Aidez-moi à couvrir mes frais !") |

### Expérience invité

**Don optionnel :**
- Bannière en bas de l'écran avec le message, le montant et un bouton "Payer"
- L'invité peut fermer la bannière et proposer quand même

**Don obligatoire :**
- Modal plein écran bloquant
- Bouton "Payer maintenant" ouvre le lien de paiement dans un nouvel onglet
- Après 15 secondes, un bouton "J'ai payé" apparaît
- Cliquer "J'ai payé" confirme le don et débloque les propositions
- La confirmation est sauvegardée en `sessionStorage` (dure jusqu'à fermeture de l'onglet)

### Sécurité

Le don est déclaratif côté client — il n'y a pas de vérification automatique du paiement. Le système repose sur la bonne foi des invités et le lien vers un service de paiement externe.

---

## Écran grand format (QR Display)

**URL :** `/event/:eventId/qr`

Conçu pour être projeté sur un écran TV ou vidéoprojecteur.

### Informations affichées

- **Chanson en cours** : grande pochette, titre, artiste, barre de progression
- **File d'attente** : prochaines chansons (jusqu'à 5)
- **Chansons récemment jouées**

### Actualisation

L'écran se rafraîchit automatiquement toutes les 10 secondes via l'API `/api/events/:eventId/display-data`. Pas de Socket.IO pour simplifier (la page est prévue pour un usage passif).

---

## Statistiques

**URL :** `/event/:eventId/stats`

### En cours de soirée (statistiques live)

- Nombre de personnes ayant scanné le QR / connectées
- Total des demandes, jouées, refusées, en attente
- Top artistes demandés + taux de lecture
- Top chansons + pochette
- Chanson la plus votée encore en attente
- Timeline des demandes par tranche de 15 min (pic d'activité)

### Après la soirée (statistiques post-événement)

Mêmes données mais sans les indicateurs live (connexions actives, demandes en attente).

---

## Thème dark / light

Un bouton dans le header de toutes les pages permet de basculer entre le mode sombre (défaut) et le mode clair.

Le choix est persisté dans `localStorage` et appliqué immédiatement via des classes CSS (`dark` / `light` sur `document.body`).

Implémenté dans `src/public/js/theme.js`, chargé sur toutes les pages.

---

## Page d'erreur branded

**URL :** `/error?code=404&title=...&message=...`

La page affiche un message d'erreur personnalisé basé sur les paramètres URL :

| Paramètre | Exemple | Description |
|-----------|---------|-------------|
| `code` | `404` | Code HTTP à afficher |
| `title` | `Soirée introuvable` | Titre de l'erreur |
| `message` | `Cette soirée n'existe pas.` | Description |

Des boutons contextuels apparaissent selon le code :
- `404` → "Retour à l'accueil"
- `403` → "Se connecter"
- `ended` → "Voir les statistiques"

---

## Système de modération déléguée

**URL :** `/mod/:eventId?token=...`

Le DJ peut déléguer une partie de la gestion de la soirée à un ou plusieurs modérateurs (ami, assistant, manager) sans leur donner accès à son compte Spotify.

### Générer un lien modérateur (DJ)

Dans le panneau de réglages, section "Lien modérateur" :
1. Cliquer sur **"Générer un lien modérateur"** → un token unique (64 car. hex) est stocké dans `events.mod_token`
2. Le lien complet est affiché et copiable
3. Le DJ peut **révoquer** le lien à tout moment (le token est effacé, les sessions mod actives perdent l'accès à la prochaine action)

### Connexion du modérateur

Le modérateur ouvre le lien partagé. Le serveur :
1. Vérifie que `mod_token` correspond à l'événement en cours (non terminé)
2. Crée une session `req.session.modAccess = { eventId, eventName }`
3. Sert la page `mod.html`

À partir de ce moment, le modérateur est authentifié pour cet événement uniquement, sans compte Spotify.

### Ce que le modérateur peut faire

| Action | Disponible |
|--------|-----------|
| Accepter / refuser les demandes | ✅ |
| Réorganiser la queue (drag & drop) | ✅ |
| Bloquer / débloquer un invité | ✅ |
| Envoyer un message aux invités | ✅ |
| Modifier votes, auto-accept, doublons, rate limit | ✅ |

### Ce que le modérateur ne peut pas faire

| Action | Raison |
|--------|--------|
| Lancer / contrôler la musique Spotify | Nécessite un compte Premium Spotify |
| Terminer la soirée | Action irréversible, réservée au DJ |
| Configurer les dons | Paramètre financier, réservé au DJ |
| Modifier la playlist de secours | Nécessite l'accès Spotify |
| Générer un autre lien modérateur | Réservé au DJ |

### Sécurité

- Le token est un `crypto.randomBytes(32).toString("hex")` (256 bits d'entropie)
- Stocké en clair en base mais invalide dès révocation ou fin de soirée
- La session modérateur est indépendante de la session DJ (pas de `djId`)
- Les handlers Socket.IO vérifient la session via `verifyEventAccess()` qui accepte DJ **ou** modérateur

---

## CI/CD et déploiement automatique

Tout push sur `main` déclenche automatiquement :
1. Archivage du code (sans `.git`, `node_modules`, `.env`)
2. Upload FTP sécurisé (FTPS) vers o2switch
3. L'app est mise à jour en production

Voir [deployment.md](./deployment.md) pour les détails.
