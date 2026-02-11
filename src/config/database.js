const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'djuser',
  password: process.env.DB_PASSWORD || 'djpassword',
  database: process.env.DB_NAME || 'dj_queue',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Test de connexion
pool.getConnection()
  .then(connection => {
    console.log('✅ MySQL connecté avec succès');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Erreur connexion MySQL:', err.message);
    process.exit(1);
  });

module.exports = pool;
