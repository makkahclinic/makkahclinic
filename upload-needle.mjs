import { Octokit } from '@octokit/rest';
import fs from 'fs';

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  const connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }
  ).then(res => res.json()).then(data => data.items?.[0]);

  return connectionSettings?.settings?.access_token;
}

async function main() {
  const octokit = new Octokit({ auth: await getAccessToken() });
  const owner = 'makkahclinic';
  const repo = 'makkahclinic';
  const filePath = 'needle_stick_analysis.html';
  
  const content = fs.readFileSync('./github-deploy/needle_stick_analysis.html', 'utf8');
  const contentBase64 = Buffer.from(content).toString('base64');
  
  // Get current SHA
  let sha;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath });
    sha = data.sha;
  } catch (e) {}
  
  const result = await octokit.repos.createOrUpdateFileContents({
    owner, repo, path: filePath,
    message: 'إزالة حماية الباسورد من صفحة الوخز الإبري + تحديث',
    content: contentBase64, sha
  });
  
  console.log('Deployed:', result.data.commit.sha);
}

main().catch(console.error);
