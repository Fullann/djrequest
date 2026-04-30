-- Mode urgence DJ + sondages live

ALTER TABLE events
  ADD COLUMN requests_frozen_until BIGINT NULL
    COMMENT 'timestamp ms ; si > NOW alors nouvelles demandes gelées';

CREATE TABLE IF NOT EXISTS event_live_polls (
  id            VARCHAR(36) PRIMARY KEY,
  event_id      VARCHAR(36) NOT NULL,
  question       VARCHAR(255) NOT NULL,
  options_json   JSON NOT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at       DATETIME NULL,
  KEY idx_live_polls_event_active (event_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_live_poll_votes (
  poll_id       VARCHAR(36) NOT NULL,
  client_id     VARCHAR(255) NOT NULL,
  option_index  INT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (poll_id, client_id),
  KEY idx_poll_votes_poll (poll_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

