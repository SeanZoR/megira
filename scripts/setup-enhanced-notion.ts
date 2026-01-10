import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const PARENT_PAGE_ID = '2e2fdc1497ee80fcadd0e686f290ebb9';
const EXISTING_CONTENT_DB_ID = '2e2fdc1497ee81ceaae0eb8a6d291ed1';

async function main() {
  if (!NOTION_TOKEN) {
    console.error('NOTION_TOKEN is required');
    process.exit(1);
  }

  const notion = new Client({ auth: NOTION_TOKEN });

  console.log('=== Enhanced Notion Setup ===\n');

  // Step 1: Update the existing Content DB with better fields
  console.log('1. Updating Content database...');

  try {
    await notion.databases.update({
      database_id: EXISTING_CONTENT_DB_ID,
      properties: {
        // Keep existing Title
        // Keep existing Content
        // Keep existing Status
        // Add Platform preference
        'Platforms': {
          multi_select: {
            options: [
              { name: 'X', color: 'gray' },
              { name: 'LinkedIn', color: 'blue' },
            ],
          },
        },
        // Rename Include Quote to just Quote
        'Include Quote': {
          checkbox: {},
        },
      },
    });
    console.log('   Content database updated');
  } catch (error) {
    console.log('   Content database update skipped (may already have fields)');
  }

  // Step 2: Create the Schedule database
  console.log('\n2. Creating Schedule database...');

  const scheduleDb = await notion.databases.create({
    parent: {
      type: 'page_id',
      page_id: PARENT_PAGE_ID,
    },
    title: [
      {
        type: 'text',
        text: { content: 'megira schedule' },
      },
    ],
    properties: {
      // Title - auto-filled from linked content
      'Name': {
        title: {},
      },
      // Link to Content database
      'Content': {
        relation: {
          database_id: EXISTING_CONTENT_DB_ID,
          single_property: {},
        },
      },
      // Scheduled publish time
      'Scheduled For': {
        date: {},
      },
      // Platform to publish to
      'Platform': {
        select: {
          options: [
            { name: 'X', color: 'gray' },
            { name: 'LinkedIn', color: 'blue' },
            { name: 'Both', color: 'green' },
          ],
        },
      },
      // Publishing status
      'Status': {
        select: {
          options: [
            { name: 'Scheduled', color: 'yellow' },
            { name: 'Publishing', color: 'orange' },
            { name: 'Published', color: 'green' },
            { name: 'Failed', color: 'red' },
          ],
        },
      },
      // Post URLs after publishing
      'X Post URL': {
        url: {},
      },
      'LinkedIn Post URL': {
        url: {},
      },
      // Include quote image
      'Include Quote': {
        checkbox: {},
      },
      // Actual publish time
      'Published At': {
        date: {},
      },
      // Error message if failed
      'Error': {
        rich_text: {},
      },
    },
  });

  console.log('   Schedule database created!');
  console.log('   ID:', scheduleDb.id);
  console.log('   URL:', 'url' in scheduleDb ? scheduleDb.url : 'N/A');

  // Step 3: Fetch existing ideas from temp-write page
  console.log('\n3. Fetching ideas from temp-write page...');

  const blocks = await notion.blocks.children.list({
    block_id: PARENT_PAGE_ID,
    page_size: 100,
  });

  const ideas: string[] = [];

  for (const block of blocks.results) {
    if ('type' in block) {
      let text = '';

      if (block.type === 'paragraph' && 'paragraph' in block) {
        text = block.paragraph.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'heading_1' && 'heading_1' in block) {
        text = block.heading_1.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'heading_2' && 'heading_2' in block) {
        text = block.heading_2.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'heading_3' && 'heading_3' in block) {
        text = block.heading_3.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'bulleted_list_item' && 'bulleted_list_item' in block) {
        text = block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'numbered_list_item' && 'numbered_list_item' in block) {
        text = block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join('');
      } else if (block.type === 'toggle' && 'toggle' in block) {
        text = block.toggle.rich_text.map((t: any) => t.plain_text).join('');
      }

      // Filter out empty lines and database/page references
      if (text.trim() && text.trim().length > 5 && !text.includes('megira')) {
        ideas.push(text.trim());
        console.log('   Found:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
      }
    }
  }

  // Step 4: Add ideas to Content database
  console.log(`\n4. Adding ${ideas.length} ideas to Content database...`);

  for (const idea of ideas) {
    try {
      await notion.pages.create({
        parent: {
          database_id: EXISTING_CONTENT_DB_ID,
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: idea.length > 100 ? idea.substring(0, 97) + '...' : idea,
                },
              },
            ],
          },
          Content: {
            rich_text: [
              {
                text: {
                  content: idea,
                },
              },
            ],
          },
          Status: {
            select: {
              name: 'Idea',
            },
          },
          'Include Quote': {
            checkbox: false,
          },
        },
      });
      console.log('   Added:', idea.substring(0, 40) + '...');
    } catch (error) {
      console.error('   Failed:', idea.substring(0, 40) + '...', error);
    }
  }

  console.log('\n=== Setup Complete ===\n');
  console.log('Content DB:', EXISTING_CONTENT_DB_ID);
  console.log('Schedule DB:', scheduleDb.id);
  console.log('\nAdd Schedule DB ID to your worker secrets:');
  console.log('  wrangler secret put NOTION_SCHEDULE_DB_ID');
  console.log('  Then paste:', scheduleDb.id);
}

main().catch(console.error);
