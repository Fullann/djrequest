-- Migration: playlist Spotify de secours par événement
ALTER TABLE `events`
  ADD COLUMN `fallback_playlist_uri` VARCHAR(255) NULL DEFAULT NULL;
