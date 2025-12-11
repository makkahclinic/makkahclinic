# Medical Insurance Analyzer - Makkah Medical Complex

## Overview
This is a medical center website for Makkah Medical Complex (مجمع مكة الطبي بالزاهر), a healthcare facility in Makkah, Saudi Arabia. The website is primarily in Arabic and provides information about the medical complex, its departments, and services.

## Project Structure
- `index.html` - Main landing page
- `portal.html` - Smart portal
- `cbahi-portal.html` - Patient safety portal (password protected)
- `patient.html`, `pharmacy.html`, `insurance-check.html` - Various patient services
- `report.html` - Complaint/incident reporting
- `api/` - Serverless API functions (designed for Vercel)
  - `gpt.js` - Medical audit API using Gemini + OpenAI
  - `gpt-*.js` - Various GPT-based analysis endpoints
  - `patient-analyzer.js`, `pharmacy-rx.js`, `pdf.js` - Specialized APIs
- `pages/api/` - Next.js style API routes
  - `audit-onecall.js` - Single-call clinical audit API
- `ipc/` - Incident reporting templates
- `server.js` - Express static file server for Replit

## Tech Stack
- Frontend: Static HTML/CSS/JavaScript
- Backend APIs: Node.js (serverless functions)
- Dependencies: Express, OpenAI SDK, Google Generative AI, Vercel Blob

## Running the Project
The project runs on port 5000 using a simple Express static file server.

## Environment Variables
The API endpoints require the following environment variables when used:
- `OPENAI_API_KEY` - OpenAI API key
- `GEMINI_API_KEY` - Google Gemini API key
- `OPENAI_MODEL` - OpenAI model (defaults to gpt-4o)
- `GEMINI_MODEL` - Gemini model (defaults to gemini-1.5-pro-latest)

## Recent Changes
- 2025-12-11: Initial setup for Replit environment with Express static server
