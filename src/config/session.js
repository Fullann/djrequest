const session = require('express-session');

// Validation du secret
if (!process.env.SESSION_SECRET) {
  console.error('❌ ERREUR: SESSION_SECRET doit être défini dans .env');
  process.exit(1);
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'djqueue.sid',
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
};

// Redis uniquement en production
if (process.env.NODE_ENV === 'production' && process.env.REDIS_URL) {
  try {
    const RedisStore = require('connect-redis').default;
    const { redisClient } = require('./redis');
    
    sessionConfig.store = new RedisStore({ 
      client: redisClient,
      prefix: 'djqueue:sess:',
      ttl: 7 * 24 * 60 * 60
    });
    
    console.log('✅ Redis session store configuré');
  } catch (error) {
    console.error('⚠️  Erreur config Redis, utilisation du store mémoire:', error.message);
  }
} else {
  console.log('ℹ️  Mode dev: Sessions en mémoire (pas de Redis)');
}

module.exports = sessionConfig;
