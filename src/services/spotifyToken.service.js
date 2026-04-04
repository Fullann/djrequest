/**
 * Service de gestion des tokens Spotify pour les events.
 *
 * Toutes les routes qui appellent l'API Spotify doivent passer par
 * `getValidEventToken(eventId)` plutôt qu'interroger directement la DB.
 * Ce service :
 *   - vérifie si le token est encore valide (avec une marge de 5 min)
 *   - sinon, utilise le refresh_token pour en obtenir un nouveau
 *   - met à jour spotify_tokens ET le record djs pour que les prochains
 *     événements créés par ce DJ aient des tokens frais
 */

const axios = require("axios");
const db    = require("../config/database");

// Marge avant expiration à partir de laquelle on rafraîchit pro-activement (5 min)
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Retourne un access_token valide pour l'event donné.
 * Rafraîchit automatiquement si nécessaire.
 *
 * @param {string} eventId
 * @returns {Promise<string|null>} access_token ou null si impossible
 */
async function getValidEventToken(eventId) {
  const [rows] = await db.query(
    "SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE event_id = ?",
    [eventId],
  );

  if (rows.length === 0) return null;

  const { access_token, refresh_token, expires_at } = rows[0];
  const expiresAtMs = parseInt(expires_at, 10);

  // Token encore valide : on le retourne directement
  if (expiresAtMs > Date.now() + REFRESH_MARGIN_MS) {
    return access_token;
  }

  // Token expiré ou sur le point d'expirer : refresh
  if (!refresh_token) {
    console.warn(`[SpotifyToken] Event ${eventId} : token expiré sans refresh_token.`);
    return null;
  }

  try {
    const refreshRes = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type:    "refresh_token",
        refresh_token,
        client_id:     process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const newAccessToken  = refreshRes.data.access_token;
    // Spotify retourne parfois un nouveau refresh_token (rotation)
    const newRefreshToken = refreshRes.data.refresh_token || refresh_token;
    const newExpiresAt    = Date.now() + refreshRes.data.expires_in * 1000;

    // 1. Mettre à jour spotify_tokens pour cet event
    await db.query(
      `UPDATE spotify_tokens
          SET access_token = ?, refresh_token = ?, expires_at = ?
        WHERE event_id = ?`,
      [newAccessToken, newRefreshToken, newExpiresAt, eventId],
    );

    // 2. Mettre à jour les tokens du DJ propriétaire de l'event (pour les futurs events)
    await db.query(
      `UPDATE djs
          SET sp_access_token = ?, sp_refresh_token = ?, sp_token_expires_at = ?
        WHERE id = (SELECT dj_id FROM events WHERE id = ?)`,
      [newAccessToken, newRefreshToken, newExpiresAt, eventId],
    );

    console.info(`[SpotifyToken] Token rafraîchi pour l'event ${eventId}.`);
    return newAccessToken;
  } catch (err) {
    console.error(
      `[SpotifyToken] Impossible de rafraîchir le token pour l'event ${eventId}:`,
      err.response?.data || err.message,
    );
    return null;
  }
}

module.exports = { getValidEventToken };
