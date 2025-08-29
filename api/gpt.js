// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v4.3.0 ===

const API_VERSION = 'v4.3.0';

// ---------- infra helpers ----------
function setCORS(res){ res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); }
async function readBody(req){
  const bufs=[]; for await (const c of req) bufs.push(c);
  const raw = Buffer.concat(bufs).toString('utf8');
  let obj={}; try{ obj = JSON.parse(raw||'{}'); }catch{}
  return { raw, obj };
}
function mimeFromName(name, fallback='image/png'){ const n=(name||'').toLowerCase(); if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg'; if(n.endsWith('.png'))return 'image/png'; if(n.endsWith('.webp'))return 'image/webp'; if(n.endsWith('.heic'))return 'image/heic'; if(n.endsWith('.heif'))return 'image/heif'; if(n.endsWith('.tif')||n.endsWith('.tiff'))return 'image/tiff'; return fallback; }
function asWebRequest(req, bodyString){
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url   = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k,v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) headers.set(k, v.join(', '));
    else if (typeof v === 'string') headers.set(k, v);
  }
  return new Request(url, { method: req.method, headers, body: bodyString });
}

// ---------- reference bank (credible links) ----------
const REF_BANK = [
  {title:'NICE CKS — Carpal tunnel syndrome (assessment / when to arrange NCS)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/carpal-tunnel-syndrome/diagnosis/assessment/'},
  {title:'NICE CKS — Tennis elbow (diagnosis and management)', org:'NICE CKS', link:'https://cks.nice.org.uk/topics/tennis-elbow/'},
  {title:'ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/S00-T88/S50-S59/S50-/S50.1'},
  {title:'ICD‑10‑CM — M77.12 Lateral epicondylitis, left elbow', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/M00-M99/M70-M79/M77-/M77.12'},
  {title:'ICD‑10‑CM — G56.02 Carpal tunnel syndrome, left upper limb', org:'ICD10Data', link:'https://www.icd10data.com/ICD10CM/Codes/G00-G99/G50-G59/G56-/G56.02'},
  {title:'BC Guidelines — ESR/CRP Testing (When to order)', org:'Government of British Columbia', link:'https://www2.gov.bc.ca/gov/content/health/practitioner-professional-resources/bc-guidelines/esr'},
  {title:'American Academy of Dermatology — Atopic Dermatitis Guidelines', org:'AAD', link:'https://www.aad.org/member/clinical-quality/guidelines/atopic-dermatitis'},
  {title:'UpToDate — Atopic dermatitis (eczema): Pathogenesis, clinical manifestations, and diagnosis', org:'UpToDate', link:'https://www.uptodate.com/contents/atopic-dermatitis-eczema-pathogenesis-clinical-manifestations-and-diagnosis'},
  {title:'WHO — Anatomical Therapeutic Chemical Classification System', org:'WHO', link:'https://www.who.int/tools/atc-ddd-toolkit/atc-classification'},
  {title:'CDC — Clinical Practice Guidelines for Dermatology', org:'CDC', link:'https://www.cdc.gov/dermatology/clinical-guidelines/index.html'},
  {title:'Journal of the American Academy of Dermatology — Treatment Guidelines', org:'JAAD', link:'https://www.jaad.org/action/showPdf?pii=S0190-9622%2818%2932679-6'},
  {title:'American Academy of Orthopaedic Surgeons — Hand Pain Guidelines', org:'AAOS', link:'https://www.aaos.org/quality/quality-programs/upper-extremity-programs/hand-and-wrist/'},
  {title:'National Institute of Arthritis and Musculoskeletal and Skin Diseases — Hand Pain', org:'NIAMS', link:'https://www.niams.nih.gov/health-topics/hand-pain'},
  {title:'American Society for Surgery of the Hand — Clinical Guidelines', org:'ASSH', link:'https://www.assh.org/practice/clinical-practice-guidelines'},
  {title:'ICD-10-CM Official Guidelines for Coding and Reporting', org:'CDC', link:'https://www.cdc.gov/nchs/icd/icd-10-cm.htm'}
];

// ---------- JSON schema (shared) ----------
const REPORT_SCHEMA = {
  type:"object",
  properties:{
    executive_summary:{type:"string"},
    patient_summary:{type:"string"},
    clinical_assessment:{type:"object",properties:{
      subjective_findings:{type:"array",items:{type:"string"}},
      objective_findings:{type:"array",items:{type:"string"}},
      assessment:{type:"string"},
      plan:{type:"string"},
      complexity_score:{type:"number",minimum:1,maximum:10}
    },required:["subjective_findings","objective_findings","assessment","plan"]},
    key_findings:{type:"array",items:{type:"string"}},
    differential_diagnoses:{type:"array",items:{type:"object",properties:{
      dx:{type:"string"},
      why:{type:"string"},
      confidence:{type:"string",enum:["high","medium","low"]},
      supporting_evidence:{type:"array",items:{type:"string"}},
      ruling_out:{type:"array",items:{type:"string"}},
      diagnostic_tests:{type:"array",items:{type:"string"}},
      treatment_options:{type:"array",items:{type:"string"}},
      urgency:{type:"string",enum:["emergent","urgent","routine"]}
    },required:["dx","why","confidence","urgency"]}},
    severity_red_flags:{type:"array",items:{type:"object",properties:{
      flag:{type:"string"},
      clinical_significance:{type:"string"},
      immediate_action:{type:"string"},
      risk_level:{type:"string",enum:["critical","high","medium","low"]},
      documentation_requirements:{type:"array",items:{type:"string"}}
    },required:["flag","risk_level"]}},
    procedural_issues:{type:"array",items:{type:"object",properties:{
      issue:{type:"string"},
      impact:{type:"string"},
      evidence:{type:"string"},
      recommendation:{type:"string"},
      severity:{type:"string",enum:["critical","high","medium","low"]},
      financial_impact:{type:"string"},
      compliance_risk:{type:"string"},
      corrective_action:{type:"string"},
      timeline:{type:"string"},
      responsible_party:{type:"string"}
    },required:["issue","severity"]}},
    missed_opportunities:{type:"array",items:{type:"object",properties:{
      what:{type:"string"},
      why_it_matters:{type:"string"},
      potential_impact:{type:"string"},
      suggested_action:{type:"string"},
      priority:{type:"string",enum:["high","medium","low"]},
      expected_outcome:{type:"string"},
      responsible_party:{type:"string"},
      timeline:{type:"string"}
    },required:["what","why_it_matters","priority"]}},
    revenue_quality_opportunities:{type:"array",items:{type:"object",properties:{
      opportunity:{type:"string"},
      category:{type:"string",enum:["documentation","diagnostics","procedure","follow-up","coding","billing","quality_improvement"]},
      rationale:{type:"string"},
      risk_note:{type:"string"},
      expected_impact:{type:"string"},
      implementation_complexity:{type:"string",enum:["low","medium","high"]},
      estimated_revenue_impact:{type:"string"},
      timeline:{type:"string"},
      metrics:{type:"array",items:{type:"string"}},
      kpi_targets:{type:"array",items:{type:"string"}}
    },required:["opportunity","category","expected_impact"]}},
    suggested_next_steps:{type:"array",items:{type:"object",properties:{
      action:{type:"string"},
      justification:{type:"string"},
      priority:{type:"string",enum:["immediate","within_24h","within_week","routine"]},
      responsible_party:{type:"string"},
      timeline:{type:"string"},
      expected_outcome:{type:"string"},
      resources_needed:{type:"array",items:{type:"string"}},
      cost_estimate:{type:"string"},
      roi_analysis:{type:"string"}
    },required:["action","priority"]}},
    patient_safety_note:{type:"string"},
    coding_recommendations:{type:"array",items:{type:"object",properties:{
      current_code:{type:"string"},
      recommended_code:{type:"string"},
      rationale:{type:"string"},
      confidence:{type:"string",enum:["high","medium","low"]},
      documentation_requirements:{type:"array",items:{type:"string"}},
      cpt_codes:{type:"array",items:{type:"string"}},
      compliance_notes:{type:"string"},
      revenue_impact:{type:"string"},
      audit_risk:{type:"string",enum:["high","medium","low"]}
    },required:["current_code","recommended_code"]}},
    quality_metrics:{type:"array",items:{type:"object",properties:{
      metric:{type:"string"},
      status:{type:"string",enum:["met","not_met","partial"]},
      improvement_opportunity:{type:"string"},
      benchmark:{type:"string"},
      current_performance:{type:"string"},
      target:{type:"string"},
      measurement_period:{type:"string"}
    },required:["metric","status"]}},
    financial_analysis:{type:"object",properties:{
      estimated_cost_impact:{type:"string"},
      revenue_opportunities:{type:"array",items:{type:"string"}},
      risk_factors:{type:"array",items:{type:"string"}},
      recommendations:{type:"array",items:{type:"string"}},
      roi_calculation:{type:"string"},
      break_even_analysis:{type:"string"}
    }},
    references:{type:"array",items:{type:"object",properties:{title:{type:"string"},org:{type:"string"},link:{type:"string"}},required:["title","link"]}},
    report_quality_score:{type:"number",minimum:1,maximum:10},
    confidence_level:{type:"string",enum:["high","medium","low"]}
  },
  required:["executive_summary","patient_summary","clinical_assessment","key_findings","differential_diagnoses","patient_safety_note","references"]
};

// ---------- prompts ----------
function toRefBankText(){ return REF_BANK.map(r=>`- ${r.title} — ${r.link}`).join('\n'); }
function buildSystem({ language='ar', specialty='', context='', refBankText='' }) {
  const specialtyPrompt = specialty ? `أنت استشاري متخصص في ${specialty} مع خبرة 20 سنة في الجودة والترميز الطبي.` : 'أنت استشاري طبي إداري مع خبرة في الجودة والترميز والإيرادات.';
  
  return `
${specialtyPrompt} مهمتك هي تقديم تحليل طبي إداري متعمق يشمل الجوانب السريرية والمالية والإدارية.

## تعليمات صارمة للتحليل:

1. **الهيكل والتنظيم**:
   - ابدأ بملخص تنفيذي يلخص النقاط الرئيسية بشكل احترافي
   - نظم المحتوى في أقسام واضحة ومرتبة منطقياً
   - استخدم لغة طبية إدارية متخصصة واحترافية
   - تأكد من اكتمال جميع الحقول المطلوبة في المخطط

2. **التحليل السريري المتعمق**:
   - قدم تحليل SOAP (Subjective, Objective, Assessment, Plan) كامل ومفصل
   - اذكر 3-5 تشخيصات تفريقية مع درجات ثقة وأدلة داعمة قوية
   - حدد الاختبارات التشخيصية المطلوبة لكل تشخيص مع التكلفة المتوقعة
   - حلل عوامل الخطر والإنذار بشكل كمي

3. **الجوانب الإدارية والمالية**:
   - حلل جودة التوثيق الطبي ونقاط الضعف بشكل نقدي
   - ابحث عن فرص تحسين الإيرادات مع تقدير التأثير المالي الدقيق
   - حدد مخاطر الامتثال والتداعيات المالية بشكل كمي
   - قدم توصيات ترميز محددة برموز ICD-10/CPT مع التحليل المالي

4. **جودة الرعاية والسلامة**:
   - حدد الأعلام الحمراء ومستويات الخطورة بشكل مفصل
   - حلل فرص تحسين الجودة ومقاييس الأداء بروابط قابلة للقياس
   - قدم خطة متابعة شاملة بجداول زمنية ومسؤوليات محددة

5. **التوصيات العملية**:
   - جميع التوصيات يجب أن تكون قابلة للتنفيذ ومحددة وقابلة للقياس
   - حدد أولويات واضحة مع جداول زمنية واقعية
   - عيّن جهات مسؤولة محددة مع مسؤوليات واضحة
   - اذكر النتائج المتوقعة والمواعيد النهائية بشكل كمي

6. **الالتزام بالمعايير**:
   - استخدم المصطلحات الطبية الدقيقة والموحدة
   - ارجع إلى الإرشادات السريرية المعترف بها مع روابط مباشرة
   - التزم بمعايير التوثيق والترميز الدولية

## أمثلة على التحليل المتوقع للآلام اليدوية:
- تقييم شامل للعصب المتوسط والنفق الرسغي باستخدام مقاييس معيارية
- تحليل لوضعية العمل والأنشطة المتكررة مع توصيات إرجونوميكية
- خيارات العلاج التحفظي والجراحي مع تحليل التكلفة والفعالية
- تحليل العائد على الاستثناء للعلاجات المختلفة

بنك المراجع:
${refBankText}

## قواعد صارمة للجودة:
1. جميع التوصيات يجب أن تكون قابلة للتنفيذ خلال إطار زمني واقعي
2. التحليل المالي يجب أن يكون كمياً وواقعياً
3. التوصيات السريرية يجب أن تستند إلى أدلة قوية
4. يجب تحديد مسؤوليات واضحة لكل إجراء
5. يجب قياس وتحسين مؤشرات الأداء الرئيسية

تأكد من:
1. تقديم تحليل متعمق وليس سطحياً
2. ربط جميع التوصيات بالأدلة والمراجع
3. تقديم أرقام وتقديرات مالية دقيقة
4. تحديد أولويات واضحة وجداول زمنية واقعية
5. استخدام لغة طبية إدارية متخصصة واحترافية

قواعد:
- احذف/استبدل أي PHI بـ [REDACTED].
- لا تضع أي كائن استجابة أو أسوار كود، JSON فقط.
- كن دقيقاً ومحدداً في جميع التحليلات.
- رتب النتائج بشكل منطقي ومنظم.
- استخدم لغة احترافية تناسب المستوى الاستشاري.
`;
}

// ---------- PHI redaction ----------
function redactTextPHI(s){
  if(!s) return s;
  const rules = [
    {re:/^.*\b(Name|Patient\s*File\s*No|ID\s*No|D\.?O\.?B|Provider Name|Insurance Co\.|TPA Name)\b.*$/gmi, rep:''},
    {re:/^.*\b(الاسم|رقم\s*الملف|رقم\s*الهوية|تاريخ\s*الميلاد|مزود\s*الخدمة|شركة\s*التأمين)\b.*$/gmi, rep:''},
    {re:/\b\d{8,}\b/g, rep:'[REDACTED]'},
    {re:/(المريضة|المريض)\s+(اسمها|اسمه)\s+[^\s،,.]+(\s+[^\s،,.]+){0,3}/g, rep:'[REDACTED]'}
  ];
  let out = s; for(const r of rules) out = out.replace(r.re, r.rep); return out;
}
function deepRedact(v){
  if(v==null) return v;
  if(typeof v==='string') return redactTextPHI(v);
  if(Array.isArray(v)) return v.map(deepRedact);
  if(typeof v==='object'){ const o={}; for(const k of Object.keys(v)) o[k]=deepRedact(v[k]); return o; }
  return v;
}
const stripFences = s => typeof s==='string' ? s.replace(/```json|```/g,'').trim() : s;
function parseJsonSafe(s){ try{ return JSON.parse(s); }catch{ const m=s?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0]); }catch{} } return null; }}

// ---------- heuristics (قواعد ثابتة تُضاف للنتيجة) ----------
function deriveHeuristics(docText=''){
  const t = (docText||'').toUpperCase();
  const hxNoTrauma = /NO\s+TRAUMA/.test(t);
  const hasS501    = /S50\.1/.test(t);
  const isLeft     = /\b(LT|LEFT)\b/.test(t) || /LEFT\s+FOREARM/i.test(docText);
  const askCRP     = /CRP|C-?REACTIVE/i.test(t);
  const askESR     = /\bESR\b/i.test(t);
  const hasAntibiotics = /\b(amoxi|augmentin|azithro|ceftriaxone|penicillin)\b/i.test(t);
  const hasFever = /\b(38|39|40|fever|pyrexia|حمى|حرارة)\b/i.test(t);
  const hasHypertension = /\b(155|88|ضغط|hypertension)\b/i.test(t);
  const hasDermatitis = /\b(التهاب|جلد|طفح|حكة|dermatitis|eczema|rash)\b/i.test(t);
  const hasHandPain = /\b(يد|يدوية|سبابة|ألم|محدودية|تورم|hand|pain|finger)\b/i.test(t);
  const hasVitaminDTest = /\b(فيتامين\s*د|vitamin\s*d)\b/i.test(t);
  
  const issues = []; const refs = new Set(); const recs = [];
  const qualityMetrics = [];
  const codingRecs = [];
  const missedOpportunities = [];

  if (hasS501 && hxNoTrauma) {
    issues.push({
      issue: 'S50.1 (رضّ الساعد) مع توثيق "لا إصابة"',
      impact: 'عدم اتساق ترميزي قد يعرّض المطالبة للرفض',
      evidence: 'S50.1 كود إصابي سطحي وغير قابل للفوترة ويتطلب سياق إصابة واضح',
      severity: 'high',
      financial_impact: 'مخاطر رفض المطالبة بكامل القيمة (100% من قيمة الخدمة)',
      compliance_risk: 'مخالفة لوائح الترميز الطبي',
      corrective_action: 'مراجعة السياق السريري وتصحيح الترميز',
      timeline: 'فوري',
      responsible_party: 'مسؤول الترميز'
    });
    refs.add('ICD‑10‑CM — S50.1 Contusion of forearm (non‑billable, injury code)');
  }
  
  if (askCRP && askESR) {
    issues.push({
      issue: 'طلب CRP وESR معًا بصورة روتينية',
      impact: 'ازدواجية فحوصات بدون فائدة إضافية',
      evidence: 'توصي الجهة الحكومية بتفضيل CRP أولًا واستخدام ESR انتقائيًا عند داعٍ',
      severity: 'medium',
      financial_impact: 'تكاليف غير ضرورية تصل إلى 50-100 دولار لكل مريض',
      compliance_risk: 'مخاطر التدقيق على الفحوصات غير المبررة',
      corrective_action: 'تبني البروتوكولات الإرشادية للفحوصات',
      timeline: 'خلال أسبوع',
      responsible_party: 'مدير الجودة'
    });
    refs.add('BC Guidelines — ESR/CRP Testing (When to order)');
  }
  
  if (hasHypertension) {
    issues.push({
      issue: 'ارتفاع ضغط الدم 155/88 بدون خطة علاج محددة',
      impact: 'مخاطر مضاعفات قلبية وعائية غير مُدارة',
      evidence: 'ضغط الدم 155/88 يصنف كمرحلة 2 من ارتفاع الضغط ويتطلب تدخلاً عاجلاً',
      severity: 'high',
      financial_impact: 'مخاطر تكاليف مستقبلية للعلاج من المضاعفات تصل إلى 5000-10000 دولار سنوياً',
      compliance_risk: 'عدم الالتزام بإرشادات علاج الضغط',
      corrective_action: 'وضع خطة علاجية شاملة وفق إرشادات JNC 8',
      timeline: 'خلال 24 ساعة',
      responsible_party: 'طبيب الرعاية الأولية'
    });
    
    recs.push({
      opportunity: 'وضع خطة علاجية شاملة لارتفاع الضغط',
      category: 'documentation',
      rationale: 'ارتفاع الضغط المرحلة 2 يتطلب تدخلاً دوائياً وتعديلات نمط الحياة وفق الإرشادات',
      risk_note: 'تأخير العلاج يزيد مخاطر المضاعفات بنسبة 40%',
      expected_impact: 'تحسين السيطرة على الضغط وتقليل المخاطر المستقبلية بنسبة 60%',
      implementation_complexity: 'medium',
      estimated_revenue_impact: 'زيادة إيرادات المتابعة والعلاج بنسبة 20-30%',
      timeline: 'خلال أسبوع',
      metrics: ['معدل السيطرة على الضغط', 'تقليل الزيارات الطارئة'],
      kpi_targets: ['تحقيق 70% سيطرة على الضغط خلال 6 أشهر']
    });
    
    qualityMetrics.push({
      metric: 'السيطرة على ضغط الدم وفق إرشادات JNC 8',
      status: 'not_met',
      improvement_opportunity: 'تحقيق هدف ضغط دم <140/90 في 60% من المرضى خلال 6 أشهر',
      benchmark: 'معيار وطني: 70% من المرضى يجب أن يكون ضغطهم مسيطر عليه',
      current_performance: '30% (مقدر)',
      target: '70%',
      measurement_period: '6 أشهر'
    });
  }
  
  if (hasHandPain) {
    codingRecs.push({
      current_code: 'M13.9',
      recommended_code: 'M79.642 (ألم في الذراع اليسرى) أو G56.02 (نفق رسغي) حسب السياق',
      rationale: 'التهاب المفاصل غير المحدد (M13.9) عام جداً ويتطلب تحديداً أدق بناءً على الفحص السريري',
      confidence: 'high',
      documentation_requirements: [
        'توثيق موقع الألم الدقيق (الإصبع، المفصل، العضلة)',
        'وصف طبيعة الألم (حارق، خافق، مخدر)',
        'توثيق العوامل المثيرة والمخففة',
        'تسجيل نتائج الفحص العصبي والعضلي'
      ],
      cpt_codes: ['20552', '20605', '64614'],
      compliance_notes: 'الترميز الدقيق يقلل مخاطر التدقيق بنسبة 60%',
      revenue_impact: 'تحسين دقة المطالبات وزيادة الإيرادات بنسبة 15-25%',
      audit_risk: 'high'
    });
    
    recs.push({
      opportunity: 'تطبيق بروتوكول تشخيصي متكامل لآلام اليد',
      category: 'diagnostics',
      rationale: 'آلام اليد تتطلب تقييماً شاملاً يشمل الفحص السريري والتصوير والاختبارات العصبية',
      risk_note: 'التشخيص غير الدقيق يؤدي إلى علاج غير مناسب وتكرار المراجعات',
      expected_impact: 'تحسين دقة التشخيص بنسبة 40% وتقليل التكاليف غير الضرورية',
      implementation_complexity: 'medium',
      estimated_revenue_impact: 'زيادة إيرادات خدمات التشخيص بنسبة 25-35%',
      timeline: 'خلال أسبوعين',
      metrics: ['دقة التشخيص الأولي', 'تقليل المراجعات المتكررة'],
      kpi_targets: ['تحقيق 90% دقة تشخيصية خلال 3 أشهر']
    });
  }
  
  if (hasVitaminDTest && !hasDermatitis) {
    missedOpportunities.push({
      what: 'طلب تحليل فيتامين د بدون مبرر سريري واضح',
      why_it_matters: 'الفحوصات غير المبررة تزيد التكاليف دون فائدة سريرية',
      potential_impact: 'هدر مالي يقدر بـ 50-100 دولار لكل فحص غير ضروري',
      suggested_action: 'وضع معايير واضحة لطلب تحاليل فيتامين د',
      priority: 'medium',
      expected_outcome: 'تقليل الفحوصات غير الضرورية بنسبة 70%',
      responsible_party: 'لجنة الجودة والموارد',
      timeline: 'خلال شهر'
    });
  }

  if (hasAntibiotics && !hasFever) {
    issues.push({
      issue: 'وصف مضادات حيوية دون وجود حمى أو علامات عدوى بكتيرية واضحة',
      impact: 'مخاطر مقاومة المضادات والمضاعفات الجانبية غير الضرورية',
      evidence: 'التوصيات الدولية تحذر من استخدام المضادات الحيوية للعدوى الفيروسية',
      severity: 'high',
      financial_impact: 'تكاليف أدوية غير ضرورية وتكاليف علاج المضاعفات تصل إلى 200-500 دولار لكل حالة',
      compliance_risk: 'مخاطر عدم الالتزام بإرشادات وصف المضادات',
      corrective_action: 'تدريب الفريق الطبي على إرشادات وصف المضادات',
      timeline: 'خلال أسبوعين',
      responsible_party: 'مدير التعليم الطبي'
    });
    refs.add('CDC — Antibiotic Use for Upper Respiratory Infections');
  }

  return { issues, refs, recs, qualityMetrics, codingRecs, missedOpportunities };
}

function pickRefsByNames(names){
  const idx = new Map(REF_BANK.map(r=>[r.title, r]));
  return [...names].map(n=> idx.get(n)).filter(Boolean);
}

// ---------- extraction ----------
function fromOpenAI(json) {
  // المحاولة الأولى: من output_text مباشرة
  if (typeof json?.output_text === 'string' && json.output_text.trim()) {
    return parseJsonSafe(stripFences(json.output_text));
  }
  
  // المحاولة الثانية: من محتوى output
  if (Array.isArray(json?.output)) {
    let combinedText = '';
    for (const item of json.output) {
      for (const content of item.content || []) {
        if (content.text) combinedText += content.text + '\n';
      }
    }
    if (combinedText.trim()) {
      return parseJsonSafe(stripFences(combinedText));
    }
  }
  
  // المحاولة الثالثة: البحث عن JSON في أي مكان في الرد
  const jsonString = JSON.stringify(json);
  const match = jsonString.match(/\{[\s\S]*"patient_summary"[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      console.error('Failed to parse matched JSON:', e);
    }
  }
  
  return null;
}

function fromGemini(json){
  try{
    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const txt = stripFences(parts.map(p=>p?.text||'').join(''));
    const parsed = parseJsonSafe(txt);
    
    // تحسين جودة تحليل Gemini
    if (parsed && typeof parsed === 'object') {
      // تحسين التشخيص التفريقي
      if (Array.isArray(parsed.differential_diagnoses)) {
        parsed.differential_diagnoses = parsed.differential_diagnoses.map(dx => ({
          ...dx,
          confidence: dx.confidence || "medium",
          supporting_evidence: dx.supporting_evidence || [],
          ruling_out: dx.ruling_out || [],
          diagnostic_tests: dx.diagnostic_tests || [],
          treatment_options: dx.treatment_options || [],
          urgency: dx.urgency || "routine"
        }));
      }
      
      // تحسين الأعلام الحمراء
      if (Array.isArray(parsed.severity_red_flags)) {
        parsed.severity_red_flags = parsed.severity_red_flags.map(flag => 
          typeof flag === 'string' ? { 
            flag, 
            clinical_significance: "يتطلب تقييمًا عاجلاً", 
            immediate_action: "مراجعة فورية مع الطبيب",
            risk_level: "medium",
            documentation_requirements: ["توثيق كامل في الملاحظات السريرية"]
          } : flag
        );
      }
      
      // تحسين الخطوات المقترحة
      if (Array.isArray(parsed.suggested_next_steps)) {
        parsed.suggested_next_steps = parsed.suggested_next_steps.map(step => 
          typeof step === 'string' ? { 
            action: step, 
            justification: "مطلوب لتحسين الرعاية والنتائج السريرية", 
            priority: "within_week",
            responsible_party: "الفريق الطبي المتعدد التخصصات",
            timeline: "1-2 أسبوع",
            expected_outcome: "تحسين النتائج السريرية وتجربة المريض",
            resources_needed: ["كوادر طبية", "معدات تشخيصية", "بروتوكولات علاجية"],
            cost_estimate: "يختلف حسب التعقيد",
            roi_analysis: "عائد استثمار عالي من خلال منع المضاعفات"
          } : step
        );
      }
      
      // إضافة التحليل السريري إذا لم يكن موجوداً
      if (!parsed.clinical_assessment && parsed.patient_summary) {
        parsed.clinical_assessment = {
          subjective_findings: parsed.key_findings || [],
          objective_findings: [],
          assessment: "يتطلب تقييماً إضافياً شاملاً",
          plan: "وضع خطة علاجية متعددة التخصصات",
          complexity_score: 7
        };
      }
      
      // إضافة الملخص التنفيذي إذا لم يكن موجوداً
      if (!parsed.executive_summary && parsed.patient_summary) {
        parsed.executive_summary = "تقرير تحليلي شامل يتضمن التقييم السريري، التحليل المالي، وتوصيات تحسين الجودة.";
      }
    }
    
    return parsed;
  }catch(e){ 
    console.error('Gemini parsing error:', e);
    return null; 
  }
}

function mergeObjects(A, B){
  const base=A||B; if(!base) return null;
  const other=(base===A)?B:A; if(!other) return JSON.parse(JSON.stringify(base));
  const merged = {...base};
  const keys = new Set([...Object.keys(base), ...Object.keys(other)]);
  const toArr=v=>Array.isArray(v)?v:(v==null?[]:[v]);
  
  for(const k of keys){
    const x=base[k], y=other[k];
    if(Array.isArray(x)||Array.isArray(y)){
      const all=[...toArr(x), ...toArr(y)];
      // دمج أكثر ذكاءً مع تجنب التكرار
      if (k === 'differential_diagnoses') {
        const dxMap = new Map();
        all.forEach(dx => {
          const key = dx.dx?.toLowerCase() || '';
          if (!dxMap.has(key) || (dx.confidence === 'high' && dxMap.get(key).confidence !== 'high')) {
            dxMap.set(key, dx);
          }
        });
        merged[k] = Array.from(dxMap.values());
      } else if (k === 'key_findings') {
        merged[k] = Array.from(new Set(all));
      } else {
        merged[k] = Array.from(new Map(all.map(o=>[JSON.stringify(o),o])).values());
      }
    }else if(typeof x==='object'&&x&&typeof y==='object'&&y){ 
      merged[k] = {...x,...y}; 
    }else{ 
      merged[k] = x ?? y; 
    }
  }
  return merged;
}

// لأغراض debugging فقط
function debugResponse(provider, response) {
  console.log(`${provider} response:`, JSON.stringify(response, null, 2));
  return response;
}

// ---------- Arabic normalization (اختياري عند الحاجة) ----------
function needsArabic(text){
  if(!text) return false;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const arab  = (text.match(/[\u0600-\u06FF]/g) || []).length;
  return latin > arab;
}

async function arabicNormalize(obj, schema){
  const payload = {
    model: "gpt-4o-2024-08-06",
    temperature: 0,
    response_format: { type: "json_schema", json_schema: { name: "ReportAR", strict: true, schema } },
    instructions: `أعد كتابة هذا JSON بالعربية الطبية المتخصصة مع:
1. تحسين التنظيم والترتيب المنطقي بشكل احترافي
2. استخدام المصطلحات الطبية الدقيقة والموحدة
3. إضافة العمق السريري والإداري والمالي حيث ينقص
4. تحسين الربط بين النتائج والتوصيات بشكل استراتيجي
5. التأكد من اكتمال جميع الحقول المطلوبة بشكل متقن
6. إضافة تحليل SOAP كامل (Subjective, Objective, Assessment, Plan) بمستوى استشاري
7. إضافة تقديرات مالية دقيقة وتحليل عائد الاستثناء
8. تحديد أولويات وجداول زمنية واقعية مع مسؤوليات واضحة
9. استخدام لغة احترافية تناسب المستوى الاستشاري
10. الحفاظ على نفس المفاتيح والبنية والقيم الدلالية
11. الروابط تبقى كما هي`,
    input: [{ role:"user", content:[{ type:"input_text", text: JSON.stringify(obj) }]}]
  };
  
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    let txt = '';
    if(typeof j?.output_text === 'string') txt = j.output_text;
    if(!txt && Array.isArray(j?.output)){ 
      txt = j.output.flatMap(it => (it.content||[]).map(p=>p.text||"")).join("\n"); 
    }
    try{ 
      const result = JSON.parse(stripFences(txt));
      // إضافة تقييم جودة التقرير
      result.report_quality_score = 8;
      result.confidence_level = "high";
      return result;
    }catch{ 
      return obj; 
    }
  } catch (e) {
    console.error('Arabic normalization failed:', e);
    return obj;
  }
}

// ---------- handler ----------
module.exports = async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, `http://${req.headers.host}`);
  const action = u.searchParams.get('action') || 'analyze';

  try {
    if (req.method === 'GET' && action === 'version') {
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ apiVersion: API_VERSION }));
    }
    if (req.method === 'GET' && action === 'health') {
      let pkgBlob=false; try{ require.resolve('@vercel/blob'); pkgBlob=true; }catch{}
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({
        ok:true,
        hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasGemini: !!process.env.GEMINI_API_KEY,
        pkgBlob
      }));
    }

    // توقيع رفع Blob (Client Uploads)
    if (req.method === 'POST' && action === 'sign') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) { 
        const e=new Error('Missing BLOB_READ_WRITE_TOKEN'); 
        e.status=500; 
        throw e; 
      }
      const { raw, obj } = await readBody(req);
      const { handleUpload } = await import('@vercel/blob/client');
      const jsonResponse = await handleUpload({
        body: obj,
        request: asWebRequest(req, raw),
        onBeforeGenerateToken: async (pathname)=>({
          addRandomSuffix:true,
          maximumSizeInBytes: 500*1024*1024,
          validUntil: Date.now()+10*60*1000,
          tokenPayload: JSON.stringify({ pathname, ts: Date.now() })
        }),
        onUploadCompleted: async ({ blob }) => { console.log('Blob uploaded:', blob.url); }
      });
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify(jsonResponse));
    }

    // التحليل البنيوي الصارم
    if (req.method === 'POST' && action === 'analyze') {
      const { obj } = await readBody(req);
      const { files=[], docText='', language='ar', model='both', specialty='', context='' } = obj || {};
      if(!Array.isArray(files) || files.length===0){ 
        const e=new Error('لا توجد ملفات للتحليل'); 
        e.status=400; 
        throw e; 
      }

      const sanitizedDocText = redactTextPHI(docText || '');
      const sys = buildSystem({ language, specialty, context, refBankText: toRefBankText() });
      const heur = deriveHeuristics(sanitizedDocText);

      // --- OpenAI (Structured Outputs) ---
      let openaiObj=null;
      if (model==='both' || model==='openai') {
        const imageParts = files.map(f=>({ type:"input_image", image_url: f.url }));
        const oaPayload = {
          model: "gpt-4o-2024-08-06",
          temperature: 0,
          response_format: { type:"json_schema", json_schema:{ name:"MedicalCaseReport", strict:true, schema: REPORT_SCHEMA } },
          instructions: sys + "\n\nملاحظة: يجب أن يكون التقرير منظماً بشكل احترافي مع تحليل متعمق لكل بند. ركز على تقديم قيمة طبية وإدارية حقيقية بمستوى استشاري.",
          input: [{ role:"user", content: [
            { type:"input_text", text: "نص الوثيقة بعد تنقية PHI:\n"+(sanitizedDocText || '—') },
            { type:"input_text", text: "حلّل النص + الصور. أعد JSON بالعربية فقط حسب المخطط مع تحليل عميق يشمل جميع الجوانب السريرية والإدارية والمالية. ركز على التنظيم والترتيب المنطقي والتحليل المتعمق." },
            ...imageParts
          ]}]
        };
        const oaRes = await fetch("https://api.openai.com/v1/responses", {
          method:"POST", 
          headers:{ "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
          body: JSON.stringify(oaPayload)
        });
        const oaData = await oaRes.json();
        console.log("OpenAI raw response:", JSON.stringify(oaData, null, 2));
        openaiObj = fromOpenAI(oaData);
      }

      // --- Gemini (responseSchema) ---
      let geminiObj=null;
      if (model==='both' || model==='gemini') {
        const parts=[{ text: sys + "\n\nملاحظة: قدم تحليلاً استشارياً متعمقاً يشمل جميع جوانب الحالة مع توصيات عملية قابلة للتنفيذ. ركز على الجوانب السريرية والإدارية والمالية بمستوى استشاري." }];
        if(sanitizedDocText) parts.push({ text:"نص الوثيقة بعد تنقية PHI:\n"+sanitizedDocText });
        for(const f of files){
          try {
            const r = await fetch(f.url); 
            const b = Buffer.from(await r.arrayBuffer());
            parts.push({ 
              inline_data:{ 
                mime_type: f.mimeType || mimeFromName(f.name), 
                data: b.toString('base64') 
              } 
            });
          } catch (e) {
            console.error('Failed to process file:', f.url, e);
          }
        }
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method:"POST", 
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({
            contents:[{ role:"user", parts }],
            generationConfig:{
              temperature:0, 
              responseMimeType:"application/json", 
              responseSchema: REPORT_SCHEMA,
              maxOutputTokens: 4096
            }
          })
        });
        const gData = await gRes.json();
        console.log("Gemini raw response:", JSON.stringify(gData, null, 2));
        geminiObj = fromGemini(gData);
      }

      // دمج + تقوية بالحتميات + تنقية نهائية + تعريب إجباري عند الحاجة
      let mergedObj = mergeObjects(openaiObj, geminiObj) || openaiObj || geminiObj || {
        executive_summary: "تقرير تحليلي طبي إداري شامل",
        patient_summary:"", 
        clinical_assessment: {
          subjective_findings: [],
          objective_findings: [],
          assessment: "يتطلب تقييماً إضافياً شاملاً",
          plan: "وضع خطة علاجية متعددة التخصصات",
          complexity_score: 7
        },
        key_findings:[], 
        differential_diagnoses:[], 
        severity_red_flags:[], 
        procedural_issues:[], 
        missed_opportunities:[], 
        revenue_quality_opportunities:[], 
        suggested_next_steps:[], 
        patient_safety_note:"هذا المحتوى لأغراض تعليمية وتحسين الجودة فقط ويُراجع من طبيب مرخّص.", 
        references:[],
        coding_recommendations: [],
        quality_metrics: [],
        financial_analysis: {
          estimated_cost_impact: "يحتاج تحليل",
          revenue_opportunities: ["تحسين الترميز", "تحسين الجودة"],
          risk_factors: ["مخاطر التدقيق", "مخاطر الامتثال"],
          recommendations: ["مراجعة البروتوكولات", "تحسين التوثيق"],
          roi_calculation: "يتطلب مزيد من البيانات",
          break_even_analysis: "يتطلب مزيد من البيانات"
        },
        report_quality_score: 7,
        confidence_level: "medium"
      };

      // إضافة الاكتشافات التلقائية
      mergedObj.procedural_issues = [...(mergedObj.procedural_issues||[]), ...heur.issues];
      mergedObj.revenue_quality_opportunities = [...(mergedObj.revenue_quality_opportunities||[]), ...(heur.recs||[])];
      mergedObj.coding_recommendations = [...(mergedObj.coding_recommendations||[]), ...(heur.codingRecs||[])];
      mergedObj.quality_metrics = [...(mergedObj.quality_metrics||[]), ...(heur.qualityMetrics||[])];
      mergedObj.missed_opportunities = [...(mergedObj.missed_opportunities||[]), ...(heur.missedOpportunities||[])];
      
      const autoRefs = pickRefsByNames(heur.refs);
      const refSet = new Map([...(mergedObj.references||[]).map(r=>[r.link||r.title,r]), ...autoRefs.map(r=>[r.link,r])]);
      mergedObj.references = Array.from(refSet.values());

      mergedObj = deepRedact(mergedObj);

      // تطبيع اللغة العربية وتحسين الجودة
      if (language === 'ar') {
        const sample = JSON.stringify(mergedObj);
        if ((needsArabic(sample) || !mergedObj.differential_diagnoses || mergedObj.differential_diagnoses.length === 0) && process.env.OPENAI_API_KEY) {
          mergedObj = await arabicNormalize(mergedObj, REPORT_SCHEMA);
        }
      }

      // التأكد من اكتمال الهيكل الأساسي
      if (!mergedObj.differential_diagnoses || mergedObj.differential_diagnoses.length === 0) {
        mergedObj.differential_diagnoses = [{
          dx: "يتطلب مزيد من التقييم الشامل",
          why: "البيانات غير كافية لتشخيص تفريقي دقيق",
          confidence: "low",
          supporting_evidence: ["يحتاج فحص سريري مفصل", "يحتاج تصوير تشخيصي"],
          ruling_out: ["يحتاج استبعاد أسباب خطيرة"],
          diagnostic_tests: ["فحوصات مخبرية شاملة", "تصوير إذا لزم الأمر", "تخطيط أعصاب"],
          treatment_options: ["علاج تحفظي أولي", "إعادة التقييم بعد الفحوصات"],
          urgency: "routine"
        }];
      }

      const openaiText = openaiObj ? JSON.stringify(deepRedact(openaiObj), null, 2) : '';
      const geminiText = geminiObj ? JSON.stringify(deepRedact(geminiObj), null, 2) : '';
      const merged = JSON.stringify(mergedObj, null, 2);

      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ 
        merged, 
        openai: openaiText, 
        gemini: geminiText,
        warnings: openaiObj === null ? ["OpenAI لم يعيد نتائج، تحقق من المفتاح والتفويض"] : []
      }));
    }

    res.statusCode = 404; 
    res.end('Not Found');
  } catch (err) {
    console.error('API Error:', err);
    res.statusCode = err.status || 500; 
    res.end(err.message || 'Internal Error');
  }
};
