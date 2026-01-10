interface XCredentials {
  // OAuth 2.0 (for tweets)
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  // OAuth 1.0a (for media upload)
  apiKey?: string;
  apiKeySecret?: string;
  accessTokenOAuth1?: string;
  accessTokenSecret?: string;
  // KV for token persistence
  kv?: KVNamespace;
}

const KV_ACCESS_TOKEN_KEY = 'x_access_token';
const KV_REFRESH_TOKEN_KEY = 'x_refresh_token';

// Get tokens from KV or fall back to credentials
async function getTokens(credentials: XCredentials): Promise<{ accessToken: string; refreshToken: string }> {
  if (credentials.kv) {
    const kvAccessToken = await credentials.kv.get(KV_ACCESS_TOKEN_KEY);
    const kvRefreshToken = await credentials.kv.get(KV_REFRESH_TOKEN_KEY);
    if (kvAccessToken && kvRefreshToken) {
      console.log('Using tokens from KV');
      return { accessToken: kvAccessToken, refreshToken: kvRefreshToken };
    }
  }
  return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken };
}

// Save tokens to KV
async function saveTokens(kv: KVNamespace | undefined, accessToken: string, refreshToken: string): Promise<void> {
  if (kv) {
    await kv.put(KV_ACCESS_TOKEN_KEY, accessToken);
    await kv.put(KV_REFRESH_TOKEN_KEY, refreshToken);
    console.log('Saved new tokens to KV');
  }
}

interface PostResult {
  id: string;
  url: string;
  replyId?: string;
  replyUrl?: string;
}

export async function postToX(
  content: string,
  imageUrls?: string[],
  credentials?: XCredentials,
  replyContent?: string
): Promise<PostResult> {
  if (!credentials) {
    throw new Error('X credentials not provided');
  }

  // Get current tokens (from KV or credentials)
  const tokens = await getTokens(credentials);
  const currentAccessToken = tokens.accessToken;
  const currentRefreshToken = tokens.refreshToken;

  const mediaIds: string[] = [];

  // Upload media if provided (X supports up to 4 images)
  console.log(`X: imageUrls provided: ${imageUrls?.length || 0}`);
  if (imageUrls && imageUrls.length > 0) {
    const imagesToUpload = imageUrls.slice(0, 4); // X limit is 4 images
    console.log(`X: Uploading ${imagesToUpload.length} images`);
    for (const imageUrl of imagesToUpload) {
      try {
        console.log(`X: Uploading image from ${imageUrl.substring(0, 100)}...`);
        const mediaId = await uploadMedia(imageUrl, credentials);
        console.log(`X: Upload success, mediaId: ${mediaId}`);
        mediaIds.push(mediaId);
      } catch (error) {
        console.error(`X: Failed to upload image:`, error);
        // Continue with other images if one fails
      }
    }
  }
  console.log(`X: Final mediaIds count: ${mediaIds.length}`);

  // Create tweet
  const tweetPayload: {
    text: string;
    media?: { media_ids: string[] };
  } = {
    text: content.substring(0, 280), // X character limit
  };

  if (mediaIds.length > 0) {
    tweetPayload.media = { media_ids: mediaIds };
  }

  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${currentAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(tweetPayload),
  });

  if (!response.ok) {
    const error = await response.text();

    // Check if token expired and needs refresh
    if (response.status === 401) {
      const newTokens = await refreshAccessToken(credentials, currentRefreshToken);
      // Save new tokens to KV
      await saveTokens(credentials.kv, newTokens.accessToken, newTokens.refreshToken);
      // Retry with new token (pass credentials without KV to avoid re-reading old tokens)
      return postToX(content, imageUrls, {
        ...credentials,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        kv: undefined, // Don't read from KV on retry, use fresh tokens
      }, replyContent);
    }

    throw new Error(`X API error: ${response.status} ${error}`);
  }

  const data = await response.json() as {
    data: { id: string };
  };

  const result: PostResult = {
    id: data.data.id,
    url: `https://x.com/i/status/${data.data.id}`,
  };

  // Post reply if replyContent is provided
  if (replyContent) {
    try {
      const replyPayload = {
        text: replyContent.substring(0, 280),
        reply: {
          in_reply_to_tweet_id: data.data.id,
        },
      };

      const replyResponse = await fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(replyPayload),
      });

      if (replyResponse.ok) {
        const replyData = await replyResponse.json() as { data: { id: string } };
        result.replyId = replyData.data.id;
        result.replyUrl = `https://x.com/i/status/${replyData.data.id}`;
        console.log(`Posted reply: ${result.replyUrl}`);
      } else {
        console.error('Failed to post reply:', await replyResponse.text());
      }
    } catch (error) {
      console.error('Error posting reply:', error);
      // Don't fail the whole post if reply fails
    }
  }

  return result;
}


function encodeRFC3986(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

// HMAC-SHA1 implementation for Cloudflare Workers
async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataData = encoder.encode(data);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataData);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// Convert ArrayBuffer to base64 without stack overflow
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function uploadMedia(
  imageUrl: string,
  credentials: XCredentials
): Promise<string> {
  // Check if OAuth 1.0a credentials are available
  if (!credentials.apiKey || !credentials.apiKeySecret ||
      !credentials.accessTokenOAuth1 || !credentials.accessTokenSecret) {
    throw new Error('OAuth 1.0a credentials required for media upload');
  }

  // Fetch the image
  const imageResponse = await fetch(imageUrl);
  const imageData = await imageResponse.arrayBuffer();
  console.log(`X: Image size: ${imageData.byteLength} bytes`);
  const base64 = arrayBufferToBase64(imageData);

  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const params = {
    media_data: base64,
  };

  // Generate OAuth 1.0a authorization header
  const authHeader = await generateOAuth1SignatureAsync(
    'POST',
    url,
    params,
    credentials
  );

  // Upload to X media endpoint with OAuth 1.0a
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `media_data=${encodeURIComponent(base64)}`,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Media upload failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { media_id_string: string };
  return data.media_id_string;
}

// Async version of OAuth signature generation
async function generateOAuth1SignatureAsync(
  method: string,
  url: string,
  params: Record<string, string>,
  credentials: XCredentials
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey!,
    oauth_token: credentials.accessTokenOAuth1!,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: generateNonce(),
    oauth_version: '1.0',
  };

  // Combine all params
  const allParams = { ...params, ...oauthParams };

  // Sort and encode
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(key => `${encodeRFC3986(key)}=${encodeRFC3986(allParams[key])}`)
    .join('&');

  // Create signature base string
  const signatureBaseString = [
    method.toUpperCase(),
    encodeRFC3986(url),
    encodeRFC3986(paramString),
  ].join('&');

  // Create signing key
  const signingKey = `${encodeRFC3986(credentials.apiKeySecret!)}&${encodeRFC3986(credentials.accessTokenSecret!)}`;

  // Generate HMAC-SHA1 signature
  const signature = await hmacSha1(signingKey, signatureBaseString);

  // Build OAuth header
  oauthParams['oauth_signature'] = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeRFC3986(key)}="${encodeRFC3986(oauthParams[key])}"`)
    .join(', ');

  return authHeader;
}

async function refreshAccessToken(
  credentials: XCredentials,
  currentRefreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  console.log('Refreshing X access token...');
  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: currentRefreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as { access_token: string; refresh_token: string };
  console.log('Token refresh successful');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  };
}

export async function deleteFromX(
  tweetId: string,
  credentials: XCredentials
): Promise<boolean> {
  // Get current tokens (from KV or credentials)
  const tokens = await getTokens(credentials);

  const response = await fetch(`https://api.twitter.com/2/tweets/${tweetId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${tokens.accessToken}`,
    },
  });

  if (!response.ok) {
    // Check if token expired and needs refresh
    if (response.status === 401) {
      const newTokens = await refreshAccessToken(credentials, tokens.refreshToken);
      await saveTokens(credentials.kv, newTokens.accessToken, newTokens.refreshToken);
      return deleteFromX(tweetId, {
        ...credentials,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        kv: undefined,
      });
    }
    const error = await response.text();
    throw new Error(`X API delete error: ${response.status} ${error}`);
  }

  const data = await response.json() as { data: { deleted: boolean } };
  return data.data.deleted;
}
