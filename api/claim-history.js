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

async function loadHistoricalClaims(patientIds = []) {
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
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORY_WINDOW_DAYS);
    
    const historyMap = new Map();
    const patientIdSet = patientIds.length > 0 ? new Set(patientIds.map(String)) : null;
    
    for (const row of rows) {
      const patientId = row[patientIdIdx];
      const serviceDate = parseServiceDate(row[serviceDateIdx]);
      
      if (!patientId || !serviceDate) continue;
      if (serviceDate < cutoffDate) continue;
      if (patientIdSet && !patientIdSet.has(String(patientId))) continue;
      
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
        claimId: row[claimIdIdx],
        hash: row[hashIdx]
      });
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
    const historyMap = await loadHistoricalClaims(patientIds);
    
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
              doctorInstruction: `🔴 هذا الدواء صُرف للمريض بتاريخ ${prior.date.toLocaleDateString('ar-SA')} (قبل ${daysDiff} يوم). التأمين سيرفض تلقائياً.\n\n📋 للموافقة، يجب توثيق أحد الأسباب التالية:\n• "المريض فقد الدواء السابق ويحتاج بديل"\n• "تغيير الجرعة من X إلى Y بسبب عدم الاستجابة"\n• "انتهاء الكمية المصروفة مبكراً بسبب زيادة الجرعة"`,
              copyPasteText: `سبب إعادة الصرف: __________`
            });
          } else if (daysDiff <= 60) {
            caseDuplicates.medications.push({
              medication: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'warning',
              reason: `⚠️ تحذير: نفس الدواء صُرف قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: `🟡 هذا الدواء صُرف للمريض قبل ${daysDiff} يوم. قد يُطلب توثيق إضافي.\n\n📋 يُنصح بتوثيق:\n• سبب الحاجة لإعادة الصرف\n• الاستجابة للعلاج السابق`,
              copyPasteText: `الاستجابة للعلاج السابق: __________ | سبب الإعادة: __________`
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
              doctorInstruction: `🔴 هذا الإجراء تم للمريض بتاريخ ${prior.date.toLocaleDateString('ar-SA')} (قبل ${daysDiff} يوم).\n\n📋 للموافقة، يجب توثيق:\n• "نتيجة الإجراء السابق غير حاسمة ويتطلب إعادة"\n• "تطور الحالة يستدعي إعادة التقييم"`,
              copyPasteText: `سبب إعادة الإجراء: __________`
            });
          } else if (daysDiff <= 60) {
            caseDuplicates.procedures.push({
              procedure: serviceName,
              priorDate: prior.date.toISOString().split('T')[0],
              daysDiff,
              severity: 'warning',
              reason: `⚠️ تحذير: نفس الإجراء تم قبل ${daysDiff} يوم`,
              priorClaimId: prior.claimId,
              doctorInstruction: `🟡 هذا الإجراء تم قبل ${daysDiff} يوم. قد يُطلب مبرر طبي.`,
              copyPasteText: `المبرر الطبي: __________`
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
