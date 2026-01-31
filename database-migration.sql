-- ============================================
-- ALUG AFFILIATE MARKETPLACE - DATABASE SCHEMA
-- Complete Migration Script
-- ============================================

-- Drop existing tables if they exist (in correct order due to foreign keys)
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS conversions CASCADE;
DROP TABLE IF EXISTS clicks CASCADE;
DROP TABLE IF EXISTS affiliate_links CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster email lookups
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- 2. PRODUCTS TABLE
-- ============================================
CREATE TABLE products (
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for category filtering
CREATE INDEX idx_products_category ON products(category);

-- ============================================
-- 3. AFFILIATE LINKS TABLE
-- ============================================
CREATE TABLE affiliate_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    link_code VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster lookups
CREATE INDEX idx_affiliate_links_user_id ON affiliate_links(user_id);
CREATE INDEX idx_affiliate_links_product_id ON affiliate_links(product_id);
CREATE INDEX idx_affiliate_links_link_code ON affiliate_links(link_code);

-- ============================================
-- 4. CLICKS TABLE
-- ============================================
CREATE TABLE clicks (
    id SERIAL PRIMARY KEY,
    link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics
CREATE INDEX idx_clicks_link_id ON clicks(link_id);
CREATE INDEX idx_clicks_clicked_at ON clicks(clicked_at);

-- ============================================
-- 5. CONVERSIONS TABLE
-- ============================================
CREATE TABLE conversions (
    id SERIAL PRIMARY KEY,
    link_id INTEGER REFERENCES affiliate_links(id) ON DELETE CASCADE,
    amount DECIMAL(10,2),
    commission DECIMAL(10,2),
    converted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for analytics
CREATE INDEX idx_conversions_link_id ON conversions(link_id);
CREATE INDEX idx_conversions_converted_at ON conversions(converted_at);

-- ============================================
-- 6. PAYOUTS TABLE
-- ============================================
CREATE TABLE payouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    payment_method VARCHAR(100),
    payment_details TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX idx_payouts_user_id ON payouts(user_id);
CREATE INDEX idx_payouts_status ON payouts(status);

-- ============================================
-- VERIFICATION QUERY
-- Run this after migration to verify all tables exist:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
-- 
-- Expected output: 6 tables
-- - users
-- - products
-- - affiliate_links
-- - clicks
-- - conversions
-- - payouts
-- ============================================