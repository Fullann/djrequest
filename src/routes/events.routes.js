const express = require("express");
const router = express.Router();
const db = require("../config/database");
const { v4: uuidv4 } = require("uuid");
const eventsController = require("../controllers/events.controller");
const {
  createEventValidator,
  eventIdValidator,
  updateRateLimitValidator,
  toggleVotesValidator,
} = require("../validators/events.validator");
const { handleValidationErrors } = require("../middlewares/validation");
const {
  requireAuth,
  requireEventOwnership,
  requireEventAccess,
} = require("../middlewares/auth");

// Création événement
router.post(
  "/",
  requireAuth,
  createEventValidator,
  handleValidationErrors,
  eventsController.createEvent,
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

// Stats
router.get(
  "/:eventId/stats",
  eventIdValidator,
  handleValidationErrors,
  eventsController.getEventStats,
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

// Route pour ajouter une chanson en tant que DJ
router.post(
  "/:eventId/add-song-dj",
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

      console.log("✅ Événement terminé:", eventId);
      console.log("📊 Stats finales:", stats[0]);

      // Notifier tous les clients
      const io = req.app.get("io");
      if (io) {
        io.to(eventId).emit("event-ended", {
          message: "La soirée est terminée. Merci d'avoir participé !",
        });
      }

      res.json({ success: true, stats: stats[0] });
    } catch (error) {
      console.error("Erreur fin événement:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  },
);
// Historique des événements terminés
router.get('/history',
  async (req, res) => {
    if (!req.session.djId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    const controller = require('../controllers/events.controller');
    await controller.getHistory(req, res);
  }
);

// Stats détaillées d'un événement
router.get('/:eventId/detailed-stats',
  eventIdValidator,
  handleValidationErrors,
  async (req, res) => {
    if (!req.session.djId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    const controller = require('../controllers/events.controller');
    await controller.getDetailedStats(req, res);
  }
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
      await db.query(
        "UPDATE events SET thank_you_message = ? WHERE id = ?",
        [message || null, eventId]
      );

      console.log("✅ Message de remerciement mis à jour pour:", eventId);

      res.json({ success: true, message });
    } catch (error) {
      console.error("Erreur mise à jour message:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
);

module.exports = router;
