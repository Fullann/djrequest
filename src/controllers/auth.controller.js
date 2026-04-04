const crypto = require("crypto");
const axios = require("axios");
const db = require("../config/database");

class AuthController {
  // Redirige vers Spotify pour l'authentification du DJ
  async spotifyLogin(req, res) {
    const state = crypto.randomBytes(20).toString("hex");
    req.session.oauthState = state;

    // Inclure les scopes playback pour éviter une 2e autorisation sur la page DJ
    const scopes = [
      "user-read-private",
      "user-read-email",
      "user-read-playback-state",
      "user-modify-playback-state",
      "streaming",
    ].join(" ");

    const params = new URLSearchParams({
      client_id:     process.env.SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri:  process.env.SPOTIFY_LOGIN_REDIRECT_URI,
      scope:         scopes,
      state,
      show_dialog:   "false",
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
  }

  // Callback Spotify après authentification
  async spotifyCallback(req, res) {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect("/?error=spotify_denied");
    }

    if (!code || !state) {
      return res.redirect("/?error=missing_params");
    }

    if (!req.session.oauthState || state !== req.session.oauthState) {
      return res.redirect("/?error=invalid_state");
    }

    delete req.session.oauthState;

    try {
      // Échange du code contre les tokens
      const tokenRes = await axios.post(
        "https://accounts.spotify.com/api/token",
        new URLSearchParams({
          grant_type:   "authorization_code",
          code,
          redirect_uri: process.env.SPOTIFY_LOGIN_REDIRECT_URI,
          client_id:    process.env.SPOTIFY_CLIENT_ID,
          client_secret:process.env.SPOTIFY_CLIENT_SECRET,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      // Récupération du profil Spotify
      const profileRes = await axios.get("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;
      const expiresAt = Date.now() + expires_in * 1000;

      const {
        id:            spotifyId,
        display_name:  displayName,
        images,
        email,
      } = profileRes.data;

      const avatar = images?.[0]?.url || null;
      const name   = displayName || `DJ ${spotifyId}`;

      // Upsert du DJ en base avec ses tokens Spotify (pour auto-connexion player)
      const [existing] = await db.query(
        "SELECT id FROM djs WHERE spotify_id = ?",
        [spotifyId]
      );

      let djId;
      if (existing.length > 0) {
        djId = existing[0].id;
        await db.query(
          `UPDATE djs
           SET name = ?, spotify_avatar = ?, email = ?,
               sp_access_token = ?, sp_refresh_token = ?, sp_token_expires_at = ?
           WHERE id = ?`,
          [name, avatar, email || null, access_token, refresh_token || null, expiresAt, djId]
        );
      } else {
        const [result] = await db.query(
          `INSERT INTO djs
             (spotify_id, name, spotify_avatar, email, sp_access_token, sp_refresh_token, sp_token_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [spotifyId, name, avatar, email || null, access_token, refresh_token || null, expiresAt]
        );
        djId = result.insertId;
      }

      req.session.djId = djId;
      res.redirect("/dashboard");
    } catch (err) {
      console.error(
        "Erreur auth Spotify login:",
        err.response?.data || err.message
      );
      res.redirect("/?error=spotify_error");
    }
  }

  async logout(req, res) {
    req.session.destroy((err) => {
      if (err) {
        console.error("Erreur logout:", err);
        return res.status(500).json({ error: "Erreur lors de la déconnexion" });
      }
      res.clearCookie("djqueue.sid");
      res.json({ success: true });
    });
  }

  async getCurrentUser(req, res) {
    try {
      const [rows] = await db.query(
        "SELECT id, name, spotify_id, spotify_avatar, email, created_at FROM djs WHERE id = ?",
        [req.session.djId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
      }

      res.json({ dj: rows[0] });
    } catch (error) {
      console.error("Erreur get user:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
}

module.exports = new AuthController();
