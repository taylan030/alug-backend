-- ALUG AFFILIATE MARKETPLACE - DATABASE MIGRATION
-- PostgreSQL Schema
-- Version: 2.0
-- Date: January 28, 2026

-- Drop existing tables if they exist (careful in production!)
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS conversions CASCADE;
DROP TABLE IF EXISTS clicks CASCADE;
DROP TABLE IF EXISTS affiliate_links CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price VARCHAR(50),
    price_value DECIMAL(10,2) DEFAULT 0,
    type VARCHAR(50) DEFAULT 'product',
    commission_type VARCHAR(20) DEFAULT 'percentage',
    commission_value DECIMAL(10,2) NOT NULL,
    category VARCHAR(100),
    image_data TEXT,
    product_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create affiliate_links table
CREATE TABLE affiliate_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    link_code VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create clicks table
CREATE TABLE clicks (
    id SERIAL PRIMARY KEY,
    link_id INTEGER NOT NULL REFERENCES affiliate_links(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create conversions table
CREATE TABLE conversions (
    id SERIAL PRIMARY KEY,
    link_id INTEGER NOT NULL REFERENCES affiliate_links(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    commission DECIMAL(10,2) NOT NULL,
    converted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create payouts table
CREATE TABLE payouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    payment_method VARCHAR(50),
    payment_details TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_affiliate_links_user_id ON affiliate_links(user_id);
CREATE INDEX idx_affiliate_links_product_id ON affiliate_links(product_id);
CREATE INDEX idx_affiliate_links_link_code ON affiliate_links(link_code);
CREATE INDEX idx_clicks_link_id ON clicks(link_id);
CREATE INDEX idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX idx_conversions_link_id ON conversions(link_id);
CREATE INDEX idx_conversions_converted_at ON conversions(converted_at);
CREATE INDEX idx_payouts_user_id ON payouts(user_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- Insert sample data (optional - comment out if not needed)

-- Sample admin user (password will be set separately)
-- INSERT INTO users (name, email, password, is_admin) 
-- VALUES ('Admin', 'admin@alug.com', '[HASH_WILL_BE_ADDED]', true);

-- Sample products
INSERT INTO products (name, description, price, price_value, type, commission_type, commission_value, category, product_url) VALUES
('Premium Marketing Course', 'Complete digital marketing course with 50+ hours of content', '€299', 299.00, 'service', 'percentage', 30.00, 'Education', 'https://example.com/marketing-course'),
('SEO Tool Pro', 'Advanced SEO analysis and tracking tool', '€49/mo', 49.00, 'service', 'percentage', 20.00, 'Software', 'https://example.com/seo-tool'),
('Affiliate Marketing Guide', 'Comprehensive ebook on affiliate marketing strategies', '€39', 39.00, 'product', 'fixed', 15.00, 'Education', 'https://example.com/affiliate-guide'),
('Web Hosting Premium', 'Fast and reliable web hosting solution', '€19.99/mo', 19.99, 'service', 'percentage', 25.00, 'Hosting', 'https://example.com/hosting'),
('Email Marketing Software', 'Professional email automation platform', '€79/mo', 79.00, 'service', 'percentage', 30.00, 'Software', 'https://example.com/email-software');

-- Verification queries (run these after migration to check)
-- SELECT COUNT(*) FROM users;
-- SELECT COUNT(*) FROM products;
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
