interface Quote {
  id: string;
  text: string;
  author: string;
  book: string;
  location?: string;
}

export async function matchQuoteToContent(
  postContent: string,
  quotes: Quote[],
  anthropicApiKey: string
): Promise<Quote | null> {
  // Prepare a subset of quotes to send to Claude (to stay within limits)
  const quoteSummaries = quotes.slice(0, 200).map((q, i) =>
    `${i}: "${q.text.substring(0, 150)}..." - ${q.author}, ${q.book}`
  ).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: `Given this social media post content:
"${postContent}"

Find the most thematically relevant quote from this list. Return ONLY the index number of the best matching quote, nothing else.

Quotes:
${quoteSummaries}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error('Claude API error:', await response.text());
    return null;
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>;
  };

  const indexStr = data.content[0]?.text?.trim();
  const index = parseInt(indexStr, 10);

  if (isNaN(index) || index < 0 || index >= quotes.length) {
    return null;
  }

  return quotes[index];
}

export async function generateQuoteImage(quote: Quote): Promise<ArrayBuffer> {
  // Generate a simple quote image using Canvas API
  // In a Cloudflare Worker, we'll use a simple SVG approach

  const svg = `
<svg width="1200" height="675" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#16213e;stop-opacity:1" />
    </linearGradient>
  </defs>

  <rect width="100%" height="100%" fill="url(#bg)"/>

  <text x="60" y="80" font-family="Georgia, serif" font-size="72" fill="#e94560" opacity="0.3">"</text>

  <foreignObject x="80" y="120" width="1040" height="400">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Georgia, serif; font-size: 32px; color: #eee; line-height: 1.5; word-wrap: break-word;">
      ${escapeHtml(quote.text.substring(0, 300))}${quote.text.length > 300 ? '...' : ''}
    </div>
  </foreignObject>

  <text x="1140" y="500" font-family="Georgia, serif" font-size="72" fill="#e94560" opacity="0.3" text-anchor="end">"</text>

  <line x1="80" y1="540" x2="200" y2="540" stroke="#e94560" stroke-width="3"/>

  <text x="80" y="590" font-family="Arial, sans-serif" font-size="24" fill="#aaa">
    ${escapeHtml(quote.author)}
  </text>
  <text x="80" y="625" font-family="Arial, sans-serif" font-size="18" fill="#666" font-style="italic">
    ${escapeHtml(quote.book)}
  </text>

  <text x="1120" y="640" font-family="Arial, sans-serif" font-size="14" fill="#444" text-anchor="end">
    megira | חלומות במגירה
  </text>
</svg>`;

  // Convert SVG to PNG using resvg-wasm or return SVG for now
  // In production, you'd use a service like Cloudflare Images or an external API
  const encoder = new TextEncoder();
  return encoder.encode(svg).buffer;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
