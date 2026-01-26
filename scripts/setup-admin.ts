/**
 * Setup Script: Create Father of Zenna (Admin User)
 *
 * Run with: npx ts-node scripts/setup-admin.ts
 *
 * This script creates the initial admin user (Father of Zenna)
 * who has full control over Zenna's master configuration.
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function main() {
  console.log('\n🌟 Zenna Admin Setup\n');
  console.log('This script will create the Father of Zenna (admin user).\n');

  // Get environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    console.error('\nPlease set these in your .env.local file and try again.');
    process.exit(1);
  }

  const client = createClient(supabaseUrl, supabaseKey);

  // Check if admin already exists
  const { data: existingAdmin } = await client
    .from('users')
    .select('*')
    .eq('role', 'father')
    .single();

  if (existingAdmin) {
    console.log('⚠️  An admin user (Father) already exists.');
    const confirm = await question('Do you want to create another admin? (y/N): ');

    if (confirm.toLowerCase() !== 'y') {
      console.log('\nSetup cancelled.');
      rl.close();
      process.exit(0);
    }
  }

  // Get admin credentials
  const username = await question('Enter admin username: ');
  const password = await question('Enter admin password (min 8 chars): ');

  if (!username || username.length < 3) {
    console.error('❌ Username must be at least 3 characters.');
    rl.close();
    process.exit(1);
  }

  if (!password || password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    rl.close();
    process.exit(1);
  }

  // Check if username exists
  const { data: existingUser } = await client
    .from('users')
    .select('id')
    .eq('username', username)
    .single();

  if (existingUser) {
    console.error('❌ Username already exists.');
    rl.close();
    process.exit(1);
  }

  // Create admin user
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
    console.error('❌ Failed to create admin user:', error.message);
    rl.close();
    process.exit(1);
  }

  console.log('\n✅ Admin user created successfully!\n');
  console.log('   Username:', username);
  console.log('   Role: Father of Zenna (admin)');
  console.log('   ID:', newUser.id);
  console.log('\nYou can now log in at /login with these credentials.');

  rl.close();
}

main().catch(console.error);
