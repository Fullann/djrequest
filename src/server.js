require("dotenv").config();
const express = require("express");
const app = express();
app.set('trust proxy', 1);
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  // Désactivé : perMessageDeflate utilise des bits réservés WebSocket
  // que certains proxies (nginx o2switch) ne gèrent pas, causant des déconnexions.
  perMessageDeflate: false,
});
app.set("io", io);
const cookieParser = require("cookie-parser");
const session = require("express-session");
const crypto = require("crypto");
const path = require("path");

// Config
const { connectRedis } = require("./config/redis");
const sessionConfig = require("./config/session");
const {
  helmetConfig,
  globalLimiter,
  apiLimiter,
  sanitizeInput,
} = require("./middlewares/security");
const db = require("./config/database");

// Routes
const authRoutes = require("./routes/auth.routes");
const eventsRoutes = require("./routes/events.routes");
const djRoutes = require("./routes/dj.routes");
const spotifyRoutes = require("./routes/spotify.routes");
const authController = require("./controllers/auth.controller");

// Socket handlers
const setupSocketHandlers = require("./sockets/eventHandlers");

// Services
const rateLimitService = require("./services/rateLimit.service");

const PORT = Number(process.env.PORT) || 3000;
const HOST =
  process.env.HOST ||
  process.env.IP ||
  // Passenger/containers need a real interface binding
  "0.0.0.0";

function renderErrorPage(res, _status, title, message, opts = {}) {
  const { code = String(_status), back, backLabel } = opts;
  const qs = new URLSearchParams({ code, title, message });
  if (back)      qs.set("back", back);
  if (backLabel) qs.set("backLabel", backLabel);
  // Redirection vers la page d'erreur branded (conserve le message, pas le code HTTP)
  return res.redirect(`/error?${qs.toString()}`);
}

// === Middlewares de sécurité ===
app.use(helmetConfig);
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());
app.use(sanitizeInput);

// Rate limiter global SEULEMENT en production
if (process.env.NODE_ENV === "production") {
  app.use(globalLimiter);
}

// === Session ===
const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);
// Partager la session Express avec Socket.IO UNE SEULE FOIS par connexion (io.use)
// et NON pas sur chaque requête HTTP de polling (io.engine.use serait trop coûteux).
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// === CSRF (Double Submit Cookie + Session token) ===
const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidCsrfTokenFormat(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}

app.use((req, res, next) => {
  // Générer un token CSRF par session si absent
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }

  // Exposer le token dans un cookie lisible par JS (double-submit cookie pattern)
  res.cookie("XSRF-TOKEN", req.session.csrfToken, {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: false,
  });

  if (SAFE_HTTP_METHODS.has(req.method)) {
    return next();
  }

  const providedToken =
    req.get("x-csrf-token") || req.body?._csrf || req.query?._csrf;

  if (!providedToken) {
    return res.status(403).json({ error: "Token CSRF manquant" });
  }

  if (!isValidCsrfTokenFormat(providedToken)) {
    return res.status(403).json({ error: "Token CSRF invalide" });
  }

  const expectedBuffer = Buffer.from(req.session.csrfToken, "utf8");
  const providedBuffer = Buffer.from(providedToken, "utf8");
  const isValid =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    return res.status(403).json({ error: "Token CSRF invalide" });
  }

  return next();
});

const HEALTH_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Monitoring (UptimeRobot, Better Stack, etc.)
app.get("/health", async (req, res) => {
  const uptime = Math.floor(process.uptime());
  let dbStatus = "ok";
  try {
    await db.query("SELECT 1");
  } catch {
    dbStatus = "error";
  }

  let redisStatus = "skipped";
  if (process.env.NODE_ENV === "production") {
    try {
      const { redisClient } = require("./config/redis");
      if (redisClient?.isOpen) {
        await redisClient.ping();
        redisStatus = "ok";
      } else if (redisClient) {
        redisStatus = "error";
      }
    } catch {
      redisStatus = "error";
    }
  }

  const degraded = dbStatus !== "ok" || redisStatus === "error";
  res.status(degraded ? 503 : 200).json({
    status: degraded ? "degraded" : "ok",
    uptime,
    db:     dbStatus,
    redis:  redisStatus,
  });
});

// Manifest PWA dynamique (start_url = page invité de la soirée)
app.get("/manifest-user.json", (req, res) => {
  const e = req.query.e;
  if (!e || !HEALTH_UUID_RE.test(String(e))) {
    return res.status(400).type("application/json").json({
      error: "Paramètre e (UUID de l'événement) requis",
    });
  }
  res.type("application/manifest+json").json({
    name:             "DJ Queue",
    short_name:       "DJ Queue",
    description:      "Proposer des morceaux à la soirée",
    start_url:        `/user/${e}`,
    scope:            "/",
    display:          "standalone",
    background_color: "#0f0f12",
    theme_color:      "#6366f1",
    orientation:      "portrait-primary",
    prefer_related_applications: false,
  });
});

// === Static files (pas de rate limit) ===
app.use(express.static(path.join(__dirname, "/public")));
// NOTE: /views n'est PAS exposé en static — les HTML sont servis uniquement via
// les routes dédiées ci-dessous afin que les vérifications de session soient appliquées.

// === Callback Spotify OAuth (login DJ) — GET, doit être avant CSRF POST checks ===
app.get("/auth/spotify/callback", authController.spotifyCallback);

// === Routes API avec rate limiter spécifique ===
app.use("/api/auth", authRoutes);
app.use("/api/events", apiLimiter, eventsRoutes);
app.use("/api/dj", apiLimiter, djRoutes);
app.use("/api/spotify", apiLimiter, spotifyRoutes);

app.get("/", (req, res) => {
  if (req.session.djId) {
    return res.redirect("/dashboard");
  }
  // Sinon, afficher la page d'accueil
  res.sendFile(path.join(__dirname, "/views/index.html"));
});

app.get("/login", (req, res) => {
  if (req.session.djId) {
    return res.redirect("/dashboard");
  }
  res.sendFile(path.join(__dirname, "/views/login.html"));
});

app.get("/register", (req, res) => {
  // Plus de création de compte séparée : redirection vers login Spotify
  res.redirect("/login");
});

app.get("/dashboard", (req, res) => {
  if (!req.session.djId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "/views/dashboard.html"));
});

app.get("/profile", (req, res) => {
  if (!req.session.djId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "/views/profile.html"));
});

app.get("/history", (req, res) => {
  if (!req.session.djId) return res.redirect("/");
  res.sendFile(__dirname + "/views/history.html");
});

app.get("/event/:eventId/stats", (req, res) => {
  if (!req.session.djId) return res.redirect("/");
  res.sendFile(__dirname + "/views/event-stats.html");
});

app.get("/dj/:eventId", async (req, res) => {
  const { eventId } = req.params;

  // Vérifier que l'eventId est valide (format UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!eventId || !uuidRegex.test(eventId)) {
    return renderErrorPage(res, 400, "Erreur", "ID d'événement invalide");
  }

  try {
    // Vérifier que l'événement existe
    const [rows] = await db.query("SELECT * FROM events WHERE id = ?", [
      eventId,
    ]);

    if (rows.length === 0) {
      return renderErrorPage(res, 404, "Erreur", "Événement non trouvé");
    }

    // Non connecté → page d'accueil
    if (!req.session.djId) return res.redirect("/");

    // Connecté mais mauvais propriétaire
    if (rows[0].dj_id && rows[0].dj_id !== req.session.djId) {
      return renderErrorPage(res, 403, "Accès refusé", "Ce n'est pas votre événement");
    }

    res.sendFile(path.join(__dirname, "/views/dj.html"));
  } catch (error) {
    console.error("Erreur route /dj/:eventId:", error);
    res.status(500).send("Erreur serveur");
  }
});

app.get("/user/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(eventId)) {
    return renderErrorPage(res, 404, "Soirée introuvable", "Ce lien est invalide. Scanne à nouveau le QR code.");
  }
  try {
    const [rows] = await db.query("SELECT ended_at, starts_at FROM events WHERE id = ?", [eventId]);
    if (rows.length === 0) {
      return renderErrorPage(res, 404, "Soirée introuvable",
        "Cette soirée n'existe pas. Vérifie le lien ou scanne à nouveau le QR code.",
        { code: "404" });
    }
    if (rows[0].ended_at) {
      return renderErrorPage(res, 410, "Soirée terminée",
        "Cette soirée est maintenant terminée. Merci d'avoir participé !",
        { code: "ended" });
    }
    if (rows[0].starts_at && new Date(rows[0].starts_at) > new Date()) {
      const opensAt = new Date(rows[0].starts_at).toLocaleString("fr-FR", {
        day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
      });
      return renderErrorPage(res, 200, "Soirée à venir",
        `Les demandes de musique ouvrent le ${opensAt}. Reviens à ce moment-là !`,
        { code: "scheduled", back: `/user/${eventId}`, backLabel: "Vérifier à nouveau" });
    }
    res.sendFile(path.join(__dirname, "/views/user.html"));
  } catch {
    res.sendFile(path.join(__dirname, "/views/user.html"));
  }
});

app.get("/event/:eventId/qr", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/qr-display.html"));
});

app.get("/event/:eventId/thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/thank-you.html"));
});

// Page d'erreur branded (rendue côté client via query params)
app.get("/error", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/error.html"));
});

// ========== Modération ==========

// Générer un token modérateur (DJ uniquement)
app.post("/api/events/:eventId/generate-mod-token", async (req, res) => {
  if (!req.session.djId) return res.status(401).json({ error: "Non authentifié" });
  const { eventId } = req.params;
  try {
    const [rows] = await db.query("SELECT id FROM events WHERE id = ? AND dj_id = ?", [eventId, req.session.djId]);
    if (rows.length === 0) return res.status(403).json({ error: "Accès refusé" });
    const token = crypto.randomBytes(32).toString("hex");
    await db.query("UPDATE events SET mod_token = ? WHERE id = ?", [token, eventId]);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    res.json({ token, modUrl: `${baseUrl}/mod/${eventId}?token=${token}` });
  } catch (err) {
    console.error("Erreur generate-mod-token:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Révoquer le token modérateur (DJ uniquement)
app.post("/api/events/:eventId/revoke-mod-token", async (req, res) => {
  if (!req.session.djId) return res.status(401).json({ error: "Non authentifié" });
  const { eventId } = req.params;
  try {
    const [rows] = await db.query("SELECT id FROM events WHERE id = ? AND dj_id = ?", [eventId, req.session.djId]);
    if (rows.length === 0) return res.status(403).json({ error: "Accès refusé" });
    await db.query("UPDATE events SET mod_token = NULL WHERE id = ?", [eventId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Login modérateur : valider le token et créer la session
app.get("/mod/:eventId", async (req, res) => {
  const { eventId } = req.params;
  const { token } = req.query;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Déjà connecté comme mod pour cet event → page mod directement
  if (req.session.modAccess?.eventId === eventId) {
    return res.sendFile(path.join(__dirname, "/views/mod.html"));
  }

  if (!uuidRegex.test(eventId)) return renderErrorPage(res, 400, "Erreur", "ID invalide");

  if (!token) {
    return renderErrorPage(res, 403, "Accès refusé", "Lien de modération invalide ou expiré.");
  }

  try {
    const [rows] = await db.query(
      "SELECT id, name FROM events WHERE id = ? AND mod_token = ? AND ended_at IS NULL",
      [eventId, token],
    );
    if (rows.length === 0) {
      return renderErrorPage(res, 403, "Lien invalide", "Ce lien de modération est invalide ou la soirée est terminée.");
    }
    // Créer la session modérateur
    req.session.modAccess = { eventId, eventName: rows[0].name };
    res.sendFile(path.join(__dirname, "/views/mod.html"));
  } catch (err) {
    console.error("Erreur /mod/:eventId:", err);
    res.status(500).send("Erreur serveur");
  }
});

// Déconnexion modérateur
app.post("/api/auth/mod-logout", (req, res) => {
  req.session.modAccess = null;
  res.json({ success: true });
});

// ========== Route Spotify Callback (connexion Spotify par event) ==========
app.get("/callback", async (req, res) => {
  // Vérification de l'authentification DJ
  if (!req.session.djId) {
    return res.redirect("/?error=not_authenticated");
  }

  const code    = req.query.code;
  const eventId = req.query.state;

  if (!code || !eventId) {
    console.error("Code ou eventId manquant");
    return res.redirect("/dashboard?error=spotify_auth_failed");
  }

  // Vérifier que le DJ est propriétaire de l'event avant d'accepter le token
  try {
    const [ownerRows] = await db.query(
      "SELECT id FROM events WHERE id = ? AND dj_id = ?",
      [eventId, req.session.djId],
    );
    if (ownerRows.length === 0) {
      return res.redirect("/dashboard?error=event_not_found");
    }
  } catch {
    return res.redirect("/dashboard?error=spotify_auth_failed");
  }

  try {
    const axios = require("axios");

    const tokenResponse = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri:
          process.env.SPOTIFY_REDIRECT_URI || "http://localhost:3000/callback",
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Utiliser un timestamp Unix en millisecondes (BIGINT)
    const expiresAt = Date.now() + expires_in * 1000;

    await db.query(
      `INSERT INTO spotify_tokens (event_id, access_token, refresh_token, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       expires_at = VALUES(expires_at)`,
      [eventId, access_token, refresh_token || null, expiresAt],
    );

    res.redirect(`/dj/${eventId}?spotify=connected`);
  } catch (error) {
    console.error(
      "❌ Erreur lors de l'authentification Spotify:",
      error.response?.data || error.message,
    );
    if (error.sqlMessage) {
      console.error("❌ Erreur SQL:", error.sqlMessage);
    }
    res.redirect(`/dj/${eventId}?error=spotify_auth_failed`);
  }
});

// === Gestion d'erreurs globale ===
app.use((err, req, res, next) => {
  console.error("Erreur:", err);
  res.status(err.status || 500).json({
    error: err.message || "Erreur serveur",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// 404 — JSON pour les routes API, page branded pour les routes HTML
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Route non trouvée" });
  }
  return renderErrorPage(res, 404, "Page introuvable",
    "La page que tu cherches n'existe pas ou a été déplacée.",
    { code: "404" });
});

// === WebSocket ===
setupSocketHandlers(io);

// === Nettoyage périodique ===
setInterval(() => {
  rateLimitService.cleanupExpired();
  db.query("DELETE FROM user_bans WHERE banned_until IS NOT NULL AND banned_until < ?", [
    Date.now(),
  ]).catch((err) => console.error("Purge bans expirés:", err));
}, 60 * 60 * 1000);

// === Stabilité du processus ===
// Empêcher un rejet de promesse non géré de crasher silencieusement le serveur.
process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️  Unhandled Rejection:", reason);
  // Ne pas exit — on logue uniquement pour que Passenger/PM2 puisse redémarrer proprement si besoin.
});

process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught Exception:", err);
  // On laisse le gestionnaire de processus décider du redémarrage.
});

// === Démarrage ===
async function start() {
  try {
    // Connecter Redis seulement en production
    if (process.env.NODE_ENV === "production") {
      await connectRedis();
    }

    http.listen(PORT, HOST, () => {
      const baseUrl =
        process.env.BASE_URL || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
      console.log(`🎵 Serveur démarré: ${baseUrl}`);
      if (process.env.NODE_ENV === "production") {
        console.log(`🔴 Redis: Sessions persistantes`);
        console.log(`⚡ Rate limiting: Activé (500 req/15min)`);
      } else {
        console.log(`⚠️  Dev: Sessions en mémoire`);
        console.log(`⚡ Rate limiting: Mode permissif`);
      }
    });
  } catch (error) {
    console.error("❌ Erreur démarrage:", error);
    process.exit(1);
  }
}

start();
