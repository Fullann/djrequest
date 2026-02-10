require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

app.use(express.json());
app.use(express.static('public'));
app.use(cookieParser());

// ========== Fonctions utilitaires ==========

async function getRateLimitSettings(eventId) {
  const [rows] = await db.query(
    'SELECT rate_limit_max, rate_limit_window_minutes FROM events WHERE id = ?',
    [eventId]
  );
  return rows[0] || { rate_limit_max: 3, rate_limit_window_minutes: 15 };
}

async function checkRateLimit(socketId, eventId) {
  const settings = await getRateLimitSettings(eventId);
  const RATE_LIMIT_MAX_REQUESTS = settings.rate_limit_max;
  const RATE_LIMIT_WINDOW_MS = settings.rate_limit_window_minutes * 60 * 1000;

  const now = Date.now();

  const [rows] = await db.query(
    'SELECT * FROM rate_limits WHERE socket_id = ?',
    [socketId]
  );

  if (rows.length === 0) {
    await db.query(
      'INSERT INTO rate_limits (socket_id, request_count, reset_at) VALUES (?, 0, ?)',
      [socketId, now + RATE_LIMIT_WINDOW_MS]
    );
    return {
      allowed: true,
      count: 0,
      max: RATE_LIMIT_MAX_REQUESTS,
      remaining: RATE_LIMIT_MAX_REQUESTS
    };
  }

  const limit = rows[0];

  if (now >= limit.reset_at) {
    await db.query(
      'UPDATE rate_limits SET request_count = 0, reset_at = ? WHERE socket_id = ?',
      [now + RATE_LIMIT_WINDOW_MS, socketId]
    );
    return {
      allowed: true,
      count: 0,
      max: RATE_LIMIT_MAX_REQUESTS,
      remaining: RATE_LIMIT_MAX_REQUESTS
    };
  }

  if (limit.request_count >= RATE_LIMIT_MAX_REQUESTS) {
    const remainingTime = Math.ceil((limit.reset_at - now) / 1000 / 60);
    return {
      allowed: false,
      remainingTime,
      count: limit.request_count,
      max: RATE_LIMIT_MAX_REQUESTS
    };
  }

  return {
    allowed: true,
    count: limit.request_count,
    max: RATE_LIMIT_MAX_REQUESTS,
    remaining: RATE_LIMIT_MAX_REQUESTS - limit.request_count
  };
}

async function incrementRateLimit(socketId) {
  await db.query(
    'UPDATE rate_limits SET request_count = request_count + 1 WHERE socket_id = ?',
    [socketId]
  );
}

async function checkDuplicate(eventId, uri) {
  if (!uri) return { isDuplicate: false };

  const [rows] = await db.query(
    'SELECT * FROM requests WHERE event_id = ? AND spotify_uri = ? AND status IN ("pending", "accepted")',
    [eventId, uri]
  );

  if (rows.length > 0) {
    return {
      isDuplicate: true,
      location: rows[0].status === 'accepted' ? 'queue' : 'pending',
      song: rows[0]
    };
  }

  return { isDuplicate: false };
}

async function getRequestWithVotes(requestId) {
  const [rows] = await db.query(`
    SELECT r.*,
           COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
           COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes
    FROM requests r
    LEFT JOIN votes v ON r.id = v.request_id
    WHERE r.id = ?
    GROUP BY r.id
  `, [requestId]);

  return rows[0];
}

async function getQueueWithVotes(eventId) {
  const [rows] = await db.query(`
    SELECT r.*,
           COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
           COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes,
           (COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) -
            COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END)) as net_votes
    FROM requests r
    LEFT JOIN votes v ON r.id = v.request_id
    WHERE r.event_id = ? AND r.status = 'accepted'
    GROUP BY r.id
    ORDER BY r.queue_position ASC
  `, [eventId]);

  return rows;
}

// Nettoyer les rate limits expirés
setInterval(async () => {
  const now = Date.now();
  await db.query('DELETE FROM rate_limits WHERE reset_at < ?', [now - (60 * 60 * 1000)]);
}, 60 * 60 * 1000);

// ========== Routes de base ==========

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/create-event.html');
});

app.post('/api/events', async (req, res) => {
  const eventId = uuidv4();
  const { name } = req.body;

  await db.query(
    'INSERT INTO events (id, name, allow_duplicates, votes_enabled, auto_accept_enabled, rate_limit_max, rate_limit_window_minutes) VALUES (?, ?, FALSE, TRUE, FALSE, 3, 15)',
    [eventId, name || 'Soirée Gym']
  );

  const userUrl = `http://localhost:${PORT}/user/${eventId}`;
  const qrCodeDataUrl = await QRCode.toDataURL(userUrl);

  res.json({
    eventId,
    qrCode: qrCodeDataUrl,
    djUrl: `http://localhost:${PORT}/dj/${eventId}`,
    userUrl
  });
});

app.get('/user/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const [rows] = await db.query('SELECT * FROM events WHERE id = ?', [eventId]);

  if (rows.length === 0) {
    return res.status(404).send('Événement non trouvé');
  }
  res.sendFile(__dirname + '/views/user.html');
});

app.get('/dj/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const [rows] = await db.query('SELECT * FROM events WHERE id = ?', [eventId]);

  if (rows.length === 0) {
    return res.status(404).send('Événement non trouvé');
  }
  res.sendFile(__dirname + '/views/dj.html');
});

app.get('/api/events/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const [rows] = await db.query('SELECT * FROM events WHERE id = ?', [eventId]);

  if (rows.length === 0) {
    return res.status(404).json({ error: 'Événement non trouvé' });
  }

  const event = rows[0];
  const queue = await getQueueWithVotes(eventId);

  res.json({ ...event, queue });
});

// ========== Nouveaux contrôles DJ ==========

app.post('/api/events/:eventId/toggle-votes', async (req, res) => {
  const { eventId } = req.params;
  const { enabled } = req.body;

  await db.query('UPDATE events SET votes_enabled = ? WHERE id = ?', [enabled, eventId]);

  // Notifier tous les clients
  io.to(eventId).emit('event-settings-updated', { votesEnabled: enabled });

  res.json({ votesEnabled: enabled });
});

app.post('/api/events/:eventId/toggle-duplicates', async (req, res) => {
  const { eventId } = req.params;

  await db.query('UPDATE events SET allow_duplicates = NOT allow_duplicates WHERE id = ?', [eventId]);

  const [rows] = await db.query('SELECT allow_duplicates FROM events WHERE id = ?', [eventId]);

  res.json({ allow_duplicates: rows[0].allow_duplicates });
});

app.post('/api/events/:eventId/toggle-auto-accept', async (req, res) => {
  const { eventId } = req.params;
  const { enabled } = req.body;

  await db.query('UPDATE events SET auto_accept_enabled = ? WHERE id = ?', [enabled, eventId]);

  res.json({ autoAcceptEnabled: enabled });
});

app.post('/api/events/:eventId/update-rate-limit', async (req, res) => {
  const { eventId } = req.params;
  const { max, window } = req.body;

  if (max < 1 || max > 50 || window < 1 || window > 120) {
    return res.status(400).json({ error: 'Valeurs invalides' });
  }

  await db.query(
    'UPDATE events SET rate_limit_max = ?, rate_limit_window_minutes = ? WHERE id = ?',
    [max, window, eventId]
  );

  res.json({ success: true, max, window });
});

// ========== Statistiques ==========

app.get('/api/events/:eventId/stats', async (req, res) => {
  const { eventId } = req.params;

  const [stats] = await db.query(`
    SELECT
      COUNT(DISTINCT r.id) as total_requests,
      COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
      COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count,
      COUNT(DISTINCT CASE WHEN r.status = 'pending' THEN r.id END) as pending_count
    FROM requests r
    WHERE r.event_id = ?
  `, [eventId]);

  const [topSongs] = await db.query(`
    SELECT r.song_name, r.artist, COUNT(*) as request_count
    FROM requests r
    WHERE r.event_id = ?
    GROUP BY r.song_name, r.artist
    ORDER BY request_count DESC
    LIMIT 10
  `, [eventId]);

  res.json({ stats: stats[0], topSongs });
});

app.get('/api/history', async (req, res) => {
  const [events] = await db.query(`
    SELECT * FROM event_history
    ORDER BY created_at DESC
    LIMIT 20
  `);

  res.json({ events });
});

// ========== Spotify Auth ==========

app.get('/api/spotify/login/:eventId', (req, res) => {
  const { eventId } = req.params;
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'streaming',
    'user-read-email',
    'user-read-private'
  ];

  const authUrl = 'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_CLIENT_ID,
      scope: scopes.join(' '),
      redirect_uri: SPOTIFY_REDIRECT_URI,
      state: eventId
    });

  res.json({ authUrl });
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  const eventId = req.query.state;

  if (!code || !eventId) {
    return res.status(400).send('Code ou eventId manquant');
  }

  try {
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

    await db.query(
      'INSERT INTO spotify_tokens (event_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE access_token = ?, refresh_token = ?, expires_at = ?',
      [eventId, access_token, refresh_token, Date.now() + (expires_in * 1000), access_token, refresh_token, Date.now() + (expires_in * 1000)]
    );

    res.redirect(`/dj/${eventId}?spotify=connected`);
  } catch (error) {
    console.error('Erreur auth:', error.response?.data || error.message);
    res.status(500).send('Erreur authentification');
  }
});

app.get('/api/spotify/status/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const [rows] = await db.query('SELECT * FROM spotify_tokens WHERE event_id = ?', [eventId]);

  if (rows.length > 0 && rows[0].expires_at > Date.now()) {
    res.json({ connected: true });
  } else {
    res.json({ connected: false });
  }
});

app.get('/api/spotify/token/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const [rows] = await db.query('SELECT * FROM spotify_tokens WHERE event_id = ?', [eventId]);

  if (rows.length === 0 || rows[0].expires_at <= Date.now()) {
    return res.status(401).json({ error: 'Token expiré' });
  }

  res.json({ access_token: rows[0].access_token });
});

app.get('/api/spotify/search', async (req, res) => {
  const { q, eventId } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Query manquante' });
  }

  let accessToken;

  if (eventId) {
    const [rows] = await db.query('SELECT * FROM spotify_tokens WHERE event_id = ?', [eventId]);
    if (rows.length > 0 && rows[0].expires_at > Date.now()) {
      accessToken = rows[0].access_token;
    }
  }

  if (!accessToken) {
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({ grant_type: 'client_credentials' }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
          }
        }
      );
      accessToken = response.data.access_token;
    } catch (error) {
      return res.status(500).json({ error: 'Erreur authentification' });
    }
  }

  try {
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      params: { q, type: 'track', limit: 10 }
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
    res.status(500).json({ error: 'Erreur recherche' });
  }
});

app.post('/api/spotify/play/:eventId', async (req, res) => {
  const { eventId } = req.params;
  const { uri, device_id } = req.body;

  const [rows] = await db.query('SELECT * FROM spotify_tokens WHERE event_id = ?', [eventId]);

  if (rows.length === 0 || rows[0].expires_at <= Date.now()) {
    return res.status(401).json({ error: 'Token expiré' });
  }

  try {
    await axios.put(
      `https://api.spotify.com/v1/me/player/play${device_id ? '?device_id=' + device_id : ''}`,
      { uris: [uri] },
      {
        headers: {
          'Authorization': `Bearer ${rows[0].access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lecture' });
  }
});

// ========== WebSocket avec votes et auto-accept ==========

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);

  socket.on('join-event', async (eventId) => {
    socket.join(eventId);

    const limitStatus = await checkRateLimit(socket.id, eventId);
    socket.emit('rate-limit-status', limitStatus);
  });

  socket.on('request-song', async (data) => {
    const { eventId, songData, userName } = data;

    const [eventRows] = await db.query('SELECT * FROM events WHERE id = ?', [eventId]);
    if (eventRows.length === 0) {
      socket.emit('request-error', { message: 'Événement non trouvé' });
      return;
    }

    const event = eventRows[0];

    // Vérifier le rate limit
    const limitCheck = await checkRateLimit(socket.id, eventId);
    if (!limitCheck.allowed) {
      socket.emit('request-error', {
        type: 'rate-limit',
        message: `⏱️ Limite atteinte ! Réessaye dans ${limitCheck.remainingTime} min.`,
        remainingTime: limitCheck.remainingTime
      });
      return;
    }

    // Vérifier les doublons
    if (!event.allow_duplicates && songData.uri) {
      const duplicateCheck = await checkDuplicate(eventId, songData.uri);
      if (duplicateCheck.isDuplicate) {
        socket.emit('request-error', {
          type: 'duplicate',
          message: `🎵 Cette chanson est ${duplicateCheck.location === 'queue' ? 'déjà dans la queue' : 'déjà proposée'} !`
        });
        return;
      }
    }

    // Créer la demande
    const requestId = uuidv4();
    const status = event.auto_accept_enabled ? 'accepted' : 'pending';
    const queue_position = event.auto_accept_enabled ? (await getNextQueuePosition(eventId)) : null;

    await db.query(
      'INSERT INTO requests (id, event_id, song_name, artist, album, image_url, spotify_uri, duration_ms, user_name, socket_id, status, queue_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [requestId, eventId, songData.name, songData.artist, songData.album, songData.image, songData.uri, songData.duration_ms, userName || 'Anonyme', socket.id, status, queue_position]
    );

    await incrementRateLimit(socket.id);

    const request = await getRequestWithVotes(requestId);

    if (event.auto_accept_enabled) {
      // Mode automatique: notifier comme accepté
      const queue = await getQueueWithVotes(eventId);
      io.to(eventId).emit('request-accepted', { requestId, queue });
      io.to(socket.id).emit('your-request-accepted', { requestId, position: queue_position });
    } else {
      // Mode normal: notifier comme pending
      io.to(eventId).emit('new-request', request);
    }

    const newLimitStatus = await checkRateLimit(socket.id, eventId);
    socket.emit('request-created', {
      requestId,
      rateLimitStatus: newLimitStatus
    });
  });

  socket.on('vote', async (data) => {
    const { requestId, voteType } = data;

    // Vérifier si les votes sont activés
    const [reqRows] = await db.query('SELECT event_id FROM requests WHERE id = ?', [requestId]);
    if (reqRows.length === 0) return;

    const eventId = reqRows[0].event_id;
    const [eventRows] = await db.query('SELECT votes_enabled FROM events WHERE id = ?', [eventId]);

    if (eventRows.length > 0 && !eventRows[0].votes_enabled) {
      socket.emit('vote-error', { message: 'Les votes sont désactivés' });
      return;
    }

    try {
      await db.query(
        'INSERT INTO votes (request_id, socket_id, vote_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE vote_type = ?',
        [requestId, socket.id, voteType, voteType]
      );

      const request = await getRequestWithVotes(requestId);

      io.to(eventId).emit('vote-updated', {
        requestId,
        upvotes: request.upvotes,
        downvotes: request.downvotes
      });
    } catch (error) {
      console.error('Erreur vote:', error);
    }
  });

  socket.on('accept-request', async (data) => {
    const { eventId, requestId } = data;

    const [maxPos] = await db.query(
      'SELECT MAX(queue_position) as max_pos FROM requests WHERE event_id = ? AND status = "accepted"',
      [eventId]
    );
    const newPosition = (maxPos[0].max_pos || 0) + 1;

    await db.query(
      'UPDATE requests SET status = ?, queue_position = ? WHERE id = ?',
      ['accepted', newPosition, requestId]
    );

    const queue = await getQueueWithVotes(eventId);

    io.to(eventId).emit('request-accepted', { requestId, queue });

    const [reqRows] = await db.query('SELECT socket_id FROM requests WHERE id = ?', [requestId]);
    if (reqRows.length > 0) {
      io.to(reqRows[0].socket_id).emit('your-request-accepted', { requestId, position: newPosition });
    }
  });

  socket.on('reject-request', async (data) => {
    const { requestId } = data;

    await db.query('UPDATE requests SET status = ? WHERE id = ?', ['rejected', requestId]);

    const [reqRows] = await db.query('SELECT event_id, socket_id FROM requests WHERE id = ?', [requestId]);
    if (reqRows.length > 0) {
      io.to(reqRows[0].event_id).emit('request-rejected', { requestId });
      io.to(reqRows[0].socket_id).emit('your-request-rejected', { requestId });
    }
  });

  socket.on('reorder-queue', async (data) => {
    const { eventId, newQueue } = data;

    for (let i = 0; i < newQueue.length; i++) {
      await db.query('UPDATE requests SET queue_position = ? WHERE id = ?', [i + 1, newQueue[i].id]);
    }

    const queue = await getQueueWithVotes(eventId);
    io.to(eventId).emit('queue-updated', { queue });
  });

  socket.on('mark-played', async (data) => {
    const { eventId, requestId } = data;

    await db.query(
      'UPDATE requests SET status = ?, played_at = NOW(), queue_position = NULL WHERE id = ?',
      ['played', requestId]
    );

    const queue = await getQueueWithVotes(eventId);
    io.to(eventId).emit('queue-updated', { queue });
  });

  socket.on('disconnect', () => {
    console.log('Client déconnecté:', socket.id);
  });
});

async function getNextQueuePosition(eventId) {
  const [maxPos] = await db.query(
    'SELECT MAX(queue_position) as max_pos FROM requests WHERE event_id = ? AND status = "accepted"',
    [eventId]
  );
  return (maxPos[0].max_pos || 0) + 1;
}

http.listen(PORT, () => {
  console.log(`🎵 Serveur sur http://localhost:${PORT}`);
  console.log(`💾 MySQL: Persistance activée`);
  console.log(`👍 Système de votes: Activé`);
  console.log(`🤖 Mode automatique: Configurable`);
  console.log(`⚙️ Rate limiting: Configurable par événement`);
});