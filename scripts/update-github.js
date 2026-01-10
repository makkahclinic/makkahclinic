import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

let connectionSettings = null;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
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

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function updateFile() {
  const owner = 'makkahclinic';
  const repo = 'makkahclinic';
  const filePath = 'insurance-check.html';
  const localFile = 'github-deploy/insurance-check.html';
  
  console.log('Reading local file...');
  const content = fs.readFileSync(localFile, 'utf-8');
  const contentBase64 = Buffer.from(content).toString('base64');
  
  console.log('Connecting to GitHub...');
  const octokit = await getUncachableGitHubClient();
  
  console.log('Getting current file SHA...');
  let sha;
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
    });
    sha = data.sha;
    console.log('Current SHA:', sha);
  } catch (error) {
    if (error.status === 404) {
      console.log('File does not exist, will create new');
    } else {
      throw error;
    }
  }
  
  console.log('Updating file on GitHub...');
  const response = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message: 'تحديث نظام التدقيق - إضافة التوصيات الديموغرافية المخصصة',
    content: contentBase64,
    sha: sha,
    branch: 'main'
  });
  
  console.log('File updated successfully!');
  console.log('Commit SHA:', response.data.commit.sha);
  console.log('URL:', response.data.content.html_url);
}

updateFile().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
