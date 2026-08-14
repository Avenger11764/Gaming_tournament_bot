const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_KEY are required in .env!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * -------------------------------------------------------------
 * PLAYER / USER MANAGEMENT (SUPABASE)
 * -------------------------------------------------------------
 */

// Register a new user profile
async function registerUser(telegramId, username, inGameName, firstName = '') {
  const strId = String(telegramId);
  const handle = username ? `@${username}` : (firstName || 'Player');

  // Check if player IGN or handle collides with an existing team name
  const { data: existingTeam } = await supabase
    .from('teams')
    .select('name')
    .or(`name.ilike.${inGameName},name.ilike.${handle}`)
    .maybeSingle();

  if (existingTeam) {
    throw new Error(`The name '${inGameName}' or '${handle}' is already taken by a registered Team!`);
  }

  // Check if user is already registered
  const { data: existingUser } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', strId)
    .maybeSingle();

  if (existingUser) {
    // Update existing user profile & set msgc_registered flag to true
    const { data: updated, error } = await supabase
      .from('users')
      .update({
        username: username || null,
        first_name: firstName || null,
        in_game_name: inGameName,
        msgc_registered: true
      })
      .eq('telegram_id', strId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return updated;
  }

  // Create new user profile
  const newUser = {
    telegram_id: strId,
    username: username || null,
    first_name: firstName || null,
    in_game_name: inGameName,
    status: 'Active',
    team_id: null,
    coins: 50,
    solo_score: 0,
    cards: [],
    status_flags: {},
    msgc_registered: true
  };

  const { data: created, error } = await supabase
    .from('users')
    .insert(newUser)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return created;
}

// Get single user profile by Telegram ID (Only active MSGC registered users for MSGC Bot)
async function getUser(telegramId) {
  const strId = String(telegramId);
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', strId)
    .maybeSingle();

  if (!user || user.msgc_registered === false) return null;
  return user;
}

// Get all registered MSGC players
async function getAllPlayers() {
  const { data: players, error } = await supabase
    .from('users')
    .select('*')
    .eq('msgc_registered', true)
    .order('created_at', { ascending: true });

  if (error) return [];
  return players || [];
}

// Unregister player profile from MSGC Bot (Keeps profile in Power Store, sets msgc_registered = false)
async function unregisterPlayer(userId) {
  const user = await getUser(userId);
  if (!user) throw new Error('Player profile not found.');

  // If in team, leave team first
  if (user.team_id) {
    try { await leaveTeam(userId); } catch (e) {}
  }

  const { error } = await supabase
    .from('users')
    .update({
      msgc_registered: false,
      team_id: null
    })
    .eq('telegram_id', String(userId));

  if (error) throw new Error(error.message);
  return user.in_game_name;
}

// Add or deduct coins from user
async function addCoins(telegramId, amount) {
  const strId = String(telegramId);
  const user = await getUser(strId);
  if (!user) throw new Error('User not registered! Use `/register <in_game_name>` first.');

  const newBalance = (user.coins || 0) + amount;
  const { data: updated, error } = await supabase
    .from('users')
    .update({ coins: newBalance })
    .eq('telegram_id', strId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated.coins;
}

// Award coins to all players
async function awardAllCoins(amount) {
  const { data: players } = await supabase.from('users').select('telegram_id, coins').eq('msgc_registered', true);
  if (!players || !players.length) return 0;

  let count = 0;
  for (const p of players) {
    const newBalance = (p.coins || 0) + amount;
    await supabase.from('users').update({ coins: newBalance }).eq('telegram_id', p.telegram_id);
    count++;
  }
  return count;
}



/**
 * -------------------------------------------------------------
 * TEAM MANAGEMENT & CAPTAIN APPROVAL (SUPABASE)
 * -------------------------------------------------------------
 */

// Generate 6-character unique join code
function generateJoinCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Create Team
async function createTeam(captainId, teamName) {
  const strCaptainId = String(captainId);
  const user = await getUser(strCaptainId);
  if (!user) throw new Error('You must be a registered player to create a team! Use `/register <InGameName>` first.');
  if (user.team_id) throw new Error('You are already in a team! Leave your current team first using `/leaveteam`.');

  const trimmedName = teamName.trim();

  // Check if team name collides with existing team name
  const { data: existingTeam } = await supabase
    .from('teams')
    .select('name')
    .ilike('name', trimmedName)
    .maybeSingle();

  if (existingTeam) throw new Error(`Team name '${trimmedName}' is already taken!`);

  // Check if team name collides with any player IGN or handle
  const { data: existingPlayer } = await supabase
    .from('users')
    .select('in_game_name, username, first_name')
    .or(`in_game_name.ilike.${trimmedName},username.ilike.${trimmedName}`)
    .maybeSingle();

  if (existingPlayer) throw new Error(`Team name '${trimmedName}' cannot be used because a player is registered with this name!`);

  const teamId = `team_${Date.now()}`;
  const joinCode = generateJoinCode();

  const newTeam = {
    id: teamId,
    name: trimmedName,
    join_code: joinCode,
    captain_id: strCaptainId,
    status: 'Active',
    points: 0,
    kills: 0,
    members: [strCaptainId],
    pending_requests: []
  };

  const { data: createdTeam, error: teamErr } = await supabase
    .from('teams')
    .insert(newTeam)
    .select()
    .single();

  if (teamErr) throw new Error(teamErr.message);

  // Link user to team
  await supabase
    .from('users')
    .update({ team_id: teamId })
    .eq('telegram_id', strCaptainId);

  return createdTeam;
}

// Request to Join Team (Puts player into Captain's Approval Queue)
async function requestJoinTeam(userId, joinCode) {
  const strUserId = String(userId);
  const user = await getUser(strUserId);
  if (!user) throw new Error('You must be a registered player to join a team! Use `/register <InGameName>` first.');
  if (user.team_id) throw new Error('You are already in a team! Leave your current team first using `/leaveteam`.');

  const upperCode = joinCode.trim().toUpperCase();
  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('join_code', upperCode)
    .maybeSingle();

  if (!team) throw new Error(`Invalid Join Code '${upperCode}'. Team not found.`);

  const members = team.members || [];
  const pending = team.pending_requests || [];

  if (members.length >= 2) throw new Error(`Team '${team.name}' is already FULL (2/2 members: 1 Captain, 1 Member)!`);
  if (members.includes(strUserId)) throw new Error(`You are already a member of team '${team.name}'!`);
  if (pending.includes(strUserId)) throw new Error(`You already have a pending join request for team '${team.name}'. Please wait for the Team Captain to accept it.`);

  const updatedPending = [...pending, strUserId];
  await supabase
    .from('teams')
    .update({ pending_requests: updatedPending })
    .eq('id', team.id);

  return { team, user };
}

// Captain Accepts Join Request
async function acceptJoinRequest(captainId, requesterUserId) {
  const strCaptainId = String(captainId);
  const strRequesterId = String(requesterUserId);
  const user = await getUser(strCaptainId);
  if (!user || !user.team_id) throw new Error('You are not in a team.');

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', user.team_id)
    .single();

  if (!team) throw new Error('Team not found.');
  if (String(team.captain_id) !== strCaptainId) throw new Error('Only the Team Captain can accept join requests!');

  const members = team.members || [];
  const pending = team.pending_requests || [];

  if (members.length >= 2) throw new Error(`Team '${team.name}' is already FULL (2/2 members)!`);

  const updatedMembers = [...members, strRequesterId];
  const updatedPending = pending.filter(id => id !== strRequesterId);

  await supabase
    .from('teams')
    .update({
      members: updatedMembers,
      pending_requests: updatedPending
    })
    .eq('id', team.id);

  await supabase
    .from('users')
    .update({ team_id: team.id })
    .eq('telegram_id', strRequesterId);

  const requester = await getUser(strRequesterId);
  team.members = updatedMembers;
  return { team, requester };
}

// Captain Rejects Join Request
async function rejectJoinRequest(captainId, requesterUserId) {
  const strCaptainId = String(captainId);
  const strRequesterId = String(requesterUserId);
  const user = await getUser(strCaptainId);
  if (!user || !user.team_id) throw new Error('You are not in a team.');

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', user.team_id)
    .single();

  if (!team) throw new Error('Team not found.');
  if (String(team.captain_id) !== strCaptainId) throw new Error('Only the Team Captain can reject join requests!');

  const pending = team.pending_requests || [];
  const updatedPending = pending.filter(id => id !== strRequesterId);

  await supabase
    .from('teams')
    .update({ pending_requests: updatedPending })
    .eq('id', team.id);

  const requester = await getUser(strRequesterId);
  return { team, requester };
}

// Get team details with member info
async function getTeamDetails(teamId) {
  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', teamId)
    .maybeSingle();

  if (!team) return null;

  const members = team.members || [];
  let memberProfiles = [];
  if (members.length) {
    const { data: profiles } = await supabase
      .from('users')
      .select('*')
      .in('telegram_id', members);
    memberProfiles = profiles || [];
  }

  return {
    ...team,
    memberProfiles
  };
}

// Get all teams
async function getAllTeams() {
  const { data: teams, error } = await supabase
    .from('teams')
    .select('*')
    .order('points', { ascending: false });

  if (error) return [];
  return teams || [];
}

// Leave team
async function leaveTeam(userId) {
  const strUserId = String(userId);
  const user = await getUser(strUserId);
  if (!user || !user.team_id) throw new Error('You are not currently in any team!');

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', user.team_id)
    .maybeSingle();

  if (!team) {
    await supabase.from('users').update({ team_id: null }).eq('telegram_id', strUserId);
    return 'your team';
  }

  const updatedMembers = (team.members || []).filter(m => m !== strUserId);

  if (updatedMembers.length === 0) {
    // Disband team if last member leaves
    await supabase.from('teams').delete().eq('id', team.id);
  } else {
    let newCaptainId = team.captain_id;
    if (team.captain_id === strUserId) {
      newCaptainId = updatedMembers[0];
    }
    await supabase
      .from('teams')
      .update({
        members: updatedMembers,
        captain_id: newCaptainId
      })
      .eq('id', team.id);
  }

  await supabase.from('users').update({ team_id: null }).eq('telegram_id', strUserId);
  return team.name;
}

// Kick/Remove player from team or tournament
async function kickPlayerFromTeam(playerInput, captainTeamId = null) {
  const { data: players } = await supabase.from('users').select('*');
  let targetUser = (players || []).find(p => p.in_game_name === playerInput || p.username === playerInput.replace('@', '') || String(p.telegram_id) === String(playerInput));

  if (!targetUser) throw new Error(`Player '${playerInput}' not found.`);

  // If player is not in any team
  if (!targetUser.team_id) {
    if (captainTeamId) {
      throw new Error(`Player '${targetUser.in_game_name}' is not in your team.`);
    }
    // Admin removing a standalone player: unregister them from tournament
    await supabase.from('users').update({ msgc_registered: false, status: 'Eliminated' }).eq('telegram_id', String(targetUser.telegram_id));
    return { user: targetUser, teamName: 'No Team (Standalone Player)' };
  }

  if (captainTeamId && targetUser.team_id !== captainTeamId) {
    throw new Error(`Player '${targetUser.in_game_name}' is not in your team!`);
  }

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('id', targetUser.team_id)
    .single();

  if (team && String(targetUser.telegram_id) === String(team.captain_id) && captainTeamId) {
    throw new Error('The Team Captain cannot be kicked by himself! Transfer captainship first using `/makecaptain`.');
  }

  if (team) {
    const updatedMembers = (team.members || []).filter(m => m !== String(targetUser.telegram_id));
    if (updatedMembers.length === 0) {
      await supabase.from('teams').delete().eq('id', team.id);
    } else {
      let newCaptainId = team.captain_id;
      if (String(team.captain_id) === String(targetUser.telegram_id)) {
        newCaptainId = updatedMembers[0];
      }
      await supabase.from('teams').update({ members: updatedMembers, captain_id: newCaptainId }).eq('id', team.id);
    }
  }
  await supabase.from('users').update({ team_id: null }).eq('telegram_id', String(targetUser.telegram_id));

  return { user: targetUser, teamName: team ? team.name : 'Team' };
}

// Transfer Captainship
async function transferCaptainship(currentCaptainId, newCaptainInput) {
  const strCapId = String(currentCaptainId);
  const capUser = await getUser(strCapId);
  if (!capUser || !capUser.team_id) throw new Error('You are not in a team.');

  const { data: team } = await supabase.from('teams').select('*').eq('id', capUser.team_id).single();
  if (String(team.captain_id) !== strCapId) throw new Error('Only the current Team Captain can transfer captainship!');

  const { data: players } = await supabase.from('users').select('*');
  let newCaptainUser = (players || []).find(p => p.in_game_name === newCaptainInput || p.username === newCaptainInput.replace('@', '') || String(p.telegram_id) === String(newCaptainInput));

  if (!newCaptainUser) throw new Error(`Teammate '${newCaptainInput}' not found.`);
  if (newCaptainUser.team_id !== team.id) throw new Error(`Player '${newCaptainUser.in_game_name}' is not in your team!`);

  await supabase.from('teams').update({ captain_id: String(newCaptainUser.telegram_id) }).eq('id', team.id);
  return { team, newCaptain: newCaptainUser };
}

// Admin: Set Team Status (Active / Eliminated)
async function setTeamStatus(teamName, status) {
  const { data: team } = await supabase.from('teams').select('*').ilike('name', teamName.trim()).maybeSingle();
  if (!team) throw new Error(`Team '${teamName}' not found.`);

  await supabase.from('teams').update({ status }).eq('id', team.id);
  const members = team.members || [];
  if (members.length) {
    const isEliminated = status === 'Eliminated';
    const updatePayload = isEliminated ? { status: 'Eliminated', msgc_registered: false } : { status: 'Active', msgc_registered: true };
    await supabase.from('users').update(updatePayload).in('telegram_id', members);
  }
  return team;
}

// Admin: Set Player Status (Active / Eliminated)
async function setPlayerStatus(playerInput, status) {
  const { data: players } = await supabase.from('users').select('*');
  let player = (players || []).find(p => p.in_game_name === playerInput || p.username === playerInput.replace('@', '') || String(p.telegram_id) === String(playerInput));
  if (!player) throw new Error(`Player '${playerInput}' not found.`);

  const isEliminated = status === 'Eliminated';
  const updatePayload = isEliminated ? { status: 'Eliminated', msgc_registered: false } : { status: 'Active', msgc_registered: true };
  const { data: updated } = await supabase.from('users').update(updatePayload).eq('telegram_id', String(player.telegram_id)).select().single();
  return updated || player;
}

// Admin: Recruit back an eliminated/kicked player or team
async function recruitPlayerOrTeam(targetInput) {
  const { data: teams } = await supabase.from('teams').select('*');
  let team = (teams || []).find(t => t.name.toLowerCase() === targetInput.toLowerCase().trim());

  if (team) {
    await supabase.from('teams').update({ status: 'Active' }).eq('id', team.id);
    const members = team.members || [];
    if (members.length) {
      await supabase.from('users').update({ status: 'Active', msgc_registered: true }).in('telegram_id', members);
    }
    return { type: 'team', entity: team };
  }

  const { data: players } = await supabase.from('users').select('*');
  let player = (players || []).find(p => p.in_game_name === targetInput || p.username === targetInput.replace('@', '') || String(p.telegram_id) === String(targetInput));

  if (!player) throw new Error(`Player or Team '${targetInput}' not found.`);

  const { data: updatedPlayer } = await supabase
    .from('users')
    .update({ status: 'Active', msgc_registered: true })
    .eq('telegram_id', String(player.telegram_id))
    .select()
    .single();

  return { type: 'player', entity: updatedPlayer || player };
}

// Admin: Delete/Remove Entire Team completely from database
async function deleteTeam(teamInput) {
  const { data: teams } = await supabase.from('teams').select('*');
  let team = (teams || []).find(t => t.id === teamInput || t.name.toLowerCase() === teamInput.toLowerCase().trim());
  if (!team) throw new Error(`Team '${teamInput}' not found.`);

  // Reset team_id and unregister members
  await supabase.from('users').update({ team_id: null, status: 'Eliminated', msgc_registered: false }).eq('team_id', team.id);
  // Delete team row
  await supabase.from('teams').delete().eq('id', team.id);
  return team;
}

/**
 * -------------------------------------------------------------
 * MATCH FIXTURES & SCORECARD SYSTEM (SUPABASE)
 * -------------------------------------------------------------
 */

// Schedule new match fixture (supports optional game/match name)
async function createMatch(team1Name, team2Name, matchTime = 'TBD', matchName = 'Tournament Match') {
  const matchId = `match_${Date.now()}`;
  let formattedTime = matchTime.trim();
  if (matchName && matchName !== 'Tournament Match') {
    formattedTime = `${formattedTime} (${matchName.trim()})`;
  }

  const newMatch = {
    id: matchId,
    team1_name: team1Name.trim(),
    team2_name: team2Name.trim(),
    match_time: formattedTime,
    status: 'Upcoming'
  };

  // Try inserting with match_name first
  const { data: created, error } = await supabase
    .from('matches')
    .insert({ ...newMatch, match_name: matchName.trim() })
    .select()
    .single();

  if (error) {
    // If match_name column does not exist in Supabase schema cache, fallback cleanly
    if (error.message && error.message.includes('match_name')) {
      const { data: fallbackCreated, error: fallbackError } = await supabase
        .from('matches')
        .insert(newMatch)
        .select()
        .single();
      if (fallbackError) throw new Error(fallbackError.message);
      return { ...fallbackCreated, match_name: matchName.trim() };
    }
    throw new Error(error.message);
  }
  return created;
}

// Edit match fixture
async function editMatch(identifier, newTeam1, newTeam2, newTime = 'TBD', newName = null) {
  const { data: matches } = await supabase.from('matches').select('*');
  let match = (matches || []).find(m => m.id === identifier || m.team1_name.toLowerCase().includes(identifier.toLowerCase()) || m.team2_name.toLowerCase().includes(identifier.toLowerCase()));

  if (!match) throw new Error(`Match '${identifier}' not found.`);

  let formattedTime = newTime.trim();
  if (newName) {
    formattedTime = `${formattedTime} (${newName.trim()})`;
  }

  const updateData = {
    team1_name: newTeam1.trim(),
    team2_name: newTeam2.trim(),
    match_time: formattedTime
  };

  const { data: updated, error } = await supabase
    .from('matches')
    .update(updateData)
    .eq('id', match.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return { ...updated, match_name: newName ? newName.trim() : (updated.match_name || 'Tournament Match') };
}

// Get all scheduled matches
async function getAllMatches() {
  const { data: matches, error } = await supabase.from('matches').select('*').order('created_at', { ascending: true });
  if (error) return [];
  return matches || [];
}

// Set Match Winner
async function setMatchWinner(matchIdOrTeam, winnerTeamName) {
  const { data: matches } = await supabase.from('matches').select('*');
  let match = (matches || []).find(m => m.id === matchIdOrTeam || m.team1_name.toLowerCase().includes(matchIdOrTeam.toLowerCase()) || m.team2_name.toLowerCase().includes(matchIdOrTeam.toLowerCase()));

  if (!match) throw new Error(`Match '${matchIdOrTeam}' not found.`);

  const { data: updated, error } = await supabase
    .from('matches')
    .update({
      winner_team_name: winnerTeamName.trim(),
      status: 'Completed'
    })
    .eq('id', match.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated;
}

// Add or Deduct Score Points of Team
async function addTeamScore(teamName, points) {
  const { data: team } = await supabase.from('teams').select('*').ilike('name', teamName.trim()).maybeSingle();
  if (!team) throw new Error(`Team '${teamName}' not found.`);

  const newPoints = (team.points || 0) + points;
  const { data: updated, error } = await supabase.from('teams').update({ points: newPoints }).eq('id', team.id).select().single();
  if (error) throw new Error(error.message);
  return updated;
}

// Get Tournament Leaderboard with member coins summed into total team score & Wins/Losses stats
async function getLeaderboard() {
  const { data: teams, error } = await supabase.from('teams').select('*');
  if (error || !teams) return [];

  // Strictly select players where msgc_registered is true
  const { data: players } = await supabase.from('users').select('*').eq('msgc_registered', true);
  const playerMap = {};
  (players || []).forEach(p => {
    playerMap[String(p.telegram_id)] = p.coins !== undefined && p.coins !== null ? p.coins : (p.solo_score || 0);
  });
  
  const { data: matches } = await supabase.from('matches').select('*').eq('status', 'Completed');

  const winLossMap = {};
  (matches || []).forEach(m => {
    if (!m.winner_team_name) return;
    const t1 = m.team1_name.toLowerCase();
    const t2 = m.team2_name.toLowerCase();
    const winner = m.winner_team_name.toLowerCase();

    if (!winLossMap[t1]) winLossMap[t1] = { wins: 0, losses: 0 };
    if (!winLossMap[t2]) winLossMap[t2] = { wins: 0, losses: 0 };

    if (t1 === winner) {
      winLossMap[t1].wins += 1;
      winLossMap[t2].losses += 1;
    } else if (t2 === winner) {
      winLossMap[t2].wins += 1;
      winLossMap[t1].losses += 1;
    }
  });

  const processedTeams = teams.map(t => {
    const key = t.name.toLowerCase();
    const stats = winLossMap[key] || { wins: 0, losses: 0 };
    const members = t.members || [];
    
    // Sum only registered members' power coins into team score
    const memberCoinsSum = members.reduce((sum, memId) => sum + (playerMap[String(memId)] || 0), 0);
    const totalTeamPoints = (t.points || 0) + memberCoinsSum;

    return {
      ...t,
      points: totalTeamPoints,
      member_coins: memberCoinsSum,
      wins: stats.wins,
      losses: stats.losses
    };
  });

  // Sort by total team points descending
  processedTeams.sort((a, b) => b.points - a.points);
  return processedTeams;
}

/**
 * -------------------------------------------------------------
 * SETTINGS & SOLO MODE (SUPABASE)
 * -------------------------------------------------------------
 */

// Registration Status
async function isRegistrationOpen() {
  const { data: doc } = await supabase.from('settings').select('value').eq('key', 'registration_open').maybeSingle();
  if (!doc) return true;
  return doc.value === true || doc.value === 'true';
}

async function setRegistrationStatus(status) {
  await supabase.from('settings').upsert({ key: 'registration_open', value: JSON.stringify(status) });
}

// Tournament Rules Dictionary / List Management
async function getTournamentRulesList() {
  const { data: doc } = await supabase.from('settings').select('value').eq('key', 'tournament_rules_list').maybeSingle();
  if (!doc || !doc.value) return [];
  try {
    const list = typeof doc.value === 'string' ? JSON.parse(doc.value) : doc.value;
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function saveTournamentRulesList(rulesList) {
  await supabase.from('settings').upsert({ key: 'tournament_rules_list', value: JSON.stringify(rulesList) });
}

async function addTournamentRule(ruleText) {
  const list = await getTournamentRulesList();
  list.push(ruleText.trim());
  await saveTournamentRulesList(list);
  return { ruleNumber: list.length, totalRules: list.length, rulesList: list };
}

async function removeTournamentRuleByNumber(ruleNum) {
  const list = await getTournamentRulesList();
  if (ruleNum < 1 || ruleNum > list.length) {
    throw new Error(`Rule #${ruleNum} does not exist. Total rules available: ${list.length}`);
  }
  const removedRule = list.splice(ruleNum - 1, 1)[0];
  await saveTournamentRulesList(list);
  return { removedRule, remainingRules: list };
}

async function getTournamentRules() {
  const list = await getTournamentRulesList();
  if (!list.length) {
    // Check legacy single-string fallback
    const { data: doc } = await supabase.from('settings').select('value').eq('key', 'tournament_rules').maybeSingle();
    if (doc && doc.value && doc.value !== 'NONE' && doc.value !== '""') {
      let val = typeof doc.value === 'string' ? doc.value : JSON.stringify(doc.value);
      try { val = JSON.parse(val); } catch (e) {}
      return `📜 <b>Official MSGC Tournament Rules:</b>\n\n${val}`;
    }
    return '📜 <b>Official MSGC Tournament Rules:</b>\n\nNo active rules set yet by the tournament organiser.';
  }

  let text = `📜 <b>OFFICIAL TOURNAMENT RULES & GUIDELINES</b> 📜\n\n`;
  list.forEach((rule, idx) => {
    text += `<b>${idx + 1}.</b> ${rule}\n`;
  });
  return text;
}

async function setTournamentRules(rulesText) {
  // Support adding a rule via setrules or setting first rule
  await addTournamentRule(rulesText);
}

async function clearTournamentRules() {
  await saveTournamentRulesList([]);
  await supabase.from('settings').upsert({ key: 'tournament_rules', value: JSON.stringify('NONE') });
}

// Declare Champion (Team or Solo Player)
async function declareChampion(winnerInput) {
  const cleanInput = String(winnerInput).trim();
  
  // Try team lookup first
  const { data: team } = await supabase.from('teams').select('*').ilike('name', cleanInput).maybeSingle();
  if (team) {
    await supabase.from('settings').upsert({ key: 'tournament_champion', value: JSON.stringify({ type: 'team', entity: team }) });
    return { type: 'team', entity: team };
  }

  // Fallback to player lookup
  const { data: players } = await supabase.from('users').select('*').eq('msgc_registered', true);
  const lowerInput = cleanInput.toLowerCase().replace('@', '');
  let player = (players || []).find(p => {
    const ign = p.in_game_name ? String(p.in_game_name).trim().toLowerCase() : '';
    const uname = p.username ? String(p.username).trim().toLowerCase() : '';
    const tid = String(p.telegram_id);
    return ign === lowerInput || uname === lowerInput || tid === lowerInput;
  });

  if (player) {
    await supabase.from('settings').upsert({ key: 'tournament_champion', value: JSON.stringify({ type: 'player', entity: player }) });
    return { type: 'player', entity: player };
  }

  throw new Error(`Team or Player '${winnerInput}' not found.`);
}

// Tournament Mode (Team vs Solo)
async function getTournamentMode() {
  const { data: doc } = await supabase.from('settings').select('value').eq('key', 'tournament_mode').maybeSingle();
  if (!doc) return 'team';
  let val = doc.value;
  if (typeof val === 'string') {
    val = val.replace(/^"|"$/g, '');
  }
  return val.toLowerCase() === 'solo' ? 'solo' : 'team';
}


async function setTournamentMode(mode) {
  const cleanMode = mode.toLowerCase() === 'solo' ? 'solo' : 'team';
  await supabase.from('settings').upsert({ key: 'tournament_mode', value: JSON.stringify(cleanMode) });
  return cleanMode;
}

// Get Solo Leaderboard (Active MSGC registered Players only, ordering by coins/solo_score)
async function getSoloLeaderboard() {
  const { data: players, error } = await supabase
    .from('users')
    .select('*')
    .eq('msgc_registered', true)
    .order('coins', { ascending: false });

  if (error) return [];
  
  // Filter active registered players (supporting string or object status)
  return (players || []).filter(p => {
    if (p.msgc_registered === false) return false;
    if (!p.status) return true;
    if (typeof p.status === 'string') return p.status.trim() !== 'Eliminated';
    if (typeof p.status === 'object') return p.status.status !== 'Eliminated';
    return true;
  });
}

// Add Solo Score / Coins to Player (Syncs both coins and solo_score columns)
async function addSoloScore(playerInput, points) {
  const { data: players } = await supabase.from('users').select('*');
  const cleanInput = String(playerInput).trim().toLowerCase().replace('@', '');

  let player = (players || []).find(p => {
    const ign = p.in_game_name ? String(p.in_game_name).trim().toLowerCase() : '';
    const uname = p.username ? String(p.username).trim().toLowerCase() : '';
    const tid = String(p.telegram_id);
    return ign === cleanInput || uname === cleanInput || tid === cleanInput;
  });

  if (!player) throw new Error(`Player '${playerInput}' not found.`);

  const currentVal = player.coins !== undefined && player.coins !== null ? player.coins : (player.solo_score || 0);
  const newScore = currentVal + points;

  const { data: updated, error } = await supabase
    .from('users')
    .update({ coins: newScore, solo_score: newScore })
    .eq('telegram_id', String(player.telegram_id))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return updated;
}

module.exports = {
  supabase,
  registerUser,
  getUser,
  getAllPlayers,
  addCoins,
  awardAllCoins,
  unregisterPlayer,

  createTeam,
  requestJoinTeam,
  acceptJoinRequest,
  rejectJoinRequest,
  getTeamDetails,
  getAllTeams,
  leaveTeam,
  kickPlayerFromTeam,
  transferCaptainship,
  setTeamStatus,
  setPlayerStatus,
  recruitPlayerOrTeam,
  deleteTeam,
  createMatch,
  editMatch,
  getAllMatches,
  setMatchWinner,
  addTeamScore,
  getLeaderboard,
  setRegistrationStatus,
  isRegistrationOpen,
  setTournamentRules,
  addTournamentRule,
  removeTournamentRuleByNumber,
  clearTournamentRules,
  getTournamentRules,
  declareChampion,
  getTournamentMode,
  setTournamentMode,
  getSoloLeaderboard,
  addSoloScore
};
