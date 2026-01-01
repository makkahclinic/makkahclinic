  /**
   * نظام الجودة المتكامل - Google Apps Script
   * مجمع مكة الطبي بالزاهر
   * 
   * يشمل:
   * - نظام الاجتماعات واللجان
   * - نظام حوادث سلامة المرضى
   * - نظام MRIS للموارد الطبية
   * - نظام الطوارئ EOC
   */
  
  // ✅ ملف الإكسل المعتمد الموحد
  const MASTER_SHEET_ID = '1aijUPpTqUGUaKmYAyohq0RHmk1CF0CzCm17gfixHKOg';
  
  // توحيد جميع معرفات الشيتات
  const SPREADSHEET_ID = '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc';
  
  // ✅ نظام الطوارئ EOC - ملف منفصل
  const EOC_SPREADSHEET_ID = '1tZeJs7bUELdoGgxxujaeKXSSSXLApPfmis3YrpaAVVA';
  
  // باقي الأنظمة تستخدم الملف المركزي
  const PATIENTS_SPREADSHEET_ID = MASTER_SHEET_ID;
  const INCIDENTS_SPREADSHEET_ID = MASTER_SHEET_ID;
  const MRIS_SHEET_ID = MASTER_SHEET_ID;

  // ======== دوال الأمان المتقدمة ========
  
  /**
   * قائمة Actions العامة (لا تحتاج Token)
   */
  const PUBLIC_ACTIONS = new Set([
    'ping',
    'getBuildingConfig',
    'getScenarioGuides',
    'getScenarioProfiles',
    'getRoomCodes',
    'getActiveCommand',
    'getEmergencyReports',
    'submitEmergencyReport',
    'getTrainingLog',
    'getEmergencyStatus',
    // ✅ دوال التدريب
    'getTrainingSessions',
    'getTrainingRoster',
    'addTrainingSession',
    'updateTrainingSession',
    'deleteTrainingSession',
    'recordTrainingAttendance',
    'getTrainingStats',
    'importStaffToRoster',
    'addTrainee',
    'updateTrainee',
    'deleteTrainee'
  ]);

  /**
   * التحقق من Token للـ Actions الحساسة
   * ملاحظة: لتفعيل هذه الميزة، أضف API_TOKEN في Script Properties
   */
  function requireToken_(p) {
    const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!expected) return; // إذا لم يتم تعيين token، تخطى التحقق
    const got = String((p && (p.token || p.t)) || '').trim();
    if (got !== expected) throw new Error('Unauthorized');
  }

  /**
   * حماية من Formula Injection (Spreadsheet Injection)
   * يمنع الأكواد الخبيثة التي تبدأ بـ = + - @
   */
  function safeCell_(v) {
    const s = String(v ?? '');
    if (/^[=+\-@]/.test(s.trim())) {
      return "'" + s;
    }
    return s;
  }

  /**
   * تنظيف صف كامل قبل الإدراج
   */
  function safeCellArray_(arr) {
    return arr.map(v => safeCell_(v));
  }

  // ======== Owner Bypass ========
  
  /**
   * بريد المالك - يدخل بدون تحقق من التوكن
   */
  const OWNER_EMAIL = 'husseinbabsail@gmail.com';

  function isOwnerByEmail_(email) {
    return String(email || '').toLowerCase() === OWNER_EMAIL.toLowerCase();
  }

  // ======== دوال الأمان ========

  /**
   * التحقق من مصادقة المريض باستخدام Firebase ID Token
   * يتحقق من صحة التوكن ومطابقة الـ UID والـ email
   */
  function validatePatientAuth_(payload) {
    // تحقق أساسي من وجود البيانات المطلوبة
    if (!payload.patientId || !payload.patientEmail) {
      throw new Error('غير مصرح - يجب تسجيل الدخول');
    }
    
    // التحقق من Firebase ID Token إذا كان موجوداً
    if (payload.idToken) {
      const verified = verifyFirebaseIdToken_(payload.idToken);
      if (!verified) {
        throw new Error('غير مصرح - التوكن غير صالح');
      }
      // التأكد من تطابق الـ UID مع الـ patientId
      if (verified.localId !== payload.patientId) {
        throw new Error('غير مصرح - لا يمكنك الوصول لهذه البيانات');
      }
      // التأكد من تطابق الـ email
      if (verified.email && verified.email !== payload.patientEmail) {
        throw new Error('غير مصرح - البريد الإلكتروني غير متطابق');
      }
      return true;
    }
    
    // Fallback: تحقق من السجلات (للتوافق مع الإصدارات السابقة)
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Patients");
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === payload.patientId) {
          if (data[i][1] !== payload.patientEmail) {
            throw new Error('غير مصرح - لا يمكنك الوصول لهذه البيانات');
          }
          return true;
        }
      }
    }
    // مريض جديد - السماح بالتسجيل
    return true;
  }
  
  /**
   * ✅ Staff Auth (NO Owner bypass) - نسخة آمنة
   * يعتمد على:
   * - Firebase ID Token (مع FIREBASE_API_KEY)
   * - ثم Role من Staff_Roles
   * الأدوار المتاحة: owner, admin, staff, doctor, pharmacist, insurance, viewer
   */
  function validateStaffAuth_(payload, requiredRoles) {
    if (!payload || !payload.staffEmail) {
      throw new Error('غير مصرح - البريد مطلوب');
    }

    // 1) لازم idToken لكل staff endpoints
    if (!payload.idToken || !payload.staffId) {
      throw new Error('غير مصرح - يجب تسجيل الدخول');
    }

    // 2) تحقق من Firebase ID Token
    const verified = verifyFirebaseIdToken_(payload.idToken);
    if (!verified) throw new Error('غير مصرح - التوكن غير صالح');

    // 3) تطابق UID + Email
    const email = String(payload.staffEmail || '').trim().toLowerCase();
    const vEmail = String(verified.email || '').trim().toLowerCase();
    const vUid = String(verified.localId || '').trim();
    const uid = String(payload.staffId || '').trim();

    if (!vUid || vUid !== uid) throw new Error('غير مصرح - UID غير متطابق');
    if (!vEmail || vEmail !== email) throw new Error('غير مصرح - البريد غير متطابق');

    // 4) جلب الدور من Staff_Roles
    const staffRole = getStaffRole_(email);
    if (!staffRole) throw new Error('غير مصرح - لم يتم العثور على صلاحياتك');

    // 5) تحقق role المطلوبة
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(staffRole)) {
      throw new Error('غير مصرح - ليس لديك صلاحية لهذا الإجراء');
    }

    return { verified: true, role: staffRole, email };
  }
  
  /**
   * جلب دور الموظف من جدول الصلاحيات
   */
  function getStaffRole_(email) {
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      let sheet = ss.getSheetByName("Staff_Roles");
      
      // إنشاء الجدول إذا لم يكن موجوداً
      if (!sheet) {
        sheet = ss.insertSheet("Staff_Roles");
        sheet.appendRow(["Email", "Role", "Name", "Department", "CreatedAt"]);
        // إضافة المالك الافتراضي
        sheet.appendRow(["husseinbabsail@gmail.com", "owner", "المالك", "الإدارة", new Date().toISOString()]);
      }
      
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === email) {
          return data[i][1]; // الدور
        }
      }
      return null;
    } catch (e) {
      console.log('Error getting staff role:', e.message);
      return null;
    }
  }
  
  /**
   * إضافة أو تحديث دور موظف (للمالك والإداريين فقط)
   */
  function setStaffRole(payload) {
    // التحقق من صلاحية المنفذ
    const auth = validateStaffAuth_(payload, ['owner', 'admin']);
    
    const { targetEmail, targetRole, targetName, targetDepartment } = payload;
    
    if (!targetEmail || !targetRole) {
      throw new Error('البريد الإلكتروني والدور مطلوبان');
    }
    
    // التحقق من صحة الدور
    const validRoles = ['owner', 'admin', 'staff', 'doctor', 'pharmacist', 'insurance', 'viewer'];
    if (!validRoles.includes(targetRole)) {
      throw new Error('دور غير صالح');
    }
    
    // فقط المالك يمكنه تعيين مالك آخر أو مدير
    if (['owner', 'admin'].includes(targetRole) && auth.role !== 'owner') {
      throw new Error('فقط المالك يمكنه تعيين مدراء');
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Staff_Roles");
    const data = sheet.getDataRange().getValues();
    
    // البحث عن الموظف وتحديثه أو إضافته
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === targetEmail) {
        sheet.getRange(i + 1, 2).setValue(targetRole);
        if (targetName) sheet.getRange(i + 1, 3).setValue(targetName);
        if (targetDepartment) sheet.getRange(i + 1, 4).setValue(targetDepartment);
        found = true;
        break;
      }
    }
    
    if (!found) {
      sheet.appendRow([
        targetEmail,
        targetRole,
        targetName || '',
        targetDepartment || '',
        new Date().toISOString()
      ]);
    }
    
    return { success: true, message: 'تم تحديث الصلاحيات بنجاح' };
  }
  
  /**
   * جلب قائمة الموظفين وأدوارهم (للمالك والإداريين فقط)
   */
  function getStaffList(payload) {
    validateStaffAuth_(payload, ['owner', 'admin']);
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Staff_Roles");
    
    if (!sheet) {
      return { success: true, staff: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    const staff = [];
    
    for (let i = 1; i < data.length; i++) {
      staff.push({
        email: data[i][0],
        role: data[i][1],
        name: data[i][2],
        department: data[i][3],
        createdAt: data[i][4]
      });
    }
    
    return { success: true, staff };
  }

  /**
   * حذف/إلغاء صلاحية موظف (للمالك فقط)
   */
  function revokeStaffRole(payload) {
    // التحقق من صلاحية المنفذ - للمالك فقط
    const auth = validateStaffAuth_(payload, ['owner']);
    
    const { targetEmail } = payload;
    
    if (!targetEmail) {
      throw new Error('البريد الإلكتروني مطلوب');
    }
    
    // لا يمكن حذف المالك
    const ownerEmail = "husseinbabsail@gmail.com";
    if (targetEmail.toLowerCase() === ownerEmail.toLowerCase()) {
      throw new Error('لا يمكن حذف المالك');
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Staff_Roles");
    
    if (!sheet) {
      throw new Error('جدول الموظفين غير موجود');
    }
    
    const data = sheet.getDataRange().getValues();
    
    // البحث عن الموظف وحذفه
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toLowerCase() === targetEmail.toLowerCase()) {
        sheet.deleteRow(i + 1);
        return { success: true, message: 'تم حذف المستخدم بنجاح' };
      }
    }
    
    throw new Error('المستخدم غير موجود');
  }

  /**
   * ✅ جلب دور المستخدم (API عام للـ frontend) - نسخة آمنة
   * لا يعطي owner تلقائياً بالبريد فقط
   */
  function getUserRole(payload) {
    const { email, idToken } = payload;
    
    if (!email) {
      return { success: false, error: 'البريد الإلكتروني مطلوب' };
    }
    
    const normalizedEmail = String(email).trim().toLowerCase();
    
    // ✅ لا تعطي owner تلقائيًا بالبريد فقط - لازم idToken
    if (idToken) {
      const verified = verifyFirebaseIdToken_(idToken);
      if (!verified) {
        return { success: false, error: 'التوكن غير صالح' };
      }
      if (String(verified.email || '').toLowerCase() !== normalizedEmail) {
        return { success: false, error: 'البريد غير متطابق' };
      }
    }
    
    // الدور من Staff_Roles فقط
    const role = getStaffRole_(normalizedEmail);
    
    if (!role) {
      // مستخدم جديد - دور افتراضي patient
      return { success: true, role: 'patient', name: '' };
    }
    
    // جلب الاسم من الجدول
    try {
      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const sheet = ss.getSheetByName("Staff_Roles");
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (String(data[i][0]).toLowerCase() === normalizedEmail) {
            return { success: true, role: data[i][1], name: data[i][2] || '' };
          }
        }
      }
    } catch (e) {
      console.log('Error getting name:', e);
    }
    
    return { success: true, role: role, name: '' };
  }

  /**
   * التحقق من صحة Firebase ID Token باستخدام Google Identity Toolkit API
   */
  function verifyFirebaseIdToken_(idToken) {
    try {
      const FIREBASE_API_KEY = PropertiesService.getScriptProperties().getProperty('FIREBASE_API_KEY');
      if (!FIREBASE_API_KEY) {
        console.log('Firebase API Key not configured - skipping token verification');
        return null;
      }
      
      const url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY;
      const response = UrlFetchApp.fetch(url, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({ idToken: idToken }),
        muteHttpExceptions: true
      });
      
      const result = JSON.parse(response.getContentText());
      
      if (result.error) {
        console.log('Firebase token verification failed:', result.error.message);
        return null;
      }
      
      if (result.users && result.users.length > 0) {
        return result.users[0];
      }
      
      return null;
    } catch (e) {
      console.log('Error verifying Firebase token:', e.message);
      return null;
    }
  }
  
  /**
   * تنظيف المدخلات من الأكواد الخبيثة (XSS)
   */
  function sanitizeInput(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '')
      .trim();
  }
  
  /**
   * تنظيف كائن payload كامل
   */
  function sanitizePayload(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const clean = {};
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        clean[key] = sanitizeInput(obj[key]);
      } else if (Array.isArray(obj[key])) {
        clean[key] = obj[key].map(item => 
          typeof item === 'string' ? sanitizeInput(item) : 
          typeof item === 'object' ? sanitizePayload(item) : item
        );
      } else if (typeof obj[key] === 'object') {
        clean[key] = sanitizePayload(obj[key]);
      } else {
        clean[key] = obj[key];
      }
    }
    return clean;
  }
  
  /**
   * التحقق من صحة رقم
   */
  function validateNumber(val, min, max, defaultVal) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return defaultVal;
    if (min !== undefined && num < min) return min;
    if (max !== undefined && num > max) return max;
    return num;
  }
  
  /**
   * Rate Limiting - الحد من الطلبات المتكررة
   * @param {string} identifier - معرف الطلب (IP أو action)
   * @param {number} limit - الحد الأقصى للطلبات
   * @param {number} windowSec - نافذة الوقت بالثواني
   * @returns {boolean} - true إذا مسموح، false إذا محظور
   */
  function checkRateLimit(identifier, limit, windowSec) {
    const cache = CacheService.getScriptCache();
    const key = 'rl_' + identifier;
    const now = Math.floor(Date.now() / 1000);
    
    let data = cache.get(key);
    if (!data) {
      cache.put(key, JSON.stringify({ count: 1, start: now }), windowSec);
      return true;
    }
    
    const parsed = JSON.parse(data);
    if (now - parsed.start > windowSec) {
      cache.put(key, JSON.stringify({ count: 1, start: now }), windowSec);
      return true;
    }
    
    if (parsed.count >= limit) {
      return false;
    }
    
    parsed.count++;
    cache.put(key, JSON.stringify(parsed), windowSec - (now - parsed.start));
    return true;
  }

  // ✅ Role requirements per action (Gatekeeper)
  const ACTION_ROLES = {
    // Staff roles management
    setStaffRole: ['owner', 'admin'],
    getStaffList: ['owner', 'admin'],
    revokeStaffRole: ['owner'],

    // Owner dashboard
    getOwnerDashboardStats: ['owner', 'admin'],

    // Incidents
    getIncidents: ['owner', 'admin'],
    updateIncidentStatus: ['owner', 'admin'],
    assignIncident: ['owner', 'admin'],
    escalateIncident: ['owner', 'admin'],
    closeIncident: ['owner', 'admin'],
    saveRCA: ['owner', 'admin'],

    // MRIS uploads
    startUpload: ['owner', 'admin'],
    uploadChunk: ['owner', 'admin'],
    finishUpload: ['owner', 'admin'],
    getUploadStatus: ['owner', 'admin'],
    setAssignment: ['owner', 'admin'],
    getAssignments: ['owner', 'admin'],
  };

  /**
   * ✅ Gatekeeper: يقرر هل نطلب auth أم لا
   * - Public actions = بدون auth
   * - Protected actions = staffAuth أو API_TOKEN
   */
  function enforceAuthOrToken_(action, payload) {
    // 1) Public actions = بدون auth
    if (PUBLIC_ACTIONS.has(action)) return { ok: true, auth: null };

    // 2) getUserRole استثناء خاص - يمكن استدعاؤه بدون auth كامل
    if (action === 'getUserRole') return { ok: true, auth: null };

    // 3) إذا مفعّل staffAuth
    try {
      if (payload && payload.staffId && payload.staffEmail && payload.idToken) {
        const roles = ACTION_ROLES[action] || [];
        const auth = validateStaffAuth_(payload, roles);
        return { ok: true, auth };
      }
    } catch (e) {
      // لو فشل staffAuth نكمّل ونحاول API_TOKEN
    }

    // 4) API_TOKEN fallback
    requireToken_(payload);
    return { ok: true, auth: { role: 'api_token' } };
  }
  
function doPost(e) {
    try {
      const body = JSON.parse(e.postData.contents);
      const action = sanitizeInput(body.action);
      const payload = sanitizePayload(body.payload || {});
      
      // Rate limiting: 60 طلب في الدقيقة لكل action
      if (!checkRateLimit(action, 60, 60)) {
        return ContentService.createTextOutput(JSON.stringify({
          ok: false,
          error: 'تم تجاوز الحد الأقصى للطلبات. حاول مرة أخرى بعد دقيقة.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      // ✅ enforce auth (public vs protected)
      enforceAuthOrToken_(action, payload);
      
      let result;
      
      switch (action) {
        case 'getUserRole':
          result = getUserRole(payload);
          break;
        case 'setStaffRole':
          result = setStaffRole(payload);
          break;
        case 'getStaffList':
          result = getStaffList(payload);
          break;
        case 'revokeStaffRole':
          result = revokeStaffRole(payload);
          break;
        case 'getHomeData':
          result = getHomeData();
          break;
        // Committee Meeting APIs
        case 'getMeetingData':
          result = getMeetingData(payload.committee);
          break;
        case 'saveMeeting':
          result = saveMeeting(payload);
          break;
        case 'getMeetingRecommendations':
          result = getMeetingRecommendations(payload.committee);
          break;
        case 'getDelayedMeetings':
          result = getDelayedMeetings(payload.committee);
          break;
        case 'closeMeetingRecommendation':
          result = closeMeetingRecommendation(payload);
          break;
        case 'getMeetingsArchive':
          result = getMeetingsArchive(payload);
          break;
        case 'getMeetingsDashboard':
          result = getMeetingsDashboard(payload.year);
          break;
        // Patient Safety Incidents APIs
        case 'submitIncident':
          result = submitIncident(payload);
          break;
        case 'getIncidents':
          result = getIncidents(payload);
          break;
        case 'getIncidentDetails':
          result = getIncidentDetails(payload.incidentId);
          break;
        case 'updateIncidentStatus':
          result = updateIncidentStatus(payload);
          break;
        case 'getIncidentStats':
          result = getIncidentStats(payload);
          break;
        case 'getOwnerDashboardStats':
          result = getOwnerDashboardStats(payload);
          break;
        case 'addIncidentFollowup':
          result = addIncidentFollowup(payload);
          break;
        case 'getIncidentStaff':
          result = getIncidentStaff();
          break;
        case 'verifyIncidentPasscode':
          result = verifyIncidentPasscode(payload.staffName, payload.passcode);
          break;
        case 'getEscalationList':
          result = getEscalationList();
          break;
        case 'assignIncident':
          result = assignIncident(payload);
          break;
        case 'escalateIncident':
          result = escalateIncident(payload);
          break;
        case 'closeIncident':
          result = closeIncident(payload);
          break;
        case 'saveRCA':
          result = saveRCA(payload);
          break;
        // Patient Portal APIs (Protected - require auth token)
        case 'registerPatient':
          validatePatientAuth_(payload);
          result = registerPatient(payload);
          break;
        case 'getPatientProfile':
          validatePatientAuth_(payload);
          result = getPatientProfile(payload.patientId);
          break;
        case 'bookAppointment':
          validatePatientAuth_(payload);
          result = bookAppointment(payload);
          break;
        case 'getPatientAppointments':
          validatePatientAuth_(payload);
          result = getPatientAppointments(payload.patientId);
          break;
        case 'cancelAppointment':
          validatePatientAuth_(payload);
          result = cancelAppointment(payload);
          break;
        case 'getPatientResults':
          validatePatientAuth_(payload);
          result = getPatientResults(payload.patientId);
          break;
        case 'submitPatientSymptoms':
          validatePatientAuth_(payload);
          result = submitPatientSymptoms(payload);
          break;
        case 'analyzeSymptoms':
          validatePatientAuth_(payload);
          result = analyzeSymptoms(payload);
          break;
        // ===== MRIS Chunk Upload APIs =====
        case 'startUpload':
          result = startMrisUpload_(payload);
          break;
        case 'uploadChunk':
          result = uploadMrisChunk_(payload);
          break;
        case 'finishUpload':
          result = finishMrisUpload_(payload);
          break;
        case 'getUploadStatus':
          result = getMrisUploadStatus_(payload);
          break;
        // ===== MRIS Assignment & Data APIs =====
        case 'setAssignment':
          result = setMrisAssignment_(payload);
          break;
        case 'getAssignments':
          result = getMrisAssignments_();
          break;
        case 'getHeatmap':
          result = getMrisHeatmap_();
          break;
        case 'getKpis':
          result = getMrisKpis_();
          break;
        case 'getEvidencePack':
          result = getMrisEvidencePack_(payload);
          break;
        // ===== EOC Emergency Command APIs =====
        case 'setActiveCommand':
          result = setActiveCommand(payload);
          break;
        case 'closeActiveCommand':
          result = closeActiveCommand(payload);
          break;
        case 'clearActiveCommand':
          result = clearActiveCommand(payload);
          break;
        case 'addTrainingSession':
          result = addTrainingSession(payload);
          break;
        case 'updateTrainingSession':
          result = updateTrainingSession(payload);
          break;
        case 'deleteTrainingSession':
          result = deleteTrainingSession(payload);
          break;
        case 'recordTrainingAttendance':
          result = recordTrainingAttendance(payload);
          break;
        case 'importStaffToRoster':
          result = importStaffToRoster();
          break;
        case 'addTrainee':
          result = addTrainee(payload);
          break;
        case 'updateTrainee':
          result = updateTrainee(payload);
          break;
        case 'deleteTrainee':
          result = deleteTrainee(payload);
          break;
        default:
          throw new Error('Unknown action: ' + action);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ ok: true, ...result }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  function doGet(e) {
    // تجهيز الشيتات تلقائياً
    ensureEocReady_();
    
    const p = e && e.parameter ? e.parameter : {};
    const action = sanitizeInput(p.action);
    const callback = sanitizeInput(p.callback);
    
    // Rate limiting: 100 طلب في الدقيقة
    if (action && !checkRateLimit('get_' + action, 100, 60)) {
      const errorObj = { ok: false, error: 'Rate limit exceeded' };
      const json = JSON.stringify(errorObj);
      if (callback) {
        return ContentService.createTextOutput(callback + '(' + json + ');')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    function output_(obj) {
      const json = JSON.stringify(obj);

      // ✅ JSONP فقط للأكشنات العامة
      const allowJsonp = callback && PUBLIC_ACTIONS.has(action);

      if (allowJsonp) {
        const safe = String(callback).replace(/[^\w$.]/g, '');
        return ContentService.createTextOutput(safe + '(' + json + ');')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // EOC Config APIs
    if (action === 'getBuildingConfig') {
      return output_(getBuildingConfig());
    }
    
    if (action === 'getScenarioGuides') {
      return output_(getScenarioGuides());
    }
    
    if (action === 'getScenarioProfiles') {
      return output_(getScenarioProfiles());
    }
    
    if (action === 'getTrainingRoster') {
      return output_(getTrainingRoster());
    }
    
    if (action === 'logTrainingSession') {
      return output_(logTrainingSession(p));
    }
    
    if (action === 'saveTrainingSession') {
      return output_(logTrainingSession(p));
    }
    
    if (action === 'getTrainingSessions') {
      const out = getTrainingSessions(p);
      
      // لو فيه خطأ حقيقي، رجّعه كما هو
      if (!out || out.ok === false) return output_(out);
      
      const sessions = Array.isArray(out.sessions) ? out.sessions : [];
      const drills = sessions.map(s => ({
        date: s.date || '',
        type: s.scenarioLabel || s.scenarioKey || '',
        result: 'ناجح',
        trainer: s.trainer || ''
      }));
      
      return output_({ ok: true, sessions, drills, debug: out.debug || '' });
    }
    
    // Aliases (compatibility) - يرجع sessions + drills للتوافق
    if (action === 'getDrillLog') {
      const out = getTrainingSessions(p);
      if (!out || out.ok === false) return output_(out);
      
      const sessions = Array.isArray(out.sessions) ? out.sessions : [];
      const drills = sessions.map(s => ({
        date: s.date || '',
        type: s.scenarioLabel || s.scenarioKey || '',
        result: 'ناجح',
        trainer: s.trainer || ''
      }));
      return output_({ ok: true, sessions, drills, debug: out.debug || '' });
    }
    
    if (action === 'updateEmergencyReportStatus') {
      return output_(updateEmergencyReportStatus(p));
    }
    
    // debug action DISABLED for security
    // if (action === 'debug') { ... }
    
    if (action === 'submitEmergencyReport') {
      const result = submitEmergencyReport(p);
      return output_(result);
    }
    
    if (action === 'getEmergencyReports') {
      const result = getEmergencyReports(p);
      return output_(result);
    }
    
    if (action === 'updateEmergencyStatus') {
      const result = updateEmergencyReportStatus(p);
      return output_(result);
    }
    
    if (action === 'getEmergencyAnalytics') {
      const result = getEmergencyAnalytics();
      return output_(result);
    }
    
    if (action === 'getEmergencyStaff') {
      const result = getEmergencyStaff();
      return output_(result);
    }
    
    if (action === 'setActiveCommand') {
      const result = setActiveCommand(p);
      return output_(result);
    }
    
    if (action === 'getActiveCommand') {
      const result = getActiveCommand();
      return output_(result);
    }
    
    if (action === 'getRoomCodes') {
      const result = getRoomCodes();
      return output_(result);
    }
    
    if (action === 'clearActiveCommand') {
      const result = clearActiveCommand();
      return output_(result);
    }

    if (action === 'closeActiveCommand') {
      const result = closeActiveCommand(p);
      return output_(result);
    }
    
    if (action === 'getEocDrills') {
      const result = getEocDrills(p);
      return output_(result);
    }
    
    // Readiness Checklist APIs
    if (action === 'getReadinessDepartments') {
      const result = getReadinessDepartments();
      return output_(result);
    }
    
    if (action === 'saveReadinessCheck') {
      const result = saveReadinessCheck(p);
      return output_(result);
    }
    
    if (action === 'getReadinessHistory') {
      const result = getReadinessHistory(p);
      return output_(result);
    }
    
    // System health check endpoints
    if (action === 'ping') {
      return output_({ ok: true, message: 'pong', timestamp: new Date().toISOString() });
    }
    
    if (action === 'systemTest') {
      const testType = p.testType || 'basic';
      const testData = p.testData || '';
      try {
        if (testType === 'save') {
          // Test writing to sheet
          const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
          const sheet = ss.getSheetByName('Training_Log');
          return output_({ ok: true, testType: 'save', canWrite: !!sheet, timestamp: new Date().toISOString() });
        }
        return output_({ ok: true, testType: testType, timestamp: new Date().toISOString() });
      } catch(e) {
        return output_({ ok: false, testType: testType, error: e.message });
      }
    }
    
    // Staff Role APIs - للقراءة فقط عبر GET (بدون idToken لأنه عام)
    if (action === 'getUserRole') {
      try {
        const result = getUserRole({ email: p.email });
        return output_(result);
      } catch(e) {
        return output_({ success: false, error: e.message });
      }
    }
    
    // ✅ Owner Dashboard APIs (GET/JSONP) - مع دعم Firebase Token
    if (action === 'getStaffList') {
      try {
        const payload = p.payload ? JSON.parse(p.payload) : {
          staffEmail: p.staffEmail,
          staffId: p.staffId,
          idToken: p.idToken
        };
        const result = getStaffList(payload);
        return output_(result);
      } catch(e) {
        return output_({ success: false, error: e.message });
      }
    }
    
    if (action === 'getOwnerDashboardStats') {
      try {
        const payload = p.payload ? JSON.parse(p.payload) : {
          staffEmail: p.staffEmail,
          staffId: p.staffId,
          idToken: p.idToken
        };
        const result = getOwnerDashboardStats(payload);
        return output_(result);
      } catch(e) {
        return output_({ success: false, error: e.message });
      }
    }
    
    // ✅ Incidents API (GET/JSONP) - مع التحقق من الصلاحيات
    if (action === 'getIncidents') {
      try {
        const payload = {
          staffEmail: p.staffEmail,
          staffId: p.staffId,
          idToken: p.idToken,
          limit: p.limit || 50,
          status: p.status
        };
        validateStaffAuth_(payload, ['owner', 'admin']);
        const result = getIncidents(payload);
        return output_(result);
      } catch(e) {
        return output_({ success: false, error: e.message });
      }
    }
    
        
    // ✅ Risks API (GET/JSONP) - مع التحقق من الصلاحيات
    if (action === 'getRisks') {
      try {
        const payload = {
          staffEmail: p.staffEmail,
          staffId: p.staffId,
          idToken: p.idToken
        };
        validateStaffAuth_(payload, ['owner', 'admin']);
        const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
        const riskSheet = ss.getSheetByName('Risks_Register');
        if (!riskSheet) {
          return output_({ success: true, risks: [] });
        }
        const data = sheetToObjects(riskSheet);
        const risks = data.map(r => ({
          ID: r.ID || r.الرقم || '',
          Description: r.Description || r.الوصف || r.Risk || r.الخطر || '',
          Department: r.Department || r.القسم || '',
          Level: r.Level || r.المستوى || r.Severity || r.الشدة || 'medium',
          Status: r.Status || r.الحالة || 'active'
        }));
        return output_({ success: true, risks: risks });
      } catch(e) {
        return output_({ success: false, error: e.message });
      }
    }
    
    return output_({ ok: false, error: 'Unknown action: ' + (action || '') });
  }
  
  // Emergency Report Functions
  // الشيت الرئيسي للطوارئ والإخلاء (تم تعريفه في أعلى الملف)

  /******************** EOC BOOTSTRAP ********************/
  const EOC_BOOTSTRAP_VERSION = 2;

  // أسماء الشيتات
  const SHEET_MAP = 'EOC_MAP';
  const SHEET_MUSTER = 'EOC_MUSTER';
  const SHEET_SCENARIOS = 'EOC_SCENARIOS';
  const SHEET_ROSTER = 'Training_Roster';
  const SHEET_TRAINING_LOG = 'Training_Log';
  const SHEET_ACTIVE_CMD = 'أوامر_نشطة';
  const SHEET_PROFILE = 'EOC_PROFILE';

  // هيدرز
  const HEADERS_MAP = ['floor_order','floor_key','floor_name','dept_id','dept_name','dept_icon','active'];
  const HEADERS_MUSTER = ['key','name','description','active'];
  const HEADERS_SCEN = ['scenario_key','scenario_label','bucket','step_no','icon','text','active'];
  const HEADERS_ROSTER = ['name','department','role','active'];
  const HEADERS_TRAINING = ['session_id','date','start_time','end_time','duration_min','scenario_key','scenario_label','trainer','attendees','notes'];
  const HEADERS_ACTIVE = ['active','responseType','reportType','location','muster','timestamp','mode','scenarioKey','scenarioLabel','sessionId','trainer'];
  const HEADERS_PROFILE = ['scenario_key','scenario_label','icon','color','default_responseType','body_class','active'];

  function ensureEocReady_() {
    const props = PropertiesService.getScriptProperties();
    const v = Number(props.getProperty('EOC_BOOTSTRAP_VERSION') || '0');
    if (v === EOC_BOOTSTRAP_VERSION) return;

    setupEocWorkbook_();
    props.setProperty('EOC_BOOTSTRAP_VERSION', String(EOC_BOOTSTRAP_VERSION));
  }

  function setupEocWorkbook_() {
    const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);

    const shMap = ensureSheet_(ss, SHEET_MAP, HEADERS_MAP);
    const shMuster = ensureSheet_(ss, SHEET_MUSTER, HEADERS_MUSTER);
    const shScen = ensureSheet_(ss, SHEET_SCENARIOS, HEADERS_SCEN);
    const shProfile = ensureSheet_(ss, SHEET_PROFILE, HEADERS_PROFILE);
    ensureSheet_(ss, SHEET_ROSTER, HEADERS_ROSTER);
    ensureSheet_(ss, SHEET_TRAINING_LOG, HEADERS_TRAINING);
    ensureSheet_(ss, SHEET_ACTIVE_CMD, HEADERS_ACTIVE);

    if (shMap.getLastRow() === 1) seedMap_(shMap);
    if (shMuster.getLastRow() === 1) {
      shMuster.appendRow(['A','نقطة تجمع A','الموقف الأمامي','نعم']);
      shMuster.appendRow(['B','نقطة تجمع B','الساحة الخلفية','نعم']);
    }
    if (shScen.getLastRow() === 1) seedScenarios_(shScen);
    if (shProfile.getLastRow() === 1) seedProfiles_(shProfile);
  }

  function seedProfiles_(sh) {
    const rows = [
      ['fire','حريق','fa-fire','#ef4444','full_evacuation','fire','نعم'],
      ['power','انقطاع كهرباء','fa-bolt','#f59e0b','send_team','power','نعم'],
      ['water','تسرب مياه','fa-tint','#0ea5e9','send_team','water','نعم'],
      ['injury','إغماء/إصابة','fa-heartbeat','#dc2626','send_team','injury','نعم'],
      ['outbreak','تفشي عدوى','fa-virus','#8b5cf6','isolation_evacuation','infection','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }

  function ensureSheet_(ss, name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }

  function seedMap_(sh) {
    const rows = [
      [2,'2','الدور الثاني','dental','الأسنان','fa-tooth','نعم'],
      [2,'2','الدور الثاني','internal2','الباطنية 2','fa-stethoscope','نعم'],
      [2,'2','الدور الثاني','internal3','الباطنية 3','fa-stethoscope','نعم'],
      [1,'1','الدور الأول','reception','الاستقبال','fa-concierge-bell','نعم'],
      [1,'1','الدور الأول','internal1','الباطنية','fa-stethoscope','نعم'],
      [1,'1','الدور الأول','ortho','العظام','fa-bone','نعم'],
      [1,'1','الدور الأول','emergency','الطوارئ','fa-ambulance','نعم'],
      [1,'1','الدور الأول','general','الطب العام','fa-user-md','نعم'],
      [1,'1','الدور الأول','dressing','الضماد','fa-band-aid','نعم'],
      [1,'1','الدور الأول','obgyn','النساء والولادة','fa-baby','نعم'],
      [1,'1','الدور الأول','menreception','استقبال رجال','fa-male','نعم'],
      [1,'1','الدور الأول','womenreception','استقبال نساء','fa-female','نعم'],
      [0,'0','الدور الأرضي','lab','المختبر','fa-flask','نعم'],
      [0,'0','الدور الأرضي','admin','مكاتب إدارية','fa-building','نعم'],
      [0,'0','الدور الأرضي','physio','العلاج الطبيعي','fa-walking','نعم'],
      [0,'0','الدور الأرضي','xray','الأشعة','fa-x-ray','نعم'],
      [0,'0','الدور الأرضي','ultrasound','الألتراساوند','fa-wave-square','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }

  function seedScenarios_(sh) {
    const rows = [
      ['fire','حريق','DO',1,'fa-bolt','أبعد الأشخاص من الخطر فورًا.','نعم'],
      ['fire','حريق','DO',2,'fa-bell','فعّل الإنذار واتبع مسار الإخلاء.','نعم'],
      ['fire','حريق','DO',3,'fa-door-closed','أغلق الأبواب لاحتواء الدخان.','نعم'],
      ['fire','حريق','DONT',1,'fa-elevator','لا تستخدم المصاعد.','نعم'],
      ['fire','حريق','DONT',2,'fa-hand','لا تفتح بابًا ساخنًا.','نعم'],
      ['power','انقطاع كهرباء','DO',1,'fa-battery-full','ثبّت الأجهزة الحرجة على UPS/بطاريات.','نعم'],
      ['power','انقطاع كهرباء','DO',2,'fa-tools','بلّغ الصيانة وEOC لتأكيد تشغيل المولد.','نعم'],
      ['power','انقطاع كهرباء','DONT',1,'fa-plug','لا تشغّل أحمال إضافية بدون توجيه.','نعم'],
      ['water','تسرب مياه','DO',1,'fa-triangle-exclamation','أبعد الناس عن منطقة التسرب.','نعم'],
      ['water','تسرب مياه','DO',2,'fa-bolt','افصل الكهرباء عن المنطقة إن لزم.','نعم'],
      ['water','تسرب مياه','DONT',1,'fa-plug-circle-xmark','لا تلمس مقابس/أسلاك قرب الماء.','نعم'],
      ['injury','إغماء/إصابة','DO',1,'fa-user-check','أمّن المكان وافحص الاستجابة والتنفس.','نعم'],
      ['injury','إغماء/إصابة','DO',2,'fa-phone','اطلب المساعدة وأحضر AED إن توفر.','نعم'],
      ['injury','إغماء/إصابة','DONT',1,'fa-arrows-up-down-left-right','لا تحرك المصاب مع اشتباه العمود الفقري.','نعم'],
      ['outbreak','تفشي عدوى','DO',1,'fa-lock','عزل فوري للحالة/المنطقة وتقييد الدخول.','نعم'],
      ['outbreak','تفشي عدوى','DO',2,'fa-mask-face','استخدم معدات الوقاية المناسبة.','نعم'],
      ['outbreak','تفشي عدوى','DONT',1,'fa-people-group','لا تسمح بتجمعات داخل منطقة العزل.','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }
  /******************** END BOOTSTRAP ********************/

  /******************** EOC CONFIG APIs ********************/
  function getBuildingConfig() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const mapSh = ss.getSheetByName(SHEET_MAP);
      const mustSh = ss.getSheetByName(SHEET_MUSTER);
      const map = mapSh ? mapSh.getDataRange().getValues() : [];
      const mus = mustSh ? mustSh.getDataRange().getValues() : [];

      const floorsByKey = {};
      for (let i=1; i<map.length; i++){
        const r = map[i];
        const active = String(r[6]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        const floorOrder = Number(r[0]);
        const floorKey = String(r[1]||'').trim();
        const floorName = String(r[2]||'').trim();
        const deptId = String(r[3]||'').trim();
        const deptName = String(r[4]||'').trim();
        const deptIcon = String(r[5]||'').trim();
        const k = floorKey || String(floorOrder);
        if (!floorsByKey[k]) floorsByKey[k] = { floorOrder, floorKey: k, floorName, departments: [] };
        floorsByKey[k].departments.push({ id: deptId, name: deptName, icon: deptIcon });
      }
      const floors = Object.values(floorsByKey).sort((a,b)=>b.floorOrder-a.floorOrder);

      const muster = [];
      for (let i=1; i<mus.length; i++){
        const r = mus[i];
        const active = String(r[3]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        muster.push({ key: String(r[0]||'').trim(), name: String(r[1]||'').trim(), desc: String(r[2]||'').trim() });
      }
      return { ok:true, floors, muster };
    } catch(err){ return { ok:false, error: err.message }; }
  }

  function getScenarioGuides() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_SCENARIOS);
      const data = sh ? sh.getDataRange().getValues() : [];
      const out = {};
      for (let i=1; i<data.length; i++){
        const r = data[i];
        const active = String(r[6]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        const key = String(r[0]||'').trim();
        const label = String(r[1]||'').trim();
        const bucket = String(r[2]||'').trim();
        const stepNo = Number(r[3]||0);
        const icon = String(r[4]||'').trim();
        const text = String(r[5]||'').trim();
        if (!out[key]) out[key] = { key, label, DO: [], DONT: [] };
        out[key].label = label;
        out[key][bucket] = out[key][bucket] || [];
        out[key][bucket].push({ stepNo, icon, text });
      }
      Object.values(out).forEach(s=>{
        if (s.DO) s.DO.sort((a,b)=>a.stepNo-b.stepNo);
        if (s.DONT) s.DONT.sort((a,b)=>a.stepNo-b.stepNo);
      });
      return { ok:true, scenarios: out };
    } catch(err){ return { ok:false, error: err.message }; }
  }

  function getEmergencyStaff() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName('Staff');
      if (!sh) return { ok: true, staff: [] };

      const data = sh.getDataRange().getValues();
      const staff = [];
      for (let i = 1; i < data.length; i++) {
        const name = String(data[i][0] || '').trim();
        const phone = String(data[i][1] || '').trim();
        if (name && phone) {
          staff.push({ name, phone });
        }
      }
      return { ok: true, staff };
    } catch (err) {
      return { ok: false, error: err.message, staff: [] };
    }
  }

  function getScenarioProfiles() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_PROFILE);
      if (!sh) return { ok: true, profiles: {} };

      const data = sh.getDataRange().getValues();
      const profiles = {};
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const active = String(r[6] || '').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;

        const key = String(r[0] || '').trim();
        if (!key) continue;

        profiles[key] = {
          scenarioKey: key,
          scenarioLabel: String(r[1] || '').trim(),
          icon: String(r[2] || '').trim(),
          color: String(r[3] || '').trim(),
          defaultResponseType: String(r[4] || '').trim(),
          bodyClass: String(r[5] || '').trim(),
        };
      }
      return { ok: true, profiles };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function getTrainingRoster() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sh = ss.getSheetByName(SHEET_ROSTER);

      // إذا لم يوجد أو فارغ، حاول الاستيراد من Staff
      if (!sh || sh.getLastRow() <= 1) {
        importRosterFromStaff_(ss);
        sh = ss.getSheetByName(SHEET_ROSTER);
      }

      if (!sh) return { ok: true, roster: [] };
      const data = sh.getDataRange().getValues();
      const roster = [];
      for (let i=1; i<data.length; i++){
        const r = data[i];
        const active = String(r[3]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        roster.push({ name: String(r[0]||'').trim(), department: String(r[1]||'').trim(), role: String(r[2]||'').trim() });
      }
      return { ok: true, roster };
    } catch(err){ return { ok: false, error: err.message }; }
  }

  /** استيراد قائمة المتدربين من شيت Staff إذا كان Training_Roster فارغاً */
  function importRosterFromStaff_(ss) {
    try {
      const staffSh = ss.getSheetByName('Staff');
      if (!staffSh || staffSh.getLastRow() <= 1) return;

      let rosterSh = ss.getSheetByName(SHEET_ROSTER);
      if (!rosterSh) {
        rosterSh = ss.insertSheet(SHEET_ROSTER);
        rosterSh.getRange(1,1,1,4).setValues([['الاسم', 'القسم', 'الدور', 'نشط']]);
      }

      // اقرأ Staff (A=اسم، B=رقم/قسم)
      const staffData = staffSh.getDataRange().getValues();
      const rows = [];
      for (let i = 1; i < staffData.length; i++) {
        const name = String(staffData[i][0] || '').trim();
        const dept = String(staffData[i][1] || '').trim();
        if (name) {
          rows.push([name, dept, '', 'نعم']);
        }
      }

      if (rows.length > 0) {
        rosterSh.getRange(2, 1, rows.length, 4).setValues(rows);
      }
    } catch (e) {
      Logger.log('importRosterFromStaff_ error: ' + e.message);
    }
  }

  function durationToMinutes_(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    if (!isNaN(n) && n >= 0) return Math.round(n);
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return 0;
    const hh = Number(m[1] || 0);
    const mm = Number(m[2] || 0);
    const ss = Number(m[3] || 0);
    return Math.max(0, Math.round((hh * 3600 + mm * 60 + ss) / 60));
  }

  function logTrainingSession(params) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sh = ss.getSheetByName(SHEET_TRAINING_LOG);
      if (!sh) {
        sh = ss.insertSheet(SHEET_TRAINING_LOG);
        sh.getRange(1,1,1,HEADERS_TRAINING.length).setValues([HEADERS_TRAINING]);
      }

      // تأكد من وجود الهيدرز
      const lastRow = sh.getLastRow();
      if (lastRow === 0 || lastRow === 1) {
        sh.getRange(1,1,1,HEADERS_TRAINING.length).setValues([HEADERS_TRAINING]);
      }

      const tz = 'Asia/Riyadh';
      const now = new Date();

      const sessionId = String(params.session_id || params.sessionId || ('TRN-' + now.getTime()));
      const startIso = String(params.startIso || '');
      const endIso = String(params.endIso || '');

      const startDate = startIso ? new Date(startIso) : now;
      const endDate = endIso ? new Date(endIso) : now;

      const dateStr = Utilities.formatDate(startDate, tz, 'yyyy-MM-dd');
      const startTime = String(params.start_time || params.startTime || Utilities.formatDate(startDate, tz, 'HH:mm'));
      const endTime = String(params.end_time || params.endTime || Utilities.formatDate(endDate, tz, 'HH:mm'));

      let durationMin = durationToMinutes_(params.duration_min || params.durationMin || params.duration);
      if (!durationMin && startIso && endIso) {
        durationMin = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
      }

      sh.appendRow([
        sessionId,
        dateStr,
        startTime,
        endTime,
        durationMin,
        String(params.scenarioKey || ''),
        String(params.scenarioLabel || ''),
        String(params.trainer || ''),
        String(params.attendees || ''),
        String(params.notes || '')
      ]);

      SpreadsheetApp.flush();
      return { ok: true, sessionId };
    } catch(err) {
      return { ok: false, error: err.message };
    } finally {
      try { lock.releaseLock(); } catch(e) {}
    }
  }

  function getTrainingSessions(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_TRAINING_LOG);
      if (!sh) return { ok: true, sessions: [], debug: 'Sheet not found' };

      const lastRow = sh.getLastRow();
      if (lastRow <= 1) return { ok: true, sessions: [], debug: 'No data rows (lastRow=' + lastRow + ')' };

      const data = sh.getRange(2, 1, lastRow - 1, 10).getValues();
      const sessions = [];

      const limit = Math.min(Number(params.limit) || 50, 300);
      const startDate = String(params.startDate || '').trim();
      const endDate = String(params.endDate || '').trim();

      for (let i = data.length - 1; i >= 0 && sessions.length < limit; i--) {
        const r = data[i];
        if (!r[0]) continue;
        
        let dateVal = r[1];
        let d = '';
        if (dateVal instanceof Date) {
          d = Utilities.formatDate(dateVal, 'Asia/Riyadh', 'yyyy-MM-dd');
        } else {
          d = String(dateVal || '').trim();
        }

        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;

        // Format time values properly
        let startTime = r[2];
        let endTime = r[3];
        
        if (startTime instanceof Date) {
          startTime = Utilities.formatDate(startTime, 'Asia/Riyadh', 'hh:mm a');
        } else {
          startTime = String(startTime || '');
        }
        
        if (endTime instanceof Date) {
          endTime = Utilities.formatDate(endTime, 'Asia/Riyadh', 'hh:mm a');
        } else {
          endTime = String(endTime || '');
        }
        
        sessions.push({
          sessionId: String(r[0] || ''),
          date: d,
          startTime: startTime,
          endTime: endTime,
          durationMin: Number(r[4] || 0),
          scenarioKey: String(r[5] || ''),
          scenarioLabel: String(r[6] || ''),
          trainer: String(r[7] || ''),
          attendees: String(r[8] || ''),
          notes: String(r[9] || '')
        });
      }

      return { ok: true, sessions, debug: 'Found ' + data.length + ' rows, returned ' + sessions.length + ' sessions' };
    } catch(err){ return { ok: false, error: err.message, sessions: [] }; }
  }
  /******************** END EOC CONFIG APIs ********************/
  
  function submitEmergencyReport(params) {
    try {
      const lock = LockService.getScriptLock();
      lock.tryLock(10000);

      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sheet = ss.getSheetByName('بلاغات_الطوارئ');

      if (!sheet) {
        sheet = ss.insertSheet('بلاغات_الطوارئ');
        sheet.appendRow(['رقم البلاغ', 'التاريخ', 'الوقت', 'نوع الكارثة', 'الموقع', 'ملاحظات', 'الحالة', 'المستجيب', 'إجراءات']);
      }

      const now = new Date();
      const reportId = String(params.reportId || ('EMR-' + now.getTime()));

      // تخزين ثابت يسهل الفرز والتحليل
      const dateStr = Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd');
      const timeStr = Utilities.formatDate(now, 'Asia/Riyadh', 'HH:mm:ss');

      // حماية من Formula Injection
      // إذا تم تمرير status (مثل "مغلق") نستخدمها، وإلا "جديد"
      const initialStatus = String(params.status || 'جديد').trim();
      sheet.appendRow(safeCellArray_([
        reportId,
        dateStr,
        timeStr,
        String(params.disasterType || '').trim(),
        String(params.location || '').trim(),
        String(params.notes || '').trim(),
        initialStatus,
        '',
        ''
      ]));

      lock.releaseLock();
      return { ok: true, reportId };

    } catch (err) {
      try { LockService.getScriptLock().releaseLock(); } catch(e) {}
      return { ok: false, error: err.message };
    }
  }
  
  function getEmergencyReports(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      if (!sheet) return { ok: true, reports: [] };

      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return { ok: true, reports: [] };

      const limit = Math.min(parseInt((params && params.limit) || '20', 10) || 20, 200);

      const reports = [];
      for (let i = data.length - 1; i >= 1 && reports.length < limit; i--) {
        reports.push({
          id: data[i][0],
          date: data[i][1],
          time: data[i][2],
          type: data[i][3],
          location: data[i][4],
          notes: data[i][5],
          status: data[i][6] || 'جديد'
        });
      }
      return { ok: true, reports };

    } catch (err) {
      return { ok: false, error: err.message, reports: [] };
    }
  }
  
  function updateEmergencyReportStatus(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      if (!sheet) return { ok: false, error: 'Sheet not found' };

      const data = sheet.getDataRange().getValues();
      let rowIndex = -1;

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(params.reportId)) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) return { ok: false, error: 'Report not found' };

      sheet.getRange(rowIndex, 7).setValue(String(params.status || '').trim());

      // responder = col 8, actionNotes = col 9
      if (sheet.getLastColumn() < 8) sheet.getRange(1, 8).setValue('المستجيب');
      if (sheet.getLastColumn() < 9) sheet.getRange(1, 9).setValue('إجراءات');

      if (params.responder) sheet.getRange(rowIndex, 8).setValue(String(params.responder).trim());
      if (params.actionNotes) sheet.getRange(rowIndex, 9).setValue(String(params.actionNotes).trim());

      return { ok: true, message: 'Status updated successfully' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function getEmergencyAnalytics() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      
      if (!sheet) {
        return { ok: true, analytics: { total: 0, byType: {}, byStatus: {}, byLocation: {} } };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, analytics: { total: 0, byType: {}, byStatus: {}, byLocation: {} } };
      }
      
      const analytics = {
        total: data.length - 1,
        byType: {},
        byStatus: {},
        byLocation: {},
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        avgResponseTime: 0
      };
      
      const now = new Date();
      const todayStr = Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd');
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      for (let i = 1; i < data.length; i++) {
        const type = data[i][3] || 'غير محدد';
        const location = data[i][4] || 'غير محدد';
        const status = data[i][6] || 'جديد';
        const dateStr = String(data[i][1]);
        
        // Count by type
        analytics.byType[type] = (analytics.byType[type] || 0) + 1;
        
        // Count by status
        analytics.byStatus[status] = (analytics.byStatus[status] || 0) + 1;
        
        // Count by location (floor)
        const floor = location.includes('الأرضي') ? 'الأرضي' : 
                     location.includes('الأول') ? 'الأول' : 
                     location.includes('الثاني') ? 'الثاني' : 'أخرى';
        analytics.byLocation[floor] = (analytics.byLocation[floor] || 0) + 1;
        
        // Time-based counts
        if (dateStr.includes(todayStr)) analytics.today++;
        
        try {
          const reportDate = new Date(dateStr);
          if (reportDate >= weekAgo) analytics.thisWeek++;
          if (reportDate >= monthAgo) analytics.thisMonth++;
        } catch(e) {}
      }
      
      return { ok: true, analytics: analytics };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  // Active Command Functions for Emergency Display Screen
  function isTrueFlag_(v) {
    const s = String(v).toLowerCase().trim();
    return v === true || s === 'true' || s === 'yes' || s === '1';
  }

  function setActiveCommand(params) {
    ensureEocReady_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) sheet = ss.insertSheet(SHEET_ACTIVE_CMD);

      sheet.getRange(1, 1, 1, HEADERS_ACTIVE.length).setValues([HEADERS_ACTIVE]);

      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

      sheet.appendRow([
        true,
        params.responseType || '',
        params.reportType || '',
        params.location || '',
        params.muster || '',
        new Date().toISOString(),
        params.mode || 'real',
        params.scenarioKey || '',
        params.scenarioLabel || '',
        params.sessionId || '',
        params.trainer || ''
      ]);

      SpreadsheetApp.flush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }

  function getActiveCommand() {
    ensureEocReady_();
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: true, command: null };

      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return { ok: true, command: null };

      const row = data[1];
      if (!isTrueFlag_(row[0])) return { ok: true, command: null };

      return {
        ok: true,
        command: {
          active: true,
          responseType: row[1] || '',
          reportType: row[2] || '',
          location: row[3] || '',
          muster: row[4] || '',
          timestamp: row[5] || '',
          mode: row[6] || 'real',
          scenarioKey: row[7] || '',
          scenarioLabel: row[8] || '',
          sessionId: row[9] || '',
          trainer: row[10] || ''
        }
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function clearActiveCommand() {
    ensureEocReady_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: true };

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return { ok: true };

      sheet.getRange(2, 1).setValue(false);
      SpreadsheetApp.flush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }

  /** إغلاق رسمي للأمر النشط مع تسجيل من أغلق ولماذا */
  function closeActiveCommand(params) {
    ensureEocReady_();
    const closedBy = String(params.closedBy || '').trim();
    if (!closedBy) return { ok: false, error: 'closedBy is required' };

    const closeReason = String(params.closeReason || '').trim();

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: false, error: 'No active command sheet' };

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return { ok: false, error: 'No active command' };

      const data = sheet.getDataRange().getValues();
      const row = data[1];
      if (!isTrueFlag_(row[0])) return { ok: false, error: 'No active command' };

      // Set active to false
      sheet.getRange(2, 1).setValue(false);

      // Log closure to Training_Log if it was a training, or to emergency reports log
      const mode = String(row[6] || 'real').toLowerCase();
      const endTs = new Date().toISOString();

      // Try to log in EOC_COMMAND_LOG if exists
      let logSh = ss.getSheetByName('EOC_COMMAND_LOG');
      if (!logSh) {
        logSh = ss.insertSheet('EOC_COMMAND_LOG');
        logSh.getRange(1,1,1,8).setValues([['timestamp', 'action', 'mode', 'responseType', 'location', 'closedBy', 'closeReason', 'notes']]);
      }

      logSh.appendRow([
        endTs,
        'close',
        mode,
        String(row[1] || ''),
        String(row[3] || ''),
        closedBy,
        closeReason,
        mode === 'training' ? 'إيقاف تمرين' : 'إلغاء طوارئ'
      ]);

      SpreadsheetApp.flush();
      return { ok: true, closedAt: endTs };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }
  
  function getEocDrills(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('EOC_DRILLS');
      
      if (!sheet) {
        return { ok: true, drills: [] };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, drills: [] };
      }
      
      const limit = Math.min(parseInt(params.limit || '10', 10), 100);
      const drills = [];
      
      for (let i = data.length - 1; i >= 1 && drills.length < limit; i--) {
        drills.push({
          date: data[i][0] || '',
          type: data[i][1] || '',
          result: data[i][2] || 'ناجح'
        });
      }
      
      return { ok: true, drills: drills };
    } catch (err) {
      return { ok: false, error: err.message, drills: [] };
    }
  }
  
  function getRoomCodes() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('Rooms');
      
      if (!sheet) {
        return { ok: true, rooms: [] };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, rooms: [] };
      }
      
      const rooms = [];
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          rooms.push({
            code: String(data[i][0]),
            name: String(data[i][1] || '')
          });
        }
      }
      
      return { ok: true, rooms: rooms };
    } catch (err) {
      return { ok: false, error: err.message, rooms: [] };
    }
  }
  
  function getSheet(name) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return ss.getSheetByName(name);
  }
  
  function sheetToObjects(sheet) {
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    
    const headers = data[0];
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = { _rowIndex: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      rows.push(row);
    }
    
    return rows;
  }
  
  function getSaudiDate() {
    // توقيت السعودية UTC+3
    const now = new Date();
    const saudiOffset = 3 * 60; // 3 hours in minutes
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcTime + (saudiOffset * 60000));
  }
  
  function getTodayString() {
    const today = getSaudiDate();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  function formatTime(value) {
    if (!value) return '';
    if (value instanceof Date) {
      const h = String(value.getHours()).padStart(2, '0');
      const m = String(value.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
    const str = String(value);
    if (str.includes('T')) {
      const timePart = str.split('T')[1];
      if (timePart) return timePart.substring(0, 5);
    }
    return str;
  }
  
  function formatDate(value) {
    if (!value) return '';
    if (value instanceof Date) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const str = String(value);
    if (str.includes('T')) {
      return str.split('T')[0];
    }
    return str;
  }
  
  function getDayNameAr() {
    // Sheet uses English day abbreviations: Sun, Mon, Tue, Wed, Thu, Fri, Sat
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[getSaudiDate().getDay()];
  }
  
  function getDayNameArDisplay() {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[getSaudiDate().getDay()];
  }
  
  // دالة تحليل التواريخ بمختلف التنسيقات
  function parseLogDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
    
    const str = String(dateValue).trim();
    
    // YYYY-MM-DD أو YYYY/MM/DD
    let match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (match) {
      return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    
    // DD-MM-YYYY أو DD/MM/YYYY
    match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (match) {
      return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }
    
    // المحاولة العادية
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? null : d;
  }
  
  // ==================== COMMITTEE MEETINGS APIs ====================
  
  const MEETINGS_SHEET_ID = '1BOq20XMppleeaVHhY0F2Hf_fUPENDvJgk9fP_BqMcJM'; // ملف منفصل للاجتماعات
  
  function getMeetingsSheet(name) {
    const ss = SpreadsheetApp.openById(MEETINGS_SHEET_ID);
    return ss.getSheetByName(name);
  }
  
  // بيانات اللجان المطلوبة
  const COMMITTEE_CONFIG = {
    RM: { name: 'إدارة المخاطر', frequency: 'monthly', required: 10, members: 6 },
    FMS: { name: 'السلامة والمرافق', frequency: 'monthly', required: 10, members: 6 },
    PSC: { name: 'سلامة المرضى', frequency: 'monthly', required: 10, members: 6 },
    IPC: { name: 'مكافحة العدوى', frequency: 'monthly', required: 10, members: 6 },
    QI: { name: 'الجودة والتحسين', frequency: 'quarterly', required: 4, members: 5 },
    EOC: { name: 'الطوارئ والكوارث', frequency: 'semiannual', required: 2, members: 8 },
    EXEC: { name: 'الإدارة العليا', frequency: 'monthly', required: 10, members: 5 }
  };
  
  function getMeetingData(committee) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log')) || [];
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations')) || [];
    
    const year = new Date().getFullYear();
    const config = COMMITTEE_CONFIG[committee] || {};
    
    // فلترة اجتماعات اللجنة للسنة الحالية
    const committeeMeetings = meetingsLog.filter(m => {
      if (m.Committee !== committee) return false;
      const dateVal = m.Date;
      if (!dateVal) return false;
      // Handle Date objects
      if (dateVal instanceof Date) {
        return dateVal.getFullYear() === year;
      }
      // Handle strings
      return String(dateVal).includes(String(year));
    });
    
    // فلترة التوصيات
    const committeeRecs = recommendations.filter(r => r.Committee === committee);
    const openRecs = committeeRecs.filter(r => String(r.Status).toLowerCase() !== 'closed');
    const overdueRecs = committeeRecs.filter(r => {
      if (String(r.Status).toLowerCase() === 'closed') return false;
      if (!r.Due_Date) return false;
      return new Date(r.Due_Date) < new Date();
    });
    
    // حساب متوسط الحضور (نسبة الحاضرين من إجمالي أعضاء اللجنة)
    let avgAttendance = 0;
    if (committeeMeetings.length > 0) {
      const membersCount = config.members || 6; // عدد أعضاء اللجنة
      const totalAttendance = committeeMeetings.reduce((sum, m) => 
        sum + (parseInt(m.Attendees_Count) || 0), 0
      );
      // متوسط الحضور = (إجمالي الحاضرين / عدد الاجتماعات / عدد الأعضاء) × 100
      avgAttendance = Math.round((totalAttendance / committeeMeetings.length / membersCount) * 100);
      // التأكد من عدم تجاوز 100%
      avgAttendance = Math.min(avgAttendance, 100);
    }
    
    // حساب الاجتماعات المتأخرة
    const delayedCount = calculateDelayedMeetings(committee, committeeMeetings);
    
    return {
      completed: committeeMeetings.length,
      required: config.required || 10,
      delayed: delayedCount,
      openRecommendations: openRecs.length,
      overdueRecommendations: overdueRecs.length,
      avgAttendance: avgAttendance,
      meetings: committeeMeetings.slice(0, 10).map(m => ({
        date: formatDate(m.Date),
        type: m.Meeting_Type || 'حضوري',
        attendees: parseInt(m.Attendees_Count) || 0,
        recommendations: parseInt(m.Recommendations_Count) || 0
      }))
    };
  }
  
  function calculateDelayedMeetings(committee, meetings) {
    const config = COMMITTEE_CONFIG[committee];
    if (!config) return 0;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let expectedMeetings = 0;
    
    if (config.frequency === 'monthly') {
      // شهري: كل شهر ماعدا 7 (أغسطس) و11 (ديسمبر لبعض اللجان)
      expectedMeetings = Math.min(currentMonth + 1, 10);
    } else if (config.frequency === 'quarterly') {
      // ربع سنوي: مارس، يونيو، سبتمبر، ديسمبر
      const quarterMonths = [2, 5, 8, 11];
      expectedMeetings = quarterMonths.filter(m => m <= currentMonth).length;
    } else if (config.frequency === 'semiannual') {
      // نصف سنوي: يونيو وديسمبر
      const semiMonths = [5, 11];
      expectedMeetings = semiMonths.filter(m => m <= currentMonth).length;
    }
    
    return Math.max(0, expectedMeetings - meetings.length);
  }
  
  function saveMeeting(payload) {
    const sheet = getMeetingsSheet('Meetings_Log');
    if (!sheet) return { success: false, error: 'Meetings_Log sheet not found' };
    
    const now = getSaudiDate();
    const timestamp = now.toISOString();
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const row = headers.map(h => {
      switch(h) {
        case 'Meeting_ID': return `MTG-${payload.committee}-${Date.now()}`;
        case 'Committee': return payload.committee || '';
        case 'Date': return payload.date || '';
        case 'Meeting_Type': return payload.type || 'حضوري';
        case 'Zoom_Link': return payload.zoomLink || '';
        case 'Attendees': return (payload.attendees || []).join(', ');
        case 'Attendees_Count': return payload.attendeesCount || 0;
        case 'Quorum_Met': return payload.quorumMet ? 'Yes' : 'No';
        case 'Recommendations_Count': return (payload.recommendations || []).length;
        case 'Recorder': return payload.recorder || '';
        case 'Created_At': return timestamp;
        default: return '';
      }
    });
    
    sheet.appendRow(row);
    
    // حفظ التوصيات
    if (payload.recommendations && payload.recommendations.length > 0) {
      const recsSheet = getMeetingsSheet('Meeting_Recommendations');
      if (recsSheet) {
        const recsHeaders = recsSheet.getRange(1, 1, 1, recsSheet.getLastColumn()).getValues()[0];
        
        payload.recommendations.forEach((rec, idx) => {
          const recRow = recsHeaders.map(h => {
            switch(h) {
              case 'Rec_ID': return `REC-${payload.committee}-${Date.now()}-${idx}`;
              case 'Committee': return payload.committee || '';
              case 'Meeting_Date': return payload.date || '';
              case 'Recommendation': return rec;
              case 'Status': return 'Open';
              case 'Due_Date': return '';
              case 'Assigned_To': return '';
              case 'Created_At': return timestamp;
              default: return '';
            }
          });
          recsSheet.appendRow(recRow);
        });
      }
    }
    
    return { success: true, meetingId: `MTG-${payload.committee}-${Date.now()}` };
  }
  
  function getMeetingRecommendations(committee) {
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations'));
    
    let filtered = recommendations;
    if (committee) {
      filtered = recommendations.filter(r => r.Committee === committee);
    }
    
    return {
      recommendations: filtered.map(r => ({
        id: r.Rec_ID || r._rowIndex,
        rowIndex: r._rowIndex,
        committee: r.Committee,
        meetingDate: formatDate(r.Meeting_Date),
        recommendation: r.Recommendation,
        status: r.Status || 'Open',
        dueDate: formatDate(r.Due_Date),
        assignedTo: r.Assigned_To || '',
        closedDate: formatDate(r.Closed_Date),
        closedBy: r.Closed_By || ''
      }))
    };
  }
  
  function getDelayedMeetings(committee) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const delayed = [];
    
    for (const [code, config] of Object.entries(COMMITTEE_CONFIG)) {
      if (committee && code !== committee) continue;
      
      const year = new Date().getFullYear();
      const committeeMeetings = meetingsLog.filter(m => 
        m.Committee === code && String(m.Date).includes(String(year))
      );
      
      const delayCount = calculateDelayedMeetings(code, committeeMeetings);
      
      if (delayCount > 0) {
        delayed.push({
          committee: code,
          committeeName: config.name,
          completed: committeeMeetings.length,
          required: config.required,
          delayed: delayCount,
          lastMeeting: committeeMeetings.length > 0 ? formatDate(committeeMeetings[committeeMeetings.length - 1].Date) : 'لا يوجد'
        });
      }
    }
    
    return { delayed };
  }
  
  function closeMeetingRecommendation(params) {
    const sheet = getMeetingsSheet('Meeting_Recommendations');
    if (!sheet) return { success: false, error: 'Sheet not found' };
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row' };
    
    const statusCol = headers.indexOf('Status');
    const closedDateCol = headers.indexOf('Closed_Date');
    const closedByCol = headers.indexOf('Closed_By');
    
    if (statusCol === -1) return { success: false, error: 'Status column not found' };
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    sheet.getRange(rowIndex, statusCol + 1).setValue('Closed');
    
    if (closedDateCol !== -1) {
      sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
    }
    
    if (closedByCol !== -1) {
      sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
    }
    
    return { success: true };
  }
  
  function getMeetingsArchive(params) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const now = getSaudiDate();
    
    let filtered = meetingsLog;
    
    if (params.committee) {
      filtered = filtered.filter(m => m.Committee === params.committee);
    }
    
    if (params.year) {
      filtered = filtered.filter(m => String(m.Date).includes(String(params.year)));
    }
    
    // فلتر الفترة (بالشهور)
    if (params.period) {
      const months = parseInt(params.period) || 0;
      if (months > 0) {
        const cutoffDate = new Date(now);
        cutoffDate.setMonth(cutoffDate.getMonth() - months);
        filtered = filtered.filter(m => {
          const meetingDate = parseLogDate(m.Date);
          return meetingDate && meetingDate >= cutoffDate;
        });
      }
    }
    
    // فلتر الحالة
    if (params.status) {
      filtered = filtered.filter(m => {
        const meetingStatus = m.Quorum_Met === 'Yes' ? 'completed' : 'delayed';
        return meetingStatus === params.status;
      });
    }
    
    filtered.sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    return {
      meetings: filtered.map(m => ({
        id: m.Meeting_ID || '',
        committee: m.Committee,
        date: formatDate(m.Date),
        type: m.Meeting_Type || 'حضوري',
        attendees: m.Attendees || '',
        attendeesCount: parseInt(m.Attendees_Count) || 0,
        quorumMet: m.Quorum_Met === 'Yes',
        status: m.Quorum_Met === 'Yes' ? 'completed' : 'delayed',
        recommendations: m.Recommendations || '',
        recommendationsCount: parseInt(m.Recommendations_Count) || 0,
        recorder: m.Recorder || ''
      }))
    };
  }
  
  function getMeetingsDashboard(year) {
    const currentYear = year || new Date().getFullYear();
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations'));
    
    const yearMeetings = meetingsLog.filter(m => String(m.Date).includes(String(currentYear)));
    const yearRecs = recommendations.filter(r => String(r.Meeting_Date).includes(String(currentYear)));
    
    // إحصائيات حسب اللجنة
    const byCommittee = {};
    for (const [code, config] of Object.entries(COMMITTEE_CONFIG)) {
      const commMeetings = yearMeetings.filter(m => m.Committee === code);
      byCommittee[code] = {
        name: config.name,
        completed: commMeetings.length,
        required: config.required,
        percentage: Math.round((commMeetings.length / config.required) * 100)
      };
    }
    
    // إحصائيات التوصيات
    const openRecs = yearRecs.filter(r => String(r.Status).toLowerCase() !== 'closed').length;
    const closedRecs = yearRecs.filter(r => String(r.Status).toLowerCase() === 'closed').length;
    const overdueRecs = yearRecs.filter(r => {
      if (String(r.Status).toLowerCase() === 'closed') return false;
      if (!r.Due_Date) return false;
      return new Date(r.Due_Date) < new Date();
    }).length;
    
    // إحصائيات الحضور الشهرية
    const attendanceByMonth = {};
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 
                    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    
    yearMeetings.forEach(m => {
      const date = parseLogDate(m.Date);
      if (date) {
        const month = date.getMonth();
        if (!attendanceByMonth[month]) {
          attendanceByMonth[month] = { total: 0, count: 0 };
        }
        attendanceByMonth[month].total += parseInt(m.Attendees_Count) || 0;
        attendanceByMonth[month].count++;
      }
    });
    
    const monthlyAttendance = months.map((name, idx) => ({
      month: name,
      average: attendanceByMonth[idx] ? 
        Math.round(attendanceByMonth[idx].total / attendanceByMonth[idx].count) : 0
    }));
    
    return {
      year: currentYear,
      totalMeetings: yearMeetings.length,
      byCommittee,
      recommendations: {
        total: yearRecs.length,
        open: openRecs,
        closed: closedRecs,
        overdue: overdueRecs
      },
      monthlyAttendance
    };
  }
  
  // ============================================================
  // نظام بلاغات حوادث سلامة المرضى
  // Patient Safety Incidents System
  // (تم تعريف INCIDENTS_SPREADSHEET_ID في أعلى الملف)
  // ============================================================
  
  const INCIDENT_TYPES = {
    'medication_error': 'خطأ دوائي',
    'patient_fall': 'سقوط مريض',
    'infection': 'عدوى مكتسبة',
    'diagnosis_error': 'خطأ تشخيصي',
    'procedure_error': 'خطأ إجراءات',
    'near_miss': 'كاد يحدث (Near Miss)',
    'equipment_failure': 'عطل معدات',
    'communication': 'خطأ تواصل',
    'documentation': 'خطأ توثيق',
    'other': 'أخرى'
  };
  
  const SEVERITY_LEVELS = {
    'none': { name: 'بدون ضرر', color: '#28a745', priority: 1 },
    'minor': { name: 'ضرر بسيط', color: '#ffc107', priority: 2 },
    'moderate': { name: 'ضرر متوسط', color: '#fd7e14', priority: 3 },
    'severe': { name: 'ضرر جسيم', color: '#dc3545', priority: 4 },
    'death': { name: 'وفاة', color: '#000000', priority: 5 }
  };
  
  const INCIDENT_STATUS = {
    'new': 'جديد',
    'under_review': 'قيد المراجعة',
    'rca_required': 'يتطلب RCA',
    'in_progress': 'قيد المعالجة',
    'closed': 'مغلق'
  };
  
  function getIncidentsSheet(name) {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(name);
    
    if (!sheet) {
      sheet = ss.insertSheet(name);
      
      if (name === 'Incidents_Log') {
        sheet.appendRow([
          'Incident_ID', 'Date', 'Time', 'Report_Date', 'Department',
          'Incident_Type', 'Severity', 'Description', 'Discovery_Method',
          'Immediate_Action', 'Doctor_Notified', 'Patient_Notified',
          'Anonymous', 'Reporter_Name', 'Status', 'Assigned_To',
          'RCA_Required', 'Closed_Date', 'Closed_By', 'Root_Cause',
          'Corrective_Actions', 'Lessons_Learned'
        ]);
      } else if (name === 'Incidents_Followup') {
        sheet.appendRow([
          'Followup_ID', 'Incident_ID', 'Date', 'Action', 'By', 'Notes', 'Status'
        ]);
      }
    }
    
    return sheet;
  }
  
  function generateIncidentId() {
    const now = getSaudiDate();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `INC-${year}${month}-${random}`;
  }
  
  function submitIncident(payload) {
    if (!payload.incidentDate) {
      return { success: false, error: 'تاريخ الحادث مطلوب' };
    }
    if (!payload.department) {
      return { success: false, error: 'القسم مطلوب' };
    }
    if (!payload.incidentType) {
      return { success: false, error: 'نوع الحادث مطلوب' };
    }
    if (!payload.severity) {
      return { success: false, error: 'مستوى الخطورة مطلوب' };
    }
    if (!payload.description || payload.description.length < 10) {
      return { success: false, error: 'وصف الحادث مطلوب (10 أحرف على الأقل)' };
    }
    
    const sheet = getIncidentsSheet('Incidents_Log');
    const now = getSaudiDate();
    
    const incidentId = generateIncidentId();
    const reportDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const reportTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    const isAnonymous = payload.anonymous === true || payload.anonymous === 'true';
    const severity = payload.severity || 'none';
    const requiresRCA = ['severe', 'death', 'moderate'].includes(severity);
    const isSentinel = ['severe', 'death'].includes(severity);
    
    sheet.appendRow([
      incidentId,
      payload.incidentDate || reportDate,
      payload.incidentTime || '',
      reportDate + ' ' + reportTime,
      payload.department || '',
      payload.incidentType || '',
      severity,
      payload.description || '',
      payload.discoveryMethod || '',
      payload.immediateAction || '',
      payload.doctorNotified || 'لا',
      payload.patientNotified || 'لا',
      isAnonymous ? 'نعم' : 'لا',
      isAnonymous ? '' : (payload.reporterName || ''),
      isSentinel ? 'rca_required' : 'new',
      '',
      requiresRCA ? 'نعم' : 'لا',
      '',
      '',
      '',
      '',
      ''
    ]);
    
    return {
      success: true,
      incidentId: incidentId,
      message: 'تم تسجيل البلاغ بنجاح',
      requiresRCA: requiresRCA
    };
  }
  
  function getIncidents(params) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    
    let filtered = incidents;
    
    if (params.status && params.status !== 'all') {
      filtered = filtered.filter(i => i.Status === params.status);
    }
    
    if (params.department) {
      filtered = filtered.filter(i => i.Department === params.department);
    }
    
    if (params.severity) {
      filtered = filtered.filter(i => i.Severity === params.severity);
    }
    
    if (params.incidentType) {
      filtered = filtered.filter(i => i.Incident_Type === params.incidentType);
    }
    
    if (params.dateFrom) {
      filtered = filtered.filter(i => i.Date >= params.dateFrom);
    }
    
    if (params.dateTo) {
      filtered = filtered.filter(i => i.Date <= params.dateTo);
    }
    
    filtered.sort((a, b) => new Date(b.Report_Date) - new Date(a.Report_Date));
    
    const limit = params.limit || 100;
    filtered = filtered.slice(0, limit);
    
    return {
      incidents: filtered.map(i => ({
        id: i.Incident_ID,
        date: i.Date,
        time: i.Time,
        reportDate: i.Report_Date,
        department: i.Department,
        type: i.Incident_Type,
        typeName: INCIDENT_TYPES[i.Incident_Type] || i.Incident_Type,
        severity: i.Severity,
        severityName: SEVERITY_LEVELS[i.Severity]?.name || i.Severity,
        severityColor: SEVERITY_LEVELS[i.Severity]?.color || '#6c757d',
        description: i.Description,
        status: i.Status,
        statusName: INCIDENT_STATUS[i.Status] || i.Status,
        anonymous: i.Anonymous === 'نعم',
        rcaRequired: i.RCA_Required === 'نعم',
        rowIndex: i._rowIndex
      })),
      total: incidents.length,
      filtered: filtered.length
    };
  }
  
  function getIncidentDetails(incidentId) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    const incident = incidents.find(i => i.Incident_ID === incidentId);
    
    if (!incident) {
      return { success: false, error: 'البلاغ غير موجود' };
    }
    
    const followups = sheetToObjects(getIncidentsSheet('Incidents_Followup'));
    const incidentFollowups = followups
      .filter(f => f.Incident_ID === incidentId)
      .sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    return {
      success: true,
      incident: {
        id: incident.Incident_ID,
        date: incident.Date,
        time: incident.Time,
        reportDate: incident.Report_Date,
        department: incident.Department,
        type: incident.Incident_Type,
        typeName: INCIDENT_TYPES[incident.Incident_Type] || incident.Incident_Type,
        severity: incident.Severity,
        severityName: SEVERITY_LEVELS[incident.Severity]?.name || incident.Severity,
        severityColor: SEVERITY_LEVELS[incident.Severity]?.color || '#6c757d',
        description: incident.Description,
        discoveryMethod: incident.Discovery_Method,
        immediateAction: incident.Immediate_Action,
        doctorNotified: incident.Doctor_Notified,
        patientNotified: incident.Patient_Notified,
        anonymous: incident.Anonymous === 'نعم',
        reporterName: incident.Reporter_Name,
        status: incident.Status,
        statusName: INCIDENT_STATUS[incident.Status] || incident.Status,
        assignedTo: incident.Assigned_To,
        rcaRequired: incident.RCA_Required === 'نعم',
        closedDate: incident.Closed_Date,
        closedBy: incident.Closed_By,
        rootCause: incident.Root_Cause,
        correctiveActions: incident.Corrective_Actions,
        lessonsLearned: incident.Lessons_Learned,
        rowIndex: incident._rowIndex
      },
      followups: incidentFollowups.map(f => ({
        id: f.Followup_ID,
        date: f.Date,
        action: f.Action,
        by: f.By,
        notes: f.Notes,
        status: f.Status
      }))
    };
  }
  
  function updateIncidentStatus(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const updates = {};
    
    if (params.status) {
      const statusCol = headers.indexOf('Status');
      if (statusCol !== -1) {
        sheet.getRange(rowIndex, statusCol + 1).setValue(params.status);
      }
      
      if (params.status === 'closed') {
        const closedDateCol = headers.indexOf('Closed_Date');
        const closedByCol = headers.indexOf('Closed_By');
        if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
        if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
      }
    }
    
    if (params.assignedTo) {
      const col = headers.indexOf('Assigned_To');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.assignedTo);
    }
    
    if (params.rootCause) {
      const col = headers.indexOf('Root_Cause');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.rootCause);
    }
    
    if (params.correctiveActions) {
      const col = headers.indexOf('Corrective_Actions');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.correctiveActions);
    }
    
    if (params.lessonsLearned) {
      const col = headers.indexOf('Lessons_Learned');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.lessonsLearned);
    }
    
    return { success: true, message: 'تم تحديث البلاغ بنجاح' };
  }
  
  function addIncidentFollowup(params) {
    const sheet = getIncidentsSheet('Incidents_Followup');
    const now = getSaudiDate();
    
    const followupId = `FU-${Date.now()}`;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    sheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      params.action || '',
      params.by || '',
      params.notes || '',
      params.status || 'pending'
    ]);
    
    return { success: true, followupId: followupId };
  }
  
  function getIncidentStats(params) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    const now = getSaudiDate();
    const currentYear = params.year || now.getFullYear();
    
    const yearIncidents = incidents.filter(i => {
      const date = i.Date || i.Report_Date;
      return date && String(date).includes(String(currentYear));
    });
    
    // إحصائيات حسب النوع
    const byType = {};
    for (const [code, name] of Object.entries(INCIDENT_TYPES)) {
      byType[code] = {
        name: name,
        count: yearIncidents.filter(i => i.Incident_Type === code).length
      };
    }
    
    // إحصائيات حسب الخطورة
    const bySeverity = {};
    for (const [code, config] of Object.entries(SEVERITY_LEVELS)) {
      bySeverity[code] = {
        name: config.name,
        color: config.color,
        count: yearIncidents.filter(i => i.Severity === code).length
      };
    }
    
    // إحصائيات حسب الحالة
    const byStatus = {};
    for (const [code, name] of Object.entries(INCIDENT_STATUS)) {
      byStatus[code] = {
        name: name,
        count: yearIncidents.filter(i => i.Status === code).length
      };
    }
    
    // إحصائيات شهرية
    const byMonth = {};
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    
    yearIncidents.forEach(i => {
      const date = parseLogDate(i.Date || i.Report_Date);
      if (date) {
        const month = date.getMonth();
        if (!byMonth[month]) byMonth[month] = 0;
        byMonth[month]++;
      }
    });
    
    const monthlyStats = months.map((name, idx) => ({
      month: name,
      count: byMonth[idx] || 0
    }));
    
    // نسبة Near Miss
    const nearMissCount = yearIncidents.filter(i => i.Incident_Type === 'near_miss').length;
    const nearMissPercentage = yearIncidents.length > 0 ?
      Math.round((nearMissCount / yearIncidents.length) * 100) : 0;
    
    // البلاغات المفتوحة
    const openIncidents = yearIncidents.filter(i => i.Status !== 'closed').length;
    
    // متوسط وقت الإغلاق (بالأيام)
    const closedIncidents = yearIncidents.filter(i => i.Status === 'closed' && i.Closed_Date);
    let avgClosureTime = 0;
    if (closedIncidents.length > 0) {
      const totalDays = closedIncidents.reduce((sum, i) => {
        const reportDate = parseLogDate(i.Report_Date);
        const closedDate = parseLogDate(i.Closed_Date);
        if (reportDate && closedDate) {
          return sum + Math.ceil((closedDate - reportDate) / (1000 * 60 * 60 * 24));
        }
        return sum;
      }, 0);
      avgClosureTime = Math.round(totalDays / closedIncidents.length);
    }
    
    return {
      year: currentYear,
      total: yearIncidents.length,
      open: openIncidents,
      closed: yearIncidents.length - openIncidents,
      nearMissPercentage: nearMissPercentage,
      avgClosureTime: avgClosureTime,
      byType,
      bySeverity,
      byStatus,
      monthlyStats
    };
  }

  // ==================== إحصائيات لوحة المالك ====================
  function getOwnerDashboardStats(params) {
    try {
      // التحقق من الصلاحيات باستخدام Firebase Token - فقط owner أو admin
      if (!params) {
        return { success: false, error: 'البيانات مطلوبة' };
      }
      
      // التحقق من الهوية عبر Firebase
      try {
        validateStaffAuth_(params, ['owner', 'admin']);
      } catch (authError) {
        return { success: false, error: authError.message || 'غير مصرح لك بالوصول لهذه البيانات' };
      }
      
      const now = getSaudiDate();
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      
      // جلب حالة الطوارئ من EOC_SPREADSHEET_ID
      let emergency = { active: false };
      try {
        const eocSheet = SpreadsheetApp.openById(EOC_SPREADSHEET_ID).getSheetByName('EOC_Status');
        if (eocSheet) {
          const eocData = sheetToObjects(eocSheet);
          const activeEmergency = eocData.find(e => 
            String(e.Status || e.الحالة || '').toLowerCase() === 'active' ||
            String(e.Status || e.الحالة || '') === 'نشط'
          );
          if (activeEmergency) {
            emergency = {
              active: true,
              type: activeEmergency.Type || activeEmergency.النوع || 'حالة طوارئ',
              message: activeEmergency.Message || activeEmergency.الرسالة || 'تنبيه طوارئ نشط!'
            };
          }
        }
      } catch(e) {}
      
      // جلب إحصائيات الحوادث
      let incidents = { open: 0, new: 0, investigation: 0, escalated: 0, closed: 0 };
      try {
        const incSheet = getIncidentsSheet('Incidents_Log');
        if (incSheet) {
          const incData = sheetToObjects(incSheet);
          incData.forEach(i => {
            const status = String(i.Status || '').toLowerCase();
            if (status === 'new' || status === '') {
              incidents.new++;
            } else if (status === 'under_investigation') {
              incidents.investigation++;
            } else if (status === 'escalated') {
              incidents.escalated++;
            } else if (status === 'closed') {
              incidents.closed++;
            }
          });
          incidents.open = incidents.new + incidents.investigation + incidents.escalated;
        }
      } catch(e) {}
      
      // جلب إحصائيات المخاطر
      let risks = { active: 0, high: 0, medium: 0, low: 0, resolved: 0 };
      try {
        const riskSheet = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID).getSheetByName('Risks_Register');
        if (riskSheet) {
          const riskData = sheetToObjects(riskSheet);
          riskData.forEach(r => {
            const level = String(r.Risk_Level || r.مستوى_الخطر || '').toLowerCase();
            const status = String(r.Status || r.الحالة || '').toLowerCase();
            if (status === 'resolved' || status === 'معالج') {
              risks.resolved++;
            } else {
              if (level === 'high' || level === 'عالي') risks.high++;
              else if (level === 'medium' || level === 'متوسط') risks.medium++;
              else if (level === 'low' || level === 'منخفض') risks.low++;
            }
          });
          risks.active = risks.high + risks.medium + risks.low;
        }
      } catch(e) {}
      
      // بناء قائمة التنبيهات
      let alerts = [];
      if (emergency.active) {
        alerts.push({ type: 'danger', message: emergency.message, count: null });
      }
      if (incidents.escalated > 0) {
        alerts.push({ type: 'danger', message: 'حوادث مصعدة تحتاج تدخل', count: incidents.escalated });
      }
      if (risks.high > 0) {
        alerts.push({ type: 'warning', message: 'مخاطر عالية المستوى', count: risks.high });
      }
      if (incidents.new > 3) {
        alerts.push({ type: 'warning', message: 'حوادث جديدة تنتظر التحقيق', count: incidents.new });
      }
      
      return {
        success: true,
        emergency,
        incidents,
        risks,
        alerts,
        lastUpdate: now.toISOString()
      };
    } catch(e) {
      return { success: false, error: e.message };
    }
  }

  // ==================== نظام المتابعين والتعيين ====================
  // يقرأ من شيت On_Charge: عمود A=الاسم, B=الرمز, C=التصعيد

  function getIncidentStaff() {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('On_Charge');
    
    if (!sheet) {
      return { staff: [], escalationList: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { staff: [], escalationList: [] };
    }
    
    // أرقام الأعمدة مباشرة: A=0, B=1, C=2
    const staff = [];
    const escalationList = [];
    
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();      // عمود A - الاسم
      const code = String(data[i][1] || '').trim();      // عمود B - الرمز
      const escalateTo = String(data[i][2] || '').trim(); // عمود C - التصعيد
      
      if (name) {
        staff.push({
          name: name,
          hasCode: code.length > 0
        });
        
        if (escalateTo) {
          escalationList.push({
            name: escalateTo,
            role: 'مسؤول تصعيد'
          });
        }
      }
    }
    
    // إزالة التكرارات
    const uniqueEscalation = [...new Map(escalationList.map(e => [e.name, e])).values()];
    
    return { staff, escalationList: uniqueEscalation };
  }

  function verifyIncidentPasscode(staffName, passcode) {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('On_Charge');
    
    if (!sheet) {
      return { verified: false, error: 'شيت On_Charge غير موجود' };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { verified: false, error: 'لا توجد بيانات' };
    }
    
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();  // عمود A
      const code = String(data[i][1] || '').trim();  // عمود B
      
      if (name === staffName && code === String(passcode).trim()) {
        return { verified: true, staffName: name };
      }
    }
    
    return { verified: false, error: 'الاسم أو الرمز غير صحيح' };
  }

  function getEscalationList() {
    const result = getIncidentStaff();
    return { escalationList: result.escalationList || [] };
  }

  function assignIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const assignedCol = headers.indexOf('Assigned_To');
    const statusCol = headers.indexOf('Status');
    
    if (assignedCol !== -1) {
      sheet.getRange(rowIndex, assignedCol + 1).setValue(params.assignedTo);
    }
    
    if (statusCol !== -1 && params.assignedTo) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('under_review');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم تعيين المسؤول: ${params.assignedTo}`,
      params.assignedBy || 'النظام',
      params.notes || '',
      'completed'
    ]);
    
    return { success: true, message: 'تم تعيين المسؤول بنجاح' };
  }

  function escalateIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const statusCol = headers.indexOf('Status');
    const rcaCol = headers.indexOf('RCA_Required');
    
    if (statusCol !== -1) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('rca_required');
    }
    
    if (rcaCol !== -1) {
      sheet.getRange(rowIndex, rcaCol + 1).setValue('نعم');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم تصعيد الحادث - يتطلب تحليل السبب الجذري (RCA)`,
      params.escalatedBy || 'النظام',
      params.reason || '',
      'pending'
    ]);
    
    return { success: true, message: 'تم تصعيد الحادث بنجاح' };
  }

  function closeIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const statusCol = headers.indexOf('Status');
    const closedDateCol = headers.indexOf('Closed_Date');
    const closedByCol = headers.indexOf('Closed_By');
    const correctiveCol = headers.indexOf('Corrective_Actions');
    
    if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('closed');
    if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
    if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
    if (correctiveCol !== -1 && params.correctiveActions) {
      sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions);
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم إغلاق البلاغ`,
      params.closedBy || 'النظام',
      params.summary || '',
      'completed'
    ]);
    
    return { success: true, message: 'تم إغلاق البلاغ بنجاح' };
  }

  function saveRCA(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const rootCauseCol = headers.indexOf('Root_Cause');
    const correctiveCol = headers.indexOf('Corrective_Actions');
    const lessonsCol = headers.indexOf('Lessons_Learned');
    const statusCol = headers.indexOf('Status');
    
    if (rootCauseCol !== -1) sheet.getRange(rowIndex, rootCauseCol + 1).setValue(params.rootCause || '');
    if (correctiveCol !== -1) sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions || '');
    if (lessonsCol !== -1) sheet.getRange(rowIndex, lessonsCol + 1).setValue(params.lessonsLearned || '');
    
    if (statusCol !== -1) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('in_progress');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم إكمال تحليل السبب الجذري (RCA)`,
      params.analyzedBy || 'النظام',
      `السبب: ${(params.rootCause || '').substring(0, 100)}...`,
      'completed'
    ]);
    
    return { success: true, message: 'تم حفظ تحليل السبب الجذري بنجاح' };
  }

  /******************************************************
   * قائمة فحص جاهزية الطوارئ - Readiness Checklist
   ******************************************************/
  
  function ensureReadinessSheets_() {
    const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
    
    // EOC_DEPARTMENTS sheet
    let deptSheet = ss.getSheetByName('EOC_DEPARTMENTS');
    if (!deptSheet) {
      deptSheet = ss.insertSheet('EOC_DEPARTMENTS');
      deptSheet.appendRow(['ID', 'Name', 'Floor', 'Active']);
      // Default departments
      const defaultDepts = [
        ['reception', 'الاستقبال', 'الأول', 'TRUE'],
        ['batiniya1', 'الباطنية 1', 'الثاني', 'TRUE'],
        ['batiniya2', 'الباطنية 2', 'الثاني', 'TRUE'],
        ['batiniya3', 'الباطنية 3', 'الثاني', 'TRUE'],
        ['dental', 'الأسنان', 'الثاني', 'TRUE'],
        ['emergency', 'الطوارئ', 'الأول', 'TRUE'],
        ['general', 'الطب العام', 'الأول', 'TRUE'],
        ['lab', 'المختبر', 'الأول', 'TRUE'],
        ['pharmacy', 'الصيدلية', 'الأول', 'TRUE'],
        ['nursery', 'النساء والولادة', 'الأول', 'TRUE'],
        ['mens', 'استقبال رجال', 'الأول', 'TRUE'],
        ['admin', 'الإدارة', 'الثاني', 'TRUE']
      ];
      defaultDepts.forEach(row => deptSheet.appendRow(row));
    }
    
    // EOC_READINESS sheet
    let readinessSheet = ss.getSheetByName('EOC_READINESS');
    if (!readinessSheet) {
      readinessSheet = ss.insertSheet('EOC_READINESS');
      readinessSheet.appendRow([
        'ID', 'Check_Date', 'Department_ID', 'Department_Name',
        'Exits', 'Lights', 'Extinguishers', 'FirstAid', 'Alarm',
        'Last_Check', 'Responsible', 'Notes', 'Created_At', 'Created_By'
      ]);
    }
    
    return { deptSheet, readinessSheet };
  }
  
  function getReadinessDepartments() {
    try {
      const { deptSheet } = ensureReadinessSheets_();
      const data = deptSheet.getDataRange().getValues();
      
      if (data.length <= 1) {
        return { ok: true, departments: [] };
      }
      
      const headers = data[0];
      const departments = [];
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const active = String(row[3]).toUpperCase() === 'TRUE';
        if (active) {
          departments.push({
            id: row[0],
            name: row[1],
            floor: row[2]
          });
        }
      }
      
      return { ok: true, departments };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function saveReadinessCheck(params) {
    try {
      const { readinessSheet } = ensureReadinessSheets_();
      const checkDate = params.checkDate || new Date().toISOString().split('T')[0];
      const createdAt = new Date().toISOString();
      const createdBy = params.createdBy || 'النظام';
      const data = params.data ? JSON.parse(params.data) : {};
      
      // حفظ صف لكل قسم
      let savedCount = 0;
      for (const [deptId, checks] of Object.entries(data)) {
        const id = `RC-${Date.now()}-${savedCount}`;
        readinessSheet.appendRow([
          id,
          checkDate,
          deptId,
          checks.deptName || deptId,
          checks.exits || '',
          checks.lights || '',
          checks.extinguishers || '',
          checks.firstaid || '',
          checks.alarm || '',
          checks.lastCheck || '',
          checks.responsible || '',
          checks.notes || '',
          createdAt,
          createdBy
        ]);
        savedCount++;
      }
      
      return { ok: true, message: 'تم حفظ ' + savedCount + ' سجل بنجاح', savedCount };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function getReadinessHistory(params) {
    try {
      const { readinessSheet } = ensureReadinessSheets_();
      const data = readinessSheet.getDataRange().getValues();
      
      if (data.length <= 1) {
        return { ok: true, history: [], dates: [] };
      }
      
      const headers = data[0];
      const records = [];
      const datesSet = new Set();
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const checkDate = row[1];
        datesSet.add(checkDate);
        
        records.push({
          id: row[0],
          checkDate: checkDate,
          departmentId: row[2],
          departmentName: row[3],
          exits: row[4],
          lights: row[5],
          extinguishers: row[6],
          firstaid: row[7],
          alarm: row[8],
          lastCheck: row[9],
          responsible: row[10],
          notes: row[11],
          createdAt: row[12]
        });
      }
      
      // ترتيب حسب التاريخ (الأحدث أولاً)
      records.sort((a, b) => new Date(b.checkDate) - new Date(a.checkDate));
      
      // تجميع حسب التاريخ
      const groupedByDate = {};
      records.forEach(rec => {
        if (!groupedByDate[rec.checkDate]) {
          groupedByDate[rec.checkDate] = [];
        }
        groupedByDate[rec.checkDate].push(rec);
      });
      
      const dates = Array.from(datesSet).sort((a, b) => new Date(b) - new Date(a));
      
      // إرجاع آخر 50 سجل فقط
      const limit = params.limit ? parseInt(params.limit) : 50;
      
      return { 
        ok: true, 
        history: records.slice(0, limit),
        groupedByDate,
        dates: dates.slice(0, 30)
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  

// ======== Patient Portal Functions ========
// (تم تعريف PATIENTS_SPREADSHEET_ID في أعلى الملف)

/**
 * تسجيل مريض جديد
 */
function registerPatient(payload) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Patients");
    
    if (!sheet) {
      sheet = ss.insertSheet("Patients");
      sheet.appendRow(["UID", "Email", "Name", "Phone", "Role", "CreatedAt", "LastLogin"]);
    }
    
    const existingData = sheet.getDataRange().getValues();
    const uidCol = 0;
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][uidCol] === payload.uid) {
        sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
        return { success: true, message: "تم تحديث آخر دخول" };
      }
    }
    
    sheet.appendRow(safeCellArray_([
      payload.uid,
      payload.email,
      payload.name || "مريض جديد",
      payload.phone || "",
      "patient",
      payload.createdAt || new Date().toISOString(),
      new Date().toISOString()
    ]));
    
    return { success: true, message: "تم تسجيل المريض بنجاح" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * جلب ملف المريض
 */
function getPatientProfile(patientId) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Patients");
    if (!sheet) return { profile: null };
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === patientId) {
        return {
          profile: {
            uid: data[i][0],
            email: data[i][1],
            name: data[i][2],
            phone: data[i][3],
            role: data[i][4],
            createdAt: data[i][5]
          }
        };
      }
    }
    return { profile: null };
  } catch (err) {
    return { profile: null, error: err.message };
  }
}

/**
 * حجز موعد جديد
 */
function bookAppointment(payload) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName("Appointments");
    
    if (!sheet) {
      sheet = ss.insertSheet("Appointments");
      sheet.appendRow(["ID", "PatientID", "PatientName", "PatientEmail", "Department", "DoctorID", "DoctorName", "Date", "Time", "Notes", "Status", "CreatedAt"]);
    }
    
    const appointmentId = "APT-" + Date.now();
    
    sheet.appendRow(safeCellArray_([
      appointmentId,
      payload.patientId,
      payload.patientName,
      payload.patientEmail,
      payload.department,
      payload.doctorId,
      payload.doctorName,
      payload.date,
      payload.time,
      payload.notes || "",
      payload.status || "pending",
      new Date().toISOString()
    ]));
    
    return { success: true, appointmentId: appointmentId, message: "تم حجز الموعد بنجاح" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * جلب مواعيد المريض
 */
function getPatientAppointments(patientId) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Appointments");
    if (!sheet) return { appointments: [] };
    
    const data = sheet.getDataRange().getValues();
    const appointments = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === patientId) {
        appointments.push({
          id: data[i][0],
          department: data[i][4],
          doctorName: data[i][6],
          date: data[i][7],
          time: data[i][8],
          notes: data[i][9],
          status: data[i][10],
          createdAt: data[i][11]
        });
      }
    }
    
    appointments.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { appointments: appointments };
  } catch (err) {
    return { appointments: [], error: err.message };
  }
}

/**
 * إلغاء موعد
 */
function cancelAppointment(payload) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("Appointments");
    if (!sheet) return { success: false, error: "لا توجد مواعيد" };
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.appointmentId && data[i][1] === payload.patientId) {
        sheet.getRange(i + 1, 11).setValue("cancelled");
        return { success: true, message: "تم إلغاء الموعد" };
      }
    }
    return { success: false, error: "الموعد غير موجود" };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * جلب نتائج فحوصات المريض
 */
function getPatientResults(patientId) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName("LabResults");
    if (!sheet) return { results: [] };
    
    const data = sheet.getDataRange().getValues();
    const results = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === patientId) {
        results.push({
          id: data[i][0],
          testType: data[i][2],
          result: data[i][3],
          date: data[i][4],
          fileUrl: data[i][5] || null
        });
      }
    }
    
    return { results: results };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

/**
 * حفظ أعراض المريض
 */
function submitPatientSymptoms(payload) {
  try {
    const ss = SpreadsheetApp.openById(PATIENTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName("PatientSymptoms");
    
    if (!sheet) {
      sheet = ss.insertSheet("PatientSymptoms");
      sheet.appendRow(["ID", "PatientID", "Symptoms", "Duration", "ChronicDiseases", "AIResponse", "CreatedAt"]);
    }
    
    const symptomId = "SYM-" + Date.now();
    
    sheet.appendRow(safeCellArray_([
      symptomId,
      payload.patientId,
      payload.symptoms,
      payload.duration,
      payload.chronic || "",
      payload.aiResponse || "",
      new Date().toISOString()
    ]));
    
    return { success: true, symptomId: symptomId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * تحليل الأعراض بالذكاء الاصطناعي
 */
function analyzeSymptoms(payload) {
  try {
    const symptoms = payload.symptoms || "";
    const duration = payload.duration || "";
    const chronic = payload.chronic || "";
    
    const specialtyMap = {
      "صداع|رأس|دوخة|غثيان": "الباطنية أو الطب العام",
      "عين|نظر|رؤية|ضبابية": "طب العيون",
      "أسنان|ضرس|لثة|فم": "طب الأسنان",
      "حمل|دورة|نساء|ولادة": "النساء والولادة",
      "عظام|مفاصل|ظهر|ركبة": "العظام والمفاصل",
      "سكري|ضغط|قلب|كلى": "الباطنية"
    };
    
    let recommendedDept = "الطب العام";
    for (const [pattern, dept] of Object.entries(specialtyMap)) {
      if (new RegExp(pattern, "i").test(symptoms)) {
        recommendedDept = dept;
        break;
      }
    }
    
    submitPatientSymptoms(payload);
    
    return {
      success: true,
      recommendation: recommendedDept,
      message: "بناءً على الأعراض المذكورة، ننصحك بزيارة قسم " + recommendedDept
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ==================== MRIS Chunk Upload Backend ====================
// (تم تعريف MRIS_SHEET_ID في أعلى الملف)

// ⚠️ مهم: استبدل هذا بـ Folder ID حقيقي من Google Drive
const MRIS_UPLOAD_FOLDER_ID = 'PUT_YOUR_DRIVE_FOLDER_ID_HERE';
const MRIS_TEMP_FOLDER_NAME = 'MRIS_TEMP_UPLOADS';

function requireMrisToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('MRIS_TOKEN');
  if (!expected) return;
  const got = String(token || '').trim();
  if (got !== expected) throw new Error('Unauthorized: invalid token');
}

function mrisMonthKey_(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function ensureMrisUploadSheet_() {
  const ss = SpreadsheetApp.openById(MRIS_SHEET_ID);
  let sh = ss.getSheetByName('MRIS_Upload_Log');
  if (!sh) {
    sh = ss.insertSheet('MRIS_Upload_Log');
    sh.appendRow([
      'Timestamp', 'MonthKey', 'ReportType', 'FileName', 'MimeType',
      'FileSizeBytes', 'DriveFileId', 'DriveUrl', 'UploadedBy',
      'UploadedByEmail', 'Notes', 'SessionId'
    ]);
  }
  return sh;
}

function ensureMrisTempRootFolder_() {
  const root = DriveApp.getRootFolder();
  const it = root.getFoldersByName(MRIS_TEMP_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return root.createFolder(MRIS_TEMP_FOLDER_NAME);
}

function ensureMrisSessionFolder_(sessionId) {
  const tempRoot = ensureMrisTempRootFolder_();
  const it = tempRoot.getFoldersByName(sessionId);
  if (it.hasNext()) return it.next();
  return tempRoot.createFolder(sessionId);
}

function startMrisUpload_(payload) {
  requireMrisToken_(payload.token);
  
  const reportType = String(payload.reportType || '').trim();
  const fileName = String(payload.fileName || '').trim();
  const mimeType = String(payload.mimeType || 'application/octet-stream').trim();
  const fileSize = Number(payload.fileSize || 0);
  
  if (!reportType) throw new Error('reportType is required');
  if (!fileName) throw new Error('fileName is required');
  
  const now = new Date();
  const sessionId = `MRIS_${now.getTime()}_${Math.random().toString(36).slice(2,10)}`;
  const folder = ensureMrisSessionFolder_(sessionId);
  
  const meta = {
    sessionId,
    createdAt: now.toISOString(),
    reportType,
    fileName,
    mimeType,
    fileSize,
    uploadedBy: payload.uploadedBy || '',
    uploadedByEmail: payload.uploadedByEmail || '',
    notes: payload.notes || ''
  };
  folder.createFile('meta.json', JSON.stringify(meta, null, 2), MimeType.PLAIN_TEXT);
  
  return { sessionId };
}

function uploadMrisChunk_(payload) {
  requireMrisToken_(payload.token);
  
  const sessionId = String(payload.sessionId || '').trim();
  const index = Number(payload.index);
  const total = Number(payload.total);
  const chunkBase64 = String(payload.chunkBase64 || '').trim();
  
  if (!sessionId) throw new Error('sessionId is required');
  if (!Number.isFinite(index) || index < 0) throw new Error('index invalid');
  if (!Number.isFinite(total) || total <= 0) throw new Error('total invalid');
  if (!chunkBase64) throw new Error('chunkBase64 is required');
  
  const folder = ensureMrisSessionFolder_(sessionId);
  const name = `chunk_${String(index).padStart(6,'0')}.b64`;
  folder.createFile(name, chunkBase64, MimeType.PLAIN_TEXT);
  
  return { received: index, total };
}

function finishMrisUpload_(payload) {
  requireMrisToken_(payload.token);
  
  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) throw new Error('sessionId is required');
  
  const folder = ensureMrisSessionFolder_(sessionId);
  
  let meta = null;
  const metaIt = folder.getFilesByName('meta.json');
  if (metaIt.hasNext()) {
    meta = JSON.parse(metaIt.next().getBlob().getDataAsString('UTF-8'));
  }
  if (!meta) throw new Error('meta.json not found');
  
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    if (n.startsWith('chunk_') && n.endsWith('.b64')) files.push(f);
  }
  if (!files.length) throw new Error('No chunks found');
  
  files.sort((a,b) => a.getName().localeCompare(b.getName()));
  
  let totalLen = 0;
  const byteParts = [];
  for (const f of files) {
    const b64 = f.getBlob().getDataAsString('UTF-8');
    const bytes = Utilities.base64Decode(b64);
    byteParts.push(bytes);
    totalLen += bytes.length;
  }
  
  const all = new Array(totalLen);
  let offset = 0;
  for (const part of byteParts) {
    for (let i = 0; i < part.length; i++) {
      all[offset + i] = part[i];
    }
    offset += part.length;
  }
  
  const finalFolder = DriveApp.getFolderById(MRIS_UPLOAD_FOLDER_ID);
  const blob = Utilities.newBlob(all, meta.mimeType || 'application/octet-stream', meta.fileName || 'upload.bin');
  const finalFile = finalFolder.createFile(blob);
  
  const sh = ensureMrisUploadSheet_();
  const now = new Date();
  sh.appendRow(safeCellArray_([
    now.toISOString(),
    mrisMonthKey_(now),
    meta.reportType,
    meta.fileName,
    meta.mimeType,
    Number(meta.fileSize || totalLen),
    finalFile.getId(),
    finalFile.getUrl(),
    meta.uploadedBy || '',
    meta.uploadedByEmail || '',
    meta.notes || '',
    sessionId
  ]));
  
  folder.setTrashed(true);
  
  return {
    fileId: finalFile.getId(),
    fileUrl: finalFile.getUrl(),
    bytes: totalLen,
    sessionId,
    timestamp: now.toISOString()
  };
}

function getMrisUploadStatus_(payload) {
  requireMrisToken_(payload.token);
  
  const sh = ensureMrisUploadSheet_();
  const data = sh.getDataRange().getValues();
  const mk = mrisMonthKey_(new Date());
  
  const lastByType = {};
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const rowMonth = String(row[1] || '');
    if (rowMonth !== mk) continue;
    const type = String(row[2] || '');
    if (!type || lastByType[type]) continue;
    
    lastByType[type] = {
      timestamp: row[0] || '',
      fileName: row[3] || '',
      driveUrl: row[7] || '',
      uploadedBy: row[8] || ''
    };
  }
  
  const assignments = getMrisAssignments_().assignments || {};
  return { monthKey: mk, lastByType, assignments };
}

// ===== MRIS Assignment Functions =====
const MRIS_SHEET_ASSIGNMENTS = 'MRIS_Assignments';

function ensureMrisAssignmentsSheet_() {
  const ss = SpreadsheetApp.openById(MRIS_SHEET_ID);
  let sh = ss.getSheetByName(MRIS_SHEET_ASSIGNMENTS);
  if (!sh) {
    sh = ss.insertSheet(MRIS_SHEET_ASSIGNMENTS);
    sh.appendRow(['reportType', 'assigneeName', 'assigneeEmail', 'deadlineDay', 'updatedAt', 'updatedBy']);
  }
  return sh;
}

function setMrisAssignment_(payload) {
  requireMrisToken_(payload.token);
  
  const reportType = String(payload.reportType || '').trim();
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const deadlineDay = Number(payload.deadlineDay || 5);
  
  if (!reportType) throw new Error('reportType required');
  if (!name) throw new Error('name required');
  
  const sh = ensureMrisAssignmentsSheet_();
  const data = sh.getDataRange().getValues();
  const updatedAt = new Date().toISOString();
  const updatedBy = String(payload.actor || payload.staffEmail || payload.email || 'system');
  
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === reportType) {
      sh.getRange(i + 1, 2).setValue(name);
      sh.getRange(i + 1, 3).setValue(email);
      sh.getRange(i + 1, 4).setValue(deadlineDay);
      sh.getRange(i + 1, 5).setValue(updatedAt);
      sh.getRange(i + 1, 6).setValue(updatedBy);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sh.appendRow([reportType, name, email, deadlineDay, updatedAt, updatedBy]);
  }
  
  return { saved: true };
}

function getMrisAssignments_() {
  const sh = ensureMrisAssignmentsSheet_();
  const data = sh.getDataRange().getValues();
  
  const assignments = {};
  for (let i = 1; i < data.length; i++) {
    const rt = String(data[i][0] || '').trim();
    if (!rt) continue;
    assignments[rt] = {
      name: String(data[i][1] || '').trim(),
      email: String(data[i][2] || '').trim(),
      deadlineDay: Number(data[i][3] || 5),
      updatedAt: data[i][4] || '',
      updatedBy: data[i][5] || ''
    };
  }
  
  return { assignments };
}

// ===== MRIS Heatmap / KPIs / Evidence =====
const MRIS_SHEET_HEATMAP = 'MRIS_Heatmap';
const MRIS_SHEET_KPIS = 'MRIS_KPIs';
const MRIS_SHEET_EVIDENCE = 'MRIS_EvidencePack';

function getMrisHeatmap_() {
  const ss = SpreadsheetApp.openById(MRIS_SHEET_ID);
  const sh = ss.getSheetByName(MRIS_SHEET_HEATMAP);
  if (!sh || sh.getLastRow() < 2) {
    return { data: [
      { deptId:'reception', name:'الاستقبال', floor:1, required:2, actual:2 },
      { deptId:'dental', name:'الأسنان', floor:2, required:4, actual:3 },
      { deptId:'emergency', name:'الطوارئ', floor:1, required:3, actual:3 }
    ]};
  }
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const data = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    data.push({
      deptId: String(row[headers.indexOf('deptId')] || row[0] || '').trim(),
      name: String(row[headers.indexOf('name')] || row[1] || '').trim(),
      floor: Number(row[headers.indexOf('floor')] || row[2] || 1),
      required: Number(row[headers.indexOf('required')] || row[3] || 0),
      actual: Number(row[headers.indexOf('actual')] || row[4] || 0)
    });
  }
  return { data: data.filter(x => x.deptId && x.name) };
}

function getMrisKpis_() {
  const ss = SpreadsheetApp.openById(MRIS_SHEET_ID);
  const sh = ss.getSheetByName(MRIS_SHEET_KPIS);
  if (!sh || sh.getLastRow() < 2) {
    return { data: { stressIndex: 25, consumptionIntegrity: 92, riskLevel: 'low' } };
  }
  const values = sh.getDataRange().getValues();
  const obj = {};
  for (let i = 1; i < values.length; i++) {
    const k = String(values[i][0] || '').trim();
    const v = values[i][1];
    if (k) obj[k] = v;
  }
  return { data: {
    stressIndex: Number(obj.stressIndex || 25),
    consumptionIntegrity: Number(obj.consumptionIntegrity || 92),
    riskLevel: String(obj.riskLevel || 'low')
  }};
}

function getMrisEvidencePack_(payload) {
  requireMrisToken_(payload.token);
  const standardRef = String(payload.standardRef || 'LD4.5').trim();
  const deptId = String(payload.deptId || '').trim();
  
  const ss = SpreadsheetApp.openById(MRIS_SHEET_ID);
  const sh = ss.getSheetByName(MRIS_SHEET_EVIDENCE);
  if (!sh || sh.getLastRow() < 2) return { data: [] };
  
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const items = [];
  
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const sr = String(row[headers.indexOf('standardRef')] || row[0] || '').trim();
    const d = String(row[headers.indexOf('deptId')] || row[1] || '').trim();
    
    if (standardRef && sr !== standardRef) continue;
    if (deptId && d !== deptId) continue;
    
    items.push({
      standardRef: sr,
      deptId: d,
      evidenceType: String(row[headers.indexOf('evidenceType')] || row[2] || ''),
      summary: String(row[headers.indexOf('summary')] || row[3] || ''),
      status: String(row[headers.indexOf('status')] || row[4] || 'Ready'),
      evidenceLink: String(row[headers.indexOf('evidenceLink')] || row[5] || ''),
      attachments: []
    });
  }
  
  return { data: items };
}

