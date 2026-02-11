const db = require("../config/database");

class RateLimitService {
  async getRateLimitSettings(eventId) {
    const [rows] = await db.query(
      "SELECT rate_limit_max, rate_limit_window_minutes FROM events WHERE id = ?",
      [eventId],
    );

    return rows[0] || { rate_limit_max: 3, rate_limit_window_minutes: 15 };
  }

  async checkRateLimit(socketId, eventId) {
    const settings = await this.getRateLimitSettings(eventId);
    const RATE_LIMIT_MAX_REQUESTS = settings.rate_limit_max;
    const RATE_LIMIT_WINDOW_MS = settings.rate_limit_window_minutes * 60 * 1000;
    const now = Date.now();

    const [rows] = await db.query(
      "SELECT * FROM rate_limits WHERE socket_id = ?",
      [socketId],
    );

    if (rows.length === 0) {
      await db.query(
        "INSERT INTO rate_limits (socket_id, request_count, reset_at) VALUES (?, 0, ?)",
        [socketId, now + RATE_LIMIT_WINDOW_MS],
      );

      return {
        allowed: true,
        count: 0,
        max: RATE_LIMIT_MAX_REQUESTS,
        remaining: RATE_LIMIT_MAX_REQUESTS,
      };
    }

    const limit = rows[0];

    if (now >= limit.reset_at) {
      await db.query(
        "UPDATE rate_limits SET request_count = 0, reset_at = ? WHERE socket_id = ?",
        [now + RATE_LIMIT_WINDOW_MS, socketId],
      );

      return {
        allowed: true,
        count: 0,
        max: RATE_LIMIT_MAX_REQUESTS,
        remaining: RATE_LIMIT_MAX_REQUESTS,
      };
    }

    if (limit.request_count >= RATE_LIMIT_MAX_REQUESTS) {
      const remainingTime = Math.ceil((limit.reset_at - now) / 1000 / 60);
      return {
        allowed: false,
        remainingTime,
        count: limit.request_count,
        max: RATE_LIMIT_MAX_REQUESTS,
      };
    }

    return {
      allowed: true,
      count: limit.request_count,
      max: RATE_LIMIT_MAX_REQUESTS,
      remaining: RATE_LIMIT_MAX_REQUESTS - limit.request_count,
    };
  }

  async incrementRateLimit(socketId) {
    await db.query(
      "UPDATE rate_limits SET request_count = request_count + 1 WHERE socket_id = ?",
      [socketId],
    );
  }

  async cleanupExpired() {
    const now = Date.now();
    await db.query("DELETE FROM rate_limits WHERE reset_at < ?", [
      now - 60 * 60 * 1000,
    ]);
  }
}

module.exports = new RateLimitService();
