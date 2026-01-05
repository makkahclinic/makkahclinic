/**
 * نظام إدارة صلاحيات ومتابعة خدمة مراجعة التأمين الطبي
 * مجمع مكة الطبي بالزاهر
 * 
 * Google Sheet ID: 1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk
 * Drive Folder ID: 18NsJAyzWXEuopa-ZfSyYXRWSFxENV9g4
 * 
 * الأوراق المطلوبة في Google Sheet:
 * 1. InsurancePermissions - صلاحيات الوصول للموظفين
 * 2. InsuranceUsageLog - سجل استخدام الخدمة
 * 3. DoctorStats - إحصائيات الأطباء التراكمية
 */

const SHEET_ID = '1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk';
const DRIVE_FOLDER_ID = '18NsJAyzWXEuopa-ZfSyYXRWSFxENV9g4';

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
    
    // حفظ التقرير كملف HTML
    const timestamp = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd_HHmm');
    const fileName = 'تقرير_' + timestamp + '.html';
    
    const htmlContent = params.reportHtml || '<html><body>No content</body></html>';
    const file = doctorFolder.createFile(fileName, htmlContent, MimeType.HTML);
    
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
