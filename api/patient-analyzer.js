// /api/patient-analyzer.js
import XLSX from 'xlsx';
import { detectDuplicates, formatDuplicatesForPrompt, formatDuplicatesForReport } from './claim-history.js';
import { detectMissingRequiredTests, generateMissingTestsSection, generateMissingTestsHTML, getDemographicRecommendations, generateDemographicRecommendationsHTML, calculateBMI, getBMICategory } from './required-tests.js';
import { calculateKPIs, generateKPIDashboardHTML, extractStatsFromReport, extractStatsFromCases } from './kpi-dashboard.js';

// Robust date parser - handles Excel serials, dd/MM/yyyy, yyyy-MM-dd, and other formats
// Returns ISO date string (YYYY-MM-DD) or null if unparseable
function parseServiceDate(value) {
  if (!value) return null;
  
  // Handle Excel serial date number
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return null;
  }
  
  const str = String(value).trim();
  if (!str) return null;
  
  // Try ISO format (yyyy-MM-dd) first
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return str;
  }
  
  // Handle dd/MM/yyyy or dd-MM-yyyy (common Arabic/European format)
  const ddmmyyyy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  
  // Handle MM/dd/yyyy (US format)
  const mmddyyyy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    // Only try US format if day > 12 (can't be month)
    if (parseInt(day) > 12) {
      const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
      }
    }
  }
  
  // Last resort: try native Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000 && parsed.getFullYear() < 2100) {
    return parsed.toISOString().split('T')[0];
  }
  
  return null; // Unparseable - return null, don't store invalid strings
}

// Parse text content that was pre-processed by frontend (pipe-separated rows)
function parseTextContent(textContent) {
  try {
    console.log('[parseTextContent] Parsing pre-processed text content...');
    
    const lines = textContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) return null;
    
    // Find header line by scanning for key tokens (claim, patient, service, icd)
    let headerLineIdx = -1;
    const headerKeywords = ['claim', 'patient', 'service', 'icd', 'description', 'file no'];
    
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const lineLower = lines[i].toLowerCase();
      // Skip sheet name lines like "=== ورقة1 ==="
      if (lines[i].startsWith('===')) continue;
      // Skip metadata lines like "[تم التعرف على الحقول:"
      if (lines[i].startsWith('[')) continue;
      
      // Check if this line contains multiple header keywords
      const matchCount = headerKeywords.filter(kw => lineLower.includes(kw)).length;
      if (matchCount >= 2) {
        headerLineIdx = i;
        console.log(`[parseTextContent] Found header at line ${i}: ${lines[i].substring(0, 100)}...`);
        break;
      }
    }
    
    if (headerLineIdx < 0) {
      console.log('[parseTextContent] Could not find header line with key tokens');
      return null;
    }
    
    let headerLine = lines[headerLineIdx];
    let dataStartIdx = headerLineIdx + 1;
    
    // Normalize header by replacing multiple spaces/newlines with single space
    const headers = headerLine.split('|').map(h => h.trim().replace(/\s+/g, ' ').toLowerCase());
    console.log('[parseTextContent] Headers detected:', headers.slice(0, 8));
    
    // Find column indices
    const claimIdx = headers.findIndex(h => h.includes('claim') || h.includes('se no'));
    const patientIdx = headers.findIndex(h => h.includes('patient') || h.includes('file no'));
    const icdDescCols = headers.map((h, i) => (h.includes('icd') && h.includes('description')) ? i : -1).filter(i => i >= 0);
    // Find ICD code columns (not descriptions) - e.g., "icd_code 1", "icd code"
    const icdCodeCols = headers.map((h, i) => (h.includes('icd') && h.includes('code') && !h.includes('description')) ? i : -1).filter(i => i >= 0);
    const serviceDescIdx = headers.findIndex(h => (h.includes('service') && h.includes('desc')) || h.includes('item desc'));
    const serviceDateIdx = headers.findIndex(h => h.includes('date') || h.includes('تاريخ'));
    const tempIdx = headers.findIndex(h => h.includes('temp'));
    const bpIdx = headers.findIndex(h => h.includes('pressure') || h.includes('bp'));
    const pulseIdx = headers.findIndex(h => h.includes('pulse'));
    const weightIdx = headers.findIndex(h => h.includes('weight') || h.includes('وزن'));
    const heightIdx = headers.findIndex(h => h.includes('height') || h.includes('طول'));
    
    // Demographics - العمر والجنس
    const ageIdx = headers.findIndex(h => h.includes('age') || h.includes('عمر') || h.includes('سن'));
    const genderIdx = headers.findIndex(h => h.includes('gender') || h.includes('sex') || h.includes('جنس'));
    
    console.log('[parseTextContent] Column indices:', { claimIdx, patientIdx, serviceDescIdx, serviceDateIdx, ageIdx, genderIdx });
    
    if (claimIdx < 0 && serviceDescIdx < 0) {
      console.log('[parseTextContent] Could not find key columns, returning null');
      return null;
    }
    
    // Group rows by claim ID
    const caseMap = new Map();
    for (let i = dataStartIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('===')) continue; // Skip sheet headers
      
      const cells = line.split('|').map(c => c.trim());
      if (cells.length < 3) continue;
      
      const claimId = claimIdx >= 0 ? cells[claimIdx] || '' : `row_${i}`;
      if (!claimId) continue;
      
      // Get diagnosis from ICD description columns
      let diagText = '';
      if (icdDescCols.length > 0) {
        diagText = icdDescCols.map(idx => cells[idx] || '').filter(d => d).join(' | ');
      }
      
      // Get ICD codes (actual codes like E11.9, K29.70)
      let icdCodes = '';
      if (icdCodeCols.length > 0) {
        icdCodes = icdCodeCols.map(idx => cells[idx] || '').filter(c => c).join(' | ');
      }
      
      if (!caseMap.has(claimId)) {
        // Extract service date using robust parser
        const serviceDate = serviceDateIdx >= 0 ? parseServiceDate(cells[serviceDateIdx]) : null;
        
        // Extract age
        let patientAge = null;
        if (ageIdx >= 0 && cells[ageIdx]) {
          const ageVal = String(cells[ageIdx]).trim();
          const numMatch = ageVal.match(/\d+/);
          if (numMatch) patientAge = parseInt(numMatch[0]);
        }
        
        // Extract gender
        let patientGender = null;
        if (genderIdx >= 0 && cells[genderIdx]) {
          const genderVal = String(cells[genderIdx]).toLowerCase().trim();
          if (genderVal.includes('male') || genderVal.includes('ذكر') || genderVal === 'm') {
            patientGender = 'male';
          } else if (genderVal.includes('female') || genderVal.includes('أنثى') || genderVal.includes('انثى') || genderVal === 'f') {
            patientGender = 'female';
          }
        }
        
        caseMap.set(claimId, {
          claimId,
          patientId: patientIdx >= 0 ? cells[patientIdx] : '',
          diagnosis: diagText,
          icdCode: icdCodes, // Add ICD codes for required tests detection
          serviceDate: serviceDate,
          age: patientAge,
          gender: patientGender,
          vitals: {
            temperature: tempIdx >= 0 ? cells[tempIdx] : '',
            bloodPressure: bpIdx >= 0 ? cells[bpIdx] : '',
            pulse: pulseIdx >= 0 ? cells[pulseIdx] : '',
            weight: weightIdx >= 0 ? cells[weightIdx] : '',
            height: heightIdx >= 0 ? cells[heightIdx] : ''
          },
          services: [],
          medications: [],
          procedures: [],
          rawData: []
        });
      }
      
      const c = caseMap.get(claimId);
      c.rawData.push(line);
      
      // UPDATE serviceDate if current row has a valid date and we don't have one yet
      if (!c.serviceDate && serviceDateIdx >= 0) {
        const parsedDate = parseServiceDate(cells[serviceDateIdx]);
        if (parsedDate) c.serviceDate = parsedDate;
      }
      
      // UPDATE icdCode if current row has ICD codes and we don't have them yet
      if ((!c.icdCode || c.icdCode.length === 0) && icdCodes) {
        c.icdCode = icdCodes;
      } else if (c.icdCode && icdCodes && !c.icdCode.includes(icdCodes)) {
        // Append new ICD codes if not already included
        c.icdCode = c.icdCode + ' | ' + icdCodes;
      }
      
      // UPDATE diagnosis if current row has diagnosis text and we don't have it yet
      if ((!c.diagnosis || c.diagnosis.length === 0) && diagText) {
        c.diagnosis = diagText;
      }
      
      // Extract service description - الاحتفاظ بكل الخدمات حتى المكررة للحساب الصحيح
      if (serviceDescIdx >= 0 && cells[serviceDescIdx]) {
        const serviceDesc = cells[serviceDescIdx];
        c.services.push({ name: serviceDesc, code: '', amount: '' });
      }
    }
    
    // Classify services as medications or procedures
    for (const c of caseMap.values()) {
      for (const svc of c.services) {
        const name = svc.name.toUpperCase();
        if (name.includes('TAB') || name.includes('CAP') || name.includes('SYRUP') || 
            name.includes('INJ') || name.includes('MG') || name.includes('ML') ||
            name.includes('SOLUTION') || name.includes('INFUSION') || name.includes('CREAM') ||
            name.includes('DROP') || name.includes('SUSP') || name.includes('ORAL') ||
            name.includes('I.V.') || name.includes('PARACETAMOL') || name.includes('AMOXICILLIN') ||
            name.includes('SALINE') || name.includes('DEXTROSE') || name.includes('ANTIBIOTIC')) {
          c.medications.push({ name: svc.name, dose: '1' });
        } else if (name.includes('ANALYSIS') || name.includes('TEST') || name.includes('CBC') ||
                   name.includes('X-RAY') || name.includes('SCAN') || name.includes('CULTURE') ||
                   name.includes('EXAM') || name.includes('BLOOD') || name.includes('URINE')) {
          c.procedures.push(svc.name);
        } else {
          c.procedures.push(svc.name);
        }
      }
      console.log(`[parseTextContent] Case ${c.claimId}: ${c.medications.length} meds, ${c.procedures.length} procs`);
    }
    
    const cases = Array.from(caseMap.values());
    console.log(`[parseTextContent] Total cases extracted: ${cases.length}`);
    return cases.length > 0 ? cases : null;
  } catch (err) {
    console.error('[parseTextContent] Error:', err);
    return null;
  }
}

// Parse Excel file and extract cases - FIXED for actual Excel structure
function parseExcelCases(base64Data) {
  try {
    // Quick check: if it looks like pre-processed text (has pipes and line breaks), skip XLSX parsing
    if (typeof base64Data === 'string' && (base64Data.includes('|') && base64Data.includes('\n'))) {
      console.log('[parseExcelCases] Detected pre-processed text format, skipping XLSX parsing');
      return null; // Let parseTextContent handle it
    }
    
    const workbook = XLSX.read(base64Data, { type: 'base64' });
    const cases = [];
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      if (jsonData.length < 2) continue;
      
      // Clean headers - remove newlines and normalize
      const rawHeaders = jsonData[0];
      const headers = rawHeaders.map(h => String(h || '').toLowerCase().replace(/[\r\n]+/g, ' ').trim());
      
      console.log('[parseExcelCases] Headers found:', headers.slice(0, 10));
      
      // Find key columns - support actual Excel format with "Claim Se No.", "Service description", etc.
      const claimIdx = headers.findIndex(h => h.includes('claim') || h.includes('se no') || h.includes('رقم'));
      const patientIdx = headers.findIndex(h => h.includes('patient') || h.includes('file no') || h.includes('مريض') || h.includes('mrn'));
      
      // ICD columns - look for ICD DESCRIPTION (contains diagnosis text)
      const icdDescCols = headers.map((h, i) => (h.includes('icd') && h.includes('description')) ? i : -1).filter(i => i >= 0);
      // ICD code columns (actual codes like E11.9) - for required tests detection
      const icdCodeCols = headers.map((h, i) => (h.includes('icd') && h.includes('code') && !h.includes('description')) ? i : -1).filter(i => i >= 0);
      // Fallback to any column with "diag" or "تشخيص"
      const diagIdx = icdDescCols.length > 0 ? icdDescCols[0] : headers.findIndex(h => h.includes('diag') || h.includes('تشخيص'));
      
      // Vital signs
      const tempIdx = headers.findIndex(h => h.includes('temp') || h.includes('حرارة'));
      const bpIdx = headers.findIndex(h => h.includes('pressure') || h.includes('bp') || h.includes('ضغط'));
      const pulseIdx = headers.findIndex(h => h.includes('pulse') || h.includes('نبض'));
      const weightIdx = headers.findIndex(h => h.includes('weight') || h.includes('وزن'));
      const heightIdx = headers.findIndex(h => h.includes('height') || h.includes('طول'));
      
      // Demographics - العمر والجنس
      const ageIdx = headers.findIndex(h => h.includes('age') || h.includes('عمر') || h.includes('سن'));
      const genderIdx = headers.findIndex(h => h.includes('gender') || h.includes('sex') || h.includes('جنس'));
      
      // Service description column - THIS IS THE KEY! Contains medications AND procedures
      const serviceDescIdx = headers.findIndex(h => 
        (h.includes('service') && h.includes('desc')) || 
        h.includes('item desc') || 
        h.includes('item name') ||
        (h.includes('description') && !h.includes('icd'))
      );
      
      // Service code column
      const serviceCodeIdx = headers.findIndex(h => 
        (h.includes('service') && h.includes('code')) || 
        h.includes('item code')
      );
      
      // Net amount column (for context)
      const amountIdx = headers.findIndex(h => h.includes('amount') || h.includes('net') || h.includes('price') || h.includes('cost'));
      
      // Service date column - CRITICAL for temporal duplicate detection
      const serviceDateIdx = headers.findIndex(h => 
        h.includes('service date') || h.includes('claim date') || h.includes('date') ||
        h.includes('تاريخ') || h.includes('visit date')
      );
      
      console.log('[parseExcelCases] Column indices:', { claimIdx, patientIdx, diagIdx, serviceDescIdx, serviceDateIdx, tempIdx, bpIdx });
      
      // Group rows by claim ID
      const caseMap = new Map();
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        
        const claimId = claimIdx >= 0 ? String(row[claimIdx] || '') : `row_${i}`;
        if (!claimId) continue;
        
        // Get all ICD descriptions for diagnosis
        let diagText = '';
        if (icdDescCols.length > 0) {
          diagText = icdDescCols.map(idx => row[idx] ? String(row[idx]).trim() : '').filter(d => d).join(' | ');
        } else if (diagIdx >= 0) {
          diagText = String(row[diagIdx] || '');
        }
        
        // Get ICD codes (actual codes like E11.9, K29.70)
        let icdCodes = '';
        if (icdCodeCols.length > 0) {
          icdCodes = icdCodeCols.map(idx => row[idx] ? String(row[idx]).trim() : '').filter(c => c).join(' | ');
        }
        
        if (!caseMap.has(claimId)) {
          // Extract service date using robust parser
          const serviceDate = serviceDateIdx >= 0 ? parseServiceDate(row[serviceDateIdx]) : null;
          
          // Extract age - handle various formats
          let patientAge = null;
          if (ageIdx >= 0 && row[ageIdx]) {
            const ageVal = String(row[ageIdx]).trim();
            const numMatch = ageVal.match(/\d+/);
            if (numMatch) patientAge = parseInt(numMatch[0]);
          }
          
          // Extract gender
          let patientGender = null;
          if (genderIdx >= 0 && row[genderIdx]) {
            const genderVal = String(row[genderIdx]).toLowerCase().trim();
            if (genderVal.includes('male') || genderVal.includes('ذكر') || genderVal === 'm') {
              patientGender = 'male';
            } else if (genderVal.includes('female') || genderVal.includes('أنثى') || genderVal.includes('انثى') || genderVal === 'f') {
              patientGender = 'female';
            }
          }
          
          caseMap.set(claimId, {
            claimId,
            patientId: patientIdx >= 0 ? row[patientIdx] : '',
            diagnosis: diagText,
            icdCode: icdCodes, // Add ICD codes for required tests detection
            serviceDate: serviceDate,
            age: patientAge,
            gender: patientGender,
            vitals: {
              temperature: tempIdx >= 0 ? row[tempIdx] : '',
              bloodPressure: bpIdx >= 0 ? row[bpIdx] : '',
              pulse: pulseIdx >= 0 ? row[pulseIdx] : '',
              weight: weightIdx >= 0 ? row[weightIdx] : '',
              height: heightIdx >= 0 ? row[heightIdx] : ''
            },
            services: [], // All services from Service description
            rawData: []
          });
        }
        
        const c = caseMap.get(claimId);
        c.rawData.push(row.join(' | '));
        
        // UPDATE serviceDate if current row has a valid date and we don't have one yet
        if (!c.serviceDate && serviceDateIdx >= 0) {
          const parsedDate = parseServiceDate(row[serviceDateIdx]);
          if (parsedDate) c.serviceDate = parsedDate;
        }
        
        // UPDATE icdCode if current row has ICD codes and we don't have them yet
        if ((!c.icdCode || c.icdCode.length === 0) && icdCodes) {
          c.icdCode = icdCodes;
        } else if (c.icdCode && icdCodes && !c.icdCode.includes(icdCodes)) {
          // Append new ICD codes if not already included
          c.icdCode = c.icdCode + ' | ' + icdCodes;
        }
        
        // UPDATE diagnosis if current row has diagnosis text and we don't have it yet
        if ((!c.diagnosis || c.diagnosis.length === 0) && diagText) {
          c.diagnosis = diagText;
        }
        
        // Extract service/medication from "Service description" column
        if (serviceDescIdx >= 0 && row[serviceDescIdx]) {
          const serviceDesc = String(row[serviceDescIdx]).trim();
          const serviceCode = serviceCodeIdx >= 0 ? String(row[serviceCodeIdx] || '') : '';
          const amount = amountIdx >= 0 ? row[amountIdx] : '';
          
          // الاحتفاظ بكل الخدمات حتى المكررة للحساب الصحيح
          if (serviceDesc) {
            c.services.push({
              name: serviceDesc,
              code: serviceCode,
              amount: String(amount)
            });
          }
        }
      }
      
      // Convert services to medications/procedures for compatibility
      for (const c of caseMap.values()) {
        // Classify services as medications or procedures based on keywords
        c.medications = [];
        c.procedures = [];
        
        for (const svc of c.services) {
          const name = svc.name.toUpperCase();
          // Medication keywords
          if (name.includes('TAB') || name.includes('CAP') || name.includes('SYRUP') || 
              name.includes('INJ') || name.includes('MG') || name.includes('ML') ||
              name.includes('SOLUTION') || name.includes('INFUSION') || name.includes('CREAM') ||
              name.includes('OINT') || name.includes('DROP') || name.includes('SUSP') ||
              name.includes('ORAL') || name.includes('I.V.') || name.includes('IM') ||
              name.includes('PARACETAMOL') || name.includes('AMOXICILLIN') || name.includes('OMEPRAZOLE') ||
              name.includes('SALINE') || name.includes('DEXTROSE') || name.includes('ANTIBIOTIC')) {
            c.medications.push({ name: svc.name, dose: svc.amount || '1' });
          } 
          // Procedure/test keywords
          else if (name.includes('ANALYSIS') || name.includes('TEST') || name.includes('CBC') ||
                   name.includes('X-RAY') || name.includes('SCAN') || name.includes('CULTURE') ||
                   name.includes('EXAM') || name.includes('CONSULT') || name.includes('PROCEDURE') ||
                   name.includes('BLOOD') || name.includes('URINE') || name.includes('STOOL')) {
            c.procedures.push(svc.name);
          } 
          // Default: treat as procedure
          else {
            c.procedures.push(svc.name);
          }
        }
        
        console.log(`[parseExcelCases] Case ${c.claimId}: ${c.medications.length} meds, ${c.procedures.length} procs, diagnosis: ${c.diagnosis.substring(0, 50)}`);
      }
      
      cases.push(...caseMap.values());
    }
    
    console.log(`[parseExcelCases] Total cases extracted: ${cases.length}`);
    return cases;
  } catch (err) {
    console.error('Excel parsing error:', err);
    return null;
  }
}

// Build prompt for a single case - COMPACT format like Report #20
function buildSingleCasePrompt(caseData, caseNumber, totalCases, language, caseDuplicates = null) {
  const L = language === 'en' ? 'en' : 'ar';
  
  // Only include vitals that are actually available
  const vitals = caseData.vitals || {};
  const temp = vitals.temperature && vitals.temperature !== 'N/A' ? vitals.temperature : '';
  const bp = vitals.bloodPressure && vitals.bloodPressure !== 'N/A' ? vitals.bloodPressure : '';
  
  // Build duplicate warning section if duplicates found for this case
  let duplicateSection = '';
  if (caseDuplicates) {
    if (L === 'ar') {
      duplicateSection = '\n\n🔄 **تنبيه تكرار تاريخي:**\n';
      for (const med of (caseDuplicates.medications || [])) {
        duplicateSection += `${med.severity === 'reject' ? '🔴' : med.severity === 'warning' ? '🟡' : '🔵'} ${med.medication}: ${med.reason}\n`;
        if (med.copyPasteText) {
          duplicateSection += `  📝 نص التوثيق: "${med.copyPasteText}"\n`;
        }
      }
      for (const proc of (caseDuplicates.procedures || [])) {
        duplicateSection += `${proc.severity === 'reject' ? '🔴' : proc.severity === 'warning' ? '🟡' : '🔵'} ${proc.procedure}: ${proc.reason}\n`;
        if (proc.copyPasteText) {
          duplicateSection += `  📝 نص التوثيق: "${proc.copyPasteText}"\n`;
        }
      }
    } else {
      duplicateSection = '\n\n🔄 **Historical Duplicate Alert:**\n';
      for (const med of (caseDuplicates.medications || [])) {
        duplicateSection += `${med.severity === 'reject' ? '🔴' : med.severity === 'warning' ? '🟡' : '🔵'} ${med.medication}: ${med.reason}\n`;
        if (med.copyPasteText) {
          duplicateSection += `  📝 Documentation: "${med.copyPasteText}"\n`;
        }
      }
      for (const proc of (caseDuplicates.procedures || [])) {
        duplicateSection += `${proc.severity === 'reject' ? '🔴' : proc.severity === 'warning' ? '🟡' : '🔵'} ${proc.procedure}: ${proc.reason}\n`;
        if (proc.copyPasteText) {
          duplicateSection += `  📝 Documentation: "${proc.copyPasteText}"\n`;
        }
      }
    }
  }
  
  if (L === 'ar') {
    let vitalsLine = '';
    if (temp) vitalsLine += `الحرارة: ${temp}`;
    if (bp) vitalsLine += (vitalsLine ? ' | ' : '') + `الضغط: ${bp}`;
    
    return `🔍 الحالة ${caseNumber} | Claim: ${caseData.claimId} | المريض: ${caseData.patientId || '-'}
التشخيص: ${caseData.diagnosis || '-'}${vitalsLine ? '\n' + vitalsLine : ''}
الأدوية: ${caseData.medications.length > 0 ? caseData.medications.map(m => `${m.name} (${m.dose || '-'})`).join(' | ') : 'لا يوجد'}
الإجراءات: ${caseData.procedures.length > 0 ? caseData.procedures.join(' | ') : 'لا يوجد'}${duplicateSection}
---`;
  } else {
    let vitalsLine = '';
    if (temp) vitalsLine += `Temp: ${temp}`;
    if (bp) vitalsLine += (vitalsLine ? ' | ' : '') + `BP: ${bp}`;
    
    return `🔍 Case ${caseNumber} | Claim: ${caseData.claimId} | Patient: ${caseData.patientId || '-'}
Diagnosis: ${caseData.diagnosis || '-'}${vitalsLine ? '\n' + vitalsLine : ''}
Medications: ${caseData.medications.length > 0 ? caseData.medications.map(m => `${m.name} (${m.dose || '-'})`).join(' | ') : 'None'}
Procedures: ${caseData.procedures.length > 0 ? caseData.procedures.join(' | ') : 'None'}${duplicateSection}
---`;
  }
}

// ========== INJECT MISSING DATA INTO AI RESPONSE ==========
// إصلاح مشكلة البيانات الفارغة في HTML الذي ينتجه الذكاء الاصطناعي
function injectCaseDataIntoHTML(aiHtml, caseData) {
  if (!aiHtml || !caseData) return aiHtml;
  
  let html = aiHtml;
  const vitals = caseData.vitals || {};
  
  // ========== استبدال الـ Placeholders المباشرة ==========
  // هذه هي الـ placeholders التي يولدها الـ AI
  
  // استبدال placeholder التشخيص
  html = html.replace(/\[التشخيص\]/g, caseData.diagnosis || caseData.icdCode || 'غير محدد');
  html = html.replace(/\[رقم ICD\]/g, caseData.icdCode || '-');
  
  // استبدال placeholders العلامات الحيوية
  html = html.replace(/\[درجة الحرارة\]/g, vitals.temperature || 'غير متوفر');
  html = html.replace(/\[ضغط الدم\]/g, vitals.bloodPressure || 'غير متوفر');
  html = html.replace(/\[الطول\]/g, vitals.height || 'غير متوفر');
  html = html.replace(/\[الوزن\]/g, vitals.weight || 'غير متوفر');
  html = html.replace(/\[النبض\]/g, vitals.pulse || 'غير متوفر');
  html = html.replace(/\[السكري\]/g, vitals.bloodSugar || 'غير متوفر');
  
  // استبدال placeholders الأدوية - نبني صفوف جدول حقيقية
  if (caseData.medications && caseData.medications.length > 0) {
    // البحث عن صف placeholder الأدوية واستبداله
    const medPlaceholderRow = /<tr[^>]*>\s*<td[^>]*>\s*\[اسم الدواء\]\s*<\/td>\s*<td[^>]*>\s*\[الجرعة\/الكمية\]\s*<\/td>[\s\S]*?<\/tr>/gi;
    const medRows = caseData.medications.map((m, idx) => 
      `<tr style="background:${idx % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="border:1px solid #ccc;padding:6px">${m.name}</td>
        <td style="border:1px solid #ccc;padding:6px">${m.dose || '-'}</td>
        <td style="border:1px solid #ccc;padding:6px">⏳ راجع التقييم أدناه</td>
        <td style="border:1px solid #ccc;padding:6px">-</td>
      </tr>`
    ).join('\n');
    html = html.replace(medPlaceholderRow, medRows);
    
    // أيضاً استبدال النص المباشر
    html = html.replace(/\[اسم الدواء\]/g, caseData.medications[0]?.name || '-');
    html = html.replace(/\[الجرعة\/الكمية\]/g, caseData.medications[0]?.dose || '-');
  } else {
    html = html.replace(/\[اسم الدواء\]/g, 'لا يوجد');
    html = html.replace(/\[الجرعة\/الكمية\]/g, '-');
  }
  
  // استبدال placeholders الإجراءات
  if (caseData.procedures && caseData.procedures.length > 0) {
    const procPlaceholderRow = /<tr[^>]*>\s*<td[^>]*>\s*\[اسم الإجراء\]\s*<\/td>[\s\S]*?<\/tr>/gi;
    const procRows = caseData.procedures.map((proc, idx) => {
      const procName = typeof proc === 'string' ? proc : (proc.name || proc.code || '-');
      return `<tr style="background:${idx % 2 === 0 ? '#f8fafc' : 'white'}">
        <td style="border:1px solid #ccc;padding:6px">${procName}</td>
        <td style="border:1px solid #ccc;padding:6px">⏳ راجع التقييم</td>
        <td style="border:1px solid #ccc;padding:6px">-</td>
      </tr>`;
    }).join('\n');
    html = html.replace(procPlaceholderRow, procRows);
    
    html = html.replace(/\[اسم الإجراء\]/g, caseData.procedures[0] || '-');
  } else {
    html = html.replace(/\[اسم الإجراء\]/g, 'لا يوجد');
  }
  
  // استبدال placeholders عامة أخرى
  html = html.replace(/\[رقم الملف\]/g, caseData.claimId || '-');
  html = html.replace(/\[رقم المريض\]/g, caseData.patientId || '-');
  html = html.replace(/\[التفصيل مع المرجع السريري\]/g, 'راجع التقييم التفصيلي أدناه');
  html = html.replace(/\[التوثيق المطلوب بالتحديد\]/g, 'توثيق المبرر الطبي');
  html = html.replace(/\[كيف يوثق لضمان القبول\]/g, 'إضافة ملاحظات سريرية مفصلة');
  html = html.replace(/\[سبب التكرار\]/g, 'تكرار الإجراء بدون مبرر واضح');
  html = html.replace(/\[الإجراء المتكرر\]/g, '-');
  html = html.replace(/\[العدد\]/g, '-');
  
  // إزالة أي placeholders متبقية بين أقواس مربعة
  html = html.replace(/\[[^\]]{1,50}\]/g, function(match) {
    // لا تزيل الأقواس إذا كانت جزء من تنسيق معروف
    if (match.includes('✓') || match.includes('✗') || match.includes('!')) {
      return match;
    }
    return '<span style="color:#6b7280;font-style:italic">غير متوفر</span>';
  });
  
  return html;
}

// ========== REPETITION DETECTION & PATTERN ANALYSIS ==========
function detectRepetitionsAndPatterns(cases) {
  const repetitions = [];
  const patterns = [];
  const referralAlerts = [];
  
  // Group by patient ID to detect same-day visits
  const patientVisits = new Map();
  cases.forEach((c, idx) => {
    const patientId = c.patientId || c.claimId;
    if (!patientVisits.has(patientId)) {
      patientVisits.set(patientId, []);
    }
    patientVisits.get(patientId).push({ ...c, index: idx });
  });
  
  // Detect repeated visits for same patient
  for (const [patientId, visits] of patientVisits) {
    if (visits.length > 1) {
      // Check for repeated IV fluids
      const ivFluidVisits = visits.filter(v => 
        v.medications.some(m => 
          m.name.toUpperCase().includes('SALINE') || 
          m.name.toUpperCase().includes('DEXTROSE') ||
          m.name.toUpperCase().includes('RINGER') ||
          m.name.toUpperCase().includes('I.V.') ||
          m.name.toUpperCase().includes('INFUSION')
        )
      );
      
      if (ivFluidVisits.length > 1) {
        repetitions.push({
          type: 'IV_FLUID_REPEAT',
          patientId,
          count: ivFluidVisits.length,
          claims: ivFluidVisits.map(v => v.claimId),
          alert: `🔴 تنبيه تكرار: المريض ${patientId} حصل على سوائل وريدية ${ivFluidVisits.length} مرات. يجب توثيق مبرر كل مرة.`
        });
      }
      
      // Check for repeated antibiotics
      const antibioticVisits = visits.filter(v =>
        v.medications.some(m => {
          const name = m.name.toUpperCase();
          return name.includes('AMOXICILLIN') || name.includes('AZITHROMYCIN') ||
                 name.includes('CIPROFLOXACIN') || name.includes('CEFTRIAXONE') ||
                 name.includes('AUGMENTIN') || name.includes('ANTIBIOTIC');
        })
      );
      
      if (antibioticVisits.length > 1) {
        repetitions.push({
          type: 'ANTIBIOTIC_REPEAT',
          patientId,
          count: antibioticVisits.length,
          claims: antibioticVisits.map(v => v.claimId),
          alert: `🔴 تنبيه تكرار: المريض ${patientId} حصل على مضادات حيوية ${antibioticVisits.length} مرات. هل هناك مقاومة أو فشل علاجي؟`
        });
      }
    }
  }
  
  // Detect patterns across all cases
  const ivFluidCount = cases.filter(c => 
    c.medications.some(m => 
      m.name.toUpperCase().includes('SALINE') || 
      m.name.toUpperCase().includes('DEXTROSE') ||
      m.name.toUpperCase().includes('I.V.')
    )
  ).length;
  
  const ivFluidPercentage = (ivFluidCount / cases.length * 100).toFixed(1);
  if (ivFluidPercentage > 50) {
    patterns.push({
      type: 'HIGH_IV_USAGE',
      percentage: ivFluidPercentage,
      alert: `🟠 نمط غير طبيعي: ${ivFluidPercentage}% من الحالات تحصل على سوائل وريدية. المعدل الطبيعي أقل من 30%.`
    });
  }
  
  // Detect cases needing specialist referral
  cases.forEach((c, idx) => {
    const diagUpper = (c.diagnosis || '').toUpperCase();
    
    // Diabetes → Eye specialist referral needed
    if (diagUpper.includes('DIABETES') || diagUpper.includes('DM') || 
        diagUpper.includes('E11') || diagUpper.includes('E10') ||
        diagUpper.includes('السكري') || diagUpper.includes('سكر')) {
      referralAlerts.push({
        type: 'DIABETES_EYE_REFERRAL',
        claimId: c.claimId,
        patientId: c.patientId,
        alert: `👁️ تنبيه تحويل: مريض سكري (${c.claimId}) - يجب التحويل لطبيب العيون سنوياً (ADA Guidelines 2024)`,
        recommendation: 'Referral to Ophthalmology for diabetic retinopathy screening'
      });
    }
    
    // Hypertension → Renal function check
    if (diagUpper.includes('HYPERTENSION') || diagUpper.includes('HTN') ||
        diagUpper.includes('I10') || diagUpper.includes('ضغط')) {
      const hasRenalTest = c.procedures.some(p => 
        p.toUpperCase().includes('CREATININE') || 
        p.toUpperCase().includes('KIDNEY') ||
        p.toUpperCase().includes('RENAL')
      );
      if (!hasRenalTest) {
        referralAlerts.push({
          type: 'HTN_RENAL_CHECK',
          claimId: c.claimId,
          patientId: c.patientId,
          alert: `🔬 تنبيه فحوصات: مريض ضغط (${c.claimId}) - يجب فحص وظائف الكلى (ESC Guidelines 2023)`,
          recommendation: 'Order serum creatinine and eGFR'
        });
      }
    }
  });
  
  return { repetitions, patterns, referralAlerts };
}

// Process Excel cases sequentially with individual API calls - FULL TRI-LAYER TEMPLATE
async function processExcelCasesSequentially(req, res, cases, language, apiKey) {
  const totalCases = cases.length;
  const caseResults = [];
  const model = "gemini-2.0-flash";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // Detect repetitions and patterns BEFORE processing
  const { repetitions, patterns, referralAlerts } = detectRepetitionsAndPatterns(cases);
  console.log(`[Pattern Detection] Found ${repetitions.length} repetitions, ${patterns.length} patterns, ${referralAlerts.length} referral alerts`);
  
  // 🆕 Detect temporal duplicates from historical data (Google Sheets)
  let duplicateResult = null;
  let duplicatesPromptSection = '';
  try {
    const sourceFileName = req.body.files?.[0]?.name || 'upload';
    duplicateResult = await detectDuplicates(cases, sourceFileName);
    
    if (duplicateResult && duplicateResult.duplicates && duplicateResult.duplicates.length > 0) {
      duplicatesPromptSection = formatDuplicatesForPrompt(duplicateResult);
      console.log(`[Duplicate Detection] Found ${duplicateResult.summary?.totalDuplicates || 0} duplicates across ${duplicateResult.patientsWithDuplicates} patients`);
    } else {
      console.log('[Duplicate Detection] No temporal duplicates found');
    }
  } catch (dupError) {
    console.error('[Duplicate Detection] Error:', dupError.message);
  }
  
  // ENHANCED Clinical Guidelines Reference with Scientific Sources
  const fullClinicalRef = `
### 📚 مراجع الإرشادات السريرية المعتمدة:

⚠️ **تنبيه مهم حول رموز المقارنة:**
- ≥ تعني "أكبر من أو يساوي" (greater than or equal) - مثال: حمى ≥38°C تعني الحرارة 38 فأكثر
- > تعني "أكبر من" (greater than) - مثال: حرارة >38°C تعني الحرارة أعلى من 38
- < تعني "أصغر من" (less than) - مثال: حرارة <38°C تعني الحرارة أقل من 38 (طبيعية)
- ≤ تعني "أصغر من أو يساوي" (less than or equal) - مثال: ≤37°C تعني 37 فأقل
- 🔴 لا تخلط بين ≥ و ≤ - هذا خطأ شائع!

**السوائل الوريدية (IV Fluids) - WHO 2023 (نظام المبررات الإلزامي):**

⚠️ **لا تُقبل السوائل الوريدية إلا باختيار سبب من القائمة:**

| الرمز | السبب المقبول | ✅ ماذا يكتب الطبيب |
|-------|--------------|---------------------|
| A | جفاف متوسط | "علامات جفاف متوسط: عطش شديد، بول قليل، ارتداد جلد 1-2 ثانية" |
| B | جفاف شديد | "علامات جفاف شديد: خمول، عيون غائرة، ارتداد جلد >2 ثانية" |
| C | قيء مستمر ≥3 مرات | "قيء متكرر ≥3 مرات، لا يتحمل السوائل الفموية" |
| D | عدم تحمل الفم | "لا يتحمل الشرب / رفض السوائل الفموية" |
| E | صدمة / انخفاض ضغط | "BP < 90/60، علامات صدمة، نبض ضعيف" |
| F | حالة طوارئ | "حالة طوارئ تستدعي تعويض سريع" |

❌ **ترفض إذا غاب التوثيق** - لا يكفي كتابة "جفاف" فقط بدون علامات!

- علامات الجفاف الشديد (WHO): خمول شديد، عدم القدرة على الشرب، ارتداد الجلد ببطء شديد (>2 ثانية)، عيون غائرة
- علامات الجفاف المتوسط: عطش شديد، بول قليل، ارتداد جلد بطيء (1-2 ثانية)
- ⚠️ التكرار بدون مبرر = رفض تأميني
- 📖 مرجع: WHO Pocket Book of Hospital Care 2023, Ch. 5

**الباراسيتامول الوريدي (IV Paracetamol) - نظام المبررات:**

⚠️ **لا يُقبل الباراسيتامول الوريدي إلا باختيار سبب من القائمة:**

| الرمز | السبب المقبول | ✅ ماذا يكتب الطبيب |
|-------|--------------|---------------------|
| A | حمى شديدة ≥39°C | "حمى شديدة 39.5°C مع أعراض حادة" |
| B | ألم شديد VAS ≥7 | "ألم شديد VAS 8/10، لا يستجيب للفموي" |
| C | قيء مستمر | "قيء متكرر، لا يتحمل الباراسيتامول الفموي" |
| D | عدم تحمل الفم | "لا يتحمل الأدوية الفموية / رفض البلع" |
| E | غيبوبة/مستوى وعي منخفض | "GCS <13، لا يتحمل الفموي" |
| F | ما بعد العمليات | "ما بعد إجراء جراحي، ألم حاد" |

❌ **ترفض إذا**: حرارة طبيعية (<38°C) + بدون توثيق ألم VAS ≥4/10

**المضادات الحيوية - CDC IDSA 2024 (قائمة إلزامية):**

⚠️ **قبل وصف أي مضاد حيوي، يجب توفر الثلاثة:**
1. ✅ **التشخيص المحدد**: التهاب لوزتين صديدي / التهاب رئوي / التهاب بولي... إلخ
2. ✅ **العلامات الداعمة**: حمى ≥38.3°C + صديد/إفرازات + WBC مرتفع
3. ✅ **نتيجة RADT/زرع** أو سبب موثق لعدم توفرها (طوارئ/حالة حرجة)

❌ **ترفض إذا غاب أي عنصر** - مع طلب التوثيق:

| الحالة | ❌ المشكلة | ✅ المطلوب للقبول |
|--------|-----------|------------------|
| التهاب الحلق | لا يوجد RADT/زرع | **اكتب:** "RADT إيجابي" أو "لا يتوفر RADT - صديد + حمى 39°C" |
| التهاب رئوي | لا يوجد أشعة صدر | **اكتب:** "CXR يُظهر ارتشاح" أو "طوارئ - علامات سريرية واضحة" |
| التهاب بولي | لا يوجد فحص بول | **اكتب:** "Urine WBC >10 + Nitrite+" أو "أعراض نموذجية + حرقة شديدة" |
| التهاب معدة | لا دليل بكتيري | ❌ **لا يُقبل** - معظمها فيروسي |

- التهاب الشعب الهوائية الحاد (غير معقد): لا مضاد حيوي روتينياً (معظمها فيروسي)
- التهاب المعدة والأمعاء: لا مضاد حيوي إلا مع: حمى عالية ≥38.5°C، دم في البراز، أو علامات إنتان
- حمى التيفوئيد: Azithromycin أو Ceftriaxone كخط أول (CDC 2024)، MEGAMOX/Amoxicillin ليس الخيار الأول
- 📖 مرجع: CDC Antibiotic Stewardship Guidelines 2024

**الباراسيتامول (خافض حرارة + مسكن) - WHO 2023:**
- باراسيتامول فموي: للحرارة ≥38°C أو للألم (VAS ≥4/10) - الخيار الأول
- باراسيتامول وريدي: فقط عند: عدم تحمل الفم، قيء مستمر، غيبوبة، حالة طوارئ حادة، أو ألم شديد VAS ≥7/10
- ⚠️ مهم: الباراسيتامول مسكن للألم وليس فقط خافض حرارة!
- ⚠️ وريدي مع حرارة طبيعية (<38°C) وبدون توثيق ألم = مرفوض
- 📖 مرجع: WHO Model List of Essential Medicines 2023

### 🚫 قائمة عدم التوافق دواء-تشخيص (Drug-Diagnosis Mismatch):
| الدواء | ❌ لا يُستخدم لـ | ✅ يُستخدم لـ | ملاحظات |
|--------|----------------|--------------|---------|
| Domperidone (DOMPY) | ❌ الإمساك، عسر الهضم بدون غثيان | ✅ الغثيان والقيء فقط | ⚠️ EMA: أقل جرعة، أقصر مدة، ≤30mg/يوم، خطر QT |
| DRAMYLIN Syrup | ❌ الغثيان والقيء | ✅ السعال المرتبط بعدوى الجهاز التنفسي العلوي | محتوى: Diphenhydramine + Ammonium chloride (مضاد هيستامين + مقشع) |
| Loperamide | ❌ أطفال <6 سنوات، إسهال دموي | ✅ إسهال بالغين غير معدي | 
| Metoclopramide | ❌ أطفال <1 سنة | ✅ غثيان/قيء بالغين | ⚠️ خطر EPS، أقصى 5 أيام |
| مضاد حيوي للتيفوئيد | ❌ MEGAMOX كخط أول | ✅ Azithromycin أو Ceftriaxone |

### 🩺 نظام التحقق من العرض المرتبط (إلزامي قبل الصرف):

**أدوية الحساسية (مضادات الهيستامين):**
⚠️ لا تُقبل CLARA / ZYRTEC / TELFAST / CLARITIN إلا مع عرض من القائمة:

| الرمز | العرض المطلوب | ✅ ماذا يكتب الطبيب |
|-------|--------------|---------------------|
| A | حكة جلدية | "حكة جلدية منتشرة / urticaria" |
| B | رشح أنفي / عطاس | "التهاب أنف تحسسي - رشح + عطاس" |
| C | احمرار عيون | "التهاب ملتحمة تحسسي - حكة + احمرار" |
| D | طفح جلدي | "طفح جلدي تحسسي / eczema" |
| E | رد فعل تحسسي | "تاريخ حساسية موثق لـ [المادة]" |

❌ **ترفض إذا**: لا يوجد عرض تحسسي موثق (لا يكفي كتابة "حساسية" فقط)

**أدوية القيء (مضادات الإقياء):**
⚠️ لا يُقبل DOMPY / MOTILIUM / PRIMPERAN / PLASIL إلا مع عرض من القائمة:

| الرمز | العرض المطلوب | ✅ ماذا يكتب الطبيب |
|-------|--------------|---------------------|
| A | غثيان | "غثيان مستمر" |
| B | قيء فعلي | "قيء ≥2 مرات خلال 24 ساعة" |
| C | غثيان ما بعد الأكل | "غثيان وامتلاء بعد الوجبات" |
| D | ارتجاع | "ارتجاع معدي مريئي مع غثيان" |

❌ **ترفض إذا**: التشخيص عسر هضم/إمساك بدون غثيان/قيء موثق

**مثبطات مضخة البروتون (PPIs) - ACG/CAG 2022:**
- ✅ **مبررة (مقبول)**: GERD موثق، قرحة معدة مشخصة، وقاية مع NSAIDs لمرضى عالي الخطورة، H. pylori
- ⚠️ **تحتاج توثيق (ليس مرفوض)**: عسر هضم (Dyspepsia) مع أعراض معدية - ACG يسمح بتجربة PPI
- ❌ **غير مبررة**: استخدام طويل >8 أسابيع بدون مراجعة، لا أعراض معدية إطلاقاً
- 📖 مرجع: American College of Gastroenterology - Dyspepsia Guidelines 2022
- ⚠️ **مهم**: عسر الهضم + التهاب معدة = PPI يحتاج توثيق "أعراض معدية" فقط، ليس مرفوضاً!

### 🩺 تنبيهات التحويل الطبي الإلزامية:

**مرضى السكري (ADA Standards 2024):**
- 👁️ تحويل لطبيب العيون: فحص الشبكية السنوي (Diabetic Retinopathy Screening)
- 🦶 فحص القدم: كل 6 أشهر للوقاية من القدم السكرية
- 🔬 فحص الكلى: Microalbuminuria + eGFR سنوياً
- 📖 مرجع: ADA Standards of Care in Diabetes 2024

**مرضى الضغط (ESC Guidelines 2023):**
- 🔬 فحص وظائف الكلى: Creatinine + eGFR عند التشخيص وسنوياً
- ❤️ تخطيط القلب: ECG أساسي وعند تغيير العلاج
- 📖 مرجع: ESC Guidelines for Arterial Hypertension 2023

### ⚠️ مصفوفة التضارب الدوائي (UpToDate 2024):
| الدواء الأول | الدواء الثاني | نوع التضارب | الخطورة | المرجع |
|-------------|--------------|-------------|---------|--------|
| NSAIDs | مميعات الدم | زيادة خطر النزيف | 🔴 عالية | Lexicomp |
| NSAIDs | ACE inhibitors + مدرات | فشل كلوي حاد (Triple Whammy) | 🔴 عالية | NEJM 2019 |
| Macrolides | Statins | رابدومايوليسيس | 🔴 عالية | FDA Alert |
| Metronidazole | Warfarin | زيادة INR | 🟠 متوسطة | UpToDate |
| Fluoroquinolones | Theophylline | تسمم ثيوفيلين | 🟠 متوسطة | Micromedex |

### 📌 جدول "يُقبل مع" الإلزامي - أعط الطبيب جمل جاهزة للنسخ:

| الدواء | ❌ سبب الرفض | ✅ اكتب للطبيب هذه الجملة الجاهزة |
|--------|-------------|----------------------------------|
| المضاد الحيوي (AZIMAC, AUGMENTIN, AMOXICILLIN) | لا يوجد دليل عدوى بكتيرية | **اكتب في الملف:** "RADT إيجابي للعقديات" أو "زرع حلق إيجابي" أو "صديد على اللوزتين + حمى ≥38.3" |
| السوائل الوريدية (NORMAL SALINE, DEXTROSE) | مافي دليل جفاف أو قيء | **اكتب في الملف:** "علامات جفاف: ارتداد جلد >2 ثانية، عيون غائرة" أو "قيء مستمر ≥3 مرات" أو "لا يتحمل الشرب" |
| الباراسيتامول الوريدي (PARACETAMOL IV) | الحرارة طبيعية وبدون ألم موثق | **اكتب في الملف:** "ألم شديد VAS 8/10" أو "قيء متكرر لا يتحمل الفموي" أو "حمى ≥39°C مع أعراض حادة" |
| مضاد الحساسية (CLARA, ZYRTEC) | مافي تشخيص حساسية | **اكتب في الملف:** "التهاب أنف تحسسي" أو "حكة جلدية" |
| مثبط الحموضة (ESOPOLE, OMEPRAZOLE) | مافي تشخيص معدي | **اكتب في الملف:** "ارتجاع مريئي GERD" أو "التهاب معدة" |
| مسكن NSAID (IBUPROFEN, RUMAFEN) | مافي توثيق ألم | **اكتب في الملف:** "ألم شديد VAS 7/10" أو "التهاب مفاصل" |

⚠️ **قاعدة صارمة**: لكل دواء مرفوض، اعط الطبيب **جملة جاهزة** ينسخها مباشرة في الملف. الطبيب لا يفكر - أنت تفكر له!

### 🔍 تدقيق ICD (تجنب الرفض التأميني بسبب Mismatch):

**تحقق من توافق الكود مع الوصف:**
- إذا كان الكود لا يتطابق مع الوصف ← اذكر "⚠️ تعارض ICD: الكود [X] لا يتوافق مع [الوصف]"
- إذا كان الوصف عام جداً ← اقترح كود أدق

| مشكلة شائعة | ❌ خطأ | ✅ صحيح |
|-------------|--------|--------|
| التهاب الحلق | R07.0 (ألم الحلق) | J02.9 (التهاب بلعوم حاد) أو J03.90 (التهاب لوزتين) |
| نزلة برد | J00 بدون توضيح | J00 + وصف الأعراض (رشح، عطاس، احتقان) |
| إسهال | R19.7 (أعراض هضمية) | A09.9 (التهاب معوي معدي) أو K52.9 (التهاب أمعاء غير معدي) |
| صداع | R51 فقط | G43.9 (صداع نصفي) أو R51 + السبب |
| آلام بطن | R10.9 عام | R10.1/R10.2/R10.3/R10.4 حسب الموقع |

### 📊 مؤشرات KPI الشهرية للطبيب (ضعها في نهاية التقرير):

**احسب وأضف في ملخص التقرير النهائي:**

| المؤشر | كيفية الحساب | الهدف |
|--------|-------------|-------|
| 📉 نسبة رفض المضادات الحيوية | (مضادات مرفوضة / إجمالي المضادات) × 100 | < 20% |
| 📋 نسبة "يحتاج توثيق" | (بنود تحتاج توثيق / إجمالي البنود) × 100 | < 15% |
| 💊 متوسط VAS عند مسكنات IV | مجموع VAS الموثق / عدد حالات مسكنات IV | ≥ 7/10 |
| 💉 نسبة IV بدون مبرر | (IV بدون علامات جفاف موثقة / إجمالي IV) × 100 | < 10% |
| 🔄 نسبة التكرار | (حالات تكرار / إجمالي الحالات) × 100 | < 5% |

**⚠️ إلزامي: أضف جدول KPI في نهاية كل تقرير لكل طبيب!**
`;


  // Report #20 Format Template - Detailed with clear sections
  const caseTemplate = language === 'ar' ? `أنت مدقق تأميني طبي خبير. حلل الحالة بتفصيل واضح مثل التقرير 20.

${fullClinicalRef}

## ⚠️ تنبيهات إلزامية يجب ذكرها إن وجدت:
1. **التضارب الدوائي**: إذا وجدت أدوية متضاربة من المصفوفة أعلاه، اذكرها بوضوح
2. **التحويلات الناقصة**: 
   - مريض سكري بدون تحويل لطبيب العيون ← اذكر "⚠️ يحتاج تحويل لطبيب العيون"
   - ألم عظام/مفاصل بدون تحويل لطبيب العظام ← اذكر "⚠️ يحتاج تحويل لطبيب العظام"
3. **التكرار**: إذا نفس المريض زار أكثر من مرة بنفس العلاج ← اذكر "⚠️ زيارة متكررة"
4. **🔄 التكرار عبر الزمن**: إذا ظهر "تنبيه تكرار تاريخي" في بيانات الحالة، يجب:
   - 🔴 إذا <30 يوم: أضف صندوق أحمر "❌ مرفوض - تكرار" مع نص التوثيق الجاهز
   - 🟡 إذا 30-60 يوم: أضف صندوق أصفر "⚠️ يحتاج توثيق - تكرار سابق" مع نص التوثيق
   - 🔵 إذا 60-90 يوم: ذكر كملاحظة فقط بدون تأثير على القرار

## 🔍 التنسيق الإلزامي (مثل التقرير 20):

<div class="case-section" data-insurance-score="8" data-medical-score="7">
  <h3>🔍 الحالة رقم [N] | Claim Se No.: [رقم] | المريض: [رقم]</h3>
  
  <h4>📌 بيانات الحالة</h4>
  <table class="custom-table">
    <tr><td><strong>التشخيص:</strong></td><td>[كود ICD مع الوصف الكامل]</td></tr>
    <tr><td><strong>درجة الحرارة:</strong></td><td>[القيمة]</td></tr>
    <tr><td><strong>ضغط الدم:</strong></td><td>[القيمة]</td></tr>
  </table>
  
  <h4>💊 الأدوية</h4>
  <table class="custom-table medications-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>الدواء</th><th>الجرعة</th><th>التقييم</th><th>الحالة</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[اسم الدواء]</td>
        <td>[الجرعة]</td>
        <td>[اكتب السبب الرئيسي فقط - مثال: "مبرر لالتهاب المعدة" أو "غير مبرر - الحرارة طبيعية 36.1". لا تذكر "لا يوجد تضارب" أو "لا يوجد تحذير" - اذكر المشاكل فقط إن وجدت]</td>
        <td>[✅ مقبول / ❌ مرفوض / ⚠️ يحتاج توثيق]</td>
      </tr>
    </tbody>
  </table>
  
  <h4>🔬 التحاليل والإجراءات</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>الإجراء</th><th>التقييم</th><th>الحالة</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[اسم الإجراء]</td>
        <td>[هل يتوافق مع التشخيص؟]</td>
        <td>[✅ مقبول / ❌ مرفوض]</td>
      </tr>
    </tbody>
  </table>
  
  <div style="background:#fee2e2; border:2px solid #dc2626; padding:12px; border-radius:8px; margin:10px 0;">
    <h4 style="color:#dc2626; margin:0 0 8px 0;">❌ مرفوض - يحتاج تعديل</h4>
    <div style="font-weight:bold; font-size:16px; margin:8px 0;">[اسم الدواء]</div>
    <div style="background:#fecaca; padding:8px; border-radius:4px; margin:8px 0;">
      <strong>❌ المشكلة:</strong> [اشرح المشكلة بوضوح - مثال: "الحرارة 36.1°C طبيعية، لا يوجد دليل على عدوى بكتيرية"]
    </div>
    <div style="background:#bbf7d0; padding:10px; border-radius:4px; margin:8px 0; border:2px solid #16a34a;">
      <strong style="color:#15803d; font-size:14px;">📝 التوثيق الحالي لا يوضح المبرر الطبي للإجراء - يجب وضع مبرر واضح مثل:</strong><br>
      <span style="font-size:15px; font-weight:bold;">"[انسخ الجملة من جدول يُقبل مع - مثال: فحص الحلق يُظهر صديد]"</span>
    </div>
  </div>
  
  <div style="background:#fef3c7; border:2px solid #d97706; padding:12px; border-radius:8px; margin:10px 0;">
    <h4 style="color:#d97706; margin:0 0 8px 0;">⚠️ يحتاج توثيق إضافي</h4>
    <div style="font-weight:bold; font-size:16px; margin:8px 0;">[اسم الدواء]</div>
    <div style="background:#fde68a; padding:8px; border-radius:4px; margin:8px 0;">
      <strong>⚠️ الناقص:</strong> [ما الذي يجب توثيقه]
    </div>
    <div style="background:#bbf7d0; padding:10px; border-radius:4px; margin:8px 0; border:2px solid #16a34a;">
      <strong style="color:#15803d; font-size:14px;">📝 التوثيق الحالي لا يوضح المبرر الطبي - يجب وضع مبرر واضح مثل:</strong><br>
      <span style="font-size:15px; font-weight:bold;">"[انسخ الجملة من جدول يُقبل مع]"</span>
    </div>
  </div>
  
  <table class="custom-table" style="margin-top:10px;">
    <tr>
      <td style="background:#dcfce7; width:50%;"><strong>✅ صحيح</strong><br>[قائمة الأدوية والإجراءات المقبولة]</td>
      <td style="background:#fee2e2; width:50%;"><strong>❌ يحتاج تصحيح</strong><br>[قائمة المرفوض ويحتاج توثيق]</td>
    </tr>
  </table>
</div>

## ⚙️ قواعد إلزامية:
- اربط كل حكم بالعلامات الحيوية والتشخيص (مثلاً: "الحرارة 36.1 لا تبرر باراسيتامول وريدي")
- اذكر التضارب الدوائي والتحويلات الناقصة إن وجدت
- لا تستخدم "غير متوفر" أو "N/A" - اترك الحقل فارغاً إذا لم تتوفر البيانات
- ❌ ممنوع: لا تكتب "CDI: لا يوجد" أو "NPHIES: لا يوجد" - اكتب السبب مباشرة فقط
- ✅ صحيح: "مبرر لالتهاب المعدة" أو "غير مبرر - الحرارة طبيعية"
- ⚠️ إلزامي: لكل دواء مرفوض/يحتاج توثيق، انسخ "📌 يُقبل مع:" من جدول الأدوية أعلاه. ممنوع تركه فارغاً!
- 🔢 **التقييم الرقمي إلزامي**: ضع رقم حقيقي (1-10) في data-insurance-score و data-medical-score لكل حالة:
  * 10 = توثيق مثالي، كل شيء مبرر
  * 8-9 = جيد مع ملاحظات بسيطة
  * 5-7 = متوسط، يحتاج توثيق
  * 1-4 = ضعيف، مرفوض
- أعد HTML فقط بدون markdown

بيانات الحالة:
` : `You are an expert medical insurance auditor. Analyze in detail like Report #20.

${fullClinicalRef}

## ⚠️ Mandatory Alerts (mention if found):
1. **Drug Interactions**: If conflicting drugs found, state clearly
2. **Missing Referrals**:
   - Diabetic patient without ophthalmology referral → mention "⚠️ Needs ophthalmology referral"
   - Bone/joint pain without orthopedics referral → mention "⚠️ Needs orthopedics referral"
3. **Repetition**: If same patient visited multiple times with same treatment → mention "⚠️ Repeated visit"

## 🔍 Required Format (like Report #20):

<div class="case-section" data-insurance-score="8" data-medical-score="7">
  <h3>🔍 Case [N] | Claim Se No.: [number] | Patient: [number]</h3>
  
  <h4>📌 Case Data</h4>
  <table class="custom-table">
    <tr><td><strong>Diagnosis:</strong></td><td>[ICD code with full description]</td></tr>
    <tr><td><strong>Temperature:</strong></td><td>[value]</td></tr>
    <tr><td><strong>Blood Pressure:</strong></td><td>[value]</td></tr>
  </table>
  
  <h4>💊 Medications</h4>
  <table class="custom-table medications-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>Medication</th><th>Dose</th><th>Evaluation</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[medication name]</td>
        <td>[dose]</td>
        <td>[Write the main reason only - e.g. "Justified for gastritis" or "Not justified - temp normal 36.1". Do NOT write "No drug interaction" or "No warning" - only mention problems if they exist]</td>
        <td>[✅ Approved / ❌ Rejected / ⚠️ Needs Documentation]</td>
      </tr>
    </tbody>
  </table>
  
  <h4>🔬 Tests and Procedures</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>Procedure</th><th>Evaluation</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[procedure name]</td>
        <td>[Does it align with diagnosis?]</td>
        <td>[✅ Approved / ❌ Rejected]</td>
      </tr>
    </tbody>
  </table>
  
  <div style="background:#fee2e2; border:2px solid #dc2626; padding:12px; border-radius:8px; margin:10px 0;">
    <h4 style="color:#dc2626; margin:0 0 8px 0;">❌ Rejected Items</h4>
    <div style="font-weight:bold;">[Rejected medication/procedure name]</div>
    <div>⚠️ [medication] needs clinical justification. [Detailed rejection reason - e.g., No fever elevation or documented acute pain]</div>
    <div>📌 Acceptable justifications: [list like: oral intolerance, acute condition, fever]</div>
    <div style="color:#dc2626; font-weight:bold;">❗ No documentation = Insurance rejection</div>
  </div>
  
  <div style="background:#fef3c7; border:2px solid #d97706; padding:12px; border-radius:8px; margin:10px 0;">
    <h4 style="color:#d97706; margin:0 0 8px 0;">⚠️ Items Needing Documentation</h4>
    <div style="font-weight:bold;">[Medication/procedure name]</div>
    <div>⚠️ [medication] needs clinical justification.</div>
    <div>📌 Acceptable justifications: [list]</div>
    <div style="color:#d97706; font-weight:bold;">❗ No documentation = Insurance rejection</div>
  </div>
  
  <table class="custom-table" style="margin-top:10px;">
    <tr>
      <td style="background:#dcfce7; width:50%;"><strong>✅ Correct</strong><br>[List of approved medications and procedures]</td>
      <td style="background:#fee2e2; width:50%;"><strong>❌ Needs Correction</strong><br>[List of rejected and needs documentation]</td>
    </tr>
  </table>
</div>

## ⚙️ Mandatory Rules:
- Link every judgment to vitals and diagnosis (e.g., "Temperature 36.1 does not justify IV paracetamol")
- Mention drug interactions and missing referrals if found
- Do NOT use "N/A" or "Not available" - leave field empty if data not available
- Return HTML only, no markdown

Case data:
`;

  // Also prepare the original detailed template for cases that need it
  const detailedCaseTemplate = language === 'ar' ? `أنت مدقق تأميني طبي خبير. حلل هذه الحالة الواحدة باستخدام **3 طبقات تحليل** بالتفصيل الكامل:

${fullClinicalRef}

## 🔍 التنسيق الإلزامي:

<div class="case-section">
  <h3>🔍 الحالة رقم [N] | Claim Se No.: [رقم الملف] | المريض: [رقم المريض]</h3>
  
  <h4>📌 بيانات الحالة</h4>
  <table class="custom-table">
    <tr><td><strong>التشخيص:</strong></td><td>[أكواد ICD-10 مع الوصف الكامل]</td></tr>
    <tr><td><strong>درجة الحرارة:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
    <tr><td><strong>ضغط الدم:</strong></td><td>[القيمة]</td></tr>
    <tr><td><strong>الطول:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
    <tr><td><strong>الوزن:</strong></td><td>[القيمة]</td></tr>
    <tr><td><strong>النبض:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
  </table>

  <h4>💊 الأدوية</h4>
  <table class="custom-table medications-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>الدواء</th><th>الجرعة</th><th>التقييم السريري</th><th>الحالة</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[اسم الدواء]</td>
        <td>[الجرعة/الكمية]</td>
        <td>
          <strong>📋 CDI:</strong> [هل التوثيق كافٍ؟ ما المفقود؟]<br>
          <strong>🏥 NPHIES:</strong> [هل يتوافق مع سياسات المطالبات؟]<br>
          <strong>📚 إرشاد سريري:</strong> [المرجع: CDC/WHO - هل منطقي سريرياً؟]
        </td>
        <td data-insurance-rating="[approved/rejected/review]">
          [✅ مقبول / ❌ مرفوض / ⚠️ يحتاج توثيق]
        </td>
      </tr>
    </tbody>
  </table>

  <h4>📊 ملخص الحالة</h4>
  <table class="custom-table">
    <tr style="background:#d4edda">
      <td width="30%"><strong>✅ صحيح ومقبول</strong></td>
      <td>[قائمة كل الأدوية والإجراءات المقبولة]</td>
    </tr>
    <tr style="background:#f8d7da">
      <td><strong>❌ مرفوض</strong></td>
      <td>[قائمة المرفوض مع السبب المختصر]</td>
    </tr>
    <tr style="background:#fff3cd">
      <td><strong>⚠️ يحتاج توثيق</strong></td>
      <td>[قائمة ما يحتاج توثيق]</td>
    </tr>
  </table>
</div>

## ⚙️ قواعد إلزامية:
- استخدم التحليل الثلاثي (CDI + NPHIES + Clinical) لكل دواء وإجراء
- قارن العلامات الحيوية بالأدوية (حرارة 36.1 = لا مبرر لباراسيتامول IV)
- أذكر المراجع السريرية في كل تقييم

أعد HTML فقط بدون أي markdown أو code blocks.
` : `You are an expert medical insurance auditor. Analyze this single case using **3-layer analysis** in full detail:

### 📚 Clinical Guidelines Reference:

**IV Fluids:**
- Use only for: severe dehydration, oral intolerance, persistent vomiting, shock
- Must document: dehydration degree, inability to drink, shock signs
- Reference: WHO Fluid Resuscitation Guidelines

**Antibiotics:**
- Pharyngitis: No antibiotic unless fever >38.3°C + purulent tonsillitis (CDC IDSA)
- Upper respiratory infection: Usually viral, no antibiotic needed
- Gastroenteritis: No antibiotic unless high fever or bloody stool
- Reference: CDC Antibiotic Stewardship

**Antipyretics:**
- Oral paracetamol: For fever >38°C
- IV paracetamol: Only when oral intolerance or emergency
- Reference: WHO Essential Medicines

**Proton Pump Inhibitors (PPIs):**
- Justified: GERD, gastric ulcer, long-term NSAIDs use
- Not justified: transient dyspepsia without alarm signs
- Reference: ACG Guidelines

### ⚠️ Drug Interactions Matrix:
| Drug 1 | Drug 2 | Interaction | Severity |
|--------|--------|-------------|----------|
| NSAIDs | Anticoagulants | Increased bleeding risk | 🔴 High |
| NSAIDs | Diuretics, ACE inhibitors | Acute kidney injury | 🔴 High |
| Macrolides | Statins | Rhabdomyolysis | 🔴 High |
| Metronidazole | Warfarin | Increased anticoagulant effect | 🟠 Medium |
| ACE inhibitors | Potassium-sparing diuretics | Hyperkalemia | 🔴 High |

### 📌 Documentation Suggestions:
- IV Fluids: Document oral intolerance, severe dehydration, persistent vomiting, shock signs
- IV Paracetamol: Oral intolerance, emergency, fever >39°C
- Antibiotics: Signs of bacterial infection (fever >38.3, purulent discharge)

## 🔍 Required Format:

<div class="case-section">
  <h3>🔍 Case [N] | Claim Se No.: [claim_id] | Patient: [patient_id]</h3>
  
  <h4>📌 Case Data</h4>
  <table class="custom-table">
    <tr><td><strong>Diagnosis:</strong></td><td>[ICD-10 codes with full description]</td></tr>
    <tr><td><strong>Temperature:</strong></td><td>[value] or <span style="color:#856404">⚠️ N/A</span></td></tr>
    <tr><td><strong>Blood Pressure:</strong></td><td>[value]</td></tr>
    <tr><td><strong>Height:</strong></td><td>[value]</td></tr>
    <tr><td><strong>Weight:</strong></td><td>[value]</td></tr>
    <tr><td><strong>Pulse:</strong></td><td>[value]</td></tr>
  </table>

  <h4>💊 Medications</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>Medication</th><th>Dose</th><th>Clinical Evaluation</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[medication name]</td>
        <td>[dose/quantity]</td>
        <td>
          <strong>📋 CDI:</strong> [Is documentation sufficient?]<br>
          <strong>🏥 NPHIES:</strong> [Compliant with claim policies?]<br>
          <strong>📚 Clinical:</strong> [Reference: CDC/WHO - clinically justified?]
        </td>
        <td>[✅ Approved / ❌ Rejected / ⚠️ Needs Documentation]</td>
      </tr>
    </tbody>
  </table>

  <h4>🔬 Procedures/Tests</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>Procedure</th><th>Evaluation (3-layer)</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[procedure name]</td>
        <td>
          <strong>📋 CDI:</strong> [Related to diagnosis?]<br>
          <strong>🏥 NPHIES:</strong> [Repetition allowed?]<br>
          <strong>📚 Guideline:</strong> [Medically necessary?]
        </td>
        <td>[✅/❌/⚠️]</td>
      </tr>
    </tbody>
  </table>

  <h4>❌ Rejected Items</h4>
  <div class="box-critical">
    <strong>[item name]</strong><br>
    <strong>❌ Rejection reason:</strong> [detail with clinical reference]<br>
    <strong>📌 For approval must document:</strong> [oral intolerance, acute condition...]
  </div>

  <h4>⚠️ Items Needing Documentation</h4>
  <div class="box-warning">
    <strong>[item name]</strong><br>
    <strong>📋 Missing:</strong> [specific documentation needed]<br>
    <strong>📌 Suggestions:</strong> [how to document for approval]
  </div>

  <h4>📊 Case Summary</h4>
  <table class="custom-table">
    <tr style="background:#d4edda"><td><strong>✅ Approved</strong></td><td>[list]</td></tr>
    <tr style="background:#f8d7da"><td><strong>❌ Rejected</strong></td><td>[list with brief reason]</td></tr>
    <tr style="background:#fff3cd"><td><strong>⚠️ Needs Documentation</strong></td><td>[list]</td></tr>
  </table>
</div>

## ⚙️ Mandatory Rules:
- Use 3-layer analysis (CDI + NPHIES + Clinical) for every medication and procedure
- Compare vital signs to medications (temp 36.1 = no justification for IV paracetamol)
- Cite clinical references in each evaluation

Return HTML only, no markdown or code blocks.
`;

  // Build a map of duplicates by patient/claim for quick lookup
  const duplicatesMap = new Map();
  if (duplicateResult && duplicateResult.duplicates) {
    for (const dup of duplicateResult.duplicates) {
      const key = `${dup.patientId}_${dup.caseId}`;
      duplicatesMap.set(key, dup);
      // Also map by claimId directly
      if (dup.caseId) duplicatesMap.set(dup.caseId, dup);
    }
  }

  console.log(`Processing ${totalCases} cases individually...`);
  
  for (let i = 0; i < totalCases; i++) {
    const caseData = cases[i];
    const caseNumber = i + 1;
    
    console.log(`Processing case ${caseNumber}/${totalCases}: ${caseData.claimId}`);
    
    // Find duplicates for this specific case
    const caseDuplicates = duplicatesMap.get(`${caseData.patientId}_${caseData.claimId}`) || 
                           duplicatesMap.get(caseData.claimId) || null;
    
    const casePrompt = buildSingleCasePrompt(caseData, caseNumber, totalCases, language, caseDuplicates);
    
    const payload = {
      system_instruction: { role: "system", parts: [{ text: caseTemplate }] },
      contents: [{ role: "user", parts: [{ text: casePrompt }] }],
      generation_config: { temperature: 0.2, top_p: 0.95, top_k: 40, max_output_tokens: 8192 },
    };
    
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        console.error(`API error for case ${caseNumber}: ${response.status}`);
        caseResults.push(`<div class="case-section box-critical"><h3>❌ خطأ في تحليل الحالة ${caseNumber}</h3><p>فشل الاتصال بالنظام</p></div>`);
        continue;
      }
      
      const result = await response.json();
      let text = result?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || "";
      
      // Clean up code fences
      text = text.replace(/^```html?\s*/i, '').replace(/```\s*$/i, '').trim();
      text = text.replace(/^```\s*/gm, '').replace(/\s*```$/gm, '');
      
      // إصلاح: حقن البيانات الفعلية إذا كانت فارغة في استجابة الذكاء الاصطناعي
      text = injectCaseDataIntoHTML(text, caseData);
      
      if (text) {
        // كشف الفحوصات الناقصة من حق المريض
        const missingTests = detectMissingRequiredTests(caseData);
        let additionalHTML = '';
        
        if (missingTests && missingTests.length > 0) {
          additionalHTML += generateMissingTestsHTML(missingTests, language);
          console.log(`Case ${caseNumber}: Found ${missingTests.length} missing required tests`);
        }
        
        // التوصيات الديموغرافية المخصصة (حسب العمر والجنس والوزن والطول)
        const patientDemoData = {
          age: caseData.age || caseData.vitals?.age,
          gender: caseData.gender || caseData.vitals?.gender,
          weight: parseFloat(caseData.vitals?.weight) || null,
          height: parseFloat(caseData.vitals?.height) || null
        };
        
        // فقط إذا كان هناك بيانات ديموغرافية متاحة
        if (patientDemoData.age || patientDemoData.gender || (patientDemoData.weight && patientDemoData.height)) {
          const demographicHTML = generateDemographicRecommendationsHTML(patientDemoData);
          if (demographicHTML) {
            additionalHTML += demographicHTML;
            console.log(`Case ${caseNumber}: Generated demographic recommendations`);
          }
        }
        
        // إضافة HTML الإضافي قبل نهاية div الحالة
        if (additionalHTML) {
          const closeDivIdx = text.lastIndexOf('</div>');
          if (closeDivIdx > 0) {
            text = text.substring(0, closeDivIdx) + additionalHTML + text.substring(closeDivIdx);
          } else {
            text += additionalHTML;
          }
        }
        caseResults.push(text);
        console.log(`Case ${caseNumber} processed successfully`);
      } else {
        caseResults.push(`<div class="case-section box-warning"><h3>⚠️ الحالة ${caseNumber} - ${caseData.claimId}</h3><p>لم يتم الحصول على تحليل</p></div>`);
      }
      
      // Small delay to avoid rate limiting
      if (i < totalCases - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    } catch (err) {
      console.error(`Error processing case ${caseNumber}:`, err);
      caseResults.push(`<div class="case-section box-critical"><h3>❌ خطأ في الحالة ${caseNumber}</h3><p>${err.message}</p></div>`);
    }
  }
  
  // Collect missing tests across all cases for summary
  let totalMissingTests = 0;
  let casesWithMissingTests = 0;
  const missingTestsSummary = new Map(); // testName -> count
  
  for (const caseData of cases) {
    const missingTests = detectMissingRequiredTests(caseData);
    if (missingTests && missingTests.length > 0) {
      casesWithMissingTests++;
      totalMissingTests += missingTests.length;
      for (const test of missingTests) {
        const key = `${test.testName}|${test.priority}`;
        missingTestsSummary.set(key, (missingTestsSummary.get(key) || 0) + 1);
      }
    }
  }
  
  // ========== حساب الإحصائيات من البيانات الهيكلية (مصدر الحقيقة الوحيد) ==========
  const caseStats = extractStatsFromCases(cases);
  
  // Extract AI scores from case results
  const allCasesHtml = caseResults.join('');
  const insuranceScoreMatches = allCasesHtml.match(/data-insurance-score="(\d+)"/g) || [];
  const medicalScoreMatches = allCasesHtml.match(/data-medical-score="(\d+)"/g) || [];
  
  const insuranceScores = insuranceScoreMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
  const medicalScores = medicalScoreMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
  
  const aiAvgInsurance = insuranceScores.length > 0 ? (insuranceScores.reduce((a,b) => a+b, 0) / insuranceScores.length) : 0;
  const aiAvgMedical = medicalScores.length > 0 ? (medicalScores.reduce((a,b) => a+b, 0) / medicalScores.length) : 0;
  
  // حساب الدرجات من البيانات الهيكلية
  const vitalsRate = caseStats.totalCases > 0 ? caseStats.vitalsDocumented / caseStats.totalCases : 0;
  const icdRate = caseStats.totalCases > 0 ? caseStats.icdCodesPresent / caseStats.totalCases : 0;
  const diagSpecificRate = caseStats.totalCases > 0 ? caseStats.diagnosisSpecific / caseStats.totalCases : 0;
  const duplicateRateCalc = caseStats.duplicateRate || 0;
  
  // حساب درجة الالتزام التأميني من البيانات الهيكلية
  let structuredInsuranceScore = 10;
  structuredInsuranceScore -= (1 - icdRate) * 3;
  structuredInsuranceScore -= (1 - vitalsRate) * 2;
  structuredInsuranceScore -= duplicateRateCalc * 2;
  structuredInsuranceScore -= (caseStats.ivWithoutJustification / Math.max(caseStats.totalCases, 1)) * 2;
  structuredInsuranceScore = Math.max(0, Math.min(10, structuredInsuranceScore));
  
  // توحيد الدرجة: متوسط بين AI والحساب الهيكلي
  const avgInsuranceScore = aiAvgInsurance > 0 
    ? ((aiAvgInsurance + structuredInsuranceScore) / 2).toFixed(1)
    : structuredInsuranceScore.toFixed(1);
  const avgMedicalScore = aiAvgMedical > 0 ? aiAvgMedical.toFixed(1) : '7.0';
  
  // استخدام totalServiceItems كمقام (عدد بنود الخدمة الفعلية من Excel)
  const totalServiceItems = caseStats.totalServiceItems || 0;
  
  // نسبة التكرار الفعلية
  const duplicateRate = (duplicateRateCalc * 100).toFixed(0);
  const duplicateCases = caseStats.duplicateCases || 0;
  
  // نسب التوثيق
  const vitalsDocRate = (vitalsRate * 100).toFixed(0);
  const icdDocRate = (icdRate * 100).toFixed(0);
  const diagSpecificRatePercent = (diagSpecificRate * 100).toFixed(0);
  
  // Determine overall status
  const getScoreClass = (score) => {
    const s = parseFloat(score);
    if (s >= 8) return 'score-good';
    if (s >= 5) return 'score-warning';
    return 'score-danger';
  };
  
  // Combine all case results into final report
  const reportHeader = language === 'ar' 
    ? `<div class="report-container"><h2>📋 تقرير التدقيق التأميني الشامل</h2><p class="box-info">تم تحليل ${totalCases} حالة بالتفصيل</p>`
    : `<div class="report-container"><h2>📋 Comprehensive Insurance Audit Report</h2><p class="box-info">Analyzed ${totalCases} cases in detail</p>`;
  
  // Final summary table - مبني على البيانات الهيكلية
  const summaryTable = language === 'ar' ? `
  <div class="report-summary-section" style="margin-top:2rem;page-break-before:always;">
    <h2 style="background:#1e3a5f;color:white;padding:12px;border-radius:8px;text-align:center;">📊 الملخص النهائي للتقرير</h2>
    
    <table class="custom-table report-summary-table" style="width:100%;margin-top:1rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="2" style="text-align:center;font-size:14pt;">إحصائيات الحالات والخدمات</th></tr>
      </thead>
      <tbody>
        <tr><td width="50%"><strong>📁 إجمالي الحالات (المطالبات)</strong></td><td style="font-size:18pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalCases}</td></tr>
        <tr><td><strong>📋 إجمالي بنود الخدمة في Excel</strong></td><td style="font-size:16pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalServiceItems}</td></tr>
        <tr style="background:#d4edda"><td><strong>✅ بنود مقبولة (تقدير أولي)</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${caseStats.approvedCount || 0}</td></tr>
        <tr style="background:#f8d7da"><td><strong>❌ بنود تحتاج مراجعة</strong></td><td style="font-size:16pt;font-weight:bold;color:#721c24;text-align:center;">${caseStats.rejectedCount || 0}</td></tr>
        <tr style="background:#fff3cd"><td><strong>⚠️ بنود تحتاج توثيق</strong></td><td style="font-size:16pt;font-weight:bold;color:#856404;text-align:center;">${caseStats.needsDocCount || 0}</td></tr>
        <tr style="background:#e0f2fe"><td><strong>🩺 توثيق العلامات الحيوية</strong></td><td style="font-size:16pt;font-weight:bold;color:#0369a1;text-align:center;">${vitalsDocRate}%</td></tr>
        <tr style="background:#d4edda"><td><strong>🔢 أكواد ICD موجودة</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${icdDocRate}%</td></tr>
        <tr style="background:#e0f2fe"><td><strong>📝 التشخيص المحدد</strong></td><td style="font-size:16pt;font-weight:bold;color:#0369a1;text-align:center;">${diagSpecificRatePercent}%</td></tr>
        <tr style="background:${duplicateCases > 0 ? '#fff3cd' : '#d4edda'}"><td><strong>🔄 نسبة التكرار</strong></td><td style="font-size:16pt;font-weight:bold;color:${duplicateCases > 0 ? '#856404' : '#155724'};text-align:center;">${duplicateRate}% (${duplicateCases} حالة)</td></tr>
        ${casesWithMissingTests > 0 ? `<tr style="background:#fef3c7"><td><strong>📋 حالات بفحوصات ناقصة (حق المريض)</strong></td><td style="font-size:16pt;font-weight:bold;color:#92400e;text-align:center;">${casesWithMissingTests} (${totalMissingTests} فحص)</td></tr>` : ''}
      </tbody>
    </table>
    
    <table class="custom-table" style="width:100%;margin-top:1.5rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="3" style="text-align:center;font-size:14pt;">متوسط التقييمات</th></tr>
      </thead>
      <tbody>
        <tr>
          <td width="40%"><strong>📋 الالتزام التأميني</strong><br><small>توثيق + أكواد ICD + علامات حيوية</small></td>
          <td width="30%" style="text-align:center;">
            <div class="score-badge ${getScoreClass(avgInsuranceScore)}" style="font-size:20pt;padding:8px 16px;">${avgInsuranceScore}/10</div>
          </td>
          <td width="30%"><small>${parseFloat(avgInsuranceScore) >= 8 ? 'ممتاز ✅' : parseFloat(avgInsuranceScore) >= 5 ? 'متوسط ⚠️' : 'ضعيف ❌'}</small></td>
        </tr>
        <tr>
          <td><strong>🏥 جودة الإجراءات الطبية</strong><br><small>مبررة طبياً + متوافقة مع الإرشادات</small></td>
          <td style="text-align:center;">
            <div class="score-badge ${getScoreClass(avgMedicalScore)}" style="font-size:20pt;padding:8px 16px;">${avgMedicalScore}/10</div>
          </td>
          <td><small>${parseFloat(avgMedicalScore) >= 8 ? 'ممتاز ✅' : parseFloat(avgMedicalScore) >= 5 ? 'متوسط ⚠️' : 'ضعيف ❌'}</small></td>
        </tr>
      </tbody>
    </table>
    
    <div class="box-info" style="margin-top:1.5rem;">
      <h4 style="margin:0 0 8px 0;border:none;">📌 معايير التقييم:</h4>
      <table style="width:100%;font-size:11px;">
        <tr><td width="50%"><strong>الالتزام التأميني (من 10):</strong><br>10 = توثيق كامل | 8-9 = جيد | 5-7 = متوسط | 1-4 = ضعيف</td>
        <td><strong>جودة الإجراءات (من 10):</strong><br>10 = مبررة بالكامل | 8-9 = مناسبة | 5-7 = تحتاج توضيح | 1-4 = غير مبررة</td></tr>
      </table>
    </div>
    
    <div style="margin-top:1.5rem;background:#f8fafc;border-radius:8px;padding:12px;border:1px solid #e2e8f0;">
      <h4 style="margin:0 0 10px 0;color:#334155;font-size:13px;">📋 المنهجية والتعريفات (مصدر الحقيقة: ملف Excel):</h4>
      <table style="width:100%;font-size:11px;color:#475569;">
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td width="30%"><strong>إجمالي بنود الخدمة:</strong></td>
          <td>عدد الصفوف الفعلية في ملف Excel (${totalServiceItems} بند). هذا هو المقام لجميع النسب.</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td><strong>التشخيص المحدد:</strong></td>
          <td>التشخيص يُعتبر "غير محدد" إذا احتوى على: UNSPECIFIED، site not specified، غير محدد، أو انتهى كود ICD بـ .9</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td><strong>نسبة التكرار:</strong></td>
          <td>(عدد الحالات التي فيها تكرار نفس الخدمة ÷ إجمالي الحالات) × 100 = ${duplicateRate}%</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td><strong>درجة الالتزام التأميني:</strong></td>
          <td>تبدأ من 10 ويُخصم: (1-نسبة ICD)×3 + (1-نسبة العلامات الحيوية)×2 + نسبة التكرار×2 + (IV بدون مبرر)×2</td>
        </tr>
        <tr>
          <td><strong>الدرجة النهائية:</strong></td>
          <td>متوسط بين تقييم AI وحساب البيانات الهيكلية للتوازن والموثوقية</td>
        </tr>
      </table>
    </div>
  </div>
  ` : `
  <div class="report-summary-section" style="margin-top:2rem;page-break-before:always;">
    <h2 style="background:#1e3a5f;color:white;padding:12px;border-radius:8px;text-align:center;">📊 Final Report Summary</h2>
    
    <table class="custom-table report-summary-table" style="width:100%;margin-top:1rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="2" style="text-align:center;font-size:14pt;">Case & Service Statistics</th></tr>
      </thead>
      <tbody>
        <tr><td width="50%"><strong>📁 Total Cases (Claims)</strong></td><td style="font-size:18pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalCases}</td></tr>
        <tr><td><strong>📋 Total Service Items in Excel</strong></td><td style="font-size:16pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalServiceItems}</td></tr>
        <tr style="background:#d4edda"><td><strong>✅ Approved Items (Preliminary)</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${caseStats.approvedCount || 0}</td></tr>
        <tr style="background:#f8d7da"><td><strong>❌ Items Need Review</strong></td><td style="font-size:16pt;font-weight:bold;color:#721c24;text-align:center;">${caseStats.rejectedCount || 0}</td></tr>
        <tr style="background:#fff3cd"><td><strong>⚠️ Items Need Documentation</strong></td><td style="font-size:16pt;font-weight:bold;color:#856404;text-align:center;">${caseStats.needsDocCount || 0}</td></tr>
        <tr style="background:#e0f2fe"><td><strong>🩺 Vital Signs Documentation</strong></td><td style="font-size:16pt;font-weight:bold;color:#0369a1;text-align:center;">${vitalsDocRate}%</td></tr>
        <tr style="background:#d4edda"><td><strong>🔢 ICD Codes Present</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${icdDocRate}%</td></tr>
        <tr style="background:#e0f2fe"><td><strong>📝 Specific Diagnosis</strong></td><td style="font-size:16pt;font-weight:bold;color:#0369a1;text-align:center;">${diagSpecificRatePercent}%</td></tr>
        <tr style="background:${duplicateCases > 0 ? '#fff3cd' : '#d4edda'}"><td><strong>🔄 Duplication Rate</strong></td><td style="font-size:16pt;font-weight:bold;color:${duplicateCases > 0 ? '#856404' : '#155724'};text-align:center;">${duplicateRate}% (${duplicateCases} cases)</td></tr>
        ${casesWithMissingTests > 0 ? `<tr style="background:#fef3c7"><td><strong>📋 Cases with Missing Required Tests</strong></td><td style="font-size:16pt;font-weight:bold;color:#92400e;text-align:center;">${casesWithMissingTests} (${totalMissingTests} tests)</td></tr>` : ''}
      </tbody>
    </table>
    
    <table class="custom-table" style="width:100%;margin-top:1.5rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="3" style="text-align:center;font-size:14pt;">Average Scores</th></tr>
      </thead>
      <tbody>
        <tr>
          <td width="40%"><strong>📋 Insurance Compliance</strong></td>
          <td width="30%" style="text-align:center;">
            <div class="score-badge ${getScoreClass(avgInsuranceScore)}" style="font-size:20pt;padding:8px 16px;">${avgInsuranceScore}/10</div>
          </td>
          <td width="30%"><small>${parseFloat(avgInsuranceScore) >= 8 ? 'Excellent ✅' : parseFloat(avgInsuranceScore) >= 5 ? 'Average ⚠️' : 'Poor ❌'}</small></td>
        </tr>
        <tr>
          <td><strong>🏥 Medical Quality</strong></td>
          <td style="text-align:center;">
            <div class="score-badge ${getScoreClass(avgMedicalScore)}" style="font-size:20pt;padding:8px 16px;">${avgMedicalScore}/10</div>
          </td>
          <td><small>${parseFloat(avgMedicalScore) >= 8 ? 'Excellent ✅' : parseFloat(avgMedicalScore) >= 5 ? 'Average ⚠️' : 'Poor ❌'}</small></td>
        </tr>
      </tbody>
    </table>
  </div>
  `;
  
  // Build repetition and referral alerts section
  const buildAlertsSection = (lang) => {
    let alertsHtml = '';
    
    // Repetition alerts
    if (repetitions.length > 0) {
      const repetitionAlerts = repetitions.map(r => `
        <div class="box-critical" style="margin:8px 0;padding:10px;border-radius:6px;">
          <strong>${r.alert}</strong>
          <br><small>📋 Claims: ${r.claims.join(', ')}</small>
        </div>
      `).join('');
      
      alertsHtml += lang === 'ar' ? `
        <div style="margin-top:1.5rem;page-break-inside:avoid;">
          <h3 style="background:#dc3545;color:white;padding:10px;border-radius:8px;margin:0;">
            🔴 تنبيهات التكرار (${repetitions.length})
          </h3>
          <p style="background:#f8d7da;padding:10px;margin:0;font-size:12px;">
            الحالات التالية تحتوي على تكرار خدمات بدون مبرر طبي واضح. يجب على الطبيب توثيق سبب التكرار لتجنب الرفض التأميني.
          </p>
          ${repetitionAlerts}
        </div>
      ` : `
        <div style="margin-top:1.5rem;page-break-inside:avoid;">
          <h3 style="background:#dc3545;color:white;padding:10px;border-radius:8px;margin:0;">
            🔴 Repetition Alerts (${repetitions.length})
          </h3>
          ${repetitionAlerts}
        </div>
      `;
    }
    
    // Pattern alerts
    if (patterns.length > 0) {
      const patternAlerts = patterns.map(p => `
        <div class="box-warning" style="margin:8px 0;padding:10px;border-radius:6px;">
          <strong>${p.alert}</strong>
        </div>
      `).join('');
      
      alertsHtml += lang === 'ar' ? `
        <div style="margin-top:1rem;page-break-inside:avoid;">
          <h3 style="background:#ffc107;color:#000;padding:10px;border-radius:8px;margin:0;">
            🟠 أنماط غير طبيعية (${patterns.length})
          </h3>
          ${patternAlerts}
        </div>
      ` : `
        <div style="margin-top:1rem;page-break-inside:avoid;">
          <h3 style="background:#ffc107;color:#000;padding:10px;border-radius:8px;margin:0;">
            🟠 Unusual Patterns (${patterns.length})
          </h3>
          ${patternAlerts}
        </div>
      `;
    }
    
    // Referral alerts
    if (referralAlerts.length > 0) {
      const referralItems = referralAlerts.map(r => `
        <div class="box-info" style="margin:8px 0;padding:10px;border-radius:6px;">
          <strong>${r.alert}</strong>
          <br><small>📌 ${lang === 'ar' ? 'التوصية' : 'Recommendation'}: ${r.recommendation}</small>
        </div>
      `).join('');
      
      alertsHtml += lang === 'ar' ? `
        <div style="margin-top:1rem;page-break-inside:avoid;">
          <h3 style="background:#0d6efd;color:white;padding:10px;border-radius:8px;margin:0;">
            👁️ تنبيهات التحويل الطبي (${referralAlerts.length})
          </h3>
          <p style="background:#cce5ff;padding:10px;margin:0;font-size:12px;">
            هذه الحالات تحتاج تحويل لأخصائي وفقاً للإرشادات السريرية المعتمدة (ADA, ESC, WHO).
          </p>
          ${referralItems}
        </div>
      ` : `
        <div style="margin-top:1rem;page-break-inside:avoid;">
          <h3 style="background:#0d6efd;color:white;padding:10px;border-radius:8px;margin:0;">
            👁️ Specialist Referral Alerts (${referralAlerts.length})
          </h3>
          ${referralItems}
        </div>
      `;
    }
    
    // 🆕 Temporal duplicate alerts (from historical data)
    if (duplicateResult && duplicateResult.duplicates && duplicateResult.duplicates.length > 0) {
      const summary = duplicateResult.summary;
      const duplicateItems = duplicateResult.duplicates.map(dup => {
        let itemHtml = `<div style="background:#f8f9fa;border:1px solid #dee2e6;padding:12px;border-radius:8px;margin:10px 0;">
          <strong>🔍 ${lang === 'ar' ? 'المريض' : 'Patient'}: ${dup.patientId} | ${lang === 'ar' ? 'المطالبة' : 'Claim'}: ${dup.caseId || '-'}</strong>`;
        
        for (const med of (dup.medications || [])) {
          const severityStyle = med.severity === 'reject' 
            ? 'background:#fee2e2;border-left:4px solid #dc2626;' 
            : med.severity === 'warning' 
              ? 'background:#fef3c7;border-left:4px solid #d97706;'
              : 'background:#dbeafe;border-left:4px solid #2563eb;';
          itemHtml += `
            <div style="${severityStyle}padding:8px;margin:6px 0;border-radius:4px;">
              <strong>${med.severity === 'reject' ? '🔴' : med.severity === 'warning' ? '🟡' : '🔵'} ${med.medication}</strong><br>
              <span style="font-size:13px;">${med.reason}</span><br>
              ${med.copyPasteText ? `<div style="background:#bbf7d0;padding:6px;margin-top:4px;border-radius:4px;font-size:13px;"><strong>📝 ${lang === 'ar' ? 'نص التوثيق' : 'Documentation'}:</strong> ${med.copyPasteText}</div>` : ''}
            </div>`;
        }
        
        for (const proc of (dup.procedures || [])) {
          const severityStyle = proc.severity === 'reject' 
            ? 'background:#fee2e2;border-left:4px solid #dc2626;' 
            : 'background:#fef3c7;border-left:4px solid #d97706;';
          itemHtml += `
            <div style="${severityStyle}padding:8px;margin:6px 0;border-radius:4px;">
              <strong>${proc.severity === 'reject' ? '🔴' : '🟡'} ${proc.procedure}</strong><br>
              <span style="font-size:13px;">${proc.reason}</span><br>
              ${proc.copyPasteText ? `<div style="background:#bbf7d0;padding:6px;margin-top:4px;border-radius:4px;font-size:13px;"><strong>📝 ${lang === 'ar' ? 'نص التوثيق' : 'Documentation'}:</strong> ${proc.copyPasteText}</div>` : ''}
            </div>`;
        }
        
        itemHtml += '</div>';
        return itemHtml;
      }).join('');
      
      alertsHtml += lang === 'ar' ? `
        <div style="margin-top:1.5rem;page-break-inside:avoid;">
          <h3 style="background:#7c3aed;color:white;padding:10px;border-radius:8px;margin:0;">
            🔄 مراقبة التكرار عبر الزمن (${summary?.totalDuplicates || duplicateResult.duplicates.length})
          </h3>
          <p style="background:#ede9fe;padding:10px;margin:0;font-size:12px;">
            ${summary?.rejectCount > 0 ? `❌ ${summary.rejectCount} مرفوض (أقل من 30 يوم)` : ''}
            ${summary?.warningCount > 0 ? ` | ⚠️ ${summary.warningCount} تحذير (30-60 يوم)` : ''}
            ${summary?.watchCount > 0 ? ` | 📊 ${summary.watchCount} ملاحظة (60-90 يوم)` : ''}
            <br>تم فحص ${duplicateResult.totalChecked} حالة مقابل السجل التاريخي للمطالبات.
          </p>
          ${duplicateItems}
        </div>
      ` : `
        <div style="margin-top:1.5rem;page-break-inside:avoid;">
          <h3 style="background:#7c3aed;color:white;padding:10px;border-radius:8px;margin:0;">
            🔄 Temporal Duplicate Surveillance (${summary?.totalDuplicates || duplicateResult.duplicates.length})
          </h3>
          <p style="background:#ede9fe;padding:10px;margin:0;font-size:12px;">
            ${summary?.rejectCount > 0 ? `❌ ${summary.rejectCount} rejected (<30 days)` : ''}
            ${summary?.warningCount > 0 ? ` | ⚠️ ${summary.warningCount} warnings (30-60 days)` : ''}
            ${summary?.watchCount > 0 ? ` | 📊 ${summary.watchCount} notes (60-90 days)` : ''}
          </p>
          ${duplicateItems}
        </div>
      `;
    }
    
    return alertsHtml;
  };
  
  const alertsSection = buildAlertsSection(language);
  
  const reportFooter = language === 'ar'
    ? `${alertsSection}${summaryTable}<div class="box-good" style="margin-top:2rem;text-align:center"><strong>✅ تم تحليل ${caseResults.length} حالة من أصل ${totalCases} حالة</strong></div></div>`
    : `${alertsSection}${summaryTable}<div class="box-good" style="margin-top:2rem;text-align:center"><strong>✅ Analyzed ${caseResults.length} of ${totalCases} cases</strong></div></div>`;
  
  const fullReport = reportHeader + caseResults.join('<hr style="border:1px solid #ddd;margin:1rem 0">') + reportFooter;
  
  console.log(`Completed processing. Generated report with ${caseResults.length} case analyses.`);
  
  // Generate KPI Dashboard for multi-case report using structured case data
  let kpiDashboard = '';
  try {
    // استخدام caseStats المحسوبة سابقاً (مصدر الحقيقة الوحيد)
    // إضافة الدرجات المحسوبة
    caseStats.avgInsuranceScore = parseFloat(avgInsuranceScore) || structuredInsuranceScore;
    caseStats.avgMedicalScore = parseFloat(avgMedicalScore) || 7;
    
    const kpis = calculateKPIs(caseStats);
    kpiDashboard = generateKPIDashboardHTML(kpis, 'شهري');
    console.log(`[KPI] Generated dashboard: Insurance ${kpis.insuranceCompliance.score}/10, Medical ${kpis.medicalQuality.score}/10, Services: ${caseStats.totalServiceItems}, Duplicates: ${caseStats.duplicateCases}`);
  } catch (kpiErr) {
    console.error('[KPI] Error generating dashboard:', kpiErr.message);
  }

  // Append KPI dashboard to report
  const finalReportWithKPI = kpiDashboard ? fullReport + kpiDashboard : fullReport;
  
  return res.status(200).json({ htmlReport: finalReportWithKPI });
}

function detectMimeType(base64Data = "") {
  const signatures = {
    JVBERi0: "application/pdf",
    iVBORw0: "image/png",
    "/9j/4A": "image/jpeg",
    R0lGOD: "image/gif",
    UklGRg: "image/webp",
    AAAAIG: "video/mp4",
    SUQzB: "audio/mpeg",
  };
  for (const [sig, mt] of Object.entries(signatures)) {
    if (base64Data.startsWith(sig)) return mt;
  }
  return "image/jpeg";
}

const reportTemplates = {
  ar: `
  <style>
    .report-container{font-family:'Cairo','Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;line-height:1.75}
    .box-critical{border-right:5px solid #721c24;background:#f8d7da;color:#721c24;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-warning{border-right:5px solid #856404;background:#fff3cd;color:#856404;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-good{border-right:5px solid #155724;background:#d4edda;color:#155724;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-info{border-right:5px solid #004085;background:#cce5ff;color:#004085;padding:1rem;margin:.75rem 0;border-radius:10px}
    .custom-table{border-collapse:collapse;width:100%;text-align:right;margin-top:1rem;box-shadow:0 2px 4px rgba(0,0,0,.06)}
    .custom-table th,.custom-table td{padding:12px;border:1px solid #dee2e6}
    .custom-table thead{background:#e9ecef}
    h3,h4{color:#243143;border-bottom:2px solid #0b63c2;padding-bottom:8px;margin-top:1.6rem}
    .icon{font-size:1.2em;margin-left:.5rem}
  </style>
  <div class="report-container">
    <h3>تقرير تحليل طبي شامل</h3>
    <p class="box-info">بناءً على المعلومات والملفات المرفوعة، أجرينا تحليلًا سريريًا منظّمًا مع مراجعة بصرية عميقة للصور/التقارير.</p>
    <h4>1) ملخص الحالة والتقييم</h4>
    <ul>
      <li><div class="box-good">✅ <strong>الملخص السريري:</strong> [ملخص دقيق].</div></li>
      <li><div class="box-critical">❌ <strong>نقاط حرجة:</strong> [تعارض/نقص حيوي].</div></li>
      <li><div class="box-warning">⚠️ <strong>بيانات ناقصة:</strong> [فحوص ضرورية مفقودة].</div></li>
    </ul>
    <h4>2) التشخيصات المحتملة (حسب الخطورة)</h4>
    <ol>
      <li><div class="box-critical"><strong>يستبعد أولًا:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-warning"><strong>تالي محتمل:</strong> [تشخيص + تبرير].</div></li>
      <li><div class="box-good"><strong>أقل خطورة:</strong> [قائمة].</div></li>
    </ol>
    <h4>3) مراجعة الأدوية/الإجراءات والفجوات</h4>
    <h5>أ) الأدوية</h5>
    <table class="custom-table"><thead><tr><th>الدواء</th><th>الجرعة/المدة</th><th>الغرض</th><th>تحليل المخاطر</th></tr></thead>
      <tbody>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-critical">❌ <strong>خطر عالٍ:</strong> [سبب].</td></tr>
        <tr><td>[دواء]</td><td>[جرعة]</td><td>[غرض]</td><td class="box-warning">⚠️ <strong>بحذر:</strong> [سبب].</td></tr>
      </tbody>
    </table>
    <h5>ب) فجوات واختبارات لازمة</h5>
    <table class="custom-table"><thead><tr><th>المشكلة</th><th>تحليل/إجراء</th><th>سؤال للطبيب</th></tr></thead>
      <tbody>
        <tr><td><strong>مثال: صداع حول العين</strong></td><td class="box-warning">غياب قياس ضغط العين.</td><td>"هل أحتاج قياس ضغط العين بشكل عاجل؟"</td></tr>
        <tr><td><strong>مثال: قسطرة بولية دائمة</strong></td><td class="box-critical">خطر عدوى مزمنة؛ الأفضل القسطرة المتقطعة.</td><td>"هل المتقطعة أنسب لحالتي؟"</td></tr>
      </tbody>
    </table>
    <h4>4) خطة العمل</h4>
    <ul>
      <li><div class="box-critical"><span class="icon">🚨</span><strong>فوري:</strong> [أوقف/توجّه/اتصل…]</div></li>
      <li><div class="box-warning"><span class="icon">⚠️</span><strong>خلال 24 ساعة:</strong> [راجع/احجز…]</div></li>
    </ul>
    <h4>5) أسئلة ذكية</h4>
    <ul class="box-info"><li>[سؤال 1]</li><li>[سؤال 2]</li></ul>
    <h4>6) ملخص عام</h4>
    <p>[أعلى المخاطر + الخطوة التالية].</p>
    <h4>7) إخلاء مسؤولية</h4>
    <div class="box-warning"><strong>هذا التحليل للتوعية فقط ولا يغني عن الفحص السريري واستشارة طبيب مؤهل.</strong></div>
  </div>
  `,
  en: `
  <style>
    .report-container{font-family:Arial,system-ui,sans-serif;direction:ltr;line-height:1.75}
    .box-critical{border-left:5px solid #721c24;background:#f8d7da;color:#721c24;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-warning{border-left:5px solid #856404;background:#fff3cd;color:#856404;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-good{border-left:5px solid #155724;background:#d4edda;color:#155724;padding:1rem;margin:.75rem 0;border-radius:10px}
    .box-info{border-left:5px solid #004085;background:#cce5ff;color:#004085;padding:1rem;margin:.75rem 0;border-radius:10px}
    .custom-table{border-collapse:collapse;width:100%;text-align:left;margin-top:1rem;box-shadow:0 2px 4px rgba(0,0,0,.06)}
    .custom-table th,.custom-table td{padding:12px;border:1px solid #dee2e6}
    .custom-table thead{background:#e9ecef}
    h3,h4{color:#243143;border-bottom:2px solid #0b63c2;padding-bottom:8px;margin-top:1.6rem}
    .icon{font-size:1.2em;margin-right:.5rem}
  </style>
  <div class="report-container">
    <h3>Comprehensive Medical Analysis Report</h3>
    <p class="box-info">Based on the provided information and files, we performed a structured clinical review with in‑depth visual analysis of radiology/images.</p>
    <h4>1) Case summary & assessment</h4>
    <ul>
      <li><div class="box-good">✅ <strong>Clinical summary:</strong> [Concise summary].</div></li>
      <li><div class="box-critical">❌ <strong>Critical issues:</strong> [Conflicts / vital omissions].</div></li>
      <li><div class="box-warning">⚠️ <strong>Missing data:</strong> [Essential tests not done].</div></li>
    </ul>
    <h4>2) Differential diagnoses (by severity)</h4>
    <ol>
      <li><div class="box-critical"><strong>Must rule out first:</strong> [Dx + rationale].</div></li>
      <li><div class="box-warning"><strong>Next likely:</strong> [Dx + rationale].</div></li>
      <li><div class="box-good"><strong>Lower‑risk options:</strong> [List].</div></li>
    </ol>
    <h4>3) Medication / procedures / gaps</h4>
    <h5>A) Medication audit</h5>
    <table class="custom-table"><thead><tr><th>Drug</th><th>Dosage/Duration</th><th>Indication</th><th>Risk analysis</th></tr></thead>
      <tbody>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-critical">❌ <strong>High risk:</strong> [Why].</td></tr>
        <tr><td>[Med]</td><td>[Dose]</td><td>[Use]</td><td class="box-warning">⚠️ <strong>Caution:</strong> [Why].</td></tr>
      </tbody>
    </table>
    <h5>B) Errors / diagnostic gaps</h5>
    <table class="custom-table"><thead><tr><th>Issue</th><th>Analysis & action</th><th>Ask your doctor</th></tr></thead>
      <tbody>
        <tr><td><strong>Example: Peri‑orbital headache</strong></td><td class="box-warning">No intraocular pressure measurement.</td><td>"Do I need urgent IOP testing?"</td></tr>
        <tr><td><strong>Example: Chronic indwelling catheter</strong></td><td class="box-critical">Consider intermittent catheterization.</td><td>"Is intermittent catheterization safer for me?"</td></tr>
      </tbody>
    </table>
    <h4>4) Action plan</h4>
    <ul>
      <li><div class="box-critical"><span class="icon">🚨</span><strong>Immediate:</strong> [Stop/ER/etc.].</div></li>
      <li><div class="box-warning"><span class="icon">⚠️</span><strong>Next 24h:</strong> [Book/monitor/etc.].</div></li>
    </ul>
    <h4>5) Smart questions</h4>
    <ul class="box-info"><li>[Q1]</li><li>[Q2]</li></ul>
    <h4>6) Overall summary</h4>
    <p>[Top risk + next step].</p>
    <h4>7) Disclaimer</h4>
    <div class="box-warning"><strong>This is a health‑awareness tool and not a medical diagnosis; always consult your physician.</strong></div>
  </div>
  `,
};

function buildUserPrompt(body) {
  const L = body.uiLang === "en" ? "en" : "ar";
  const lines = [];
  const push = (k, v) => {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") lines.push(`- ${k}: ${v}`);
  };

  push(L==="ar"?"العمر":"Age", body.age);
  push(L==="ar"?"الجنس":"Gender", body.gender);
  if (body.gender === "female") {
    push(L==="ar"?"حامل؟":"Pregnant?", body.pregnancyStatus);
    if (body.pregnancyStatus === "yes") push(L==="ar"?"شهر الحمل":"Pregnancy month", body.pregnancyMonth);
  }

  push(L==="ar"?"أعراض بصرية":"Visual symptoms", body.visualSymptoms);
  if (body.visualSymptoms === true || body.visualSymptoms === "yes") {
    push(L==="ar"?"حدة البصر":"Visual acuity", body.visualAcuity);
    push(L==="ar"?"آخر فحص عين":"Last eye exam date", body.lastEyeExamDate);
  }

  push(L==="ar"?"مدخّن":"Smoker", body.isSmoker);
  if (body.isSmoker === true || body.isSmoker === "yes") push(L==="ar"?"سنوات التدخين":"Smoking years", body.smokingYears);
  push(L==="ar"?"سعال":"Cough", body.hasCough);
  if (body.hasCough === true || body.hasCough === "yes") {
    push(L==="ar"?"دم في السعال":"Hemoptysis", body.coughBlood);
    push(L==="ar"?"بلغم أصفر":"Yellow sputum", body.coughYellowSputum);
    push(L==="ar"?"سعال جاف":"Dry cough", body.coughDry);
  }

  push(L==="ar"?"الأعراض":"Symptoms", body.symptoms);
  push(L==="ar"?"التاريخ المرضي":"Medical history", body.history);
  push(L==="ar"?"تشخيصات سابقة":"Previous diagnoses", body.diagnosis);
  push(L==="ar"?"الأدوية الحالية":"Current medications", body.medications);
  push(L==="ar"?"تحاليل/أشعة":"Labs/Imaging", body.labs);

  const files = Array.isArray(body.files) ? body.files : [];
  const filesLine = files.length
    ? (L==="ar"
        ? `يوجد ${files.length} ملف/صورة مرفوعة للتحليل. **اعتبر الصور المصدر الأساسي للحقيقة وحلّل الأشعة بعمق مع ذكر النتائج.**`
        : `There are ${files.length} uploaded file(s). **Treat images as the primary source of truth; analyze radiology deeply and list findings.**`)
    : (L==="ar" ? "لا يوجد ملفات مرفوعة." : "No files uploaded.");

  const header = L==="ar"
    ? "### بيانات الحالة لتوليد التقرير وفق القالب:"
    : "### Case data to generate the report using the supplied template:";

  return `${header}\n${lines.join("\n")}\n\n${filesLine}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: "Patient data required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "System configuration error: missing GEMINI_API_KEY" });
    }

    const language = req.body.uiLang === "en" ? "en" : "ar";
    const systemTemplate = reportTemplates[language];

    const userParts = [{ text: buildUserPrompt(req.body) }];

    const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4MB
    const addInline = (base64, mime) => userParts.push({ inline_data: { mime_type: mime, data: base64 } });
    const addText = (text, name) => userParts.push({ text: `--- محتوى الملف: ${name} ---\n${text}` });

    // Check for Excel files and use per-case processing
    let excelCases = null;
    let excelFile = null;
    
    if (Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        const content = f.base64 || f.textContent || '';
        if (!content) continue;
        
        const fileName = (f.name || '').toLowerCase();
        const mimeType = f.type || 'text/plain';
        
        // Check if it's an Excel file - MUST check before other file processing
        const isExcelFile = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv') ||
            mimeType.includes('spreadsheet') || mimeType.includes('excel') || 
            mimeType.includes('vnd.openxmlformats-officedocument') ||
            mimeType.includes('vnd.ms-excel');
        
        if (isExcelFile) {
          excelFile = f;
          const base64Content = f.base64 || '';
          const textContent = f.textContent || '';
          
          // Try to parse as base64 Excel first (if valid base64)
          if (base64Content && /^[A-Za-z0-9+/]+=*$/.test(base64Content.substring(0, 100).replace(/\s/g, ''))) {
            excelCases = parseExcelCases(base64Content);
          }
          
          // If base64 parsing failed or returned no valid cases, try parsing textContent
          if (!excelCases || excelCases.length === 0 || 
              (excelCases.length > 0 && excelCases.every(c => c.medications.length === 0 && c.procedures.length === 0 && !c.diagnosis))) {
            console.log('[Excel Detection] Base64 parsing failed or empty, trying textContent...');
            // Try textContent if provided
            if (textContent) {
              const textCases = parseTextContent(textContent);
              if (textCases && textCases.length > 0) {
                excelCases = textCases;
                console.log(`[Excel Detection] TextContent parsing succeeded with ${textCases.length} cases`);
              }
            }
            // Fallback: try base64Content as text
            if (!excelCases && base64Content) {
              const textCases = parseTextContent(base64Content);
              if (textCases && textCases.length > 0) {
                excelCases = textCases;
                console.log(`[Excel Detection] Base64 as text parsing succeeded with ${textCases.length} cases`);
              }
            }
          }
          
          console.log(`[Excel Detection] File: ${f.name}, MIME: ${mimeType}, Parsed cases: ${excelCases?.length || 0}`);
          continue;
        }
        
        const isTextType = mimeType.startsWith('text/') || mimeType === 'application/json';
        const isValidBase64 = /^[A-Za-z0-9+/]+=*$/.test(content.replace(/\s/g, '').substring(0, 100));
        
        if (isTextType || !isValidBase64) {
          addText(content, f.name || 'file');
        } else {
          const sizeInBytes = Math.floor((content.length * 3) / 4);
          if (sizeInBytes > MAX_IMAGE_SIZE) {
            return res.status(413).json({
              error: language === "ar" ? `حجم الملف "${f.name || "image"}" يتجاوز 4MB` : `File "${f.name || "image"}" exceeds 4MB`,
            });
          }
          addInline(content, mimeType);
        }
      }
    }
    
    // If Excel cases found, use per-case processing with FULL tri-layer template
    if (excelCases && excelCases.length > 0) {
      console.log(`[Per-Case Mode] Starting processing for ${excelCases.length} cases...`);
      return await processExcelCasesSequentially(req, res, excelCases, language, apiKey);
    }

    // 3-Layer Insurance Audit Prompt with Clinical Guidelines, Drug Interactions & Indications
    const clinicalGuidelinesRef = `
### 📚 مراجع الإرشادات السريرية (للتقييم):

**السوائل الوريدية (IV Fluids):**
- تُستخدم فقط عند: الجفاف الشديد، عدم تحمل الفم، القيء المستمر، صدمة
- يجب توثيق: درجة الجفاف، عدم القدرة على الشرب، علامات الصدمة
- مرجع: WHO Fluid Resuscitation Guidelines

**المضادات الحيوية:**
- التهاب الحلق: لا مضاد حيوي إلا مع حرارة >38.3 + التهاب لوزتين صديدي (CDC IDSA)
- التهاب الجهاز التنفسي العلوي: غالباً فيروسي، لا حاجة لمضاد حيوي
- التهاب المعدة والأمعاء: لا مضاد حيوي إلا مع حمى عالية أو دم في البراز
- مرجع: CDC Antibiotic Stewardship

**خافضات الحرارة:**
- باراسيتامول فموي: للحرارة >38°C
- باراسيتامول وريدي: فقط عند عدم تحمل الفم أو حالة طوارئ
- مرجع: WHO Essential Medicines

**مثبطات مضخة البروتون (PPIs):**
- مبررة: GERD، قرحة معدة، مع NSAIDs طويلة المدى
- غير مبررة: عسر هضم عابر بدون علامات إنذار
`;

    // Drug Interactions Matrix (Arabic)
    const drugInteractionsRef = `
### ⚠️ مصفوفة التضارب الدوائي (Drug Interactions):

**تضاربات خطيرة يجب الإبلاغ عنها:**
| الدواء الأول | الدواء الثاني | نوع التضارب | الخطورة |
|-------------|--------------|-------------|---------|
| NSAIDs (ايبوبروفين، ديكلوفيناك) | مميعات الدم (وارفارين، أسبرين) | زيادة خطر النزيف | 🔴 عالية |
| NSAIDs | مدرات البول، ACE inhibitors | فشل كلوي حاد | 🔴 عالية |
| Macrolides (أزيثرومايسين، كلاريثرومايسين) | Statins (أتورفاستاتين) | رابدومايوليسيس (تحلل العضلات) | 🔴 عالية |
| Metronidazole | Warfarin | زيادة تأثير مميع الدم | 🟠 متوسطة |
| Ciprofloxacin | Theophylline | تسمم ثيوفيلين | 🟠 متوسطة |
| ACE inhibitors | مدرات حافظة للبوتاسيوم | ارتفاع البوتاسيوم الخطير | 🔴 عالية |
| Insulin | Beta blockers | إخفاء أعراض انخفاض السكر | 🟠 متوسطة |
| Metformin | Contrast media (صبغة) | حماض لاكتيكي | 🔴 عالية |
| أدوية تطيل QT interval | أدوية تطيل QT أخرى | اضطراب نبض خطير | 🔴 عالية |

**إذا وُجد تضارب، أضف قسم "⚠️ تضارب دوائي" مع التحذير والتوصية.**
`;

    // Suggested Indications (Reminders for doctors)
    const indicationsRef = `
### 📌 اقتراحات التوثيق المطلوب (Indications to Document):

**عند وصف السوائل الوريدية (IV Fluids)، يجب على الطبيب توثيق أحد الآتي:**
- صعوبة البلع أو عدم تحمل الفم (Oral intolerance)
- إسهال شديد مع علامات جفاف (Severe dehydration)
- قيء مستمر (Intractable vomiting)
- انخفاض مستوى الوعي (Altered consciousness)
- علامات الصدمة (Signs of shock: تسارع النبض، انخفاض الضغط)

**عند وصف باراسيتامول وريدي، يجب توثيق:**
- عدم تحمل الفم / صعوبة البلع
- حالة طوارئ تستدعي تأثير سريع
- حمى عالية >39°C مع أعراض حادة

**عند وصف مضاد حيوي، يجب توثيق:**
- علامات العدوى البكتيرية (حمى >38.3، صديد، CRP مرتفع)
- مدة الأعراض (>10 أيام للجهاز التنفسي)
- تدهور بعد تحسن أولي

**عند عدم وجود التوثيق المطلوب، استخدم العبارة:**
«⚠️ كان يجب على الطبيب توثيق: [المبرر المحدد] لضمان قبول التأمين»
`;

    const insuranceAuditPrompt = language === "ar" 
      ? `أنت مدقق تأميني طبي خبير. حلل كل حالة باستخدام **3 طبقات تحليل**:

${clinicalGuidelinesRef}

${drugInteractionsRef}

${indicationsRef}

---

## 🔍 التنسيق الإلزامي لكل حالة:

<div class="case-section" data-case-id="[رقم]">
  <h3>🔍 الحالة رقم [N] | Claim Se No.: [رقم الملف] | المريض: [رقم المريض]</h3>
  
  <!-- ═══════ بيانات الحالة ═══════ -->
  <h4>📌 بيانات الحالة</h4>
  <table class="custom-table">
    <tr><td><strong>التشخيص:</strong></td><td>[أكواد ICD-10 مع الوصف الكامل]</td></tr>
    <tr><td><strong>درجة الحرارة:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
    <tr><td><strong>ضغط الدم:</strong></td><td>[القيمة]</td></tr>
    <tr><td><strong>الطول:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
    <tr><td><strong>الوزن:</strong></td><td>[القيمة]</td></tr>
    <tr><td><strong>النبض:</strong></td><td>[القيمة] أو <span style="color:#856404">⚠️ غير متوفر</span></td></tr>
  </table>

  <!-- ═══════ الطبقة 1: تحليل الأدوية ═══════ -->
  <h4>💊 الأدوية</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>الدواء</th><th>الجرعة</th><th>التقييم السريري</th><th>الحالة</th></tr>
    </thead>
    <tbody>
      <!-- لكل دواء صف منفصل -->
      <tr>
        <td>[اسم الدواء]</td>
        <td>[الجرعة/الكمية]</td>
        <td>
          <strong>📋 CDI:</strong> [هل التوثيق كافٍ؟ ما المفقود؟]<br>
          <strong>🏥 NPHIES:</strong> [هل يتوافق مع سياسات المطالبات؟]<br>
          <strong>📚 إرشاد سريري:</strong> [المرجع: CDC/WHO - هل منطقي سريرياً؟]
        </td>
        <td data-insurance-rating="[approved/rejected/review]">
          [✅ مقبول / ❌ مرفوض / ⚠️ يحتاج توثيق]
        </td>
      </tr>
    </tbody>
  </table>

  <!-- ═══════ الطبقة 2: تحليل الإجراءات ═══════ -->
  <h4>🔬 التحاليل والإجراءات</h4>
  <table class="custom-table">
    <thead style="background:#1e3a5f;color:white">
      <tr><th>الإجراء</th><th>التقييم (3 طبقات)</th><th>الحالة</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[اسم الإجراء]</td>
        <td>
          <strong>📋 CDI:</strong> [هل مرتبط بالتشخيص؟]<br>
          <strong>🏥 NPHIES:</strong> [هل مسموح بالتكرار؟ الترميز صحيح؟]<br>
          <strong>📚 إرشاد:</strong> [هل مطلوب طبياً حسب البروتوكول؟]
        </td>
        <td data-insurance-rating="[...]">[✅/❌/⚠️]</td>
      </tr>
    </tbody>
  </table>

  <!-- ═══════ الطبقة 3: المرفوضات والتوثيق ═══════ -->
  <h4>❌ إجراءات مرفوضة</h4>
  <div class="box-critical">
    <strong>[اسم الدواء/الإجراء]</strong><br>
    <strong>❌ سبب الرفض:</strong> [التفصيل مع المرجع السريري]<br>
    <strong>📌 للقبول يجب توثيق:</strong> [عدم تحمل الفم، حالة حادة، حمى >38.5، علامات جفاف...]<br>
    <strong>⚠️ مرجع:</strong> [CDC/NPHIES/CCHI]<br>
    <span style="color:#721c24;font-weight:bold">❗ عدم التوثيق = رفض التأمين</span>
  </div>

  <h4>⚠️ إجراءات تحتاج توثيق</h4>
  <div class="box-warning">
    <strong>[اسم الإجراء]</strong><br>
    <strong>📋 ما ينقص:</strong> [التوثيق المطلوب بالتحديد]<br>
    <strong>📌 اقتراحات للطبيب:</strong> [كيف يوثق لضمان القبول]<br>
    <span style="color:#856404;font-weight:bold">❗ عدم التوثيق = رفض التأمين</span>
  </div>

  <!-- ═══════ تضارب دوائي (إن وُجد) ═══════ -->
  <h4>💊⚠️ تضارب دوائي (Drug Interactions)</h4>
  <div class="box-critical" style="background:#fff0f0;border-right:5px solid #dc3545">
    <strong>⚠️ تنبيه تضارب:</strong> [الدواء 1] + [الدواء 2]<br>
    <strong>🔴 نوع التضارب:</strong> [وصف التضارب - مثال: زيادة خطر النزيف]<br>
    <strong>⚡ الخطورة:</strong> [عالية/متوسطة]<br>
    <strong>📌 التوصية:</strong> [ما يجب فعله - مثال: مراجعة الطبيب، إيقاف أحد الأدوية، مراقبة]
  </div>
  <!-- ملاحظة: أضف هذا القسم فقط إذا وُجد تضارب فعلي بين الأدوية الموصوفة -->

  <!-- ═══════ اقتراحات التوثيق للطبيب (Indications) ═══════ -->
  <h4>📝 اقتراحات التوثيق للطبيب (Indications)</h4>
  <div class="box-info" style="background:#e8f4fd;border-right:5px solid #17a2b8">
    <strong>⚠️ كان يجب على الطبيب توثيق:</strong><br>
    <ul style="margin:0.5rem 0;padding-right:1.5rem">
      <li>[مبرر 1 - مثال: صعوبة البلع لتبرير السوائل الوريدية]</li>
      <li>[مبرر 2 - مثال: إسهال شديد مع علامات جفاف]</li>
      <li>[مبرر 3 - مثال: قيء مستمر يمنع تناول الأدوية الفموية]</li>
    </ul>
    <strong>📌 لضمان قبول التأمين، يُنصح بإضافة هذه المبررات في الملف الطبي.</strong>
  </div>

  <!-- ═══════ الملخص النهائي ═══════ -->
  <h4>📊 ملخص الحالة</h4>
  <table class="custom-table">
    <tr style="background:#d4edda">
      <td width="30%"><strong>✅ صحيح ومقبول</strong></td>
      <td>[قائمة كل الأدوية والإجراءات المقبولة]</td>
    </tr>
    <tr style="background:#f8d7da">
      <td><strong>❌ مرفوض</strong></td>
      <td>[قائمة المرفوض مع السبب المختصر]</td>
    </tr>
    <tr style="background:#fff3cd">
      <td><strong>⚠️ يحتاج توثيق</strong></td>
      <td>[قائمة ما يحتاج توثيق]</td>
    </tr>
  </table>
</div>

<hr style="border:3px solid #1e3a5f;margin:2rem 0">

---

## ⚙️ قواعد التقييم الإلزامية (مهم جداً - اقرأ بتمعن):

### ⚠️ فرق مهم جداً: "مرفوض" vs "يحتاج توثيق"

| التصنيف | المعنى | متى يُستخدم | مثال |
|---------|--------|------------|------|
| ✅ مقبول | يتوافق مع التشخيص + العلامات الحيوية + الإرشادات السريرية | كل المعلومات المطلوبة موجودة في البيانات | CBC مع التهاب معدة وأمعاء + WBC مرتفع |
| ⚠️ يحتاج توثيق | **التشخيص يتوافق مع الدواء** لكن التوثيق غير كافٍ في بيانات المطالبة | الدواء منطقي للتشخيص لكن العلامات الداعمة غير مذكورة | PPI مع عسر هضم (الدواء منطقي لكن نحتاج توثيق GERD/أعراض) |
| ❌ مرفوض | **التشخيص لا يتوافق مع الدواء** أو مخالف صريح للإرشادات | تعارض واضح بين الدواء والتشخيص أو الحالة السريرية | DRAMYLIN (مقشع سعال) لعلاج الغثيان، مضاد حيوي لنزلة برد فيروسية صريحة |

### 🔴 قاعدة ذهبية: لا ترفض فقط لأن المعلومة غير موجودة!
- إذا كان الدواء **منطقياً للتشخيص** لكن التوثيق ناقص ← ⚠️ يحتاج توثيق
- إذا كان الدواء **غير منطقي للتشخيص** أو مخالف للإرشادات ← ❌ مرفوض
- مثال: ESOPOLE مع عسر هضم = ⚠️ يحتاج توثيق (PPI منطقي لعسر الهضم، فقط نحتاج توثيق GERD)
- مثال: DRAMYLIN مع غثيان = ❌ مرفوض (DRAMYLIN ليس دواء غثيان، هو مقشع للسعال)

### 🌡️ معايير الحمى (تعريف موحد):
- **الحمى تُعرف طبياً**: ≥38.0°C (WHO, CDC)
- **حرارة طبيعية**: <38.0°C - لا تبرر خافض حرارة
- **ملاحظة**: الباراسيتامول مسكن أيضاً، إذا كان هناك ألم VAS ≥4 فهو مبرر حتى مع حرارة طبيعية

## 📋 متطلبات التقرير الإلزامية:
1. **حلل كل حالة على حدة بالتفصيل الكامل** - لا تختصر أبداً ولا تتخطَّ أي حالة
2. **كل دواء/إجراء = صف منفصل** في الجدول مع التقييم الثلاثي (CDI + NPHIES + Clinical)
3. **استخدم المراجع السريرية** في التبرير (CDC, WHO, CCHI, NPHIES)
4. **قارن العلامات الحيوية** بالأدوية الموصوفة (حرارة، نبض، ضغط)
5. **أذكر بالضبط** ما ينقص من التوثيق وكيف يُصحح

## ⚠️ تحذير مهم جداً:
- **يجب تحليل 100% من الحالات** - لا تتوقف أبداً قبل الانتهاء من كل الحالات
- إذا كان هناك 10 حالات في الملف، يجب أن يحتوي التقرير على تحليل 10 حالات كاملة
- **ممنوع الاختصار أو دمج الحالات** - كل حالة قسم منفصل بجميع أقسامه

---

## 🚫 تعليمات مهمة جداً حول الملخص:

**لا تنشئ ملخصاً تنفيذياً أو تقييمات رقمية!** النظام يحسب الإحصائيات تلقائياً.

**مطلوب منك فقط:**
1. تحليل كل حالة بالتفصيل باستخدام النموذج أعلاه
2. استخدام ✅ و ❌ و ⚠️ بشكل صحيح حسب قواعد التقييم
3. في نهاية كل حالة، اكتب ملخص الحالة الواحدة فقط (مقبول/مرفوض/يحتاج توثيق)
4. **لا تكتب ملخصاً عاماً أو تقييمات أو أهداف تحسين** - النظام يفعل ذلك تلقائياً

أعد HTML كامل بالعربية بدون أي code blocks أو markdown.`
      : `You are an expert medical insurance auditor. Analyze each case using **3 analysis layers**:

${clinicalGuidelinesRef}

---

## 🔍 Mandatory Format for Each Case:

[Same structure as Arabic but in English...]

Return complete HTML in English.`;

    userParts.push({ text: insuranceAuditPrompt });

    const payload = {
      system_instruction: { role: "system", parts: [{ text: systemTemplate }] },
      contents: [{ role: "user", parts: userParts }],
      generation_config: { temperature: 0.2, top_p: 0.95, top_k: 40, max_output_tokens: 16384 },
    };

    const model = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let msg = await response.text();
      try { const j = JSON.parse(msg); msg = j.error?.message || msg; } catch {}
      throw new Error(msg || `API request failed (${response.status})`);
    }

    const result = await response.json();
    let text = result?.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || "";
    if (!text) throw new Error("Failed to generate report text from the model.");

    // Clean up code fences that Gemini sometimes adds
    text = text.replace(/^```html?\s*/i, '').replace(/```\s*$/i, '').trim();
    
    // Remove any remaining markdown code block markers
    text = text.replace(/^```\s*/gm, '').replace(/\s*```$/gm, '');

    // Generate KPI Dashboard (for single-case reports, case count = 1)
    let kpiDashboard = '';
    try {
      const reportStats = extractStatsFromReport(text);
      // For single-case handler, totalCases is 1 (multi-case Excel goes through processExcelCasesSequentially)
      if (!reportStats.totalCases || reportStats.totalCases === 0) {
        reportStats.totalCases = 1;
      }
      const kpis = calculateKPIs(reportStats);
      kpiDashboard = generateKPIDashboardHTML(kpis, 'شهري');
      console.log(`[KPI] Generated dashboard: Insurance ${kpis.insuranceCompliance.score}/10, Medical ${kpis.medicalQuality.score}/10`);
    } catch (kpiErr) {
      console.error('[KPI] Error generating dashboard:', kpiErr.message);
    }

    // Append KPI dashboard to report
    const finalReport = kpiDashboard ? text + kpiDashboard : text;

    return res.status(200).json({ htmlReport: finalReport });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    return res.status(500).json({ error: "Server error during case analysis", detail: err.message });
  }
}
