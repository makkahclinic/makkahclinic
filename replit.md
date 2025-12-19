# مجمع مكة الطبي بالزاهر - دليل المشروع الشامل

## نظرة عامة
موقع مجمع مكة الطبي بالزاهر (m2020m.org) - نظام متكامل يشمل الموقع الرئيسي + بوابة سباهي + نظام الجولات

---

## هيكل النشر (Deployment Structure)

| المكون | مكان النشر | الرابط |
|--------|-----------|--------|
| HTML Files | GitHub Pages | https://m2020m.org |
| Code.gs | Google Apps Script | Web App URL |
| Data | Google Sheets | متعدد |
| Documents | Google Drive | متعدد |

---

## الملفات الرئيسية

### الموقع الرئيسي
| الملف | الوصف | الحالة |
|-------|-------|--------|
| `index.html` | الصفحة الرئيسية للمجمع | ✅ مكتمل |
| `portal.html` | البوابة الذكية (طبيب/مريض/صيدلي) | ✅ مكتمل |
| `doctor-mohammed.html` | صفحة قسم الباطنية | ✅ يحتاج تنقل |
| `patient.html` | خدمات المرضى | ✅ مكتمل |
| `pharmacy.html` | الصيدلية | ✅ مكتمل |
| `login.html` | تسجيل الدخول | ✅ مكتمل |
| `signup.html` | إنشاء حساب | ✅ مكتمل |
| `admin-login.html` | بوابة دخول الموظفين | ✅ جديد |
| `admin-dashboard.html` | لوحة تحكم الإدارة | ✅ جديد |
| `insurance-check.html` | فحص التأمين | ✅ مكتمل |

### نظام سباهي (CBAHI)
| الملف | الوصف | الحالة |
|-------|-------|--------|
| `cbahi-portal.html` | بوابة سباهي الإلكترونية (4114 سطر) | ✅ مكتمل |
| `Round.html` | نظام جولات السلامة (2071 سطر) | ✅ مكتمل |
| `calibration.html` | سجل معايرة الأجهزة (CAL) | ✅ مكتمل |
| `report.html` | نموذج رفع شكوى | ✅ مكتمل |
| `complaint_analysis.html` | نظام تحليل ومتابعة الشكاوى | ✅ مكتمل |
| `mega.html` | المركز الرقمي للجودة | ✅ مكتمل |
| `emergency-plan.html` | خطة الطوارئ والكوارث EOC | ✅ مكتمل |
| `eoc-command.html` | مركز القيادة والتحكم التفاعلي | ✅ جديد |

### مكافحة العدوى (IPC)
| الملف | الوصف | الحالة |
|-------|-------|--------|
| `ipc/incidents/report-needlestick.html` | بلاغ تعرض وخزي/دموي | ✅ مكتمل |

### Backend
| الملف | الوصف | الحالة |
|-------|-------|--------|
| `github-deploy/Code.gs` | Google Apps Script Backend | ✅ مكتمل |
| `server.js` | Express Server (Replit فقط) | ✅ مكتمل |
| `sheets-service.js` | خدمة Google Sheets | ✅ مكتمل |

### الأصول (Assets)
| الملف | الوصف |
|-------|-------|
| `logo-transparent.png` | الشعار الشفاف الجديد |
| `logo-new.png` | الشعار السداسي |
| `hero-bg.png` | صورة البطل (طبيب العيون) |

---

## أقسام بوابة سباهي (cbahi-portal.html)

| القسم | الرمز | المعيار |
|-------|-------|---------|
| الصفحة الرئيسية | `#home` | - |
| الدليل الإداري | `#manuals` | LD |
| القيادة والحوكمة | `#leadership` | LD |
| اللجان الرسمية | `#committees` | LD |
| إدارة المخاطر | `#rm` | RM |
| السلامة والمرافق | `#fms` | FMS |
| سلامة المرضى | `#psc` | PSC |
| مكافحة العدوى | `#ipc` | IPC |
| الجودة والتحسين | `#qi` | QI |
| الطوارئ والكوارث | `#eoc` | EOC |
| بلاغات/شكاوى | `#complaints` | RM |
| سجل التدريب | `#training` | LD |

---

## نظام الجولات (Round.html)

### التبويبات
1. **اليوم**: بطاقات الموظفين + جدول السجل
2. **المتأخرة**: الجولات المتأخرة مع وقت التأخير
3. **المخالفات**: تتبع المخالفات + الحل
4. **السجل**: البحث التاريخي بالتاريخ والموظف
5. **Dashboard**: رسوم بيانية وإحصائيات

### APIs (Code.gs)
| Action | الوظيفة |
|--------|---------|
| `getHomeData` | بيانات اليوم + الموظفين |
| `getRoundsLog` | سجل الجولات |
| `logRound` | تسجيل جولة جديدة |
| `getMasterTasks` | المهام الرئيسية (15 جولة) |
| `getStaffSummary` | ملخص الموظفين |
| `getDelayed` | الجولات المتأخرة |
| `getViolations` | المخالفات + التكرار |
| `getHistory` | السجل التاريخي |
| `getMetrics` | إحصائيات Dashboard |
| `getChecklist` | بنود الفحص (R01-R15) |
| `verifyPasscode` | التحقق من رمز الموظف |
| `resolveViolation` | إغلاق مخالفة |

### APIs الشكاوى (Code.gs)
| Action | الوظيفة |
|--------|---------|
| `submitComplaint` | إرسال شكوى جديدة |
| `getComplaintStaff` | قائمة موظفي الشكاوى |
| `verifyComplaintPasscode` | التحقق من رمز الموظف |
| `getComplaintStats` | إحصائيات الشكاوى |
| `getComplaints` | قائمة الشكاوى |
| `getComplaintDetails` | تفاصيل شكوى |
| `updateComplaint` | تحديث شكوى |
| `getComplaintHistory` | سجل متابعة الشكوى |

---

## Google Sheets

| الشيت | الوظيفة | Spreadsheet ID |
|-------|---------|----------------|
| `MASTER_TASKS` | جدول المهام الـ 15 | `1JB-I7_r6MiafNFk...` |
| `Rounds_Log` | سجل الجولات | نفس الـ ID |
| `Round_Schedule` | مواعيد الجولات | نفس الـ ID |
| `Staff_Passcodes` | رموز الموظفين | نفس الـ ID |
| `R01_` - `R15_` | بنود فحص كل جولة | نفس الـ ID |

### Spreadsheet IDs
```
نظام الجولات: 1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc
السجل الإلكتروني: 1cGxMCYqGfPH2UiE-nsCoytIRjIPSDYxutnq04XF5YGs
سجل الشكاوى: 1zVzjvVBh8F7Gvut0kX8fTq2GyKrYo3fBop8jUBEsV3Q
التعرض الوخزي: 11ASpiUe6GTW4siaoPGnjqG3xKMeUdCmxPsTSbPTu9xw
معايرة الأجهزة: 1HPQIlhnvynNKctQLgINtVc3OK8Ey4RX52dYdmlIT9F8
```

---

## الهوية البصرية

### الألوان الرسمية
| اللون | الكود | الاستخدام |
|-------|-------|----------|
| أزرق داكن | `#1e3a5f` | الخلفيات والعناوين |
| ذهبي | `#c9a962` | التمييز والأزرار الثانوية |
| قرمزي | `#DC143C` | التنبيهات والشعار |
| أبيض | `#ffffff` | النصوص على الخلفيات الداكنة |

### الخط
- **Tajawal** - الخط الرئيسي للعربية

---

## مجلد github-deploy (للنشر)

الملفات التي ترفع على GitHub:
```
github-deploy/
├── Round.html      (نسخة للنشر)
├── Code.gs         (يُنسخ إلى Apps Script)
```

---

## المهام المعلقة

### عاجل
- [ ] إضافة Header موحد لكل الصفحات (تنقل)
- [ ] توحيد الألوان في كل الصفحات

### مهم
- [ ] لوحة إدارة بصلاحيات
- [ ] نظام تسجيل دخول للإدارة

### تحسينات
- [ ] تقارير PDF
- [ ] إشعارات Push

---

## ملاحظات التشغيل

### Replit
- المنفذ: 5000
- السيرفر: Express static

### GitHub Pages
- الريبو: https://github.com/makkahclinic/makkahclinic
- الفرع: main
- المجلد: root
- الدومين: m2020m.org

### ملفات للنشر على GitHub
```
index.html
portal.html
doctor-mohammed.html
patient.html
pharmacy.html
login.html
signup.html
insurance-check.html
cbahi-portal.html
Round.html
calibration.html
report.html
project-index.html
ipc/incidents/report-needlestick.html
logo-transparent.png
logo-new.png
hero-bg.png
```

### Google Apps Script
- نوع النشر: Web App
- التنفيذ: As me
- الوصول: Anyone

---

## التحديثات الأخيرة

### 2025-12-19
- **مركز القيادة والتحكم EOC (جديد)**:
  - صفحة تفاعلية لإدارة الطوارئ (eoc-command.html)
  - خريطة المبنى التفاعلية (3 أدوار مع جميع الأقسام)
  - سيناريوهات الطوارئ: حريق (RACE/PASS)، انقطاع كهرباء، تفشي عدوى، إخلاء شامل
  - أرقام الطوارئ السعودية (911، 997، 998، 937)
  - نقاط التجمع وحالة الأدوار (آمن/إخلاء)
  - API لجلب سجل التمارين من Google Sheets
  - رابط في لوحة التحكم الإدارية

### 2025-12-18
- **نظام إدارة الصلاحيات الكاملة (جديد)**:
  - قسم "إدارة الصلاحيات" في لوحة التحكم
  - تعيين اللجان: RM, FMS, PSC, IPC, QI, EOC, أخرى
  - تعيين الأدوار: مدير عام، رئيس لجنة، عضو، مشاهد
  - اختيار الأنظمة المسموحة (9 أنظمة) بـ checkboxes
  - حماية أمنية على مستوى الكود (فحص الصلاحيات في كل دالة)
- إضافة نظام دخول منفصل للموظفين (admin-login.html)
- إنشاء لوحة تحكم إدارية متكاملة (admin-dashboard.html)
- نظام أدوار Firebase (admin/staff/viewer)
- حماية الصفحات الإدارية بالتحقق من الصلاحيات
- إدارة المستخدمين للمديرين فقط

### 2025-12-12
- تحديث الشعار إلى الشفاف (logo-transparent.png)
- إضافة صورة البطل (hero-bg.png)
- تحليل شامل للمشروع

### 2025-12-11
- إصلاحات نظام الجولات (Round.html)
- إضافة نظام المعالجة للمخالفات
- تحسين عرض البيانات

---

## للتواصل
مجمع مكة الطبي بالزاهر - مكة المكرمة
