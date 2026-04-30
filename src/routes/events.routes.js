const express = require("express");
const router = express.Router();
const db = require("../config/database");
const { v4: uuidv4 } = require("uuid");
const queueService = require("../services/queue.service");
const eventsController = require("../controllers/events.controller");
const {
  createEventValidator,
  eventIdValidator,
  guestHistoryValidator,
  updateRateLimitValidator,
  toggleVotesValidator,
} = require("../validators/events.validator");
const { handleValidationErrors } = require("../middlewares/validation");
const {
  requireAuth,
  requireEventOwnership,
  requireEventAccess,
  requireModOrOwnership,
} = require("../middlewares/auth");

// Création événement
router.post(
  "/",
  requireAuth,
  createEventValidator,
  handleValidationErrors,
  eventsController.createEvent,
);

// Tendances (public, page invité)
router.get(
  "/:eventId/trends",
  eventIdValidator,
  handleValidationErrors,
  eventsController.getEventTrends,
);

// Historique des demandes d'un invité (client_id)
router.get(
  "/:eventId/guest-history/:clientId",
  guestHistoryValidator,
  handleValidationErrors,
  eventsController.getGuestHistory,
);

// Info événement
router.get(
  "/:eventId",
  eventIdValidator,
  handleValidationErrors,
  eventsController.getEvent,
);

// QR Code
router.get(
  "/:eventId/qrcode",
  eventIdValidator,
  handleValidationErrors,
  eventsController.getEventQRCode,
);

// Réglages (votes, anti-répétition, …)
router.patch(
  "/:eventId/settings",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  eventsController.patchEventSettings,
);

// Stats
router.get(
  "/:eventId/stats",
  eventIdValidator,
  handleValidationErrors,
  eventsController.getEventStats,
);

// Santé live (qualité prod) pour interface DJ
router.get(
  "/:eventId/live-health",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    try {
      const now = Date.now();
      const [tokenRows] = await db.query(
        "SELECT expires_at FROM spotify_tokens WHERE event_id = ? LIMIT 1",
        [eventId],
      );
      let spotify = { status: "missing", expiresInMs: null };
      if (tokenRows.length > 0) {
        const expiresAt = Number(tokenRows[0].expires_at || 0);
        const delta = expiresAt - now;
        spotify = {
          status: delta > 10 * 60 * 1000 ? "ok" : delta > 0 ? "expiring-soon" : "expired",
          expiresInMs: delta,
        };
      }

      const [queueRows] = await db.query(
        `SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
          MIN(CASE WHEN status = 'pending' THEN created_at ELSE NULL END) AS oldest_pending_at
         FROM requests
         WHERE event_id = ?`,
        [eventId],
      );
      const row = queueRows[0] || {};
      const pending = Number(row.pending_count || 0);
      const accepted = Number(row.accepted_count || 0);
      const oldestPendingAt = row.oldest_pending_at ? new Date(row.oldest_pending_at).getTime() : null;

      const io = req.app.get("io");
      const roomSize = io?.sockets?.adapter?.rooms?.get(eventId)?.size || 0;

      let recentErrors = [];
      try {
        const [errRows] = await db.query(
          `SELECT actor_type, actor_name, action_type, created_at, meta_json
           FROM event_action_logs
           WHERE event_id = ? AND action_type LIKE 'error-%'
           ORDER BY created_at DESC
           LIMIT 8`,
          [eventId],
        );
        recentErrors = errRows || [];
      } catch {
        recentErrors = [];
      }

      res.json({
        spotify,
        socket: {
          connectedClients: Number(roomSize),
        },
        queue: {
          pending,
          accepted,
          backlogTotal: pending + accepted,
          oldestPendingAgeMs: oldestPendingAt ? Math.max(0, now - oldestPendingAt) : null,
        },
        recentErrors,
        server: {
          uptimeSec: Math.floor(process.uptime()),
        },
      });
    } catch (error) {
      console.error("Erreur live-health:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Données publiques pour écran QR (grand écran)
router.get(
  "/:eventId/display-data",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      let eventRows;
      try {
        [eventRows] = await db.query("SELECT id, name, requests_frozen_until, donation_goal_amount, donations_raised_total FROM events WHERE id = ?", [
          eventId,
        ]);
      } catch {
        [eventRows] = await db.query("SELECT id, name, donation_goal_amount, donations_raised_total FROM events WHERE id = ?", [
          eventId,
        ]);
      }

      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const [upcomingQueue] = await db.query(
        `SELECT
          r.id,
          r.song_name,
          r.artist,
          r.image_url,
          r.user_name,
          r.duration_ms,
          r.queue_position,
          COALESCE(v.upvotes, 0)   AS upvotes,
          COALESCE(v.downvotes, 0) AS downvotes
        FROM requests r
        LEFT JOIN (
          SELECT
            request_id,
            SUM(CASE WHEN vote_type = 'up' THEN 1 ELSE 0 END) AS upvotes,
            SUM(CASE WHEN vote_type = 'down' THEN 1 ELSE 0 END) AS downvotes
          FROM votes
          GROUP BY request_id
        ) v ON v.request_id = r.id
        WHERE event_id = ? AND status = 'accepted'
        ORDER BY queue_position ASC`,
        [eventId],
      );

      let recentPlayed;
      try {
        [recentPlayed] = await db.query(
          `SELECT
            id,
            song_name,
            artist,
            image_url,
            user_name,
            played_at,
            is_fallback_source
          FROM requests
          WHERE event_id = ? AND status = 'played'
          ORDER BY played_at DESC
          LIMIT 12`,
          [eventId],
        );
      } catch {
        [recentPlayed] = await db.query(
          `SELECT
            id,
            song_name,
            artist,
            image_url,
            user_name,
            played_at
          FROM requests
          WHERE event_id = ? AND status = 'played'
          ORDER BY played_at DESC
          LIMIT 12`,
          [eventId],
        );
      }

      let activePoll = null;
      try {
        const [pollRows] = await db.query(
          `SELECT id, question, options_json, created_at
           FROM event_live_polls
           WHERE event_id = ? AND is_active = 1
           ORDER BY created_at DESC
           LIMIT 1`,
          [eventId],
        );
        if (pollRows.length > 0) {
          const p = pollRows[0];
          let options = [];
          try { options = JSON.parse(p.options_json || "[]"); } catch { options = []; }
          const [voteRows] = await db.query(
            "SELECT option_index, COUNT(*) AS total FROM event_live_poll_votes WHERE poll_id = ? GROUP BY option_index",
            [p.id],
          );
          const counts = Array.from({ length: options.length }, () => 0);
          voteRows.forEach((r) => {
            const i = Number(r.option_index);
            if (Number.isInteger(i) && i >= 0 && i < counts.length) counts[i] = Number(r.total || 0);
          });
          const totalVotes = counts.reduce((a, b) => a + b, 0);
          activePoll = {
            id: p.id,
            question: p.question,
            options,
            counts,
            totalVotes,
            percentages: counts.map((c) => (totalVotes > 0 ? Math.round((c * 100) / totalVotes) : 0)),
            isActive: true,
          };
        }
      } catch {
        activePoll = null;
      }

      res.json({
        event: eventRows[0],
        upcomingQueue,
        recentPlayed,
        activePoll,
      });
    } catch (error) {
      console.error("Erreur display-data:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Contrôles DJ
router.post(
  "/:eventId/toggle-votes",
  requireAuth,
  requireEventOwnership,
  toggleVotesValidator,
  handleValidationErrors,
  eventsController.toggleVotes,
);

router.post(
  "/:eventId/toggle-duplicates",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  eventsController.toggleDuplicates,
);

router.post(
  "/:eventId/toggle-auto-accept",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  eventsController.toggleAutoAccept,
);

router.post(
  "/:eventId/update-rate-limit",
  requireAuth,
  requireEventOwnership,
  updateRateLimitValidator,
  handleValidationErrors,
  eventsController.updateRateLimit,
);
// Récupérer les demandes en attente d'un événement
router.get(
  "/:eventId/pending",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      // Récupérer les pending requests
      const [pending] = await db.query(
        `SELECT 
          id, 
          user_name, 
          song_name, 
          artist, 
          spotify_uri,
          image_url,
          preview_url,
          status,
          created_at
        FROM requests 
        WHERE event_id = ? AND status = 'pending'
        ORDER BY created_at ASC`,
        [eventId],
      );

      res.json({ pending });
    } catch (error) {
      console.error("Erreur récupération pending:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Route pour ajouter une chanson (DJ ou modérateur)
router.post(
  "/:eventId/add-song-dj",
  requireModOrOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const { songData, userName } = req.body;

    try {
      // Vérifier que l'événement existe
      const [eventRows] = await db.query("SELECT * FROM events WHERE id = ?", [
        eventId,
      ]);
      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      // Créer la demande directement en "accepted"
      const requestId = uuidv4();

      // Obtenir la prochaine position dans la queue
      const [maxPos] = await db.query(
        'SELECT MAX(queue_position) as max_pos FROM requests WHERE event_id = ? AND status = "accepted"',
        [eventId],
      );
      const queuePosition = (maxPos[0].max_pos || 0) + 1;

      await db.query(
        `INSERT INTO requests 
        (id, event_id, song_name, artist, album, image_url, spotify_uri, duration_ms, preview_url, user_name, socket_id, status, queue_position) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          requestId,
          eventId,
          songData.name,
          songData.artist,
          songData.album,
          songData.image,
          songData.uri,
          songData.duration_ms,
          songData.preview_url,
          userName || "DJ",
          "dj-interface",
          "accepted",
          queuePosition,
        ],
      );

      // Récupérer la queue complète avec votes
      const [queue] = await db.query(
        `
        SELECT r.*,
               COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
               COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes
        FROM requests r
        LEFT JOIN votes v ON r.id = v.request_id
        WHERE r.event_id = ? AND r.status = 'accepted'
        GROUP BY r.id
        ORDER BY r.queue_position ASC
      `,
        [eventId],
      );

      // Notifier tous les clients
      const io = req.app.get("io");
      io.to(eventId).emit("queue-updated", { queue });

      res.json({ success: true, requestId, queuePosition });
    } catch (error) {
      console.error("Erreur ajout chanson DJ:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Tracer un morceau lu depuis la playlist de secours (DJ)
router.post(
  "/:eventId/fallback-played",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const t = req.body?.track || {};
    const songName = String(t.name || "").trim().slice(0, 255);
    const artist = String(t.artist || "").trim().slice(0, 255);
    const spotifyUri = String(t.uri || "").trim().slice(0, 255);
    if (!songName || !spotifyUri) {
      return res.status(400).json({ error: "Track invalide" });
    }
    try {
      const id = uuidv4();
      try {
        await db.query(
          `INSERT INTO requests
            (id, event_id, socket_id, client_id, user_name, song_name, artist, spotify_uri, image_url, duration_ms, preview_url, status, played_at, play_started_at, queue_position, is_fallback_source)
           VALUES (?, ?, 'fallback', 'fallback', 'Playlist secours', ?, ?, ?, ?, ?, ?, 'played', NOW(), NOW(), NULL, 1)`,
          [
            id,
            eventId,
            songName,
            artist || "Inconnu",
            spotifyUri,
            t.image || null,
            Number.isFinite(Number(t.duration_ms)) ? Number(t.duration_ms) : null,
            t.preview_url || null,
          ],
        );
      } catch {
        await db.query(
          `INSERT INTO requests
            (id, event_id, socket_id, client_id, user_name, song_name, artist, spotify_uri, image_url, duration_ms, preview_url, status, played_at, play_started_at, queue_position)
           VALUES (?, ?, 'fallback', 'fallback', 'Playlist secours', ?, ?, ?, ?, ?, ?, 'played', NOW(), NOW(), NULL)`,
          [
            id,
            eventId,
            songName,
            artist || "Inconnu",
            spotifyUri,
            t.image || null,
            Number.isFinite(Number(t.duration_ms)) ? Number(t.duration_ms) : null,
            t.preview_url || null,
          ],
        );
      }
      try {
        const io = req.app.get("io");
        if (io) {
          const queue = await queueService.getQueueWithVotes(eventId);
          io.to(eventId).emit("queue-updated", { queue });
        }
      } catch (emitErr) {
        console.warn("fallback-played emit:", emitErr.message || emitErr);
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Erreur fallback-played:", error);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Route pour terminer un événement
router.post(
  "/:eventId/end",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;

    try {
      // Vérifier que l'événement existe
      const [eventRows] = await db.query("SELECT * FROM events WHERE id = ?", [
        eventId,
      ]);

      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      // Calculer les statistiques
      const [stats] = await db.query(
        `
        SELECT
          COUNT(DISTINCT r.id) as total_requests,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
          COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count,
          COUNT(DISTINCT CASE WHEN r.status = 'pending' THEN r.id END) as pending_count,
          COUNT(DISTINCT CASE WHEN r.status = 'accepted' THEN r.id END) as queue_count
        FROM requests r
        WHERE r.event_id = ?
      `,
        [eventId],
      );

      // Marquer l'événement comme terminé (pas besoin d'event_history)
      await db.query("UPDATE events SET ended_at = NOW() WHERE id = ?", [
        eventId,
      ]);

      // Notifier tous les clients
      const io = req.app.get("io");
      if (io) {
        io.to(eventId).emit("event-ended", {
          message: "La soirée est terminée. Merci d'avoir participé !",
        });
      }

      // Vider le cache now-playing de cet événement
      const { clearNowPlayingCache } = require("../sockets/eventHandlers");
      clearNowPlayingCache(eventId);

      res.json({ success: true, stats: stats[0] });
    } catch (error) {
      console.error("Erreur fin événement:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);
// Réouverture d'une soirée terminée
router.post(
  "/:eventId/reopen",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    try {
      await db.query("UPDATE events SET ended_at = NULL WHERE id = ?", [eventId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Erreur reopen:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Historique des événements terminés
router.get("/history", async (req, res) => {
  if (!req.session.djId) {
    return res.status(401).json({ error: "Non authentifié" });
  }

  const controller = require("../controllers/events.controller");
  await controller.getHistory(req, res);
});

// Stats live (pendant + après l'événement)
router.get(
  "/:eventId/live-stats",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  eventsController.getLiveStats,
);

router.get(
  "/:eventId/live-stats.csv",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  eventsController.exportLiveStatsCsv,
);

// Stats détaillées d'un événement
router.get(
  "/:eventId/detailed-stats",
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    if (!req.session.djId) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const controller = require("../controllers/events.controller");
    await controller.getDetailedStats(req, res);
  },
);
// Mettre à jour le message de remerciement
router.post(
  "/:eventId/thank-you-message",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    const { message } = req.body;

    try {
      await db.query("UPDATE events SET thank_you_message = ? WHERE id = ?", [
        message || null,
        eventId,
      ]);

      res.json({ success: true, message });
    } catch (error) {
      console.error("Erreur mise à jour message:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

// Historique d'actions co-DJ / DJ
router.get(
  "/:eventId/action-logs",
  requireAuth,
  requireEventOwnership,
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    const { eventId } = req.params;
    try {
      const [rows] = await db.query(
        `SELECT actor_type, actor_name, actor_role, action_type, target_id, meta_json, created_at
         FROM event_action_logs
         WHERE event_id = ?
         ORDER BY created_at DESC
         LIMIT 200`,
        [eventId],
      );
      res.json({ logs: rows });
    } catch (error) {
      console.error("Erreur action-logs:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);

module.exports = router;
