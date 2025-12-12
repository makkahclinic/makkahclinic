# Medical Insurance Analyzer - Makkah Medical Complex

## Overview
This is a medical center website for Makkah Medical Complex (مجمع مكة الطبي بالزاهر), a healthcare facility in Makkah, Saudi Arabia serving the community for over 26 years. The website is primarily in Arabic and provides information about the medical complex, its departments, doctors, and services.

## Project Structure
- `index.html` - Main landing page with departments and doctors info
- `attached_assets/شعار_للموقع_المجمع_1765489579657.jpeg` - New hexagonal logo with heartbeat design
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

## Safety Rounds System (Round.html)
The safety rounds system has been upgraded with direct Google Sheets integration:
- **Today Tab**: Shows staff cards, daily stats, and round logs
- **Delayed Tab**: Shows all overdue rounds with delay time
- **Violations Tab**: Tracks violations and detects repeated issues
- **History Tab**: Filter historical rounds by date and staff
- **API Endpoints**: /api/rounds/* for all round operations
- **Data Source**: Google Sheets via Replit integration

## Recent Changes
- 2025-12-12: **Improved Violations Display** - Cards with clear repeat count badges (🔁), prominent warning modal before resolution with تأكيد/إلغاء buttons
- 2025-12-12: **Enhanced Repeat Count** - Each violation card shows repeat count calculated by area+staff combination
- 2025-12-12: **Warning Modal Redesign** - Yellow header with warning icon, clear "هذا الإجراء لا يمكن التراجع عنه" message
- 2025-12-12: **Fixed Checklist Column Reading** - Code.gs getChecklist now reads Arabic text from Column B instead of Column A (which has TaskID numbers)
- 2025-12-12: **Enhanced Checklist Visual Feedback** - When selecting "لا" items turn red with border, "نعم" items turn green
- 2025-12-12: **Fixed Log Table Display** - Old corrupted data (numeric patterns like "1-1-1-1") now shows "يوجد خلل" instead
- 2025-12-12: **Redesigned Violations Tab** - Violations now shown as cards with red/green headers based on resolution status
- 2025-12-12: **Passcode Resolution Workflow** - Confirmed working: تم المعالجة → Confirm Modal → Passcode Modal → verifyPasscode API → resolveViolation API
- 2025-12-11: **Updated Logo** - Changed all site logos to new hexagonal design (شعار_للموقع_المجمع_1765489579657.jpeg) across all pages
- 2025-12-11: **History Tab Date Highlighting** - Added active state for date range buttons (اليوم/أسبوع/شهر/3 أشهر/سنة) - selected button now highlights with primary color
- 2025-12-11: **Violation Resolution System** - Added "تم المعالجة" button on each violation, confirmation modal with logo, staff passcode verification, and Is_Resolved/Resolved_By/Resolved_Date columns in Rounds_Log
- 2025-12-11: **Staff Passcodes** - Created Staff_Passcodes sheet with unique codes for each staff member (عدنان:1234, بلال:5678, عبدالسلام:9012, خالد:3456)
- 2025-12-11: **Enhanced Violations Tab** - Added filters (staff/round/time period), statistics cards (total, repeated, top staff, top area), and trend chart showing violation frequency over time
- 2025-12-11: **Improved violation display** - Each violation shown as organized list with red border, danger icon, and proper formatting
- 2025-12-11: **Added Is_Violation checkbox** - User can explicitly mark entries as violations
- 2025-12-11: **Added Round_Schedule sheet** - Contains all 15 rounds with timing windows (Round_1_Start, Round_1_End, etc.)
- 2025-12-11: **Success Toast notifications** - Beautiful green toast for successful saves instead of basic alerts
- 2025-12-11: **Fixed violation detection** - Status="خلل" or "نقاط الخلل:" now correctly triggers violations
- 2025-12-11: **UI auto-refresh** - Staff cards, charts, and counters update immediately after form submission
- 2025-12-11: **Fixed data accuracy** - todayDone now counts all logged rounds (not just on-time ones)
- 2025-12-11: **Redesigned layout** - Staff cards on right side, log table on left (matching original design)
- 2025-12-11: **Improved log table** - Added mسؤول التنفيذ and ملخص الخلل columns
- 2025-12-11: **Staff-centric workflow redesign** - Staff cards now show detailed daily stats with "منفذة/مطلوبة" tracking
- 2025-12-11: Added "بدء الجولة" (Start Round) button for each task with completion status
- 2025-12-11: Implemented checklist form with Yes/No toggles for each inspection item
- 2025-12-11: Added `/api/rounds/staff-summary` endpoint for aggregated staff statistics
- 2025-12-11: Added `/api/rounds/checklist/:taskId` endpoint to fetch R01-R15 checklist items
- 2025-12-11: Staff cards now display today's tasks, completed count, and remaining rounds
- 2025-12-11: Added round submission form (floating + button) for staff to log rounds
- 2025-12-11: Added Dashboard tab with 4 charts (trend, status, staff, area performance)
- 2025-12-11: Fixed violation detection - now uses smart keyword detection (reduced from 33 to 3 real violations)
- 2025-12-11: Added /api/rounds/metrics endpoint for dashboard data
- 2025-12-11: Upgraded Round.html with new features (history, delays, violations tracking)
- 2025-12-11: Added Google Sheets API integration via Replit connector
- 2025-12-11: Created sheets-service.js for Google Sheets operations
- 2025-12-11: Updated server.js with API endpoints for rounds system
- 2025-12-11: Updated logo to new design (logo-new.png)
- 2025-12-11: Updated color scheme across all pages to match new logo
- 2025-12-11: Added all doctors and departments information
- 2025-12-11: Added services section (Lab, X-ray, Ultrasound, etc.)
- 2025-12-11: Initial setup for Replit environment with Express static server

## Staff Workflow (Round.html)
1. Staff member clicks their card on the right panel
2. Tasks table appears showing: Round name, Done/Required count, Target time, Start button
3. Clicking "بدء الجولة" loads the checklist form (from R01-R15 sheets)
4. Staff selects Yes/No for each item, assigns responsible party if issues found
5. Submitting saves to Rounds_Log with proper status and notes
