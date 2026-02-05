/**
 * Quick script to check existing memories in Supabase
 * Run with: node scripts/check-memories.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function checkMemories() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Checking memories in Supabase...\n');

  // Get count of session turns
  const { count: totalCount, error: countError } = await supabase
    .from('session_turns')
    .select('*', { count: 'exact', head: true });

  if (countError) {
    console.error('Error:', countError.message);
    process.exit(1);
  }

  console.log(`Total memories: ${totalCount || 0}\n`);

  if (totalCount === 0) {
    console.log('No memories found in Supabase.');
    return;
  }

  // Get breakdown by user
  const { data: turns, error } = await supabase
    .from('session_turns')
    .select('user_id, role, content, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching turns:', error.message);
    process.exit(1);
  }

  // Group by user
  const byUser = {};
  for (const turn of turns) {
    if (!byUser[turn.user_id]) {
      byUser[turn.user_id] = [];
    }
    byUser[turn.user_id].push(turn);
  }

  console.log('Memories by user:');
  for (const [userId, userTurns] of Object.entries(byUser)) {
    console.log(`\n  User: ${userId.substring(0, 8)}...`);
    console.log(`    Turns: ${userTurns.length} (showing up to 100 most recent)`);

    // Show sample content
    const userMessages = userTurns.filter(t => t.role === 'user').slice(0, 3);
    if (userMessages.length > 0) {
      console.log('    Sample user messages:');
      for (const msg of userMessages) {
        const preview = msg.content.substring(0, 80).replace(/\n/g, ' ');
        console.log(`      - "${preview}${msg.content.length > 80 ? '...' : ''}"`);
      }
    }
  }

  console.log('\n---');
  console.log(`Ready to migrate ${totalCount} memories to Qdrant.`);
  console.log('Run: npx ts-node scripts/migrate-to-qdrant.ts');
}

checkMemories().catch(console.error);
