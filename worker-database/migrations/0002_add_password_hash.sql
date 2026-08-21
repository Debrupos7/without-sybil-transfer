-- Migration 0002: Add password_hash to users table for self-hosted auth
-- Removes dependency on Supabase Auth

ALTER TABLE users ADD COLUMN password_hash TEXT;
