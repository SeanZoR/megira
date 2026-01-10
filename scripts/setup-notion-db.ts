import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const PARENT_PAGE_ID = '2e2fdc1497ee80fcadd0e686f290ebb9';

async function createDatabase() {
  const notion = new Client({ auth: NOTION_TOKEN });

  console.log('Creating megira content database...');

  try {
    // First, let's try to read the parent page to verify access
    const page = await notion.pages.retrieve({ page_id: PARENT_PAGE_ID });
    console.log('Successfully connected to parent page');

    // Create the database
    const database = await notion.databases.create({
      parent: {
        type: 'page_id',
        page_id: PARENT_PAGE_ID,
      },
      title: [
        {
          type: 'text',
          text: {
            content: 'megira content',
          },
        },
      ],
      properties: {
        // Title - the main post title/hook
        Title: {
          title: {},
        },
        // Content - main content body (rich text)
        Content: {
          rich_text: {},
        },
        // Status - workflow status
        Status: {
          select: {
            options: [
              { name: 'Idea', color: 'gray' },
              { name: 'Draft', color: 'yellow' },
              { name: 'Compose', color: 'orange' },
              { name: 'Ready', color: 'blue' },
              { name: 'Published', color: 'green' },
            ],
          },
        },
        // Include Quote - whether to attach a quote image
        'Include Quote': {
          checkbox: {},
        },
        // Quote Override - specific quote to use
        'Quote Override': {
          rich_text: {},
        },
        // Published At - auto-filled when published
        'Published At': {
          date: {},
        },
        // Post URLs - links to published posts
        'Post URLs': {
          rich_text: {},
        },
      },
    });

    console.log('Database created successfully!');
    console.log('Database ID:', database.id);
    console.log('URL:', 'url' in database ? database.url : 'N/A');

    return database;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

async function getExistingContent() {
  const notion = new Client({ auth: NOTION_TOKEN });

  console.log('\nFetching existing content from parent page...');

  try {
    // Get block children of the parent page
    const blocks = await notion.blocks.children.list({
      block_id: PARENT_PAGE_ID,
      page_size: 100,
    });

    console.log(`Found ${blocks.results.length} blocks`);

    const ideas: string[] = [];

    for (const block of blocks.results) {
      if ('type' in block) {
        // Extract text from various block types
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

        if (text.trim()) {
          ideas.push(text.trim());
          console.log(`  - ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
        }
      }
    }

    return ideas;
  } catch (error) {
    console.error('Error fetching content:', error);
    return [];
  }
}

async function addIdeasToDatabase(databaseId: string, ideas: string[]) {
  const notion = new Client({ auth: NOTION_TOKEN });

  console.log(`\nAdding ${ideas.length} ideas to database...`);

  for (const idea of ideas) {
    try {
      await notion.pages.create({
        parent: {
          database_id: databaseId,
        },
        properties: {
          Title: {
            title: [
              {
                text: {
                  content: idea.substring(0, 100), // Truncate if too long
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
      console.log(`  Added: ${idea.substring(0, 40)}...`);
    } catch (error) {
      console.error(`  Failed to add: ${idea.substring(0, 40)}...`, error);
    }
  }
}

async function main() {
  console.log('=== Megira Notion Database Setup ===\n');

  // Step 1: Create the database
  const database = await createDatabase();

  // Step 2: Get existing ideas from the parent page
  const ideas = await getExistingContent();

  // Step 3: Add ideas to the database
  if (ideas.length > 0) {
    await addIdeasToDatabase(database.id, ideas);
  }

  console.log('\n=== Setup Complete ===');
  console.log(`Database ID: ${database.id}`);
  console.log(`\nAdd this to your Cloudflare Worker secrets:`);
  console.log(`  wrangler secret put NOTION_DATABASE_ID`);
  console.log(`  Then paste: ${database.id}`);
}

main().catch(console.error);
