/**
 * Create Father of Zenna (Admin User)
 * Usage: node scripts/create-admin.js <username> <password>
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error('Usage: node scripts/create-admin.js <username> <password>');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
  }

  console.log('Connecting to Supabase...');
  const client = createClient(supabaseUrl, supabaseKey);

  // Check if username exists
  const { data: existingUser } = await client
    .from('users')
    .select('id')
    .eq('username', username)
    .single();

  if (existingUser) {
    console.error('Username already exists.');
    process.exit(1);
  }

  // Create admin user
  console.log('Creating admin user...');
  const passwordHash = await bcrypt.hash(password, 12);

  const { data: newUser, error } = await client
    .from('users')
    .insert({
      id: uuidv4(),
      username,
      password_hash: passwordHash,
      role: 'father',
      settings: {},
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create admin user:', error.message);
    process.exit(1);
  }

  console.log('\n✅ Admin user created successfully!');
  console.log('   Username:', username);
  console.log('   Role: Father of Zenna (admin)');
  console.log('   ID:', newUser.id);
  console.log('\nYou can now log in at /login with these credentials.');
}

main().catch(console.error);
