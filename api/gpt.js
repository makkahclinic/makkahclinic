// api/gpt.js — Vercel Serverless Function (CommonJS, Node 18+)
// === v4.4.0 ===

const API_VERSION = 'v4.4.0';

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
  {title:'ICD-10-CM Official Guidelines for Coding and Reporting', org:'CDC', link:'https://www.cdc.gov/nchs/icd/icd-10-cm.htm'},
  {title:'American College of Rheumatology — Guidelines', org:'ACR', link:'https://www.rheumatology.org/Practice-Quality/Clinical-Support/Clinical-Practice-Guidelines'},
  {title:'National Institute for Health and Care Excellence — Rheumatology Guidelines', org:'NICE', link:'https://www.nice.org.uk/guidance/conditions-and-diseases/musculoskeletal-conditions/rheumatology'}
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
    confidence_level:{type:"string",enum:["high","medium","low"]},
    data_quality_issues:{type:"array",items:{type:"object",properties:{
      issue:{type:"string"},
      impact:{type:"string"},
      recommendation:{type:"string"}
    }}}
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
   - ارجع إلى الإرشادات السريرية مع روابط مباشرة
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

## تعليمات خاصة بجودة البيانات:
إذا كانت البيانات غير كافية لتقديم تحليل مفصل:
1. صف مشكلة جودة البيانات بوضوح
2. قدم توصيات محددة لتحسين جمع البيانات
3. حدد أنواع الفحوصات والاختبارات المطلوبة
4. اقترح تحسينات في عملية التوثيق الطبي

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
function parseJsonSafe(s){ try{ return JSON.parse(s); }catch{ const m=s?.match?.(/\{[\s\S]*\}/); if(m){ try{ return JSON.parse(m[0); }catch{} } return null; }}

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
  const hasLimitedData = docText.length < 100; // إذا كانت البيانات قليلة
  
  const issues = []; const refs = new Set(); const recs = [];
  const qualityMetrics = [];
  const codingRecs = [];
  const missedOpportunities = [];
  const dataQualityIssues = [];

  if (hasLimitedData) {
    dataQualityIssues.push({
      issue: 'البيانات السريرية غير كافية',
      impact: 'عدم القدرة على تقديم تحليل سريري مفصل',
      recommendation: 'تحسين عملية جمع البيانات السريرية وتوثيقها'
    });
    
    missedOpportunities.push({
      what: 'توثيق سريري غير كاف',
      why_it_matters: 'يحد من جودة الرعاية والقدرة على التحليل',
      potential_impact: 'تأثير سلبي على جودة الرعاية والنتائج المالية',
      suggested_action: 'تنفيذ نظام توثيق سريري شامل',
      priority: 'high',
      expected_outcome: 'تحسين جودة البيانات بنسبة 70% خلال 3 أشهر',
      responsible_party: 'مدير الجودة والطبيب المسؤول',
      timeline: 'خلال شهر'
    });
  }

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
      financial_impact: 'مخاطر تكاليف مستقبلية لل
