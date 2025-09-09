<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>محلل الملفات الطبية المتقدم</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            border-radius: 15px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 40px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #2c3e50;
            font-size: 2.5em;
            margin-bottom: 10px;
        }
        
        .upload-area {
            border: 3px dashed #3498db;
            border-radius: 10px;
            padding: 40px;
            text-align: center;
            background: #f8f9fa;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        
        .upload-area:hover {
            border-color: #2980b9;
            background: #e3f2fd;
        }
        
        .upload-icon {
            font-size: 4em;
            color: #3498db;
            margin-bottom: 20px;
        }
        
        .file-input {
            display: none;
        }
        
        .upload-btn {
            background: linear-gradient(45deg, #3498db, #2980b9);
            color: white;
            padding: 15px 30px;
            border: none;
            border-radius: 25px;
            font-size: 1.1em;
            cursor: pointer;
            transition: all 0.3s ease;
            margin: 10px;
        }
        
        .upload-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .progress {
            display: none;
            margin-top: 20px;
        }
        
        .progress-bar {
            background: #e0e0e0;
            border-radius: 10px;
            height: 20px;
            overflow: hidden;
        }
        
        .progress-fill {
            background: linear-gradient(45deg, #4caf50, #45a049);
            height: 100%;
            width: 0%;
            transition: width 0.3s ease;
        }
        
        .alerts {
            margin-top: 20px;
        }
        
        .alert {
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
        
        .alert-error {
            background: #ffebee;
            color: #c62828;
            border-left: 4px solid #f44336;
        }
        
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 40px;
        }
        
        .feature {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        
        .feature-icon {
            font-size: 2em;
            color: #3498db;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏥 محلل الملفات الطبية المتقدم</h1>
            <p>تحليل عميق وشامل للحالات الطبية باستخدام الذكاء الاصطناعي</p>
        </div>
        
        <form id="uploadForm" method="POST" action="/upload" enctype="multipart/form-data">
            <div class="upload-area" onclick="document.getElementById('fileInput').click()">
                <div class="upload-icon">📁</div>
                <h3>اسحب وأفلت الملف هنا أو انقر للاختيار</h3>
                <p>يدعم ملفات PDF, DOC, DOCX, TXT (حتى 16 ميجابايت)</p>
                <input type="file" id="fileInput" name="file" class="file-input" accept=".pdf,.
