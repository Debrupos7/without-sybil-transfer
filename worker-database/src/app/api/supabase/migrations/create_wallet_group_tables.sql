-- Function to create wallet_groups table
CREATE OR REPLACE FUNCTION create_wallet_groups_table()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Create the table if it doesn't exist
  CREATE TABLE IF NOT EXISTS wallet_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  
  -- Set up RLS
  ALTER TABLE wallet_groups ENABLE ROW LEVEL SECURITY;
  
  -- Drop existing policies if any
  DROP POLICY IF EXISTS "Users can view their own wallet groups" ON wallet_groups;
  DROP POLICY IF EXISTS "Users can insert their own wallet groups" ON wallet_groups;
  DROP POLICY IF EXISTS "Users can update their own wallet groups" ON wallet_groups;
  DROP POLICY IF EXISTS "Users can delete their own wallet groups" ON wallet_groups;
  
  -- Create policies
  CREATE POLICY "Users can view their own wallet groups" 
  ON wallet_groups FOR SELECT 
  USING (auth.uid() = user_id);
  
  CREATE POLICY "Users can insert their own wallet groups" 
  ON wallet_groups FOR INSERT 
  WITH CHECK (auth.uid() = user_id);
  
  CREATE POLICY "Users can update their own wallet groups" 
  ON wallet_groups FOR UPDATE 
  USING (auth.uid() = user_id);
  
  CREATE POLICY "Users can delete their own wallet groups" 
  ON wallet_groups FOR DELETE 
  USING (auth.uid() = user_id);
END;
$$;

-- Function to create wallet_group_members table
CREATE OR REPLACE FUNCTION create_wallet_group_members_table()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Create the table if it doesn't exist
  CREATE TABLE IF NOT EXISTS wallet_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES wallet_groups(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES user_wallets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, wallet_id)
  );
  
  -- Set up RLS
  ALTER TABLE wallet_group_members ENABLE ROW LEVEL SECURITY;
  
  -- Drop existing policies if any
  DROP POLICY IF EXISTS "Users can view members of their wallet groups" ON wallet_group_members;
  DROP POLICY IF EXISTS "Users can insert members into their wallet groups" ON wallet_group_members;
  DROP POLICY IF EXISTS "Users can delete members from their wallet groups" ON wallet_group_members;
  
  -- Create policies
  CREATE POLICY "Users can view members of their wallet groups" 
  ON wallet_group_members FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM wallet_groups
      WHERE wallet_groups.id = wallet_group_members.group_id
      AND wallet_groups.user_id = auth.uid()
    )
  );
  
  CREATE POLICY "Users can insert members into their wallet groups" 
  ON wallet_group_members FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM wallet_groups
      WHERE wallet_groups.id = wallet_group_members.group_id
      AND wallet_groups.user_id = auth.uid()
    )
  );
  
  CREATE POLICY "Users can delete members from their wallet groups" 
  ON wallet_group_members FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM wallet_groups
      WHERE wallet_groups.id = wallet_group_members.group_id
      AND wallet_groups.user_id = auth.uid()
    )
  );
END;
$$; 