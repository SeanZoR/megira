import { Hono } from 'hono';
import { getReadyPosts, markAsPublished } from './notion';
import { getNextOptimalSlot, isWithinPostingWindow } from './scheduler';
import { matchQuoteToContent, generateQuoteImage } from './quotes';
import { postToX } from './publishers/x';
import { postToLinkedIn } from './publishers/linkedin';

type Bindings = {
  KV: KVNamespace;
  R2: R2Bucket;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  ANTHROPIC_API_KEY: string;
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_REFRESH_TOKEN: string;
  LINKEDIN_ACCESS_TOKEN: string;
  TIMEZONE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    name: 'megira',
    description: 'חלומות במגירה - Dreams from the drawer'
  });
});

// Manual trigger endpoint (for testing)
app.post('/publish', async (c) => {
  const result = await processReadyPosts(c.env);
  return c.json(result);
});

// Get queue status
app.get('/queue', async (c) => {
  const queue = await c.env.KV.list({ prefix: 'queue:' });
  const published = await c.env.KV.list({ prefix: 'published:' });

  return c.json({
    queued: queue.keys.length,
    published: published.keys.length,
    queuedItems: queue.keys.map(k => k.name),
  });
});

async function processReadyPosts(env: Bindings): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    // Get posts with "Ready" status from Notion
    const readyPosts = await getReadyPosts(env.NOTION_TOKEN, env.NOTION_DATABASE_ID);

    for (const post of readyPosts) {
      // Check if already published
      const alreadyPublished = await env.KV.get(`published:${post.id}`);
      if (alreadyPublished) {
        continue;
      }

      // Check if within optimal posting window
      if (!isWithinPostingWindow(env.TIMEZONE)) {
        // Queue for later
        const nextSlot = getNextOptimalSlot(env.TIMEZONE);
        await env.KV.put(`queue:${nextSlot}:${post.id}`, JSON.stringify(post), {
          expirationTtl: 86400 // 24 hours
        });
        continue;
      }

      try {
        let imageUrl: string | undefined;

        // Handle quote if requested
        if (post.includeQuote) {
          const quotesData = await env.R2.get('quotes.json');
          if (quotesData) {
            const quotes = JSON.parse(await quotesData.text());
            const matchedQuote = await matchQuoteToContent(
              post.content,
              quotes.quotes,
              env.ANTHROPIC_API_KEY
            );

            if (matchedQuote) {
              // Check for cached image or generate new one
              const imageKey = `images/${matchedQuote.id}.png`;
              let imageData = await env.R2.get(imageKey);

              if (!imageData) {
                const generatedImage = await generateQuoteImage(matchedQuote);
                await env.R2.put(imageKey, generatedImage);
                imageData = await env.R2.get(imageKey);
              }

              if (imageData) {
                imageUrl = `https://megira-quotes.${env.R2.toString()}.r2.cloudflarestorage.com/${imageKey}`;
              }
            }
          }
        }

        // Post to X
        const xResult = await postToX(
          post.content,
          imageUrl,
          {
            accessToken: env.X_ACCESS_TOKEN,
            refreshToken: env.X_REFRESH_TOKEN,
            clientId: env.X_CLIENT_ID,
            clientSecret: env.X_CLIENT_SECRET,
          }
        );

        // Post to LinkedIn
        const linkedInResult = await postToLinkedIn(
          post.content,
          imageUrl,
          env.LINKEDIN_ACCESS_TOKEN
        );

        // Mark as published in Notion
        await markAsPublished(
          env.NOTION_TOKEN,
          post.id,
          {
            xUrl: xResult.url,
            linkedInUrl: linkedInResult.url,
          }
        );

        // Track in KV
        await env.KV.put(`published:${post.id}`, JSON.stringify({
          publishedAt: new Date().toISOString(),
          xUrl: xResult.url,
          linkedInUrl: linkedInResult.url,
        }));

        processed++;
      } catch (error) {
        errors.push(`Failed to publish post ${post.id}: ${error}`);
      }
    }

    // Process queued posts that are due
    const now = Date.now();
    const queuedPosts = await env.KV.list({ prefix: 'queue:' });

    for (const key of queuedPosts.keys) {
      const [, timestamp] = key.name.split(':');
      if (parseInt(timestamp) <= now) {
        const postData = await env.KV.get(key.name);
        if (postData) {
          // Re-queue for processing
          await env.KV.delete(key.name);
        }
      }
    }

  } catch (error) {
    errors.push(`Main process error: ${error}`);
  }

  return { processed, errors };
}

// Cron handler
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processReadyPosts(env));
  },
};
