// pages/api/rx-genius.js
// Node 20+
// npm i @google/genai

import {
  GoogleGenAI,
  createPartFromBase64,
  createPartFromUri,
} from "@google/genai";

export const config = { api: { bodyParser: { sizeLimit: "25mb" } } };

// ======== إعدادات عامة ========
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); // SDK الرسمي @google/genai
const MODELS = { EXTRACT: "gemini-2.5-flash", ANALYZE: "gemini-2.5-pro" };
const MAX_INLINE_BYTES = 4 * 1024 * 1024; // 4MB

// ======== CSS المطلوب داخل <style> (كما طلبت) ========
const REPORT_CSS = `
<style>
    .report-container { direction: rtl; font-family: 'Amiri', serif; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
    .report-title { font-size: 24px; font-weight: 700; color: #1e40af; margin-bottom: 12px; border-bottom: 2px solid #60a5fa; padding-bottom: 8px; }
    .report-subtitle { font-size: 18px; font-weight: 600; color: #1d4ed8; margin-top: 20px; margin-bottom: 10px; }
    .patient-summary p { font-size: 16px; line-height: 1.6; margin: 4px 0; }
    .meds-table { width: 100%; border-collapse: separate; border-spacing: 0 10px; margin-top: 10px; }
    .meds-table th { text-align: right; padding: 12px 15px; color: #374151; background-color: #f3f4f6; border-bottom: 2px solid #e5e7eb; font-size: 14px; }
    .meds-table td { text-align: right; padding: 14px 15px; background: #fff; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); font-size: 15px; vertical-align: middle; }
    .dose-cell { font-weight: 600; color: #1e40af; background-color: #eff6ff; }
    .interaction-badge { display: inline-block; width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; color: white; font-weight: 700; font-size: 12px; margin: 2px; }
    .interaction-badge.high { background-color: #ef4444; }
    .interaction-badge.moderate { background-color: #f97316; }
    .interaction-badge.low { background-color: #22c55e; }
    .interaction-badge.info { background-color: #3b82f6; }
    .findings-list { list-style-type: none; padding-right: 0; }
    .findings-list li { background: #fff; border-right: 5px solid; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.06); padding: 14px; margin-bottom: 12px; }
    .findings-list li[data-severity="high"] { border-color: #ef4444; }
    .findings-list li[data-severity="moderate"] { border-color: #f97316; }
    .findings-list li[data-severity="low"] { border-color: #22c55e; }
    .findings-list li[data-severity="info"] { border-color: #3b82f6; }
    .finding-title { font-size: 16px; font-weight: 700; }
    .finding-description { font-size: 15px; line-height: 1.7; color: #4b5563; margin-top: 8px; }
    .recommendations ol { padding-right: 20px; }
    .recommendations li { font-size: 15px; line-height: 1.8; margin-bottom: 8px; }
    .disclaimer { margin-top: 20px; font-size: 12px; text-align: center; color: #6b7280; }
</style>
`.trim();

// ======== System Instruction الموحَّدة ========
const SYSTEM_INSTRUCTION = `
أنت "صيدلي إكلينيكي خبير" ومستشار في تصميم واجهات المعلومات الطبية. مهمتك تحليل بيانات المريض (نصوص/صور) وإنشاء تقرير HTML تفاعلي وأنيق.
[أ] التحليل: استخرج قائمة الأدوية والجرعات والتعليمات؛ قيّم التداخلات؛ التعارض مع حالة المريض (العمر/الحمل/eGFR/الكبد)؛ ملاحظات مهمة (طعام، ازدواجية علاجية، جرعات).
[ب] الربط البصري إلزامي: لكل ملاحظة مرقمة ضع شارة بنفس الرقم في صفوف الأدوية المعنية (interaction-badge high/moderate/low/info).
[ج] بنية الإخراج: ابدأ دائمًا بـ <style> (CSS أعلاه)، ثم:
<div class="report-container">
  <h3 class="report-title">تحليل الوصفة الطبية الشامل</h3>
  <div class="patient-summary"><h4 class="report-subtitle">ملخص حالة المريض</h4>...</div>
  <div><h4 class="report-subtitle">جدول الأدوية والتحليل المبدئي</h4>
    <table class="meds-table"><thead><tr>
      <th>الدواء</th><th>الجرعة</th><th>طريقة الأخذ</th><th>التداخلات الدوائية</th><th>التعارض مع الحالة</th>
    </tr></thead><tbody></tbody></table></div>
  <div><h4 class="report-subtitle">تفاصيل التحليل السريري والملاحظات</h4><ol class="findings-list"></ol></div>
  <div class="recommendations"><h4 class="report-subtitle">خطة العمل والتوصيات</h4><ol></ol></div>
  <p class="disclaimer"><strong>إخلاء مسؤولية:</strong> هذا التقرير للمساعدة المعلوماتية فقط ولا يغني عن الاستشارة الطبية.</p>
</div>
[د] عمود الجرعة: ضع class "dose-cell".
[هـ] الإخراج النهائي: كتلة HTML واحدة فقط تبدأ بـ <style>.
`.trim();

// ======== JSON Schema للاستخراج المنظّم ========
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          strength: { type: "string" },
          frequency: { type: "string" },
          route: { type: "string" },
        },
        required: ["name"],
      },
    },
    diagnoses: { type: "array", items: { type: "string" } },
  },
  required: ["medications"],
};

// ======== أدوات مساعدة ========
function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) return null;
  const mimeType = m[1];
  const base64 = m[2];
  const approxBytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  return { mimeType, base64, sizeBytes: approxBytes };
}

async function buildFilePartsFromImages(images = []) {
  const parts = [];
  for (const url of images) {
    if (typeof url !== "string" || !url.startsWith("data:")) continue;
    const parsed = parseDataUrl(url);
    if (!parsed) continue;

    // جرّب Files API للملفات الكبيرة
    if (parsed.sizeBytes > MAX_INLINE_BYTES) {
      try {
        const blob = new Blob([Buffer.from(parsed.base64, "base64")], { type: parsed.mimeType });
        const file = await ai.files.upload({ file: blob, config: { mimeType: parsed.mimeType } });
        parts.push(createPartFromUri(file.uri, file.mimeType));
        continue;
      } catch (e) {
        // Vertex AI لا يدعم upload — جرّب inline إذا الحجم يسمح
        if (parsed.sizeBytes > MAX_INLINE_BYTES) {
          throw new Error("الملف كبير جدًا. فعّل Files API (AI Studio) أو قلّل الحجم ≤ 4MB.");
        }
      }
    }
    parts.push(createPartFromBase64(parsed.base64, parsed.mimeType));
  }
  return parts;
}

function stripCodeFences(s = "") {
  return (s || "").replace(/```html|```/g, "").trim();
}

function buildExtractionPrompt(patient = {}, texts = []) {
  return [
    "أنت خبير OCR. أعد JSON فقط وفق المخطط (medications, diagnoses).",
    "**نصوص/ملاحظات مرفقة:**",
    texts.join("\n").slice(0, 20000),
  ].join("\n");
}

function buildAnalysisPrompt(patient = {}, extracted = {}, preFlags = []) {
  return [
    `**بيانات المريض:**`,
    `- العمر: ${patient?.age ?? "غير محدد"}`,
    `- الجنس: ${patient?.sex ?? "غير محدد"}`,
    `- وظائف الكلى (eGFR): ${patient?.eGFR ?? "غير محدد"}`,
    `- الحمل: ${patient?.pregnancy?.pregnant ? `نعم${patient?.pregnancy?.weeks ? `، ${patient.pregnancy.weeks} أسابيع` : ""}` : "لا"}`,
    `- حالة الكبد: ${patient?.liverDisease ? "يوجد مرض كبدي" : "طبيعي"}`,
    "",
    `**البيانات المستخرجة (JSON):**`,
    JSON.stringify(extracted || {}, null, 2),
    "",
    `**تنبيهات قبلية (preFlags):**`,
    JSON.stringify(preFlags || [], null, 2),
  ].join("\n");
}

// تنبيهات قبلية بسيطة كمثال — يمكنك توسيعها لاحقًا
function computePreFlags(patient = {}, meds = []) {
  const names = new Set((meds || []).map((m) => (m.name || "").toLowerCase()));
  const flags = [];
  if (names.has("sildenafil") && (names.has("isosorbide mononitrate") || names.has("nitroglycerin"))) {
    flags.push({
      severity: "high",
      title: "تداخل خطر: PDE5 + Nitrate",
      medsInvolved: ["sildenafil", "nitrate"],
      description: "قد يسبب هبوط ضغط شديد.",
    });
  }
  return flags.map((f, i) => ({ id: i + 1, ...f }));
}

// ======== المعالج الرئيسي ========
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });

  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set.");

    const { texts = [], images = [], patient = {} } = req.body || {};

    // 1) تجهيز أجزاء الملفات
    const fileParts = await buildFilePartsFromImages(images);

    // 2) استخراج منظّم بصيغة JSON (JSON Mode)
    const extractResp = await ai.models.generateContent({
      model: MODELS.EXTRACT,
      contents: [buildExtractionPrompt(patient, texts), ...fileParts],
      config: {
        responseMimeType: "application/json",
        responseSchema: EXTRACTION_SCHEMA,
        temperature: 0.1,
      },
    });

    let extracted = { medications: [], diagnoses: [] };
    try {
      extracted = JSON.parse(extractResp.text || "{}");
    } catch {
      // يظلّ افتراضيًا
    }
    if (!Array.isArray(extracted.medications)) extracted.medications = [];
    if (!Array.isArray(extracted.diagnoses)) extracted.diagnoses = [];

    // 2.5) تنبيهات قبلية
    const preFlags = computePreFlags(patient, extracted.medications);

    // 3) التحليل وإنتاج HTML
    const analyzeResp = await ai.models.generateContent({
      model: MODELS.ANALYZE,
      contents: [buildAnalysisPrompt(patient, extracted, preFlags), ...fileParts],
      config: {
        systemInstruction: `${REPORT_CSS}\n${SYSTEM_INSTRUCTION}`,
        maxOutputTokens: 8192,
        temperature: 0.2,
      },
    });

    let html = stripCodeFences(analyzeResp.text || "");
    if (!/^<style>/i.test(html)) html = `${REPORT_CSS}\n${html}`;

    return res.status(200).json({ ok: true, html, extracted, preFlags });
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({
      ok: false,
      error: "Internal Server Error",
      message: err?.message || "Unknown error",
    });
  }
}
