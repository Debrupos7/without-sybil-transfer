# Security Documentation for Sybil v5

## Authentication Security

The application uses Supabase for authentication and database storage. Row Level Security (RLS) has been implemented on all public tables to ensure users can only access their own data.

### Authentication Configuration

- **Status**: Row Level Security (RLS) is enabled on all tables - `user_networks`, `user_contracts`, `transactions`, `user_wallets`, and `default_networks`
- **Policy Structure**: 
  - Users can only access their own data (SELECT, INSERT, UPDATE, DELETE) in user-related tables
  - Public users can view default networks, but only the service role can modify them (INSERT, UPDATE, DELETE)

### Setup Instructions

1. Ensure the JWT secret is correctly set in your Supabase project settings
2. For local development, create a `.env.local` file with the following variables:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your-project-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
3. Only use the service role key in server-side code, never expose it in the client

## Security Best Practices

1. **Authentication**:
   - Always check user authentication before allowing sensitive operations
   - Use RLS policies to enforce data access controls at the database level

2. **API Security**:
   - Use server-side endpoints for sensitive operations
   - Implement rate limiting for API endpoints

3. **Input Validation**:
   - Sanitize all user inputs to prevent injection attacks
   - Validate Ethereum addresses before processing
   - Use parameterized queries when interacting with the database

4. **Environment Security**:
   - Keep service role keys secure and only use them in server-side code
   - Use different API keys for development and production

## Security Checks

Run these checks regularly to ensure your application remains secure:

1. Check RLS status:
   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```

2. Check security policies:
   ```sql
   SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname;
   ```

## Reporting Security Issues

If you discover a security vulnerability, please send an email to [security@example.com](mailto:security@example.com). Do not disclose security issues publicly until they have been handled by the security team. 