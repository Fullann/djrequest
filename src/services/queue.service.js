const db = require("../config/database");

class QueueService {
  async getQueueWithVotes(eventId) {
    const [rows] = await db.query(
      `
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
    `,
      [eventId],
    );

    return rows;
  }

  async getRequestWithVotes(requestId) {
    const [rows] = await db.query(
      `
      SELECT r.*,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'up' THEN v.id END) as upvotes,
        COUNT(DISTINCT CASE WHEN v.vote_type = 'down' THEN v.id END) as downvotes
      FROM requests r
      LEFT JOIN votes v ON r.id = v.request_id
      WHERE r.id = ?
      GROUP BY r.id
    `,
      [requestId],
    );

    return rows[0];
  }

  async getNextQueuePosition(eventId) {
    const [maxPos] = await db.query(
      'SELECT MAX(queue_position) as max_pos FROM requests WHERE event_id = ? AND status = "accepted"',
      [eventId],
    );

    return (maxPos[0].max_pos || 0) + 1;
  }

  async checkDuplicate(eventId, spotifyUri) {
    if (!spotifyUri) return { isDuplicate: false };

    const [rows] = await db.query(
      'SELECT * FROM requests WHERE event_id = ? AND spotify_uri = ? AND status IN ("pending", "accepted")',
      [eventId, spotifyUri],
    );

    if (rows.length > 0) {
      return {
        isDuplicate: true,
        location: rows[0].status === "accepted" ? "queue" : "pending",
        song: rows[0],
      };
    }

    return { isDuplicate: false };
  }
}

module.exports = new QueueService();
