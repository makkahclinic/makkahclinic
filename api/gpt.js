<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نظام التحليل الطبي - M2020M</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #f5f7fa 0%, #e4e8f0 100%);
            color: #333;
            line-height: 1.6;
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 5px 20px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        header {
            background: linear-gradient(90deg, #1976d2 0%, #0d47a1 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        
        .logo {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 10px;
        }
        
        .logo i {
            font-size: 32px;
            margin-left: 10px;
        }
        
        h1 {
            font-size: 28px;
            margin: 10px 0;
        }
        
        .subtitle {
            font-size: 16px;
            opacity: 0.9;
        }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            padding: 20px;
        }
        
        @media (max-width: 768px) {
            .main-content {
                grid-template-columns: 1fr;
            }
        }
        
        .section {
            background: #f9fbfc;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
            border: 1px solid #e0e0e0;
        }
        
        .section-title {
            color: #0d47a1;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #e3f2fd;
            display: flex;
            align-items: center;
        }
        
        .section-title i {
            margin-left: 10px;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #555;
        }
        
        input, textarea, select {
            width: 100%;
            padding: 12px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            transition: border 0.3s;
        }
        
        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: #1976d2;
            box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.2);
        }
        
        textarea {
            min-height: 120px;
            resize: vertical;
        }
        
        .upload-area {
            border: 2px dashed #1976d2;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            background: #f3f9ff;
            margin-bottom: 20px;
            transition: background 0.3s;
            cursor: pointer;
        }
        
        .upload-area:hover {
            background: #e3f2fd;
        }
        
        .upload-area i {
            font-size: 48px;
            color: #1976d2;
            margin-bottom: 15px;
        }
        
        .upload-text {
            color: #1976d2;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .upload-hint {
            color: #666;
            font-size: 14px;
        }
        
        .file-list {
            margin-top: 20px;
        }
        
        .file-item {
            display: flex;
            align-items: center;
            background: #e8f5e9;
            padding: 10px 15px;
            border-radius: 6px;
            margin-bottom: 10px;
        }
        
        .file-item i {
            color: #388e3c;
            margin-left: 10px;
        }
        
        .btn {
            background: linear-gradient(90deg, #1976d2 0%, #0d47a1 100%);
            color: white;
            border: none;
            padding: 14px 25px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s;
            width: 100%;
        }
        
        .btn:hover {
            opacity: 0.9;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        
        .btn i {
            margin-left: 8px;
        }
        
        .result-area {
            background: #fff;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
            border: 1px solid #e0e0e0;
            min-height: 200px;
        }
        
        .status-indicator {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 15px;
            background: #f1f8e9;
            border-radius: 8px;
            margin-top: 20px;
            color: #388e3c;
            font-weight: 600;
        }
        
        .status-indicator i {
            margin-left: 10px;
        }
        
        footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 14px;
            border-top: 1px solid #eee;
            margin-top: 20px;
        }
        
        .temperature-value {
            font-size: 24px;
            font-weight: 700;
            color: #1976d2;
            text-align: center;
            margin: 10px 0;
        }
        
        .temperature-label {
            text-align: center;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="logo">
                <i class="fas fa-heartbeat"></i>
                <h1>نظام التحليل الطبي</h1>
            </div>
            <p class="subtitle">www.m2020m.org - منصة متخصصة في التحليل الطبي الذكي</p>
        </header>
        
        <div class="main-content">
            <div class="left-panel">
                <div class="section">
                    <h2 class="section-title"><i class="fas fa-info-circle"></i> معلومات الحالة</h2>
                    
                    <div class="form-group">
                        <label for="temperature">درجة الحرارة (مئوية)</label>
                        <div class="temperature-value">37.0</div>
                        <div class="temperature-label">طبيعي</div>
                    </div>
                    
                    <div class="form-group">
                        <label for="description">وصف الحالة (نص حر)</label>
                        <textarea id="description" placeholder="أدخل وصفًا مفصلًا للحالة الطبية...">أعز اقتراحات...</textarea>
                    </div>
                </div>
                
                <div class="section">
                    <h2 class="section-title"><i class="fas fa-upload"></i> رفع الملفات</h2>
                    
                    <div class="upload-area" id="dropZone">
                        <i class="fas fa-cloud-upload-alt"></i>
                        <div class="upload-text">سحب وإفلات الملفات هنا</div>
                        <div class="upload-hint">يدعم الصور وملفات PDF (بحد أقصى 10 ملفات)</div>
                    </div>
                    
                    <div class="file-list">
                        <div class="file-item">
                            <i class="fas fa-file-pdf"></i>
                            <span>التقرير_الطبي.pdf</span>
                        </div>
                        <div class="file-item">
                            <i class="fas fa-file-image"></i>
                            <span>صورة_التحليل.png</span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="right-panel">
                <div class="section">
                    <h2 class="section-title"><i class="fas fa-cogs"></i> إعدادات التحليل</h2>
                    
                    <div class="form-group">
                        <label for="analysisType">نوع التحليل</label>
                        <select id="analysisType">
                            <option>تحليل الأدوية والجرعات</option>
                            <option>تحليل التفاعلات الدوائية</option>
                            <option>تحليل التكلفة والفوائد</option>
                            <option>تحليل المخاطر الطبية</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="priority">أولوية التحليل</label>
                        <select id="priority">
                            <option>عادية</option>
                            <option>متوسطة</option>
                            <option>عاجلة</option>
                        </select>
                    </div>
                    
                    <button class="btn" id="analyzeBtn">
                        <i class="fas fa-play-circle"></i> بدء التحليل
                    </button>
                    
                    <div class="status-indicator">
                        <i class="fas fa-check-circle"></i>
                        <span>جاهز للتحليل</span>
                    </div>
                </div>
                
                <div class="section">
                    <h2 class="section-title"><i class="fas fa-chart-line"></i> نتائج التحليل</h2>
                    
                    <div class="result-area">
                        <p>سيظهر هنا نتائج التحليل بعد الضغط على زر "بدء التحليل".</p>
                        <p>سيقوم النظام بتحليل البيانات والمستندات المقدمة وتقديم التوصيات الطبية المناسبة.</p>
                    </div>
                </div>
            </div>
        </div>
        
        <footer>
            <p>© 2025 www.m2020m.org - جميع الحقوق محفوظة</p>
            <p>هذه المنصة مخصصة للاستخدام الطبي المحترف وتخضع لشروط الخصوصية والأمان الطبي</p>
        </footer>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const dropZone = document.getElementById('dropZone');
            const analyzeBtn = document.getElementById('analyzeBtn');
            
            // تمكين سحب وإفلات الملفات
            dropZone.addEventListener('dragover', function(e) {
                e.preventDefault();
                this.style.background = '#e3f2fd';
            });
            
            dropZone.addEventListener('dragleave', function() {
                this.style.background = '#f3f9ff';
            });
            
            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.style.background = '#f3f9ff';
                alert('تم إضافة الملفات بنجاح!');
            });
            
            // محاكاة عملية التحليل
            analyzeBtn.addEventListener('click', function() {
                const statusIndicator = document.querySelector('.status-indicator');
                statusIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارِ التحليل...';
                statusIndicator.style.background = '#fff3e0';
                statusIndicator.style.color = '#f57c00';
                
                // محاكاة وقت التحليل
                setTimeout(function() {
                    statusIndicator.innerHTML = '<i class="fas fa-check-circle"></i> اكتمل التحليل بنجاح';
                    statusIndicator.style.background = '#e8f5e9';
                    statusIndicator.style.color = '#388e3c';
                    
                    document.querySelector('.result-area').innerHTML = `
                        <h3>نتائج التحليل:</h3>
                        <ul>
                            <li>لا توجد تفاعلات دوائية خطيرة</li>
                            <li>الجرعات مناسبة للحالة</li>
                            <li>يوصى بمتابعة الحالة بعد أسبوعين</li>
                            <li>تم اكتشاف دواء زائد يمكن الاستغناء عنه</li>
                        </ul>
                        <h3>التوصيات:</h3>
                        <ol>
                            <li>الاستمرار على الخطة العلاجية الحالية</li>
                            <li>مراقبة مستوى السكر يوميًا</li>
                            <li>الالتزام بالمواعيد الدوائية بدقة</li>
                            <li>مراجعة العيادة بعد أسبوعين</li>
                        </ol>
                    `;
                }, 3000);
            });
        });
    </script>
</body>
</html>
