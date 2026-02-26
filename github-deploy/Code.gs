var SHEET_ID = '12Pw7s6fT4Qd3fZHZUcsJE79JuYnIzwk6vr69Uv-pFEg';
var DRIVE_FOLDER_ID = '1NuhHv_8rnCZghPxmW6YUPrSOn9IkRDsh';
var UPLOAD_PASSWORD = 'Makkah3026';
var SHEET_NAME = 'Files';

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  
  try {
    if (action === 'getFiles') {
      return respond(getFiles(e.parameter.name));
    }
    if (action === 'getAllCounts') {
      return respond(getAllCounts());
    }
    return respond({ success: false, error: 'Invalid action' });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    
    if (data.action === 'uploadFile') {
      if (data.password !== UPLOAD_PASSWORD) {
        return respond({ success: false, error: 'WRONG_PASSWORD' });
      }
      return respond(uploadFile(data));
    }
    
    return respond({ success: false, error: 'Invalid action' });
  } catch (err) {
    return respond({ success: false, error: err.message });
  }
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ensureSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['staffName', 'fileName', 'uploadDate', 'fileUrl', 'fileId', 'fileSize', 'mimeType']);
    sheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  return sheet;
}

function ensureStaffFolder(staffName) {
  var parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var folders = parentFolder.getFoldersByName(staffName);
  if (folders.hasNext()) {
    return folders.next();
  }
  return parentFolder.createFolder(staffName);
}

function uploadFile(data) {
  var staffName = data.staffName;
  var fileName = data.fileName;
  var mimeType = data.mimeType || 'application/octet-stream';
  var fileData = data.fileData;
  
  var folder = ensureStaffFolder(staffName);
  
  var decoded = Utilities.base64Decode(fileData);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);
  var file = folder.createFile(blob);
  
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  
  var sheet = ensureSheet();
  var now = new Date();
  var dateStr = Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
  var fileSize = (decoded.length / 1024).toFixed(1) + ' KB';
  
  sheet.appendRow([
    staffName,
    fileName,
    dateStr,
    file.getUrl(),
    file.getId(),
    fileSize,
    mimeType
  ]);
  
  return {
    success: true,
    fileUrl: file.getUrl(),
    fileId: file.getId()
  };
}

function getFiles(staffName) {
  if (!staffName) return { success: false, error: 'No name provided' };
  
  var sheet = ensureSheet();
  var data = sheet.getDataRange().getValues();
  var files = [];
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === staffName) {
      files.push({
        fileName: data[i][1],
        uploadDate: data[i][2],
        fileUrl: data[i][3],
        fileId: data[i][4],
        fileSize: data[i][5]
      });
    }
  }
  
  return { success: true, files: files };
}

function getAllCounts() {
  var sheet = ensureSheet();
  var data = sheet.getDataRange().getValues();
  var counts = {};
  
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    if (name) {
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  
  return { success: true, counts: counts };
}
