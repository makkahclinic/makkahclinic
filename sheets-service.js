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
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
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

  const accessToken = connectionSettings?.settings?.access_token || 
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected. Please reconnect in Replit settings.');
  }
  return accessToken;
}

export async function getGoogleSheetsClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

const SPREADSHEET_ID = '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc';

export async function getSheetData(sheetName, range = '') {
  const sheets = await getGoogleSheetsClient();
  const fullRange = range ? `${sheetName}!${range}` : sheetName;
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: fullRange,
  });
  
  return response.data.values || [];
}

export async function appendRow(sheetName, values) {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values]
    }
  });
  
  return response.data;
}

export async function updateCell(sheetName, range, value) {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${range}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]]
    }
  });
  
  return response.data;
}

export async function getSheetNames() {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  
  return response.data.sheets.map(s => s.properties.title);
}

export async function createSheet(sheetName) {
  const sheets = await getGoogleSheetsClient();
  
  try {
    const response = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: { title: sheetName }
          }
        }]
      }
    });
    return response.data;
  } catch (err) {
    if (err.message.includes('already exists')) {
      return { exists: true };
    }
    throw err;
  }
}

export async function batchUpdate(sheetName, values) {
  const sheets = await getGoogleSheetsClient();
  
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
  
  return response.data;
}

export async function updateRowByIndex(sheetName, rowIndex, columnIndex, value) {
  const sheets = await getGoogleSheetsClient();
  
  const colLetter = String.fromCharCode(65 + columnIndex);
  const range = `${sheetName}!${colLetter}${rowIndex + 1}`;
  
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] }
  });
  
  return response.data;
}

export async function findAndUpdateRow(sheetName, matchColumn, matchValue, updateColumn, updateValue) {
  const sheets = await getGoogleSheetsClient();
  
  const data = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName
  });
  
  const rows = data.data.values || [];
  if (rows.length === 0) return null;
  
  const headers = rows[0];
  const matchColIndex = headers.indexOf(matchColumn);
  const updateColIndex = headers.indexOf(updateColumn);
  
  if (matchColIndex === -1 || updateColIndex === -1) {
    throw new Error(`Column not found: ${matchColumn} or ${updateColumn}`);
  }
  
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][matchColIndex] === matchValue) {
      const colLetter = String.fromCharCode(65 + updateColIndex);
      const range = `${sheetName}!${colLetter}${i + 1}`;
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[updateValue]] }
      });
      
      return { updated: true, row: i + 1 };
    }
  }
  
  return { updated: false };
}
