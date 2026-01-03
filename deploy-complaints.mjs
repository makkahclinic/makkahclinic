import { Octokit } from '@octokit/rest';
import fs from 'fs';

let connectionSettings;

async function getAccessToken() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

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
  if (!accessToken) throw new Error('GitHub not connected');
  return accessToken;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  const owner = 'makkahclinic';
  const repo = 'm2020m.org';
  const path = 'Code-Complaints.gs';
  
  const content = fs.readFileSync('./github-deploy/Code-Complaints.gs', 'utf8');
  const contentBase64 = Buffer.from(content).toString('base64');
  
  let sha;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    sha = data.sha;
    console.log('Found existing file, SHA:', sha);
  } catch (e) {
    console.log('File not found, creating new');
  }
  
  const result = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: 'إضافة حقول الإغلاق (closedBy, resolutionDate, resolution) في getComplaints',
    content: contentBase64,
    sha
  });
  
  console.log('Deployed successfully!', result.data.commit.sha);
}

main().catch(console.error);
