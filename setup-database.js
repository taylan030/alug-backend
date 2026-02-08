const { Pool } = require('pg');

const pool = new Pool({
connectionString: 'postgresql://alug_user:u5uKakhc2HBjTvbnx4oDZuKqgrueY5aE@dpg-d644oae3jp1c73bgglo0-a.frankfurt-postgres.render.com/alug_db',
  ssl: { rejectUnauthorized: false }
});

const setupDatabase = async () => {
  try {
    await pool.query(`
      DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS conversions CASCADE;
DROP TABLE IF EXISTS clicks CASCADE;
DROP TABLE IF EXISTS affiliate_links CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  username VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  balance DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price TEXT,
        price_value NUMERIC,
        type TEXT,
        commission_type TEXT,
        commission_value TEXT,
        category TEXT,
        image_data TEXT,
        product_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS affiliate_links (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        product_id INTEGER REFERENCES products(id),
        link_code VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS clicks (
        id SERIAL PRIMARY KEY,
        link_id INTEGER REFERENCES affiliate_links(id),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS conversions (
        id SERIAL PRIMARY KEY,
        link_id INTEGER REFERENCES affiliate_links(id),
        amount DECIMAL(10,2),
        commission DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✅ Tables created!');
    
    await pool.query(`
      INSERT INTO users (email, password, username, role) 
VALUES ('admin@alug.com', '$2b$10$vZ9YvGZ0Zq8aE8xZ9YvGZ0Zq8aE8xZ9YvGZ0Zq8aE8xZ9YvGZ0Zq', 'Admin', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);
    
    console.log('✅ Admin user created!');
    console.log('✅ Database setup complete!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
};

setupDatabase();