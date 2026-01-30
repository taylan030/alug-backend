// ============================================
// ALUG AFFILIATE MARKETPLACE - BACKEND API (VERBESSERT)
// Node.js + Express + PostgreSQL + Nodemailer
// ============================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================
// DATABASE SCHEMA (Run this first!)
// ============================================
const createTables = async () => {
  const query = `
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
      price VARCHAR(100),
      price_value DECIMAL(10,2),
      type VARCHAR(50),
      commission_type VARCHAR(50),
      commission_value DECIMAL(10,2),
      category VARCHAR(100),
      image_data TEXT,
      product_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS affiliate_links (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      product_id INTEGER REFERENCES products(id),
      link_code VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clicks (
      id SERIAL PRIMARY KEY,
      link_id INTEGER REFERENCES affiliate_links(id),
      ip_address VARCHAR(50),
      user_agent TEXT,
      clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversions (
      id SERIAL PRIMARY KEY,
      link_id INTEGER REFERENCES affiliate_links(id),
      amount DECIMAL(10,2),
      commission DECIMAL(10,2),
      converted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      payment_method VARCHAR(100),
      payment_details TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processed_at TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_affiliate_links_user ON affiliate_links(user_id);
    CREATE INDEX IF NOT EXISTS idx_affiliate_links_product ON affiliate_links(product_id);
    CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(link_id);
    CREATE INDEX IF NOT EXISTS idx_conversions_link ON conversions(link_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
  `;
  
  try {
    await pool.query(query);
    console.log('✅ Database tables created successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error);
  }
};

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ============================================
// AUTH ROUTES
// ============================================

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, is_admin',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: user.is_admin
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PRODUCT ROUTES
// ============================================

app.get('/api/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl } = req.body;

    const result = await pool.query(
      `INSERT INTO products (name, description, price, price_value, type, commission_type, commission_value, category, image_data, product_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl } = req.body;

    const result = await pool.query(
      `UPDATE products SET name=$1, description=$2, price=$3, price_value=$4, type=$5, 
       commission_type=$6, commission_value=$7, category=$8, image_data=$9, product_url=$10
       WHERE id=$11 RETURNING *`,
      [name, description, price, priceValue, type, commissionType, commissionValue, category, imageData, productUrl, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// AFFILIATE LINK ROUTES
// ============================================

app.post('/api/affiliate/generate', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user.userId;

    const existing = await pool.query(
      'SELECT * FROM affiliate_links WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    );

    if (existing.rows.length > 0) {
      return res.json(existing.rows[0]);
    }

    const linkCode = `${userId}-${productId}-${Date.now()}`;

    const result = await pool.query(
      'INSERT INTO affiliate_links (user_id, product_id, link_code) VALUES ($1, $2, $3) RETURNING *',
      [userId, productId, linkCode]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/affiliate/my-links', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        al.*, 
        p.name as product_name, 
        p.price, 
        p.commission_type, 
        p.commission_value,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.commission), 0) as revenue
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       LEFT JOIN clicks c ON al.id = c.link_id
       LEFT JOIN conversions conv ON al.id = conv.link_id
       WHERE al.user_id = $1
       GROUP BY al.id, p.id
       ORDER BY al.created_at DESC`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get link by code (public for redirect)
app.get('/api/affiliate/link/:code', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT al.*, p.product_url, p.name 
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       WHERE al.link_code = $1`,
      [req.params.code]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/track/click', async (req, res) => {
  try {
    const { linkCode } = req.body;
    const ipAddress = req.ip;
    const userAgent = req.headers['user-agent'];

    const linkResult = await pool.query('SELECT id FROM affiliate_links WHERE link_code = $1', [linkCode]);
    
    if (linkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    await pool.query(
      'INSERT INTO clicks (link_id, ip_address, user_agent) VALUES ($1, $2, $3)',
      [linkResult.rows[0].id, ipAddress, userAgent]
    );

    res.json({ message: 'Click tracked' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/track/conversion', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { linkCode, amount } = req.body;

    const linkResult = await pool.query(
      `SELECT al.id, al.user_id, u.email, u.name, p.name as product_name, p.commission_type, p.commission_value
       FROM affiliate_links al
       JOIN products p ON al.product_id = p.id
       JOIN users u ON al.user_id = u.id
       WHERE al.link_code = $1`,
      [linkCode]
    );

    if (linkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Link not found' });
    }

    const link = linkResult.rows[0];
    let commission;

    if (link.commission_type === 'percentage') {
      commission = (amount * link.commission_value) / 100;
    } else {
      commission = link.commission_value;
    }

    await pool.query(
      'INSERT INTO conversions (link_id, amount, commission) VALUES ($1, $2, $3)',
      [link.id, amount, commission]
    );

    // TODO: Send email notification (implement with nodemailer)
    console.log(`📧 Email notification: ${link.name} earned ${commission}€ from ${link.product_name}`);

    res.json({ message: 'Conversion tracked', commission });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ANALYTICS ROUTES
// ============================================

app.get('/api/analytics/daily-stats', authenticateToken, async (req, res) => {
  try {
    const clicksResult = await pool.query(
      `SELECT 
        DATE(clicked_at) as date,
        COUNT(*) as clicks
       FROM clicks c
       JOIN affiliate_links al ON c.link_id = al.id
       WHERE al.user_id = $1 
       AND clicked_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(clicked_at)
       ORDER BY date ASC`,
      [req.user.userId]
    );

    const conversionsResult = await pool.query(
      `SELECT 
        DATE(conv.converted_at) as date,
        COUNT(*) as conversions,
        SUM(conv.commission) as revenue
       FROM conversions conv
       JOIN affiliate_links al ON conv.link_id = al.id
       WHERE al.user_id = $1 
       AND conv.converted_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(conv.converted_at)
       ORDER BY date ASC`,
      [req.user.userId]
    );

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const clickData = clicksResult.rows.find(r => r.date.toISOString().split('T')[0] === dateStr);
      const convData = conversionsResult.rows.find(r => r.date.toISOString().split('T')[0] === dateStr);
      
      last7Days.push({
        date: dateStr,
        clicks: clickData ? parseInt(clickData.clicks) : 0,
        conversions: convData ? parseInt(convData.conversions) : 0,
        revenue: convData ? parseFloat(convData.revenue) : 0
      });
    }

    res.json(last7Days);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analytics/product-stats', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        p.id, 
        p.name,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.commission), 0) as revenue
       FROM products p
       JOIN affiliate_links al ON p.id = al.product_id
       LEFT JOIN clicks c ON al.id = c.link_id
       LEFT JOIN conversions conv ON al.id = conv.link_id
       WHERE al.user_id = $1
       GROUP BY p.id
       ORDER BY revenue DESC
       LIMIT 5`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// LEADERBOARD ROUTES
// ============================================

app.get('/api/leaderboard/products', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        p.id, p.name, p.category, p.price,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.amount), 0) as revenue
       FROM products p
       LEFT JOIN affiliate_links al ON p.id = al.product_id
       LEFT JOIN clicks c ON al.id = c.link_id
       LEFT JOIN conversions conv ON al.id = conv.link_id
       GROUP BY p.id
       ORDER BY revenue DESC
       LIMIT 10`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/leaderboard/marketers', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, u.name, u.email,
        COUNT(DISTINCT c.id) as clicks,
        COUNT(DISTINCT conv.id) as conversions,
        COALESCE(SUM(conv.commission), 0) as revenue
       FROM users u
       LEFT JOIN affiliate_links al ON u.id = al.user_id
       LEFT JOIN clicks c ON al.id = c.link_id
       LEFT JOIN conversions conv ON al.id = conv.link_id
       WHERE u.is_admin = false
       GROUP BY u.id
       ORDER BY revenue DESC
       LIMIT 10`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PAYOUT ROUTES
// ============================================

// Request payout
app.post('/api/payouts/request', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod, paymentDetails } = req.body;

    // Check available balance
    const balanceResult = await pool.query(
      `SELECT COALESCE(SUM(conv.commission), 0) as earned,
              COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status != 'rejected'), 0) as paid
       FROM conversions conv
       JOIN affiliate_links al ON conv.link_id = al.id
       WHERE al.user_id = $1`,
      [req.user.userId]
    );

    const balance = parseFloat(balanceResult.rows[0].earned) - parseFloat(balanceResult.rows[0].paid);

    if (amount > balance) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    if (amount < 10) {
      return res.status(400).json({ error: 'Minimum payout amount is 10€' });
    }

    const result = await pool.query(
      `INSERT INTO payouts (user_id, amount, payment_method, payment_details)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.userId, amount, paymentMethod, paymentDetails]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get my payouts
app.get('/api/payouts/my-payouts', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM payouts 
       WHERE user_id = $1 
       ORDER BY requested_at DESC`,
      [req.user.userId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available balance
app.get('/api/payouts/balance', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COALESCE(SUM(conv.commission), 0) as total_earned,
        COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status IN ('pending', 'approved', 'paid')), 0) as total_paid,
        COALESCE(SUM(conv.commission), 0) - COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = $1 AND status IN ('pending', 'approved', 'paid')), 0) as available
       FROM conversions conv
       JOIN affiliate_links al ON conv.link_id = al.id
       WHERE al.user_id = $1`,
      [req.user.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN ROUTES
// ============================================

app.get('/api/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, u.name, u.email, u.is_admin, u.created_at,
        COUNT(DISTINCT al.id) as total_links,
        COUNT(DISTINCT c.id) as total_clicks,
        COUNT(DISTINCT conv.id) as total_conversions,
        COALESCE(SUM(conv.commission), 0) as total_earnings
       FROM users u
       LEFT JOIN affiliate_links al ON u.id = al.user_id
       LEFT JOIN clicks c ON al.id = c.link_id
       LEFT JOIN conversions conv ON al.id = conv.link_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/conversions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT conv.*, al.link_code, u.name as user_name, u.email, p.name as product_name
       FROM conversions conv
       JOIN affiliate_links al ON conv.link_id = al.id
       JOIN users u ON al.user_id = u.id
       JOIN products p ON al.product_id = p.id
       ORDER BY conv.converted_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all payout requests (Admin)
app.get('/api/admin/payouts', authenticateToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.name, u.email
       FROM payouts p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.requested_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update payout status (Admin)
app.put('/api/admin/payouts/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    
    const result = await pool.query(
      `UPDATE payouts 
       SET status = $1, processed_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Dashboard Stats
app.get('/api/admin/stats', authenticateToken, isAdmin, async (req, res) => {
  try {
    const stats = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM users WHERE is_admin = false) as total_users,
        (SELECT COUNT(*) FROM products) as total_products,
        (SELECT COUNT(*) FROM affiliate_links) as total_links,
        (SELECT COUNT(*) FROM clicks) as total_clicks,
        (SELECT COUNT(*) FROM conversions) as total_conversions,
        (SELECT COALESCE(SUM(amount), 0) FROM conversions) as total_revenue,
        (SELECT COALESCE(SUM(commission), 0) FROM conversions) as total_commissions`
    );
    res.json(stats.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SERVER START
// ============================================

const createAdminUser = async () => {
  try {
    const adminExists = await pool.query('SELECT * FROM users WHERE email = $1', ['admin@alug.com']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (name, email, password, is_admin) VALUES ($1, $2, $3, $4)',
        ['Admin', 'admin@alug.com', hashedPassword, true]
      );
      console.log('✅ Admin user created: admin@alug.com / admin123');
    }
  } catch (err) {
    console.error('Admin user creation error:', err);
  }
};

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await createTables();
  await createAdminUser();
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});