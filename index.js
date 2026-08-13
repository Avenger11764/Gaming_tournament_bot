const { Telegraf, Markup } = require('telegraf');
require('dotenv').config();

const {
  registerUser,
  getUser,
  getAllPlayers,
  addCoins,
  awardAllCoins,
  createTeam,
  joinTeamByCode,

  requestJoinTeam,
  acceptJoinRequest,
  rejectJoinRequest,
  getTeamDetails,
  getAllTeams,
  leaveTeam,
  unregisterPlayer,
  setTeamStatus,
  setPlayerStatus,
  recruitPlayerOrTeam,
  deleteTeam,
  kickPlayerFromTeam,
  transferCaptainship,
  setRegistrationStatus,
  isRegistrationOpen,
  createMatch,
  getAllMatches,
  setMatchWinner,
  editMatch,
  addTeamScore,
  getLeaderboard,
  setTournamentRules,
  addTournamentRule,
  removeTournamentRuleByNumber,
  clearTournamentRules,
  getTournamentRules,
  declareChampion,
  getChampion,
  getTournamentMode,
  setTournamentMode,
  getSoloLeaderboard,
  addSoloScore
} = require('./db');















const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('❌ ERROR: BOT_TOKEN is missing or not configured in .env file!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Global Markdown Sanitizer Helper
function sanitizeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([_*`\[\]()])/g, '\\$1');
}

// Global Helper function to format player username or fallback profile name (Sanitized)
function formatPlayerHandle(p) {
  if (!p) return 'Player';
  if (p.username && String(p.username).trim()) {
    return sanitizeMarkdown(`@${p.username}`);
  }
  return sanitizeMarkdown(p.first_name || p.in_game_name || 'Player');
}

// Global Helper function to cleanly format player status (handles string or legacy JSON object)
function formatPlayerStatus(status) {
  if (!status) return 'Active';
  if (typeof status === 'string') {
    return status.trim() === 'Eliminated' ? 'Eliminated' : 'Active';
  }
  if (typeof status === 'object') {
    return status.status === 'Eliminated' ? 'Eliminated' : 'Active';
  }
  return 'Active';
}

bot.catch((err, ctx) => {
  console.error(`Unhandled error for ${ctx.updateType}:`, err);
  try {
    const errorMsg = err.message || 'Unknown error';
    // Cleanly ignore or fallback plain text for Markdown entities parse errors
    if (errorMsg.includes("can't parse entities") || errorMsg.includes('Bad Request')) {
      if (ctx.message && ctx.message.text) {
        const cleanMsg = ctx.message.text.replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '');
        return ctx.reply(cleanMsg).catch(() => {});
      }
      return;
    }
    return ctx.reply(`❌ An error occurred: ${errorMsg}`).catch(() => {});
  } catch (e) {
    console.error('Failed to send error reply:', e);
  }
});

// Safe reply with fallback to plain text if Telegram Markdown parsing fails
async function safeReplyMarkdown(ctx, text, extra = {}) {
  try {
    return await ctx.replyWithMarkdown(text, extra);
  } catch (err) {
    const plainText = String(text).replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '');
    try {
      return await ctx.reply(plainText, extra);
    } catch (e) {
      return await ctx.reply(plainText);
    }
  }
}

// Safe send message with fallback to plain text if Telegram Markdown parsing fails
async function safeSendMessage(telegramId, text, extra = {}) {
  try {
    return await bot.telegram.sendMessage(telegramId, text, { parse_mode: 'Markdown', ...extra });
  } catch (err) {
    const plainText = String(text).replace(/[*_`\[\]()~>#+\-=|{}.!]/g, '');
    try {
      return await bot.telegram.sendMessage(telegramId, plainText, extra);
    } catch (e) {
      return await bot.telegram.sendMessage(telegramId, plainText);
    }
  }
}





// Parse admin IDs from env
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());

// Helper middleware to check if user is admin
function isAdmin(ctx) {
  const userId = String(ctx.from.id);
  return ADMIN_IDS.includes(userId);
}

/**
 * -------------------------------------------------------------
 * PUBLIC / PLAYER COMMANDS
 * -------------------------------------------------------------
 */

// Middleware to register group chats for group broadcasts
bot.use(async (ctx, next) => {
  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
    try {
      const groupRef = db.collection('groups').doc(String(ctx.chat.id));
      await groupRef.set({
        chat_id: String(ctx.chat.id),
        title: ctx.chat.title || 'Group',
        type: ctx.chat.type,
        updated_at: FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {
      // Ignore group save error
    }
  }
  return next();
});

// Helper function to render registered user Main Dashboard menu
function getMainMenu() {
  const welcomeText = `
🏆 *WELCOME TO MSGC TOURNAMENT CONTROL CENTER* 🏆

Choose an option below to manage your team, check fixtures, scores, or view tournament standings:

1️⃣ *Profile & Team:* View your player profile or manage your squad roster (\`/myteam\`).
2️⃣ *Leaderboard & Matches:* Track live team/solo points (\`/leaderboard\`) and upcoming match fixtures (\`/matches\`).
3️⃣ *Tournament Status:* Check live remaining active vs. eliminated teams & players with \`/teams\` and \`/players\`.

👇 *QUICK DASHBOARD MENU:*
  `;


  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('👤 My Profile', 'cmd_profile'),
      Markup.button.callback('🛡️ My Team', 'cmd_myteam')
    ],
    [
      Markup.button.callback('📊 Scoreboard', 'cmd_leaderboard'),
      Markup.button.callback('⚔️ Match Fixtures', 'cmd_matches')
    ],
    [
      Markup.button.callback('📜 Tournament Rules', 'cmd_rules'),
      Markup.button.callback('🏆 All Teams', 'cmd_teams')
    ],
    [
      Markup.button.callback('👥 All Players', 'cmd_players'),
      Markup.button.callback('📖 Help & Guide', 'cmd_help')
    ],
    [
      Markup.button.callback('🚪 Leave Team', 'cmd_leaveteam'),
      Markup.button.callback('🗑️ Unregister Profile', 'confirm_unregister_prompt')
    ]
  ]);

  return { welcomeText, keyboard };
}

// Helper function to render group dashboard menu (Clean & minimal for group chats)
function getGroupMenu() {
  const groupText = `
🏆 *MSGC TOURNAMENT ARENA & INFORMATION CENTER* 🏆

Welcome to the official MSGC Tournament Group! Use the buttons below to check live tournament standings, match fixtures, rules, and teams:

👇 *QUICK GROUP DASHBOARD:*
  `;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Scoreboard', 'cmd_leaderboard'),
      Markup.button.callback('⚔️ Match Fixtures', 'cmd_matches')
    ],
    [
      Markup.button.callback('🏆 All Teams', 'cmd_teams'),
      Markup.button.callback('📜 Tournament Rules', 'cmd_rules')
    ],
    [
      Markup.button.callback('📖 Help & Commands', 'cmd_help')
    ]
  ]);

  return { text: groupText, keyboard };
}

// Helper function to render Guest Dashboard menu for unregistered players
function getGuestMenu() {
  const guestText = `
🏆 *WELCOME TO THE MSGC TOURNAMENT BOT* 🏆

You are currently browsing as a **Guest (Not Registered)**.

🎮 *HOW TO JOIN THE TOURNAMENT:*
Type \`/register <YourInGameName>\` to create your player profile and unlock team creation and match play!

👇 *GUEST ARENA MENU:*
  `;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Scoreboard', 'cmd_leaderboard'),
      Markup.button.callback('⚔️ Match Fixtures', 'cmd_matches')
    ],
    [
      Markup.button.callback('🏆 All Teams', 'cmd_teams'),
      Markup.button.callback('📜 Tournament Rules', 'cmd_rules')
    ],
    [
      Markup.button.callback('📖 Help & Commands', 'cmd_help')
    ]
  ]);

  return { text: guestText, keyboard };
}

// /start command
bot.start(async (ctx) => {
  const isGroup = ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup');
  if (isGroup) {
    const { text, keyboard } = getGroupMenu();
    return ctx.replyWithMarkdown(text, keyboard);
  }

  const user = await getUser(ctx.from.id);
  if (!user) {
    const { text, keyboard } = getGuestMenu();
    return ctx.replyWithMarkdown(text, keyboard);
  }

  const { welcomeText, keyboard } = getMainMenu();
  return ctx.replyWithMarkdown(welcomeText, keyboard);
});

// /menu command - Return to Main Dashboard anytime
bot.command('menu', async (ctx) => {
  const isGroup = ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup');
  if (isGroup) {
    const { text, keyboard } = getGroupMenu();
    return ctx.replyWithMarkdown(text, keyboard);
  }

  const user = await getUser(ctx.from.id);
  if (!user) {
    const { text, keyboard } = getGuestMenu();
    return ctx.replyWithMarkdown(text, keyboard);
  }

  const { welcomeText, keyboard } = getMainMenu();
  return ctx.replyWithMarkdown(welcomeText, keyboard);
});

bot.action('cmd_menu', async (ctx) => {
  ctx.answerCbQuery();
  const isGroup = ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup');
  if (isGroup) {
    const { text, keyboard } = getGroupMenu();
    return safeReplyMarkdown(ctx, text, keyboard);
  }

  const user = await getUser(ctx.from.id);
  if (!user) {
    const { text, keyboard } = getGuestMenu();
    return safeReplyMarkdown(ctx, text, keyboard);
  }

  const { welcomeText, keyboard } = getMainMenu();
  return safeReplyMarkdown(ctx, welcomeText, keyboard);
});



// /unregister - Quit tournament with confirmation check
bot.command('unregister', async (ctx) => {
  return ctx.replyWithMarkdown(
    `⚠️ *CONFIRM UNREGISTERING*\n\nAre you sure you want to quit the tournament and delete your player profile? This action cannot be undone!`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Unregister Me', 'cmd_unregister_confirm'),
        Markup.button.callback('❌ Cancel', 'cmd_unregister_cancel')
      ]
    ])
  );
});

// Confirmation dialog prompt from inline dashboard button
bot.action('confirm_unregister_prompt', async (ctx) => {
  ctx.answerCbQuery();
  return ctx.replyWithMarkdown(
    `⚠️ *CONFIRM UNREGISTERING*\n\nAre you sure you want to quit the tournament and delete your player profile?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Yes, Unregister Me', 'cmd_unregister_confirm'),
        Markup.button.callback('❌ Cancel', 'cmd_unregister_cancel')
      ]
    ])
  );
});

// Confirmed Unregister action
bot.action('cmd_unregister_confirm', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const user = await unregisterPlayer(ctx.from.id);
    return ctx.editMessageText(`✅ *Successfully Unregistered!*\n\nPlayer *${user.in_game_name}* has quit the tournament. Your profile data has been removed.`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// /profile - View player profile, team, and status
bot.command('profile', async (ctx) => {
  try {
    const user = await getUser(ctx.from.id);
    if (!user) {
      return ctx.replyWithHTML('⚠️ You are not registered yet. Use <code>/register &lt;InGameName&gt;</code> to join.');
    }

    const cleanStatus = formatPlayerStatus(user.status);
    const statusEmoji = cleanStatus === 'Active' ? '🟢' : '🔴';
    const ignEscaped = String(user.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const text = `👤 <b>PLAYER PROFILE FOR ${ignEscaped.toUpperCase()}</b>\n\n🎮 <b>In-Game Name:</b> ${ignEscaped}\n🆔 <b>Telegram ID:</b> <code>${user.telegram_id}</code>\n${statusEmoji} <b>Status:</b> ${cleanStatus}`;
    return ctx.replyWithHTML(text, Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Main Menu', 'cmd_menu')]
    ]));
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});

bot.action('cmd_profile', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const user = await getUser(ctx.from.id);
    if (!user) {
      return ctx.replyWithHTML('⚠️ You are not registered yet. Use <code>/register &lt;InGameName&gt;</code> to join.');
    }

    const cleanStatus = formatPlayerStatus(user.status);
    const statusEmoji = cleanStatus === 'Active' ? '🟢' : '🔴';
    const ignEscaped = String(user.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const text = `👤 <b>PLAYER PROFILE FOR ${ignEscaped.toUpperCase()}</b>\n\n🎮 <b>In-Game Name:</b> ${ignEscaped}\n🆔 <b>Telegram ID:</b> <code>${user.telegram_id}</code>\n${statusEmoji} <b>Status:</b> ${cleanStatus}`;
    return ctx.replyWithHTML(text, Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Main Menu', 'cmd_menu')]
    ]));
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});

// Cancelled Unregister action
bot.action('cmd_unregister_cancel', async (ctx) => {
  ctx.answerCbQuery('Cancelled');
  return ctx.editMessageText('❌ Unregistration cancelled. You are still registered in the tournament!', { parse_mode: 'Markdown' });
});


// Helper function to format leaderboard based on mode (Team vs Solo)
async function renderLeaderboardText() {
  const mode = await getTournamentMode();

  if (mode === 'solo') {
    const soloPlayers = await getSoloLeaderboard();
    if (!soloPlayers.length) return 'ℹ️ No active players qualified for Solo Competition phase yet.';

    let text = `👤 📊 <b>SOLO COMPETITION SCORECARD & LEADERBOARD</b> 📊 👤\n\n`;
    text += `<code>Rank | Player Name      | Solo Points</code>\n`;
    text += `<code>────────────────────────────────────</code>\n`;

    soloPlayers.forEach((p, idx) => {
      const rank = String(idx + 1).padStart(2, ' ');
      const name = (p.in_game_name.length > 18 ? p.in_game_name.substring(0, 15) + '...' : p.in_game_name).padEnd(18, ' ');
      const scoreVal = p.coins !== undefined && p.coins !== null ? p.coins : (p.solo_score || 0);
      const pts = String(scoreVal).padStart(5, ' ');
      const ignEsc = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      text += `<code>${rank}.  | ${ignEsc} | ${pts}</code> 🟢\n`;
    });

    text += `\n👤 <b>Mode:</b> Solo Competition (Active Players Only)`;
    return text;
  } else {
    const teams = await getLeaderboard();
    if (!teams.length) return 'ℹ️ No teams registered yet for leaderboard.';

    let text = `🛡️ 📊 <b>TEAM TOURNAMENT SCORECARD & LEADERBOARD</b> 📊 🛡️\n\n`;
    text += `<code>Rank | Team Name        | Pts | W  | L </code>\n`;
    text += `<code>───────────────────────────────────────</code>\n`;

    teams.forEach((t, idx) => {
      const rank = String(idx + 1).padStart(2, ' ');
      const name = (t.name.length > 14 ? t.name.substring(0, 11) + '...' : t.name).padEnd(14, ' ');
      const pts = String(t.points || 0).padStart(3, ' ');
      const wins = String(t.wins || 0).padStart(2, ' ');
      const losses = String(t.losses || 0).padStart(2, ' ');
      const statusEmoji = t.status === 'Active' ? '🟢' : '🔴';

      text += `<code>${rank}.  | ${name} | ${pts} | ${wins} | ${losses}</code> ${statusEmoji}\n`;
    });

    text += `\n🟢 = Active | 🔴 = Eliminated\n<i>W = Matches Won | L = Matches Lost</i>`;
    return text;
  }
}

// /leaderboard - Display tournament standings table (Dynamic Team vs Solo Mode)
bot.command('leaderboard', async (ctx) => {
  try {
    const text = await renderLeaderboardText();
    return ctx.replyWithHTML(text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_leaderboard', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const text = await renderLeaderboardText();
    return ctx.replyWithHTML(text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Command: /mode - View current active tournament mode (Team or Solo)
bot.command('mode', async (ctx) => {
  try {
    const currentMode = await getTournamentMode();
    const modeName = currentMode === 'solo' ? '👤 Solo Competition Phase' : '🛡️ Team Tournament Phase';
    return ctx.replyWithMarkdown(`🏆 *CURRENT TOURNAMENT MODE*\n\nActive Mode: **${modeName}**\n\nUse \`/leaderboard\` to view current standings!`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Command: /setmode <team|solo> - Switch Tournament Mode
bot.command('setmode', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1)[0];
  
  if (!args || (args.toLowerCase() !== 'team' && args.toLowerCase() !== 'solo')) {
    const currentMode = await getTournamentMode();
    return ctx.reply(`ℹ️ Current Active Mode: *${currentMode.toUpperCase()}*\n\nUsage to change mode: \`/setmode <team|solo>\``, { parse_mode: 'Markdown' });
  }

  try {
    const newMode = await setTournamentMode(args);
    let broadcastMsg = '';

    if (newMode === 'solo') {
      const allPlayers = await getAllPlayers();
      const activePlayers = allPlayers.filter(p => formatPlayerStatus(p.status) === 'Active');
      broadcastMsg = `🔥 👤 <b>TOURNAMENT MODE CHANGED TO SOLO COMPETITION!</b> 👤 🔥\n\nTeam games have ended! All <b>${activePlayers.length} Active Players</b> are now active in the Solo Competition Phase!\n\nCheck live solo standings with <code>/leaderboard</code>!`;
    } else {
      broadcastMsg = `🛡️ <b>TOURNAMENT MODE CHANGED TO TEAM COMPETITION!</b> 🛡️\n\nCheck live team standings with <code>/leaderboard</code>!`;
    }

    // Broadcast mode change to all players
    const players = await getAllPlayers();
    for (const p of players) {
      try {
        await bot.telegram.sendMessage(p.telegram_id, broadcastMsg, { parse_mode: 'HTML' });
      } catch (e) {}
    }

    return ctx.replyWithHTML(broadcastMsg);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// Admin Command: /addsoloscore or /soloscore <PlayerIGN_or_Handle> <Points>
const handleAddSoloScore = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const text = ctx.message.text.trim().replace(/^\/(addsoloscore|soloscore)/i, '').trim();
  const lastSpaceIndex = text.lastIndexOf(' ');

  if (lastSpaceIndex === -1) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/addsoloscore &lt;PlayerIGN_or_Handle&gt; &lt;Points&gt;</code>\n\nExample: <code>/addsoloscore Raven 15</code> (or <code>-5</code> to deduct)');
  }

  const playerInput = text.substring(0, lastSpaceIndex).trim();
  const points = parseInt(text.substring(lastSpaceIndex + 1).trim(), 10);

  if (isNaN(points)) {
    return ctx.reply('❌ Points must be a valid number!');
  }

  try {
    const updatedUser = await addSoloScore(playerInput, points);
    const ignEsc = String(updatedUser.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sign = points >= 0 ? `+${points}` : `${points}`;
    return ctx.replyWithHTML(`🎯 <b>Solo Points Updated!</b>\n\n👤 <b>Player:</b> ${ignEsc}\n➕ <b>Points Change:</b> ${sign} Solo Points\n📊 <b>Total Solo Points:</b> <code>${updatedUser.solo_score || 0} Pts</code>`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('addsoloscore', handleAddSoloScore);
bot.command('soloscore', handleAddSoloScore);



bot.action('cmd_profile', async (ctx) => {

  ctx.answerCbQuery();
  try {
    const user = await getPlayerProfile(ctx.from.id);
    if (!user) {
      return ctx.reply('⚠️ You are not registered yet. Use `/register <InGameName>` to join.', { parse_mode: 'Markdown' });
    }
    const cards = user.cards || [];
    const cardNames = cards.map(cid => POWER_CARDS[cid] ? `${POWER_CARDS[cid].icon} ${POWER_CARDS[cid].name}` : cid);
    const cardsText = cardNames.length ? cardNames.join(', ') : 'None';
    const text = `👤 *Player Profile for ${user.in_game_name}*\n\n💰 *Power Coins:* \`${user.coins || 0} PC\`\n🎴 *Cards Hand:* ${cardsText}\n🟢 *Tournament Status:* ${user.status || 'Active'}`;
    return safeReplyMarkdown(ctx, text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_myteam', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const user = await getUser(ctx.from.id);
    if (!user || !user.team_id) {
      return ctx.reply('⚠️ You are not in any team yet. Create one with `/createteam` or join with `/jointeam`.', { parse_mode: 'Markdown' });
    }
    const team = await getTeamDetails(user.team_id);
    if (!team) return ctx.reply('❌ Team not found.');

    const statusEmoji = team.status === 'Active' ? '🟢' : '🔴';
    const teamNameEsc = String(team.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let rosterMsg = `🛡️ <b>Team:</b> ${teamNameEsc} (${statusEmoji} ${team.status})\n🔑 <b>Join Code:</b> <code>${team.join_code}</code>\n\n👥 <b>Roster:</b>`;

    team.memberProfiles.forEach((p, idx) => {
      const isCap = String(p.telegram_id) === String(team.captain_id) ? '👑 Captain' : '👤 Member';
      const cleanPStatus = formatPlayerStatus(p.status);
      const playerEmoji = cleanPStatus === 'Active' ? '🟢' : '🔴';
      const ignEsc = String(p.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rosterMsg += `\n${idx + 1}. <b>${ignEsc}</b> - ${isCap} (${playerEmoji} ${cleanPStatus})`;
    });

    const isCaptain = String(team.captain_id) === String(ctx.from.id);
    const buttons = [];

    if (isCaptain) {
      const nonCaptains = team.memberProfiles.filter(p => String(p.telegram_id) !== String(team.captain_id));
      nonCaptains.forEach(p => {
        buttons.push([Markup.button.callback(`🚫 Kick ${p.in_game_name}`, `captain_kick_${p.telegram_id}`)]);
      });
    }
    buttons.push([Markup.button.callback('🏠 Main Menu', 'cmd_menu')]);

    return ctx.replyWithHTML(rosterMsg, Markup.inlineKeyboard(buttons));
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_store', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const coins = await getUserCoins(ctx.from.id);
    let text = `🛒 *WELCOME TO THE POWER STORE!* 🛒\n\n💰 *Your Balance:* \`${coins} Power Coins (PC)\`\n\nSelect a card below to buy:`;
    const buttons = [];
    Object.keys(POWER_CARDS).forEach(cardId => {
      const card = POWER_CARDS[cardId];
      buttons.push([Markup.button.callback(`${card.icon} ${card.name} (${card.price} PC)`, `buy_card_${cardId}`)]);
    });
    return ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_matches', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const matches = await getAllMatches();
    if (!matches.length) return ctx.reply('ℹ️ No match fixtures scheduled yet.');

    let text = `⚔️ *TOURNAMENT MATCH FIXTURES* ⚔️\n\n`;
    matches.forEach((m, idx) => {
      const statusIcon = m.status === 'Completed' ? '✅' : '⏳';
      text += `${idx + 1}. *${m.team1_name}* VS *${m.team2_name}*\n📅 Time: \`${m.match_time}\` (${statusIcon} ${m.status})`;
      if (m.winner_team_name) {
        text += `\n🏆 *Winner:* ${m.winner_team_name}`;
      }
      text += `\n\n`;
    });
    return safeReplyMarkdown(ctx, text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_teams', async (ctx) => {

  ctx.answerCbQuery();
  try {
    const teams = await getAllTeams();
    if (!teams.length) return ctx.reply('ℹ️ No teams registered yet.');
    let activeCount = 0;
    let elimCount = 0;
    let msg = `🏆 *Tournament Teams Overview* 🏆\n\n`;
    teams.forEach((t, i) => {
      const emoji = t.status === 'Active' ? '🟢' : '🔴';
      if (t.status === 'Active') activeCount++; else elimCount++;
      msg += `${i + 1}. *${t.name}* - ${emoji} ${t.status} (${t.members ? t.members.length : 0} players)\n`;
    });
    msg += `\n📊 *Summary:* Active: ${activeCount} | Eliminated: ${elimCount} | Total: ${teams.length}`;
    return safeReplyMarkdown(ctx, msg);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_players', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const players = await getAllPlayers();
    if (!players.length) return ctx.reply('ℹ️ No players registered yet.');
    let activeCount = 0;
    let elimCount = 0;
    
    players.forEach(p => {
      const statusText = (typeof p.status === 'string' ? p.status : 'Active') === 'Eliminated' ? 'Eliminated' : 'Active';
      if (statusText === 'Active') activeCount++; else elimCount++;
    });

    let msg = `👥 *Tournament Players Overview* 👥\n\n🟢 *Active Players:* ${activeCount}\n🔴 *Eliminated Players:* ${elimCount}\n📊 *Total Registered:* ${players.length}\n\n`;
    players.slice(0, 20).forEach((p, i) => {
      const statusText = (typeof p.status === 'string' ? p.status : 'Active') === 'Eliminated' ? 'Eliminated' : 'Active';
      const emoji = statusText === 'Active' ? '🟢' : '🔴';
      const safeIGN = sanitizeMarkdown(p.in_game_name);
      msg += `${i + 1}. *${safeIGN}* (${emoji} ${statusText})\n`;
    });
    if (players.length > 20) msg += `\n...and ${players.length - 20} more players.`;
    return safeReplyMarkdown(ctx, msg);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


bot.action('cmd_leaveteam', async (ctx) => {
  ctx.answerCbQuery();
  try {
    return await promptLeaveTeamConfirmation(ctx);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});







// Comprehensive Guide Text
function getHelpGuide() {
  return `
📖 *MSGC TOURNAMENT BOT - COMPLETE GUIDE & COMMAND LIST* 📖

Welcome! Here is a full breakdown of every command available in the bot and how to use them:

---

🎮 *1. REGISTRATION & PROFILE*
• \`/register <InGameName>\`
  Creates your tournament player profile with your IGN.
• \`/unregister\`
  Quits the tournament and deletes your profile (with confirmation).
• \`/profile\`
  Displays your profile, team details, and status.

---

🛡️ *2. TEAM MANAGEMENT*
• \`/createteam <TeamName>\`
  Creates a new team with a 6-character Join Code. You become Team Captain. (Max 4 players per team).
• \`/jointeam <JoinCode>\`
  Join an existing team using its Join Code.
• \`/myteam\`
  View your team roster, captain, join code, and player status (🟢 Active / 🔴 Eliminated).
• \`/leaveteam\`
  Leave your current team (Transfers captaincy if you are captain).
• \`/makecaptain <TeammateIGN>\` or \`/make <TeammateIGN>\` (Captain Only)
  Transfers team captainship to a teammate. (Or reply to their message with \`/make\`).

---

🏆 *3. TOURNAMENT INFO & FIXTURES*
• \`/menu\`
  Brings up the interactive Main Dashboard Menu anytime.
• \`/teams\`
  Lists all registered teams with real-time active/eliminated counts.
• \`/players\`
  Lists all registered players with handle/profile name and status.
• \`/matches\`
  Displays scheduled & completed match fixtures, match IDs, and winners.
• \`/leaderboard\`
  Displays the live tournament Scoreboard table with Points, Wins (W), and Losses (L).
• \`/rules\`
  Displays official tournament rules & guidelines.

---

👑 *4. ORGANISER & ADMIN COMMANDS (Admins Only)*
• \`/admin\` - Interactive panel to manage teams, drill down into rosters, and eliminate/restore players or teams.
• \`/creatematch TeamA vs TeamB @ Time # GameName\` - Schedule a match fixture.
• \`/editmatch <MatchID_or_Team> NewTeamA vs NewTeamB @ Time # GameName\` - Edit a match fixture.
• \`/setwinner <MatchID_or_Team> <WinnerTeam>\` - Record match winner.
• \`/addscore <TeamName> <Points>\` - Add or deduct score points (+10 or -5).
• \`/openreg\` & \`/closereg\` - Lock or open player registration.
• \`/addrule <RuleText>\` - Add a new numbered rule (1, 2, 3...) to the dictionary.
• \`/removerule <RuleNumber>\` - Delete a specific rule by number (e.g. \`/removerule 2\`).
• \`/clearallrules\` - Remove all rules from the dictionary.
• \`/champion <TeamName>\` - Declare official tournament winner and send victory broadcast.
• \`/broadcast <Message>\` - Send announcement to all players & group chats.
  `;
}


// /help command
bot.help(async (ctx) => {
  return safeReplyMarkdown(ctx, getHelpGuide(), Markup.inlineKeyboard([
    [Markup.button.callback('🏠 Main Menu', 'cmd_menu')]
  ]));
});

bot.action('cmd_help', async (ctx) => {
  ctx.answerCbQuery();
  return safeReplyMarkdown(ctx, getHelpGuide(), Markup.inlineKeyboard([
    [Markup.button.callback('🏠 Main Menu', 'cmd_menu')]
  ]));
});


// /register <in_game_name>
bot.command('register', async (ctx) => {
  try {
    const open = await isRegistrationOpen();
    if (!open && !isAdmin(ctx)) {
      return ctx.reply('🔒 Registration is currently CLOSED by the tournament admin.');
    }

    const text = ctx.message.text.trim();
    const args = text.split(' ').slice(1).join(' ');

    if (!args) {
      return ctx.reply('⚠️ Please provide your In-Game Name!\nUsage: `/register <YourInGameName>`', { parse_mode: 'Markdown' });
    }

    const user = await registerUser(ctx.from.id, ctx.from.username, args, ctx.from.first_name);

    const ign = String(user.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return ctx.replyWithHTML(`✅ <b>Registration Successful!</b>\n\n🎮 <b>In-Game Name:</b> ${ign}\n🆔 <b>Telegram ID:</b> <code>${user.telegram_id}</code>\n🟢 <b>Status:</b> ${user.status}`);
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});

// Admin Command: /openreg - Open registrations
bot.command('openreg', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  await setRegistrationStatus(true);
  return ctx.replyWithMarkdown('🔓 *Tournament Registration is now OPEN!* Players can join with `/register`.');
});

// Admin Command: /closereg - Close registrations
bot.command('closereg', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  await setRegistrationStatus(false);
  return ctx.replyWithMarkdown('🔒 *Tournament Registration is now CLOSED!* No new players can register.');
});

/**
 * -------------------------------------------------------------
 * MATCH FIXTURES & BRACKETS SYSTEM
 * -------------------------------------------------------------
 */

// /matches - View all scheduled & completed matches
bot.command('matches', async (ctx) => {
  try {
    const matches = await getAllMatches();
    if (!matches.length) return ctx.reply('ℹ️ No match fixtures scheduled yet.');

    let text = `⚔️ *TOURNAMENT MATCH FIXTURES* ⚔️\n\n`;
    
    matches.forEach((m, idx) => {
      const statusIcon = m.status === 'Completed' ? '✅' : '⏳';
      text += `🆔 *Match ID:* \`${m.id}\`\n⚔️ *Match ${idx + 1}:* *${m.team1_name}* VS *${m.team2_name}*\n📅 *Time:* \`${m.match_time}\` (${statusIcon} ${m.status})`;
      if (m.winner_team_name) {
        text += `\n🏆 *Winner:* **${m.winner_team_name}**`;
      }
      text += `\n───────────────\n`;
    });

    return safeReplyMarkdown(ctx, text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// Admin Command: /addmatch or /creatematch <Team1> vs <Team2> @ <Time> [# Match/Game Name]
const handleCreateMatch = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const text = ctx.message.text.trim().replace(/^\/(addmatch|creatematch)/i, '').trim();
  
  // Format: TeamA vs TeamB @ 8 PM # Game/Match Name
  const parts = text.split(/vs|VS|Vs/);
  if (parts.length < 2) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/addmatch TeamAlpha vs TeamBravo @ 8 PM # BGMI Tournament</code>\nOr: <code>/creatematch TeamA vs TeamB</code>');
  }

  const team1Name = parts[0].trim();
  let team2AndFormat = parts[1].split('@');
  const team2Name = team2AndFormat[0].trim();
  let matchTime = 'TBD';
  let matchName = 'Tournament Match';

  if (team2AndFormat[1]) {
    const timeAndName = team2AndFormat[1].split('#');
    matchTime = timeAndName[0].trim() || 'TBD';
    if (timeAndName[1]) matchName = timeAndName[1].trim();
  }

  try {
    const match = await createMatch(team1Name, team2Name, matchTime, matchName);
    return ctx.replyWithHTML(`⚔️ <b>Match Scheduled Successfully!</b>\n\n🎮 <b>Game/Match Name:</b> ${match.match_name}\n🛡️ <b>${match.team1_name}</b> VS <b>${match.team2_name}</b>\n📅 <b>Time:</b> <code>${match.match_time}</code>\n🆔 <b>Match ID:</b> <code>${match.id}</code>`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('addmatch', handleCreateMatch);
bot.command('creatematch', handleCreateMatch);

// Admin Command: /editmatch <MatchID_or_Team> <NewTeam1> vs <NewTeam2> @ <Time> [# NewGameName]
bot.command('editmatch', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const text = ctx.message.text.trim().replace(/^\/editmatch/i, '').trim();

  // Usage: /editmatch match_12345 TeamA vs TeamB @ 9 PM # New Match Name
  const spaceIndex = text.indexOf(' ');
  if (spaceIndex === -1) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/editmatch &lt;MatchID_or_Team&gt; NewTeamA vs NewTeamB @ 9 PM # GameName</code>');
  }

  const identifier = text.substring(0, spaceIndex).trim();
  const restText = text.substring(spaceIndex + 1).trim();

  const parts = restText.split(/vs|VS|Vs/);
  if (parts.length < 2) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/editmatch &lt;MatchID_or_Team&gt; NewTeamA vs NewTeamB @ 9 PM</code>');
  }

  const newTeam1 = parts[0].trim();
  let team2AndFormat = parts[1].split('@');
  const newTeam2 = team2AndFormat[0].trim();
  let newTime = 'TBD';
  let newName = null;

  if (team2AndFormat[1]) {
    const timeAndName = team2AndFormat[1].split('#');
    newTime = timeAndName[0].trim() || 'TBD';
    if (timeAndName[1]) newName = timeAndName[1].trim();
  }

  try {
    const updatedMatch = await editMatch(identifier, newTeam1, newTeam2, newTime, newName);
    return ctx.replyWithHTML(`✏️ <b>Match Fixture Updated!</b>\n\n🆔 <b>Match ID:</b> <code>${updatedMatch.id}</code>\n🎮 <b>Game/Match Name:</b> ${updatedMatch.match_name || 'Tournament Match'}\n🛡️ <b>${updatedMatch.team1_name}</b> VS <b>${updatedMatch.team2_name}</b>\n📅 <b>Time:</b> <code>${updatedMatch.match_time}</code>`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Command: /addscore <TeamName_or_PlayerIGN> <Points>
bot.command('addscore', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const text = ctx.message.text.trim().replace(/^\/addscore/i, '').trim();
  const lastSpaceIndex = text.lastIndexOf(' ');

  if (lastSpaceIndex === -1) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/addscore &lt;TeamName_or_PlayerIGN&gt; &lt;Points&gt;</code>\n\nExample: <code>/addscore Warriors 10</code> or <code>/addscore Raven 15</code>');
  }

  const targetInput = text.substring(0, lastSpaceIndex).trim();
  const points = parseInt(text.substring(lastSpaceIndex + 1).trim(), 10);

  if (isNaN(points)) {
    return ctx.reply('❌ Points must be a valid number!');
  }

  const mode = await getTournamentMode();

  if (mode === 'solo') {
    try {
      const updatedUser = await addSoloScore(targetInput, points);
      const ignEsc = String(updatedUser.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sign = points >= 0 ? `+${points}` : `${points}`;
      return ctx.replyWithHTML(`🎯 <b>Solo Score Updated!</b>\n\n👤 <b>Player:</b> ${ignEsc}\n➕ <b>Points Change:</b> ${sign} Pts\n📊 <b>Total Solo Score:</b> <code>${updatedUser.solo_score || 0} Pts</code>`);
    } catch (err) {
      return ctx.reply(`❌ ${err.message}`);
    }
  }

  // Team mode default, with fallback to solo player lookup if team not found
  try {
    const updatedTeam = await addTeamScore(targetInput, points);
    return ctx.replyWithHTML(`🎯 <b>Team Score Updated!</b>\n\n🛡️ <b>Team:</b> ${updatedTeam.name}\n➕ <b>Added:</b> +${points} Pts\n📊 <b>Total Points:</b> <code>${updatedTeam.points} Pts</code>`);
  } catch (err) {
    try {
      const updatedUser = await addSoloScore(targetInput, points);
      const ignEsc = String(updatedUser.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sign = points >= 0 ? `+${points}` : `${points}`;
      return ctx.replyWithHTML(`🎯 <b>Solo Score Updated!</b>\n\n👤 <b>Player:</b> ${ignEsc}\n➕ <b>Points Change:</b> ${sign} Pts\n📊 <b>Total Solo Score:</b> <code>${updatedUser.solo_score || 0} Pts</code>`);
    } catch (e) {
      return ctx.reply(`❌ ${err.message}`);
    }
  }
});

/**
 * -------------------------------------------------------------
 * SCORECARD & LEADERBOARD SYSTEM
 * -------------------------------------------------------------
 */

// /leaderboard - Display tournament standings table (includes Wins & Losses)
bot.command('leaderboard', async (ctx) => {
  try {
    const teams = await getLeaderboard();
    if (!teams.length) return ctx.reply('ℹ️ No teams registered yet for leaderboard.');

    let text = `📊 <b>TOURNAMENT SCORECARD & LEADERBOARD</b> 📊\n\n`;
    text += `<code>Rank | Team Name        | Pts | W  | L </code>\n`;
    text += `<code>───────────────────────────────────────</code>\n`;

    teams.forEach((t, idx) => {
      const rank = String(idx + 1).padStart(2, ' ');
      const name = (t.name.length > 14 ? t.name.substring(0, 11) + '...' : t.name).padEnd(14, ' ');
      const pts = String(t.points || 0).padStart(3, ' ');
      const wins = String(t.wins || 0).padStart(2, ' ');
      const losses = String(t.losses || 0).padStart(2, ' ');
      const statusEmoji = t.status === 'Active' ? '🟢' : '🔴';

      text += `<code>${rank}.  | ${name} | ${pts} | ${wins} | ${losses}</code> ${statusEmoji}\n`;
    });

    text += `\n🟢 = Active | 🔴 = Eliminated\n<i>W = Matches Won | L = Matches Lost</i>`;
    return ctx.replyWithHTML(text);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

/**
 * -------------------------------------------------------------
 * RULES, CHAMPION & AUTOMATED MATCH REMINDER SYSTEM
 * -------------------------------------------------------------
 */

// /rules - View official tournament rules
bot.command('rules', async (ctx) => {
  try {
    const rulesText = await getTournamentRules();
    return ctx.replyWithHTML(rulesText);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

bot.action('cmd_rules', async (ctx) => {
  ctx.answerCbQuery();
  try {
    const rulesText = await getTournamentRules();
    return ctx.replyWithHTML(rulesText);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// Admin Command: /addrule or /setrules <RuleText> - Add a numbered rule to rules dictionary
const handleAddRule = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const ruleText = ctx.message.text.trim().replace(/^\/(addrule|setrules)/i, '').trim();
  if (!ruleText) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/addrule &lt;Write rule text here...&gt;</code>\n\nExample: <code>/addrule No teaming up with enemy squads.</code>');
  }

  try {
    const result = await addTournamentRule(ruleText);
    return ctx.replyWithHTML(`📜 <b>Rule #${result.ruleNumber} Added Successfully!</b>\n\n<b>Text:</b> ${ruleText}\n📊 <b>Total Active Rules:</b> ${result.totalRules}\n\nPlayers can view updated dictionary using <code>/rules</code>.`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('addrule', handleAddRule);
bot.command('setrules', handleAddRule);

// Admin Command: /removerule or /delrule <RuleNumber> - Remove specific rule by index
const handleRemoveSingleRule = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const text = ctx.message.text.trim().replace(/^\/(removerule|delrule)/i, '').trim();
  const ruleNum = parseInt(text, 10);

  if (isNaN(ruleNum)) {
    return ctx.replyWithHTML('⚠️ Usage: <code>/removerule &lt;RuleNumber&gt;</code>\n\nExample: <code>/removerule 2</code> (Removes Rule #2)');
  }

  try {
    const { removedRule, remainingRules } = await removeTournamentRuleByNumber(ruleNum);
    return ctx.replyWithHTML(`🗑️ <b>Rule #${ruleNum} Removed!</b>\n\n<b>Removed Text:</b> ${removedRule}\n📊 <b>Remaining Rules:</b> ${remainingRules.length}\n\nRemaining rules have been re-indexed automatically (1, 2, 3...).`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('removerule', handleRemoveSingleRule);
bot.command('delrule', handleRemoveSingleRule);

// Admin Command: /clearallrules or /removerules - Clear all rules completely
const handleRemoveAllRules = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  try {
    await clearTournamentRules();
    return ctx.replyWithHTML('📜 <b>All Tournament Rules Cleared Successfully!</b>\n\nPlayers viewing <code>/rules</code> will now see that no active rules are set.');
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('clearallrules', handleRemoveAllRules);
bot.command('removerules', handleRemoveAllRules);

// Admin Command: /champion <TeamName_or_PlayerIGN> - Declare official tournament winner
bot.command('champion', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!args) return ctx.replyWithHTML('⚠️ Usage: <code>/champion &lt;WinningTeamName_or_PlayerIGN&gt;</code>');

  try {
    const res = await declareChampion(args);
    let victoryMsg = `👑 🏆 <b>TOURNAMENT CHAMPION DECLARED!</b> 🏆 👑\n\n`;

    if (res.type === 'team') {
      const winnerTeam = res.entity;
      const teamDetails = await getTeamDetails(winnerTeam.id);
      const teamNameEsc = String(winnerTeam.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      
      victoryMsg += `🎉 <b>CONGRATULATIONS TO TEAM ${teamNameEsc.toUpperCase()}!</b> 🎉\n\n`;
      victoryMsg += `👥 <b>CHAMPION ROSTER:</b>\n`;

      if (teamDetails && teamDetails.memberProfiles) {
        teamDetails.memberProfiles.forEach((p, idx) => {
          const handle = formatPlayerHandle(p);
          const ignEsc = String(p.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          victoryMsg += `${idx + 1}. <b>${ignEsc}</b> (${handle})\n`;
        });
      }
    } else {
      const winnerPlayer = res.entity;
      const ignEsc = String(winnerPlayer.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const handle = formatPlayerHandle(winnerPlayer);

      victoryMsg += `🎉 <b>CONGRATULATIONS TO THE SOLO CHAMPION: ${ignEsc.toUpperCase()}!</b> 🎉\n\n`;
      victoryMsg += `👤 <b>Player:</b> <b>${ignEsc}</b> (${handle})\n`;
      victoryMsg += `📊 <b>Final Solo Score:</b> <code>${winnerPlayer.solo_score || 0} Pts</code>\n`;
    }

    victoryMsg += `\n🌟 <b>Thank you to all participating teams and players!</b> 🌟`;

    // Broadcast champion victory message to all players
    const players = await getAllPlayers();
    for (const p of players) {
      try {
        await bot.telegram.sendMessage(p.telegram_id, victoryMsg, { parse_mode: 'HTML' });
      } catch (e) {}
    }

    return ctx.replyWithHTML(victoryMsg);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

/**
 * AUTOMATED MATCH REMINDER (Runs every 2 minutes in background)
 * Checks for upcoming matches and notifies participating teams & groups!
 */
const notifiedMatches = new Set();

setInterval(async () => {
  try {
    const matches = await getAllMatches();
    const upcomingMatches = matches.filter(m => m.status === 'Upcoming');

    for (const match of upcomingMatches) {
      if (notifiedMatches.has(match.id)) continue;

      // Check if match time is specified
      if (match.match_time && match.match_time !== 'TBD') {
        const team1 = await getTeamDetails(match.team1_id);
        const team2 = await getTeamDetails(match.team2_id);

        const reminderMsg = `⏰ *UPCOMING MATCH REMINDER!* ⏰\n\n⚔️ *Match:* *${match.team1_name}* VS *${match.team2_name}*\n📅 *Scheduled Time:* \`${match.match_time}\`\n\n⚠️ Players from both teams please prepare to join room!`;

        // Send to team 1 members
        if (team1 && team1.members) {
          for (const mId of team1.members) {
            try { await bot.telegram.sendMessage(mId, reminderMsg, { parse_mode: 'Markdown' }); } catch (e) {}
          }
        }

        // Send to team 2 members
        if (team2 && team2.members) {
          for (const mId of team2.members) {
            try { await bot.telegram.sendMessage(mId, reminderMsg, { parse_mode: 'Markdown' }); } catch (e) {}
          }
        }

        notifiedMatches.add(match.id);
      }
    }
  } catch (e) {
    // Ignore background check errors
  }
}, 2 * 60 * 1000); // Check every 2 minutes








// Safe reply with fallback to plain text if Markdown fails
async function safeReplyMarkdown(ctx, text, extra = {}) {
  try {
    return await ctx.replyWithMarkdown(text, extra);
  } catch (err) {
    const plainText = text.replace(/[*_`]/g, '');
    return await ctx.reply(plainText, extra);
  }
}


// /createteam <team_name>
bot.command('createteam', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    const teamName = text.split(' ').slice(1).join(' ');

    if (!teamName) {
      return ctx.reply('⚠️ Please provide a Team Name!\nUsage: `/createteam <TeamName>`', { parse_mode: 'Markdown' });
    }

    const team = await createTeam(ctx.from.id, teamName);
    const safeCaptainName = sanitizeMarkdown(ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);
    const safeTeamName = sanitizeMarkdown(team.name);

    return ctx.replyWithMarkdown(`
🎉 *Team Created Successfully!*

🛡️ *Team Name:* ${safeTeamName}
🔑 *Join Code:* \`${team.join_code}\` (Share this code with your teammates)
👑 *Captain:* ${safeCaptainName}

Teammates can join by typing:
\`/jointeam ${team.join_code}\`
    `);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// /jointeam <code>
bot.command('jointeam', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    const joinCode = text.split(' ')[1];

    if (!joinCode) {
      return ctx.reply('⚠️ Please provide the Join Code!\nUsage: `/jointeam <JoinCode>`', { parse_mode: 'Markdown' });
    }

    const { team, user } = await requestJoinTeam(ctx.from.id, joinCode);

    // Format notification for Team Captain (Sanitized)
    const requesterHandle = formatPlayerHandle(user);
    const safeIGN = sanitizeMarkdown(user.in_game_name);
    const safeTeamName = sanitizeMarkdown(team.name);

    const captainMsg = `📩 *NEW TEAM JOIN REQUEST!*\n\n🎮 Player: *${safeIGN}* (${requesterHandle})\n🛡️ Team: *${safeTeamName}*\n\nDo you want to accept this player into your team?`;

    const captainButtons = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Accept Player', `accept_join_${user.telegram_id}`),
        Markup.button.callback('❌ Reject Request', `reject_join_${user.telegram_id}`)
      ]
    ]);

    // Send DM notification with Accept/Reject buttons directly to Team Captain
    let dmDelivered = false;
    try {
      await safeSendMessage(team.captain_id, captainMsg, captainButtons);
      dmDelivered = true;
    } catch (e) {
      console.log(`Note: DM to captain ${team.captain_id} failed.`);
    }

    // If request sent in group chat or DM failed, output fallback buttons in chat only if captain is present
    if (!dmDelivered) {
      const fallbackChatMsg = `📩 *JOIN REQUEST SENT FOR TEAM ${safeTeamName.toUpperCase()}!* 📩\n\n🎮 Player: *${safeIGN}* (${requesterHandle})\n👑 *Team Captain:* DM attempt failed. Please approve or reject below or type \`/requests\` in bot DM!`;
      return safeReplyMarkdown(ctx, fallbackChatMsg, captainButtons);
    }

    // Clean confirmation for the requesting user (No approval buttons shown to requester)
    const userConfirmMsg = `📩 *JOIN REQUEST SENT FOR TEAM ${safeTeamName.toUpperCase()}!* 📩\n\nYour join request has been sent to the Team Captain. Please wait for the Captain to accept it!`;
    return safeReplyMarkdown(ctx, userConfirmMsg);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});




// /requests - Allow Captain to view & accept any pending requests manually
bot.command('requests', async (ctx) => {
  try {
    const user = await getUser(ctx.from.id);
    if (!user || !user.team_id) return ctx.reply('❌ You are not in any team.');

    const team = await getTeamDetails(user.team_id);
    if (!team) return ctx.reply('❌ Team not found.');

    if (String(team.captain_id) !== String(ctx.from.id) && !isAdmin(ctx)) {
      return ctx.reply('⛔ Only the Team Captain can view pending join requests!');
    }

    const pendingRequests = team.pending_requests || [];
    if (!pendingRequests.length) {
      return ctx.reply(`ℹ️ Team *${team.name}* has no pending join requests right now.`, { parse_mode: 'Markdown' });
    }

    let text = `📩 *PENDING JOIN REQUESTS FOR TEAM ${team.name.toUpperCase()}*\n\nSelect a player below to accept or decline:`;
    const buttons = [];

    for (const reqId of pendingRequests) {
      const reqUser = await getUser(reqId);
      if (reqUser) {
        const handle = formatPlayerHandle(reqUser);
        buttons.push([
          Markup.button.callback(`✅ Accept ${reqUser.in_game_name} (${handle})`, `accept_join_${reqUser.telegram_id}`),
          Markup.button.callback(`❌ Decline`, `reject_join_${reqUser.telegram_id}`)
        ]);
      }
    }

    return ctx.replyWithMarkdown(text, Markup.inlineKeyboard(buttons));
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// Captain Callback: Accept Join Request
bot.action(/accept_join_(.+)/, async (ctx) => {
  const requesterId = ctx.match[1];
  try {
    const { team, requester } = await acceptJoinRequest(ctx.from.id, requesterId);
    ctx.answerCbQuery('Player accepted!');
    
    // Notify requesting player
    try {
      await bot.telegram.sendMessage(requester.telegram_id, `🎉 *JOIN REQUEST ACCEPTED!*\n\nYou are now an official member of team *${team.name}*!`, { parse_mode: 'Markdown' });
    } catch (e) {}

    return ctx.editMessageText(`✅ *PLAYER ACCEPTED!*\n\n*${requester.in_game_name}* has been added to team *${team.name}*!\n👥 Total Members: ${team.members.length}/4`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.answerCbQuery(err.message, { show_alert: true });
  }
});

// Captain Callback: Reject Join Request
bot.action(/reject_join_(.+)/, async (ctx) => {
  const requesterId = ctx.match[1];
  try {
    const { team, requester } = await rejectJoinRequest(ctx.from.id, requesterId);
    ctx.answerCbQuery('Request rejected');

    // Notify requesting player
    try {
      await bot.telegram.sendMessage(requester.telegram_id, `❌ Your request to join team *${team.name}* was declined by the Team Captain.`, { parse_mode: 'Markdown' });
    } catch (e) {}

    return ctx.editMessageText(`❌ Join request from *${requester ? requester.in_game_name : 'Player'}* was declined.`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.answerCbQuery(err.message, { show_alert: true });
  }
});

// /kick <TeammateIGN_or_Handle> - Captain removes a player from their team
bot.command('kick', async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    let targetInput = text.split(' ').slice(1).join(' ');

    if (!targetInput && ctx.message.reply_to_message) {
      targetInput = String(ctx.message.reply_to_message.from.id);
    }

    if (!targetInput) {
      return ctx.reply('⚠️ Usage Options:\n1. `/kick GamerName`\n2. Reply to your teammate\'s message with `/kick`', { parse_mode: 'Markdown' });
    }

    // Verify requesting user is in a team and is captain
    const user = await getUser(ctx.from.id);
    if (!user || !user.team_id) return ctx.reply('❌ You are not in any team.');

    const team = await getTeamDetails(user.team_id);
    if (!team) return ctx.reply('❌ Team not found.');

    if (String(team.captain_id) !== String(ctx.from.id) && !isAdmin(ctx)) {
      return ctx.reply('⛔ Only the Team Captain can kick players from the team!');
    }

    const { user: kickedUser, teamName } = await kickPlayerFromTeam(targetInput, team.id);

    if (String(kickedUser.telegram_id) === String(team.captain_id)) {
      return ctx.reply('❌ The Team Captain cannot be kicked! Transfer captainship first using `/makecaptain`.');
    }

    // Notify kicked player
    try {
      await bot.telegram.sendMessage(kickedUser.telegram_id, `🔴 You have been removed from team *${teamName}* by the Team Captain.`, { parse_mode: 'Markdown' });
    } catch (e) {}

    return ctx.replyWithHTML(`🔴 <b>Player Kicked!</b>\n\n<b>${kickedUser.in_game_name}</b> has been removed from team <b>${teamName}</b>.`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// /makecaptain or /make <TeammateIGN_or_Handle> - Transfer Captainship
const handleMakeCaptain = async (ctx) => {
  try {
    const text = ctx.message.text.trim();
    let targetInput = text.split(' ').slice(1).join(' ');

    if (!targetInput && ctx.message.reply_to_message) {
      targetInput = String(ctx.message.reply_to_message.from.id);
    }

    if (!targetInput) {
      return ctx.replyWithHTML('⚠️ Usage Options:\n1. <code>/makecaptain TeammateIGN</code> or <code>/make TeammateIGN</code>\n2. Reply to your teammate\'s message with <code>/makecaptain</code>');
    }

    const { team, newCaptain } = await transferCaptainship(ctx.from.id, targetInput);

    // Notify new captain
    try {
      await bot.telegram.sendMessage(newCaptain.telegram_id, `👑 <b>CONGRATULATIONS!</b>\n\nYou are now the new <b>Team Captain</b> of team <b>${team.name}</b>!`, { parse_mode: 'HTML' });
    } catch (e) {}

    return ctx.replyWithHTML(`👑 <b>Captainship Transferred!</b>\n\n<b>${newCaptain.in_game_name}</b> is now the Team Captain of team <b>${team.name}</b>!`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('makecaptain', handleMakeCaptain);
bot.command('make', handleMakeCaptain);

// Interactive inline button action for Captain kicking a team member
bot.action(/^captain_kick_(\d+)$/, async (ctx) => {
  const targetId = ctx.match[1];
  try {
    const user = await getUser(ctx.from.id);
    if (!user || !user.team_id) return ctx.answerCbQuery('❌ You are not in any team.', { show_alert: true });

    const team = await getTeamDetails(user.team_id);
    if (!team) return ctx.answerCbQuery('❌ Team not found.', { show_alert: true });

    if (String(team.captain_id) !== String(ctx.from.id) && !isAdmin(ctx)) {
      return ctx.answerCbQuery('⛔ Only the Team Captain can kick players!', { show_alert: true });
    }

    const { user: kickedUser, teamName } = await kickPlayerFromTeam(targetId, team.id);
    ctx.answerCbQuery(`Kicked ${kickedUser.in_game_name}`);

    try {
      await bot.telegram.sendMessage(kickedUser.telegram_id, `🔴 You have been removed from team <b>${teamName}</b> by your Team Captain.`, { parse_mode: 'HTML' });
    } catch (e) {}

    return ctx.replyWithHTML(`🔴 <b>Player Kicked!</b>\n\n<b>${kickedUser.in_game_name}</b> has been removed from team <b>${teamName}</b>.`);
  } catch (err) {
    return ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
  }
});



// /players - Show player stats & statuses
bot.command('players', async (ctx) => {
  try {
    const players = await getAllPlayers();
    if (!players.length) return ctx.reply('ℹ️ No players registered yet.');

    let activeCount = 0;
    let elimCount = 0;
    
    players.forEach(p => {
      const cleanStatus = formatPlayerStatus(p.status);
      if (cleanStatus === 'Active') activeCount++; else elimCount++;
    });

    let msg = `👥 <b>Tournament Players Overview</b> 👥\n\n🟢 <b>Active Players:</b> ${activeCount}\n🔴 <b>Eliminated Players:</b> ${elimCount}\n📊 <b>Total Registered:</b> ${players.length}\n\n`;
    
    players.slice(0, 30).forEach((p, i) => {
      const cleanStatus = formatPlayerStatus(p.status);
      const emoji = cleanStatus === 'Active' ? '🟢' : '🔴';
      const handle = formatPlayerHandle(p);
      const ignEsc = String(p.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      msg += `${i + 1}. <b>${ignEsc}</b> (${handle}) - ${emoji} ${cleanStatus}\n`;
    });

    if (players.length > 30) msg += `\n...and ${players.length - 30} more players.`;

    return ctx.replyWithHTML(msg);
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});


// /myteam
bot.command('myteam', async (ctx) => {
  try {
    const user = await getUser(ctx.from.id);
    if (!user || !user.team_id) {
      return ctx.replyWithHTML('⚠️ You are not in any team yet. Create one with <code>/createteam &lt;TeamName&gt;</code> or join with <code>/jointeam &lt;JoinCode&gt;</code>.');
    }

    const team = await getTeamDetails(user.team_id);
    if (!team) return ctx.reply('❌ Team not found.');

    const statusEmoji = team.status === 'Active' ? '🟢' : '🔴';
    const teamNameEsc = String(team.name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let rosterMsg = `🛡️ <b>Team:</b> ${teamNameEsc} (${statusEmoji} ${team.status})\n🔑 <b>Join Code:</b> <code>${team.join_code}</code>\n\n👥 <b>Roster:</b>`;

    team.memberProfiles.forEach((p, idx) => {
      const isCap = String(p.telegram_id) === String(team.captain_id) ? '👑 Captain' : '👤 Member';
      const cleanPStatus = formatPlayerStatus(p.status);
      const playerEmoji = cleanPStatus === 'Active' ? '🟢' : '🔴';
      const ignEsc = String(p.in_game_name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      rosterMsg += `\n${idx + 1}. <b>${ignEsc}</b> - ${isCap} (${playerEmoji} ${cleanPStatus})`;
    });

    const isCaptain = String(team.captain_id) === String(ctx.from.id);
    const buttons = [];

    if (isCaptain) {
      const nonCaptains = team.memberProfiles.filter(p => String(p.telegram_id) !== String(team.captain_id));
      nonCaptains.forEach(p => {
        buttons.push([Markup.button.callback(`🚫 Kick ${p.in_game_name}`, `captain_kick_${p.telegram_id}`)]);
      });
    }
    buttons.push([Markup.button.callback('🏠 Main Menu', 'cmd_menu')]);

    return ctx.replyWithHTML(rosterMsg, Markup.inlineKeyboard(buttons));
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});


// Helper function to prompt leave team confirmation
async function promptLeaveTeamConfirmation(ctx) {
  const user = await getUser(ctx.from.id);
  if (!user || !user.team_id) {
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery('⚠️ You are not in any team right now.', { show_alert: true });
    }
    return ctx.reply('⚠️ You are not in any team right now.');
  }

  const team = await getTeamDetails(user.team_id);
  const teamName = team ? team.name : 'your team';
  const safeTeamName = sanitizeMarkdown(teamName);

  const text = `⚠️ *LEAVE TEAM CONFIRMATION*\n\nAre you sure you want to leave team *${safeTeamName}*?\n\nIf you are the Team Captain, captainship will be transferred to a teammate.`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Yes, Leave Team', 'confirm_leave_team_yes'),
      Markup.button.callback('🟢 Cancel & Stay', 'confirm_leave_team_no')
    ]
  ]);

  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (e) {
      return safeReplyMarkdown(ctx, text, keyboard);
    }
  } else {
    return safeReplyMarkdown(ctx, text, keyboard);
  }
}

// /leaveteam command handler
bot.command('leaveteam', async (ctx) => {
  try {
    return await promptLeaveTeamConfirmation(ctx);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Dashboard button handler
bot.action('cmd_leaveteam', async (ctx) => {
  ctx.answerCbQuery();
  try {
    return await promptLeaveTeamConfirmation(ctx);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Confirm Leave Team Yes
bot.action('confirm_leave_team_yes', async (ctx) => {
  ctx.answerCbQuery('Leaving team...');
  try {
    const teamName = await leaveTeam(ctx.from.id);
    const safeName = sanitizeMarkdown(teamName);
    return ctx.editMessageText(`✅ You have left team *${safeName}*.`, { parse_mode: 'Markdown' });
  } catch (err) {
    return ctx.editMessageText(`❌ ${err.message}`);
  }
});

// Confirm Leave Team Cancel
bot.action('confirm_leave_team_no', async (ctx) => {
  ctx.answerCbQuery('Cancelled');
  return ctx.editMessageText('🟢 Action cancelled. You are still safe in your team!', { parse_mode: 'Markdown' });
});



// /teams - Show all teams & status (Works in DMs & Groups)
bot.command('teams', async (ctx) => {
  try {
    const teams = await getAllTeams();
    if (!teams.length) return ctx.reply('ℹ️ No teams registered yet.');

    let activeCount = 0;
    let elimCount = 0;
    let msg = `🏆 *Tournament Teams Overview* 🏆\n\n`;

    teams.forEach((t, i) => {
      const emoji = t.status === 'Active' ? '🟢' : '🔴';
      if (t.status === 'Active') activeCount++; else elimCount++;
      msg += `${i + 1}. *${t.name}* - ${emoji} ${t.status} (${t.members ? t.members.length : 0} players)\n`;
    });

    msg += `\n📊 *Summary:* Active: ${activeCount} | Eliminated: ${elimCount} | Total: ${teams.length}`;
    return ctx.replyWithMarkdown(msg);
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});

// /players - Show player stats
bot.command('players', async (ctx) => {
  try {
    const players = await getAllPlayers();
    if (!players.length) return ctx.reply('ℹ️ No players registered yet.');

    let activeCount = 0;
    let elimCount = 0;
    players.forEach(p => p.status === 'Active' ? activeCount++ : elimCount++);

    let msg = `👥 *Tournament Players Overview* 👥\n\n🟢 *Active Players:* ${activeCount}\n🔴 *Eliminated Players:* ${elimCount}\n📊 *Total Registered:* ${players.length}\n\n`;
    
    players.slice(0, 20).forEach((p, i) => {
      const emoji = p.status === 'Active' ? '🟢' : '🔴';
      msg += `${i + 1}. *${p.in_game_name}* (${emoji} ${p.status})\n`;
    });

    if (players.length > 20) msg += `\n...and ${players.length - 20} more players.`;

    return ctx.replyWithMarkdown(msg);
  } catch (err) {
    return ctx.reply(`❌ Error: ${err.message}`);
  }
});

// Admin Command: /givecoins <IGN_or_TelegramID_or_Reply> <amount>
bot.command('givecoins', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1);
  
  let targetInput = args[0];
  let amount = parseInt(args[1], 10);

  // Support replying directly to a player's message in chat!
  if (ctx.message.reply_to_message) {
    targetInput = String(ctx.message.reply_to_message.from.id);
    amount = parseInt(args[0], 10);
  }

  if (!targetInput || isNaN(amount)) {
    return ctx.reply('⚠️ Usage Options:\n1. `/givecoins GamerName 50`\n2. Reply to a player\'s message with `/givecoins 50`', { parse_mode: 'Markdown' });
  }

  try {
    let targetUserId = targetInput;
    const user = await getUser(targetInput);
    if (!user) {
      const players = await getAllPlayers();
      const match = players.find(p => p.in_game_name === targetInput || p.username === targetInput.replace('@', ''));
      if (match) targetUserId = match.telegram_id;
    }

    const newBalance = await addCoins(targetUserId, amount);
    return ctx.replyWithMarkdown(`💰 Added *${amount} Power Coins (PC)* to player!\n\nNew Balance: \`${newBalance} PC\``);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Command: /awardall <amount> - Award coins to all registered players

bot.command('awardall', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.trim().split(/\s+/).slice(1);
  const amount = parseInt(args[0], 10);

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('⚠️ Usage: `/awardall <amount>`\n\nExample: `/awardall 50`', { parse_mode: 'Markdown' });
  }

  try {
    const totalAwarded = await awardAllCoins(amount);
    return ctx.replyWithMarkdown(`💰 *SUCCESS!* Awarded \`${amount} Power Coins (PC)\` to all **${totalAwarded} registered players**!`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});


// Admin Command: /giveteamcoins <TeamName> <amount> - Award coins to all players in a team
bot.command('giveteamcoins', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length < 2) {
    return ctx.reply('⚠️ Usage: `/giveteamcoins <TeamName> <amount>`\n\nExample: `/giveteamcoins Rangers 100`', { parse_mode: 'Markdown' });
  }

  const teamName = args[0];
  const amount = parseInt(args[1], 10);
  if (isNaN(amount)) return ctx.reply('❌ Invalid coin amount!');

  try {
    const teams = await getAllTeams();
    const team = teams.find(t => t.name.toLowerCase() === teamName.toLowerCase().trim());
    if (!team) return ctx.reply(`❌ Team '${teamName}' not found.`);

    let awardedCount = 0;
    for (const memberId of team.members) {
      try {
        await addCoins(memberId, amount);
        awardedCount++;
      } catch (e) {}
    }

    return ctx.replyWithMarkdown(`💰 Successfully awarded *${amount} Power Coins (PC)* to all **${awardedCount}** players in team *${team.name}*!`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});




/**
 * -------------------------------------------------------------
 * ADMIN COMMANDS & CONTROLS
 * -------------------------------------------------------------
 */

// /admin - Interactive Panel
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('⛔ Access Denied! You are not authorized as an Admin/Organiser.');
  }

  return ctx.replyWithMarkdown(
    `👑 *Tournament Admin Control Panel*\n\nSelect an operation below:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛡️ Manage Teams', 'admin_teams')],
      [Markup.button.callback('⚔️ Manage Matches & Fixtures', 'admin_matches_menu')],
      [Markup.button.callback('📢 Broadcast Announcement', 'admin_broadcast_info')],
      [Markup.button.callback('📊 Refresh Stats', 'admin_stats')]
    ])
  );
});

bot.action('admin_main', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  return ctx.editMessageText(
    `👑 *Tournament Admin Control Panel*\n\nSelect an operation below:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🛡️ Manage Teams', 'admin_teams')],
      [Markup.button.callback('⚔️ Manage Matches & Fixtures', 'admin_matches_menu')],
      [Markup.button.callback('📢 Broadcast Announcement', 'admin_broadcast_info')],
      [Markup.button.callback('📊 Refresh Stats', 'admin_stats')]
    ])
  );
});

// Admin Manage Teams Sub-Menu
bot.action('admin_teams', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  ctx.answerCbQuery();

  try {
    const teams = await getAllTeams();
    if (!teams.length) {
      return ctx.editMessageText('ℹ️ No registered teams found to manage.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Admin Panel', 'admin_main')]])
      });
    }

    let text = `🛡️ <b>TEAMS MANAGEMENT CENTER</b>\nTotal Teams: ${teams.length}\n\nSelect a team below to view roster, eliminate/restore, or transfer captainship:`;
    const buttons = [];

    teams.forEach(t => {
      const statusIcon = t.status === 'Active' ? '🟢' : '🔴';
      buttons.push([
        Markup.button.callback(
          `${statusIcon} ${t.name} (${t.members.length}/4)`,
          `adm_t_view_${t.id}`
        )
      ]);
    });

    buttons.push([Markup.button.callback('⬅️ Back to Admin Panel', 'admin_main')]);

    return ctx.editMessageText(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    });
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Matches Sub-Menu
bot.action('admin_matches_menu', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const matches = await getAllMatches();

  let text = `⚔️ *MATCHES MANAGEMENT CENTER*\nTotal Matches: ${matches.length}\n\nSelect an operation or pick a match to set winner:`;
  const buttons = [];

  matches.forEach(m => {
    const statusIcon = m.status === 'Completed' ? '✅' : '⏳';
    buttons.push([
      Markup.button.callback(
        `${statusIcon} ${m.team1_name} vs ${m.team2_name}`,
        `adm_m_detail_${m.id}`
      )
    ]);
  });

  buttons.push([Markup.button.callback('➕ How to Create Match', 'admin_match_help')]);
  buttons.push([Markup.button.callback('⬅️ Back to Admin Panel', 'admin_main')]);

  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

// Admin Match Detail View for setting winner inline
bot.action(/adm_m_detail_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const matchId = ctx.match[1];
  const matches = await getAllMatches();
  const match = matches.find(m => m.id === matchId);

  if (!match) return ctx.answerCbQuery('Match not found');

  let text = `⚔️ *MATCH DETAILS*\n\n🆔 *Match ID:* \`${match.id}\`\n🛡️ *Team 1:* ${match.team1_name}\n🛡️ *Team 2:* ${match.team2_name}\n📅 *Time:* \`${match.match_time}\`\n📊 *Status:* ${match.status}`;
  if (match.winner_team_name) {
    text += `\n🏆 *Current Winner:* ${match.winner_team_name}`;
  }

  text += `\n\nClick a team below to declare them as the Winner:`;

  const buttons = [
    [
      Markup.button.callback(`🏆 Set ${match.team1_name} as Winner`, `adm_m_win_${match.id}_1`),
      Markup.button.callback(`🏆 Set ${match.team2_name} as Winner`, `adm_m_win_${match.id}_2`)
    ],
    [Markup.button.callback('⬅️ Back to Matches List', 'admin_matches_menu')]
  ];

  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

// Inline Winner Declaration Action
bot.action(/adm_m_win_(.+)_(1|2)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const matchId = ctx.match[1];
  const teamNum = ctx.match[2];

  const matches = await getAllMatches();
  const match = matches.find(m => m.id === matchId);
  if (!match) return ctx.answerCbQuery('Match not found');

  const winnerTeamName = teamNum === '1' ? match.team1_name : match.team2_name;
  const updatedMatch = await setMatchWinner(matchId, winnerTeamName);

  ctx.answerCbQuery(`Set ${winnerTeamName} as Winner!`);
  return ctx.editMessageText(`🏆 <b>MATCH WINNER RECORDED!</b>\n\n⚔️ Match: ${match.team1_name} VS ${match.team2_name}\n🎉 <b>WINNER:</b> <b>${updatedMatch.winner_team_name}</b>`, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Matches List', 'admin_matches_menu')]])
  });
});

// Match Creation Help Action
bot.action('admin_match_help', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  ctx.answerCbQuery();
  return ctx.editMessageText(
    `⚔️ *HOW TO CREATE & EDIT MATCHES*\n\n1️⃣ *Create Match:* Type in chat:\n\`/addmatch TeamAlpha vs TeamBravo @ 8 PM\`\n\n2️⃣ *Edit Match:* Type in chat:\n\`/editmatch <MatchID> NewTeamA vs NewTeamB @ 9 PM\``,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Matches Menu', 'admin_matches_menu')]])
    }
  );
});


// Admin Refresh Stats action
bot.action('admin_stats', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  ctx.answerCbQuery('Refreshing Stats...');
  try {
    const teams = await getAllTeams();
    const players = await getAllPlayers();

    let activeTeams = 0;
    let elimTeams = 0;
    teams.forEach(t => t.status === 'Active' ? activeTeams++ : elimTeams++);

    let activePlayers = 0;
    let elimPlayers = 0;
    players.forEach(p => p.status === 'Active' ? activePlayers++ : elimPlayers++);

    const text = `📊 *TOURNAMENT LIVE STATS* 📊\n\n🛡️ *Teams Overview:* Total: ${teams.length} | 🟢 Active: ${activeTeams} | 🔴 Eliminated: ${elimTeams}\n👥 *Players Overview:* Total: ${players.length} | 🟢 Active: ${activePlayers} | 🔴 Eliminated: ${elimPlayers}`;

    return ctx.editMessageText(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Admin Panel', 'admin_main')]])
    });
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Broadcast info button action
bot.action('admin_broadcast_info', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  ctx.answerCbQuery();
  return ctx.editMessageText(
    `📢 *ANNOUNCEMENT BROADCAST CENTER*\n\nYou can send an official announcement to all registered players.\n\nOption 1: Type \`/broadcast <Your Message>\` directly in chat.\nOption 2: Reply to any message/announcement with \`/broadcast\`.`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Admin Panel', 'admin_main')]])
    }
  );
});

// Admin Command: /broadcast <message> (or reply to a message)
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  
  let broadcastMsg = ctx.message.text.split(' ').slice(1).join(' ');

  // Support replying to any existing text/announcement message
  if (!broadcastMsg && ctx.message.reply_to_message && ctx.message.reply_to_message.text) {
    broadcastMsg = ctx.message.reply_to_message.text;
  }

  if (!broadcastMsg) {
    return ctx.reply('⚠️ Usage: `/broadcast <Your Announcement Message>` (or reply to a message with `/broadcast`)', { parse_mode: 'Markdown' });
  }

  const players = await getAllPlayers();
  
  // Fetch connected tournament group chats
  let groups = [];
  try {
    const groupSnapshot = await db.collection('groups').get();
    groupSnapshot.forEach(doc => groups.push(doc.data()));
  } catch (e) {}

  if (!players.length && !groups.length) {
    return ctx.reply('ℹ️ No registered players or group chats found to broadcast to.');
  }

  const statusMsg = await ctx.reply(`📢 Sending announcement to ${players.length} players and ${groups.length} group chats... Please wait.`);

  let successCount = 0;
  let failCount = 0;
  const safeMsg = sanitizeMarkdown(broadcastMsg);

  // Broadcast to all individual players
  for (const player of players) {
    try {
      await bot.telegram.sendMessage(
        player.telegram_id,
        `📢 *OFFICIAL TOURNAMENT ANNOUNCEMENT*\n\n${safeMsg}`,
        { parse_mode: 'Markdown' }
      );
      successCount++;
    } catch (err) {
      try {
        await bot.telegram.sendMessage(
          player.telegram_id,
          `📢 OFFICIAL TOURNAMENT ANNOUNCEMENT\n\n${broadcastMsg}`
        );
        successCount++;
      } catch (e) {
        failCount++;
      }
    }
  }

  // Broadcast to all connected group chats
  for (const grp of groups) {
    try {
      await bot.telegram.sendMessage(
        grp.chat_id,
        `📢 *OFFICIAL TOURNAMENT ANNOUNCEMENT*\n\n${safeMsg}`,
        { parse_mode: 'Markdown' }
      );
      successCount++;
    } catch (err) {
      try {
        await bot.telegram.sendMessage(
          grp.chat_id,
          `📢 OFFICIAL TOURNAMENT ANNOUNCEMENT\n\n${broadcastMsg}`
        );
        successCount++;
      } catch (e) {
        failCount++;
      }
    }
  }

  return ctx.replyWithMarkdown(
    `✅ *Broadcast Complete!*\n\n🟢 Successfully Sent: *${successCount}*\n🔴 Failed: *${failCount}*`
  );
});




// Admin Team Detailed View
bot.action(/adm_t_view_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const teamId = ctx.match[1];
  const team = await getTeamDetails(teamId);
  if (!team) return ctx.answerCbQuery('Team not found');

  const statusEmoji = team.status === 'Active' ? '🟢' : '🔴';
  let text = `🛡️ *TEAM MANAGEMENT: ${team.name}*\nStatus: ${statusEmoji} *${team.status}*\nJoin Code: \`${team.join_code}\`\n\n👥 *Roster & Players:*`;

  const buttons = [];

  team.memberProfiles.forEach((p) => {
    const isCaptain = p.telegram_id === team.captain_id ? '👑 Captain' : '👤 Member';
    const pEmoji = p.status === 'Active' ? '🟢' : '🔴';
    const handle = formatPlayerHandle(p);
    text += `\n• *${p.in_game_name}* (${handle}) - ${isCaptain} (${pEmoji} ${p.status})`;

    buttons.push([
      Markup.button.callback(
        `${pEmoji} ${p.in_game_name}: ${p.status === 'Active' ? 'Eliminate' : 'Restore'}`,
        `adm_p_toggle_${p.telegram_id}_${team.id}`
      ),
      Markup.button.callback(
        `👑 Make Capt`,
        `adm_p_capt_${p.telegram_id}_${team.id}`
      )
    ]);
  });


  // Team-wide actions
  const toggleTeamText = team.status === 'Active' ? '🔴 Eliminate Entire Team' : '🟢 Restore Entire Team';
  buttons.push([Markup.button.callback(toggleTeamText, `adm_t_toggle_${team.id}`)]);
  buttons.push([Markup.button.callback('🗑️ Delete Team Completely', `adm_t_del_${team.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Back to Teams List', 'admin_teams')]);

  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

// Admin Toggle Team Status (Eliminate/Restore whole team)
bot.action(/adm_t_toggle_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const teamId = ctx.match[1];
  const team = await getTeamDetails(teamId);
  if (!team) return ctx.answerCbQuery('Team not found');

  const newStatus = team.status === 'Active' ? 'Eliminated' : 'Active';
  await setTeamStatus(teamId, newStatus);
  ctx.answerCbQuery(`Team ${team.name} is now ${newStatus}`);

  // Re-render team detail
  return ctx.editMessageText(`✅ Team *${team.name}* status changed to *${newStatus}*!`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Team View', `adm_t_view_${teamId}`)]])
  });
});

// Admin Toggle Single Player Status (Eliminate/Restore individual player)
bot.action(/adm_p_toggle_(.+)_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const playerId = ctx.match[1];
  const teamId = ctx.match[2];

  const player = await getUser(playerId);
  if (!player) return ctx.answerCbQuery('Player not found');

  const newStatus = player.status === 'Active' ? 'Eliminated' : 'Active';
  await setPlayerStatus(playerId, newStatus);
  ctx.answerCbQuery(`${player.in_game_name} is now ${newStatus}`);

  // Return to team detailed view
  const team = await getTeamDetails(teamId);
  let text = `🛡️ *TEAM MANAGEMENT: ${team.name}*\nStatus: ${team.status}\n\n👥 *Roster & Players:*`;
  const buttons = [];
  team.memberProfiles.forEach((p) => {
    const isCaptain = p.telegram_id === team.captain_id ? '👑 Captain' : '👤 Member';
    const pEmoji = p.status === 'Active' ? '🟢' : '🔴';
    text += `\n• *${p.in_game_name}* (${isCaptain}) - ${pEmoji} ${p.status}`;
    buttons.push([
      Markup.button.callback(
        `${pEmoji} ${p.in_game_name}: ${p.status === 'Active' ? 'Eliminate' : 'Restore'}`,
        `adm_p_toggle_${p.telegram_id}_${team.id}`
      ),
      Markup.button.callback(
        `👑 Make Capt`,
        `adm_p_capt_${p.telegram_id}_${team.id}`
      )
    ]);
  });
  const toggleTeamText = team.status === 'Active' ? '🔴 Eliminate Entire Team' : '🟢 Restore Entire Team';
  buttons.push([Markup.button.callback(toggleTeamText, `adm_t_toggle_${team.id}`)]);
  buttons.push([Markup.button.callback('⬅️ Back to Teams List', 'admin_teams')]);

  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

// Admin Change Captain
bot.action(/adm_p_capt_(.+)_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const playerId = ctx.match[1];
  const teamId = ctx.match[2];

  const team = await getTeamDetails(teamId);
  if (!team) return ctx.answerCbQuery('Team not found');

  await transferCaptainship(team.captain_id, playerId);
  ctx.answerCbQuery('Captain transferred!');

  const updatedTeam = await getTeamDetails(teamId);
  let text = `👑 Captain set to *${(updatedTeam.memberProfiles.find(p => p.telegram_id === playerId)).in_game_name}*!\n\n🛡️ *TEAM: ${updatedTeam.name}*`;
  return ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Team View', `adm_t_view_${teamId}`)]])
  });
});


// Admin Delete Team Completely
bot.action(/adm_t_del_(.+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('Access Denied');
  const teamId = ctx.match[1];
  try {
    const team = await deleteTeam(teamId);
    ctx.answerCbQuery(`Team ${team.name} deleted`);
    return ctx.editMessageText(`🗑️ <b>Team ${team.name}</b> has been completely deleted from the tournament!`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Teams List', 'admin_teams')]])
    });
  } catch (err) {
    return ctx.answerCbQuery(`❌ ${err.message}`, { show_alert: true });
  }
});

// Admin Command: /eliminate or /eilimnate or /elim <TeamNameOrIGN>
const handleEliminate = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  if (!args) return ctx.replyWithHTML('⚠️ Usage: <code>/eliminate &lt;TeamNameOrPlayerIGN&gt;</code>');

  try {
    const team = await setTeamStatus(args, 'Eliminated');
    return ctx.replyWithHTML(`🔴 <b>Team ${team.name}</b> and all its members have been marked as <b>Eliminated</b>!`);
  } catch (err) {
    try {
      const player = await setPlayerStatus(args, 'Eliminated');
      return ctx.replyWithHTML(`🔴 <b>Player ${player.in_game_name}</b> has been marked as <b>Eliminated</b>!`);
    } catch (e) {
      return ctx.reply(`❌ ${err.message}`);
    }
  }
};

bot.command('eliminate', handleEliminate);
bot.command('eilimnate', handleEliminate);
bot.command('elim', handleEliminate);

// Admin Command: /recruit or /restore <TeamNameOrIGN> - Recruit/Restore eliminated player or team back into tournament
const handleRecruit = async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  if (!args) return ctx.replyWithHTML('⚠️ Usage: <code>/recruit &lt;TeamNameOrPlayerIGN&gt;</code>');

  try {
    const res = await recruitPlayerOrTeam(args);
    if (res.type === 'team') {
      return ctx.replyWithHTML(`🟢 <b>Team ${res.entity.name}</b> and all its members have been <b>Recruited Back & Restored to Active!</b>`);
    } else {
      return ctx.replyWithHTML(`🟢 <b>Player ${res.entity.in_game_name}</b> has been <b>Recruited Back & Restored to Active!</b>`);
    }
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
};

bot.command('recruit', handleRecruit);
bot.command('restore', handleRecruit);

// Admin Command: /removeteam <TeamName> - Delete team completely
bot.command('removeteam', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  if (!args) return ctx.replyWithHTML('⚠️ Usage: <code>/removeteam &lt;TeamName&gt;</code>');

  try {
    const team = await deleteTeam(args);
    return ctx.replyWithHTML(`🗑️ <b>Team ${team.name}</b> has been completely removed from the tournament!`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Admin Command: /kickplayer <IGN>
bot.command('kickplayer', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Access Denied!');
  const args = ctx.message.text.split(' ').slice(1).join(' ');
  if (!args) return ctx.reply('⚠️ Usage: `/kickplayer <InGameName>`', { parse_mode: 'Markdown' });

  try {
    const { user, teamName } = await kickPlayerFromTeam(args);
    return ctx.replyWithMarkdown(`🚨 Player *${user.in_game_name}* was removed from team *${teamName}*.`);
  } catch (err) {
    return ctx.reply(`❌ ${err.message}`);
  }
});

// Start bot
bot.launch().then(() => {
  console.log('🤖 Telegram Tournament Bot is online and running!');
}).catch(err => {
  console.error('Failed to launch bot:', err);
});


// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
