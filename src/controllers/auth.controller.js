const bcrypt = require('bcrypt');
const db = require('../config/database');

class AuthController {
  async register(req, res) {
    const { name, email, password } = req.body;

    try {
      // Vérifier si email existe
      const [existing] = await db.query(
        'SELECT id FROM djs WHERE email = ?', 
        [email]
      );

      if (existing.length > 0) {
        return res.status(400).json({ error: 'Cet email est déjà utilisé' });
      }

      // Hasher le mot de passe
      const hashedPassword = await bcrypt.hash(password, 12);

      // Créer le DJ
      const [result] = await db.query(
        'INSERT INTO djs (name, email, password) VALUES (?, ?, ?)',
        [name, email, hashedPassword]
      );

      // Créer la session
      req.session.djId = result.insertId;

      res.json({ 
        success: true,
        djId: result.insertId,
        name 
      });
    } catch (error) {
      console.error('Erreur inscription:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async login(req, res) {
    const { email, password } = req.body;

    try {
      const [rows] = await db.query(
        'SELECT * FROM djs WHERE email = ?', 
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      const dj = rows[0];
      const validPassword = await bcrypt.compare(password, dj.password);

      if (!validPassword) {
        return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      }

      // Créer la session
      req.session.djId = dj.id;

      res.json({ 
        success: true,
        djId: dj.id,
        name: dj.name 
      });
    } catch (error) {
      console.error('Erreur login:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  async logout(req, res) {
    req.session.destroy((err) => {
      if (err) {
        console.error('Erreur logout:', err);
        return res.status(500).json({ error: 'Erreur lors de la déconnexion' });
      }
      res.clearCookie('djqueue.sid');
      res.json({ success: true });
    });
  }

  async getCurrentUser(req, res) {
    try {
      const [rows] = await db.query(
        'SELECT id, name, email, created_at FROM djs WHERE id = ?',
        [req.session.djId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      res.json({ dj: rows[0] });
    } catch (error) {
      console.error('Erreur get user:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

module.exports = new AuthController();
