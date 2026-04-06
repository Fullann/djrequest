const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { requireAuth } = require("../middlewares/auth");

// Lance le flow OAuth Spotify (redirect vers Spotify)
router.get("/spotify/login", authController.spotifyLogin);

// Déconnexion
router.post("/logout", requireAuth, authController.logout);

// Infos utilisateur connecté
router.get("/me", requireAuth, authController.getCurrentUser);

router.patch("/me", requireAuth, authController.updateDisplayName);

router.get("/stats", requireAuth, authController.getDjStats);

router.post("/spotify/disconnect", requireAuth, authController.disconnectSpotify);

module.exports = router;
