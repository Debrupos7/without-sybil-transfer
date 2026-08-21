#!/usr/bin/env node

/**
 * Database Security Check Guide
 * 
 * This script provides instructions for checking:
 * 1. RLS (Row Level Security) status for all tables
 * 2. Security policies on tables
 * 
 * Rather than trying to access the database directly, which can be complex
 * due to permissions and environment differences, this script provides
 * the SQL commands that you can run in the Supabase SQL Editor.
 */

console.log('='.repeat(80));
console.log('SUPABASE DATABASE SECURITY CHECK GUIDE');
console.log('='.repeat(80));
console.log('\n');

console.log('To check your database security, follow these steps:');
console.log('\n');

console.log('1. Log in to your Supabase Dashboard');
console.log('2. Go to the SQL Editor');
console.log('3. Run the following SQL commands:');
console.log('\n');

console.log('CHECKING ROW LEVEL SECURITY STATUS:');
console.log('-'.repeat(50));
console.log(`
-- This shows all tables in the public schema and whether RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- If you see any tables with 'rowsecurity = false', you should enable RLS with:
-- ALTER TABLE public.TABLE_NAME ENABLE ROW LEVEL SECURITY;
`);

console.log('\n');
console.log('CHECKING SECURITY POLICIES:');
console.log('-'.repeat(50));
console.log(`
-- This shows all security policies for tables in the public schema
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  permissive,
  roles, 
  cmd, 
  qual, 
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- If you don't see any policies for a table with RLS enabled, that table
-- will be inaccessible. You should create policies like:

-- CREATE POLICY "Users can view their own data" ON "public"."TABLE_NAME" 
--   FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own data" ON "public"."TABLE_NAME" 
--   FOR INSERT WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own data" ON "public"."TABLE_NAME" 
--   FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own data" ON "public"."TABLE_NAME" 
--   FOR DELETE USING (auth.uid() = user_id);
`);

console.log('\n');
console.log('CHECKING FOR JWT SECRET:');
console.log('-'.repeat(50));
console.log(`
-- This checks if the JWT secret is configured
SELECT current_setting('pgrst.jwt_secret', true) IS NOT NULL as jwt_secret_exists;

-- If this returns FALSE, you need to set up your JWT secret in the Supabase dashboard:
-- 1. Go to Project Settings > API
-- 2. Check that the JWT Secret is properly configured
`);

console.log('\n');
console.log('='.repeat(80));
console.log('SECURITY CHECK GUIDE COMPLETE');
console.log('='.repeat(80));
console.log('\n');
console.log('Follow the instructions in the SECURITY.md file for more details on securing your application.'); 