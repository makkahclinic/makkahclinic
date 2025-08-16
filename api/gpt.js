// pages/api/gpt.js
// الإصدار النهائي المستقر - يعتمد على توليد HTML بسيط في الباك إند وتطبيق التنسيق في الفرونت إند

import { createHash } from "crypto";

// دوال المساعدة (Utils) - لا تحتاج لتعديلها
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
async function fetchWithRetry(url, options, { retries = 3, timeoutMs = 180000 } = {}) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const res = await fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(t));
        if (!res.ok && retries > 0 && [429, 500, 502, 503, 504].includes(res.status)) {
            await sleep((4 - retries) * 1000);
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        return res;
    } catch (err) {
        if (retries > 0) {
            await sleep((4 - retries) * 1000);
            return fetchWithRetry(url, options, { retries: retries - 1, timeoutMs });
        }
        throw err;
    }
}
function detectMimeFromB64(b64 = "") {
    const h = (b64 || "").slice(0, 24);
    if (h.includes("JVBERi0")) return "application/pdf";
    if (h.includes("iVBORw0")) return "image/png";
    if (h.includes("/9j/")) return "image/jpeg";
    return "application/octet-stream";
}
async function ocrWithOpenAI(openaiKey, files) {
    // ... (منطق OCR يبقى كما هو إذا كنت تستخدمه)
    return "";
}
async function geminiUpload(apiKey, base64Data, mime) {
    const buf = Buffer.from(base64Data, "base64");
    const res = await fetchWithRetry(`https://generativelenguage.googleapis.com/v1beta/files?key=${apiKey}`, { method: "POST", headers: { "Content-Type": mime }, body: buf });
    if (!res.ok) throw new Error(`Gemini upload failed: ${await res.text()}`);
    const j = await res.json();
    return j?.file?.uri;
}
// ----------------------------------------------------------------------------------

// الأمر الرئيسي (System Prompt) - نسخة موجزة ومستقرة
const systemInstruction = `
أنت خبير تدقيق طبي، مهمتك إنشاء تقرير بصيغة HTML بسيطة ومنظمة.
يجب أن يحتوي التقرير على الأقسام التالية بالترتيب:
1.  \`<h4>ملخص الحالة</h4>\` مع فقرة \`<p>\`.
2.  \`<h4>تحليل الملفات المرفوعة</h4>\` مع فقرة \`<p>\`.
3.  \`<h4>التحليل السريري العميق</h4>\` مع فقرة \`<p>\`.
4.  \`<h4>جدول الأدوية والإجراءات</h4>\` مع جدول \`<table>\` يحتوي على الأعمدة: "بند الخدمة" و "قرار التأمين".
    - لكل خدمة، أنشئ صف \`<tr>\` واحد.
    - لقرار التأمين، استخدم \`<span>\` مع الكلاس المناسب ('status-green', 'status-yellow', 'status-red') واذكر السبب بوضوح للحالات الصفراء والحمراء.
5.  \`<h4>التحليل التفصيلي والتوصيات</h4>\` وبداخله العناوين الفرعية \`<h5>\` المرقمة (1. خدمات طبية ضرورية... إلخ) مع فقرة \`<p>\` لكل منها.
    - يجب أن يكون تحليلك عميقاً ومدعوماً بالأدلة كما تدربنا.
6.  \`<h5>5. الخاتمة والتوصيات النهائية</h5>\` مع فقرة \`<p>\`.
7.  فقرة أخيرة تحتوي على التنويه القانوني.

التزم بهذا الهيكل البسيط والنظيف. لا تقم بإضافة أي تنسيقات CSS أو \`<style>\` أو \`<html>\` أو \`<body>\`.
`;

// دالة توليد المحتوى من Gemini
async function geminiGenerate(apiKey, parts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ role: "user", parts }],
        systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
        generationConfig: { temperature: 0.2, topP: 0.95, maxOutputTokens: 8192 }
    };
    const res = await fetchWithRetry(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const raw = await res.text();
    if (!res.ok) throw new Error(`Gemini API Error (${res.status}): ${raw}`);
    const j = JSON.parse(raw);
    return (j?.candidates?.[0]?.content?.parts?.[0]?.text || "").replace(/```(html)?/g, "").trim();
}

// المعالج الرئيسي للطلب (API Handler)
export default async function handler(req, res) {
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) throw new Error("GEMINI_API_KEY is not configured on the server.");

        const openaiKey = process.env.OPENAI_API_KEY || null;
        const body = req.body || {};
        const files = Array.isArray(body.files) ? body.files : [];

        // 1. OCR (اختياري)
        const ocrText = openaiKey ? await ocrWithOpenAI(openaiKey, files) : "";

        // 2. تجهيز الملفات لـ Gemini
        const filePartsPromises = files.map(async (f) => {
            try {
                const base64 = f?.data || "";
                if (!base64) return null;
                const mime = f.type || detectMimeFromB64(base64);
                const uri = await geminiUpload(geminiKey, base64, mime);
                return uri ? { fileData: { mimeType: mime, fileUri: uri } } : null;
            } catch (e) {
                console.warn(`File processing failed:`, e.message);
                return null;
            }
        });
        const processedFileParts = (await Promise.all(filePartsPromises)).filter(Boolean);

        // 3. بناء prompt المستخدم
        const userPrompt = `
        **Patient Data:**
        - Age: ${body.age || 'Not specified'}
        - Gender: ${body.gender || 'Not specified'}
        - Notes: ${body.notes || 'None'}
        - Problems: ${Array.isArray(body.problems) ? body.problems.join(", ") : "None"}

        **OCR Text from Files:**
        ${ocrText || "No OCR text available."}

        Please analyze this case based on these inputs.
        `;
        const parts = [{ text: userPrompt }, ...processedFileParts];

        // 4. توليد التقرير
        const htmlReport = await geminiGenerate(geminiKey, parts);

        // 5. إرسال التقرير النهائي
        return res.status(200).json({
            ok: true,
            at: nowIso(),
            htmlReport: htmlReport,
        });

    } catch (err) {
        console.error("--- SERVER ERROR ---", err);
        return res.status(500).json({
            ok: false,
            error: "An internal server error occurred.",
            detail: err.message, // إرسال رسالة الخطأ للمساعدة في التصحيح
        });
    }
}

export const config = {
    api: { bodyParser: { sizeLimit: "12mb" } },
};
