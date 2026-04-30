-- Objectif de dons visuel + co-DJ rôles + journal d'actions

ALTER TABLE events
  ADD COLUMN donation_goal_amount DECIMAL(10,2) NOT NULL DEFAULT 0
    COMMENT 'Objectif visuel de dons pour la soirée (0 = off)',
  ADD COLUMN donations_raised_total DECIMAL(10,2) NOT NULL DEFAULT 0
    COMMENT 'Montant collecté affiché (manuel/indicatif)';

CREATE TABLE IF NOT EXISTS co_dj_tokens (
  id           VARCHAR(36) PRIMARY KEY,
  event_id     VARCHAR(36) NOT NULL,
  role         VARCHAR(24) NOT NULL,
  token        VARCHAR(64) NOT NULL,
  label        VARCHAR(120) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   DATETIME NULL,
  UNIQUE KEY uq_co_dj_token (token),
  KEY idx_co_dj_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS event_action_logs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_id     VARCHAR(36) NOT NULL,
  actor_type   VARCHAR(24) NOT NULL,
  actor_name   VARCHAR(120) NULL,
  actor_role   VARCHAR(24) NULL,
  action_type  VARCHAR(48) NOT NULL,
  target_id    VARCHAR(80) NULL,
  meta_json    JSON NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_action_logs_event (event_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

