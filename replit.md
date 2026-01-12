# مجمع مكة الطبي بالزاهر - دليل المشروع الشامل

## Overview
The Makkah Medical Complex Al-Zaher (m2020m.org) project is an integrated system comprising a main website, a CBAHI portal, and a rounds management system. Its purpose is to digitize and streamline various medical and administrative processes within the complex, enhancing efficiency, patient care, and compliance with healthcare standards. The project aims to provide a comprehensive digital platform for patients, medical staff, and administrators.

## User Preferences
I prefer clear and concise communication. When making changes, prioritize iterative development and ask for confirmation before implementing major architectural shifts. Ensure all explanations are detailed, especially for new features or complex logic. Do not make changes to files within the `github-deploy/` directory unless specifically instructed, as these are for deployment.

## System Architecture

### UI/UX Decisions
- **Color Scheme**: Dark Blue (`#1e3a5f`) for backgrounds and headers, Gold (`#c9a962`) for highlights and secondary buttons, Crimson (`#DC1433`) for alerts and the logo, and White (`#ffffff`) for text on dark backgrounds.
- **Typography**: Tajawal is the primary font for Arabic text.
- **Design Patterns**: Emphasis on a unified smart portal (`portal.html`) with role-based access, and interactive dashboards for different user types (doctor, patient, admin).
- **Branding**: Utilizes a transparent logo (`logo-transparent.png`) and a hexagonal logo (`logo-new.png`), with a specific hero background image (`hero-bg.png`).

### Technical Implementations
- **Frontend**: Primarily HTML files hosted on GitHub Pages, enhanced with JavaScript for interactivity and dynamic content.
- **Backend**: Google Apps Script (`Code.gs`) serves as the primary backend for handling data interactions with Google Sheets, implementing business logic, and managing user authentication and authorization. An Express server (`server.js`) is used for local development within Replit.
- **Authentication/Authorization**: A unified authentication guard (`auth-guard.js`) enforces access control. Role-based access is implemented using Google Sheets to store user roles (owner, admin, staff, patient). Firebase integration is used for Email/Google Auth and secure token verification for both staff and patients.
- **Dynamic Content**: Data is fetched and updated via APIs exposed through Google Apps Script.
- **Security**: Role-based access control (RBAC) is implemented at the code level, checking permissions for each function call. Firebase ID Token verification secures patient and staff authentication.

### Feature Specifications
- **Main Website**: Includes core pages like `index.html`, `patient.html`, `pharmacy.html`, `login.html`, `signup.html`, and `insurance-check.html`.
- **Smart Portal (`portal.html`)**: A unified entry point with 6 distinct portals for different roles (patient, doctor, pharmacist, insurance, staff, owner).
- **Doctor & Patient Dashboards**: Dedicated login and dashboard pages for doctors (`doctor-login.html`, `doctor-dashboard.html`) and patients (`patient-login.html`, `patient-dashboard.html`) offering role-specific functionalities.
- **Admin & Staff Management**: Separate login (`admin-login.html`) and dashboard (`admin-dashboard.html`) for administrators, including a comprehensive permission management system to assign committees, roles, and system access.
- **CBAHI Portal (`cbahi-portal.html`)**: A large electronic portal covering various quality and safety standards (Leadership, Risk Management, FMS, Patient Safety, IPC, QI, EOC, Complaints, Training).
- **Rounds Management System (`Round.html`)**: Manages safety rounds with features for daily tasks, delayed rounds tracking, violation reporting and resolution, historical log, and a performance dashboard with metrics.
- **Emergency Management**:
    - **Emergency Report System (`emergency-report.html`)**: Quick reporting for critical situations with disaster type and location selection, integrated with emergency contact numbers.
    - **EOC Command Center (`eoc-command.html`)**: An interactive command and control center for managing emergencies, including a building map, emergency scenarios, and real-time incident reports.
    - **Emergency Training System**: Integrated within the EOC command center, providing practical training scenarios for various emergencies, tracking participants, and session logs.
- **IPC Incident Reporting**: Specific forms for infection prevention and control incidents, e.g., `report-needlestick.html`.
- **Calibration Log (`calibration.html`)**: System for tracking equipment calibration.
- **Complaint Management**: Includes a complaint submission form (`report.html`) and a system for analysis and follow-up (`complaint_analysis.html`).
- **Digital Quality Center (`mega.html`)**: A centralized hub for quality-related documentation and processes.
- **Insurance Audit System**: Advanced RBAC system with Gemini AI for generating tri-layer insurance audit reports (CDI, NPHIES, Clinical Guidelines).
  - **Dual-Track Scoring System**: Fair evaluation differentiating between medical errors and documentation gaps:
    - **Clinician Fairness Score**: Lenient on documentation gaps (weight: -1), strict on medical errors (weight: -5 to -8)
    - **Insurance Defense Score**: Strict on all issues for strong defense against insurance companies
    - **Official Score**: 60% Insurance Defense + 40% Clinician Fairness
  - **Transparent Deduction Ledger**: Shows all penalties with classifications and actual contribution to official score

## External Dependencies

- **Google Apps Script**: Used for backend logic and API endpoints.
- **Google Sheets**: Serves as the primary database for all application data, including user roles, schedules, logs, tasks, and configuration.
- **Google Drive**: Used for storing documents and potentially other assets.
- **GitHub Pages**: Hosts the static HTML/CSS/JS frontend files.
- **Firebase**: Utilized for user authentication (Email/Google Auth) and secure token verification (via Identity Toolkit API) for both staff and patient logins.
- **Express.js**: Used in the Replit environment for local server setup and serving static files.