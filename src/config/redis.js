const redis = require("redis");

let redisClient = null;

// Créer le client uniquement si Redis est configuré ET en production
if (process.env.NODE_ENV === "production" && process.env.REDIS_URL) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
  });

  redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error:", err);
  });

  redisClient.on("connect", () => {
    console.log("✅ Redis connecté");
  });
} else {
  console.log("ℹ️  Redis non configuré (mode dev)");
}

async function connectRedis() {
  if (redisClient) {
    try {
      await redisClient.connect();
      console.log("✅ Connexion Redis établie");
    } catch (err) {
      console.error("❌ Impossible de se connecter à Redis:", err);
      // Ne pas exit en dev, juste logger
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    }
  } else {
    console.log("ℹ️  Pas de connexion Redis (store mémoire utilisé)");
  }
}

module.exports = { redisClient, connectRedis };
