import { Hono } from 'hono';
import {
  getScheduledPosts,
  markSchedulePublishing,
  markSchedulePublished,
  markScheduleFailed,
  markContentPublished,
} from './notion';
import { matchQuoteToContent, generateQuoteImage } from './quotes';
import { postToX } from './publishers/x';
import { postToLinkedIn } from './publishers/linkedin';

type Bindings = {
  KV: KVNamespace;
  R2: R2Bucket;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  NOTION_SCHEDULE_DB_ID: string;
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
    description: 'חלומות במגירה - Dreams from the drawer',
    version: '2.0.0',
    architecture: 'Notion-driven scheduling',
  });
});

// Manual trigger endpoint (for testing)
app.post('/publish', async (c) => {
  const result = await processScheduledPosts(c.env);
  return c.json(result);
});

// Get status
app.get('/status', async (c) => {
  return c.json({
    contentDbId: c.env.NOTION_DATABASE_ID,
    scheduleDbId: c.env.NOTION_SCHEDULE_DB_ID,
    timezone: c.env.TIMEZONE,
    hasXToken: !!c.env.X_ACCESS_TOKEN && c.env.X_ACCESS_TOKEN !== 'placeholder',
    hasLinkedInToken: !!c.env.LINKEDIN_ACCESS_TOKEN && c.env.LINKEDIN_ACCESS_TOKEN !== 'placeholder',
    hasAnthropicKey: !!c.env.ANTHROPIC_API_KEY && c.env.ANTHROPIC_API_KEY !== 'placeholder',
  });
});

async function processScheduledPosts(env: Bindings): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    // Get posts scheduled for now or earlier from Notion
    const scheduledPosts = await getScheduledPosts(
      env.NOTION_TOKEN,
      env.NOTION_SCHEDULE_DB_ID,
      env.NOTION_DATABASE_ID
    );

    console.log(`Found ${scheduledPosts.length} scheduled posts due for publishing`);

    for (const scheduled of scheduledPosts) {
      if (!scheduled.content) {
        errors.push(`Schedule ${scheduled.id}: No linked content found`);
        await markScheduleFailed(env.NOTION_TOKEN, scheduled.id, 'No linked content found');
        continue;
      }

      // Mark as publishing
      await markSchedulePublishing(env.NOTION_TOKEN, scheduled.id);

      try {
        let imageUrl: string | undefined;

        // Handle quote if requested
        if (scheduled.includeQuote) {
          const quotesData = await env.R2.get('quotes.json');
          if (quotesData) {
            const quotes = JSON.parse(await quotesData.text());
            const matchedQuote = await matchQuoteToContent(
              scheduled.content.content,
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
              }

              // For now, we'd need a public R2 URL or use inline image upload
              // imageUrl = ...
            }
          }
        }

        const postUrls: { xUrl?: string; linkedInUrl?: string } = {};

        // Post to X if platform includes X
        if (scheduled.platform === 'X' || scheduled.platform === 'Both') {
          try {
            const xResult = await postToX(
              scheduled.content.content,
              imageUrl,
              {
                accessToken: env.X_ACCESS_TOKEN,
                refreshToken: env.X_REFRESH_TOKEN,
                clientId: env.X_CLIENT_ID,
                clientSecret: env.X_CLIENT_SECRET,
              }
            );
            postUrls.xUrl = xResult.url;
            console.log(`Posted to X: ${xResult.url}`);
          } catch (xError) {
            console.error('X posting failed:', xError);
            errors.push(`X posting failed for ${scheduled.id}: ${xError}`);
          }
        }

        // Post to LinkedIn if platform includes LinkedIn
        if (scheduled.platform === 'LinkedIn' || scheduled.platform === 'Both') {
          try {
            const linkedInResult = await postToLinkedIn(
              scheduled.content.content,
              imageUrl,
              env.LINKEDIN_ACCESS_TOKEN
            );
            postUrls.linkedInUrl = linkedInResult.url;
            console.log(`Posted to LinkedIn: ${linkedInResult.url}`);
          } catch (liError) {
            console.error('LinkedIn posting failed:', liError);
            errors.push(`LinkedIn posting failed for ${scheduled.id}: ${liError}`);
          }
        }

        // If at least one platform succeeded, mark as published
        if (postUrls.xUrl || postUrls.linkedInUrl) {
          await markSchedulePublished(env.NOTION_TOKEN, scheduled.id, postUrls);
          await markContentPublished(env.NOTION_TOKEN, scheduled.contentId);
          processed++;
        } else {
          await markScheduleFailed(env.NOTION_TOKEN, scheduled.id, 'All platforms failed');
        }

      } catch (error) {
        const errorMsg = `Failed to publish: ${error}`;
        errors.push(`Schedule ${scheduled.id}: ${errorMsg}`);
        await markScheduleFailed(env.NOTION_TOKEN, scheduled.id, errorMsg);
      }
    }

  } catch (error) {
    errors.push(`Main process error: ${error}`);
  }

  return { processed, errors };
}

// Cron handler - runs every 15 minutes
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    console.log('Cron triggered at:', new Date().toISOString());
    ctx.waitUntil(processScheduledPosts(env));
  },
};
