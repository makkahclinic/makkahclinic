// pages/api/gpt.js
export const config = { api: { bodyParser: { sizeLimit: "50mb" } } };

/**
 * .env.local
 * ----------
 * OPENAI_API_KEY=sk-********************************
 * OPENAI_MODEL=gpt-4o
 * ALLOW_ORIGIN=https://m2020m.org    // غيّرها لنطاقك أو اتركها فارغة لتعطيل CORS
 */

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL   = process.env.OPENAI_MODEL || "gpt-4o";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || "";

/* ------------------------- Helpers ------------------------- */
function withCors(res) {
  if (ALLOW_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}
const ok  = (res, json) => { withCors(res); return res.status(200).json({ ok: true, ...json }); };
const bad = (res, code, msg) => { withCors(res); return res.status(code).json({ ok: false, error: msg }); };

async function parseJsonSafe(r) {
  const ct = r.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) return await r.json();
    const raw = await r.text();
    return { raw };
  } catch (e) {
    return { error: "parse_error", details: String(e) };
  }
}
const uniq = (arr = []) => Array.from(new Set(arr.filter(Boolean)));

/* ------------------------- Evidence DB (روابط رسمية) ------------------------- */
const EVIDENCE_DB = {
  blepharitis_first_line: {
    summary: "AAO PPP/StatPearls: نظافة الجفن والكمادات الدافئة نهج أولي؛ المضادات الموضعية لحالات مختارة.",
    urls: [
      "https://www.aao.org/Assets/92ce1735-7c83-45f0-8a58-72997bfc2375/638442007744570000/blepharitis-ppp-2-22-24-pdf",
      "https://www.ncbi.nlm.nih.gov/books/NBK459305/"
    ]
  },
  moxi_indication_conjunctivitis: {
    summary: "ملصق DailyMed: VIGAMOX® لعلاج التهاب الملتحمة الجرثومي.",
    urls: [
      // أحدث ملف ملصق متاح على DailyMed
      "https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?setid=12053b08-7e66-c6f3-e063-6394a90a9cd9&type=pdf"
    ]
  },
  dry_eye_guidance: {
    summary: "TFOS DEWS II/AAO PPP: المزلقات والتثقيف والتعديل البيئي خطوات مبكرة.",
    urls: [
      "https://www.aaojournal.org/article/S0161-6420%2824%2900012-5/pdf",
      "https://www.tearfilm.org/public/TFOSDEWSII-Executive.pdf"
    ]
  },
  refraction_policy_note: {
    summary: "CPT 92015 غالبًا غير مغطى كخدمة روتينية (مثال Medicare؛ يختلف حسب الدافع).",
    urls: [
      "https://palmettogba.com/rr/did/8eem5f7311",
      "https://www.aao.org/eyenet/article/back-to-basics-coding-for-refractions"
    ]
  },
  ada_diabetic_eye_exam: {
    summary: "ADA 2024: فحص عيني موسع مبدئيًا وسنويًا لمرضى السكري (وفق النتائج).",
    urls: [
      "https://diabetesjournals.org/care/article/47/Supplement_1/S231/153941/12-Retinopathy-Neuropathy-and-Foot-Care-Standards"
    ]
  }
};

/* ------------------------- JSON Schemas ------------------------- */
function extractionSchema(lang = "ar") {
  return {
    name: "clinical_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        meta: { type: "object", properties: { lang: { type: "string" } } },
        patient: {
          type: "object",
          properties: {
            name: { type: "string" }, age: { type: "string" }, gender: { type: "string" }
          }
        },
        diagnoses: { type: "array", items: { type: "string" } },
        symptoms:  { type: "array", items: { type: "string" } },
        signs:     { type: "array", items: { type: "string" } },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              itemType: { type: "string", enum: ["medication","procedure","lab","other"] },
              dosage_written:   { type: "string" },
              quantity_written: { type: "string" },
              notes:            { type: "string" }
            },
            required: ["name","itemType"]
          }
        }
      },
      required: ["diagnoses","items"]
    }
  };
}

function auditSchema(lang = "ar") {
  return {
    name: "clinical_audit",
    strict: true,
    schema: {
      type: "object",
      properties: {
        meta: { type: "object", properties: { caseId: { type: "string" }, lang: { type: "string" } }, required: ["caseId"] },
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
                properties: { label: { type: "string" }, justification: { type: "string" } }
              },
              citations: { type: "array", items: { type: "string" } }
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
              relatedItems: { type: "array", items: { type: "string" } },
              citations: { type: "array", items: { type: "string" } }
            },
            required: ["priority","description"]
          }
        }
      },
      required: ["meta","patientSummary","diagnoses","table"]
    }
  };
}

/* ----------------*
