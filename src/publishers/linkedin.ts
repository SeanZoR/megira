interface PostResult {
  id: string;
  url: string;
}

// LinkedIn Page ID for ajents.company - will be fetched dynamically
let cachedPageId: string | null = null;

export async function postToLinkedIn(
  content: string,
  imageUrls?: string[],
  accessToken?: string
): Promise<PostResult> {
  if (!accessToken) {
    throw new Error('LinkedIn access token not provided');
  }

  // Get the organization/page ID
  const pageId = await getPageId(accessToken);

  const mediaAssets: string[] = [];

  // Upload images if provided (LinkedIn supports up to 9 images)
  if (imageUrls && imageUrls.length > 0) {
    const imagesToUpload = imageUrls.slice(0, 9); // LinkedIn limit is 9 images
    for (const imageUrl of imagesToUpload) {
      try {
        const mediaAsset = await uploadImage(imageUrl, pageId, accessToken);
        mediaAssets.push(mediaAsset);
      } catch (error) {
        console.error(`Failed to upload image ${imageUrl}:`, error);
        // Continue with other images if one fails
      }
    }
  }

  // Create post payload for organization page
  const postPayload: LinkedInPostPayload = {
    author: `urn:li:organization:${pageId}`,
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

  // Extract the share ID from the URN
  const shareId = data.id.split(':').pop();

  return {
    id: data.id,
    url: `https://www.linkedin.com/feed/update/${data.id}`,
  };
}

async function getPageId(accessToken: string): Promise<string> {
  if (cachedPageId) {
    return cachedPageId;
  }

  // Get organizations the user is admin of
  const response = await fetch(
    'https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~))',
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get organizations: ${response.status}`);
  }

  const data = await response.json() as {
    elements: Array<{
      organizationalTarget: string;
    }>;
  };

  if (!data.elements || data.elements.length === 0) {
    throw new Error('No LinkedIn pages found for this account');
  }

  // Extract organization ID from URN (urn:li:organization:12345)
  const orgUrn = data.elements[0].organizationalTarget;
  cachedPageId = orgUrn.split(':').pop() || '';

  return cachedPageId;
}

async function uploadImage(
  imageUrl: string,
  pageId: string,
  accessToken: string
): Promise<string> {
  // Step 1: Register the upload
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
          owner: `urn:li:organization:${pageId}`,
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
