const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const queueService = require("../services/queue.service");
const { buildBrandedQrDataUrl } = require("../utils/qrBranded");

class EventsController {
  async _tableExists(tableName) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS c
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName],
    );
    return Number(rows?.[0]?.c || 0) > 0;
  }

  async _columnExists(tableName, columnName) {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS c
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName],
    );
    return Number(rows?.[0]?.c || 0) > 0;
  }

  async createEvent(req, res) {
    const eventId = uuidv4();
    const { name, starts_at } = req.body;
    const djId = req.session.djId;

    // starts_at : si fourni, normaliser en datetime UTC-compatible
    let startsAtValue = null;
    if (starts_at) {
      const d = new Date(starts_at);
      if (!isNaN(d.getTime())) {
        // Formater en 'YYYY-MM-DD HH:MM:SS' pour MySQL
        startsAtValue = d.toISOString().slice(0, 19).replace("T", " ");
      }
    }

    try {
      await db.query(
        `INSERT INTO events (id, name, dj_id, starts_at, allow_duplicates, votes_enabled,
         auto_accept_enabled, rate_limit_max, rate_limit_window_minutes)
         VALUES (?, ?, ?, ?, FALSE, TRUE, FALSE, 3, 15)`,
        [eventId, name, djId, startsAtValue],
      );

      // Copier automatiquement les tokens Spotify du DJ pour cet événement
      const [djRows] = await db.query(
        "SELECT sp_access_token, sp_refresh_token, sp_token_expires_at FROM djs WHERE id = ?",
        [djId],
      );
      if (djRows.length > 0 && djRows[0].sp_access_token) {
        const { sp_access_token, sp_refresh_token, sp_token_expires_at } = djRows[0];
        await db.query(
          `INSERT INTO spotify_tokens (event_id, access_token, refresh_token, expires_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             access_token = VALUES(access_token),
             refresh_token = VALUES(refresh_token),
             expires_at = VALUES(expires_at)`,
          [eventId, sp_access_token, sp_refresh_token, sp_token_expires_at],
        );
      }

      const userUrl = `${process.env.BASE_URL || "http://localhost:3000"}/user/${eventId}`;
      const qrCodeDataUrl = await buildBrandedQrDataUrl(userUrl, name);

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

      const qrCodeDataUrl = await buildBrandedQrDataUrl(userUrl, rows[0].name);

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
      const maxInt = parseInt(max, 10);
      const windowInt = parseInt(window, 10);
      await db.query(
        "UPDATE events SET rate_limit_max = ?, rate_limit_window_minutes = ? WHERE id = ?",
        [maxInt, windowInt, eventId],
      );

      // Push live update to all clients in the room (DJ + users)
      const io = req.app.get("io");
      if (io) {
        io.to(eventId).emit("event-settings-updated", {
          rateLimitMax: maxInt,
          rateLimitWindowMinutes: windowInt,
        });
      }

      res.json({ success: true, max: maxInt, window: windowInt });
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

  async getLiveStats(req, res) {
    const { eventId } = req.params;
    const djId = req.session.djId;

    try {
      const [eventRows] = await db.query(
        "SELECT id, name, created_at, ended_at FROM events WHERE id = ? AND dj_id = ?",
        [eventId, djId],
      );
      if (eventRows.length === 0) return res.status(404).json({ error: "Événement non trouvé" });

      const event   = eventRows[0];
      const isLive  = !event.ended_at;
      const refTime = event.ended_at || new Date();

      // ── Compteurs globaux ──
      const [[counts]] = await db.query(
        `SELECT
           COUNT(*)                                               AS total,
           SUM(status = 'played')                                AS played,
           SUM(status = 'pending')                               AS pending,
           SUM(status = 'accepted')                              AS accepted,
           SUM(status = 'rejected')                              AS rejected,
           COUNT(DISTINCT NULLIF(user_name, 'Anonyme'))          AS named_users,
           COUNT(DISTINCT user_name)                             AS unique_users
         FROM requests WHERE event_id = ?`,
        [eventId],
      );

      // ── Top 5 artistes ──
      const [topArtists] = await db.query(
        `SELECT artist, COUNT(*) AS total, SUM(status='played') AS played
         FROM requests WHERE event_id = ?
         GROUP BY artist ORDER BY total DESC LIMIT 5`,
        [eventId],
      );

      // ── Top 5 chansons demandées (toutes) ──
      const [topSongs] = await db.query(
        `SELECT song_name, artist, image_url,
                COUNT(*) AS total, SUM(status='played') AS played,
                MAX(created_at) AS last_seen
         FROM requests WHERE event_id = ?
         GROUP BY song_name, artist, image_url
         ORDER BY total DESC LIMIT 5`,
        [eventId],
      );

      // ── Chanson en attente la plus votée ──
      const [hotPending] = await db.query(
        `SELECT r.song_name, r.artist, r.image_url,
                COUNT(DISTINCT CASE WHEN v.vote_type='up'   THEN v.id END) AS up,
                COUNT(DISTINCT CASE WHEN v.vote_type='down' THEN v.id END) AS down
         FROM requests r LEFT JOIN votes v ON r.id = v.request_id
         WHERE r.event_id = ? AND r.status IN ('pending','accepted')
         GROUP BY r.id ORDER BY up DESC LIMIT 1`,
        [eventId],
      );

      // ── Slots de 15 min depuis le début ──
      const [slots] = await db.query(
        `SELECT
           FLOOR(TIMESTAMPDIFF(MINUTE, ?, created_at) / 15) AS slot,
           COUNT(*) AS count
         FROM requests
         WHERE event_id = ? AND created_at >= ?
         GROUP BY slot
         ORDER BY slot ASC`,
        [event.created_at, eventId, event.created_at],
      );

      // Calculer la durée en minutes et les slots pleins
      const durationMin = Math.max(
        Math.floor((new Date(refTime) - new Date(event.created_at)) / 60000),
        15,
      );
      const totalSlots = Math.ceil(durationMin / 15);
      const slotMap    = {};
      slots.forEach((s) => { slotMap[s.slot] = parseInt(s.count, 10); });
      const timeline = Array.from({ length: totalSlots }, (_, i) => ({
        slot:  i,
        label: `+${i * 15}min`,
        count: slotMap[i] || 0,
      }));

      // ── Dernières demandes (live feed) ──
      let recentRequests = [];
      try {
        const [rows] = await db.query(
          `SELECT song_name, artist, user_name, status, created_at, is_fallback_source
           FROM requests WHERE event_id = ?
           ORDER BY created_at DESC LIMIT 10`,
          [eventId],
        );
        recentRequests = rows;
      } catch {
        const [rows] = await db.query(
          `SELECT song_name, artist, user_name, status, created_at
           FROM requests WHERE event_id = ?
           ORDER BY created_at DESC LIMIT 10`,
          [eventId],
        );
        recentRequests = rows;
      }

      // ── Heatmap horaire (0..23) ──
      const [hourRows] = await db.query(
        `SELECT HOUR(created_at) AS hour_slot, COUNT(*) AS count
         FROM requests
         WHERE event_id = ?
         GROUP BY hour_slot
         ORDER BY hour_slot ASC`,
        [eventId],
      );
      const hourMap = {};
      hourRows.forEach((h) => { hourMap[h.hour_slot] = Number(h.count || 0); });
      const hourlyHeatmap = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        label: `${String(h).padStart(2, "0")}h`,
        count: hourMap[h] || 0,
      }));

      // ── Top tempos (via cache audio Spotify) ──
      let tempoRows = [];
      try {
        const hasTrackCache = await this._tableExists("track_audio_cache");
        if (hasTrackCache) {
          const [tmpRows] = await db.query(
            `SELECT
               CASE
                 WHEN tac.bpm < 90 THEN '<90'
                 WHEN tac.bpm BETWEEN 90 AND 109 THEN '90-109'
                 WHEN tac.bpm BETWEEN 110 AND 129 THEN '110-129'
                 WHEN tac.bpm BETWEEN 130 AND 149 THEN '130-149'
                 ELSE '150+'
               END AS bpm_bucket,
               COUNT(*) AS total
             FROM requests r
             JOIN track_audio_cache tac
               ON tac.track_id = SUBSTRING_INDEX(r.spotify_uri, ':', -1)
             WHERE r.event_id = ? AND tac.bpm IS NOT NULL
             GROUP BY bpm_bucket
             ORDER BY total DESC`,
            [eventId],
          );
          tempoRows = tmpRows;
        }
      } catch (tempoErr) {
        console.warn("live-stats tempo fallback:", tempoErr.message || tempoErr);
      }

      // ── Skip rate (morceaux joués skipés avant ~85%) ──
      let playedTotal = 0;
      let skippedTotal = 0;
      try {
        const hasSkippedAt = await this._columnExists("requests", "skipped_at");
        if (hasSkippedAt) {
          const [[skipStats]] = await db.query(
            `SELECT
               SUM(status='played') AS played_total,
               SUM(skipped_at IS NOT NULL) AS skipped_total
             FROM requests
             WHERE event_id = ?`,
            [eventId],
          );
          playedTotal = Number(skipStats.played_total || 0);
          skippedTotal = Number(skipStats.skipped_total || 0);
        } else {
          const [[legacySkipStats]] = await db.query(
            `SELECT SUM(status='played') AS played_total
             FROM requests
             WHERE event_id = ?`,
            [eventId],
          );
          playedTotal = Number(legacySkipStats.played_total || 0);
          skippedTotal = 0;
        }
      } catch (skipErr) {
        console.warn("live-stats skip fallback:", skipErr.message || skipErr);
      }
      const skipRate = playedTotal > 0 ? Number(((skippedTotal / playedTotal) * 100).toFixed(1)) : 0;

      // ── Engagement votes ──
      const [[eng]] = await db.query(
        `SELECT
           COUNT(v.id) AS total_votes,
           COUNT(DISTINCT v.socket_id) AS voters,
           COUNT(DISTINCT r.id) AS voted_requests
         FROM requests r
         LEFT JOIN votes v ON v.request_id = r.id
         WHERE r.event_id = ?`,
        [eventId],
      );
      const voteEngagement = {
        totalVotes: Number(eng.total_votes || 0),
        uniqueVoters: Number(eng.voters || 0),
        votedRequests: Number(eng.voted_requests || 0),
        votesPerRequest: counts.total > 0
          ? Number((Number(eng.total_votes || 0) / Number(counts.total || 1)).toFixed(2))
          : 0,
      };

      res.json({
        event:   { ...event, isLive, durationMin },
        counts,
        topArtists,
        topSongs,
        hotPending:     hotPending[0] || null,
        timeline,
        recentRequests,
        hourlyHeatmap,
        topTempos: tempoRows,
        skip: { playedTotal, skippedTotal, skipRate },
        voteEngagement,
      });
    } catch (err) {
      console.error("Erreur live-stats:", err);
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

  /** Tendances publiques (invités) — top artistes / titres */
  async getEventTrends(req, res) {
    const { eventId } = req.params;
    try {
      const [eventRows] = await db.query("SELECT id, name FROM events WHERE id = ?", [eventId]);
      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const [topArtists] = await db.query(
        `SELECT artist, COUNT(*) AS total, SUM(status='played') AS played
         FROM requests WHERE event_id = ?
         GROUP BY artist ORDER BY total DESC LIMIT 5`,
        [eventId],
      );

      const [topSongs] = await db.query(
        `SELECT song_name, artist, COUNT(*) AS total
         FROM requests WHERE event_id = ?
         GROUP BY song_name, artist ORDER BY total DESC LIMIT 5`,
        [eventId],
      );

      res.json({
        eventName: eventRows[0].name,
        topArtists,
        topSongs,
      });
    } catch (err) {
      console.error("Erreur trends:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /** Historique des demandes d'un invité (client_id) pour cette soirée */
  async getGuestHistory(req, res) {
    const { eventId, clientId } = req.params;
    try {
      const [ev] = await db.query("SELECT id FROM events WHERE id = ?", [eventId]);
      if (ev.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const [rows] = await db.query(
        `SELECT id, song_name, artist, status, created_at
         FROM requests WHERE event_id = ? AND client_id = ?
         ORDER BY created_at DESC LIMIT 12`,
        [eventId, clientId],
      );
      res.json({ requests: rows });
    } catch (err) {
      console.error("Erreur guest-history:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async patchEventSettings(req, res) {
    const { eventId } = req.params;
    const djId = req.session.djId;
    try {
      const [eventRows] = await db.query(
        "SELECT * FROM events WHERE id = ? AND dj_id = ?",
        [eventId, djId],
      );
      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const { votes_enabled, repeat_cooldown_minutes, request_freeze_minutes } = req.body;
      const updates = [];
      const values = [];

      if (typeof votes_enabled === "boolean") {
        updates.push("votes_enabled = ?");
        values.push(votes_enabled ? 1 : 0);
      }
      if (repeat_cooldown_minutes !== undefined) {
        const n = parseInt(String(repeat_cooldown_minutes), 10);
        if (!Number.isNaN(n) && n >= 0 && n <= 240) {
          updates.push("repeat_cooldown_minutes = ?");
          values.push(n);
        }
      }
      if (request_freeze_minutes !== undefined) {
        const n = parseInt(String(request_freeze_minutes), 10);
        if (!Number.isNaN(n) && n >= 0 && n <= 30) {
          updates.push("requests_frozen_until = ?");
          values.push(n > 0 ? Date.now() + (n * 60 * 1000) : null);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: "Aucun champ à mettre à jour" });
      }

      values.push(eventId);
      await db.query(`UPDATE events SET ${updates.join(", ")} WHERE id = ?`, values);

      const [fresh] = await db.query("SELECT * FROM events WHERE id = ?", [eventId]);
      res.json({ success: true, event: fresh[0] });
    } catch (err) {
      console.error("Erreur patch settings:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async exportLiveStatsCsv(req, res) {
    const { eventId } = req.params;
    const djId = req.session.djId;
    try {
      const [eventRows] = await db.query(
        "SELECT id, name FROM events WHERE id = ? AND dj_id = ?",
        [eventId, djId],
      );
      if (eventRows.length === 0) {
        return res.status(404).json({ error: "Événement non trouvé" });
      }

      const hasTrackCache = await this._tableExists("track_audio_cache");
      const hasSkippedAt = await this._columnExists("requests", "skipped_at");
      const [rows] = await db.query(
        `SELECT
          r.created_at,
          r.played_at,
          ${hasSkippedAt ? "r.skipped_at" : "NULL AS skipped_at"},
          r.status,
          r.user_name,
          r.song_name,
          r.artist,
          r.spotify_uri,
          ${hasTrackCache ? "COALESCE(tac.bpm, '')" : "''"} AS bpm,
          ${hasTrackCache ? "COALESCE(tac.energy, '')" : "''"} AS energy,
          COALESCE((
            SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type='up'
          ), 0) AS upvotes,
          COALESCE((
            SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type='down'
          ), 0) AS downvotes
         FROM requests r
         ${hasTrackCache ? "LEFT JOIN track_audio_cache tac ON tac.track_id = SUBSTRING_INDEX(r.spotify_uri, ':', -1)" : ""}
         WHERE r.event_id = ?
         ORDER BY r.created_at ASC`,
        [eventId],
      );

      const header = [
        "created_at", "played_at", "skipped_at", "status", "user_name",
        "song_name", "artist", "spotify_uri", "bpm", "energy", "upvotes", "downvotes",
      ];
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [
        header.map(esc).join(","),
        ...rows.map((r) => header.map((h) => esc(r[h])).join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="live-stats-${eventId}.csv"`,
      );
      return res.status(200).send(csv);
    } catch (err) {
      console.error("Erreur export CSV live-stats:", err);
      return res.status(500).json({ error: "Erreur serveur" });
    }
  }
}

module.exports = new EventsController();
