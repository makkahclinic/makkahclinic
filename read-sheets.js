import { google } from 'googleapis';

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
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected');
  }
  return accessToken;
}

async function getGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: 'v4', auth: oauth2Client });
}

async function getDriveClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function listSpreadsheets() {
  const drive = await getDriveClient();
  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet'",
    fields: 'files(id, name)',
    pageSize: 50
  });
  return response.data.files;
}

async function getSheetNames(spreadsheetId) {
  const sheets = await getGoogleSheetClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId
  });
  return response.data.sheets.map(s => s.properties.title);
}

async function readSheet(spreadsheetId, sheetName) {
  const sheets = await getGoogleSheetClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: sheetName
  });
  return response.data.values;
}

const SPREADSHEET_IDS = {
  MAIN: '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc',
  EOC: '1tZeJs7bUELdoGgxxujaeKXSSSXLApPfmis3YrpaAVVA'
};

async function main() {
  console.log('=== قراءة بيانات الأقسام والموظفين ===\n');
  
  const EOC_ID = '1tZeJs7bUELdoGgxxujaeKXSSSXLApPfmis3YrpaAVVA';
  
  const sheetsToRead = ['EOC_DEPARTMENTS', 'Staff', 'Rooms', 'EOC_READINESS'];
  
  for (const sheetName of sheetsToRead) {
    console.log(`\n📋 ${sheetName}:`);
    console.log('─'.repeat(50));
    try {
      const data = await readSheet(EOC_ID, sheetName);
      if (data && data.length > 0) {
        console.log(`الأعمدة: ${data[0].join(' | ')}`);
        console.log(`عدد الصفوف: ${data.length - 1}`);
        console.log('\nالبيانات:');
        data.slice(1, 20).forEach((row, i) => {
          console.log(`  ${i+1}. ${row.join(' | ')}`);
        });
      } else {
        console.log('لا توجد بيانات');
      }
    } catch (e) {
      console.log('خطأ:', e.message);
    }
  }
}

main().catch(console.error);
