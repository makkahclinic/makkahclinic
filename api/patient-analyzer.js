// /api/patient-analyzer.js
import XLSX from 'xlsx';

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
    const serviceDescIdx = headers.findIndex(h => (h.includes('service') && h.includes('desc')) || h.includes('item desc'));
    const tempIdx = headers.findIndex(h => h.includes('temp'));
    const bpIdx = headers.findIndex(h => h.includes('pressure') || h.includes('bp'));
    const pulseIdx = headers.findIndex(h => h.includes('pulse'));
    const weightIdx = headers.findIndex(h => h.includes('weight'));
    const heightIdx = headers.findIndex(h => h.includes('height'));
    
    console.log('[parseTextContent] Column indices:', { claimIdx, patientIdx, serviceDescIdx, tempIdx });
    
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
      
      if (!caseMap.has(claimId)) {
        caseMap.set(claimId, {
          claimId,
          patientId: patientIdx >= 0 ? cells[patientIdx] : '',
          diagnosis: diagText,
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
      
      // Extract service description
      if (serviceDescIdx >= 0 && cells[serviceDescIdx]) {
        const serviceDesc = cells[serviceDescIdx];
        if (!c.services.some(s => s.name === serviceDesc)) {
          c.services.push({ name: serviceDesc, code: '', amount: '' });
        }
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
      // Fallback to any column with "diag" or "تشخيص"
      const diagIdx = icdDescCols.length > 0 ? icdDescCols[0] : headers.findIndex(h => h.includes('diag') || h.includes('تشخيص'));
      
      // Vital signs
      const tempIdx = headers.findIndex(h => h.includes('temp') || h.includes('حرارة'));
      const bpIdx = headers.findIndex(h => h.includes('pressure') || h.includes('bp') || h.includes('ضغط'));
      const pulseIdx = headers.findIndex(h => h.includes('pulse') || h.includes('نبض'));
      const weightIdx = headers.findIndex(h => h.includes('weight') || h.includes('وزن'));
      const heightIdx = headers.findIndex(h => h.includes('height') || h.includes('طول'));
      
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
      
      console.log('[parseExcelCases] Column indices:', { claimIdx, patientIdx, diagIdx, serviceDescIdx, tempIdx, bpIdx });
      
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
        
        if (!caseMap.has(claimId)) {
          caseMap.set(claimId, {
            claimId,
            patientId: patientIdx >= 0 ? row[patientIdx] : '',
            diagnosis: diagText,
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
        
        // Extract service/medication from "Service description" column
        if (serviceDescIdx >= 0 && row[serviceDescIdx]) {
          const serviceDesc = String(row[serviceDescIdx]).trim();
          const serviceCode = serviceCodeIdx >= 0 ? String(row[serviceCodeIdx] || '') : '';
          const amount = amountIdx >= 0 ? row[amountIdx] : '';
          
          // Check if already added (avoid duplicates)
          if (serviceDesc && !c.services.some(s => s.name === serviceDesc)) {
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

// Build prompt for a single case
function buildSingleCasePrompt(caseData, caseNumber, totalCases, language) {
  const L = language === 'en' ? 'en' : 'ar';
  
  if (L === 'ar') {
    return `## 🔍 الحالة رقم ${caseNumber} من ${totalCases}

**بيانات الحالة:**
- رقم المطالبة (Claim Se No.): ${caseData.claimId}
- رقم المريض: ${caseData.patientId || 'غير متوفر'}
- التشخيص: ${caseData.diagnosis || 'غير متوفر'}

**العلامات الحيوية:**
- درجة الحرارة: ${caseData.vitals.temperature || 'غير متوفر'}
- ضغط الدم: ${caseData.vitals.bloodPressure || 'غير متوفر'}
- النبض: ${caseData.vitals.pulse || 'غير متوفر'}
- الوزن: ${caseData.vitals.weight || 'غير متوفر'}
- الطول: ${caseData.vitals.height || 'غير متوفر'}

**الأدوية الموصوفة:**
${caseData.medications.length > 0 ? caseData.medications.map(m => `- ${m.name} (${m.dose || 'جرعة غير محددة'})`).join('\n') : '- لا يوجد أدوية'}

**الإجراءات/التحاليل:**
${caseData.procedures.length > 0 ? caseData.procedures.map(p => `- ${p}`).join('\n') : '- لا يوجد إجراءات'}

**البيانات الخام:**
${caseData.rawData.slice(0, 10).join('\n')}

---
حلل هذه الحالة بالتفصيل الكامل باستخدام 3 طبقات التحليل (CDI, NPHIES, Clinical Guidelines).
أعد HTML بالتنسيق المحدد مسبقاً.`;
  } else {
    return `## 🔍 Case ${caseNumber} of ${totalCases}

**Case Data:**
- Claim Se No.: ${caseData.claimId}
- Patient ID: ${caseData.patientId || 'N/A'}
- Diagnosis: ${caseData.diagnosis || 'N/A'}

**Vital Signs:**
- Temperature: ${caseData.vitals.temperature || 'N/A'}
- Blood Pressure: ${caseData.vitals.bloodPressure || 'N/A'}
- Pulse: ${caseData.vitals.pulse || 'N/A'}
- Weight: ${caseData.vitals.weight || 'N/A'}
- Height: ${caseData.vitals.height || 'N/A'}

**Medications:**
${caseData.medications.length > 0 ? caseData.medications.map(m => `- ${m.name} (${m.dose || 'dose N/A'})`).join('\n') : '- No medications'}

**Procedures/Tests:**
${caseData.procedures.length > 0 ? caseData.procedures.map(p => `- ${p}`).join('\n') : '- No procedures'}

**Raw Data:**
${caseData.rawData.slice(0, 10).join('\n')}

---
Analyze this case in full detail using 3-layer analysis (CDI, NPHIES, Clinical Guidelines).
Return HTML in the specified format.`;
  }
}

// Process Excel cases sequentially with individual API calls - FULL TRI-LAYER TEMPLATE
async function processExcelCasesSequentially(req, res, cases, language, apiKey) {
  const totalCases = cases.length;
  const caseResults = [];
  const model = "gemini-2.0-flash";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  // FULL Clinical Guidelines Reference (same as bulk mode)
  const fullClinicalRef = `
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

### ⚠️ مصفوفة التضارب الدوائي:
| الدواء الأول | الدواء الثاني | نوع التضارب | الخطورة |
|-------------|--------------|-------------|---------|
| NSAIDs | مميعات الدم | زيادة خطر النزيف | 🔴 عالية |
| NSAIDs | مدرات البول، ACE inhibitors | فشل كلوي حاد | 🔴 عالية |
| Macrolides | Statins | رابدومايوليسيس | 🔴 عالية |
| Metronidazole | Warfarin | زيادة تأثير مميع الدم | 🟠 متوسطة |
| ACE inhibitors | مدرات حافظة للبوتاسيوم | ارتفاع البوتاسيوم | 🔴 عالية |

### 📌 اقتراحات التوثيق:
- السوائل الوريدية: توثيق صعوبة البلع، جفاف شديد، قيء مستمر، علامات صدمة
- باراسيتامول وريدي: عدم تحمل الفم، حالة طوارئ، حمى >39°C
- المضادات الحيوية: علامات عدوى بكتيرية (حمى >38.3، صديد)
`;

  // COMPACT Template with scoring criteria
  const caseTemplate = language === 'ar' ? `أنت مدقق تأميني طبي خبير. حلل الحالة باختصار مع تقييم رقمي واضح.

${fullClinicalRef}

## معايير التقييم الرقمي (من 10):

### 📋 معيار الالتزام التأميني (Insurance Compliance Score):
- 10/10: توثيق كامل + أكواد ICD صحيحة + علامات حيوية موثقة
- 8-9/10: توثيق جيد مع نقص بسيط
- 5-7/10: توثيق متوسط يحتاج تحسين
- 1-4/10: توثيق ضعيف مع مخاطر رفض
- 0/10: لا توثيق

### 🏥 معيار جودة الإجراءات الطبية (Medical Quality Score):
- 10/10: كل الإجراءات مبررة طبياً + متوافقة مع الإرشادات السريرية
- 8-9/10: إجراءات مناسبة مع ملاحظات بسيطة
- 5-7/10: بعض الإجراءات تحتاج مبرر أوضح
- 1-4/10: إجراءات غير مبررة أو مفرطة
- 0/10: لا إجراءات أو كلها مرفوضة

## 🔍 التنسيق المختصر (استخدم هذا بالضبط):

<div class="case-section" data-insurance-score="[X]" data-medical-score="[Y]">
  <h3>🔍 الحالة [N] | Claim: [رقم الملف] | المريض: [رقم المريض]</h3>
  
  <table class="custom-table case-info-table" style="width:100%">
    <tr><td width="15%"><strong>التشخيص:</strong></td><td>[ICD + الوصف]</td><td width="20%"><strong>الحرارة:</strong> [قيمة]</td><td width="20%"><strong>الضغط:</strong> [قيمة]</td></tr>
  </table>

  <table class="custom-table medications-table" style="width:100%">
    <thead style="background:#1e3a5f;color:white">
      <tr><th width="22%">الدواء</th><th width="10%">الجرعة</th><th width="50%">التقييم المختصر</th><th width="18%">الحالة</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[اسم الدواء]</td>
        <td>[جرعة]</td>
        <td><strong>CDI:</strong> [مختصر]. <strong>NPHIES:</strong> [مختصر]. <strong>سريري:</strong> [مرجع مختصر]</td>
        <td class="status-[approve/reject/warning]" data-status="[approved/rejected/warning]">[✅ مقبول/❌ مرفوض/⚠️ يحتاج توثيق]</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; gap:10px; margin:8px 0;">
    <div class="box-critical" style="flex:1; padding:8px; border-radius:6px; font-size:11px;">
      <strong>❌ مرفوض:</strong> [قائمة مختصرة أو "لا يوجد"]
    </div>
    <div class="box-warning" style="flex:1; padding:8px; border-radius:6px; font-size:11px;">
      <strong>⚠️ يحتاج توثيق:</strong> [قائمة مختصرة أو "لا يوجد"]
    </div>
  </div>

  <table class="custom-table scores-table" style="width:100%; margin-top:5px;">
    <tr style="background:#e8f4fd">
      <td width="50%"><strong>📋 الالتزام التأميني:</strong> <span class="score-badge">[X]/10</span></td>
      <td width="50%"><strong>🏥 جودة الإجراءات:</strong> <span class="score-badge">[Y]/10</span></td>
    </tr>
  </table>
</div>

## ⚙️ قواعد:
- اختصر التقييم السريري في جملة واحدة لكل دواء/إجراء
- استخدم الأرقام للتقييم (X/10 و Y/10)
- لا تكرر المعلومات
- أعد HTML فقط بدون markdown

بيانات الحالة:
` : `You are an expert medical insurance auditor. Analyze concisely with numeric scores.

${fullClinicalRef}

## Scoring Criteria (out of 10):

### 📋 Insurance Compliance Score:
- 10/10: Complete documentation + correct ICD codes + vitals documented
- 8-9/10: Good documentation with minor gaps
- 5-7/10: Average documentation needs improvement
- 1-4/10: Poor documentation with rejection risks
- 0/10: No documentation

### 🏥 Medical Quality Score:
- 10/10: All procedures medically justified + aligned with clinical guidelines
- 8-9/10: Appropriate procedures with minor notes
- 5-7/10: Some procedures need clearer justification
- 1-4/10: Unjustified or excessive procedures
- 0/10: No procedures or all rejected

## 🔍 Compact Format (use exactly):

<div class="case-section" data-insurance-score="[X]" data-medical-score="[Y]">
  <h3>🔍 Case [N] | Claim: [claim_id] | Patient: [patient_id]</h3>
  
  <table class="custom-table case-info-table" style="width:100%">
    <tr><td width="15%"><strong>Diagnosis:</strong></td><td>[ICD + description]</td><td width="20%"><strong>Temp:</strong> [value]</td><td width="20%"><strong>BP:</strong> [value]</td></tr>
  </table>

  <table class="custom-table medications-table" style="width:100%">
    <thead style="background:#1e3a5f;color:white">
      <tr><th width="20%">Medication</th><th width="10%">Dose</th><th width="55%">Brief Evaluation</th><th width="15%">Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>[medication]</td>
        <td>[dose]</td>
        <td><strong>CDI:</strong> [brief]. <strong>NPHIES:</strong> [brief]. <strong>Clinical:</strong> [brief ref]</td>
        <td>[✅/❌/⚠️]</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex; gap:10px; margin:8px 0;">
    <div style="flex:1; background:#f8d7da; padding:6px; border-radius:4px; font-size:11px;">
      <strong>❌ Rejected:</strong> [brief list or "None"]
    </div>
    <div style="flex:1; background:#fff3cd; padding:6px; border-radius:4px; font-size:11px;">
      <strong>⚠️ Needs Documentation:</strong> [brief list or "None"]
    </div>
  </div>

  <table class="custom-table scores-table" style="width:100%; margin-top:5px;">
    <tr style="background:#e8f4fd">
      <td width="50%"><strong>📋 Insurance Compliance:</strong> <span class="score-badge">[X]/10</span></td>
      <td width="50%"><strong>🏥 Medical Quality:</strong> <span class="score-badge">[Y]/10</span></td>
    </tr>
  </table>
</div>

## Rules:
- Keep clinical evaluation to ONE sentence per medication/procedure
- Use numeric scores (X/10 and Y/10)
- Don't repeat information
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

  console.log(`Processing ${totalCases} cases individually...`);
  
  for (let i = 0; i < totalCases; i++) {
    const caseData = cases[i];
    const caseNumber = i + 1;
    
    console.log(`Processing case ${caseNumber}/${totalCases}: ${caseData.claimId}`);
    
    const casePrompt = buildSingleCasePrompt(caseData, caseNumber, totalCases, language);
    
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
      
      if (text) {
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
  
  // Extract scores from case results for summary
  const allCasesHtml = caseResults.join('');
  const insuranceScoreMatches = allCasesHtml.match(/data-insurance-score="(\d+)"/g) || [];
  const medicalScoreMatches = allCasesHtml.match(/data-medical-score="(\d+)"/g) || [];
  
  const insuranceScores = insuranceScoreMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
  const medicalScores = medicalScoreMatches.map(m => parseInt(m.match(/\d+/)?.[0] || '0'));
  
  const avgInsuranceScore = insuranceScores.length > 0 ? (insuranceScores.reduce((a,b) => a+b, 0) / insuranceScores.length).toFixed(1) : '0';
  const avgMedicalScore = medicalScores.length > 0 ? (medicalScores.reduce((a,b) => a+b, 0) / medicalScores.length).toFixed(1) : '0';
  
  // Count approved/rejected/review items from HTML content
  const approvedCount = (allCasesHtml.match(/✅/g) || []).length;
  const rejectedCount = (allCasesHtml.match(/❌/g) || []).length;
  const reviewCount = (allCasesHtml.match(/⚠️/g) || []).length;
  
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
  
  // Final summary table
  const summaryTable = language === 'ar' ? `
  <div class="report-summary-section" style="margin-top:2rem;page-break-before:always;">
    <h2 style="background:#1e3a5f;color:white;padding:12px;border-radius:8px;text-align:center;">📊 الملخص النهائي للتقرير</h2>
    
    <table class="custom-table report-summary-table" style="width:100%;margin-top:1rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="2" style="text-align:center;font-size:14pt;">إحصائيات الحالات</th></tr>
      </thead>
      <tbody>
        <tr><td width="50%"><strong>📁 إجمالي الحالات المحللة</strong></td><td style="font-size:18pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalCases}</td></tr>
        <tr style="background:#d4edda"><td><strong>✅ الإجراءات المقبولة</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${approvedCount}</td></tr>
        <tr style="background:#f8d7da"><td><strong>❌ الإجراءات المرفوضة</strong></td><td style="font-size:16pt;font-weight:bold;color:#721c24;text-align:center;">${rejectedCount}</td></tr>
        <tr style="background:#fff3cd"><td><strong>⚠️ تحتاج توثيق</strong></td><td style="font-size:16pt;font-weight:bold;color:#856404;text-align:center;">${reviewCount}</td></tr>
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
  </div>
  ` : `
  <div class="report-summary-section" style="margin-top:2rem;page-break-before:always;">
    <h2 style="background:#1e3a5f;color:white;padding:12px;border-radius:8px;text-align:center;">📊 Final Report Summary</h2>
    
    <table class="custom-table report-summary-table" style="width:100%;margin-top:1rem;">
      <thead style="background:#1e3a5f;color:white">
        <tr><th colspan="2" style="text-align:center;font-size:14pt;">Case Statistics</th></tr>
      </thead>
      <tbody>
        <tr><td width="50%"><strong>📁 Total Cases Analyzed</strong></td><td style="font-size:18pt;font-weight:bold;color:#1e3a5f;text-align:center;">${totalCases}</td></tr>
        <tr style="background:#d4edda"><td><strong>✅ Approved Items</strong></td><td style="font-size:16pt;font-weight:bold;color:#155724;text-align:center;">${approvedCount}</td></tr>
        <tr style="background:#f8d7da"><td><strong>❌ Rejected Items</strong></td><td style="font-size:16pt;font-weight:bold;color:#721c24;text-align:center;">${rejectedCount}</td></tr>
        <tr style="background:#fff3cd"><td><strong>⚠️ Needs Documentation</strong></td><td style="font-size:16pt;font-weight:bold;color:#856404;text-align:center;">${reviewCount}</td></tr>
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
  
  const reportFooter = language === 'ar'
    ? `${summaryTable}<div class="box-good" style="margin-top:2rem;text-align:center"><strong>✅ تم تحليل ${caseResults.length} حالة من أصل ${totalCases} حالة</strong></div></div>`
    : `${summaryTable}<div class="box-good" style="margin-top:2rem;text-align:center"><strong>✅ Analyzed ${caseResults.length} of ${totalCases} cases</strong></div></div>`;
  
  const fullReport = reportHeader + caseResults.join('<hr style="border:1px solid #ddd;margin:1rem 0">') + reportFooter;
  
  console.log(`Completed processing. Generated report with ${caseResults.length} case analyses.`);
  
  return res.status(200).json({ htmlReport: fullReport });
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
          const base64Content = f.base64 || content;
          
          // Try to parse as base64 Excel first
          excelCases = parseExcelCases(base64Content);
          
          // If base64 parsing failed or returned no valid cases, try parsing as pre-processed text
          if (!excelCases || excelCases.length === 0 || 
              (excelCases.length > 0 && excelCases.every(c => c.medications.length === 0 && c.procedures.length === 0 && !c.diagnosis))) {
            console.log('[Excel Detection] Base64 parsing failed or empty, trying text parsing...');
            const textCases = parseTextContent(content);
            if (textCases && textCases.length > 0) {
              excelCases = textCases;
              console.log(`[Excel Detection] Text parsing succeeded with ${textCases.length} cases`);
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

## ⚙️ قواعد التقييم الإلزامية:

| الحالة | المعنى | مثال |
|--------|--------|------|
| ✅ مقبول | يتوافق مع التشخيص + العلامات الحيوية + الإرشادات السريرية | CBC مع التهاب معدة وأمعاء + نبض مرتفع |
| ❌ مرفوض | لا يوجد مبرر طبي موثق | باراسيتامول IV مع حرارة 36.1 طبيعية |
| ⚠️ يحتاج توثيق | قد يكون مبرراً لكن التوثيق غير كافٍ | سوائل وريدية بدون توثيق عدم تحمل الفم |

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
- أضف في نهاية التقرير: "✅ تم تحليل [N] حالة من أصل [N] حالة"

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

    return res.status(200).json({ htmlReport: text });
  } catch (err) {
    console.error("patient-analyzer error:", err);
    return res.status(500).json({ error: "Server error during case analysis", detail: err.message });
  }
}
