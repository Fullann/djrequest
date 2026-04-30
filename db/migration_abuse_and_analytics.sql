-- Anti-abus progressif + analytics audio/skip

CREATE TABLE IF NOT EXISTS abuse_scores (
  event_id        VARCHAR(36)  NOT NULL,
  client_id       VARCHAR(255) NOT NULL,
  score           DECIMAL(8,2) NOT NULL DEFAULT 0,
  throttle_until  BIGINT       NULL,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, client_id),
  KEY idx_abuse_event_id (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS track_audio_cache (
  track_id      VARCHAR(64) PRIMARY KEY,
  bpm           INT NULL,
  energy        DECIMAL(5,2) NULL,
  popularity    INT NULL,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE requests
  ADD COLUMN play_started_at DATETIME NULL AFTER played_at,
  ADD COLUMN skipped_at DATETIME NULL AFTER play_started_at;

