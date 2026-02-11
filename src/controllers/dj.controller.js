const db = require("../config/database");

class DjController {
  /**
   * Dashboard - Liste des événements actifs du DJ
   */
  async getDashboard(req, res) {
    const djId = req.session.djId;

    try {
      // Info DJ
      const [djRows] = await db.query(
        "SELECT id, name, email FROM djs WHERE id = ?",
        [djId],
      );
      const dj = djRows[0];

      // Événements ACTIFS uniquement (ended_at IS NULL)
      const [events] = await db.query(
        `SELECT 
          e.id,
          e.name,
          e.created_at,
          e.ended_at,
          COUNT(DISTINCT r.id) as total_songs,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_songs,
          COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_songs,
          COUNT(DISTINCT CASE WHEN r.status = 'accepted' THEN r.id END) as accepted_count
        FROM events e
        LEFT JOIN requests r ON e.id = r.event_id
        WHERE e.dj_id = ? AND e.ended_at IS NULL
        GROUP BY e.id
        ORDER BY e.created_at DESC
        LIMIT 20`,
        [djId],
      );

      // Stats globales (TOUS les événements du DJ)
      const [statsRows] = await db.query(
        `SELECT 
          COUNT(DISTINCT e.id) as totalEvents,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as totalSongs,
          AVG(CASE WHEN r.status = 'played' THEN 
            (SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up')
          END) as avgVotes
        FROM events e
        LEFT JOIN requests r ON e.id = r.event_id
        WHERE e.dj_id = ?`,
        [djId],
      );

      const stats = statsRows[0];

      // Taux d'acceptation
      const [acceptRateRows] = await db.query(
        `SELECT 
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played,
          COUNT(DISTINCT r.id) as total
        FROM requests r
        JOIN events e ON r.event_id = e.id
        WHERE e.dj_id = ?`,
        [djId],
      );

      const acceptRate =
        acceptRateRows[0].total > 0
          ? Math.round(
              (acceptRateRows[0].played / acceptRateRows[0].total) * 100,
            ) + "%"
          : "0%";

      // Top chansons (tous événements)
      const [topSongs] = await db.query(
        `SELECT 
          r.song_name,
          r.artist,
          COUNT(*) as play_count,
          AVG((SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up')) as avg_upvotes
        FROM requests r
        JOIN events e ON r.event_id = e.id
        WHERE e.dj_id = ? AND r.status = 'played'
        GROUP BY r.song_name, r.artist
        ORDER BY play_count DESC
        LIMIT 10`,
        [djId],
      );

      res.json({
        dj,
        events,
        stats: {
          totalEvents: stats.totalEvents || 0,
          totalSongs: stats.totalSongs || 0,
          avgVotes: stats.avgVotes || 0,
          acceptRate,
        },
        topSongs,
      });
    } catch (error) {
      console.error("❌ Erreur dashboard:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * Historique - Liste des événements terminés du DJ
   */
  async getHistory(req, res) {
    const djId = req.session.djId;

    try {
      // Info DJ
      const [djRows] = await db.query(
        "SELECT id, name, email FROM djs WHERE id = ?",
        [djId],
      );
      const dj = djRows[0];

      // Événements TERMINÉS (ended_at IS NOT NULL)
      const [events] = await db.query(
        `SELECT 
          e.id,
          e.name,
          e.created_at,
          e.ended_at,
          COUNT(DISTINCT r.id) as total_songs,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_songs,
          COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_songs
        FROM events e
        LEFT JOIN requests r ON e.id = r.event_id
        WHERE e.dj_id = ? AND e.ended_at IS NOT NULL
        GROUP BY e.id
        ORDER BY e.ended_at DESC
        LIMIT 50`,
        [djId],
      );

      // Stats globales de l'historique
      const [statsRows] = await db.query(
        `SELECT 
          COUNT(DISTINCT e.id) as totalEnded,
          SUM(TIMESTAMPDIFF(MINUTE, e.created_at, e.ended_at)) as totalDurationMinutes,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as totalSongsPlayed
        FROM events e
        LEFT JOIN requests r ON e.id = r.event_id
        WHERE e.dj_id = ? AND e.ended_at IS NOT NULL`,
        [djId],
      );

      const stats = {
        totalEnded: statsRows[0].totalEnded || 0,
        totalDurationMinutes: statsRows[0].totalDurationMinutes || 0,
        totalSongsPlayed: statsRows[0].totalSongsPlayed || 0,
      };

      res.json({ dj, events, stats });
    } catch (error) {
      console.error("❌ Erreur historique:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * Stats détaillées d'un événement terminé
   */
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
        `SELECT
          COUNT(DISTINCT r.id) as total_requests,
          COUNT(DISTINCT CASE WHEN r.status = 'played' THEN r.id END) as played_count,
          COUNT(DISTINCT CASE WHEN r.status = 'rejected' THEN r.id END) as rejected_count,
          AVG(CASE WHEN r.status = 'played' THEN 
            (SELECT COUNT(*) FROM votes v WHERE v.request_id = r.id AND v.vote_type = 'up')
          END) as avg_votes
        FROM requests r
        WHERE r.event_id = ?`,
        [eventId],
      );

      const stats = statsRows[0];

      // Top chansons (jouées plusieurs fois)
      const [topSongs] = await db.query(
        `SELECT 
          song_name,
          artist,
          COUNT(*) as play_count
        FROM requests
        WHERE event_id = ? AND status = 'played'
        GROUP BY song_name, artist
        ORDER BY play_count DESC, song_name ASC
        LIMIT 10`,
        [eventId],
      );

      // Chansons les plus votées
      const [mostVoted] = await db.query(
        `SELECT 
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
        LIMIT 10`,
        [eventId],
      );

      // Top artistes
      const [topArtists] = await db.query(
        `SELECT 
          artist,
          COUNT(*) as count
        FROM requests
        WHERE event_id = ? AND status = 'played'
        GROUP BY artist
        ORDER BY count DESC
        LIMIT 10`,
        [eventId],
      );

      // Timeline des chansons jouées
      const [playedSongs] = await db.query(
        `SELECT 
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
        ORDER BY r.played_at ASC`,
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
      console.error("❌ Erreur stats détaillées:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }
}

module.exports = new DjController();
