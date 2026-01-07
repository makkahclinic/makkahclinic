/**
 * ============================================
 * نظام إدارة المهام والتوقيعات الإلكترونية
 * مجمع مكة الطبي - وحدة التأمين
 * ============================================
 * 
 * هذا الكود يُضاف إلى ملف Google Apps Script الخاص بالتأمين
 * 
 * الخطوات:
 * 1. افتح Google Apps Script المرتبط بالـ Spreadsheet
 * 2. أنشئ ملف جديد باسم "TasksManagement" 
 * 3. الصق هذا الكود
 * 4. عدّل SPREADSHEET_ID و TASKS_FOLDER_ID بالقيم الصحيحة
 * 5. أضف الـ cases في doPost
 */

// ============================================
// الإعدادات - عدّل هذه القيم
// ============================================
const TASKS_SPREADSHEET_ID = '1rTGa4WOw1q0IQE7KCS8TtRJ58J0guTbfgcP30cE-EWk'; // معرف الـ Spreadsheet
const TASKS_FOLDER_ID = '1ABC123XYZ'; // معرف مجلد Drive لحفظ ملفات المهام - عدّل هذا!

// ============================================
// أضف هذه الـ cases داخل دالة doPost الموجودة
// ============================================
/*
في دالة doPost، أضف هذه الحالات داخل switch(action):

    case 'createTask':
      result = createTask_(payload);
      break;
    case 'getTasks':
      result = getTasks_();
      break;
    case 'getTaskFile':
      result = getTaskFile_(payload);
      break;
    case 'updateTaskStatus':
      result = updateTaskStatus_(payload);
      break;
    case 'confirmDelivery':
      result = confirmDelivery_(payload);
      break;
    case 'getDeliveryLog':
      result = getDeliveryLog_();
      break;
*/

// ============================================
// دوال إدارة المهام
// ============================================

/**
 * إنشاء مهمة جديدة
 */
function createTask_(data) {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
    let tasksSheet = ss.getSheetByName('Tasks');
    
    // إنشاء الشيت إذا لم يكن موجوداً
    if (!tasksSheet) {
      tasksSheet = ss.insertSheet('Tasks');
      tasksSheet.appendRow([
        'ID', 
        'الطبيب', 
        'اسم الملف', 
        'رافع الملف', 
        'إيميل الرافع', 
        'تاريخ الرفع', 
        'الحالة', 
        'المحلل', 
        'تاريخ التحليل', 
        'تاريخ التسليم', 
        'التوقيع',
        'رابط الملف',
        'بيانات الملف'
      ]);
      // تنسيق الهيدر
      tasksSheet.getRange(1, 1, 1, 13).setBackground('#1e3a5f').setFontColor('#ffffff').setFontWeight('bold');
    }
    
    const taskId = Utilities.getUuid();
    const uploadDate = new Date().toLocaleDateString('ar-SA');
    
    // حفظ الملف في Drive (اختياري - يمكن تخطيه إذا لم يكن المجلد متاحاً)
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
    } catch(e) {
      console.log('Could not save to Drive, storing in sheet:', e.message);
    }
    
    // إضافة المهمة للشيت
    tasksSheet.appendRow([
      taskId,
      data.doctorName,
      data.fileName,
      data.uploadedBy,
      data.uploadedByEmail || '',
      uploadDate,
      'pending',
      '',
      '',
      '',
      '',
      fileUrl,
      data.fileData // حفظ البيانات في الشيت كـ backup
    ]);
    
    return { success: true, taskId: taskId };
  } catch(e) {
    console.error('createTask error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * جلب المهام المعلقة (غير المسلمة)
 */
function getTasks_() {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
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
          rowIndex: i + 1 // للتحديث لاحقاً
        });
      }
    }
    
    return { success: true, tasks: tasks };
  } catch(e) {
    console.error('getTasks error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * جلب ملف المهمة
 */
function getTaskFile_(data) {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        // إرجاع بيانات الملف المحفوظة
        return { 
          success: true, 
          fileData: allData[i][12], // العمود 13 = بيانات الملف
          fileName: allData[i][2]
        };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    console.error('getTaskFile error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * تحديث حالة المهمة
 */
function updateTaskStatus_(data) {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        // تحديث الحالة (العمود 7)
        tasksSheet.getRange(i + 1, 7).setValue(data.status);
        
        // إذا كان التحديث للتحليل، سجل المحلل والتاريخ
        if (data.status === 'analyzed' || data.status === 'analyzing') {
          if (data.analyzedBy) {
            tasksSheet.getRange(i + 1, 8).setValue(data.analyzedBy); // المحلل
            tasksSheet.getRange(i + 1, 9).setValue(new Date().toLocaleDateString('ar-SA')); // تاريخ التحليل
          }
        }
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    console.error('updateTaskStatus error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * تأكيد التسليم مع التوقيع الإلكتروني
 */
function confirmDelivery_(data) {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
    const tasksSheet = ss.getSheetByName('Tasks');
    
    if (!tasksSheet) {
      return { success: false, error: 'Tasks sheet not found' };
    }
    
    const allData = tasksSheet.getDataRange().getValues();
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][0] === data.taskId) {
        // تحديث الحالة إلى "مسلّم"
        tasksSheet.getRange(i + 1, 7).setValue('delivered');
        
        // تسجيل تاريخ التسليم
        tasksSheet.getRange(i + 1, 10).setValue(new Date().toLocaleDateString('ar-SA'));
        
        // حفظ التوقيع (أول 1000 حرف للحفاظ على حجم الشيت)
        const signatureData = data.signature ? data.signature.substring(0, 1000) : '';
        tasksSheet.getRange(i + 1, 11).setValue(signatureData);
        
        // حفظ التوقيع الكامل في Drive (اختياري)
        try {
          if (data.signature && data.signature.length > 100) {
            const folder = DriveApp.getFolderById(TASKS_FOLDER_ID);
            const signatureBlob = Utilities.newBlob(
              Utilities.base64Decode(data.signature.split(',')[1] || data.signature),
              'image/png',
              `signature_${data.taskId}.png`
            );
            folder.createFile(signatureBlob);
          }
        } catch(e) {
          console.log('Could not save signature to Drive:', e.message);
        }
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Task not found' };
  } catch(e) {
    console.error('confirmDelivery error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * جلب سجل التسليمات
 */
function getDeliveryLog_() {
  try {
    const ss = SpreadsheetApp.openById(TASKS_SPREADSHEET_ID);
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
    
    // ترتيب من الأحدث للأقدم
    logs.reverse();
    
    return { success: true, logs: logs };
  } catch(e) {
    console.error('getDeliveryLog error:', e);
    return { success: false, error: e.message };
  }
}

// ============================================
// دالة اختبار
// ============================================
function testTasksSystem() {
  // اختبار إنشاء مهمة
  const result = createTask_({
    doctorName: 'د. اختبار',
    fileName: 'test.xlsx',
    uploadedBy: 'مدير النظام',
    uploadedByEmail: 'admin@test.com',
    fileData: 'dGVzdA==' // "test" in base64
  });
  
  console.log('Create task result:', result);
  
  // اختبار جلب المهام
  const tasks = getTasks_();
  console.log('Tasks:', tasks);
}
