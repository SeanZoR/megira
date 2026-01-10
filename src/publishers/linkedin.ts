interface PostResult {
  id: string;
  url: string;
}

// Cached user ID for personal profile posting
let cachedUserId: string | null = null;

export async function postToLinkedIn(
  content: string,
  imageUrls?: string[],
  accessToken?: string
): Promise<PostResult> {
  if (!accessToken) {
    throw new Error('LinkedIn access token not provided');
  }

  // Get the user's person ID for personal profile posting
  const userId = await getUserId(accessToken);

  const mediaAssets: string[] = [];

  // Upload images if provided (LinkedIn supports up to 9 images)
  if (imageUrls && imageUrls.length > 0) {
    const imagesToUpload = imageUrls.slice(0, 9); // LinkedIn limit is 9 images
    for (const imageUrl of imagesToUpload) {
      try {
        const mediaAsset = await uploadImage(imageUrl, userId, accessToken);
        mediaAssets.push(mediaAsset);
      } catch (error) {
        console.error(`Failed to upload image ${imageUrl}:`, error);
        // Continue with other images if one fails
      }
    }
  }

  // Create post payload for personal profile (using w_member_social scope)
  const postPayload: LinkedInPostPayload = {
    author: `urn:li:person:${userId}`,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: content.substring(0, 3000), // LinkedIn limit
        },
        shareMediaCategory: mediaAssets.length > 0 ? 'IMAGE' : 'NONE',
        media: mediaAssets.length > 0 ? mediaAssets.map(asset => ({
          status: 'READY',
          media: asset,
        })) : undefined,
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postPayload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LinkedIn API error: ${response.status} ${error}`);
  }

  const data = await response.json() as { id: string };

  return {
    id: data.id,
    url: `https://www.linkedin.com/feed/update/${data.id}`,
  };
}

async function getUserId(accessToken: string): Promise<string> {
  if (cachedUserId) {
    return cachedUserId;
  }

  // Get current user's profile using /userinfo endpoint (works with openid scope)
  // or /me endpoint (works with profile scope)
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Fallback to /me endpoint if userinfo fails
    const meResponse = await fetch('https://api.linkedin.com/v2/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!meResponse.ok) {
      throw new Error(`Failed to get user info: ${meResponse.status}`);
    }

    const meData = await meResponse.json() as { id: string };
    cachedUserId = meData.id;
    return cachedUserId;
  }

  const data = await response.json() as { sub: string };
  cachedUserId = data.sub;
  return cachedUserId;
}

async function uploadImage(
  imageUrl: string,
  userId: string,
  accessToken: string
): Promise<string> {
  // Step 1: Register the upload for personal profile
  const registerResponse = await fetch(
    'https://api.linkedin.com/v2/assets?action=registerUpload',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${userId}`,
          serviceRelationships: [{
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent',
          }],
        },
      }),
    }
  );

  if (!registerResponse.ok) {
    throw new Error(`Image registration failed: ${registerResponse.status}`);
  }

  const registerData = await registerResponse.json() as {
    value: {
      uploadMechanism: {
        'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
          uploadUrl: string;
        };
      };
      asset: string;
    };
  };

  const uploadUrl =
    registerData.value.uploadMechanism[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ].uploadUrl;
  const asset = registerData.value.asset;

  // Step 2: Upload the image
  const imageResponse = await fetch(imageUrl);
  const imageData = await imageResponse.arrayBuffer();

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    body: imageData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Image upload failed: ${uploadResponse.status}`);
  }

  return asset;
}

interface LinkedInPostPayload {
  author: string;
  lifecycleState: string;
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: {
        text: string;
      };
      shareMediaCategory: string;
      media?: Array<{
        status: string;
        media: string;
      }>;
    };
  };
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': string;
  };
}
