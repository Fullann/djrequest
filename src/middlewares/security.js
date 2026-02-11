const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sanitizeHtml = require("sanitize-html");

// Configuration Helmet adaptée au projet
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.tailwindcss.com",
        "https://cdn.socket.io",
        "https://cdn.jsdelivr.net", // ← AJOUTER pour Sortable.js
        "https://sdk.scdn.co", // ← AJOUTER pour Spotify SDK
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "https://i.scdn.co"],
      connectSrc: [
        "'self'",
        "https://api.spotify.com",
        "https://accounts.spotify.com", // ← AJOUTER pour auth Spotify
        "wss:",
        "ws:",
      ],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", "https://p.scdn.co"], // ← AJOUTER pour previews Spotify
      frameSrc: ["https://sdk.scdn.co"], // ← AJOUTER pour SDK Spotify
      upgradeInsecureRequests:
        process.env.NODE_ENV === "production" ? [] : null,
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

// Rate limiting global - BEAUCOUP PLUS PERMISSIF
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 500 : 10000,
  message: "Trop de requêtes, réessaie plus tard",
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.path.match(
      /\.(css|js|jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf|eot)$/i,
    );
  },
});

// Rate limiting strict pour les routes d'authentification
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Trop de tentatives de connexion, réessaie dans 15 minutes",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting pour les API (hors auth)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 60 : 1000,
  message: "Trop de requêtes API, ralentis un peu",
  standardHeaders: true,
  legacyHeaders: false,
});

// Sanitization des inputs
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach((key) => {
      if (typeof req.body[key] === "string") {
        req.body[key] = sanitizeHtml(req.body[key], {
          allowedTags: [],
          allowedAttributes: {},
        });
      }
    });
  }

  if (req.query) {
    Object.keys(req.query).forEach((key) => {
      if (typeof req.query[key] === "string") {
        req.query[key] = sanitizeHtml(req.query[key], {
          allowedTags: [],
          allowedAttributes: {},
        });
      }
    });
  }

  next();
};

module.exports = {
  helmetConfig,
  globalLimiter,
  authLimiter,
  apiLimiter,
  sanitizeInput,
};
