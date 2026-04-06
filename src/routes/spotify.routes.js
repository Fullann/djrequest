const express = require("express");
const router  = express.Router();
const axios   = require("axios");
const { eventIdValidator }       = require("../validators/events.validator");
const { handleValidationErrors } = require("../middlewares/validation");
const { getValidEventToken }     = require("../services/spotifyToken.service");
const { requireAuth, requireEventOwnership } = require("../middlewares/auth");

// Recherche Spotify
router.get("/search", async (req, res) => {
  const { q, eventId } = req.query;

  if (!q || q.trim().length < 2) {
    return res.json({ tracks: [] });
  }

  if (!eventId) {
    return res.status(400).json({ error: "eventId manquant" });
  }

  try {
    const token = await getValidEventToken(eventId);
    if (!token) {
      return res.status(401).json({
        error: "Spotify non connecté ou token expiré pour cet événement",
        tracks: [],
      });
    }

    // Rechercher sur Spotify
    const response = await axios.get("https://api.spotify.com/v1/search", {
      params: {
        q: q,
        type: "track",
        limit: 10,
        market: "FR",
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Formater les résultats
    const tracks = response.data.tracks.items.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artists.map((a) => a.name).join(", "),
      album: track.album.name,
      image: track.album.images[0]?.url || "",
      uri: track.uri,
      duration_ms: track.duration_ms,
      preview_url: track.preview_url,
    }));

    res.json({ tracks });
  } catch (error) {
    console.error(
      "Erreur recherche Spotify:",
      error.response?.data || error.message,
    );

    // Si erreur 401, le token est invalide
    if (error.response?.status === 401) {
      return res.status(401).json({
        error: "Token Spotify invalide, reconnectez-vous",
        tracks: [],
      });
    }

    res.status(500).json({
      error: "Erreur lors de la recherche",
      tracks: [],
    });
  }
});

// Status de connexion Spotify
router.get(
  "/status/:eventId",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      // getValidEventToken tente un refresh si nécessaire
      const token = await getValidEventToken(eventId);
      if (!token) {
        return res.json({ connected: false, reason: "Token expiré ou absent" });
      }
      return res.json({ connected: true });
    } catch (error) {
      console.error("Erreur Spotify status:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Login Spotify
router.get(
  "/login/:eventId",
  eventIdValidator,
  handleValidationErrors,
  (req, res) => {
    const { eventId } = req.params;

    if (!process.env.SPOTIFY_CLIENT_ID) {
      return res.status(500).json({
        error: "Spotify non configuré. Ajoutez SPOTIFY_CLIENT_ID dans .env",
      });
    }

    const scopes = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "streaming",
      "user-read-email",
      "user-read-private",
    ];

    const authUrl =
      "https://accounts.spotify.com/authorize?" +
      new URLSearchParams({
        response_type: "code",
        client_id: process.env.SPOTIFY_CLIENT_ID,
        scope: scopes.join(" "),
        redirect_uri:
          process.env.SPOTIFY_REDIRECT_URI || "http://localhost:3000/callback",
        state: eventId,
      });

    res.json({ authUrl });
  },
);

// Token Spotify (pour le player — DJ uniquement)
router.get(
  "/token/:eventId",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      const token = await getValidEventToken(eventId);
      if (!token) {
        return res.status(401).json({ error: "Token Spotify expiré ou absent" });
      }
      res.json({ access_token: token });
    } catch (error) {
      console.error("Erreur récupération token:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Play sur Spotify (DJ uniquement)
router.post(
  "/play/:eventId",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const { uri, device_id } = req.body;

    try {
      const token = await getValidEventToken(eventId);
      if (!token) {
        return res.status(401).json({ error: "Token Spotify expiré ou absent" });
      }

      // Si device_id fourni (Web Player), l'utiliser directement
      // Sinon laisser Spotify utiliser l'appareil actif
      const playUrl = device_id
        ? `https://api.spotify.com/v1/me/player/play?device_id=${device_id}`
        : "https://api.spotify.com/v1/me/player/play";

      await axios.put(
        playUrl,
        { uris: [uri] },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      );

      res.json({ success: true, device_id });
    } catch (error) {
      console.error(
        "Erreur lecture Spotify:",
        error.response?.data || error.message,
      );

      // Gérer les erreurs spécifiques
      if (error.response?.status === 404) {
        const errorReason = error.response.data?.error?.reason;

        if (errorReason === "NO_ACTIVE_DEVICE") {
          return res.status(404).json({
            error:
              "Aucun appareil actif. Ouvrez Spotify Desktop ou attendez que le Web Player se connecte.",
            details: error.response.data,
          });
        }

        return res.status(404).json({
          error: "Appareil non trouvé",
          details: error.response.data,
        });
      }

      if (error.response?.status === 403) {
        return res.status(403).json({
          error: "Spotify Premium requis",
          details: error.response.data,
        });
      }

      res.status(500).json({
        error: "Erreur lors de la lecture",
        details: error.response?.data,
      });
    }
  },
);

// Métadonnées enrichies des pistes (BPM si dispo, popularité en fallback — DJ uniquement)
// Note: l'endpoint audio-features Spotify est restreint aux apps créées avant nov. 2024.
// On essaie audio-features, sinon on utilise /v1/tracks (popularité comme proxy d'énergie).
router.get(
  "/audio-features/:eventId",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const { ids } = req.query;

    if (!ids) return res.json({});

    const trackIds = ids.split(",").filter(Boolean).slice(0, 50);
    if (trackIds.length === 0) return res.json({});

    try {
      const token = await getValidEventToken(eventId);
      if (!token) return res.json({});

      const headers  = { Authorization: `Bearer ${token}` };
      const features = {};

      // ── Tentative 1 : audio-features (BPM, énergie, tonalité) ──
      try {
        const afRes = await axios.get(
          "https://api.spotify.com/v1/audio-features",
          { params: { ids: trackIds.join(",") }, headers },
        );
        (afRes.data.audio_features || []).forEach((f) => {
          if (f) {
            features[f.id] = {
              bpm:    Math.round(f.tempo),
              energy: f.energy,
              key:    f.key,
              mode:   f.mode,
            };
          }
        });
      } catch (afErr) {
        // 403 = endpoint restreint pour cette app (apps créées après nov. 2024)
        if (afErr.response?.status !== 403) {
          console.error("audio-features:", afErr.message);
        }
      }

      // ── Fallback : /v1/tracks (popularité comme indicateur d'énergie) ──
      const missingIds = trackIds.filter((id) => !features[id]);
      if (missingIds.length > 0) {
        try {
          const tracksRes = await axios.get(
            "https://api.spotify.com/v1/tracks",
            { params: { ids: missingIds.join(",") }, headers },
          );
          (tracksRes.data.tracks || []).forEach((t) => {
            if (t) {
              features[t.id] = {
                bpm:        null,
                energy:     t.popularity / 100,
                popularity: t.popularity,
                key:        null,
                mode:       null,
              };
            }
          });
        } catch (tracksErr) {
          console.error("tracks fallback:", tracksErr.response?.data || tracksErr.message);
        }
      }

      res.json(features);
    } catch (error) {
      console.error("Erreur track-meta:", error.response?.data || error.message);
      res.json({});
    }
  },
);

// Piste aléatoire depuis une playlist (fallback — DJ uniquement)
router.get(
  "/playlist/:eventId/:playlistId",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId, playlistId } = req.params;

    try {
      const token = await getValidEventToken(eventId);
      if (!token) {
        return res.status(401).json({ error: "Token Spotify expiré ou absent" });
      }

      const headers = { Authorization: `Bearer ${token}` };

      // 1. Récupérer le total de la playlist
      const infoRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}`,
        { params: { fields: "tracks.total,name" }, headers },
      );

      const total        = infoRes.data.tracks?.total || 0;
      const playlistName = infoRes.data.name || "Playlist";

      if (total === 0) {
        return res.status(404).json({ error: "Playlist vide" });
      }

      // 2. Tenter jusqu'à 5 fois d'obtenir une piste valide (éviter fichiers locaux)
      let track = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const offset = Math.floor(Math.random() * total);
        const tracksRes = await axios.get(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            params: {
              fields: "items(track(id,name,uri,artists,album,preview_url,duration_ms))",
              limit:  1,
              offset,
            },
            headers,
          },
        );

        const item = tracksRes.data.items?.[0]?.track;
        if (item && item.uri && item.uri.startsWith("spotify:track:")) {
          track = item;
          break;
        }
      }

      if (!track) {
        return res.status(404).json({ error: "Aucune piste valide trouvée" });
      }

      res.json({
        id:           track.id,
        name:         track.name,
        artist:       track.artists.map((a) => a.name).join(", "),
        uri:          track.uri,
        image:        track.album.images?.[0]?.url || null,
        duration_ms:  track.duration_ms,
        playlistName,
      });
    } catch (error) {
      console.error(
        "Erreur playlist fallback:",
        error.response?.data || error.message,
      );
      res.status(500).json({ error: "Erreur lors de la récupération de la playlist" });
    }
  },
);

module.exports = router;
