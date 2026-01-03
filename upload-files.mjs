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

async function uploadFile(octokit, owner, repo, localPath, remotePath, message) {
  const content = fs.readFileSync(localPath, 'utf8');
  const contentBase64 = Buffer.from(content).toString('base64');
  
  let sha;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: remotePath });
    sha = data.sha;
  } catch (e) {}
  
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path: remotePath, message, content: contentBase64, sha
  });
  console.log('Uploaded:', remotePath);
}

async function main() {
  const octokit = new Octokit({ auth: await getAccessToken() });
  const owner = 'makkahclinic';
  const repo = 'makkahclinic';
  
  // Upload needle stick form
  await uploadFile(octokit, owner, repo, 
    './github-deploy/ipc/incidents/report-needlestick.html',
    'ipc/incidents/report-needlestick.html',
    'تطوير فورم الوخز الإبري: إضافة عمق الجرح + سنوات الخبرة + تطعيم HBV + رابط لوحة التحليل'
  );
  
  console.log('Done!');
}

main().catch(console.error);
