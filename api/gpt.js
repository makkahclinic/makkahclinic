// /api/gpt.js

import OpenAI from "openai";

// Initialize the OpenAI client with the API key from environment variables
// تهيئة عميل OpenAI باستخدام مفتاح API من متغيرات البيئة
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // تأكد من إضافة هذا المتغير في Vercel
});

export default async function handler(req, res) {
  // Set CORS headers to allow cross-origin requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Ensure the request method is POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Destructure and validate the request body
  const { diagnosis, symptoms, age, gender, smoker, beforeProcedure, afterProcedure } = req.body;

  if (!diagnosis || !symptoms || !age || !gender || smoker === undefined || !beforeProcedure || !afterProcedure) {
    return res.status(400).json({ error: "الرجاء ملء جميع الحقول." });
  }

  // The prompt instructs the model to act as an expert and fill a JSON object.
  // The phrase "You must output a JSON object" is crucial for JSON mode.
  // التعليمات توجه النموذج للعمل كخبير وتعبئة كائن JSON.
  // عبارة "You must output a JSON object" ضرورية لتفعيل وضع JSON.
  const prompt = `
    You are an expert medical insurance consultant. Based on the following case data, you must output a JSON object that provides a detailed analysis.

    Case Data:
    - Diagnosis (ICD-10): ${diagnosis}
    - Symptoms: ${symptoms}
    - Age: ${age}
    - Gender: ${gender}
    - Smoker: ${smoker ? 'Yes' : 'No'}
    - Procedures before diagnosis: ${beforeProcedure}
    - Procedures after diagnosis: ${afterProcedure}

    Your tasks are to:
    1.  Analyze the case and explain potential medical reasons for the symptoms.
    2.  Evaluate each procedure for its justification.
    3.  Determine the insurance rejection risk.
    4.  Suggest additional tests or consultations that would increase clinic revenue, reduce insurance rejections, and improve patient care, referencing standards like ADA, UpToDate, WHO.
    5.  All monetary values must be in Saudi Riyal (SAR).
    6.  The output MUST be a valid JSON object matching the requested structure.
    `;

  try {
    const completion = await openai.chat.completions.create({
      // Using a model that supports JSON mode is recommended.
      model: "gpt-4-turbo",
      messages: [
        { 
          role: "system", 
          content: prompt 
        },
        {
          role: "user",
          content: "Based on the system prompt, generate the JSON analysis for the provided case data."
        }
      ],
      // This is the key change: enabling JSON mode
      // هذا هو التغيير الرئيسي: تفعيل وضع JSON
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const rawContent = completion.choices?.[0]?.message?.content;

    if (!rawContent) {
      throw new Error("The API returned an empty response.");
    }

    let payload;
    try {
      // The response from JSON mode is a guaranteed JSON string.
      // الرد من وضع JSON هو نص JSON مضمون.
      payload = JSON.parse(rawContent);
    } catch (err) {
      // This catch block is a fallback, but it's unlikely to be hit in JSON mode.
      // هذا الكود احتياطي، ومن غير المرجح أن يتم تفعيله في وضع JSON.
      console.error("Error parsing JSON from OpenAI:", err);
      return res.status(500).json({ 
          error: "Failed to parse the response from the AI.",
          rawResponse: rawContent 
      });
    }
    
    return res.status(200).json(payload);

  } catch (err) {
    console.error("❌ OpenAI API Error:", err);
    return res.status(500).json({
      error: "An error occurred while analyzing the case.",
      detail: err.message,
    });
  }
}
