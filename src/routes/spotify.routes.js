const express = require("express");
const router = express.Router();
const db = require("../config/database");
const axios = require("axios");
const { eventIdValidator } = require("../validators/events.validator");
const { handleValidationErrors } = require("../middlewares/validation");

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
    // Récupérer le token Spotify de l'événement
    const [tokenRows] = await db.query(
      "SELECT access_token, expires_at FROM spotify_tokens WHERE event_id = ?",
      [eventId],
    );

    if (tokenRows.length === 0) {
      return res.status(404).json({
        error: "Spotify non connecté pour cet événement",
        tracks: [],
      });
    }

    const token = tokenRows[0];
    const now = Date.now();

    // Vérifier si le token est expiré
    if (parseInt(token.expires_at) <= now) {
      return res.status(401).json({
        error: "Token Spotify expiré",
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
        Authorization: `Bearer ${token.access_token}`,
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
      // Vérifier si un token existe et est valide
      const [rows] = await db.query(
        "SELECT access_token, expires_at FROM spotify_tokens WHERE event_id = ?",
        [eventId],
      );

      if (rows.length === 0) {
        return res.json({ connected: false });
      }

      const token = rows[0];
      const now = new Date();
      const expiresAt = new Date(token.expires_at);

      // Vérifier si le token est encore valide
      if (expiresAt > now) {
        return res.json({ connected: true, expires_at: token.expires_at });
      } else {
        return res.json({ connected: false, reason: "Token expiré" });
      }
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

// Token Spotify (pour le player)
router.get(
  "/token/:eventId",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      const [rows] = await db.query(
        "SELECT access_token, expires_at FROM spotify_tokens WHERE event_id = ?",
        [eventId],
      );

      if (rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Pas de token Spotify pour cet événement" });
      }

      const token = rows[0];
      const now = new Date();
      const expiresAt = new Date(token.expires_at);

      // Vérifier si le token est encore valide
      if (expiresAt <= now) {
        return res
          .status(401)
          .json({ error: "Token expiré, reconnectez-vous" });
      }

      res.json({ access_token: token.access_token });
    } catch (error) {
      console.error("Erreur récupération token:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Play sur Spotify
router.post(
  "/play/:eventId",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const { uri, device_id } = req.body;

    try {
      const [rows] = await db.query(
        "SELECT access_token FROM spotify_tokens WHERE event_id = ?",
        [eventId],
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Pas de token Spotify" });
      }

      const token = rows[0].access_token;

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

module.exports = router;
