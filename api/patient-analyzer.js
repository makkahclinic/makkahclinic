<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>استشاري طبي ذكي - تحليل شامل للمريض</title>
    <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --critical: #f8d7da;
            --critical-text: #721c24;
            --warning: #fff3cd;
            --warning-text: #856404;
            --good: #d4edda;
            --good-text: #155724;
            --primary: #2c3e50;
            --secondary: #3498db;
            --light: #ecf0f1;
            --dark: #2c3e50;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: 'Amiri', serif;
            line-height: 1.8;
            color: #333;
            background-color: #f8f9fa;
            padding: 20px;
            direction: rtl;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 5px 25px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
            padding: 30px;
            text-align: center;
            position: relative;
        }
        
        .logo {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            margin-bottom: 20px;
        }
        
        .logo i {
            font-size: 2.5rem;
            background: rgba(255, 255, 255, 0.2);
            width: 80px;
            height: 80px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        h1 {
            font-size: 2.2rem;
            margin-bottom: 10px;
        }
        
        .subtitle {
            font-size: 1.2rem;
            opacity: 0.9;
            max-width: 800px;
            margin: 0 auto;
        }
        
        .patient-info {
            background: white;
            border-radius: 10px;
            padding: 20px;
            margin: -30px 30px 30px;
            box-shadow: 0 3px 15px rgba(0, 0, 0, 0.1);
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
        }
        
        .info-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .info-item i {
            color: var(--secondary);
            font-size: 1.2rem;
        }
        
        .report-container {
            padding: 30px;
        }
        
        h2 {
            color: var(--primary);
            font-size: 1.8rem;
            margin: 30px 0 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid var(--secondary);
        }
        
        h3 {
            color: var(--secondary);
            font-size: 1.5rem;
            margin: 25px 0 15px;
        }
        
        h4 {
            color: var(--primary);
            font-size: 1.3rem;
            margin: 20px 0 10px;
        }
        
        .box-critical, .box-warning, .box-good {
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
            display: flex;
            align-items: flex-start;
            gap: 10px;
        }
        
        .box-critical {
            background-color: var(--critical);
            color: var(--critical-text);
            border-left: 4px solid var(--critical-text);
        }
        
        .box-warning {
            background-color: var(--warning);
            color: var(--warning-text);
            border-left: 4px solid var(--warning-text);
        }
        
        .box-good {
            background-color: var(--good);
            color: var(--good-text);
            border-left: 4px solid var(--good-text);
        }
        
        .box-icon {
            font-size: 1.2rem;
            min-width: 30px;
        }
        
        ul, ol {
            padding-right: 25px;
            margin: 15px 0;
        }
        
        li {
            margin-bottom: 10px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 1rem;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.05);
            border-radius: 8px;
            overflow: hidden;
        }
        
        th {
            background-color: #e9ecef;
            padding: 15px;
            text-align: right;
            font-weight: bold;
        }
        
        td {
            padding: 12px 15px;
            text-align: right;
            border-bottom: 1px solid #dee2e6;
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        tr:hover {
            background-color: rgba(52, 152, 219, 0.05);
        }
        
        .interaction-table thead {
            background-color: var(--critical);
        }
        
        .action-steps {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin: 25px 0;
        }
        
        .action-card {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
            border-top: 4px solid var(--secondary);
            transition: transform 0.3s ease;
        }
        
        .action-card:hover {
            transform: translateY(-5px);
        }
        
        .action-card h5 {
            font-size: 1.2rem;
            margin-bottom: 15px;
            color: var(--primary);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .questions-container {
            background: var(--light);
            border-radius: 10px;
            padding: 25px;
            margin: 25px 0;
        }
        
        .references {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            margin: 15px 0;
        }
        
        .ref-item {
            background: white;
            padding: 10px 20px;
            border-radius: 30px;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .disclaimer {
            background: var(--critical);
            color: var(--critical-text);
            padding: 20px;
            border-radius: 10px;
            margin: 30px 0;
            text-align: center;
            font-weight: bold;
        }
        
        .team-section {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 25px;
            margin: 30px 0;
        }
        
        .team-member {
            text-align: center;
            padding: 20px;
            border-radius: 10px;
            background: white;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
        }
        
        .team-member img {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            object-fit: cover;
            margin-bottom: 15px;
            border: 3px solid var(--secondary);
        }
        
        .medication-note {
            padding: 10px;
            border-radius: 5px;
            margin: 5px 0;
        }
        
        footer {
            background: var(--primary);
            color: white;
            text-align: center;
            padding: 20px;
            margin-top: 30px;
        }
        
        @media (max-width: 768px) {
            .patient-info {
                margin: -20px 15px 20px;
            }
            
            header {
                padding: 20px 15px;
            }
            
            .report-container {
                padding: 20px 15px;
            }
            
            .action-steps {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <i class="fas fa-heartbeat"></i>
                <div>
                    <h1>استشاري طبي ذكي</h1>
                    <div class="subtitle">تحليل شامل للحالات الطبية المعقدة بواسطة فريق استشاري افتراضي متخصص</div>
                </div>
            </div>
        </header>
        
        <div class="patient-info">
            <div class="info-item">
                <i class="fas fa-user"></i>
                <div>
                    <div>الاسم: أحمد محمد</div>
                    <div>العمر: 58 سنة</div>
                </div>
            </div>
            <div class="info-item">
                <i class="fas fa-heart"></i>
                <div>
                    <div>الحالة: مريض سكري وضغط مرتفع</div>
                    <div>تاريخ القبول: 15/08/2024</div>
                </div>
            </div>
            <div class="info-item">
                <i class="fas fa-file-medical"></i>
                <div>
                    <div>رقم الملف: #P-8842</div>
                    <div>طبيب الإحالة: د. خالد عبد الرحمن</div>
                </div>
            </div>
            <div class="info-item">
                <i class="fas fa-info-circle"></i>
                <div>
                    <div>الحالة: متوسطة</div>
                    <div>آخر تحديث: اليوم</div>
                </div>
            </div>
        </div>
        
        <div class="report-container">
            <h2>تحليل شامل من فريقنا الاستشاري</h2>
            
            <div class="team-section">
                <div class="team-member">
                    <img src="https://randomuser.me/api/portraits/men/32.jpg" alt="د. آدم">
                    <h3>د. آدم</h3>
                    <p>طبيب باطني استشاري</p>
                    <div class="box-good">خبير في التشخيصات السريرية</div>
                </div>
                <div class="team-member">
                    <img src="https://randomuser.me/api/portraits/women/44.jpg" alt="د. سارة">
                    <h3>د. سارة</h3>
                    <p>صيدلانية سريرية</p>
                    <div class="box-good">خبيرة في علم الأدوية والتداخلات</div>
                </div>
                <div class="team-member">
                    <img src="https://randomuser.me/api/portraits/men/22.jpg" alt="د. كينجي">
                    <h3>د. كينجي</h3>
                    <p>أخصائي مختبر وأشعة</p>
                    <div class="box-good">يحلل التحاليل والصور الطبية</div>
                </div>
            </div>
            
            <h3>1. ملخص وتقييم الحالة (رؤية د. آدم)</h3>
            <ul>
                <li>
                    <div class='box-good'>
                        <div class="box-icon"><i class="fas fa-check-circle"></i></div>
                        <div>
                            <strong>ملخص سريري:</strong> 
                            <p>مريض ذكر عمره 58 سنة، يعاني من السكري من النوع الثاني وارتفاع ضغط الدم، لديه قسطرة بولية دائمة منذ 6 أشهر. يشكو مؤخرًا من ضعف عام، إرهاق مستمر، وارتفاع في درجات الحرارة بشكل متكرر. التحاليل الأخيرة تظهر ارتفاع في مستوى الكرياتينين وانخفاض في eGFR إلى 45 مل/دقيقة.</p>
                        </div>
                    </div>
                </li>
                <li>
                    <div class='box-warning'>
                        <div class="box-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <div>
                            <strong>ملاحظة هامة:</strong>
                            <p>البيانات المتوفرة لا تحتوي على تحليل eGFR حديث كافي لتقييم وظائف الكلى بدقة، كما أن حالة القسطرة تحتاج لمزيد من التوضيح (تاريخ التركيب، نوعها، ومضاعفات سابقة).</p>
                        </div>
                    </div>
                </li>
            </ul>
            
            <h3>2. التشخيصات المحتملة (تحليل د. آدم)</h3>
            <ol>
                <li>
                    <strong>التشخيص الأقرب: عدوى بولية مزمنة مع احتمال بداية قصور كلوي</strong>
                    <p>ضعف عام + قسطرة دائمة + eGFR منخفض (45 مل/دقيقة) + ارتفاع متكرر في الحرارة → يشير إلى عدوى بولية مزمنة مع تأثير على وظائف الكلى.</p>
                </li>
                <li>
                    <strong>تشخيصات تفريقية:</strong>
                    <ul>
                        <li>التهاب الكلى الخلالي (Interstitial Nephritis) بسبب الأدوية</li>
                        <li>انسداد في القسطرة أو مجرى البول</li>
                    </ul>
                </li>
            </ol>
            
            <h3>3. مراجعة الأدوية (تدقيق د. سارة)</h3>
            <p>يرجى عرض قائمة الأدوية في جدول يحتوي على الأعمدة التالية:</p>
            <table border='1'>
              <thead>
                <tr>
                  <th>اسم الدواء</th>
                  <th>الجرعة</th>
                  <th>الغرض الطبي</th>
                  <th>ملاحظات د. سارة</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Pantomax 40</td>
                  <td>1 × 2 × 90</td>
                  <td>لارتجاع المعدة</td>
                  <td>
                    <div class='box-good medication-note'>
                        <i class="fas fa-check-circle"></i> آمن عادة إذا لم توجد مشاكل بالكلى
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Triplex</td>
                  <td>1 × 1 × 90</td>
                  <td>علاج ضغط الدم</td>
                  <td>
                    <div class='box-critical medication-note'>
                        <i class="fas fa-times-circle"></i> يُستخدم مع Diovan مما يمثل ازدواجية علاجية لضغط الدم
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Xigduo XR</td>
                  <td>5/1000 × 1 × 2 × 90</td>
                  <td>سكري من النوع الثاني</td>
                  <td>
                    <div class='box-warning medication-note'>
                        <i class="fas fa-exclamation-triangle"></i> يتطلب فحص eGFR لوظائف الكلى بسبب الميتفورمين
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>Diovan</td>
                  <td>80mg × 1 × 90</td>
                  <td>علاج ضغط الدم</td>
                  <td>
                    <div class='box-critical medication-note'>
                        <i class="fas fa-times-circle"></i> ازدواجية علاجية مع Triplex
                    </div>
                  </td>
                </tr>
                <tr>
                  <td>No-Uric</td>
                  <td>100mg × 1 × 90</td>
                  <td>علاج النقرس</td>
                  <td>
                    <div class='box-warning medication-note'>
                        <i class="fas fa-exclamation-triangle"></i> يجب مراقبة وظائف الكلى
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <h4>تحقق التداخلات الدوائية (Drug Interaction Checker)</h4>
            <p>يوضح الجدول التالي ما إذا كانت هناك تداخلات دوائية خطيرة بين الأدوية الموصوفة:</p>
            <table border='1' class="interaction-table">
              <thead>
                <tr>
                  <th>الدواء الأول</th>
                  <th>الدواء الثاني</th>
                  <th>درجة التداخل</th>
                  <th>الوصف</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Triplex</td>
                  <td>Diovan</td>
                  <td>
                    <div class='box-critical medication-note'>❌ شديد</div>
                  </td>
                  <td>ازدواجية علاجية لضغط الدم قد تسبب انخفاضًا حادًا في الضغط</td>
                </tr>
                <tr>
                  <td>Xigduo XR</td>
                  <td>No-Uric</td>
                  <td>
                    <div class='box-warning medication-note'>⚠️ متوسط</div>
                  </td>
                  <td>يجب مراقبة وظائف الكلى لأن كليهما يؤثران على الكلى</td>
                </tr>
              </tbody>
            </table>
            
            <h3>4. تحليل البيانات والمرفقات (ملاحظات د. كينجي)</h3>
            <ul>
                <li>
                    <div class='box-warning'>
                        <div class="box-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <div>
                            <strong>التحاليل الخارجة عن الطبيعي:</strong>
                            <ul>
                                <li>الكرياتينين: 1.8 مجم/دل (مرتفع)</li>
                                <li>eGFR: 45 مل/دقيقة (منخفض)</li>
                                <li>خلايا الدم البيضاء: 13,000/مم³ (مرتفع)</li>
                                <li>تحليل البول: وجود صديد وبكتيريا</li>
                            </ul>
                            <p><strong>التفسير:</strong> هذه النتائج تشير إلى التهاب بولي وتراجع في وظائف الكلى، مما يتطلب تقييمًا عاجلاً.</p>
                        </div>
                    </div>
                </li>
                <li>
                    <div class='box-warning'>
                        <div class="box-icon"><i class="fas fa-exclamation-triangle"></i></div>
                        <div>
                            <strong>الملاحظات على المرفقات:</strong>
                            <p>الصورة المرفقة هي وصفة طبية تحتوي على الأدوية المذكورة أعلاه. لا توجد صور أشعة أو تقارير مختبر كافية لتقييم حالة القسطرة أو الكلى بشكل كامل. نوصي بتوفير تقرير الأشعة الأخير ونتائج مزرعة البول.</p>
                        </div>
                    </div>
                </li>
            </ul>
            
            <h3>5. خطة العمل المقترحة (توصية الفريق الموحدة)</h3>
            <div class="action-steps">
                <div class="action-card">
                    <h5><i class="fas fa-vial"></i> الفحوصات المطلوبة</h5>
                    <ul>
                        <li>إجراء تحليل eGFR حديث ومفصل</li>
                        <li>مزرعة بول لتحديد نوع البكتيريا</li>
                        <li>فحص وظائف الكلى بشكل دوري</li>
                    </ul>
                </div>
                <div class="action-card">
                    <h5><i class="fas fa-user-md"></i> المراجعات الطبية</h5>
                    <ul>
                        <li>مراجعة طبيب الباطنة خلال أسبوع</li>
                        <li>استشارة أخصائي الكلى</li>
                        <li>مراجعة نظام الأدوية مع الصيدلي</li>
                    </ul>
                </div>
                <div class="action-card">
                    <h5><i class="fas fa-pills"></i> تعديل الأدوية</h5>
                    <ul>
                        <li>مراجعة أدوية الضغط وتعديل الجرعات</li>
                        <li>تقييم إمكانية إيقاف الدواء المزدوج</li>
                        <li>استبدال أدوية قد تؤثر على الكلى</li>
                    </ul>
                </div>
            </div>
            
            <h3>6. أسئلة ذكية لطبيبك</h3>
            <div class="questions-container">
                <ul>
                    <li><i class="fas fa-question-circle"></i> هل هذه الأدوية آمنة لحالتي مع وجود مشاكل في الكلى؟</li>
                    <li><i class="fas fa-question-circle"></i> هل أحتاج فحص إضافي لتأكيد التشخيص؟</li>
                    <li><i class="fas fa-question-circle"></i> ما الخيارات البديلة للأدوية الحالية الأقل ضررًا على الكلى؟</li>
                    <li><i class="fas fa-question-circle"></i> هل أحتاج لإجراء أي تغيير في نظام القسطرة البولية؟</li>
                    <li><i class="fas fa-question-circle"></i> ما هي العلامات التحذيرية التي يجب أن أراقبها في المنزل؟</li>
                </ul>
            </div>
            
            <h3>7. المراجع العلمية</h3>
            <div class="references">
                <div class="ref-item"><i class="fas fa-book-medical"></i> UpToDate</div>
                <div class="ref-item"><i class="fas fa-hospital"></i> Mayo Clinic</div>
                <div class="ref-item"><i class="fas fa-stethoscope"></i> Medscape</div>
                <div class="ref-item"><i class="fas fa-globe"></i> WHO</div>
                <div class="ref-item"><i class="fas fa-pills"></i> FDA</div>
            </div>
            
            <h3>8. إخلاء مسؤولية هام</h3>
            <div class="disclaimer">
                <p><strong>هذا التحليل هو أداة مساعدة أولية مبنية على الذكاء الاصطناعي ومصمم لزيادة وعيك بحالتك، ولا يمثل تشخيصًا طبيًا نهائيًا ولا يغني أبدًا عن استشارة الطبيب المختص.</strong></p>
            </div>
        </div>
        
        <footer>
            <p>نظام الاستشاري الطبي الذكي - تم تطويره بواسطة فريق من الخبراء الطبيين ومهندسي الذكاء الاصطناعي</p>
            <p>© 2024 جميع الحقوق محفوظة - نسخة 2.1.5</p>
        </footer>
    </div>
    
    <script>
        // يمكن إضافة وظائف جافاسكريبت للتفاعل هنا
        document.addEventListener('DOMContentLoaded', function() {
            // تمثيل بسيط لتحديث حالة المريض
            const statusItems = document.querySelectorAll('.info-item');
            statusItems.forEach(item => {
                item.addEventListener('click', function() {
                    this.classList.toggle('active');
                });
            });
            
            // تأثيرات لعرض التقرير
            const sections = document.querySelectorAll('h3, h4, table, .action-card');
            sections.forEach((section, index) => {
                setTimeout(() => {
                    section.style.opacity = '1';
                    section.style.transform = 'translateY(0)';
                }, 300 + index * 100);
            });
        });
    </script>
</body>
</html>
