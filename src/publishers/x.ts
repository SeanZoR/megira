interface XCredentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

interface PostResult {
  id: string;
  url: string;
}

export async function postToX(
  content: string,
  imageUrl?: string,
  credentials?: XCredentials
): Promise<PostResult> {
  if (!credentials) {
    throw new Error('X credentials not provided');
  }

  let mediaId: string | undefined;

  // Upload media if provided
  if (imageUrl) {
    mediaId = await uploadMedia(imageUrl, credentials);
  }

  // Create tweet
  const tweetPayload: {
    text: string;
    media?: { media_ids: string[] };
  } = {
    text: content.substring(0, 280), // X character limit
  };

  if (mediaId) {
    tweetPayload.media = { media_ids: [mediaId] };
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tweetPayload),
  });

  if (!response.ok) {
    const error = await response.text();

    // Check if token expired and needs refresh
    if (response.status === 401) {
      const newToken = await refreshAccessToken(credentials);
      // Retry with new token
      return postToX(content, imageUrl, {
        ...credentials,
        accessToken: newToken,
      });
    }

    throw new Error(`X API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    data: { id: string };
  };

  return {
    id: data.data.id,
    url: `https://x.com/i/status/${data.data.id}`,
  };
}

async function uploadMedia(
  imageUrl: string,
  credentials: XCredentials
): Promise<string> {
  // Fetch the image
  const imageResponse = await fetch(imageUrl);
  const imageData = await imageResponse.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(imageData)));

  // Upload to X media endpoint (v1.1 API)
  const response = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `media_data=${encodeURIComponent(base64)}`,
  });

  if (!response.ok) {
    throw new Error(`Media upload failed: ${response.status}`);
  }

  const data = await response.json() as { media_id_string: string };
  return data.media_id_string;
}

async function refreshAccessToken(credentials: XCredentials): Promise<string> {
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}
