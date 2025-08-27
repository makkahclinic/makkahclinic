import formidable from "formidable";
import fs from "fs";

export const config = { api: { bodyParser: false } };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
  try {
    const form = formidable();
    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ ok: false, error: err.message });

      const caseText = fields.caseText?.[0] || "";
      let imageBuffer = null;

      if (files.file) {
        const imagePath = files.file[0].filepath;
        imageBuffer = fs.readFileSync(imagePath).toString("base64");
      }

      // -------- OpenAI --------
      let openaiPayload = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a medical consultant analyzing patient insurance cases.",
          },
          {
            role: "user",
            content: caseText
              ? [{ type: "text", text: caseText }]
              : [{ type: "text", text: "Analyze this medical case from image" }],
          },
        ],
      };

      if (imageBuffer) {
        openaiPayload.messages[1].content.push({
          type: "image_url",
          image_url: { url: `data:image/jpeg;base64,${imageBuffer}` },
        });
      }

      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(openaiPayload),
      });
      const openaiData = await openaiRes.json();

      // -------- Gemini --------
      let geminiPayload = {
        contents: [
          {
            role: "user",
            parts: [{ text: caseText || "Analyze this medical case from image" }],
          },
        ],
      };

      if (imageBuffer) {
        geminiPayload.contents[0].parts.push({
          inlineData: { mimeType: "image/jpeg", data: imageBuffer },
        });
      }

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

      res.status(200).json({
        ok: true,
        openai: openaiData,
        gemini: geminiData,
      });
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}
