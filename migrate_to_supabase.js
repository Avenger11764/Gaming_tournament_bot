const { createClient } = require('@supabase/supabase-js');
const { db } = require('./firebase');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_KEY are required in .env!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);


async function migrateData() {
  console.log('🚀 Starting Firebase to Supabase Migration...\n');

  // 1. Migrate Users
  console.log('📦 Migrating Users...');
  const usersSnap = await db.collection('users').get();
  const users = [];
  usersSnap.forEach(doc => {
    const data = doc.data();
    users.push({
      telegram_id: String(doc.id),
      username: data.username || null,
      first_name: data.first_name || null,
      in_game_name: data.in_game_name || 'Player',
      status: data.status || 'Active',
      team_id: data.team_id ? String(data.team_id) : null,
      coins: data.coins || 0,
      solo_score: data.solo_score || 0,
      cards: data.cards || [],
      status_flags: data.status_flags || {}
    });
  });

  if (users.length) {
    const { error: userError } = await supabase.from('users').upsert(users);
    if (userError) console.error('❌ Error migrating users:', userError.message);
    else console.log(`✅ Successfully migrated ${users.length} users!`);
  } else {
    console.log('ℹ️ No users found in Firebase.');
  }

  // 2. Migrate Teams
  console.log('\n📦 Migrating Teams...');
  const teamsSnap = await db.collection('teams').get();
  const teams = [];
  teamsSnap.forEach(doc => {
    const data = doc.data();
    teams.push({
      id: String(doc.id),
      name: data.name,
      join_code: data.join_code,
      captain_id: String(data.captain_id),
      status: data.status || 'Active',
      points: data.points || 0,
      kills: data.kills || 0,
      members: data.members || [],
      pending_requests: data.pending_requests || []
    });
  });

  if (teams.length) {
    const { error: teamError } = await supabase.from('teams').upsert(teams);
    if (teamError) console.error('❌ Error migrating teams:', teamError.message);
    else console.log(`✅ Successfully migrated ${teams.length} teams!`);
  } else {
    console.log('ℹ️ No teams found in Firebase.');
  }

  // 3. Migrate Matches
  console.log('\n📦 Migrating Matches...');
  const matchesSnap = await db.collection('matches').get();
  const matches = [];
  matchesSnap.forEach(doc => {
    const data = doc.data();
    matches.push({
      id: String(doc.id),
      team1_id: data.team1_id ? String(data.team1_id) : null,
      team1_name: data.team1_name,
      team2_id: data.team2_id ? String(data.team2_id) : null,
      team2_name: data.team2_name,
      match_time: data.match_time || 'TBD',
      status: data.status || 'Upcoming',
      winner_team_name: data.winner_team_name || null
    });
  });

  if (matches.length) {
    const { error: matchError } = await supabase.from('matches').upsert(matches);
    if (matchError) console.error('❌ Error migrating matches:', matchError.message);
    else console.log(`✅ Successfully migrated ${matches.length} matches!`);
  } else {
    console.log('ℹ️ No matches found in Firebase.');
  }

  // 4. Migrate Settings
  console.log('\n📦 Migrating Settings...');
  const settingsSnap = await db.collection('settings').get();
  const settings = [];
  settingsSnap.forEach(doc => {
    settings.push({
      key: doc.id,
      value: doc.data().value !== undefined ? doc.data().value : doc.data()
    });
  });

  if (settings.length) {
    const { error: settingsError } = await supabase.from('settings').upsert(settings);
    if (settingsError) console.error('❌ Error migrating settings:', settingsError.message);
    else console.log(`✅ Successfully migrated ${settings.length} settings!`);
  } else {
    console.log('ℹ️ No custom settings found in Firebase.');
  }

  console.log('\n🎉 Migration process complete!');
  process.exit(0);
}

migrateData().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
