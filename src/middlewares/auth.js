const db = require("../config/database");

// Vérifier que l'utilisateur est authentifié
const requireAuth = (req, res, next) => {
  if (!req.session.djId) {
    return res.status(401).json({ error: "Non authentifié" });
  }
  next();
};

// Vérifier que le DJ possède l'événement
const requireEventOwnership = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const djId = req.session.djId;

    const [rows] = await db.query("SELECT dj_id FROM events WHERE id = ?", [
      eventId,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Événement non trouvé" });
    }

    if (rows[0].dj_id !== djId) {
      return res
        .status(403)
        .json({ error: "Accès refusé - Ce n'est pas votre événement" });
    }

    next();
  } catch (error) {
    console.error("Erreur vérification ownership:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// Middleware pour accès événement (propriétaire ou public)
const requireEventAccess = async (req, res, next) => {
  try {
    const { eventId } = req.params;

    // Vérifier que l'événement existe
    const [rows] = await db.query("SELECT dj_id FROM events WHERE id = ?", [
      eventId,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Événement non trouvé" });
    }

    // Si pas connecté, autoriser (pour utilisateurs publics)
    if (!req.session.djId) {
      return next();
    }

    // Si connecté et l'événement a un propriétaire, vérifier que c'est lui
    if (rows[0].dj_id && rows[0].dj_id !== req.session.djId) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    next();
  } catch (error) {
    console.error("Erreur vérification accès:", error);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

module.exports = {
  requireAuth,
  requireEventOwnership,
  requireEventAccess,
};
