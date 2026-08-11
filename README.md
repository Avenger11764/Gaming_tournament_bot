# Telegram Tournament Management Bot

A feature-packed Telegram Bot built with **Node.js**, **Telegraf**, and **Supabase** to organize esports / gaming tournaments, team registrations, status updates (Active/Eliminated), group chat integrations, and admin controls.

---

## 🚀 Quick Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- A [Supabase](https://supabase.com) database project.

### 2. Environment Variables
Rename or copy `.env.example` to `.env`:
```ini
BOT_TOKEN=YOUR_BOT_TOKEN_FROM_BOTFATHER
ADMIN_IDS=123456789,987654321
SUPABASE_URL=https://your-supabase-project.supabase.co
SUPABASE_KEY=your-supabase-anon-key
```
*(Replace `123456789` with your actual Telegram User ID. You can find your ID via [@userinfobot](https://t.me/userinfobot)).*

### 4. Running the Bot
```bash
# Install dependencies
npm install

# Start the bot
node index.js
```

---

## 🎮 Player Commands (Private Chat & Group Chat)

- `/start` - Welcome message & feature overview
- `/register <InGameName>` - Register into tournament system
- `/createteam <TeamName>` - Create team & get a 6-character Join Code
- `/jointeam <JoinCode>` - Join an existing team using the code
- `/myteam` - View team roster, captain, and active/eliminated status
- `/leaveteam` - Leave current team
- `/teams` - List all tournament teams with real-time status (Works in groups!)
- `/players` - View active vs. eliminated player count

---

## 👑 Organiser / Admin Commands

*Only users whose Telegram IDs are listed in `ADMIN_IDS` (.env) can access these.*

- `/admin` - Opens interactive inline button dashboard for status toggling
- `/eliminate <TeamNameOrIGN>` - Mark a team or individual player as **Eliminated**
- `/restore <TeamNameOrIGN>` - Restore team or player status to **Active**
- `/kickplayer <InGameName>` - Force-remove a player from their team
- `/broadcast <Your Announcement>` - Send direct announcement to all registered players

---

## 📁 Project Structure

```
d:\MSGC Bot\
├── .env.example              # Environment variables template
├── db.js                     # Supabase CRUD operations & helper methods
├── index.js                  # Telegraf bot handlers & Admin panel logic
└── package.json
```
