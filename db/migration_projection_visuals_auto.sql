-- Option: changer automatiquement d'effet visuel à chaque nouvelle musique
ALTER TABLE events
  ADD COLUMN projection_visuals_auto_per_track TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '1 = alterner/randomiser les effets à chaque nouveau morceau projeté';

