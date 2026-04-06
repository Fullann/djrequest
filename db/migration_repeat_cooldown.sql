-- Anti-répétition : délai minimum (minutes) avant de redemander une piste déjà jouée (0 = désactivé)
ALTER TABLE events
  ADD COLUMN repeat_cooldown_minutes INT UNSIGNED NOT NULL DEFAULT 0
  COMMENT '0 = off ; même URI non reproposable avant X min après played_at';
