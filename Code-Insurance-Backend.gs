/**
 * نظام إدارة صلاحيات ومتابعة خدمة مراجعة التأمين الطبي
 * مجمع مكة الطبي بالزاهر
 * 
 * Google Sheet ID: 1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk
 * Drive Folder ID: 18NsJAyzWXEuopa-ZfSyYXRWSFxENV9g4
 * Tasks Folder ID: 1ofHpYL2t29PHGO_Cv24HAKnKyYg0CQxz
 * 
 * الأوراق المطلوبة في Google Sheet:
 * 1. InsurancePermissions - صلاحيات الوصول للموظفين
 * 2. InsuranceUsageLog - سجل استخدام الخدمة
 * 3. DoctorStats - إحصائيات الأطباء التراكمية
 * 4. Tasks - نظام المهام والتسليمات
 */

const SHEET_ID = '1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk';
const DRIVE_FOLDER_ID = '18NsJAyzWXEuopa-ZfSyYXRWSFxENV9g4';
const TASKS_FOLDER_ID = '1ofHpYL2t29PHGO_Cv24HAKnKyYg0CQxz';

// قائمة المالكين المصرح لهم بإدارة الصلاحيات
const OWNER_EMAILS = [
  'dr.mansour2012@hotmail.com',
  'owner@m2020m.org',
  'husseinbabsail@gmail.com'
];

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    let params = {};
    
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      params = e.parameter;
    }
    
    const action = params.action || e.parameter.action;
    let result;
    
    switch(action) {
      case 'checkPermission':
        result = checkInsurancePermission(params.email);
        break;
      case 'getPermissions':
      case 'getAuthorizedUsers':
        result = getAllInsurancePermissions();
        break;
      case 'addPermission':
      case 'addAuthorizedUser':
        result = addInsurancePermission(params.email, params.name, params.department || params.dept);
        break;
      case 'removePermission':
      case 'removeAuthorizedUser':
        result = removeInsurancePermission(params.email);
        break;
      case 'logUsage':
        result = logInsuranceUsage(params);
        break;
      case 'getUsageLog':
        result = getUsageLog(params.email);
        break;
      case 'getDoctorStats':
        result = getDoctorStats();
        break;
      case 'updateDoctorRating':
        result = updateDoctorRating(params.doctorName, params.insuranceRating, params.serviceRating);
        break;
      case 'saveReport':
        result = saveReportToDrive(params);
        break;
      case 'getDashboardStats':
        result = getDashboardStats(params.email);
        break;
      case 'getDoctorsList':
        result = getDoctorsList();
        break;
      case 'logUsageAndSavePDF':
        result = logUsageAndSavePDF(params);
        break;
      case 'logUsageAndSaveHTML':
        result = logUsageAndSaveHTML(params);
        break;
      // ============================================
      // نظام إدارة المهام والتوقيعات - NEW
      // ============================================
      case 'createTask':
        result = createTask_(params);
        break;
      case 'getTasks':
        result = getTasks_();
        break;
      case 'getTaskFile':
        result = getTaskFile_(params);
        break;
      case 'updateTaskStatus':
        result = updateTaskStatus_(params);
        break;
      case 'saveTaskReport':
        result = saveTaskReport_(params);
        break;
      case 'confirmDelivery':
        result = confirmDelivery_(params);
        break;
      case 'getDeliveryLog':
        result = getDeliveryLog_();
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
    
    output.setContent(JSON.stringify(result));
    
  } catch(error) {
    output.setContent(JSON.stringify({ 
      success: false, 
      error: error.toString() 
    }));
  }
  
  return output;
}

/**
 * التحقق من أن البريد الإلكتروني هو مالك
 */
function isOwnerEmail(email) {
  if (!email) return false;
  return OWNER_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}

/**
 * إنشاء الأوراق المطلوبة إذا لم تكن موجودة
 */
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // ورقة الصلاحيات
  let permSheet = ss.getSheetByName('InsurancePermissions');
  if (!permSheet) {
    permSheet = ss.insertSheet('InsurancePermissions');
    permSheet.appendRow(['email', 'name', 'department', 'addedDate', 'addedBy', 'active']);
    permSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
  
  // ورقة سجل الاستخدام
  let logSheet = ss.getSheetByName('InsuranceUsageLog');
  if (!logSheet) {
    logSheet = ss.insertSheet('InsuranceUsageLog');
    logSheet.appendRow([
      'timestamp', 'userEmail', 'userName', 'doctorName', 'caseType',
      'filesCount', 'insuranceRating', 'serviceRating', 'overallRating',
      'reportLink', 'notes'
    ]);
    logSheet.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
  
  // ورقة إحصائيات الأطباء
  let statsSheet = ss.getSheetByName('DoctorStats');
  if (!statsSheet) {
    statsSheet = ss.insertSheet('DoctorStats');
    statsSheet.appendRow([
      'doctorName', 'totalCases', 'avgInsuranceRating', 'avgServiceRating',
      'avgOverallRating', 'lastCaseDate', 'folderLink', 'status'
    ]);
    statsSheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
  
  // ورقة المهام - NEW
  let tasksSheet = ss.getSheetByName('Tasks');
  if (!tasksSheet) {
    tasksSheet = ss.insertSheet('Tasks');
    tasksSheet.appendRow([
      'ID', 'الطبيب', 'اسم الملف', 'رافع الملف', 'إيميل الرافع', 
      'تاريخ الرفع', 'الحالة', 'المحلل', 'تاريخ التحليل', 
      'تاريخ التسليم', 'التوقيع', 'رابط الملف', 'بيانات الملف'
    ]);
    tasksSheet.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
  }
  
  return { success: true, message: 'تم إعداد الأوراق بنجاح' };
}

/**
 * التحقق من صلاحية الموظف للوصول لخدمة التأمين
 */
function checkInsurancePermission(email) {
  if (!email) {
    return { success: false, hasPermission: false, error: 'البريد الإلكتروني مطلوب' };
  }
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('InsurancePermissions');
  
  if (!sheet) {
    setupSheets();
    sheet = ss.getSheetByName('InsurancePermissions');
  }
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === email.toLowerCase() && data[i][5] === true) {
      return { 
        success: true, 
        hasPermission: true,
        user: {
          email: data[i][0],
          name: data[i][1],
          department: data[i][2]
        }
      };
    }
  }
  
  return { success: true, hasPermission: false };
}

/**
 * الحصول على جميع الصلاحيات (للمالك)
 */
function getAllInsurancePermissions() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('InsurancePermissions');
  
  if (!sheet) {
    setupSheets();
    return { success: true, permissions: [] };
  }
  
  const data = sheet.getDataRange().getValues();
  const permissions = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      permissions.push({
        email: data[i][0],
        name: data[i][1],
        department: data[i][2],
        addedDate: data[i][3] ? Utilities.formatDate(new Date(data[i][3]), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm') : '',
        addedBy: data[i][4],
        active: data[i][5] === true || data[i][5] === 'TRUE'
      });
    }
  }
  
  return { success: true, permissions: permissions, users: permissions };
}

/**
 * إضافة صلاحية لموظف
 */
function addInsurancePermission(email, name, department) {
  if (!email || !name) {
    return { success: false, error: 'البريد الإلكتروني والاسم مطلوبان' };
  }
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName('InsurancePermissions');
  
  if (!sheet) {
    setupSheets();
    sheet = ss.getSheetByName('InsurancePermissions');
  }
  
  // التحقق من عدم وجود الموظف مسبقاً
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === email.toLowerCase()) {
      // تحديث الموظف الموجود
      sheet.getRange(i + 1, 6).setValue(true);
      return { success: true, message: 'تم تفعيل صلاحية الموظف' };
    }
  }
  
  // إضافة موظف جديد
  sheet.appendRow([
    email,
    name,
    department || '',
    new Date(),
    Session.getActiveUser().getEmail() || 'owner',
    true
  ]);
  
  // إنشاء مجلد خاص للموظف
  createUserFolder(name, email);
  
  return { success: true, message: 'تم إضافة صلاحية الموظف بنجاح' };
}

/**
 * إزالة صلاحية موظف
 */
function removeInsurancePermission(email) {
  if (!email) {
    return { success: false, error: 'البريد الإلكتروني مطلوب' };
  }
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('InsurancePermissions');
  
  if (!sheet) {
    return { success: false, error: 'ورقة الصلاحيات غير موجودة' };
  }
  
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 1, 6).setValue(false);
      return { success: true, message: 'تم إلغاء صلاحية الموظف' };
    }
  }
  
  return { success: false, error: 'الموظف غير موجود' };
}

/**
 * إنشاء مجلد خاص للموظف
 */
function createUserFolder(name, email) {
  try {
    const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const folderName = name + ' - ' + email.split('@')[0];
    
    // التحقق من عدم وجود المجلد
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next().getUrl();
    }
    
    const newFolder = parentFolder.createFolder(folderName);
    return newFolder.getUrl();
  } catch(e) {
    Logger.log('Error creating folder: ' + e);
    return null;
  }
}

/**
 * تسجيل استخدام الخدمة
 */
function logInsuranceUsage(params) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let logSheet = ss.getSheetByName('InsuranceUsageLog');
  
  if (!logSheet) {
    setupSheets();
    logSheet = ss.getSheetByName('InsuranceUsageLog');
  }
  
  const timestamp = new Date();
  const insuranceRating = parseFloat(params.insuranceRating) || 0;
  const serviceRating = parseFloat(params.serviceRating) || 0;
  const overallRating = ((insuranceRating + serviceRating) / 2).toFixed(1);
  
  logSheet.appendRow([
    timestamp,
    params.userEmail || '',
    params.userName || '',
    params.doctorName || '',
    params.caseType || '',
    params.filesCount || 0,
    insuranceRating,
    serviceRating,
    overallRating,
    params.reportLink || '',
    params.notes || ''
  ]);
  
  // تحديث إحصائيات الطبيب
  updateDoctorStats(params.doctorName, insuranceRating, serviceRating, params.reportLink);
  
  return { success: true, message: 'تم تسجيل الاستخدام بنجاح' };
}

/**
 * تحديث إحصائيات الطبيب
 */
function updateDoctorStats(doctorName, insuranceRating, serviceRating, reportLink) {
  if (!doctorName) return;
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let statsSheet = ss.getSheetByName('DoctorStats');
  
  if (!statsSheet) {
    setupSheets();
    statsSheet = ss.getSheetByName('DoctorStats');
  }
  
  const data = statsSheet.getDataRange().getValues();
  let doctorRow = -1;
  
  // البحث عن الطبيب
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().toLowerCase() === doctorName.toLowerCase()) {
      doctorRow = i + 1;
      break;
    }
  }
  
  const timestamp = new Date();
  const formattedDate = Utilities.formatDate(timestamp, 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
  
  if (doctorRow > 0) {
    // تحديث الطبيب الموجود
    const currentCases = parseInt(data[doctorRow - 1][1]) || 0;
    const currentInsRating = parseFloat(data[doctorRow - 1][2]) || 0;
    const currentSvcRating = parseFloat(data[doctorRow - 1][3]) || 0;
    
    const newCases = currentCases + 1;
    const newInsRating = ((currentInsRating * currentCases + insuranceRating) / newCases).toFixed(1);
    const newSvcRating = ((currentSvcRating * currentCases + serviceRating) / newCases).toFixed(1);
    const newOverall = ((parseFloat(newInsRating) + parseFloat(newSvcRating)) / 2).toFixed(1);
    
    // تحديد الحالة بناءً على التقييم
    let status = 'ممتاز';
    if (newOverall < 5) status = 'يحتاج تحسين';
    else if (newOverall < 7) status = 'جيد';
    else if (newOverall < 9) status = 'جيد جداً';
    
    statsSheet.getRange(doctorRow, 2).setValue(newCases);
    statsSheet.getRange(doctorRow, 3).setValue(newInsRating);
    statsSheet.getRange(doctorRow, 4).setValue(newSvcRating);
    statsSheet.getRange(doctorRow, 5).setValue(newOverall);
    statsSheet.getRange(doctorRow, 6).setValue(formattedDate);
    statsSheet.getRange(doctorRow, 8).setValue(status);
    
  } else {
    // إضافة طبيب جديد
    const overallRating = ((insuranceRating + serviceRating) / 2).toFixed(1);
    let status = 'ممتاز';
    if (overallRating < 5) status = 'يحتاج تحسين';
    else if (overallRating < 7) status = 'جيد';
    else if (overallRating < 9) status = 'جيد جداً';
    
    // إنشاء مجلد للطبيب
    const folderUrl = createDoctorFolder(doctorName);
    
    statsSheet.appendRow([
      doctorName,
      1,
      insuranceRating,
      serviceRating,
      overallRating,
      formattedDate,
      folderUrl || '',
      status
    ]);
  }
}

/**
 * إنشاء مجلد للطبيب
 */
function createDoctorFolder(doctorName) {
  try {
    const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const folderName = 'د. ' + doctorName;
    
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next().getUrl();
    }
    
    const newFolder = parentFolder.createFolder(folderName);
    return newFolder.getUrl();
  } catch(e) {
    Logger.log('Error creating doctor folder: ' + e);
    return null;
  }
}

/**
 * الحصول على سجل الاستخدام
 */
function getUsageLog(email) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const logSheet = ss.getSheetByName('InsuranceUsageLog');
  
  if (!logSheet) {
    return { success: true, logs: [] };
  }
  
  const data = logSheet.getDataRange().getValues();
  const logs = [];
  
  for (let i = 1; i < data.length; i++) {
    if (!email || data[i][1].toString().toLowerCase() === email.toLowerCase()) {
      logs.push({
        timestamp: data[i][0] ? Utilities.formatDate(new Date(data[i][0]), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm') : '',
        userEmail: data[i][1],
        userName: data[i][2],
        doctorName: data[i][3],
        caseType: data[i][4],
        filesCount: data[i][5],
        insuranceRating: data[i][6],
        serviceRating: data[i][7],
        overallRating: data[i][8],
        reportLink: data[i][9],
        notes: data[i][10]
      });
    }
  }
  
  return { success: true, logs: logs.reverse() };
}

/**
 * الحصول على إحصائيات الأطباء
 */
function getDoctorStats() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const statsSheet = ss.getSheetByName('DoctorStats');
  
  if (!statsSheet) {
    return { success: true, doctors: [] };
  }
  
  const data = statsSheet.getDataRange().getValues();
  const doctors = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      doctors.push({
        doctorName: data[i][0],
        totalCases: data[i][1],
        avgInsuranceRating: data[i][2],
        avgServiceRating: data[i][3],
        avgOverallRating: data[i][4],
        lastCaseDate: data[i][5],
        folderLink: data[i][6],
        status: data[i][7]
      });
    }
  }
  
  // ترتيب حسب عدد الحالات تنازلياً
  doctors.sort((a, b) => b.totalCases - a.totalCases);
  
  return { success: true, doctors: doctors };
}

/**
 * حفظ التقرير في Drive
 */
function saveReportToDrive(params) {
  try {
    const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    
    // البحث أو إنشاء مجلد الطبيب
    const doctorFolderName = 'د. ' + (params.doctorName || 'غير محدد');
    let doctorFolder;
    
    const folders = parentFolder.getFoldersByName(doctorFolderName);
    if (folders.hasNext()) {
      doctorFolder = folders.next();
    } else {
      doctorFolder = parentFolder.createFolder(doctorFolderName);
    }
    
    // حفظ التقرير كملف HTML مع بنية كاملة
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd_HHmm');
    const fileName = 'تقرير_' + timestamp + '.html';
    
    const reportBody = params.reportHtml || '<p>No content</p>';
    
    // إنشاء HTML كامل مع CSS
    const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير مراجعة جودة الرعاية الطبية - ${params.doctorName || 'غير محدد'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Tajawal', sans-serif; background: #f8fafc; padding: 20px; direction: rtl; }
    .print-header { display: flex; align-items: center; justify-content: space-between; padding: 20px; background: linear-gradient(135deg, #1e3a5f, #2d4a6f); border-radius: 12px; margin-bottom: 20px; color: white; }
    .print-header img { width: 80px; height: 80px; border-radius: 50%; border: 3px solid #c9a962; background: white; }
    .print-header-text h1 { color: #c9a962; font-size: 1.4rem; margin-bottom: 5px; }
    .print-header-text p { font-size: 0.9rem; opacity: 0.9; }
    .print-header-dates { text-align: left; font-size: 0.85rem; }
    .print-footer { margin-top: 30px; padding: 15px; background: #f1f5f9; border-radius: 8px; text-align: center; font-size: 0.8rem; color: #64748b; border-top: 3px solid #c9a962; }
    .audit-report { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .audit-report h1 { color: #1e3a5f; font-size: 1.5rem; text-align: center; padding: 15px; border-bottom: 3px solid #c9a962; margin-bottom: 20px; }
    .audit-report h2 { color: #1e3a5f; font-size: 1.2rem; margin-top: 25px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
    .audit-report h3 { color: #334155; font-size: 1rem; margin-top: 15px; }
    .audit-report p, .audit-report li { line-height: 1.9; color: #334155; }
    .audit-report ul { list-style: none; padding: 0; }
    .audit-report li { padding: 12px 15px; margin: 8px 0; border-radius: 8px; border-right: 4px solid #cbd5e1; background: #f8fafc; }
    .success, li:has(.success) { background: #dcfce7 !important; border-right-color: #22c55e !important; }
    .error, li:has(.error) { background: #fee2e2 !important; border-right-color: #ef4444 !important; }
    .warning, li:has(.warning) { background: #fef9c3 !important; border-right-color: #eab308 !important; }
    .info, li:has(.info) { background: #dbeafe !important; border-right-color: #3b82f6 !important; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { padding: 12px; text-align: right; border: 1px solid #e2e8f0; }
    th { background: #1e3a5f; color: white; }
    tr:nth-child(even) { background: #f8fafc; }
    .score-box { text-align: center; padding: 20px; border-radius: 12px; margin: 15px 0; }
    .score-high { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
    .score-medium { background: linear-gradient(135deg, #eab308, #ca8a04); color: white; }
    .score-low { background: linear-gradient(135deg, #ef4444, #dc2626); color: white; }
    .score-value { font-size: 2.5rem; font-weight: bold; }
    @media print { body { background: white; padding: 0; } .audit-report { box-shadow: none; } }
  </style>
</head>
<body>
  ${reportBody}
</body>
</html>`;
    
    const file = doctorFolder.createFile(fileName, fullHtml, MimeType.HTML);
    
    return { 
      success: true, 
      fileUrl: file.getUrl(),
      folderUrl: doctorFolder.getUrl(),
      message: 'تم حفظ التقرير بنجاح' 
    };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * إحصائيات لوحة التحكم
 */
function getDashboardStats(email) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // إحصائيات عامة
  const logSheet = ss.getSheetByName('InsuranceUsageLog');
  const statsSheet = ss.getSheetByName('DoctorStats');
  const permSheet = ss.getSheetByName('InsurancePermissions');
  
  let totalCases = 0;
  let todayCases = 0;
  let userCases = 0;
  let userTodayCases = 0;
  const today = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd');
  
  if (logSheet) {
    const logData = logSheet.getDataRange().getValues();
    for (let i = 1; i < logData.length; i++) {
      if (logData[i][0]) {
        totalCases++;
        const logDate = Utilities.formatDate(new Date(logData[i][0]), 'Asia/Riyadh', 'yyyy-MM-dd');
        if (logDate === today) todayCases++;
        
        if (email && logData[i][1].toString().toLowerCase() === email.toLowerCase()) {
          userCases++;
          if (logDate === today) userTodayCases++;
        }
      }
    }
  }
  
  let totalDoctors = 0;
  if (statsSheet) {
    const statsData = statsSheet.getDataRange().getValues();
    totalDoctors = statsData.length - 1;
  }
  
  let totalStaff = 0;
  if (permSheet) {
    const permData = permSheet.getDataRange().getValues();
    for (let i = 1; i < permData.length; i++) {
      if (permData[i][5] === true) totalStaff++;
    }
  }
  
  return {
    success: true,
    stats: {
      totalCases: totalCases,
      todayCases: todayCases,
      totalDoctors: totalDoctors,
      totalStaff: totalStaff,
      userCases: userCases,
      userTodayCases: userTodayCases
    }
  };
}

/**
 * الحصول على قائمة الأطباء من شيت Staff
 */
function getDoctorsList() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName('Staff');
    
    if (!sheet) {
      return { success: true, doctors: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    const doctors = [];
    
    for (let i = 1; i < data.length; i++) {
      const name = data[i][0]; // العمود A - الاسم
      const specialty = data[i][1]; // العمود B - التخصص
      if (name && name.toString().trim()) {
        doctors.push({ 
          name: name.toString().trim(), 
          specialty: specialty ? specialty.toString().trim() : '' 
        });
      }
    }
    
    return { success: true, doctors: doctors };
  } catch(e) {
    return { success: false, error: e.toString(), doctors: [] };
  }
}

// ============================================
// نظام إدارة المهام والتوقيعات الإلكترونية
// ============================================

/**
 * إنشاء مهمة جديدة
 */
function createTask_(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let tasksSheet = ss.getSheetByName('Tasks');
    
    // إنشاء الشيت إذا لم يكن موجوداً
    if (!tasksSheet) {
      tasksSheet = ss.insertSheet('Tasks');
      tasksSheet.appendRow([
        'ID', 'الطبيب', 'اسم الملف', 'رافع الملف', 'إيميل الرافع', 
        'تاريخ الرفع', 'الحالة', 'المحلل', 'تاريخ التحليل', 
        'تاريخ التسليم', 'التوقيع', 'رابط الملف', 'بيانات الملف'
      ]);
      tasksSheet.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#1e3a5f').setFontColor('white');
    }
    
    const taskId = Utilities.getUuid();
    const uploadDate = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm');
    
    // حفظ الملف في Drive - هذا إلزامي للحصول على البيانات الكاملة
    let fileUrl = '';
    try {
      const folder = DriveApp.getFolderById(TASKS_FOLDER_ID);
      const fileBlob = Utilities.newBlob(
        Utilities.base64Decode(data.fileData), 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        data.fileName
      );
      const file = folder.createFile(fileBlob);
      fileUrl = file.getUrl();
      Logger.log('File saved to Drive: ' + fileUrl);
    } catch(e) {
      Logger.log('CRITICAL: Could not save to Drive: ' + e.message);
      return { success: false, error: 'فشل في حفظ الملف في Drive: ' + e.message };
    }
    
    // تأكد من أن الملف حُفظ في Drive
    if (!fileUrl || fileUrl.length < 10) {
      return { success: false, error: 'فشل في الحصول على رابط الملف من Drive' };
    }
    
    // إضافة المهمة للشيت - لا نحفظ بيانات الملف في الخلية لأنها تُقطع!
    // الملف يُحفظ في Drive فقط ويُقرأ من هناك
    tasksSheet.appendRow([
      taskId,
      data.doctorName || '',
      data.fileName || '',
      data.uploadedBy || '',
      data.uploadedByEmail || '',
      uploadDate,
      'pending',
      '',
      '',
      '',
      '',
      fileUrl,
      'FILE_IN_DRIVE' // علامة أن الملف في Drive وليس هنا
    ]);
    
    return { success: true, taskId: taskId };
  } catch(e) {
    Logger.log('createTask error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * جلب المهام المعلقة
 */
function getTasks_() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: true, tasks: [] };
    }
    
    const data = tasksSheet.getDataRange().getValues();
    const tasks = [];
    
    for (let i = 1; i < data.length; i++) {
      // جلب المهام غير المسلمة فقط
      if (data[i][6] !== 'delivered') {
        tasks.push({
          id: data[i][0],
          doctorName: data[i][1],
          fileName: data[i][2],
          uploadedBy: data[i][3],
          uploadDate: data[i][5],
          status: data[i][6],
          analyzedBy: data[i][7],
          fileUrl: data[i][11],
          reportHtml: data[i][13] || '', // Column 14 (index 13) - saved report
          rowIndex: i + 1
        });
      }
    }
    
    return { success: true, tasks: tasks };
  } catch(e) {
    Logger.log('getTasks error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * جلب ملف المهمة - يجب أن يُقرأ من Drive فقط للحصول على البيانات الكاملة
 */
function getTaskFile_(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        const fileUrl = allData[i][11]; // رابط الملف في Drive
        const fileName = allData[i][2];
        
        Logger.log('Getting file for task: ' + data.taskId);
        Logger.log('File URL: ' + fileUrl);
        Logger.log('File name: ' + fileName);
        
        // يجب قراءة الملف من Drive للحصول على البيانات الكاملة (بما فيها الأسعار)
        if (fileUrl && fileUrl.length > 10) {
          try {
            // استخراج File ID من الرابط
            let fileId = null;
            
            // محاولة استخراج ID من رابط Google Drive
            const fileIdMatch = fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
            if (fileIdMatch && fileIdMatch[1]) {
              fileId = fileIdMatch[1];
            } else {
              // محاولة استخراج من رابط open?id=
              const openIdMatch = fileUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
              if (openIdMatch && openIdMatch[1]) {
                fileId = openIdMatch[1];
              }
            }
            
            if (fileId) {
              const file = DriveApp.getFileById(fileId);
              const blob = file.getBlob();
              const bytes = blob.getBytes();
              const base64Data = Utilities.base64Encode(bytes);
              
              Logger.log('SUCCESS: File loaded from Drive: ' + fileName);
              Logger.log('File size: ' + bytes.length + ' bytes');
              Logger.log('Base64 length: ' + base64Data.length + ' chars');
              
              return { 
                success: true, 
                fileData: base64Data,
                fileName: fileName,
                fileSize: bytes.length,
                source: 'drive'
              };
            } else {
              Logger.log('ERROR: Could not extract file ID from URL: ' + fileUrl);
            }
          } catch(driveError) {
            Logger.log('ERROR: Drive read failed: ' + driveError.toString());
            return { success: false, error: 'فشل في قراءة الملف من Drive: ' + driveError.message };
          }
        }
        
        // لا نستخدم بيانات الخلية أبداً - الملفات يجب أن تُقرأ من Drive فقط
        Logger.log('ERROR: No valid Drive URL found for task');
        return { success: false, error: 'لم يتم العثور على رابط الملف في Drive. يرجى إعادة رفع الملف.' };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    Logger.log('getTaskFile error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * تحديث حالة المهمة
 */
function updateTaskStatus_(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        tasksSheet.getRange(i + 1, 7).setValue(data.status);
        
        if (data.status === 'analyzed' || data.status === 'analyzing') {
          if (data.analyzedBy) {
            tasksSheet.getRange(i + 1, 8).setValue(data.analyzedBy);
            tasksSheet.getRange(i + 1, 9).setValue(Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm'));
          }
        }
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    Logger.log('updateTaskStatus error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * حفظ التقرير بعد التحليل
 */
function saveTaskReport_(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        // Update status to analyzed
        tasksSheet.getRange(i + 1, 7).setValue('analyzed');
        
        // Save analyzed by and date
        if (data.analyzedBy) {
          tasksSheet.getRange(i + 1, 8).setValue(data.analyzedBy);
          tasksSheet.getRange(i + 1, 9).setValue(Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm'));
        }
        
        // Save report HTML in column 14 (index 13)
        if (data.reportHtml) {
          // Compress report if too large (Google Sheets cell limit is ~50000 chars)
          let reportToSave = data.reportHtml;
          if (reportToSave.length > 45000) {
            reportToSave = reportToSave.substring(0, 45000) + '<!-- تم اقتطاع التقرير -->';
          }
          tasksSheet.getRange(i + 1, 14).setValue(reportToSave);
        }
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    Logger.log('saveTaskReport error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * تأكيد التسليم مع التوقيع
 */
function confirmDelivery_(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        tasksSheet.getRange(i + 1, 7).setValue('delivered');
        tasksSheet.getRange(i + 1, 10).setValue(Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd HH:mm'));
        
        // حفظ التوقيع كاملاً - base64 يعمل مباشرة في img src
        let signatureToSave = data.signature || '';
        Logger.log('Signature length: ' + signatureToSave.length);
        
        tasksSheet.getRange(i + 1, 11).setValue(signatureToSave);
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    Logger.log('confirmDelivery error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * جلب سجل التسليمات
 */
function getDeliveryLog_() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: true, logs: [] };
    }
    
    const data = tasksSheet.getDataRange().getValues();
    const logs = [];
    
    for (let i = 1; i < data.length; i++) {
      logs.push({
        id: data[i][0],
        doctorName: data[i][1],
        fileName: data[i][2],
        uploadedBy: data[i][3],
        uploadDate: data[i][5],
        status: data[i][6],
        analyzedBy: data[i][7] || '-',
        analysisDate: data[i][8] || '-',
        deliveryDate: data[i][9] || '-',
        signature: data[i][10] || ''
      });
    }
    
    logs.reverse();
    
    return { success: true, logs: logs };
  } catch(e) {
    Logger.log('getDeliveryLog error: ' + e);
    return { success: false, error: e.toString() };
  }
}

/**
 * تسجيل الاستخدام وحفظ HTML
 */
function logUsageAndSaveHTML(params) {
  try {
    // تسجيل الاستخدام
    logInsuranceUsage(params);
    
    // حفظ التقرير
    const saveResult = saveReportToDrive(params);
    
    if (saveResult.success) {
      return {
        success: true,
        message: 'تم التسجيل والحفظ بنجاح',
        reportLink: saveResult.fileUrl
      };
    } else {
      return {
        success: true,
        message: 'تم التسجيل لكن فشل الحفظ في Drive',
        reportLink: '',
        error: saveResult.error
      };
    }
  } catch(error) {
    Logger.log('❌ خطأ في logUsageAndSaveHTML: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

/**
 * تسجيل الاستخدام وحفظ PDF
 */
function logUsageAndSavePDF(params) {
  return logUsageAndSaveHTML(params);
}

/**
 * اختبار الإعداد
 */
function testSetup() {
  const result = setupSheets();
  Logger.log(result);
  
  // إضافة مالك افتراضي
  addInsurancePermission('owner@m2020m.org', 'المالك', 'الإدارة');
  Logger.log('Setup complete!');
}
