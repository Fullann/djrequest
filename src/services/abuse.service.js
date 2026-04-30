const db = require("../config/database");

class AbuseService {
  _computePenalty(score) {
    // Pénalité progressive (throttle + réduction du quota)
    if (score >= 10) return { waitMs: 10 * 60 * 1000, maxReduction: 2 };
    if (score >= 6) return { waitMs: 2 * 60 * 1000, maxReduction: 1 };
    if (score >= 3) return { waitMs: 30 * 1000, maxReduction: 1 };
    return { waitMs: 0, maxReduction: 0 };
  }

  async getStatus(eventId, clientId) {
    const [rows] = await db.query(
      "SELECT score, throttle_until FROM abuse_scores WHERE event_id = ? AND client_id = ?",
      [eventId, clientId],
    );
    if (rows.length === 0) {
      return {
        score: 0,
        throttled: false,
        remainingMs: 0,
        maxReduction: 0,
      };
    }
    const row = rows[0];
    const score = Number(row.score || 0);
    const now = Date.now();
    const remainingMs = row.throttle_until ? Math.max(0, row.throttle_until - now) : 0;
    const penalty = this._computePenalty(score);
    return {
      score,
      throttled: remainingMs > 0,
      remainingMs,
      maxReduction: penalty.maxReduction,
    };
  }

  async addStrike(eventId, clientId, amount = 1) {
    const [rows] = await db.query(
      "SELECT score FROM abuse_scores WHERE event_id = ? AND client_id = ?",
      [eventId, clientId],
    );
    const currentScore = rows.length > 0 ? Number(rows[0].score || 0) : 0;
    const nextScore = Math.max(0, currentScore + Number(amount || 0));
    const penalty = this._computePenalty(nextScore);
    const throttleUntil = penalty.waitMs > 0 ? Date.now() + penalty.waitMs : null;

    await db.query(
      `INSERT INTO abuse_scores (event_id, client_id, score, throttle_until)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         score = VALUES(score),
         throttle_until = VALUES(throttle_until)`,
      [eventId, clientId, nextScore, throttleUntil],
    );
    return this.getStatus(eventId, clientId);
  }

  async decay(eventId, clientId, amount = 0.2) {
    const [rows] = await db.query(
      "SELECT score, throttle_until FROM abuse_scores WHERE event_id = ? AND client_id = ?",
      [eventId, clientId],
    );
    if (rows.length === 0) return this.getStatus(eventId, clientId);

    const currentScore = Number(rows[0].score || 0);
    const nextScore = Math.max(0, currentScore - Number(amount || 0));
    await db.query(
      "UPDATE abuse_scores SET score = ? WHERE event_id = ? AND client_id = ?",
      [nextScore, eventId, clientId],
    );
    return this.getStatus(eventId, clientId);
  }
}

module.exports = new AbuseService();

