# Medical Insurance Analyzer - Makkah Medical Complex

## Overview
This is a medical center website for Makkah Medical Complex (مجمع مكة الطبي بالزاهر), a healthcare facility in Makkah, Saudi Arabia serving the community for over 26 years. The website is primarily in Arabic and provides information about the medical complex, its departments, doctors, and services.

## Project Structure
- `index.html` - Main landing page with departments and doctors info
- `logo-new.png` - New logo (used across the site)
- `portal.html` - Smart portal (Doctor, Patient, Pharmacist portals)
- `cbahi-portal.html` - Patient safety portal (password protected)
- `doctor-mohammed.html` - Internal Medicine department page
- `patient.html`, `pharmacy.html`, `insurance-check.html` - Various patient services
- `report.html` - Complaint/incident reporting
- `login.html`, `signup.html` - Authentication pages
- `api/` - Serverless API functions (designed for Vercel)
- `pages/api/` - Next.js style API routes
- `ipc/` - Incident reporting templates
- `server.js` - Express static file server for Replit

## Departments & Doctors
1. **Internal Medicine (الباطنية):** Dr. Mohammed Al-Amin (Consultant), Dr. Hamada Nageh (Senior Resident), Dr. Magdy Askar (Specialist - 26 years)
2. **Obstetrics & Gynecology:** Dr. Sawsan Al-Mahdar (Specialist)
3. **Orthopedics:** Dr. Mohammed Al-Khaled (Specialist)
4. **Ophthalmology:** Dr. Shaza (Senior Resident) - OCT, Fundus exam, Retinopathy follow-up
5. **Dental:** Dr. Rabia Tabassum (Orthodontics Consultant), Dr. Muaz Labyoush, Dr. Noura Al-Habashi, Dr. Rasha, Dr. Al-Anoud Al-Zubaidi
6. **General Practice:** Dr. Jaafar, Dr. Noor Al-Islam, Dr. Mohammed

## Services
- Full Laboratory, X-ray, Ultrasound, Doppler, Dental Panorama, OCT for eyes

## Color Scheme (matching new logo)
- Primary: #1e3a5f (Dark Blue)
- Secondary/Accent: #c9a962 (Gold)
- Accent/Crimson: #DC143C (Crimson - deep, rich, vibrant red)
- Logo Background: rgba(220, 20, 60, 0.8) - Crimson at 80% opacity

## Tech Stack
- Frontend: Static HTML/CSS/JavaScript with Tajawal font
- Backend APIs: Node.js (serverless functions)
- External integrations: Google Sheets, Google Drive, Firebase Auth, Google Apps Script

## Running the Project
The project runs on port 5000 using a simple Express static file server.

## Recent Changes
- 2025-12-11: Updated logo to new design (logo-new.png)
- 2025-12-11: Updated color scheme across all pages to match new logo
- 2025-12-11: Added all doctors and departments information
- 2025-12-11: Added services section (Lab, X-ray, Ultrasound, etc.)
- 2025-12-11: Initial setup for Replit environment with Express static server
