import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const CONTENT_DB_ID = process.env.NOTION_DATABASE_ID || '2e2fdc1497ee81ceaae0eb8a6d291ed1';

async function main() {
  if (!NOTION_TOKEN) {
    console.error('NOTION_TOKEN is required');
    console.error('Run: NOTION_TOKEN=your_token npx tsx scripts/migrate-statuses.ts');
    process.exit(1);
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  console.log('=== Content Status Migration ===\n');
  console.log('Migrating to new status workflow:');
  console.log('  Idea → Drafted → Processing → Processed → Ready → Scheduled → Published\n');

  // Step 1: Update Content DB with new status options and properties
  console.log('1. Updating Content database schema...');

  try {
    await notion.databases.update({
      database_id: CONTENT_DB_ID,
      properties: {
        // Update Status with new options
        'Status': {
          select: {
            options: [
              { name: 'Idea', color: 'gray' },
              { name: 'Drafted', color: 'yellow' },
              { name: 'Processing', color: 'orange' },
              { name: 'Processed', color: 'purple' },
              { name: 'Ready', color: 'blue' },
              { name: 'Scheduled', color: 'pink' },
              { name: 'Published', color: 'green' },
            ],
          },
        },
        // Add new properties for processing
        'Matched Quote ID': {
          rich_text: {},
        },
        'Processing Log': {
          rich_text: {},
        },
        'Processed At': {
          date: {},
        },
      },
    });
    console.log('   ✓ Database schema updated');
  } catch (error) {
    console.error('   ✗ Failed to update schema:', error);
    process.exit(1);
  }

  // Step 2: Migrate existing "Draft" or "Compose" items to "Drafted"
  console.log('\n2. Migrating existing posts...');

  const statusesToMigrate = ['Draft', 'Compose'];
  let migratedCount = 0;

  for (const oldStatus of statusesToMigrate) {
    try {
      const response = await notion.databases.query({
        database_id: CONTENT_DB_ID,
        filter: {
          property: 'Status',
          select: { equals: oldStatus },
        },
      });

      for (const page of response.results) {
        try {
          await notion.pages.update({
            page_id: page.id,
            properties: {
              'Status': {
                select: { name: 'Drafted' },
              },
            },
          });
          migratedCount++;
          console.log(`   ✓ Migrated "${oldStatus}" → "Drafted": ${page.id}`);
        } catch (err) {
          console.error(`   ✗ Failed to migrate ${page.id}:`, err);
        }
      }
    } catch (error) {
      // Status may not exist yet, that's ok
      console.log(`   - No posts with status "${oldStatus}" found`);
    }
  }

  console.log(`\n   Total migrated: ${migratedCount} posts`);

  // Step 3: Summary
  console.log('\n=== Migration Complete ===\n');
  console.log('New status workflow:');
  console.log('  1. Idea      - Initial brainstorm');
  console.log('  2. Drafted   - Ready for AI processing (cron picks up)');
  console.log('  3. Processing - Currently being enriched');
  console.log('  4. Processed - Enriched, awaiting your review');
  console.log('  5. Ready     - Approved, can be scheduled');
  console.log('  6. Scheduled - Has entry in Schedule DB');
  console.log('  7. Published - Successfully posted');
  console.log('\nNew properties added:');
  console.log('  - Matched Quote ID: Stores the ID of matched quote');
  console.log('  - Processing Log: Logs what enrichments were applied');
  console.log('  - Processed At: Timestamp of processing completion');
}

main().catch(console.error);
