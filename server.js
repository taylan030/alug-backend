// ============================================
// ALUG AFFILIATE MARKETPLACE - BACKEND SERVER
// Production Ready Version with Health Endpoint
// ============================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/api/health', async (req, res) => {
  try {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), port: PORT, env: process.env.NODE_ENV });
  } catch (err) {
    res.status(500).json({ status: 'error', timestamp: new Date().toISOString(), error: err.message });
  }
});

app.get('/', (req, res) => { res.send('Backend is running!'); });
app.get('/test', (req, res) => { res.json({ message: 'Test successful', timestamp: new Date() }); });

// ============================================
// DATABASE CONNECTION
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('❌ Database connection error:', err);
  else console.log('✅ Database connected successfully');
});

// ============================================
// CREATE TABLES (AUTO-RUN ON STARTUP)
// ============================================
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price VARCHAR(50),
        price_value DECIMAL(10,2),
        type VARCHAR(50) DEFAULT 'product',
        commission_type VARCHAR(20) DEFAULT 'percentage',
        commission_value DECIMAL(10,2),
        category VARCHAR(100),
        image_data TEXT,
        product_url TEXT,
        attribution_days INTEGER DEFAULT 30,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS affiliate_links (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        link_code VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clicks (
        id SERIAL PRIMARY KEY,
        link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversions (
        id SERIAL PRIMARY KEY,
        link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
        amount DECIMAL(10,2),
        commission DECIMAL(10,2),
        converted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        payment_method VARCHAR(100),
        payment_details TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_affiliate_links_user_id ON affiliate_links(user_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_links_product_id ON affiliate_links(product_id);
      CREATE INDEX IF NOT EXISTS idx_affiliate_links_link_code ON affiliate_links(link_code);
      CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
      CREATE INDEX IF NOT EXISTS idx_conversions_link_id ON conversions(link_id);
      CREATE INDEX IF NOT EXISTS idx_payouts_user_id ON payouts(user_id);
    `);

    // Attribution days Spalte hinzufügen falls sie noch nicht existiert (für bestehende DBs)
    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS attribution_days INTEGER DEFAULT 30;
    `);

    console.log('✅ Database tables created successfully');
  } catch (err) {
    console.error('❌ Error creating tables:', err);
  } finally {
    client.release();
  }
}

createTables();

// ============================================
// CREATE ADMIN USER (AUTO-RUN ON STARTUP)
// ============================================
async function createAdminUser() {
  try {
    const adminEmail = 'admin@alug.com';
    const adminPassword = 'admin123';
    
    const existingAdmin = await pool.query('SELECT * FROM users WHERE email = $1', [adminEmail]);

    if (existingAdmin.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await pool.query(
        'INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)',
        ['Admin', adminEmail, hashedPassword, true]
      );
      console.log('✅ Admin user created successfully');
    } else {
      console.log('ℹ️  Admin user already exists');
    }
  } catch (err) {
    console.error('❌ Admin user creation error:', err);
  }
}

setTimeout(createAdminUser, 2000);

// ============================================
// JWT MIDDLEWARE
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) return res.status(400).json({ error: 'Email already registered' });

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await pool.query(
      'INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, name, email, is_admin',
      [name || email, email, hashedPassword, false]
    );

    const token = jwt.sign(
      { userId: result.rows[0].id, email: result.rows[0].email, isAdmin: false },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: result.rows[0].id, name: result.rows[0].name, email: result.rows[0].email, isAdmin: false } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET || 'default-secret-key',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, isAdmin: user.is_admin } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============================================
// PRODUCT ROUTES
// ============================================
app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.post('/api/products', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl, attributionDays } = req.body;
    
    const result = await pool.query(
      'INSERT INTO products (name, description, price, price_value, type, commission_type, commission_value, category, image_data, product_url, attribution_days) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl, attributionDays || 30]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Product creation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl, attributionDays } = req.body;

    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, price_value=$4, type=$5, 
       commission_type=$6, commission_value=$7, category=$8, image_data=$9, product_url=$10, attribution_days=$11
       WHERE id=$12 RETURNING *`,
      [name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl, attributionDays || 30, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

app.delete('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// ============================================
// AFFILIATE LINK ROUTES
// ============================================
app.post('/api/affiliate/generate', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user.userId;

    const existingLink = await pool.query(
      'SELECT * FROM affiliate_links WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    );

    if (existingLink.rows.length > 0) return res.json({ link: existingLink.rows[0] });

    const linkCode = `${userId}-${productId}-${Date.now()}`;
    const result = await pool.query(
      'INSERT INTO affiliate_links (user_id, product_id, link_code) VALUES ($1, $2, $3) RETURNING *',
      [userId, productId, linkCode]
    );

    res.json({ link: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate affiliate link' });
  }
});

app.get('/api/affiliate/my-links', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      `SELECT al.*, p.name as product_name, p.image_data, p.price,
              (SELECT COUNT(*) FROM clicks WHERE link_id = al.id) as clicks,
              (SELECT COUNT(*) FROM conversions WHERE link_id = al.id) as conversions,
              (SELECT COALESCE(SUM(commission), 0) FROM conversions WHERE link_id = al.id) as revenue
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       WHERE al.user_id = $1
       ORDER BY al.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch affiliate links' });
  }
});

app.get('/api/affiliate/link/:code', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT al.*, p.product_url FROM affiliate_links al JOIN products p ON al.product_id = p.id WHERE al.link_code = $1`,
      [req.params.code]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Link not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch link' });
  }
});

// ============================================
// WEBHOOK - CONVERSION TRACKING
// ============================================
// Partner trägt diese URL in seinen Shop ein:
// https://alug-backend.onrender.com/api/webhook/conversion?secret=KEY&link_code=LINK_CODE&amount=BETRAG
// secret = WEBHOOK_SECRET aus .env
// link_code = der Affiliate Link Code des Partners
// amount = der Verkaufspreis (wird vom Shop automatisch übergeben)

app.get('/api/webhook/conversion', async (req, res) => {
  try {
    const { secret, link_code, amount } = req.query;

    // 1. Secret prüfen
    const webhookSecret = process.env.WEBHOOK_SECRET || 'alug-webhook-secret-2024';
    if (secret !== webhookSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    // 2. Link Code prüfen
    if (!link_code || !amount) {
      return res.status(400).json({ error: 'link_code and amount are required' });
    }

    // 3. Affiliate Link + Produkt laden
    const linkResult = await pool.query(
      `SELECT al.id, al.user_id, al.product_id, p.commission_type, p.commission_value, p.attribution_days
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       WHERE al.link_code = $1`,
      [link_code]
    );

    if (linkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = linkResult.rows[0];
    const attributionDays = link.attribution_days || 30;

    // 4. Prüfen ob ein Click innerhalb des Attribution Windows existiert
    const clickResult = await pool.query(
      `SELECT id FROM clicks 
       WHERE link_id = $1 
       AND clicked_at >= NOW() - INTERVAL '${attributionDays} days'
       ORDER BY clicked_at DESC 
       LIMIT 1`,
      [link.id]
    );

    if (clickResult.rows.length === 0) {
      return res.status(400).json({ 
        error: `No click found within attribution window (${attributionDays} days)` 
      });
    }

    // 5. Commission berechnen
    const saleAmount = parseFloat(amount);
    let commission;
    if (link.commission_type === 'percentage') {
      commission = (saleAmount * parseFloat(link.commission_value)) / 100;
    } else {
      commission = parseFloat(link.commission_value);
    }

    // 6. Conversion speichern
    await pool.query(
      'INSERT INTO conversions (link_id, amount, commission) VALUES ($1, $2, $3)',
      [link.id, saleAmount, commission]
    );

    console.log(`✅ Conversion tracked: link_code=${link_code}, amount=${saleAmount}€, commission=${commission}€`);

    res.json({ 
      success: true, 
      message: 'Conversion tracked successfully',
      commission: commission.toFixed(2)
    });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to track conversion' });
  }
});

// POST Version des Webhooks (für Shops die POST verwenden)
app.post('/api/webhook/conversion', async (req, res) => {
  try {
    const { secret, link_code, amount } = { ...req.query, ...req.body };

    const webhookSecret = process.env.WEBHOOK_SECRET || 'alug-webhook-secret-2024';
    if (secret !== webhookSecret) return res.status(401).json({ error: 'Invalid webhook secret' });
    if (!link_code || !amount) return res.status(400).json({ error: 'link_code and amount are required' });

    const linkResult = await pool.query(
      `SELECT al.id, al.user_id, al.product_id, p.commission_type, p.commission_value, p.attribution_days
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       WHERE al.link_code = $1`,
      [link_code]
    );

    if (linkResult.rows.length === 0) return res.status(404).json({ error: 'Link not found' });

    const link = linkResult.rows[0];
    const attributionDays = link.attribution_days || 30;

    const clickResult = await pool.query(
      `SELECT id FROM clicks 
       WHERE link_id = $1 
       AND clicked_at >= NOW() - INTERVAL '${attributionDays} days'
       ORDER BY clicked_at DESC LIMIT 1`,
      [link.id]
    );

    if (clickResult.rows.length === 0) {
      return res.status(400).json({ error: `No click found within attribution window (${attributionDays} days)` });
    }

    const saleAmount = parseFloat(amount);
    let commission;
    if (link.commission_type === 'percentage') {
      commission = (saleAmount * parseFloat(link.commission_value)) / 100;
    } else {
      commission = parseFloat(link.commission_value);
    }

    await pool.query(
      'INSERT INTO conversions (link_id, amount, commission) VALUES ($1, $2, $3)',
      [link.id, saleAmount, commission]
    );

    res.json({ success: true, message: 'Conversion tracked successfully', commission: commission.toFixed(2) });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to track conversion' });
  }
});

// ============================================
// TRACKING ROUTES
// ============================================
app.post('/api/track/click', async (req, res) => {
  try {
    const { linkCode, ipAddress, userAgent } = req.body;
    const linkResult = await pool.query('SELECT id FROM affiliate_links WHERE link_code = $1', [linkCode]);
    if (linkResult.rows.length === 0) return res.status(404).json({ error: 'Link not found' });
    await pool.query('INSERT INTO clicks (link_id, ip_address, user_agent) VALUES ($1, $2, $3)', [linkResult.rows[0].id, ipAddress, userAgent]);
    res.json({ message: 'Click tracked successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to track click' });
  }
});

// ============================================
// ANALYTICS ROUTES
// ============================================
app.get('/api/analytics/my-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const stats = await pool.query(
      `SELECT 
        (SELECT COALESCE(SUM(c.commission), 0) FROM conversions c JOIN affiliate_links al ON c.link_id = al.id WHERE al.user_id = $1) as total_earnings,
        (SELECT COUNT(*) FROM clicks cl JOIN affiliate_links al ON cl.link_id = al.id WHERE al.user_id = $1) as total_clicks,
        (SELECT COUNT(*) FROM conversions c JOIN affiliate_links al ON c.link_id = al.id WHERE al.user_id = $1) as total_conversions,
        (SELECT COUNT(*) FROM affiliate_links WHERE user_id = $1) as active_links`,
      [userId]
    );
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/analytics/daily-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const dailyStats = await pool.query(
      `SELECT DATE(clicked_at) as date, COUNT(*) as clicks,
        (SELECT COUNT(*) FROM conversions c2 JOIN affiliate_links al2 ON c2.link_id = al2.id 
         WHERE al2.user_id = $1 AND DATE(c2.converted_at) = DATE(cl.clicked_at)) as conversions
       FROM clicks cl JOIN affiliate_links al ON cl.link_id = al.id
       WHERE al.user_id = $1 AND cl.clicked_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(clicked_at) ORDER BY date`,
      [userId]
    );
    res.json(dailyStats.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch daily stats' });
  }
});

app.get('/api/analytics/product-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const productStats = await pool.query(
      `SELECT p.id, p.name, p.image_data, COALESCE(SUM(c.commission), 0) as revenue, COUNT(DISTINCT c.id) as conversions
       FROM products p
       LEFT JOIN affiliate_links al ON p.id = al.product_id AND al.user_id = $1
       LEFT JOIN conversions c ON al.id = c.link_id
       GROUP BY p.id, p.name, p.image_data ORDER BY revenue DESC LIMIT 5`,
      [userId]
    );
    res.json(productStats.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product stats' });
  }
});

// ============================================
// LEADERBOARD ROUTES
// ============================================
app.get('/api/leaderboard/products', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.name, p.image_data, COALESCE(SUM(c.commission), 0) as revenue, COUNT(DISTINCT c.id) as conversions
       FROM products p LEFT JOIN affiliate_links al ON p.id = al.product_id LEFT JOIN conversions c ON al.id = c.link_id
       GROUP BY p.id, p.name, p.image_data ORDER BY revenue DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

app.get('/api/leaderboard/marketers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, COALESCE(SUM(c.commission), 0) as revenue, COUNT(DISTINCT c.id) as conversions, COUNT(DISTINCT cl.id) as clicks
       FROM users u LEFT JOIN affiliate_links al ON u.id = al.user_id LEFT JOIN conversions c ON al.id = c.link_id LEFT JOIN clicks cl ON al.id = cl.link_id
       WHERE u.is_admin = false GROUP BY u.id, u.name ORDER BY revenue DESC LIMIT 10`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ============================================
// PAYOUT ROUTES
// ============================================
app.get('/api/payouts/balance', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await pool.query(
      `SELECT 
        COALESCE(SUM(c.commission), 0) as total_earned,
        COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status = 'paid'), 0) as total_paid,
        COALESCE(SUM(c.commission), 0) - COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status = 'paid'), 0) as available_balance
       FROM conversions c JOIN affiliate_links al ON c.link_id = al.id WHERE al.user_id = $1`,
      [userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

app.get('/api/payouts/my-payouts', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM payouts WHERE user_id = $1 ORDER BY requested_at DESC', [req.user.userId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

app.post('/api/payouts/request', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, paymentMethod, paymentDetails } = req.body;

    if (amount < 10) return res.status(400).json({ error: 'Minimum payout amount is €10' });

    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(c.commission), 0) - COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status = 'paid'), 0) as available_balance
       FROM conversions c JOIN affiliate_links al ON c.link_id = al.id WHERE al.user_id = $1`,
      [userId]
    );

    if (amount > parseFloat(balanceResult.rows[0].available_balance)) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const result = await pool.query(
      'INSERT INTO payouts (user_id, amount, payment_method, payment_details) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, amount, paymentMethod, paymentDetails]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to request payout' });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================
app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at,
        COALESCE(SUM(c.commission), 0) as total_earnings,
        COUNT(DISTINCT al.id) as total_links,
        COUNT(DISTINCT cl.id) as total_clicks,
        COUNT(DISTINCT c.id) as total_conversions
       FROM users u LEFT JOIN affiliate_links al ON u.id = al.user_id LEFT JOIN clicks cl ON al.id = cl.link_id LEFT JOIN conversions c ON al.id = c.link_id
       WHERE u.is_admin = false GROUP BY u.id, u.name, u.email, u.created_at ORDER BY total_earnings DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/admin/conversions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, al.link_code, u.name as user_name, p.name as product_name
       FROM conversions c JOIN affiliate_links al ON c.link_id = al.id JOIN users u ON al.user_id = u.id JOIN products p ON al.product_id = p.id
       ORDER BY c.converted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});

app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_users,
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM conversions) as total_sales,
        (SELECT COALESCE(SUM(amount), 0) FROM conversions) as total_revenue`
    );
    res.json(stats.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

app.get('/api/admin/payouts', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name as user_name, u.email as user_email FROM payouts p JOIN users u ON p.user_id = u.id ORDER BY p.requested_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

app.put('/api/admin/payouts/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE payouts SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [req.body.status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Payout not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update payout' });
  }
});

// ============================================
// AFFILIATE REDIRECT ROUTE
// ============================================
app.get('/aff/:code', async (req, res) => {
  try {
    const { code } = req.params;

    const result = await pool.query(
      `SELECT al.id, p.product_url FROM affiliate_links al JOIN products p ON al.product_id = p.id WHERE al.link_code = $1`,
      [code]
    );

    if (result.rows.length === 0) return res.status(404).send('Link not found');

    const { id, product_url } = result.rows[0];

    await pool.query(
      'INSERT INTO clicks (link_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [id, req.ip, req.headers['user-agent']]
    );

    res.redirect(product_url);
  } catch (err) {
    console.error('Redirect error:', err);
    res.status(500).send('Error');
  }
});

// ============================================
// ERROR HANDLING
// ============================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.error(`🚀 Server running on port ${PORT}`);
  console.error(`✅ Health endpoint: http://0.0.0.0:${PORT}/api/health`);
});