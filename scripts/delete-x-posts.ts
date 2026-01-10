import { config } from 'dotenv';
config({ path: '.dev.vars' });

const NOTION_TOKEN = process.env.NOTION_TOKEN!;
const NOTION_SCHEDULE_DB_ID = process.env.NOTION_SCHEDULE_DB_ID!;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN!;
const X_REFRESH_TOKEN = process.env.X_REFRESH_TOKEN!;
const X_CLIENT_ID = process.env.X_CLIENT_ID!;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET!;

interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

async function getPublishedSchedules(): Promise<Array<{ id: string; xPostUrl: string }>> {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_SCHEDULE_DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          property: 'Status',
          select: { equals: 'Published' },
        },
        sorts: [{ property: 'Published At', direction: 'descending' }],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status}`);
  }

  const data = await response.json() as { results: NotionPage[] };

  return data.results
    .filter((page) => page.properties['X Post URL']?.url)
    .map((page) => ({
      id: page.id,
      xPostUrl: page.properties['X Post URL'].url,
    }));
}

async function deleteFromX(tweetId: string): Promise<boolean> {
  const response = await fetch(`https://api.twitter.com/2/tweets/${tweetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${X_ACCESS_TOKEN}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Try refreshing token
      const newToken = await refreshAccessToken();
      const retryResponse = await fetch(`https://api.twitter.com/2/tweets/${tweetId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${newToken}`,
        },
      });
      if (!retryResponse.ok) {
        const error = await retryResponse.text();
        throw new Error(`X API delete error: ${retryResponse.status} ${error}`);
      }
      const data = await retryResponse.json() as { data: { deleted: boolean } };
      return data.data.deleted;
    }
    const error = await response.text();
    throw new Error(`X API delete error: ${response.status} ${error}`);
  }

  const data = await response.json() as { data: { deleted: boolean } };
  return data.data.deleted;
}

async function refreshAccessToken(): Promise<string> {
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: X_REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

async function updateScheduleStatus(scheduleId: string, status: string): Promise<void> {
  await fetch(`https://api.notion.com/v1/pages/${scheduleId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        'Status': { select: { name: status } },
        'X Post URL': { url: null },
      },
    }),
  });
}

async function main() {
  console.log('Fetching published schedules from Notion...');
  const schedules = await getPublishedSchedules();

  console.log(`Found ${schedules.length} published schedules with X Post URLs:`);
  for (const schedule of schedules) {
    console.log(`  - ${schedule.xPostUrl}`);
  }

  if (schedules.length === 0) {
    console.log('No X posts to delete.');
    return;
  }

  // Ask for confirmation (just list them, actual deletion needs manual trigger)
  console.log('\nTo delete these posts, run with --delete flag');

  if (process.argv.includes('--delete')) {
    for (const schedule of schedules) {
      // Extract tweet ID from URL (https://x.com/i/status/123456789)
      const tweetId = schedule.xPostUrl.split('/').pop();
      if (!tweetId) {
        console.log(`Could not extract tweet ID from: ${schedule.xPostUrl}`);
        continue;
      }

      try {
        console.log(`Deleting tweet ${tweetId}...`);
        await deleteFromX(tweetId);
        console.log(`  ✓ Deleted tweet ${tweetId}`);

        // Update schedule status back to Scheduled
        console.log(`  Resetting schedule ${schedule.id} to Scheduled...`);
        await updateScheduleStatus(schedule.id, 'Scheduled');
        console.log(`  ✓ Schedule reset to Scheduled`);
      } catch (error) {
        console.error(`  ✗ Failed to delete tweet ${tweetId}:`, error);
      }
    }
  }
}

main().catch(console.error);
