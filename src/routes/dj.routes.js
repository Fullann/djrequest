const express = require("express");
const router = express.Router();
const djController = require("../controllers/dj.controller");
const { requireAuth } = require("../middlewares/auth");

// Dashboard - Événements actifs
router.get("/dashboard", requireAuth, djController.getDashboard);

// Historique - Événements terminés
router.get("/history", requireAuth, djController.getHistory);

// Stats détaillées d'un événement
router.get("/event/:eventId/stats", requireAuth, djController.getDetailedStats);

module.exports = router;
