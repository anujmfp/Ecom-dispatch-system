-- ========================================================
-- DispatchPro - Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ========================================================

-- 1. Create Orders Table
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  channel TEXT DEFAULT 'Other Marketplace',
  customer_name TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  address TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  items_summary TEXT,
  total_amount NUMERIC(10, 2) DEFAULT 0.00,
  tracking_number TEXT,
  pdf_filename TEXT,
  pdf_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'packed', 'dispatched')),
  source TEXT DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  packed_at TIMESTAMPTZ,
  packed_by TEXT,
  dispatched_at TIMESTAMPTZ,
  courier_name TEXT,
  notes TEXT DEFAULT ''
);

-- Index for speedy queries by status, channel, and order date
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- 2. Create System Settings Table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value)
VALUES (
  'app_config',
  '{"whatsapp_group_name": "MFP orders group", "auto_print_enabled": false, "sound_alerts": true, "filter_group": true}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- 3. Create Storage Bucket for Dispatch Label PDFs (Publicly accessible for direct printing)
INSERT INTO storage.buckets (id, name, public)
VALUES ('dispatch-labels', 'dispatch-labels', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy to allow public reads so factory staff can print directly
CREATE POLICY "Public Access to Dispatch Labels" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'dispatch-labels');

-- Policy to allow uploads from service role / backend
CREATE POLICY "Allow All Insert on Dispatch Labels" 
ON storage.objects FOR INSERT 
WITH CHECK (bucket_id = 'dispatch-labels');

-- Policy to allow updates on Dispatch Labels
CREATE POLICY "Allow All Update on Dispatch Labels" 
ON storage.objects FOR UPDATE 
USING (bucket_id = 'dispatch-labels');
