import http from 'http';
import crypto from 'crypto';
import open from 'open';

const CLIENT_ID = process.env.X_CLIENT_ID || '';
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];

// Generate PKCE challenge
function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

async function main() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');

  console.log('=== X (Twitter) OAuth 2.0 Setup ===\n');
  console.log('Starting OAuth flow...');
  console.log('A browser window will open for you to authorize the app.\n');

  // Create authorization URL
  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  // Start local server to handle callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:3000`);

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch - possible CSRF attack');
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No authorization code received');
        return;
      }

      console.log('Received authorization code, exchanging for tokens...\n');

      try {
        // Exchange code for tokens
        const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
          }),
        });

        if (!tokenResponse.ok) {
          const error = await tokenResponse.text();
          console.error('Token exchange failed:', error);
          res.writeHead(500);
          res.end(`Token exchange failed: ${error}`);
          server.close();
          process.exit(1);
        }

        const tokens = await tokenResponse.json() as {
          access_token: string;
          refresh_token: string;
          token_type: string;
          expires_in: number;
          scope: string;
        };

        console.log('=== SUCCESS! ===\n');
        console.log('Access Token:', tokens.access_token);
        console.log('\nRefresh Token:', tokens.refresh_token);
        console.log('\nExpires in:', tokens.expires_in, 'seconds');
        console.log('Scopes:', tokens.scope);

        console.log('\n=== Add these secrets to Cloudflare Worker ===\n');
        console.log('wrangler secret put X_CLIENT_ID');
        console.log(`  → ${CLIENT_ID}`);
        console.log('\nwrangler secret put X_CLIENT_SECRET');
        console.log(`  → ${CLIENT_SECRET}`);
        console.log('\nwrangler secret put X_ACCESS_TOKEN');
        console.log(`  → ${tokens.access_token}`);
        console.log('\nwrangler secret put X_REFRESH_TOKEN');
        console.log(`  → ${tokens.refresh_token}`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>✅ Authorization Successful!</h1>
              <p>You can close this window and return to your terminal.</p>
              <p>The tokens have been printed in the console.</p>
            </body>
          </html>
        `);

        server.close();
        process.exit(0);
      } catch (error) {
        console.error('Error:', error);
        res.writeHead(500);
        res.end(`Error: ${error}`);
        server.close();
        process.exit(1);
      }
    }
  });

  server.listen(3000, () => {
    console.log('Callback server running on http://localhost:3000');
    console.log('Opening browser for authorization...\n');
    open(authUrl.toString());
  });
}

main().catch(console.error);
