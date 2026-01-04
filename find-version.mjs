import { Octokit } from '@octokit/rest'

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  return connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  // Get commits for owner-dashboard.html
  const { data: commits } = await octokit.repos.listCommits({
    owner: 'makkahclinic',
    repo: 'makkahclinic',
    path: 'owner-dashboard.html',
    per_page: 20
  });
  
  console.log('=== آخر 20 commit لملف owner-dashboard.html ===\n');
  
  for (const commit of commits) {
    const date = new Date(commit.commit.author.date).toLocaleString('ar-SA');
    console.log(`SHA: ${commit.sha.substring(0,7)}`);
    console.log(`Date: ${date}`);
    console.log(`Message: ${commit.commit.message.split('\n')[0]}`);
    console.log('---');
  }
}

main().catch(console.error);
