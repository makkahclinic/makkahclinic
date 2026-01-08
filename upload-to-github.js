import { Octokit } from '@octokit/rest';
import fs from 'fs';

let connectionSettings;

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

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function uploadToGitHub() {
  try {
    const accessToken = await getAccessToken();
    const octokit = new Octokit({ auth: accessToken });
    
    const fileContent = fs.readFileSync('github-deploy/apps-script/InsuranceFullScript.gs', 'utf8');
    const encodedContent = Buffer.from(fileContent).toString('base64');
    
    const owner = 'makkahclinic';
    const repo = 'makkahclinic';
    const path = 'apps-script/InsuranceFullScript.gs';
    
    let sha = null;
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path });
      sha = data.sha;
      console.log('File exists, will update. SHA:', sha);
    } catch (e) {
      console.log('File does not exist, will create new');
    }
    
    const response = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: 'Add Insurance Tasks Apps Script - نظام إدارة مهام التدقيق التأميني',
      content: encodedContent,
      sha: sha
    });
    
    console.log('SUCCESS! File uploaded to GitHub');
    console.log('URL:', response.data.content.html_url);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

uploadToGitHub();
