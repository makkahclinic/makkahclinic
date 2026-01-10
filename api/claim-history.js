// /api/claim-history.js
// نظام سجل المطالبات وكشف التكرار عبر الزمن
import { getSheetData, appendRow, createSheet, getSheetNames, batchUpdate } from '../sheets-service.js';

const CLAIM_HISTORY_SHEET = 'ClaimHistory';
const HISTORY_WINDOW_DAYS = 120;

const HEADERS = [
  'hash',           // معرف فريد للمطالبة
  'patient_id',     // رقم ملف المريض
  'patient_name',   // اسم المريض (اختياري)
  'service_type',   // medication/procedure
  'service_code',   // كود الخدمة أو اسم الدواء
  'service_name',   // اسم الخدمة المعياري
  'icd_code',       // كود التشخيص
  'service_date',   // تاريخ الخدمة (ISO)
  'quantity',       // الكمية
  'claim_id',       // رقم المطالبة
  'source_file',    // اسم الملف المصدر
  'created_at'      // تاريخ الإضافة
];

function generateHash(patientId, serviceCode, serviceDate) {
  const key = `${patientId}|${normalizeServiceCode(serviceCode)}|${normalizeDateToBucket(serviceDate)}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function normalizeServiceCode(code) {
  if (!code) return '';
  return String(code).toLowerCase()
    .replace(/[^\w\u0600-\u06FF]/g, '')
    .trim();
}

function normalizeDateToBucket(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

function parseServiceDate(dateStr) {
  if (!dateStr) return null;
  try {
    if (typeof dateStr === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + dateStr * 86400000);
      return date;
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================
// مبررات جاهزة للنسخ حسب نوع الإجراء/الدواء
// ============================================
const PROCEDURE_JUSTIFICATIONS = {
  // تحاليل البراز
  'stool': {
    suggestions: [
      'استمرار الأعراض الهضمية (إسهال/مغص) رغم العلاج الأولي',
      'الاشتباه بعدوى طفيلية لم تُكتشف بالعينة السابقة (Giardia/Entamoeba)',
      'متابعة الاستجابة العلاجية والتأكد من القضاء على العامل المسبب (Test of Cure)',
      'عدم توافق النتيجة السابقة مع الصورة السريرية الحالية',
      'الاشتباه في نزيف أو التهاب معوي نشط',
      'سوء جودة/كفاية العينة السابقة مما أثر على دقة النتائج',
      'مريض عالي الخطورة (ضعف مناعة/كبار السن) يستدعي إعادة التقييم'
    ],
    references: 'CDC Stool Testing Guidelines, IDSA Infectious Diarrhea Guidelines'
  },
  // تحليل الدم الشامل
  'cbc': {
    suggestions: [
      'متابعة استجابة العلاج (ارتفاع/انخفاض WBC أو Hgb)',
      'تدهور الحالة السريرية يستدعي إعادة التقييم',
      'الاشتباه في نزيف نشط أو فقر دم جديد',
      'مراقبة تأثير الأدوية على مكونات الدم',
      'حمى مستمرة أو عدوى غير مستجيبة للعلاج',
      'تقييم ما قبل الإجراء الجراحي العاجل'
    ],
    references: 'CLSI Guidelines, ASCP Best Practices'
  },
  // وظائف الكلى
  'renal|kidney|bun|creatinine|kft': {
    suggestions: [
      'مراقبة وظائف الكلى أثناء العلاج بأدوية سامة كلوياً (NSAIDs/Aminoglycosides)',
      'تدهور الحالة أو ظهور أعراض جديدة (تورم/قلة البول)',
      'مريض سكري/ضغط يحتاج متابعة دورية',
      'تقييم قبل إعطاء صبغة وريدية (CT Contrast)'
    ],
    references: 'KDIGO Guidelines, ADA Diabetes Care Standards'
  },
  // وظائف الكبد
  'liver|lft|alt|ast|bilirubin': {
    suggestions: [
      'متابعة استجابة العلاج لالتهاب الكبد',
      'مراقبة سمية الأدوية الكبدية (Paracetamol/Statins)',
      'تدهور الأعراض (يرقان/حكة/ألم بطني علوي)',
      'تقييم قبل بدء علاج جديد يؤثر على الكبد'
    ],
    references: 'AASLD Guidelines, ACG Clinical Guidelines'
  },
  // فحص البول
  'urine|urinalysis': {
    suggestions: [
      'استمرار أعراض التهاب المسالك (حرقة/تكرار)',
      'متابعة الاستجابة للمضاد الحيوي',
      'الاشتباه في عدوى صاعدة (حمى/ألم خاصرة)',
      'سوء جودة العينة السابقة (تلوث)'
    ],
    references: 'IDSA UTI Guidelines, AUA Best Practices'
  },
  // أشعة الصدر
  'xray|chest|cxr': {
    suggestions: [
      'تدهور الأعراض التنفسية رغم العلاج',
      'متابعة استجابة الالتهاب الرئوي للعلاج',
      'ظهور أعراض جديدة (ضيق تنفس/سعال دموي)',
      'استبعاد مضاعفات (انصباب جنبي/استرواح صدري)'
    ],
    references: 'ACR Appropriateness Criteria, BTS Guidelines'
  },
  // الموجات فوق الصوتية
  'ultrasound|us|sono': {
    suggestions: [
      'متابعة حجم/شكل الآفة المكتشفة سابقاً',
      'تدهور الأعراض يستدعي إعادة التقييم',
      'تقييم الاستجابة للعلاج',
      'ظهور أعراض جديدة في نفس المنطقة'
    ],
    references: 'ACR Practice Guidelines, AIUM Guidelines'
  }
};

const MEDICATION_JUSTIFICATIONS = {
  // المحاليل الوريدية
  'saline|ringer|iv fluid|dextrose': {
    suggestions: [
      'استمرار علامات الجفاف: ارتداد جلد >2 ثانية، جفاف الأغشية المخاطية',
      'قيء متكرر (≥3 مرات) لا يتحمل معه الشرب',
      'انخفاض ضغط الدم الانتصابي',
      'نقص النتاج البولي (<0.5 mL/kg/hr)'
    ],
    references: 'NICE Fluid Therapy Guidelines, WHO Dehydration Assessment'
  },
  // الباراسيتامول الوريدي
  'paracetamol.*infusion|paracetamol.*iv|perfalgan': {
    suggestions: [
      'ألم شديد VAS ≥7/10 لا يستجيب للفموي',
      'قيء متكرر لا يتحمل الأدوية الفموية',
      'حمى ≥39°C مع تدهور الحالة العامة',
      'مريض ما بعد العمليات يحتاج تسكين سريع'
    ],
    references: 'WHO Pain Ladder, ERAS Guidelines'
  },
  // المضادات الحيوية
  'antibiotic|amoxicillin|azithromycin|augmentin|cephalosporin|ciprofloxacin': {
    suggestions: [
      'عدم استجابة للمضاد السابق بعد 48-72 ساعة',
      'تغيير المضاد بناءً على نتيجة المزرعة والحساسية',
      'تدهور الحالة السريرية يستدعي تصعيد العلاج',
      'ظهور عدوى جديدة مختلفة عن السابقة'
    ],
    references: 'IDSA Guidelines, CDC Antibiotic Stewardship'
  },
  // مضادات القيء
  'ondansetron|zofran|metoclopramide|domperidone|dompy': {
    suggestions: [
      'قيء متكرر ≥2 مرات خلال 24 ساعة',
      'غثيان مستمر يؤثر على تناول الطعام/الأدوية',
      'قيء ما بعد العمليات أو العلاج الكيميائي'
    ],
    references: 'ASCO Antiemetic Guidelines, ASA Postoperative Nausea Guidelines'
  },
  // مضادات الحموضة
  'omeprazole|pantoprazole|esomeprazole|esopole|lansoprazole|ppi': {
    suggestions: [
      'استمرار أعراض الارتجاع رغم العلاج',
      'وقاية من قرحة الإجهاد في المريض الحرج',
      'تناول مضادات التهاب غير ستيرويدية طويلة المدى',
      'تحضير لمنظار الجهاز الهضمي'
    ],
    references: 'ACG GERD Guidelines, AGA PPI Best Practices'
  },
  // مضادات الهيستامين
  'antihistamine|loratadine|cetirizine|chlorpheniramine|diphenhydramine': {
    suggestions: [
      'أعراض حساسية موثقة: حكة، شرى، رشح أنفي، عطاس',
      'تفاعل تحسسي حاد يستدعي علاج فوري',
      'حساسية موسمية مع أعراض نشطة'
    ],
    references: 'ARIA Guidelines, AAAAI Practice Parameters'
  }
};

function getSpecificJustifications(serviceName, serviceType) {
  const name = (serviceName || '').toLowerCase();
  const mappings = serviceType === 'medication' ? MEDICATION_JUSTIFICATIONS : PROCEDURE_JUSTIFICATIONS;
  
  for (const [pattern, data] of Object.entries(mappings)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(name)) {
      return data;
    }
  }
  
  // مبررات عامة إذا لم يوجد تطابق محدد
  if (serviceType === 'medication') {
    return {
      suggestions: [
        'المريض فقد الدواء السابق ويحتاج بديل',
        'تغيير الجرعة بسبب عدم الاستجابة للجرعة السابقة',
        'انتهاء الكمية المصروفة مبكراً بسبب زيادة الجرعة العلاجية'
      ],
      references: 'Hospital Pharmacy Guidelines'
    };
  }
  
  return {
    suggestions: [
      'نتيجة الفحص السابق غير حاسمة وتتطلب إعادة التقييم',
      'تطور الحالة السريرية يستدعي إعادة الفحص',
      'متابعة الاستجابة العلاجية'
    ],
    references: 'Clinical Practice Guidelines'
  };
}

function formatCopyPasteText(serviceName, serviceType) {
  const justifications = getSpecificJustifications(serviceName, serviceType);
  const header = serviceType === 'medication' ? 'سبب إعادة الصرف' : 'سبب إعادة الإجراء';
  
  // إرجاع أول 3 مبررات كنص جاهز للنسخ
  const options = justifications.suggestions.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `📋 ${header} (اختر أحد المبررات التالية):\n${options}`;
}

function formatDoctorInstruction(serviceName, serviceType, daysDiff, priorDate) {
  const justifications = getSpecificJustifications(serviceName, serviceType);
  const priorDateStr = new Date(priorDate).toLocaleDateString('ar-SA');
  const typeAr = serviceType === 'medication' ? 'الدواء' : 'الإجراء';
  
  let instruction = `🔴 هذا ${typeAr} تم للمريض بتاريخ ${priorDateStr} (قبل ${daysDiff} يوم). التأمين سيرفض تلقائياً.\n\n`;
  instruction += `📋 للموافقة، يجب كتابة أحد المبررات التالية في الملف:\n`;
  
  justifications.suggestions.forEach((s, i) => {
    instruction += `   ${i + 1}. "${s}"\n`;
  });
  
  instruction += `\n📚 المرجع: ${justifications.references}`;
  
  return instruction;
}

async function ensureHistorySheet() {
  try {
    const sheets = await getSheetNames();
    if (!sheets.includes(CLAIM_HISTORY_SHEET)) {
      await createSheet(CLAIM_HISTORY_SHEET);
      await batchUpdate(CLAIM_HISTORY_SHEET, [HEADERS]);
      console.log('[ClaimHistory] Created new history sheet with headers');
    }
    return true;
  } catch (err) {
    console.error('[ClaimHistory] Error ensuring sheet:', err.message);
    return false;
  }
}

async function loadHistoricalClaims(patientIds = [], excludeSourceFile = '', excludeClaimIds = []) {
  try {
    await ensureHistorySheet();
    const data = await getSheetData(CLAIM_HISTORY_SHEET);
    
    if (!data || data.length < 2) {
      console.log('[ClaimHistory] No historical data found');
      return new Map();
    }
    
    const headers = data[0];
    const rows = data.slice(1);
    
    const patientIdIdx = headers.indexOf('patient_id');
    const serviceCodeIdx = headers.indexOf('service_code');
    const serviceNameIdx = headers.indexOf('service_name');
    const serviceDateIdx = headers.indexOf('service_date');
    const serviceTypeIdx = headers.indexOf('service_type');
    const claimIdIdx = headers.indexOf('claim_id');
    const hashIdx = headers.indexOf('hash');
    const sourceFileIdx = headers.indexOf('source_file');
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_WINDOW_DAYS);
    
    const historyMap = new Map();
    const patientIdSet = patientIds.length > 0 ? new Set(patientIds.map(String)) : null;
    const excludeClaimSet = new Set(excludeClaimIds.map(String));
    
    let excludedCount = 0;
    
    for (const row of rows) {
      const patientId = row[patientIdIdx];
      const serviceDate = parseServiceDate(row[serviceDateIdx]);
      const sourceFile = row[sourceFileIdx] || '';
      const claimId = row[claimIdIdx] || '';
      
      if (!patientId || !serviceDate) continue;
      if (serviceDate < cutoffDate) continue;
      if (patientIdSet && !patientIdSet.has(String(patientId))) continue;
      
      // استثناء السجلات من نفس الملف الحالي (لتجنب التكرار الوهمي)
      if (excludeSourceFile && sourceFile === excludeSourceFile) {
        excludedCount++;
        continue;
      }
      
      // استثناء السجلات من نفس المطالبات الحالية
      if (excludeClaimSet.has(String(claimId))) {
        excludedCount++;
        continue;
      }
      
      if (!historyMap.has(patientId)) {
        historyMap.set(patientId, new Map());
      }
      
      const serviceCode = normalizeServiceCode(row[serviceCodeIdx]);
      const patientServices = historyMap.get(patientId);
      
      if (!patientServices.has(serviceCode)) {
        patientServices.set(serviceCode, []);
      }
      
      patientServices.get(serviceCode).push({
        date: serviceDate,
        serviceName: row[serviceNameIdx] || row[serviceCodeIdx],
        serviceType: row[serviceTypeIdx],
        claimId: claimId,
        hash: row[hashIdx],
        sourceFile: sourceFile
      });
    }
    
    if (excludedCount > 0) {
      console.log(`[ClaimHistory] Excluded ${excludedCount} records from current file/claims`);
    }
    
    console.log(`[ClaimHistory] Loaded ${historyMap.size} patients with history`);
    return historyMap;
  } catch (err) {
    console.error('[ClaimHistory] Error loading history:', err.message);
    return new Map();
  }
}

export async function detectDuplicates(cases, sourceFileName = '') {
  const duplicateFindings = [];
  const newClaimsToStore = [];
  
  try {
    const patientIds = [...new Set(cases.map(c => c.patientId).filter(Boolean))];
    const currentClaimIds = [...new Set(cases.map(c => c.claimId).filter(Boolean))];
    
    // تحميل السجلات التاريخية مع استثناء نفس الملف ونفس المطالبات الحالية
    const historyMap = await loadHistoricalClaims(patientIds, sourceFileName, currentClaimIds);
    
    console.log(`[ClaimHistory] Checking ${cases.length} cases for duplicates (excluding file: ${sourceFileName || 'none'})`);
    
    const today = new Date();
    
    for (const caseData of cases) {
      const patientId = caseData.patientId;
      if (!patientId) continue;
      
      const patientHistory = historyMap.get(patientId) || new Map();
      const caseDuplicates = {
        caseId: caseData.claimId,
        patientId: patientId,
        medications: [],
        procedures: []
      };
      
      for (const med of (caseData.medications || [])) {
        const serviceCode = normalizeServiceCode(med.name || med);
        const serviceName = typeof med === 'string' ? med : (med.name || med);
        const serviceDate = parseServiceDate(caseData.serviceDate) || today;
        
        const priorOccurrences = patientHistory.get(serviceCode) || [];
        
        for (const prior of priorOccurrences) {
          const daysDiff = daysBetween(serviceDate, prior.date);
          
          if (daysDiff <= 30) {
            caseDuplicates.medications.push({
              medication: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'reject',
              reason: `❌ مرفوض تلقائياً: نفس الدواء صُرف قبل ${daysDiff} يوم فقط`,
              priorClaimId: prior.claimId,
              doctorInstruction: formatDoctorInstruction(serviceName, 'medication', daysDiff, prior.date),
              copyPasteText: formatCopyPasteText(serviceName, 'medication')
            });
          } else if (daysDiff <= 60) {
            const justifications = getSpecificJustifications(serviceName, 'medication');
            caseDuplicates.medications.push({
              medication: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'warning',
              reason: `⚠️ تحذير: نفس الدواء صُرف قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: `🟡 هذا الدواء صُرف للمريض قبل ${daysDiff} يوم. قد يُطلب توثيق إضافي.\n\n📋 يُنصح بتوثيق أحد الأسباب:\n${justifications.suggestions.slice(0, 2).map((s, i) => `   ${i + 1}. "${s}"`).join('\n')}`,
              copyPasteText: formatCopyPasteText(serviceName, 'medication')
            });
          } else if (daysDiff <= 90) {
            caseDuplicates.medications.push({
              medication: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'watch',
              reason: `📊 ملاحظة: نفس الدواء صُرف قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: `🔵 معلومة للطبيب: هذا الدواء صُرف للمريض قبل ${daysDiff} يوم. لا يتطلب توثيق خاص ولكن يُفضل التحقق من الالتزام العلاجي.`,
              copyPasteText: null
            });
          }
        }
        
        const hash = generateHash(patientId, serviceCode, serviceDate);
        newClaimsToStore.push({
          hash,
          patient_id: patientId,
          patient_name: caseData.patientName || '',
          service_type: 'medication',
          service_code: serviceCode,
          service_name: serviceName,
          icd_code: caseData.icdCode || '',
          service_date: serviceDate.toISOString().split('T')[0],
          quantity: typeof med === 'object' ? (med.quantity || 1) : 1,
          claim_id: caseData.claimId || '',
          source_file: sourceFileName,
          created_at: new Date().toISOString()
        });
      }
      
      for (const proc of (caseData.procedures || [])) {
        const serviceCode = normalizeServiceCode(proc.code || proc.name || proc);
        const serviceName = typeof proc === 'string' ? proc : (proc.name || proc.code || proc);
        const serviceDate = parseServiceDate(caseData.serviceDate) || today;
        
        const priorOccurrences = patientHistory.get(serviceCode) || [];
        
        for (const prior of priorOccurrences) {
          const daysDiff = daysBetween(serviceDate, prior.date);
          
          if (daysDiff <= 30) {
            caseDuplicates.procedures.push({
              procedure: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'reject',
              reason: `❌ مرفوض: نفس الإجراء تم قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: formatDoctorInstruction(serviceName, 'procedure', daysDiff, prior.date),
              copyPasteText: formatCopyPasteText(serviceName, 'procedure')
            });
          } else if (daysDiff <= 60) {
            const justifications = getSpecificJustifications(serviceName, 'procedure');
            caseDuplicates.procedures.push({
              procedure: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'warning',
              reason: `⚠️ تحذير: نفس الإجراء تم قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: `🟡 هذا الإجراء تم قبل ${daysDiff} يوم. قد يُطلب مبرر طبي.\n\n📋 مبررات مقترحة:\n${justifications.suggestions.slice(0, 2).map((s, i) => `   ${i + 1}. "${s}"`).join('\n')}`,
              copyPasteText: formatCopyPasteText(serviceName, 'procedure')
            });
          }
        }
        
        const hash = generateHash(patientId, serviceCode, serviceDate);
        newClaimsToStore.push({
          hash,
          patient_id: patientId,
          patient_name: caseData.patientName || '',
          service_type: 'procedure',
          service_code: serviceCode,
          service_name: serviceName,
          icd_code: caseData.icdCode || '',
          service_date: serviceDate.toISOString().split('T')[0],
          quantity: 1,
          claim_id: caseData.claimId || '',
          source_file: sourceFileName,
          created_at: new Date().toISOString()
        });
      }
      
      const hasDuplicates = caseDuplicates.medications.length > 0 || caseDuplicates.procedures.length > 0;
      if (hasDuplicates) {
        duplicateFindings.push(caseDuplicates);
      }
    }
    
    if (newClaimsToStore.length > 0) {
      await storeNewClaims(newClaimsToStore);
    }
    
    return {
      duplicates: duplicateFindings,
      summary: generateDuplicateSummary(duplicateFindings),
      totalChecked: cases.length,
      patientsWithDuplicates: duplicateFindings.length
    };
    
  } catch (err) {
    console.error('[ClaimHistory] Error detecting duplicates:', err.message);
    return {
      duplicates: [],
      summary: null,
      error: err.message
    };
  }
}

async function storeNewClaims(claims) {
  try {
    await ensureHistorySheet();
    
    const existingData = await getSheetData(CLAIM_HISTORY_SHEET);
    const existingHashes = new Set();
    
    if (existingData && existingData.length > 1) {
      const hashIdx = existingData[0].indexOf('hash');
      for (let i = 1; i < existingData.length; i++) {
        existingHashes.add(existingData[i][hashIdx]);
      }
    }
    
    const newRows = [];
    for (const claim of claims) {
      if (!existingHashes.has(claim.hash)) {
        newRows.push([
          claim.hash,
          claim.patient_id,
          claim.patient_name,
          claim.service_type,
          claim.service_code,
          claim.service_name,
          claim.icd_code,
          claim.service_date,
          claim.quantity,
          claim.claim_id,
          claim.source_file,
          claim.created_at
        ]);
        existingHashes.add(claim.hash);
      }
    }
    
    if (newRows.length > 0) {
      for (const row of newRows) {
        await appendRow(CLAIM_HISTORY_SHEET, row);
      }
      console.log(`[ClaimHistory] Stored ${newRows.length} new claims`);
    }
    
    return newRows.length;
  } catch (err) {
    console.error('[ClaimHistory] Error storing claims:', err.message);
    return 0;
  }
}

function generateDuplicateSummary(duplicates) {
  if (duplicates.length === 0) return null;
  
  let rejectCount = 0;
  let warningCount = 0;
  let watchCount = 0;
  
  for (const dup of duplicates) {
    for (const med of dup.medications) {
      if (med.severity === 'reject') rejectCount++;
      else if (med.severity === 'warning') warningCount++;
      else if (med.severity === 'watch') watchCount++;
    }
    for (const proc of dup.procedures) {
      if (proc.severity === 'reject') rejectCount++;
      else if (proc.severity === 'warning') warningCount++;
      else if (proc.severity === 'watch') watchCount++;
    }
  }
  
  return {
    totalDuplicates: rejectCount + warningCount + watchCount,
    rejectCount,
    warningCount,
    watchCount,
    text: `🔍 كشف التكرار: ${rejectCount > 0 ? `❌ ${rejectCount} مرفوض` : ''} ${warningCount > 0 ? `⚠️ ${warningCount} تحذير` : ''} ${watchCount > 0 ? `📊 ${watchCount} ملاحظة` : ''}`.trim()
  };
}

export function formatDuplicatesForPrompt(duplicateResult) {
  if (!duplicateResult || !duplicateResult.duplicates || duplicateResult.duplicates.length === 0) {
    return '';
  }
  
  let text = `\n\n=== 🔍 تحليل التكرار عبر الزمن ===\n`;
  text += `تم فحص ${duplicateResult.totalChecked} حالة | ${duplicateResult.patientsWithDuplicates} مريض لديه تكرار\n\n`;
  
  for (const dup of duplicateResult.duplicates) {
    text += `📋 المريض: ${dup.patientId} | المطالبة: ${dup.caseId}\n`;
    
    for (const med of dup.medications) {
      text += `  ${med.severity === 'reject' ? '🔴' : med.severity === 'warning' ? '🟡' : '🔵'} ${med.medication}\n`;
      text += `    ${med.reason}\n`;
      text += `    📅 التاريخ السابق: ${med.priorDate}\n`;
      if (med.copyPasteText) {
        text += `    ✍️ نص جاهز للتوثيق: "${med.copyPasteText}"\n`;
      }
    }
    
    for (const proc of dup.procedures) {
      text += `  ${proc.severity === 'reject' ? '🔴' : proc.severity === 'warning' ? '🟡' : '🔵'} ${proc.procedure}\n`;
      text += `    ${proc.reason}\n`;
      text += `    📅 التاريخ السابق: ${proc.priorDate}\n`;
      if (proc.copyPasteText) {
        text += `    ✍️ نص جاهز للتوثيق: "${proc.copyPasteText}"\n`;
      }
    }
    text += '\n';
  }
  
  return text;
}

export function formatDuplicatesForReport(duplicateResult) {
  if (!duplicateResult || !duplicateResult.duplicates || duplicateResult.duplicates.length === 0) {
    return null;
  }
  
  return {
    summary: duplicateResult.summary,
    details: duplicateResult.duplicates.map(dup => ({
      patientId: dup.patientId,
      claimId: dup.caseId,
      medications: dup.medications.map(m => ({
        name: m.medication,
        severity: m.severity,
        daysSinceLast: m.daysDiff,
        lastDate: m.priorDate,
        instruction: m.doctorInstruction,
        copyPaste: m.copyPasteText
      })),
      procedures: dup.procedures.map(p => ({
        name: p.procedure,
        severity: p.severity,
        daysSinceLast: p.daysDiff,
        lastDate: p.priorDate,
        instruction: p.doctorInstruction,
        copyPaste: p.copyPasteText
      }))
    }))
  };
}
