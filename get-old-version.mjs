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
  
  // Get file from commit 428cbff (1 Jan before needlestick changes)
  const { data } = await octokit.repos.getContent({
    owner: 'makkahclinic',
    repo: 'makkahclinic',
    path: 'owner-dashboard.html',
    ref: '428cbff'
  });
  
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  
  // Check for smart management features
  console.log('=== Checking for Smart Management features ===');
  console.log('Has smartCardsGrid:', content.includes('smartCardsGrid'));
  console.log('Has moduleToggle:', content.includes('moduleToggle'));
  console.log('Has smartAccessSummary:', content.includes('smartAccessSummary'));
  console.log('Has loadSmartDashboardConfig:', content.includes('loadSmartDashboardConfig'));
  console.log('Has toggleModuleForUser:', content.includes('toggleModuleForUser'));
  console.log('Has visibleModules:', content.includes('visibleModules'));
  
  // Check sidebar items
  const sidebarMatch = content.match(/nav-menu[\s\S]*?<\/nav>/);
  if (sidebarMatch) {
    console.log('\n=== Sidebar Menu Items ===');
    const items = sidebarMatch[0].match(/data-section="[^"]+"/g);
    if (items) items.forEach(i => console.log(i));
  }
  
  console.log('\nFile length:', content.length, 'chars');
}

main().catch(console.error);
