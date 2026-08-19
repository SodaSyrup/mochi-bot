# 🍡 Mochi — Invite Tracker & Real-Time Dashboard

<p align="center">
  <b>A fast, lightweight Discord invite tracking bot with a real-time web dashboard, powered by Bun and SQLite.</b>
</p>

---

## 🌟 Features

- 📊 **Accurate Invite Tracking**:
  - Pinpoints exact invite codes and inviters on member join.
  - Computes Net Invites: `Regular + Bonus - Leaves - Fake`.
  - Automatically flags young accounts (< 7 days) as suspicious/fake.
  - Automatically updates inviter statistics when an invitee leaves.
  - Full vanity URL join detection.
- 🎁 **Bonus Invites**:
  - `/bonus-invites add|remove|reset` admin commands.
  - Web dashboard bonus allocator.
- 🛡️ **Discord Safety & AutoMod Integration (Discord Server as Source of Truth)**:
  - Live synchronization with Discord's native AutoMod engine (`guild.autoModerationRules`).
  - Create, edit, toggle, and delete AutoMod rules directly from the dashboard:
    - **Keyword & URL Filter**: Block scam domains, phishing links, and wildcards with custom feedback messages.
    - **Default Presets**: Profanity, Sexual Content, Slurs & Hate Speech detection.
    - **Mention Spam Protection**: Intercept raid attempts exceeding configurable mention thresholds.
    - **Suspected Spam Detection**: Leverage Discord ML spam classifier.
    - **Member Profile Filter**: Block prohibited keywords in user display names.
  - Server Security Safeguards:
    - Verification Level (None, Low, Medium, High, Highest).
    - Explicit Media Content Filter (Disabled, Members without roles, All members).
    - Default Message Notifications.
    - Safety Alerts Channel configuration.
  - Real-Time Live Incident Feed with WebSocket streaming and test bench simulator.
- 🌐 **Real-Time Web Dashboard**:
  - Glassmorphic dark aesthetic built with Vanilla CSS & Chart.js.
  - Real-time WebSocket live feed (joins, leaves, and AutoMod interceptions animate instantly).
  - Joins vs Departures 7-day analytics chart.
  - Active invite codes inspector with custom labels.
  - Built-in test simulator.
- ⚡ **Bun + SQLite Architecture**:
  - Powered by native `bun:sqlite` with WAL mode.
  - Starts in milliseconds with only ~12 MB memory footprint.

## 🚀 Quick Start Guide

### 1. Clone & Configure Environment
```bash
cp .env.example .env
```
Fill in your `DISCORD_TOKEN`, `CLIENT_ID`, and other configuration options in `.env`.

### 2. Start Development Server
```bash
bun install
bun dev
```
Open **`http://localhost:3000`** in your browser.

### 3. Deploy Slash Commands
```bash
bun run deploy-commands
```

---

## 📋 Slash Commands

- `/invites [user]` — Check invite stats (Net, Regular, Bonus, Leaves, Fake)
- `/leaderboard [page]` — Top server inviters
- `/invite-codes [user]` — List active server invite links & uses
- `/bonus-invites <add|remove|reset>` — Manage bonus invites *(Admin)*
- `/botinfo` — System telemetry and uptime
- `/ping` — WebSocket latency
- `/help` — Help guide and dashboard link

---

## 🧪 Tests

```bash
bun test
# or
bun run tests/runAll.js
```
