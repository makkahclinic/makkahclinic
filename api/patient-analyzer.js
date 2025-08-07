// /api/patient-analyzer.js - TEST CODE

// هذا الكود مخصص فقط للاختبار.
// مهمته الوحيدة هي الرد برسالة ثابتة للتأكد من أن هذا الملف يتم استدعاؤه بالفعل.
export default async function handler(req, res) {
  
  // سنقوم بالرد بهذه الرسالة البسيطة والواضحة
  const testResponse = "<h1>مرحباً، هذا هو ملف patient-analyzer.js الحقيقي الذي نعمل عليه.</h1>";

  // إرسال الرد
  res.status(200).json({ htmlReport: testResponse });

}
