const fs = require('fs');

let c = fs.readFileSync('index.js', 'utf8');

// 1. Clean dashboard functions
const start = c.indexOf('// Helper function to render main dashboard menu');
const end = c.indexOf('// Helper function to render Guest Dashboard menu');

if (start !== -1 && end !== -1) {
  const cleanDash = `// Helper function to render registered user Main Dashboard menu
function getMainMenu() {
  const welcomeText = \`
🏆 *WELCOME TO MSGC TOURNAMENT CONTROL CENTER* 🏆

Choose an option below to manage your team, check fixtures, scores, or view tournament standings:

1️⃣ *Profile & Team:* View your player profile or manage your squad roster (\`/myteam\`).
2️⃣ *Leaderboard & Matches:* Track live team/solo points (\`/leaderboard\`) and upcoming match fixtures (\`/matches\`).
3️⃣ *Tournament Status:* Check live remaining active vs. eliminated teams & players with \`/teams\` and \`/players\`.

👇 *QUICK DASHBOARD MENU:*
  \`;

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
  const groupText = \`
🏆 *MSGC TOURNAMENT ARENA & INFORMATION CENTER* 🏆

Welcome to the official MSGC Tournament Group! Use the buttons below to check live tournament standings, match fixtures, rules, and teams:

👇 *QUICK GROUP DASHBOARD:*
  \`;

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

`;
  c = c.substring(0, start) + cleanDash + c.substring(end);
}

// 2. Remove store section
const storeStart = c.indexOf('/**\n * -------------------------------------------------------------\n * POWER STORE LOGIC');
const storeEnd = c.indexOf('// Admin Command: /givecoins');

if (storeStart !== -1 && storeEnd !== -1) {
  c = c.substring(0, storeStart) + c.substring(storeEnd);
}

fs.writeFileSync('index.js', c);
console.log('Successfully cleaned index.js!');
