/**
 * MRIS - Medical Resource Intelligence System
 * Apps Script API with Token + Roles + Validation + Audit Trail
 * 
 * نظام استخبارات الموارد الطبية
 * API متكامل مع الأمان والتدقيق
 */

// ==================== CONFIGURATION ====================
const MRIS_SPREADSHEET_ID = '1sbVyDFvjFn1pMc-2caKHuX2nwFAUtJ4RGq9As0_2vb4'; // ملف LD4.5

// ==================== EVIDENCE PIPELINE SHEETS ====================
const SHEET_EVIDENCE_PIPELINE = 'Evidence_Pipeline';
const SHEET_EVIDENCE_LINKS = 'Evidence_Links';
const SHEET_STANDARD_MAP = 'Standard_Map';

// ==================== ROLES & PERMISSIONS ====================
const ROLES = {
  admin: { 
    canRead: ['*'], 
    canWrite: true, 
    canApprove: true, 
    canAdmin: true 
  },
  quality: { 
    canRead: ['*'], 
    canWrite: true, 
    canApprove: true, 
    canAdmin: false 
  },
  hr: { 
    canRead: ['Staff_Roster', 'Shifts_Live', 'Departments', 'Alerts_Log', 'Decisions_Log'], 
    canWrite: ['Shifts_Live', 'Staff_Roster'], 
    canApprove: false, 
    canAdmin: false 
  },
  store: { 
    canRead: ['Consumables_MinMax', 'Consumption_Live', 'Procurement_Decisions', 'Alerts_Log'], 
    canWrite: ['Consumption_Live', 'Procurement_Decisions'], 
    canApprove: false, 
    canAdmin: false 
  },
  fms: { 
    canRead: ['Assets_Status', 'Equipment_Assets', 'Alerts_Log'], 
    canWrite: ['Assets_Status'], 
    canApprove: false, 
    canAdmin: false 
  },
  viewer: { 
    canRead: ['Departments', 'Alerts_Log', 'KPI_Weekly', 'Evidence_Pipeline', 'Evidence_Links'], 
    canWrite: false, 
    canApprove: false, 
    canAdmin: false 
  }
};

const SENSITIVE_SHEETS = ['Staff_Roster', 'Staff_Tokens', 'Audit_Trail'];

// ==================== MAIN API HANDLER ====================
function doGet(e) {
  const callback = e?.parameter?.callback;
  try {
    const p = e.parameter;
    const action = p.action;
    const token = p.token;
    
    // التحقق من التوكن
    const auth = validateToken_(token);
    if (!auth.valid) {
      return jsonpOutput_({ success: false, error: 'Unauthorized: ' + auth.error }, callback);
    }
    
    let result;
    
    switch (action) {
      case 'getHeatmap':
        // Heatmap uses Departments and Shifts_Live sheets
        if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Staffing analytics require Departments and Shifts access' }, callback);
        }
        result = getHeatmap_(auth);
        break;
      case 'getKpis':
        // KPIs require Departments and Shifts access
        if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: KPIs require Departments and Shifts access' }, callback);
        }
        result = getKpis_(auth);
        break;
      case 'getDeptDetails':
        // Department details may include staff info - check sensitivity
        if (!hasPermission_(auth.role, 'Departments', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied' }, callback);
        }
        result = getDeptDetails_(p.deptId, auth);
        break;
      case 'getAlerts':
        if (!hasPermission_(auth.role, 'Alerts_Log', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Alerts access required' }, callback);
        }
        result = getAlerts_(p.status);
        break;
      case 'getConsumablesStatus':
        if (!hasPermission_(auth.role, 'Consumables_MinMax', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Consumables access required' }, callback);
        }
        result = getConsumablesStatus_();
        break;
      case 'getStaffRoster':
        if (!canAccessSensitiveData_(auth.role)) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Sensitive data access required' }, callback);
        }
        result = getStaffRoster_();
        break;
      case 'getAuditTrail':
        if (!ROLES[auth.role].canAdmin) {
          return jsonpOutput_({ success: false, error: 'Admin only' }, callback);
        }
        result = getAuditTrail_(p.limit || 100);
        break;
      case 'getIndices':
        if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Indices require Departments and Shifts access' }, callback);
        }
        result = getIndices_(auth);
        break;
      case 'getRecommendations':
        if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
          return jsonpOutput_({ success: false, error: 'Permission denied: Recommendations require Departments and Shifts access' }, callback);
        }
        result = getRecommendations_(auth);
        break;
      
      // ==================== EVIDENCE PIPELINE GET ====================
      case 'getEvidencePack':
        if (!hasPermission_(auth.role, SHEET_EVIDENCE_PIPELINE, 'read') && 
            auth.role !== 'admin' && auth.role !== 'quality') {
          return jsonpOutput_({ success: false, error: 'Permission denied: Evidence access required' }, callback);
        }
        result = getEvidencePack_({
          deptId: p.deptId || '',
          standardRef: p.standardRef || '',
          status: p.status || ''
        }, auth);
        break;
      
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
    
    return jsonpOutput_(result, callback);
    
  } catch (err) {
    return jsonpOutput_({ success: false, error: err.message }, callback);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const token = payload.token;
    
    // التحقق من التوكن
    const auth = validateToken_(token);
    if (!auth.valid) {
      return ContentService.createTextOutput(JSON.stringify({ 
        success: false, error: 'Unauthorized' 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    let result;
    
    switch (action) {
      case 'logAlert':
        result = logAlert_(payload, auth);
        break;
      case 'logDecision':
        if (!ROLES[auth.role].canApprove) {
          return errorResponse_('Permission denied: cannot approve');
        }
        result = logDecision_(payload, auth);
        break;
      case 'logAction':
        result = logAction_(payload, auth);
        break;
      case 'updateShift':
        if (!hasPermission_(auth.role, 'Shifts_Live', 'write')) {
          return errorResponse_('Permission denied');
        }
        result = updateShift_(payload, auth);
        break;
      case 'logConsumption':
        if (!hasPermission_(auth.role, 'Consumption_Live', 'write')) {
          return errorResponse_('Permission denied');
        }
        result = logConsumption_(payload, auth);
        break;
      case 'createProcurement':
        if (!hasPermission_(auth.role, 'Procurement_Decisions', 'write')) {
          return errorResponse_('Permission denied');
        }
        result = createProcurement_(payload, auth);
        break;
      case 'updateAssetStatus':
        if (!hasPermission_(auth.role, 'Assets_Status', 'write')) {
          return errorResponse_('Permission denied');
        }
        result = updateAssetStatus_(payload, auth);
        break;
      
      // ==================== EVIDENCE PIPELINE ACTIONS ====================
      case 'linkEvidence':
        result = linkEvidence_(payload, auth);
        break;
      case 'finalizeEvidence':
        result = finalizeEvidence_(payload, auth);
        break;
      case 'getEvidencePack':
        result = getEvidencePack_(payload, auth);
        break;
      
      default:
        result = { success: false, error: 'Unknown action' };
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (e) {
    return errorResponse_(e.message);
  }
}

// ==================== AUTH FUNCTIONS ====================
function validateToken_(token) {
  if (!token) {
    return { valid: false, error: 'No token provided' };
  }
  
  // التحقق من قاعدة البيانات
  try {
    const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
    let tokensSheet = ss.getSheetByName('Staff_Tokens');
    
    if (!tokensSheet) {
      return { valid: false, error: 'Staff_Tokens sheet not found' };
    }
    
    const data = tokensSheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).toLowerCase().trim());
    
    // البحث عن أعمدة الشيت ديناميكياً
    const tokenCol = headers.findIndex(h => h === 'token');
    const staffIdCol = headers.findIndex(h => h === 'staffid' || h === 'staff_id');
    const staffNameCol = headers.findIndex(h => h === 'staffname' || h === 'staff_name');
    const roleCol = headers.findIndex(h => h === 'role' || h === 'roleid');
    const expiresCol = headers.findIndex(h => h === 'expiresat' || h === 'expires_at' || h === 'expires');
    const activeCol = headers.findIndex(h => h === 'active');
    
    if (tokenCol === -1) {
      return { valid: false, error: 'Token column not found in Staff_Tokens sheet' };
    }
    
    for (let i = 1; i < data.length; i++) {
      const storedToken = String(data[i][tokenCol] || '').trim();
      
      // التحقق من Active (اختياري - إذا لم يوجد العمود يُعتبر active)
      const isActive = activeCol === -1 || String(data[i][activeCol]).toUpperCase() !== 'FALSE';
      
      if (storedToken === token && isActive) {
        // التحقق من تاريخ الانتهاء
        if (expiresCol !== -1) {
          const expiresAt = data[i][expiresCol];
          if (expiresAt && new Date(expiresAt) < new Date()) {
            return { valid: false, error: 'Token expired' };
          }
        }
        
        const role = roleCol !== -1 ? String(data[i][roleCol] || 'viewer').toLowerCase() : 'viewer';
        if (!ROLES[role]) {
          return { valid: false, error: 'Invalid role assigned to token' };
        }
        
        return { 
          valid: true, 
          role: role,
          staffId: staffIdCol !== -1 ? data[i][staffIdCol] : 'unknown',
          staffName: staffNameCol !== -1 ? data[i][staffNameCol] : 'مستخدم'
        };
      }
    }
    
    return { valid: false, error: 'Invalid token' };
    
  } catch (e) {
    return { valid: false, error: 'Auth error: ' + e.message };
  }
}

function hasPermission_(role, sheet, action) {
  const permissions = ROLES[role];
  if (!permissions) return false;
  
  if (action === 'read') {
    // التحقق من قائمة الشيتات المسموح قراءتها
    if (Array.isArray(permissions.canRead)) {
      if (permissions.canRead.includes('*')) return true;
      return permissions.canRead.includes(sheet);
    }
    return false;
  }
  
  if (action === 'write') {
    if (permissions.canWrite === true) return true;
    if (Array.isArray(permissions.canWrite)) {
      return permissions.canWrite.includes(sheet);
    }
    return false;
  }
  
  return false;
}

function canAccessSensitiveData_(role) {
  return role === 'admin' || role === 'quality' || role === 'hr';
}

// ==================== READ FUNCTIONS ====================
function getHeatmap_(auth) {
  // التحقق من صلاحية الوصول للأقسام (حماية دفاعية)
  if (!auth || !auth.role || !hasPermission_(auth.role, 'Departments', 'read')) {
    return { success: false, error: 'Permission denied: Departments access required' };
  }
  
  // التحقق من صلاحية الوصول للشفتات (مطلوب لبيانات التغطية)
  if (!hasPermission_(auth.role, 'Shifts_Live', 'read')) {
    return { success: false, error: 'Permission denied: Shifts_Live access required for staffing analytics' };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  
  // جلب الأقسام
  let deptSheet = ss.getSheetByName('Departments');
  if (!deptSheet) {
    // إنشاء الشيت من البيانات الموجودة
    deptSheet = createDepartmentsSheet_(ss);
  }
  
  const deptData = sheetToObjects_(deptSheet);
  
  // جلب الشفتات الحية
  let shiftsSheet = ss.getSheetByName('Shifts_Live');
  const shiftsData = shiftsSheet ? sheetToObjects_(shiftsSheet) : [];
  
  // حساب التغطية لكل قسم
  const heatmap = deptData.map(dept => {
    const deptId = dept.DeptID || dept.ID;
    const required = parseInt(dept.RequiredBase) || 2;
    
    // حساب الموظفين الحاليين - بيانات حقيقية فقط
    const currentShifts = shiftsData.filter(s => 
      s.DeptID === deptId && 
      s.Status === 'active'
    );
    const actual = currentShifts.length; // لا random - قيمة حقيقية
    
    const coverage = Math.round((actual / required) * 100);
    
    return {
      deptId: deptId,
      name: dept.Name || dept.الخدمة,
      floor: dept.Floor || 1,
      required: required,
      actual: actual,
      coverage: coverage,
      status: coverage >= 90 ? 'green' : coverage >= 70 ? 'yellow' : 'red'
    };
  });
  
  return { success: true, data: heatmap };
}

function getKpis_(auth) {
  // التحقق من صلاحية الوصول للأقسام والشفتات (مطلوب للـ KPIs)
  if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
    return { success: false, error: 'Permission denied: KPIs require Departments and Shifts access' };
  }
  
  const heatmap = getHeatmap_(auth);
  if (!heatmap.success) return heatmap;
  
  const depts = heatmap.data;
  
  let totalRequired = 0;
  let totalActual = 0;
  let understaffed = 0;
  
  depts.forEach(d => {
    totalRequired += d.required;
    totalActual += d.actual;
    if (d.actual < d.required) understaffed++;
  });
  
  const coverage = totalRequired > 0 ? Math.round((totalActual / totalRequired) * 100) : 0;
  
  // حساب مؤشر الإرهاق بناءً على نسبة النقص
  // كلما زاد النقص زاد الضغط على الموظفين الموجودين
  const shortfall = totalRequired - totalActual;
  const stressIndex = totalActual > 0 
    ? Math.min(100, Math.round((shortfall / totalActual) * 50) + 10)
    : (totalRequired > 0 ? 100 : 0);
  
  // سلامة الاستهلاك - من بيانات المخزون الحقيقية
  let consumptionIntegrity = 90; // قيمة افتراضية
  try {
    const consumables = getConsumablesStatus_();
    if (consumables.success && consumables.data.consumptionIntegrity !== undefined) {
      consumptionIntegrity = consumables.data.consumptionIntegrity;
    }
  } catch (e) {
    // إبقاء القيمة الافتراضية في حالة الخطأ
  }
  
  const riskLevel = stressIndex > 40 || coverage < 70 ? 'high' : 
                    stressIndex > 25 || coverage < 85 ? 'medium' : 'low';
  
  return {
    success: true,
    data: {
      coverage: coverage,
      understaffedDepts: understaffed,
      totalDepts: depts.length,
      stressIndex: stressIndex,
      consumptionIntegrity: consumptionIntegrity,
      riskLevel: riskLevel,
      timestamp: new Date().toISOString()
    }
  };
}

function getDeptDetails_(deptId, auth) {
  if (!deptId) {
    return { success: false, error: 'deptId required' };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  
  // جلب بيانات القسم
  const deptSheet = ss.getSheetByName('Departments');
  const depts = deptSheet ? sheetToObjects_(deptSheet) : [];
  const dept = depts.find(d => d.DeptID === deptId || d.ID === deptId);
  
  if (!dept) {
    return { success: false, error: 'Department not found' };
  }
  
  const result = {
    department: dept,
    staff: [],
    consumables: []
  };
  
  // جلب الموظفين - فقط إذا كان لديه صلاحية الوصول للبيانات الحساسة
  if (canAccessSensitiveData_(auth.role)) {
    const staffSheet = ss.getSheetByName('Staffing_Plan_WISN');
    result.staff = staffSheet ? sheetToObjects_(staffSheet).filter(s => 
      s.الخدمة === dept.Name || s.Service === deptId
    ) : [];
  }
  
  // جلب المستهلكات - فقط إذا كان لديه صلاحية
  if (hasPermission_(auth.role, 'Consumables_MinMax', 'read')) {
    const consumSheet = ss.getSheetByName('Consumables_MinMax');
    result.consumables = consumSheet ? sheetToObjects_(consumSheet).filter(c =>
      c['الخدمة/القسم'] === dept.Name || c.Department === deptId
    ).slice(0, 10) : [];
  }
  
  return {
    success: true,
    data: result
  };
}

function getAlerts_(status) {
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let alertsSheet = ss.getSheetByName('Alerts_Log');
  
  if (!alertsSheet) {
    // إنشاء الشيت
    alertsSheet = ss.insertSheet('Alerts_Log');
    alertsSheet.appendRow([
      'AlertID', 'Timestamp', 'Type', 'Severity', 'DeptID', 'DeptName',
      'Metric', 'Value', 'Threshold', 'Message', 'Status', 'ResolvedAt', 'ResolvedBy'
    ]);
  }
  
  const alerts = sheetToObjects_(alertsSheet);
  
  const filtered = status ? 
    alerts.filter(a => a.Status === status) : 
    alerts.filter(a => a.Status !== 'resolved');
  
  return { success: true, data: filtered.slice(-50) };
}

function getConsumablesStatus_() {
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Consumables_MinMax');
  
  if (!sheet) {
    return { success: false, error: 'Consumables sheet not found' };
  }
  
  const data = sheetToObjects_(sheet);
  
  // تحليل حالة المخزون
  const critical = [];
  const warning = [];
  const normal = [];
  
  data.forEach(item => {
    // المخزون الحالي - أولوية للـ CurrentStock ثم Balance
    const currentStock = parseFloat(item['CurrentStock'] || item['المخزون الحالي'] || item['Balance']) || 0;
    const min = parseFloat(item['حد أدنى (Min)'] || item['Min']) || 0;
    const max = parseFloat(item['حد أعلى (Max)'] || item['Max']) || 100;
    const monthlyUsage = parseFloat(item['الاستهلاك الشهري'] || item['MonthlyUsage']) || 1;
    
    // حساب نقطة إعادة الطلب = Min + (LeadTime بالأيام × متوسط الاستهلاك اليومي)
    const leadTimeDays = parseFloat(item['LeadTime'] || 7); // افتراضي 7 أيام
    const dailyUsage = monthlyUsage / 30;
    const reorderPoint = min + (leadTimeDays * dailyUsage);
    
    const itemInfo = {
      name: item['الصنف'] || item.Item,
      department: item['الخدمة/القسم'] || item.Department,
      currentStock: currentStock,
      min: min,
      max: max,
      reorderPoint: Math.round(reorderPoint)
    };
    
    // التصنيف الصحيح: بناءً على المخزون الحالي
    if (currentStock <= min) {
      itemInfo.status = 'critical';
      critical.push(itemInfo);
    } else if (currentStock <= reorderPoint) {
      itemInfo.status = 'warning';
      warning.push(itemInfo);
    } else {
      itemInfo.status = 'normal';
      normal.push(itemInfo);
    }
  });
  
  // حساب نسبة سلامة المخزون
  const totalItems = data.length;
  const healthyItems = normal.length;
  const consumptionIntegrity = totalItems > 0 ? Math.round((healthyItems / totalItems) * 100) : 100;
  
  return {
    success: true,
    data: {
      critical: critical.slice(0, 10),
      warning: warning.slice(0, 10),
      normalCount: normal.length,
      total: totalItems,
      consumptionIntegrity: consumptionIntegrity
    }
  };
}

function getStaffRoster_() {
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Staffing_Plan_WISN');
  
  if (!sheet) {
    return { success: false, error: 'Staff sheet not found' };
  }
  
  const data = sheetToObjects_(sheet);
  return { success: true, data: data };
}

function getAuditTrail_(limit) {
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Audit_Trail');
  
  if (!sheet) {
    sheet = ss.insertSheet('Audit_Trail');
    sheet.appendRow(['AuditID', 'Timestamp', 'UserID', 'UserName', 'Action', 'Sheet', 'RowID', 'Details', 'Reason']);
  }
  
  const data = sheetToObjects_(sheet);
  return { success: true, data: data.slice(-limit) };
}

function getIndices_(auth) {
  // التحقق من صلاحية الوصول للأقسام والشفتات
  if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
    return { success: false, error: 'Permission denied: Indices require Departments and Shifts access' };
  }
  
  // حساب المؤشرات الذكية
  const kpis = getKpis_(auth);
  if (!kpis.success) return kpis;
  
  const k = kpis.data;
  
  return {
    success: true,
    data: {
      staffStressIndex: k.stressIndex,
      serviceStrainIndex: 100 - k.coverage + 10,
      consumptionIntegrity: k.consumptionIntegrity,
      safetyRiskProjection: k.riskLevel === 'high' ? 75 : k.riskLevel === 'medium' ? 40 : 15
    }
  };
}

function getRecommendations_(auth) {
  // التحقق من صلاحية الوصول للأقسام والشفتات
  if (!hasPermission_(auth.role, 'Departments', 'read') || !hasPermission_(auth.role, 'Shifts_Live', 'read')) {
    return { success: false, error: 'Permission denied: Recommendations require Departments and Shifts access' };
  }
  
  const kpis = getKpis_(auth);
  const heatmap = getHeatmap_(auth);
  
  const recommendations = [];
  
  if (heatmap.success) {
    // البحث عن أقسام تحتاج دعم
    const redDepts = heatmap.data.filter(d => d.status === 'red');
    const greenDepts = heatmap.data.filter(d => d.status === 'green' && d.actual > d.required);
    
    redDepts.forEach(red => {
      const source = greenDepts[0];
      if (source) {
        recommendations.push({
          type: 'staff_transfer',
          priority: 'high',
          title: 'نقل موظف',
          description: `نقل موظف من ${source.name} إلى ${red.name} لتحسين التغطية`,
          impact: { coverage: '+' + (100 - red.coverage) + '%' },
          cost: 'منخفض',
          risk: 'منخفض'
        });
      }
    });
  }
  
  if (kpis.success && kpis.data.stressIndex > 30) {
    recommendations.push({
      type: 'workload_adjustment',
      priority: 'medium',
      title: 'تعديل عبء العمل',
      description: 'مؤشر الإرهاق مرتفع - يُنصح بتقليل المواعيد أو إضافة شفت',
      impact: { stress: '-15%' },
      cost: 'متوسط',
      risk: 'منخفض'
    });
  }
  
  return { success: true, data: recommendations };
}

// ==================== WRITE FUNCTIONS ====================
function logAlert_(payload, auth) {
  const required = ['type', 'severity', 'deptId', 'message'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Alerts_Log');
  
  if (!sheet) {
    sheet = ss.insertSheet('Alerts_Log');
    sheet.appendRow([
      'AlertID', 'Timestamp', 'Type', 'Severity', 'DeptID', 'DeptName',
      'Metric', 'Value', 'Threshold', 'Message', 'Status', 'ResolvedAt', 'ResolvedBy'
    ]);
  }
  
  const alertId = 'ALT' + Date.now();
  const timestamp = new Date().toISOString();
  
  sheet.appendRow([
    alertId,
    timestamp,
    payload.type,
    payload.severity,
    payload.deptId,
    payload.deptName || '',
    payload.metric || '',
    payload.value || '',
    payload.threshold || '',
    payload.message,
    'active',
    '',
    ''
  ]);
  
  // تسجيل في Audit Trail
  logAudit_(auth, 'CREATE', 'Alerts_Log', alertId, 'New alert: ' + payload.type);
  
  return { success: true, alertId: alertId };
}

function logDecision_(payload, auth) {
  const required = ['alertId', 'recommendationType', 'description'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Decisions_Log');
  
  if (!sheet) {
    sheet = ss.insertSheet('Decisions_Log');
    sheet.appendRow([
      'DecisionID', 'Timestamp', 'AlertID', 'RecommendationType', 'Description',
      'Impact', 'Cost', 'Risk', 'ApprovedBy', 'ApprovalDate', 'Status', 'EvidenceID'
    ]);
  }
  
  const decisionId = 'DEC' + Date.now();
  const timestamp = new Date().toISOString();
  
  // إنشاء Evidence Draft تلقائياً إذا لم يُقدم evidenceId
  let evidenceId = payload.evidenceId || '';
  if (!evidenceId) {
    try {
      const evidenceResult = linkEvidence_({
        deptId: payload.deptId || 'ALL',
        standardRef: payload.standardRef || 'LD4.5',
        evidenceType: 'Decision',
        evidenceLink: payload.evidenceLink || '',
        summary: `قرار: ${payload.description}`,
        alertId: payload.alertId,
        decisionId: decisionId
      }, auth);
      
      if (!evidenceResult.success) {
        return { 
          success: false, 
          error: 'فشل إنشاء الدليل: ' + (evidenceResult.error || 'Unknown error')
        };
      }
      evidenceId = evidenceResult.evidenceId;
    } catch (e) {
      return { success: false, error: 'خطأ في إنشاء الدليل: ' + e.message };
    }
  }
  
  sheet.appendRow([
    decisionId,
    timestamp,
    payload.alertId,
    payload.recommendationType,
    payload.description,
    payload.impact || '',
    payload.cost || '',
    payload.risk || '',
    auth.staffName,
    timestamp,
    'approved',
    evidenceId
  ]);
  
  logAudit_(auth, 'CREATE', 'Decisions_Log', decisionId, 'Decision approved with evidence: ' + evidenceId);
  
  return { success: true, decisionId: decisionId, evidenceId: evidenceId };
}

function logAction_(payload, auth) {
  const required = ['decisionId', 'actionType', 'description'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Actions_Log');
  
  if (!sheet) {
    sheet = ss.insertSheet('Actions_Log');
    sheet.appendRow([
      'ActionID', 'Timestamp', 'DecisionID', 'ActionType', 'Description',
      'ExecutedBy', 'ExecutedAt', 'Outcome', 'EvidenceRef'
    ]);
  }
  
  const actionId = 'ACT' + Date.now();
  const timestamp = new Date().toISOString();
  
  sheet.appendRow([
    actionId,
    timestamp,
    payload.decisionId,
    payload.actionType,
    payload.description,
    auth.staffName,
    timestamp,
    payload.outcome || 'pending',
    payload.evidenceRef || ''
  ]);
  
  logAudit_(auth, 'CREATE', 'Actions_Log', actionId, 'Action executed');
  
  return { success: true, actionId: actionId };
}

function logConsumption_(payload, auth) {
  const required = ['deptId', 'itemId', 'quantity'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  // التحقق من القيم
  if (payload.quantity < 0) {
    return { success: false, error: 'Quantity cannot be negative' };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Consumption_Live');
  
  if (!sheet) {
    sheet = ss.insertSheet('Consumption_Live');
    sheet.appendRow([
      'ID', 'Timestamp', 'DeptID', 'ItemID', 'ItemName', 'Quantity', 'Unit', 'ConsumedBy', 'Reason'
    ]);
  }
  
  const id = 'CON' + Date.now();
  const timestamp = new Date().toISOString();
  
  sheet.appendRow([
    id,
    timestamp,
    payload.deptId,
    payload.itemId,
    payload.itemName || '',
    payload.quantity,
    payload.unit || '',
    auth.staffName,
    payload.reason || ''
  ]);
  
  logAudit_(auth, 'CREATE', 'Consumption_Live', id, 'Consumption logged: ' + payload.quantity);
  
  return { success: true, id: id };
}

function createProcurement_(payload, auth) {
  const required = ['itemId', 'quantity', 'justification'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  // التحقق من وجود مرجع (Evidence أو Decision أو Alert) - إجباري للـ CBAHI
  if (!payload.evidenceId && !payload.decisionId && !payload.alertRef) {
    return { 
      success: false, 
      error: 'Evidence required: يجب تقديم evidenceId أو decisionId أو alertRef' 
    };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Procurement_Decisions');
  
  if (!sheet) {
    sheet = ss.insertSheet('Procurement_Decisions');
    sheet.appendRow([
      'ProcID', 'Date', 'ItemID', 'ItemName', 'Quantity', 'Justification',
      'AlertRef', 'DecisionID', 'EvidenceID', 'ApprovedBy', 'PRNumber', 'PONumber', 'DeliveryDate', 'Status'
    ]);
  }
  
  const procId = 'PROC' + Date.now();
  const date = new Date().toISOString().split('T')[0];
  
  // إنشاء Evidence Draft تلقائياً للمشتريات
  let evidenceId = payload.evidenceId || '';
  if (!evidenceId) {
    try {
      const evidenceResult = linkEvidence_({
        deptId: payload.deptId || 'ALL',
        standardRef: 'LD4.5',
        evidenceType: 'Procurement',
        evidenceLink: payload.evidenceLink || '',
        summary: `طلب شراء: ${payload.itemName || payload.itemId} - الكمية: ${payload.quantity}`,
        alertId: payload.alertRef || '',
        decisionId: payload.decisionId || '',
        actionId: procId
      }, auth);
      
      if (!evidenceResult.success) {
        return { 
          success: false, 
          error: 'فشل إنشاء الدليل: ' + (evidenceResult.error || 'Unknown error')
        };
      }
      evidenceId = evidenceResult.evidenceId;
    } catch (e) {
      return { success: false, error: 'خطأ في إنشاء الدليل: ' + e.message };
    }
  }
  
  sheet.appendRow([
    procId,
    date,
    payload.itemId,
    payload.itemName || '',
    payload.quantity,
    payload.justification,
    payload.alertRef || '',
    payload.decisionId || '',
    evidenceId,
    auth.staffName,
    '',
    '',
    '',
    'pending'
  ]);
  
  logAudit_(auth, 'CREATE', 'Procurement_Decisions', procId, 'Procurement with evidence: ' + evidenceId);
  
  return { success: true, procId: procId, evidenceId: evidenceId };
}

function updateAssetStatus_(payload, auth) {
  const required = ['assetId', 'status'];
  const validation = validatePayload_(payload, required);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const validStatuses = ['working', 'maintenance', 'out_of_service', 'يعمل', 'صيانة', 'خارج الخدمة'];
  if (!validStatuses.includes(payload.status)) {
    return { success: false, error: 'Invalid status value' };
  }
  
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  
  // استخدام Assets_Status (Append-only للتتبع)
  let statusSheet = ss.getSheetByName('Assets_Status');
  if (!statusSheet) {
    statusSheet = ss.insertSheet('Assets_Status');
    statusSheet.appendRow([
      'ID', 'Timestamp', 'AssetID', 'AssetName', 'DeptID', 
      'OldStatus', 'NewStatus', 'Reason', 'UpdatedBy', 'NextPM', 'Notes'
    ]);
  }
  
  // جلب البيانات الحالية من Equipment_Assets للمرجع
  const equipSheet = ss.getSheetByName('Equipment_Assets');
  let assetName = '';
  let deptId = '';
  let oldStatus = '';
  
  if (equipSheet) {
    const data = equipSheet.getDataRange().getValues();
    const headers = data[0];
    const statusCol = headers.indexOf('الحالة') !== -1 ? headers.indexOf('الحالة') : headers.indexOf('Status');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.assetId || data[i][3] === payload.assetId) {
        assetName = data[i][1] || '';
        deptId = data[i][2] || '';
        oldStatus = statusCol >= 0 ? data[i][statusCol] : '';
        break;
      }
    }
  }
  
  // إضافة سجل جديد في Assets_Status (Append-only)
  const statusId = 'AST' + Date.now();
  const timestamp = new Date().toISOString();
  
  statusSheet.appendRow([
    statusId,
    timestamp,
    payload.assetId,
    assetName,
    deptId,
    oldStatus,
    payload.status,
    payload.reason || '',
    auth.staffName,
    payload.nextPM || '',
    payload.notes || ''
  ]);
  
  logAudit_(auth, 'CREATE', 'Assets_Status', statusId, 
    `Asset ${payload.assetId}: ${oldStatus} → ${payload.status}`);
  
  return { success: true, statusId: statusId, message: 'Asset status logged' };
}

// ==================== HELPER FUNCTIONS ====================
function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  const objects = [];
  
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((header, j) => {
      obj[header] = data[i][j];
    });
    objects.push(obj);
  }
  
  return objects;
}

function validatePayload_(payload, required) {
  for (const field of required) {
    if (!payload[field] && payload[field] !== 0) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }
  return { valid: true };
}

function logAudit_(auth, action, sheet, rowId, details) {
  try {
    const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
    let auditSheet = ss.getSheetByName('Audit_Trail');
    
    if (!auditSheet) {
      auditSheet = ss.insertSheet('Audit_Trail');
      auditSheet.appendRow(['AuditID', 'Timestamp', 'UserID', 'UserName', 'Action', 'Sheet', 'RowID', 'Details', 'Reason']);
    }
    
    auditSheet.appendRow([
      'AUD' + Date.now(),
      new Date().toISOString(),
      auth.staffId,
      auth.staffName,
      action,
      sheet,
      rowId,
      details,
      ''
    ]);
  } catch (e) {
    console.log('Audit log error:', e.message);
  }
}

function jsonpOutput_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(message) {
  return ContentService.createTextOutput(JSON.stringify({ 
    success: false, 
    error: message 
  })).setMimeType(ContentService.MimeType.JSON);
}

function createDepartmentsSheet_(ss) {
  const sheet = ss.insertSheet('Departments');
  sheet.appendRow(['DeptID', 'Name', 'NameEN', 'Floor', 'Type', 'Active', 'RequiredBase', 'WorkloadWeight']);
  
  const depts = [
    ['reception', 'الاستقبال', 'Reception', 1, 'support', true, 2, 1.0],
    ['batiniya1', 'الباطنية 1', 'Internal Medicine 1', 2, 'clinical', true, 3, 1.2],
    ['batiniya2', 'الباطنية 2', 'Internal Medicine 2', 2, 'clinical', true, 3, 1.2],
    ['batiniya3', 'الباطنية 3', 'Internal Medicine 3', 2, 'clinical', true, 2, 1.0],
    ['dental', 'الأسنان', 'Dental', 2, 'clinical', true, 4, 1.5],
    ['emergency', 'الطوارئ', 'Emergency', 1, 'clinical', true, 3, 2.0],
    ['general', 'الطب العام', 'General Medicine', 1, 'clinical', true, 2, 1.0],
    ['pharmacy', 'الصيدلية', 'Pharmacy', 1, 'support', true, 2, 0.8],
    ['nursery', 'النساء والولادة', 'OB/GYN', 1, 'clinical', true, 2, 1.3],
    ['lab', 'المختبر', 'Laboratory', 0, 'diagnostic', true, 2, 1.0],
    ['admin', 'الإدارة', 'Administration', 0, 'admin', true, 2, 0.5]
  ];
  
  depts.forEach(row => sheet.appendRow(row));
  
  return sheet;
}

// ==================== SCHEDULED FUNCTIONS ====================
function runAlertCheck() {
  // تشغيل تلقائي كل 15 دقيقة
  // استخدام سياق نظام مميز للمهام التلقائية
  const systemAuth = { 
    staffId: 'SYSTEM', 
    staffName: 'النظام التلقائي',
    role: 'admin' // صلاحية إدارية للنظام التلقائي
  };
  
  const kpis = getKpis_(systemAuth);
  
  if (kpis.success) {
    const k = kpis.data;
    const auth = systemAuth;
    
    // تنبيه نقص التغطية
    if (k.coverage < 80) {
      logAlert_({
        type: 'understaffing',
        severity: k.coverage < 70 ? 'critical' : 'warning',
        deptId: 'ALL',
        message: `التغطية الإجمالية ${k.coverage}% - تحت الحد المطلوب`,
        metric: 'coverage',
        value: k.coverage,
        threshold: 80
      }, auth);
    }
    
    // تنبيه الإرهاق
    if (k.stressIndex > 40) {
      logAlert_({
        type: 'high_stress',
        severity: 'warning',
        deptId: 'ALL',
        message: `مؤشر الإرهاق مرتفع: ${k.stressIndex}%`,
        metric: 'stress_index',
        value: k.stressIndex,
        threshold: 40
      }, auth);
    }
  }
}

// ==================== EVIDENCE PIPELINE SETUP ====================
function setupEvidencePipeline() {
  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);

  ensureSheet_(ss, SHEET_EVIDENCE_PIPELINE, [
    'EvidenceID','Timestamp','DeptID','AlertID','DecisionID','ActionID',
    'EvidenceType','EvidenceLink','StandardRef','Summary',
    'OwnerStaffID','Status','VerifiedBy','VerifiedAt'
  ]);

  ensureSheet_(ss, SHEET_EVIDENCE_LINKS, [
    'LinkID','EvidenceID','DocType','DocLink','Notes'
  ]);

  ensureSheet_(ss, SHEET_STANDARD_MAP, [
    'StandardRef','Area','RequiredEvidenceTypes','Notes'
  ]);

  // إدخال مبدئي لمعايير LD4.5
  const mapSheet = ss.getSheetByName(SHEET_STANDARD_MAP);
  if (mapSheet.getLastRow() === 1) {
    mapSheet.appendRow(['LD4.5','Leadership','Policy,Minutes,KPI,Procurement,Logs','Resource adequacy evidence bundle']);
    mapSheet.appendRow(['FMS.1','FMS','MaintenanceLog,Inspection,Certificate','Facility maintenance evidence']);
    mapSheet.appendRow(['IPC.1','IPC','Training,Audit,Incidents','Infection control evidence']);
  }
  
  return { success: true, message: 'Evidence Pipeline sheets created successfully' };
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  else {
    const first = sh.getRange(1,1,1,headers.length).getValues()[0];
    const empty = first.every(v => !v);
    if (empty) sh.getRange(1,1,1,headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
}

// ==================== EVIDENCE PIPELINE API ====================

// payload: { deptId, standardRef, evidenceType, evidenceLink, summary, alertId?, decisionId?, actionId?, attachments?[] }
function linkEvidence_(payload, auth) {
  const required = ['deptId','standardRef','evidenceType','evidenceLink','summary'];
  const v = validatePayload_(payload, required);
  if (!v.valid) return { success:false, error:v.error };

  // صلاحية: أي كاتب/جودة/إداري
  if (!ROLES[auth.role]?.canWrite) return { success:false, error:'Permission denied: write access required' };

  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_EVIDENCE_PIPELINE);
  let links = ss.getSheetByName(SHEET_EVIDENCE_LINKS);
  
  if (!sh || !links) {
    // محاولة إنشاء الشيتات تلقائياً
    setupEvidencePipeline();
    sh = ss.getSheetByName(SHEET_EVIDENCE_PIPELINE);
    links = ss.getSheetByName(SHEET_EVIDENCE_LINKS);
    if (!sh || !links) return { success:false, error:'Evidence sheets not found. Run setupEvidencePipeline().' };
  }

  const evidenceId = 'EVD' + Date.now();
  const ts = new Date().toISOString();

  sh.appendRow([
    evidenceId, ts,
    payload.deptId,
    payload.alertId || '',
    payload.decisionId || '',
    payload.actionId || '',
    payload.evidenceType,
    payload.evidenceLink,
    payload.standardRef,
    payload.summary,
    auth.staffId,
    'Draft',
    '',
    ''
  ]);

  // مرفقات (اختياري): attachments: [{docType, docLink, notes}]
  if (Array.isArray(payload.attachments)) {
    payload.attachments.forEach(att => {
      const linkId = 'LNK' + Date.now() + Math.random().toString(36).slice(2,6);
      links.appendRow([
        linkId,
        evidenceId,
        att.docType || 'Attachment',
        att.docLink || '',
        att.notes || ''
      ]);
    });
  }

  logAudit_(auth, 'CREATE', SHEET_EVIDENCE_PIPELINE, evidenceId, `Evidence linked ${payload.standardRef} ${payload.evidenceType}`);
  return { success:true, evidenceId };
}

// payload: { evidenceId, status:'Draft'|'Ready'|'Verified' }
function finalizeEvidence_(payload, auth) {
  const required = ['evidenceId','status'];
  const v = validatePayload_(payload, required);
  if (!v.valid) return { success:false, error:v.error };

  // التحقق من الصلاحية: يجب أن يكون لديه canWrite
  if (!ROLES[auth.role]?.canWrite) {
    return { success:false, error:'Permission denied: write access required' };
  }
  
  // التحقق من صحة قيمة Status
  const validStatuses = ['Draft', 'Ready', 'Verified'];
  if (!validStatuses.includes(payload.status)) {
    return { success:false, error:'Invalid status. Must be: Draft, Ready, or Verified' };
  }

  // Verified يتطلب admin/quality فقط
  if (payload.status === 'Verified' && !(auth.role === 'admin' || auth.role === 'quality')) {
    return { success:false, error:'Permission denied: verification requires admin/quality' };
  }

  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_EVIDENCE_PIPELINE);
  if (!sh) return { success:false, error:'Evidence_Pipeline not found' };

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);

  const idxEvidenceID = headers.indexOf('EvidenceID');
  const idxStatus = headers.indexOf('Status');
  const idxVerifiedBy = headers.indexOf('VerifiedBy');
  const idxVerifiedAt = headers.indexOf('VerifiedAt');

  if (idxEvidenceID < 0 || idxStatus < 0) return { success:false, error:'Evidence headers missing' };

  let row = -1;
  for (let i=1; i<data.length; i++) {
    if (String(data[i][idxEvidenceID]) === String(payload.evidenceId)) { row = i+1; break; }
  }
  if (row === -1) return { success:false, error:'EvidenceID not found' };

  sh.getRange(row, idxStatus+1).setValue(payload.status);

  if (payload.status === 'Verified') {
    if (idxVerifiedBy >= 0) sh.getRange(row, idxVerifiedBy+1).setValue(auth.staffId);
    if (idxVerifiedAt >= 0) sh.getRange(row, idxVerifiedAt+1).setValue(new Date().toISOString());
  }

  logAudit_(auth, 'UPDATE', SHEET_EVIDENCE_PIPELINE, payload.evidenceId, `Evidence status -> ${payload.status}`);
  return { success:true, evidenceId: payload.evidenceId, status: payload.status };
}

// payload: { deptId?, standardRef?, status? }
function getEvidencePack_(payload, auth) {
  // قراءة الأدلة: admin/quality/viewer مسموح
  if (!hasPermission_(auth.role, SHEET_EVIDENCE_PIPELINE, 'read') && 
      auth.role !== 'admin' && auth.role !== 'quality') {
    return { success:false, error:'Permission denied: Evidence access required' };
  }

  const ss = SpreadsheetApp.openById(MRIS_SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_EVIDENCE_PIPELINE);
  const links = ss.getSheetByName(SHEET_EVIDENCE_LINKS);
  
  if (!sh || !links) return { success:false, error:'Evidence sheets not found' };

  const evid = sheetToObjects_(sh);
  const lnk = sheetToObjects_(links);

  let filtered = evid;

  if (payload.deptId) filtered = filtered.filter(x => String(x.DeptID) === String(payload.deptId));
  if (payload.standardRef) filtered = filtered.filter(x => String(x.StandardRef) === String(payload.standardRef));
  if (payload.status) filtered = filtered.filter(x => String(x.Status) === String(payload.status));

  // أرفق روابط المرفقات لكل Evidence
  const byEvidence = {};
  lnk.forEach(x => {
    const id = String(x.EvidenceID || '');
    if (!byEvidence[id]) byEvidence[id] = [];
    byEvidence[id].push({
      docType: x.DocType,
      docLink: x.DocLink,
      notes: x.Notes
    });
  });

  const out = filtered.map(x => ({
    evidenceId: x.EvidenceID,
    timestamp: x.Timestamp,
    deptId: x.DeptID,
    alertId: x.AlertID,
    decisionId: x.DecisionID,
    actionId: x.ActionID,
    evidenceType: x.EvidenceType,
    evidenceLink: x.EvidenceLink,
    standardRef: x.StandardRef,
    summary: x.Summary,
    ownerStaffId: x.OwnerStaffID,
    status: x.Status,
    verifiedBy: x.VerifiedBy,
    verifiedAt: x.VerifiedAt,
    attachments: byEvidence[String(x.EvidenceID)] || []
  }));

  return { success:true, data: out.slice(-200) };
}
