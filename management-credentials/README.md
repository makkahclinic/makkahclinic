# رفع السير الذاتية والموّهلات – سكربت الإدارة

هذا المجلد يحتوي كود **مشروع Google Apps Script** (النسخة المخزّنة على GitHub):

- **ManagementCredentials.gs:** [عرض على GitHub](https://github.com/makkahclinic/makkahclinic/blob/main/management-credentials/ManagementCredentials.gs)
- **ManagementUpload.html:** [عرض على GitHub](https://github.com/makkahclinic/makkahclinic/blob/main/management-credentials/ManagementUpload.html)

الربط مع:
- **Sheet:** [12Pw7s6fT4Qd3fZHZUcsJE79JuYnIzwk6vr69Uv-pFEg](https://docs.google.com/spreadsheets/d/12Pw7s6fT4Qd3fZHZUcsJE79JuYnIzwk6vr69Uv-pFEg/edit)
- **مجلد Drive للملفات:** 1NuhHv_8rnCZghPxmW6YUPrSOn9IkRDsh
- **الرقم السري للرفع والعرض:** Makkah3026 (يمكن نقله لـ Script Properties باسم `UPLOAD_PASSWORD`)

---

## كيفية التفعيل في مشروع السكربت

1. افتح مشروع Apps Script المرتبط برابط الـ exec (نفس المشروع الذي يظهر فيه خطأ "Script function not found: doGet").
2. أضف ملف **Script** جديد باسم `ManagementCredentials.gs` والصق فيه محتوى الملف **ManagementCredentials.gs** من هذا المجلد.
3. أضف ملف **HTML** جديد باسم `ManagementUpload` (من القائمة: File → New → HTML file)، والصق فيه محتوى **ManagementUpload.html** من هذا المجلد.
4. احفظ المشروع ثم **نشر التطبيق كـ Web App:**
   - Deploy → New deployment → Type: Web app
   - Description: مثلاً "رفع الموّهلات"
   - Execute as: Me
   - Who has access: حسب الحاجة (Anyone لاستخدام من أي جهاز، أو Only myself للاختبار أولاً)
   - Deploy ثم انسخ رابط الـ exec الجديد إن ظهر.

بعد ذلك الرابط الحالي للـ exec سيعمل ويُظهر صفحة الرفع. إذا فتحت الرابط مع `?name=حسين` يُحدَّد الاسم تلقائياً ويُطلب **الرقم السري فقط** ثم رفع الملفات.

---

## ورقة الشيت

- يُستخدم الورقة الأولى في الملف، أو ورقة باسم **«الموهلات»** إن وُجدت.
- الصف الأول: `الاسم | نوع الوثيقة | رابط الملف | اسم الملف | تاريخ الرفع`.
- الملفات المرفوعة تُحفظ في مجلد Drive المحدد ولا تُنشر للعامة.
