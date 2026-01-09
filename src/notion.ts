// Types for Content database
interface NotionPost {
  id: string;
  title: string;
  content: string;
  images: string[]; // Inline images from page body
  status: string;
  includeQuote: boolean;
  quoteOverride?: string;
}

// Notion block types we care about
interface NotionBlock {
  id: string;
  type: string;
  paragraph?: { rich_text: Array<{ plain_text: string }> };
  heading_1?: { rich_text: Array<{ plain_text: string }> };
  heading_2?: { rich_text: Array<{ plain_text: string }> };
  heading_3?: { rich_text: Array<{ plain_text: string }> };
  bulleted_list_item?: { rich_text: Array<{ plain_text: string }> };
  numbered_list_item?: { rich_text: Array<{ plain_text: string }> };
  quote?: { rich_text: Array<{ plain_text: string }> };
  callout?: { rich_text: Array<{ plain_text: string }> };
  image?: {
    type: 'file' | 'external';
    file?: { url: string };
    external?: { url: string };
  };
}

// Types for Schedule database
interface ScheduledPost {
  id: string;
  contentId: string;
  scheduledFor: Date;
  platform: 'X' | 'LinkedIn' | 'Both';
  status: 'Scheduled' | 'Publishing' | 'Published' | 'Failed';
  includeQuote: boolean;
  content?: NotionPost; // Populated from linked content
}

interface NotionPage {
  id: string;
  properties: Record<string, any>;
}

// Fetch scheduled posts that are due for publishing
export async function getScheduledPosts(
  notionToken: string,
  scheduleDbId: string,
  contentDbId: string
): Promise<ScheduledPost[]> {
  const now = new Date().toISOString();

  // Query Schedule DB for posts that are due
  const response = await fetch(
    `https://api.notion.com/v1/databases/${scheduleDbId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          and: [
            {
              property: 'Status',
              select: { equals: 'Scheduled' },
            },
            {
              property: 'Scheduled For',
              date: { on_or_before: now },
            },
          ],
        },
        sorts: [
          {
            property: 'Scheduled For',
            direction: 'ascending',
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { results: NotionPage[] };
  const scheduledPosts: ScheduledPost[] = [];

  for (const page of data.results) {
    const props = page.properties;

    // Get linked content ID
    const contentRelation = props['Content']?.relation?.[0]?.id;
    if (!contentRelation) continue;

    // Fetch the linked content
    const content = await getContentById(notionToken, contentRelation);
    if (!content) continue;

    scheduledPosts.push({
      id: page.id,
      contentId: contentRelation,
      scheduledFor: new Date(props['Scheduled For']?.date?.start || ''),
      platform: props['Platform']?.select?.name || 'Both',
      status: props['Status']?.select?.name || 'Scheduled',
      includeQuote: props['Include Quote']?.checkbox || false,
      content,
    });
  }

  return scheduledPosts;
}

// Fetch page blocks (body content) and parse into text + images
async function getPageBlocks(
  notionToken: string,
  pageId: string
): Promise<{ text: string; images: string[] }> {
  const textParts: string[] = [];
  const images: string[] = [];

  let cursor: string | undefined;
  let hasMore = true;

  // Paginate through all blocks
  while (hasMore) {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`);
    if (cursor) url.searchParams.set('start_cursor', cursor);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch blocks: ${response.status}`);
      break;
    }

    const data = await response.json() as {
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const block of data.results) {
      // Extract text from text-based blocks
      const textContent = extractTextFromBlock(block);
      if (textContent) {
        textParts.push(textContent);
      }

      // Extract images
      if (block.type === 'image' && block.image) {
        const imageUrl = block.image.type === 'file'
          ? block.image.file?.url
          : block.image.external?.url;

        if (imageUrl) {
          images.push(imageUrl);
        }
      }
    }

    hasMore = data.has_more;
    cursor = data.next_cursor || undefined;
  }

  return {
    text: textParts.join('\n\n'),
    images,
  };
}

// Extract plain text from various block types
function extractTextFromBlock(block: NotionBlock): string | null {
  const richTextBlocks: Array<keyof NotionBlock> = [
    'paragraph',
    'heading_1',
    'heading_2',
    'heading_3',
    'bulleted_list_item',
    'numbered_list_item',
    'quote',
    'callout',
  ];

  for (const blockType of richTextBlocks) {
    const content = block[blockType] as { rich_text: Array<{ plain_text: string }> } | undefined;
    if (content?.rich_text) {
      const text = content.rich_text.map((t) => t.plain_text).join('');
      if (text.trim()) {
        // Add bullet/number prefix for list items
        if (blockType === 'bulleted_list_item') return `• ${text}`;
        if (blockType === 'numbered_list_item') return `- ${text}`;
        return text;
      }
    }
  }

  return null;
}

// Fetch a single content item by ID
async function getContentById(
  notionToken: string,
  pageId: string
): Promise<NotionPost | null> {
  const response = await fetch(
    `https://api.notion.com/v1/pages/${pageId}`,
    {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    }
  );

  if (!response.ok) return null;

  const page = await response.json() as NotionPage;
  const props = page.properties;

  // Fetch page body content (blocks) for text and images
  const pageContent = await getPageBlocks(notionToken, pageId);

  // Use page body content if available, fallback to Content property
  const content = pageContent.text || props.Content?.rich_text?.map((t: any) => t.plain_text).join('') || '';

  return {
    id: page.id,
    title: props.Title?.title?.[0]?.plain_text || '',
    content,
    images: pageContent.images,
    status: props.Status?.select?.name || '',
    includeQuote: props['Include Quote']?.checkbox || false,
    quoteOverride: props['Quote Override']?.rich_text?.[0]?.plain_text,
  };
}

// Update schedule status to "Publishing"
export async function markSchedulePublishing(
  notionToken: string,
  scheduleId: string
): Promise<void> {
  await updateSchedulePage(notionToken, scheduleId, {
    'Status': { select: { name: 'Publishing' } },
  });
}

// Mark schedule as published with post URLs
export async function markSchedulePublished(
  notionToken: string,
  scheduleId: string,
  urls: { xUrl?: string; linkedInUrl?: string }
): Promise<void> {
  const properties: Record<string, any> = {
    'Status': { select: { name: 'Published' } },
    'Published At': { date: { start: new Date().toISOString() } },
  };

  if (urls.xUrl) {
    properties['X Post URL'] = { url: urls.xUrl };
  }
  if (urls.linkedInUrl) {
    properties['LinkedIn Post URL'] = { url: urls.linkedInUrl };
  }

  await updateSchedulePage(notionToken, scheduleId, properties);
}

// Mark schedule as failed with error message
export async function markScheduleFailed(
  notionToken: string,
  scheduleId: string,
  error: string
): Promise<void> {
  await updateSchedulePage(notionToken, scheduleId, {
    'Status': { select: { name: 'Failed' } },
    'Error': {
      rich_text: [{ type: 'text', text: { content: error.substring(0, 2000) } }],
    },
  });
}

// Helper to update a schedule page
async function updateSchedulePage(
  notionToken: string,
  pageId: string,
  properties: Record<string, any>
): Promise<void> {
  const response = await fetch(
    `https://api.notion.com/v1/pages/${pageId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update schedule: ${response.status}`);
  }
}

// Also update the content status to Published
export async function markContentPublished(
  notionToken: string,
  contentId: string
): Promise<void> {
  const response = await fetch(
    `https://api.notion.com/v1/pages/${contentId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          'Status': { select: { name: 'Published' } },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update content: ${response.status}`);
  }
}

// Legacy function for backward compatibility
export async function getReadyPosts(
  notionToken: string,
  databaseId: string
): Promise<NotionPost[]> {
  const response = await fetch(
    `https://api.notion.com/v1/databases/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filter: {
          property: 'Status',
          select: { equals: 'Ready' },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { results: NotionPage[] };

  // Fetch page blocks for each post to get content and images
  const posts: NotionPost[] = [];
  for (const page of data.results) {
    const pageContent = await getPageBlocks(notionToken, page.id);
    const content = pageContent.text || page.properties.Content?.rich_text?.map((t: any) => t.plain_text).join('') || '';

    posts.push({
      id: page.id,
      title: page.properties.Title?.title?.[0]?.plain_text || '',
      content,
      images: pageContent.images,
      status: page.properties.Status?.select?.name || '',
      includeQuote: page.properties['Include Quote']?.checkbox || false,
      quoteOverride: page.properties['Quote Override']?.rich_text?.[0]?.plain_text,
    });
  }

  return posts;
}

// Legacy function
export async function markAsPublished(
  notionToken: string,
  pageId: string,
  urls: { xUrl?: string; linkedInUrl?: string }
): Promise<void> {
  const postUrls = [
    urls.xUrl && `X: ${urls.xUrl}`,
    urls.linkedInUrl && `LinkedIn: ${urls.linkedInUrl}`,
  ].filter(Boolean).join('\n');

  await fetch(
    `https://api.notion.com/v1/pages/${pageId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          'Status': { select: { name: 'Published' } },
          'Published At': { date: { start: new Date().toISOString() } },
          'Post URLs': {
            rich_text: [{ type: 'text', text: { content: postUrls } }],
          },
        },
      }),
    }
  );
}
