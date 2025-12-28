/**
 * ========================================
 * الكود المعدل - انسخه إلى مشروع "الكوارث" في Google Apps Script
 * ========================================
 * 
 * الخطوات:
 * 1. افتح مشروع "الكوارث" في https://script.google.com
 * 2. ابحث عن دالة validateStaffAuth_ (حول السطر 112)
 * 3. احذف الدالة القديمة واستبدلها بالكود أدناه
 * 4. اضغط Ctrl+S للحفظ
 * 5. Deploy → Manage deployments → Edit (أيقونة القلم) → Deploy
 */

// ========= أضف هذا في أعلى الملف (بعد المتغيرات العامة) =========

/**
 * Owner Bypass - المالك يدخل بالبريد فقط
 */
const OWNER_EMAIL = 'husseinbabsail@gmail.com';

function isOwnerByEmail_(email) {
  return String(email || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
}


// ========= استبدل دالة validateStaffAuth_ القديمة بهذه =========

/**
 * التحقق من صلاحيات الموظف - مع Owner Bypass
 * الأدوار المتاحة: owner, admin, staff, doctor, pharmacist, insurance, viewer
 */
function validateStaffAuth_(payload, requiredRoles) {
  // ✅ Owner Bypass - المالك يدخل بالبريد فقط بدون تحقق من التوكن
  if (isOwnerByEmail_(payload.staffEmail)) {
    console.log('✅ Owner bypass activated for:', payload.staffEmail);
    return { verified: true, role: 'owner' };
  }

  // غير المالك: يحتاج كل البيانات
  if (!payload.staffId || !payload.staffEmail || !payload.idToken) {
    throw new Error('غير مصرح - يجب تسجيل الدخول');
  }
  
  // التحقق من Firebase ID Token
  const verified = verifyFirebaseIdToken_(payload.idToken);
  if (!verified) {
    throw new Error('غير مصرح - التوكن غير صالح');
  }
  
  // التأكد من تطابق البيانات
  if (verified.localId !== payload.staffId || verified.email !== payload.staffEmail) {
    throw new Error('غير مصرح - بيانات غير متطابقة');
  }
  
  // جلب دور الموظف من Firestore (يجب تخزينه هناك)
  // حالياً نستخدم جدول Staff_Roles في Sheets
  const staffRole = getStaffRole_(payload.staffEmail);
  
  if (!staffRole) {
    throw new Error('غير مصرح - لم يتم العثور على صلاحياتك');
  }
  
  // التحقق من أن الدور مسموح
  if (requiredRoles && requiredRoles.length > 0) {
    if (!requiredRoles.includes(staffRole)) {
      throw new Error('غير مصرح - ليس لديك صلاحية لهذا الإجراء');
    }
  }
  
  return { verified: true, role: staffRole };
}


// ========= ملاحظة مهمة =========
// 
// بعد إضافة الكود:
// 1. اضغط Ctrl+S للحفظ
// 2. اذهب إلى Deploy → Manage deployments
// 3. اضغط على أيقونة القلم (Edit)
// 4. غيّر Version إلى "New version"
// 5. اضغط Deploy
//
// ========================================
