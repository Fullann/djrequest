-- Option FK (MariaDB / o2switch souvent en utf8mb4_unicode_ci)
-- A utiliser uniquement si events.id est en utf8mb4_unicode_ci et events ENGINE=InnoDB

CREATE TABLE IF NOT EXISTS abuse_scores (
  event_id        VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  client_id       VARCHAR(255) NOT NULL,
  score           DECIMAL(8,2) NOT NULL DEFAULT 0,
  throttle_until  BIGINT       NULL,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, client_id),
  CONSTRAINT fk_abuse_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

