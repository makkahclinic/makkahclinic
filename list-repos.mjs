import { Octokit } from '@octokit/rest';

let connectionSettings;

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  return accessToken;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  // Get authenticated user
  const { data: user } = await octokit.users.getAuthenticated();
  console.log('Authenticated as:', user.login);
  
  // List repos
  const { data: repos } = await octokit.repos.listForAuthenticatedUser({ per_page: 20 });
  console.log('Repos:');
  repos.forEach(r => console.log(' -', r.full_name, r.permissions?.push ? '(can push)' : '(read only)'));
}

main().catch(console.error);
