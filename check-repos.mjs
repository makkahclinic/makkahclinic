import { Octokit } from '@octokit/rest';

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  return connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
}

async function main() {
  const octokit = new Octokit({ auth: await getAccessToken() });
  
  // Check makkahclinic/makkahclinic repo for GitHub Pages setup
  try {
    const { data } = await octokit.repos.get({ owner: 'makkahclinic', repo: 'makkahclinic' });
    console.log('Repo:', data.full_name);
    console.log('Homepage:', data.homepage);
    console.log('Has Pages:', data.has_pages);
    console.log('Default branch:', data.default_branch);
    
    // List files
    const { data: contents } = await octokit.repos.getContent({ owner: 'makkahclinic', repo: 'makkahclinic', path: '' });
    console.log('\nFiles in root:');
    contents.forEach(f => console.log(' -', f.name, f.type));
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
