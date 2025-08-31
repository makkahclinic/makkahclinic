import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

// Vercel specific configuration for formidable
export const config = {
    api: {
        bodyParser: false,
    },
};

// --- Helper Function to parse the form ---
async function parseForm(req) {
    return new Promise((resolve, reject) => {
        const form = formidable({});
        form.parse(req, (err, fields, files) => {
            if (err) {
                reject(err);
                return;
            }
            // In Vercel, the file object might be nested inside an array
            const file = Array.isArray(files.file) ? files.file[0] : files.file;
            if (!file) {
                reject(new Error("No file uploaded. Make sure the input name is 'file'."));
                return;
            }
            resolve(file);
        });
    });
}

// --- Main API Handler ---
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Initialize Gemini AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });

        // 2. Parse uploaded file
        const file = await parseForm(req);
        const fileBuffer = fs.readFileSync(file.filepath);
        const base64File = fileBuffer.toString('base64');
        const mimeType = file.mimetype;

        // 3. Define the detailed prompt for the AI
        const prompt = `
        You are an expert medical insurance claim analyst. Your task is to analyze the provided medical document (image or PDF) and return a structured JSON object.
        The document contains clinical information about a patient.
        
        Follow these instructions precisely:
        1.  Perform OCR on the document, including handwriting.
        2.  Extract all relevant clinical and administrative information.
        3.  Analyze the information for medical necessity, potential errors, and insurance coverage.
        4.  Generate a JSON object with the exact structure below. Do NOT add any text or markdown formatting before or after the JSON object.

        JSON structure to follow:
        {
          "summary": "A clear, concise summary of the patient's case and visit.",
          "patientInfo": {
            "name": "Patient's Full Name",
            "age": "Patient's Age",
            "gender": "Patient's Gender"
          },
          "physicianInfo": {
            "name": "Physician's Full Name",
            "specialty": "Physician's Specialty"
          },
          "analysis": {
            "diagnoses": ["List of diagnoses as strings"],
            "medications": ["List of prescribed medications as strings"],
            "procedures": ["List of performed procedures as strings"]
          },
          "errorDetection": {
            "hasErrors": true_or_false,
            "details": ["Describe any inconsistencies, contradictions, missing justifications, or potential errors."]
          },
          "insuranceEvaluation": [
            {
              "item": "Name of the drug or procedure",
              "status": "Accepted OR Rejected OR Needs Justification",
              "reason": "Brief justification for the status. For 'Accepted', mention it's standard procedure. For 'Rejected', state why (e.g., not covered, experimental). For 'Needs Justification', explain what is missing (e.g., requires prior authorization, missing diagnosis link)."
            }
          ],
          "recommendations": {
            "todo": "Actionable advice for the physician to ensure future claims are approved.",
            "toAvoid": "Specific actions the physician should avoid to prevent rejections."
          }
        }
        `;

        // 4. Prepare the request for Gemini
        const imagePart = {
            inlineData: {
                data: base64File,
                mimeType: mimeType,
            },
        };

        const textPart = {
            text: prompt,
        };

        // 5. Call the AI model
        const result = await model.generateContent([textPart, imagePart]);
        const response = result.response;
        const responseText = response.text();

        // 6. Clean and parse the JSON response from the AI
        // The model sometimes wraps the JSON in markdown ```json ... ```
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        const jsonString = jsonMatch ? jsonMatch[1] : responseText;
        
        let parsedData;
        try {
            parsedData = JSON.parse(jsonString);
        } catch (e) {
            console.error("Failed to parse JSON from AI response:", jsonString);
            throw new Error("The AI returned an invalid response format.");
        }

        // 7. Send the structured data back to the frontend
        return res.status(200).json(parsedData);

    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
}
