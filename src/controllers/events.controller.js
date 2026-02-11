const { v4: uuidv4 } = require("uuid");
const QRCode = require("qrcode");
const db = require("../config/database");
const queueService = require("../services/queue.service");

class EventsController {
  async createEvent(req, res) {
    const eventId = uuidv4();
    const { name } = req.body;
    const djId = req.session.djId;

    try {
      await db.query(
        `INSERT INTO events (id, name, dj_id, allow_duplicates, votes_enabled, 
         auto_accept_enabled, rate_limit_max, rate_limit_window_minutes) 
         VALUES (?, ?, ?, FALSE, TRUE, FALSE, 3, 15)`,
        [eventId, name, djId],
      );

      const userUrl = `${process.env.BASE_URL || "http://localhost:3000"}/user/${eventId}`;
      const qrCodeDataUrl = await QRCode.toDataURL(userUrl);

      res.json({
        eventId,
        qrCode: qrCodeDataUrl,
        djUrl: `/dj/${eventId}`,
        userUrl,
      });
    } catch (error) {
      console.error("Erreur création événement:", error);
      res
        .status(500)
        .json({ error: "Erreur lors de la création de l'événement" });
    }
  }

  async getEvent(req, res) {
    const { eventId } = req.params;

    try {
      const [rows] = await db.query("SELECT * FROM events WHERE id = ?", [
        eventId,
      ]);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const event = rows[0];
      const queue = await queueService.getQueueWithVotes(eventId);

      res.json({ ...event, queue });
    } catch (error) {
      console.error("Erreur get event:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async getEventQRCode(req, res) {
    const { eventId } = req.params;

    try {
      const [rows] = await db.query("SELECT * FROM events WHERE id = ?", [
        eventId,
      ]);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      // Utiliser BASE_URL depuis .env ou construire dynamiquement
      const baseUrl =
        process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      const userUrl = `${baseUrl}/user/${eventId}`;

      console.log("📱 URL générée:", userUrl);

      const qrCodeDataUrl = await QRCode.toDataURL(userUrl);

      res.json({ qrCode: qrCodeDataUrl, userUrl });
    } catch (error) {
      console.error("Erreur QR code:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async getEventStats(req, res) {
    const { eventId } = req.params;

    try {
      const [stats] = await db.query(
        `
        SELECT
          COUNT(DISTINCT r.id) as total_requests,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
          COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count,
          COUNT(DISTINCT CASE WHEN r.status = 'pending' THEN r.id END) as pending_count,
          COUNT(DISTINCT CASE WHEN r.status = 'accepted' THEN r.id END) as accepted_count
        FROM requests r
        WHERE r.event_id = ?
      `,
        [eventId],
      );

      const [topSongs] = await db.query(
        `
        SELECT r.song_name, r.artist, COUNT(*) as request_count
        FROM requests r
        WHERE r.event_id = ?
        GROUP BY r.song_name, r.artist
        ORDER BY request_count DESC
        LIMIT 10
      `,
        [eventId],
      );

      res.json({
        stats: stats[0],
        topSongs,
      });
    } catch (error) {
      console.error("Erreur stats:", error);
      res.status(500).json({ error: "Erreur récupération stats" });
    }
  }

  async toggleVotes(req, res) {
    const { eventId } = req.params;
    const { enabled } = req.body;

    try {
      await db.query("UPDATE events SET votes_enabled = ? WHERE id = ?", [
        enabled,
        eventId,
      ]);

      res.json({ votesEnabled: enabled });
    } catch (error) {
      console.error("Erreur toggle votes:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async toggleDuplicates(req, res) {
    const { eventId } = req.params;

    try {
      await db.query(
        "UPDATE events SET allow_duplicates = NOT allow_duplicates WHERE id = ?",
        [eventId],
      );

      const [rows] = await db.query(
        "SELECT allow_duplicates FROM events WHERE id = ?",
        [eventId],
      );

      res.json({ allow_duplicates: rows[0].allow_duplicates });
    } catch (error) {
      console.error("Erreur toggle duplicates:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async toggleAutoAccept(req, res) {
    const { eventId } = req.params;
    const { enabled } = req.body;

    try {
      await db.query("UPDATE events SET auto_accept_enabled = ? WHERE id = ?", [
        enabled,
        eventId,
      ]);

      res.json({ autoAcceptEnabled: enabled });
    } catch (error) {
      console.error("Erreur toggle auto-accept:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async updateRateLimit(req, res) {
    const { eventId } = req.params;
    const { max, window } = req.body;

    try {
      await db.query(
        "UPDATE events SET rate_limit_max = ?, rate_limit_window_minutes = ? WHERE id = ?",
        [max, window, eventId],
      );

      res.json({ success: true, max, window });
    } catch (error) {
      console.error("Erreur update rate limit:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
  async getHistory(req, res) {
    const djId = req.session.djId;

    try {
      // Info DJ
      const [djRows] = await db.query(
        "SELECT id, name, email FROM djs WHERE id = ?",
        [djId],
      );
      const dj = djRows[0];

      // Événements terminés
      const [events] = await db.query(
        `
  SELECT 
    e.id,
    e.name,
    e.created_at,
    e.ended_at,  -- Garder cette colonne au cas où
    COUNT(DISTINCT r.id) as total_songs,
    COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_songs,
    COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_songs,
    COUNT(DISTINCT CASE WHEN r.status = 'accepted' THEN r.id END) as accepted_count
  FROM events e
  LEFT JOIN requests r ON e.id = r.event_id
  WHERE e.dj_id = ? AND e.ended_at IS NULL  -- ← AJOUTER CETTE CONDITION
  GROUP BY e.id
  ORDER BY e.created_at DESC
  LIMIT 20
`,
        [djId],
      );

      // Stats globales de l'historique
      const [statsRows] = await db.query(
        `
      SELECT 
        COUNT(DISTINCT e.id) as totalEnded,
        SUM(TIMESTAMPDIFF(MINUTE, e.created_at, e.ended_at)) as totalDurationMinutes,
        COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as totalSongsPlayed
      FROM events e
      LEFT JOIN requests r ON e.id = r.event_id
      WHERE e.dj_id = ? AND e.ended_at IS NOT NULL
    `,
        [djId],
      );

      const stats = {
        totalEnded: statsRows[0].totalEnded || 0,
        totalDurationMinutes: statsRows[0].totalDurationMinutes || 0,
        totalSongsPlayed: statsRows[0].totalSongsPlayed || 0,
      };

      res.json({ dj, events, stats });
    } catch (error) {
      console.error("Erreur historique:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async getDetailedStats(req, res) {
    const { eventId } = req.params;
    const djId = req.session.djId;

    try {
      // Vérifier que l'événement appartient au DJ
      const [eventRows] = await db.query(
        "SELECT * FROM events WHERE id = ? AND dj_id = ?",
        [eventId, djId],
      );

      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const event = eventRows[0];

      // Stats générales
      const [statsRows] = await db.query(
        `
      SELECT
        COUNT(DISTINCT r.id) as total_requests,
        COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
        COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count,
        AVG(CASE WHEN r.status = 'played' THEN 
          (SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up')
        END) as avg_votes
      FROM requests r
      WHERE r.event_id = ?
    `,
        [eventId],
      );

      const stats = statsRows[0];

      // Top chansons (celles jouées plusieurs fois ou une fois)
      const [topSongs] = await db.query(
        `
      SELECT 
        song_name,
        artist,
        COUNT(*) as play_count
      FROM requests
      WHERE event_id = ? AND status = 'played'
      GROUP BY song_name, artist
      ORDER BY play_count DESC, song_name ASC
      LIMIT 10
    `,
        [eventId],
      );

      // Chansons les plus votées
      const [mostVoted] = await db.query(
        `
      SELECT 
        r.song_name,
        r.artist,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes,
        (COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) -
         COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END)) as net_votes
      FROM requests r
      LEFT JOIN votes v ON r.id = v.request_id
      WHERE r.event_id = ? AND r.status = 'played'
      GROUP BY r.id, r.song_name, r.artist
      ORDER BY net_votes DESC, upvotes DESC
      LIMIT 10
    `,
        [eventId],
      );

      // Top artistes
      const [topArtists] = await db.query(
        `
      SELECT 
        artist,
        COUNT(*) as count
      FROM requests
      WHERE event_id = ? AND status = 'played'
      GROUP BY artist
      ORDER BY count DESC
      LIMIT 10
    `,
        [eventId],
      );

      // Timeline des chansons jouées
      const [playedSongs] = await db.query(
        `
      SELECT 
        r.song_name,
        r.artist,
        r.user_name,
        r.played_at,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes
      FROM requests r
      LEFT JOIN votes v ON r.id = v.request_id
      WHERE r.event_id = ? AND r.status = 'played'
      GROUP BY r.id
      ORDER BY r.played_at ASC
    `,
        [eventId],
      );

      res.json({
        event,
        stats,
        topSongs,
        mostVoted,
        topArtists,
        playedSongs,
      });
    } catch (error) {
      console.error("Erreur stats détaillées:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
}

module.exports = new EventsController();
