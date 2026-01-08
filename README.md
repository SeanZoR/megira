# megira מגירה

> חלומות במגירה - Taking your dreams out of the drawer

**megira** is an open-source tool that automatically publishes your Notion content to LinkedIn and X (Twitter), with optional AI-matched quotes from your personal library.

## Features

- 📝 **Notion Integration** - Monitor a Notion database for posts ready to publish
- 🐦 **X/Twitter Publishing** - Post to X via API with media support
- 💼 **LinkedIn Pages** - Post to your LinkedIn company page
- 📚 **Quote Matching** - AI-powered quote matching from your Kindle highlights
- 🖼️ **Quote Images** - Auto-generated quote images to attach to posts
- ⏰ **Smart Scheduling** - Posts at optimal times for your timezone
- ☁️ **Cloudflare Workers** - Serverless, runs on cron every 15 minutes

## Architecture

```
┌─────────────┐     ┌────────────────────┐     ┌─────────────────┐
│   Notion    │────▶│ Cloudflare Worker  │────▶│   X API         │
│  Database   │     │  (Cron: every 15m) │     │   LinkedIn API  │
└─────────────┘     └────────────────────┘     └─────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────────┐ ┌──────────┐ ┌────────────────┐
     │ Cloudflare KV  │ │   R2     │ │  Claude API    │
     │ (queue + IDs)  │ │ (quotes) │ │ (quote match)  │
     └────────────────┘ └──────────┘ └────────────────┘
```

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/SeanZoR/megira.git
cd megira
npm install
```

### 2. Notion Database

Create a Notion database with these properties:
- **Title** (title) - Post title/hook
- **Content** (rich text) - Main content body
- **Status** (select) - Options: `Idea`, `Draft`, `Compose`, `Ready`, `Published`
- **Include Quote** (checkbox) - Attach a quote image
- **Quote Override** (text) - Specific quote to use
- **Published At** (date) - Auto-filled when published
- **Post URLs** (text) - Links to published posts

Create a [Notion integration](https://www.notion.so/my-integrations) and share the database with it.

### 3. Social API Setup

#### X (Twitter)
1. Create an app at [developer.twitter.com](https://developer.twitter.com)
2. Enable OAuth 2.0 with PKCE
3. Run the OAuth flow: `npm run oauth:x`

#### LinkedIn
1. Create an app at [linkedin.com/developers](https://www.linkedin.com/developers)
2. Request `w_member_social` and `w_organization_social` permissions
3. Run the OAuth flow: `npm run oauth:linkedin`

### 4. Prepare Quotes (Optional)

If you have Kindle highlights exported as markdown:

```bash
npm run prepare-quotes
```

This parses your highlights and uploads them to R2.

### 5. Configure Secrets

```bash
wrangler secret put NOTION_TOKEN
wrangler secret put NOTION_DATABASE_ID
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put X_ACCESS_TOKEN
wrangler secret put X_REFRESH_TOKEN
wrangler secret put LINKEDIN_ACCESS_TOKEN
```

### 6. Deploy

```bash
npm run deploy
```

## Usage

1. Add ideas to your Notion database with status `Idea`
2. When ready to publish, change status to `Ready`
3. The worker picks it up on the next cron run (every 15 min)
4. Posts are published at optimal times for Tel Aviv timezone
5. Status changes to `Published` with links to the posts

## Development

```bash
# Run locally
npm run dev

# Deploy
npm run deploy

# View logs
wrangler tail
```

## Optimal Posting Times (Tel Aviv)

| Platform | Best Times (Local) |
|----------|-------------------|
| LinkedIn | 7-8 AM, 12 PM, 5-6 PM |
| X/Twitter | 9 AM, 12 PM, 5 PM |

## License

MIT © Sean Katz

---

*megira (מגירה) means "drawer" in Hebrew. This tool helps you take your dreams out of the drawer and share them with the world.*
