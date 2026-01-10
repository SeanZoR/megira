import { Hono } from 'hono';
import {
  getScheduledPosts,
  markSchedulePublishing,
  markSchedulePublished,
  markScheduleFailed,
  markContentPublished,
  getPendingScheduleEntries,
  deleteScheduleEntry,
  markContentReady,
} from './notion';
import { matchQuoteToContent, generateQuoteImage } from './quotes';
import { postToX } from './publishers/x';
import { postToLinkedIn } from './publishers/linkedin';
import { processDraftedContent } from './processors';
import { autoScheduleReadyContent } from './auto-scheduler';

type Bindings = {
  KV: KVNamespace;
  R2: R2Bucket;
  NOTION_TOKEN: string;
  NOTION_DATABASE_ID: string;
  NOTION_SCHEDULE_DB_ID: string;
  ANTHROPIC_API_KEY: string;
  // X OAuth 2.0 (for tweets)
  X_CLIENT_ID: string;
  X_CLIENT_SECRET: string;
  X_ACCESS_TOKEN: string;
  X_REFRESH_TOKEN: string;
  // X OAuth 1.0a (for media upload)
  X_API_KEY: string;
  X_API_KEY_SECRET: string;
  X_ACCESS_TOKEN_OAUTH1: string;
  X_ACCESS_TOKEN_SECRET: string;
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

// Manual trigger endpoint for publishing (for testing)
app.post('/publish', async (c) => {
  const result = await processScheduledPosts(c.env);
  return c.json(result);
});

// Manual trigger endpoint for processing (for testing)
app.post('/process', async (c) => {
  const result = await processDraftedContent(c.env);
  return c.json(result);
});

// Manual trigger endpoint for auto-scheduling (Buffer-style queue)
app.post('/schedule', async (c) => {
  const result = await autoScheduleReadyContent(c.env);
  return c.json(result);
});

// Reschedule: clear pending schedules and re-queue with adaptive pacing
app.post('/reschedule', async (c) => {
  const errors: string[] = [];

  // Get all pending scheduled entries
  const pending = await getPendingScheduleEntries(
    c.env.NOTION_TOKEN,
    c.env.NOTION_SCHEDULE_DB_ID
  );

  console.log(`Rescheduling ${pending.length} pending entries`);

  // Delete schedule entries and reset content to Ready
  for (const entry of pending) {
    try {
      await deleteScheduleEntry(c.env.NOTION_TOKEN, entry.scheduleId);
      await markContentReady(c.env.NOTION_TOKEN, entry.contentId);
    } catch (error) {
      errors.push(`Failed to reset ${entry.contentId}: ${error}`);
    }
  }

  // Re-run the scheduler with adaptive pacing
  const scheduleResult = await autoScheduleReadyContent(c.env);

  return c.json({
    cleared: pending.length,
    scheduled: scheduleResult.scheduled,
    errors: [...errors, ...scheduleResult.errors],
  });
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
        // Collect all images to post
        const imagesToPost: string[] = [...(scheduled.content.images || [])];
        console.log(`Content images found: ${scheduled.content.images?.length || 0}`);

        // Handle quote image if available (pre-processed or fallback to matching at publish time)
        if (scheduled.includeQuote) {
          // Check if we have a pre-processed quote from the processing step
          if (scheduled.content.matchedQuoteId) {
            console.log(`Using pre-processed quote: ${scheduled.content.matchedQuoteId}`);
            // Quote image should already be cached in R2 from processing
            // For now, we'd need a public R2 URL or use inline image upload
            // const imageKey = `images/${scheduled.content.matchedQuoteId}.png`;
            // imagesToPost.push(imageUrl);
          } else {
            // Fallback: match quote at publish time (for content not yet processed)
            console.log('No pre-processed quote, matching at publish time');
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
                // imagesToPost.push(quoteImageUrl);
              }
            }
          }
        }

        console.log(`Post has ${imagesToPost.length} inline images`);

        const postUrls: { xUrl?: string; linkedInUrl?: string } = {};

        // Post to X if platforms include X
        if (scheduled.platforms.includes('X')) {
          try {
            const xResult = await postToX(
              scheduled.content.content,
              imagesToPost.length > 0 ? imagesToPost : undefined,
              {
                // OAuth 2.0 (for tweets)
                accessToken: env.X_ACCESS_TOKEN,
                refreshToken: env.X_REFRESH_TOKEN,
                clientId: env.X_CLIENT_ID,
                clientSecret: env.X_CLIENT_SECRET,
                // OAuth 1.0a (for media upload)
                apiKey: env.X_API_KEY,
                apiKeySecret: env.X_API_KEY_SECRET,
                accessTokenOAuth1: env.X_ACCESS_TOKEN_OAUTH1,
                accessTokenSecret: env.X_ACCESS_TOKEN_SECRET,
                // KV for token persistence
                kv: env.KV,
              },
              scheduled.content.replyContent // Pass reply content for thread
            );
            postUrls.xUrl = xResult.url;
            console.log(`Posted to X: ${xResult.url}`);
            if (xResult.replyUrl) {
              console.log(`Posted reply: ${xResult.replyUrl}`);
            }
          } catch (xError) {
            console.error('X posting failed:', xError);
            errors.push(`X posting failed for ${scheduled.id}: ${xError}`);
          }
        }

        // Post to LinkedIn if platforms include LinkedIn
        if (scheduled.platforms.includes('LinkedIn')) {
          try {
            const linkedInResult = await postToLinkedIn(
              scheduled.content.content,
              imagesToPost.length > 0 ? imagesToPost : undefined,
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
// Handles: processing (Drafted → Processed), auto-scheduling (Ready → Scheduled), publishing (Scheduled → Published)
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
    console.log('Cron triggered at:', new Date().toISOString());

    // Run processing, auto-scheduling, and publishing in parallel
    ctx.waitUntil(
      Promise.all([
        processDraftedContent(env).then((result) => {
          console.log('Processing result:', result);
        }),
        autoScheduleReadyContent(env).then((result) => {
          console.log('Auto-scheduling result:', result);
        }),
        processScheduledPosts(env).then((result) => {
          console.log('Publishing result:', result);
        }),
      ])
    );
  },
};
