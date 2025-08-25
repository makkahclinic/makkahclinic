// pages/api/audit-onecall.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o"; // يدعم الرؤية + structured outputs
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ok  = (res, json) => res.status(200).json({ ok: true,  ...json });
const bad = (res, code, msg) => res.status(code).json({ ok: false, error: msg });

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Only POST is accepted.");
    if (!OPENAI_API_KEY)       return bad(res, 500, "Missing OPENAI_API_KEY.");

    const { text = "", files = [], patientInfo = null, lang = "ar" } = req.body || {};
    const isArabic = lang !== "en";
    const caseId   = String(Date.now());

    // 1) نُحضّر محتوى الرسالة: نص + صور كـ data URL
    const content = [];
    const taskText = `
CASE_ID=${caseId}
أنت مدقق إكلينيكي خبير. حلّل الحالة مباشرة من الصور/النص وأخرج JSON مطابقًا للمخطط التالي:
- patientSummary.text
- diagnoses { primary, secondary[], certaintyNotes }
- risksAndConflicts { redFlags[], guidelineOmissions[], drugDrugConflicts[], doseOrDurationErrors[], notMedicallyNecessary[] }
- table[]: { name, dosage_written, itemType: "lab|medication|procedure|omission", status, analysisCategory, insuranceDecision {label, justification} }
- recommendations[]: { priority: "عاجلة|أفضل ممارسة" أو "Urgent|Best practice", description, relatedItems[] }
قواعد إلزامية:
1) املأ الجرعة كما كُتبت حرفيًا إن وُثِّقت، وإلا اكتب "—" ولا تخمّن.
2) عدّل اللغة تلقائيًا (${isArabic ? "Arabic" : "English"}) بجمل مهنية موجزة.
3) أدرج الإغفالات الحرجة كصفوف itemType="omission".
`.trim();

    content.push({ type: "text", text: taskText });
    if (text) content.push({ type: "text", text });

    for (const f of files || []) {
      const mime = f?.mimeType || "";
      const base64 = (f?.data || "").includes("base64,")
        ? f.data.split("base64,").pop()
        : (f?.data || "");
      if (mime.startsWith("image/") && base64) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` }
        });
      } else if (f?.name) {
        // ملاحظة: البدل لـ PDF/ملفات غير صور — يمكن لاحقًا تحويل PDF لصور قبل الإرسال
        content.push({ type: "text", text: `Attached (not previewed): ${f.name}` });
      }
    }

    // 2) Structured Outputs: JSON Schema صارم
    const response_format = {
      type: "json_schema",
      json_schema: {
        name: "clinical_audit",
        strict: true,
        schema: {
          type: "object",
          properties: {
            meta: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
            patientSummary: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
            diagnoses: {
              type: "object",
              properties: {
                primary: { type: "string" },
                secondary: { type: "array", items: { type: "string" } },
                certaintyNotes: { type: "string" }
              },
              required: ["primary"]
            },
            risksAndConflicts: {
              type: "object",
              properties: {
                redFlags: { type: "array", items: { type: "string" } },
                guidelineOmissions: { type: "array", items: { type: "string" } },
                drugDrugConflicts: { type: "array", items: { type: "string" } },
                doseOrDurationErrors: { type: "array", items: { type: "string" } },
                notMedicallyNecessary: { type: "array", items: { type: "string" } }
              }
            },
            table: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  dosage_written: { type: "string" },
                  itemType: { type: "string", enum: ["lab","medication","procedure","omission"] },
                  status: { type: "string" },
                  analysisCategory: { type: "string" },
                  insuranceDecision: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      justification: { type: "string" }
                    }
                  }
                },
                required: ["name","itemType"]
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string" },
                  description: { type: "string" },
                  relatedItems: { type: "array", items: { type: "string" } }
                },
                required: ["priority","description"]
              }
            }
          },
          required: ["meta","patientSummary","diagnoses","table"]
        }
      }
    };

    // 3) استدعاء OpenAI برؤية + مخطط صارم + حرارة صفر
    const r = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format,
        messages: [
          { role: "system", content: isArabic
              ? "أنت مدقق إكلينيكي أدلّي، التزم بالمخطط فقط، ولا تُخرج سوى JSON."
              : "You are an evidence-based clinical auditor. Output JSON only per schema." },
          { role: "user", content }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) return bad(res, r.status, `OpenAI error: ${JSON.stringify(data)}`);

    // 4) نتيجة منظمة جاهزة للاستهلاك
    const structured = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
    return ok(res, { structured, caseId });
  } catch (err) {
    console.error(err);
    return bad(res, 500, `Internal error: ${err.message || "unknown"}`);
  }
}
