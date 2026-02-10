require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3000;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

// Stockage en mémoire
const events = {};
const requests = {};
const spotifyTokens = {}; // Stocke les tokens par eventId

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());

// ========== Routes de base ==========

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/create-event.html');
});

app.post('/api/events', async (req, res) => {
  const eventId = uuidv4();
  const { name } = req.body;

  events[eventId] = {
    id: eventId,
    name: name || 'Soirée Gym',
    createdAt: new Date(),
    queue: []
  };

  const userUrl = `http://localhost:${PORT}/user/${eventId}`;
  const qrCodeDataUrl = await QRCode.toDataURL(userUrl);

  res.json({ 
    eventId, 
    qrCode: qrCodeDataUrl,
    djUrl: `http://localhost:${PORT}/dj/${eventId}`,
    userUrl 
  });
});

app.get('/user/:eventId', (req, res) => {
  const { eventId } = req.params;
  if (!events[eventId]) {
    return res.status(404).send('Événement non trouvé');
  }
  res.sendFile(__dirname + '/views/user.html');
});

app.get('/dj/:eventId', (req, res) => {
  const { eventId } = req.params;
  if (!events[eventId]) {
    return res.status(404).send('Événement non trouvé');
  }
  res.sendFile(__dirname + '/views/dj.html');
});

app.get('/api/events/:eventId', (req, res) => {
  const event = events[req.params.eventId];
  if (!event) {
    return res.status(404).json({ error: 'Événement non trouvé' });
  }
  res.json(event);
});

// ========== Spotify Authentication ==========

// Connexion Spotify pour le DJ
app.get('/api/spotify/login/:eventId', (req, res) => {
  const { eventId } = req.params;
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'streaming',
    'user-read-email',
    'user-read-private'
  ];

  const state = eventId; // On utilise l'eventId comme state

  const authUrl = 'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_CLIENT_ID,
      scope: scopes.join(' '),
      redirect_uri: SPOTIFY_REDIRECT_URI,
      state: state
    });

  res.json({ authUrl });
});

// Callback Spotify
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const eventId = req.query.state;

  if (!code || !eventId) {
    return res.status(400).send('Code ou eventId manquant');
  }

  try {
    // Échanger le code contre un access token
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    // Stocker les tokens
    spotifyTokens[eventId] = {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000)
    };

    // Rediriger vers l'interface DJ avec succès
    res.redirect(`/dj/${eventId}?spotify=connected`);

  } catch (error) {
    console.error('Erreur lors de l authentification Spotify:', error.response?.data || error.message);
    res.status(500).send('Erreur lors de l authentification Spotify');
  }
});

// Vérifier si Spotify est connecté pour un événement
app.get('/api/spotify/status/:eventId', (req, res) => {
  const { eventId } = req.params;
  const token = spotifyTokens[eventId];

  if (token && token.expires_at > Date.now()) {
    res.json({ connected: true });
  } else {
    res.json({ connected: false });
  }
});

// Obtenir le token Spotify (pour le Web Playback SDK)
app.get('/api/spotify/token/:eventId', (req, res) => {
  const { eventId } = req.params;
  const token = spotifyTokens[eventId];

  if (!token || token.expires_at <= Date.now()) {
    return res.status(401).json({ error: 'Token expiré ou non disponible' });
  }

  res.json({ access_token: token.access_token });
});

// ========== Spotify API - Recherche ==========

app.get('/api/spotify/search', async (req, res) => {
  const { q, eventId } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Query manquante' });
  }

  // Utiliser le token de l'événement si disponible, sinon Client Credentials
  let accessToken;

  if (eventId && spotifyTokens[eventId] && spotifyTokens[eventId].expires_at > Date.now()) {
    accessToken = spotifyTokens[eventId].access_token;
  } else {
    // Obtenir un token via Client Credentials Flow (recherche seulement)
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'client_credentials'
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
          }
        }
      );
      accessToken = response.data.access_token;
    } catch (error) {
      console.error('Erreur obtention token:', error.response?.data || error.message);
      return res.status(500).json({ error: 'Erreur d\'authentification Spotify' });
    }
  }

  try {
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      params: {
        q: q,
        type: 'track',
        limit: 10
      }
    });

    const tracks = response.data.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      image: track.album.images[2]?.url || track.album.images[0]?.url,
      uri: track.uri,
      duration_ms: track.duration_ms,
      preview_url: track.preview_url
    }));

    res.json({ tracks });

  } catch (error) {
    console.error('Erreur recherche Spotify:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erreur lors de la recherche' });
  }
});

// ========== Spotify Playback Control ==========

// Jouer une chanson
app.post('/api/spotify/play/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const { uri, device_id } = req.body;

  const token = spotifyTokens[eventId];

  if (!token || token.expires_at <= Date.now()) {
    return res.status(401).json({ error: 'Token expiré' });
  }

  try {
    await axios.put(
      `https://api.spotify.com/v1/me/player/play${device_id ? '?device_id=' + device_id : ''}`,
      {
        uris: [uri]
      },
      {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Erreur lecture Spotify:', error.response?.data || error.message);
    res.status(500).json({ error: 'Erreur lors de la lecture' });
  }
});

// ========== WebSocket ==========

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);

  socket.on('join-event', (eventId) => {
    socket.join(eventId);
    console.log(`Socket ${socket.id} a rejoint l'événement ${eventId}`);
  });

  socket.on('request-song', (data) => {
    const { eventId, songData, userName } = data;

    if (!events[eventId]) {
      socket.emit('error', 'Événement non trouvé');
      return;
    }

    const requestId = uuidv4();
    const request = {
      id: requestId,
      songName: songData.name,
      artist: songData.artist,
      album: songData.album,
      image: songData.image,
      uri: songData.uri,
      duration_ms: songData.duration_ms,
      userName: userName || 'Anonyme',
      status: 'pending',
      createdAt: new Date(),
      socketId: socket.id
    };

    requests[requestId] = request;
    io.to(eventId).emit('new-request', request);
    socket.emit('request-created', { requestId });
  });

  socket.on('accept-request', (data) => {
    const { eventId, requestId } = data;
    const request = requests[requestId];

    if (!request || !events[eventId]) return;

    request.status = 'accepted';
    events[eventId].queue.push(request);

    io.to(eventId).emit('request-accepted', { requestId, queue: events[eventId].queue });
    io.to(request.socketId).emit('your-request-accepted', { 
      requestId,
      position: events[eventId].queue.length 
    });
  });

  socket.on('reject-request', (data) => {
    const { eventId, requestId } = data;
    const request = requests[requestId];

    if (!request) return;

    request.status = 'rejected';
    io.to(eventId).emit('request-rejected', { requestId });
    io.to(request.socketId).emit('your-request-rejected', { requestId });
  });

  socket.on('reorder-queue', (data) => {
    const { eventId, newQueue } = data;
    if (!events[eventId]) return;
    events[eventId].queue = newQueue;
    io.to(eventId).emit('queue-updated', { queue: newQueue });
  });

  socket.on('mark-played', (data) => {
    const { eventId, requestId } = data;
    if (!events[eventId]) return;
    events[eventId].queue = events[eventId].queue.filter(r => r.id !== requestId);
    io.to(eventId).emit('queue-updated', { queue: events[eventId].queue });
  });

  socket.on('disconnect', () => {
    console.log('Client déconnecté:', socket.id);
  });
});

http.listen(PORT, () => {
  console.log(`🎵 Serveur démarré sur http://localhost:${PORT}`);
});