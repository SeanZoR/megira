import http from 'http';
import crypto from 'crypto';
import open from 'open';

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || '';
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3000/callback';
// Scopes for posting to pages
const SCOPES = ['w_member_social', 'w_organization_social', 'r_organization_social'];

async function main() {
  const state = crypto.randomBytes(16).toString('hex');

  console.log('=== LinkedIn OAuth 2.0 Setup ===\n');
  console.log('IMPORTANT: Before running this script, make sure you have added');
  console.log(`${REDIRECT_URI} to your LinkedIn app's Authorized redirect URLs.\n`);
  console.log('Starting OAuth flow...');
  console.log('A browser window will open for you to authorize the app.\n');

  // Create authorization URL
  const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES.join(' '));
  authUrl.searchParams.set('state', state);

  // Start local server to handle callback
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:3000`);

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        console.error('Authorization error:', error);
        res.writeHead(400);
        res.end(`Authorization error: ${error}`);
        server.close();
        process.exit(1);
      }

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
        const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
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
          expires_in: number;
          scope?: string;
        };

        console.log('=== SUCCESS! ===\n');
        console.log('Access Token:', tokens.access_token);
        console.log('\nExpires in:', tokens.expires_in, 'seconds (~', Math.round(tokens.expires_in / 86400), 'days)');
        if (tokens.scope) {
          console.log('Scopes:', tokens.scope);
        }

        console.log('\n=== Add this secret to Cloudflare Worker ===\n');
        console.log('wrangler secret put LINKEDIN_ACCESS_TOKEN');
        console.log(`  -> ${tokens.access_token}`);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h1>✅ LinkedIn Authorization Successful!</h1>
              <p>You can close this window and return to your terminal.</p>
              <p>The access token has been printed in the console.</p>
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
