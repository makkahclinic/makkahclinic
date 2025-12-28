/**
 * ========================================
 * إصلاح Owner Bypass لـ Google Apps Script
 * ========================================
 * 
 * الخطوات:
 * 1. افتح https://script.google.com
 * 2. افتح مشروع السكربت الرئيسي (main)
 * 3. ابحث عن دالة validateStaffAuth_ واستبدلها بالكود أدناه
 * 4. اضغط Deploy → Manage deployments → Edit → Deploy
 */

// ========= Owner Bypass =========
const OWNER_EMAIL = 'husseinbabsail@gmail.com';

function isOwnerByEmail_(email) {
  return String(email || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
}

/**
 * التحقق من صلاحيات الموظف - مع Owner Bypass
 * الأدوار المتاحة: owner, admin, staff, doctor, pharmacist, insurance, viewer
 */
function validateStaffAuth_(payload, requiredRoles) {
  // ✅ Owner Bypass - المالك يدخل بالبريد فقط بدون تحقق من التوكن
  if (isOwnerByEmail_(payload.staffEmail)) {
    console.log('Owner bypass activated for:', payload.staffEmail);
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
  
  // جلب دور الموظف من جدول Staff_Roles
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

/**
 * ========================================
 * إذا عندك دالة getOwnerDashboardStats منفصلة، عدّلها هكذا:
 * ========================================
 */
function getOwnerDashboardStats(payload) {
  // ✅ Owner Bypass
  if (isOwnerByEmail_(payload.staffEmail)) {
    // المالك يحصل على الإحصائيات مباشرة
    return { 
      success: true, 
      ok: true, 
      stats: buildOwnerStats_() // استبدل بدالتك الحالية
    };
  }

  // غير المالك: تحقق من الصلاحيات
  try {
    validateStaffAuth_(payload, ['owner', 'admin']);
    return { 
      success: true, 
      ok: true, 
      stats: buildOwnerStats_()
    };
  } catch (e) {
    return { 
      success: false, 
      ok: false, 
      error: e.message 
    };
  }
}
