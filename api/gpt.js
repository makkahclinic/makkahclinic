import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
  try {
    console.log("🚀 API started");

    const form = formidable();
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error("❌ Formidable error:", err);
        return res.status(500).json({ ok: false, error: "Formidable parse error" });
      }

      console.log("📦 Fields:", fields);
      console.log("📂 Files:", files);

      const caseText = fields.caseText?.[0] || "";
      let extractedText = caseText;
      let fileBuffer = null;
      let mimeType = null;

      if (files.file) {
        const filePath = files.file[0].filepath;
        mimeType = files.file[0].mimetype;

        console.log("📑 Uploaded file type:", mimeType);

        if (mimeType === "application/pdf") {
          // مؤقتًا نخلي الـ PDF نص فقط
          extractedText += "\n\n[PDF Uploaded - Parsing not yet implemented]";
        } else {
          fileBuffer = fs.readFileSync(filePath).toString("base64");
        }
      }

      // 🔑 تأكد من وجود المفاتيح
      if (!OPENAI_API_KEY) {
        console.error("❌ Missing OPENAI_API_KEY");
        return res.status(500).json({ ok: false, error: "Missing OPENAI_API_KEY" });
      }
      if (!GEMINI_API_KEY) {
        console.error("❌ Missing GEMINI_API_KEY");
        return res.status(500).json({ ok: false, error: "Missing GEMINI_API_KEY" });
      }

      // -------- OpenAI --------
      let openaiPayload = {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a medical consultant." },
          { role: "user", content: extractedText || "Analyze this medical case" },
        ],
      };

      if (fileBuffer && mimeType.startsWith("image/")) {
        openaiPayload.messages.push({
          role: "user",
          content: [
            { type: "text", text: "Analyze this image" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBuffer}` } },
          ],
        });
      }

      console.log("📡 Sending request to OpenAI...");
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openaiPayload),
      });

      const openaiData = await openaiRes.json();
      console.log("✅ OpenAI response received");

      // -------- Gemini --------
      let geminiPayload = {
        contents: [
          {
            role: "user",
            parts: [{ text: extractedText || "Analyze this medical case" }],
          },
        ],
      };

      if (fileBuffer && mimeType.startsWith("image/")) {
        geminiPayload.contents[0].parts.push({
          inlineData: { mimeType: mimeType, data: fileBuffer },
        });
      }

      console.log("📡 Sending request to Gemini...");
      const geminiRes = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=" +
          GEMINI_API_KEY,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiPayload),
        }
      );
      const geminiData = await geminiRes.json();
      console.log("✅ Gemini response received");

      res.status(200).json({
        ok: true,
        openai: openaiData,
        gemini: geminiData,
      });
    });
  } catch (error) {
    console.error("🔥 API ERROR:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
}
