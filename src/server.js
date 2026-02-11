require("dotenv").config();
const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
app.set("io", io);
const cookieParser = require("cookie-parser");
const session = require("express-session");
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

// Socket handlers
const setupSocketHandlers = require("./sockets/eventHandlers");

// Services
const rateLimitService = require("./services/rateLimit.service");

const PORT = process.env.PORT || 3000;

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
app.use(session(sessionConfig));

// === Static files (pas de rate limit) ===
app.use(express.static(path.join(__dirname, "/public")));
app.use("/views", express.static(path.join(__dirname, "/views")));

// === Routes API avec rate limiter spécifique ===
app.use("/api/auth", authRoutes);
app.use("/api/events", apiLimiter, eventsRoutes);
app.use("/api/dj", apiLimiter, djRoutes);
app.use("/api/spotify", apiLimiter, spotifyRoutes);

// === Routes vues (pas de rate limit) ===
app.get("/", (req, res) => {
  if (req.session.djId) {
    return res.redirect("/dashboard");
  }
  res.redirect("/login");
});

app.get("/login", (req, res) => {
  if (req.session.djId) {
    return res.redirect("/dashboard");
  }
  res.sendFile(path.join(__dirname, "/views/login.html"));
});

app.get("/register", (req, res) => {
  if (req.session.djId) {
    return res.redirect("/dashboard");
  }
  res.sendFile(path.join(__dirname, "/views/register.html"));
});

app.get("/dashboard", (req, res) => {
  if (!req.session.djId) {
    return res.redirect("/login");
  }
  res.sendFile(path.join(__dirname, "/views/dashboard.html"));
});

app.get("/history", (req, res) => {
  if (!req.session.djId) {
    return res.redirect("/login");
  }
  res.sendFile(__dirname + "/views/history.html");
});

// Route pour la page de stats détaillées d'un événement
app.get("/event/:eventId/stats", (req, res) => {
  if (!req.session.djId) {
    return res.redirect("/login");
  }
  res.sendFile(__dirname + "/views/event-stats.html");
});

app.get("/dj/:eventId", async (req, res) => {
  const { eventId } = req.params;

  // Vérifier que l'eventId est valide (format UUID)
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!eventId || !uuidRegex.test(eventId)) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Erreur</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-gray-100 min-h-screen flex items-center justify-center">
        <div class="bg-white p-8 rounded-xl shadow-lg max-w-md">
          <h1 class="text-2xl font-bold text-red-600 mb-4">Erreur</h1>
          <p class="text-gray-700 mb-4">ID d'événement invalide</p>
          <button 
            onclick="window.location.href='/dashboard'"
            class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
          >
            Retour au dashboard
          </button>
        </div>
      </body>
      </html>
    `);
  }

  try {
    // Vérifier que l'événement existe
    const [rows] = await db.query("SELECT * FROM events WHERE id = ?", [
      eventId,
    ]);

    if (rows.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Erreur</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 min-h-screen flex items-center justify-center">
          <div class="bg-white p-8 rounded-xl shadow-lg max-w-md">
            <h1 class="text-2xl font-bold text-red-600 mb-4">Erreur</h1>
            <p class="text-gray-700 mb-4">Événement non trouvé</p>
            <button 
              onclick="window.location.href='/dashboard'"
              class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
            >
              Retour au dashboard
            </button>
          </div>
        </body>
        </html>
      `);
    }

    // Si connecté, vérifier que c'est bien son événement
    if (
      req.session.djId &&
      rows[0].dj_id &&
      rows[0].dj_id !== req.session.djId
    ) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Erreur</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100 min-h-screen flex items-center justify-center">
          <div class="bg-white p-8 rounded-xl shadow-lg max-w-md">
            <h1 class="text-2xl font-bold text-red-600 mb-4">Accès refusé</h1>
            <p class="text-gray-700 mb-4">Ce n'est pas votre événement</p>
            <button 
              onclick="window.location.href='/dashboard'"
              class="bg-purple-600 text-white px-6 py-2 rounded-lg hover:bg-purple-700"
            >
              Retour au dashboard
            </button>
          </div>
        </body>
        </html>
      `);
    }

    res.sendFile(path.join(__dirname, "/views/dj.html"));
  } catch (error) {
    console.error("Erreur route /dj/:eventId:", error);
    res.status(500).send("Erreur serveur");
  }
});

app.get("/user/:eventId", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/user.html"));
});

app.get("/event/:eventId/qr", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/qr-display.html"));
});

app.get("/event/:eventId/thank-you", (req, res) => {
  res.sendFile(path.join(__dirname, "/views/thank-you.html"));
});

// ========== Route Spotify Callback ==========
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const eventId = req.query.state;

  if (!code || !eventId) {
    console.error("Code ou eventId manquant");
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

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Route non trouvée" });
});

// === WebSocket ===
setupSocketHandlers(io);

// === Nettoyage périodique ===
setInterval(
  () => {
    rateLimitService.cleanupExpired();
  },
  60 * 60 * 1000,
);

// === Démarrage ===
async function start() {
  try {
    // Connecter Redis seulement en production
    if (process.env.NODE_ENV === "production") {
      await connectRedis();
    }

    http.listen(PORT, () => {
      console.log(`🎵 Serveur sur http://localhost:${PORT}`);
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
