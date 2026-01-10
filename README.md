# megira מגירה

> חלומות במגירה - Taking your dreams out of the drawer

**megira** publishes your Notion content to LinkedIn and X (Twitter) automatically.

## How It Works

```
Notion (Ready) → Scheduler → Publisher → X & LinkedIn
```

**Status Flow:** `Idea` → `Ready` → `Scheduled` → `Published`

1. Write content in Notion with status `Idea`
2. When ready, change status to `Ready`
3. Scheduler picks it up and queues it for optimal posting times
4. Publisher posts to X and/or LinkedIn
5. Status becomes `Published` with links to the posts

## Features

- **Notion-driven** - Your content database is the source of truth
- **Adaptive scheduling** - Maintains a 7-day buffer, slows down when low on content
- **Optimal times** - Posts at 08:03, 12:35, 15:43, 17:30 (Israel time) with slight randomness
- **Multi-platform** - X (Twitter) and LinkedIn support
- **Thread support** - X threads via Reply Content field
- **Immediate mode** - Check "Immediate schedule?" to bypass the queue

## Setup

### Automated Setup with Claude Code

Run Claude Code with browser automation enabled:

```bash
claude --chrome
```

Then paste this prompt:

```
Help me set up megira for publishing my Notion content to X and LinkedIn.

I need you to:
1. Create two Notion databases (Content and Schedule) with the required fields
2. Set up a Cloudflare Worker with KV storage
3. Run the OAuth flows for X and LinkedIn APIs
4. Configure all the wrangler secrets
5. Deploy the worker

My preferences:
- Timezone: [YOUR_TIMEZONE, e.g., "America/New_York"]
- Posting times: [OPTIONAL - default is 08:03, 12:35, 15:43, 17:30]

Please guide me through each step, creating the Notion databases via browser
and helping me obtain the necessary API credentials.
```

---

### Manual Setup

### 1. Notion Databases

**Content Database:**
- Title (title)
- Content (rich_text) - main post body
- Status (status) - Idea, Ready, Scheduled, Published
- Platforms (multi_select) - X, LinkedIn
- Reply Content (rich_text) - optional, for X threads
- Immediate schedule? (checkbox)

**Schedule Database:**
- Name (title)
- Content (relation) - links to Content DB
- Scheduled For (date)
- Platform (multi_select)
- Status (select) - Scheduled, Publishing, Published, Failed
- X Post URL (url)
- LinkedIn Post URL (url)

### 2. API Setup

```bash
# X OAuth
npm run oauth:x

# LinkedIn OAuth
npm run oauth:linkedin
```

### 3. Secrets

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put NOTION_DATABASE_ID
wrangler secret put NOTION_SCHEDULE_DB_ID
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put X_ACCESS_TOKEN
wrangler secret put X_REFRESH_TOKEN
wrangler secret put LINKEDIN_ACCESS_TOKEN
```

### 4. Deploy

```bash
npm run deploy
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Health check |
| `GET /status` | Config status |
| `POST /schedule` | Trigger scheduling |
| `POST /publish` | Trigger publishing |
| `POST /reschedule` | Clear and reschedule all pending |

## License

MIT
