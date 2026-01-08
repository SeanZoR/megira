interface NotionPost {
  id: string;
  title: string;
  content: string;
  status: string;
  includeQuote: boolean;
  quoteOverride?: string;
}

interface NotionPage {
  id: string;
  properties: {
    Title?: { title: Array<{ plain_text: string }> };
    Content?: { rich_text: Array<{ plain_text: string }> };
    Status?: { select: { name: string } };
    'Include Quote'?: { checkbox: boolean };
    'Quote Override'?: { rich_text: Array<{ plain_text: string }> };
    'Published At'?: { date: { start: string } | null };
    'Post URLs'?: { rich_text: Array<{ plain_text: string }> };
  };
}

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
          select: {
            equals: 'Ready',
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Notion API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json() as { results: NotionPage[] };

  return data.results.map((page) => ({
    id: page.id,
    title: page.properties.Title?.title?.[0]?.plain_text || '',
    content: page.properties.Content?.rich_text?.map(t => t.plain_text).join('') || '',
    status: page.properties.Status?.select?.name || '',
    includeQuote: page.properties['Include Quote']?.checkbox || false,
    quoteOverride: page.properties['Quote Override']?.rich_text?.[0]?.plain_text,
  }));
}

export async function markAsPublished(
  notionToken: string,
  pageId: string,
  urls: { xUrl?: string; linkedInUrl?: string }
): Promise<void> {
  const postUrls = [
    urls.xUrl && `X: ${urls.xUrl}`,
    urls.linkedInUrl && `LinkedIn: ${urls.linkedInUrl}`,
  ].filter(Boolean).join('\n');

  const response = await fetch(
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
          'Status': {
            select: {
              name: 'Published',
            },
          },
          'Published At': {
            date: {
              start: new Date().toISOString(),
            },
          },
          'Post URLs': {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: postUrls,
                },
              },
            ],
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update Notion page: ${response.status}`);
  }
}
