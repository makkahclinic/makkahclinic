import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import admin from 'firebase-admin';
import { getSheetData, appendRow, updateCell, getSheetNames, createSheet, batchUpdate, findAndUpdateRow, getGoogleSheetsClient } from './sheets-service.js';

const COMPLAINTS_SPREADSHEET_ID = '1DLBbSkBdfsdyxlXptaCNZsKVoJ-F3B6famr6_8V50Z0';

// Initialize Firebase Admin SDK
let firebaseAdmin = null;
try {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully');
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT not found - admin features disabled');
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin:', err.message);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// API Routes for Rounds System
app.get('/api/sheets/names', async (req, res) => {
  try {
    const names = await getSheetNames();
    res.json({ ok: true, sheets: names });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/sheets/update-cell', async (req, res) => {
  try {
    const { sheet, cell, value } = req.body;
    await updateCell(sheet, cell, value);
    res.json({ ok: true, message: `Updated ${sheet}!${cell} to "${value}"` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Download endpoint for github-deploy files
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'github-deploy', filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, filename);
  } else {
    res.status(404).send('File not found');
  }
});

// Serve github-deploy HTML files
app.get('/emergency-poster.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'github-deploy', 'emergency-poster.html'));
});

// Debug endpoint DISABLED for security
// app.get('/api/debug/sheet/:name', ...);

// Create Round_Schedule sheet with all timing data
app.post('/api/rounds/create-schedule', async (req, res) => {
  try {
    // Create the sheet if it doesn't exist
    await createSheet('Round_Schedule');
    
    // Schedule data based on the user's requirements
    const scheduleData = [
      ['TaskID', 'Round_Name_AR', 'Round_Name_EN', 'Assigned_To', 'Rounds_Per_Day', 'Round_1_Start', 'Round_1_End', 'Round_2_Start', 'Round_2_End', 'Round_3_Start', 'Round_3_End', 'Allowed_Time_Min'],
      ['R01', 'دورات المياه العامة', 'Public Toilets', 'عدنان', '3', '08:00', '09:00', '12:00', '13:00', '16:00', '17:00', '60'],
      ['R02', 'دورات مياه الموظفين', 'Staff Toilets', 'عدنان', '2', '08:30', '09:30', '14:30', '15:30', '', '', '60'],
      ['R03', 'الممرات والمداخل', 'Corridors', 'عدنان', '2', '09:00', '10:00', '13:00', '14:00', '', '', '60'],
      ['R04', 'مناطق الانتظار', 'Waiting Areas', 'عدنان', '2', '10:00', '11:00', '15:00', '16:00', '', '', '60'],
      ['R05', 'العيادات', 'Clinics', 'بلال', '1', '09:30', '10:30', '', '', '', '', '60'],
      ['R06', 'الطوارئ', 'Emergency', 'عبدالسلام', '2', '08:00', '09:00', '14:00', '15:00', '', '', '60'],
      ['R07', 'الأشعة', 'Radiology', 'بلال', '1', '10:00', '11:00', '', '', '', '', '60'],
      ['R08', 'المختبر', 'Laboratory', 'خالد', '1', '10:30', '11:30', '', '', '', '', '60'],
      ['R09', 'الصيدلية', 'Pharmacy', 'خالد', '1', '11:00', '12:00', '', '', '', '', '60'],
      ['R10', 'ثلاجة الأدوية', 'Pharmacy Fridge', 'خالد', '2', '08:00', '08:30', '16:00', '16:30', '', '', '30'],
      ['R11', 'عربات الأدوية', 'Medication Carts', 'خالد', '1', '11:30', '12:30', '', '', '', '', '60'],
      ['R12', 'التعقيم المركزي', 'CSSD', 'خالد', '1', '12:00', '13:00', '', '', '', '', '60'],
      ['R13', 'إدارة النفايات', 'Waste Management', 'عدنان', '1', '13:00', '14:00', '', '', '', '', '60'],
      ['R14', 'السلامة من الحريق', 'Fire Safety', 'بلال', '1', '14:00', '15:00', '', '', '', '', '90'],
      ['R15', 'الغازات الطبية', 'Medical Gases', 'عبدالسلام', '1', '09:00', '10:00', '', '', '', '', '60']
    ];
    
    await batchUpdate('Round_Schedule', scheduleData);
    
    res.json({ ok: true, message: 'Round_Schedule sheet created with 15 tasks', rows: scheduleData.length - 1 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get schedule for delay calculation
app.get('/api/rounds/schedule', async (req, res) => {
  try {
    const data = await getSheetData('Round_Schedule');
    if (!data || data.length === 0) {
      return res.json({ ok: true, schedule: [], message: 'Schedule not created yet. POST to /api/rounds/create-schedule first.' });
    }
    const headers = data[0];
    const schedule = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    res.json({ ok: true, schedule });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/master-tasks', async (req, res) => {
  try {
    const data = await getSheetData('MASTER_TASKS');
    if (!data || data.length === 0) {
      return res.json({ ok: true, tasks: [], headers: [] });
    }
    const headers = data[0];
    const tasks = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    res.json({ ok: true, tasks, headers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/log', async (req, res) => {
  try {
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: true, entries: [], headers: [] });
    }
    const headers = data[0];
    const entries = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    }).reverse();
    res.json({ ok: true, entries, headers });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return new Date(year, parseInt(month) - 1, parseInt(day));
  }
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(dateStr);
  }
  return new Date(dateStr);
}

app.get('/api/rounds/history', async (req, res) => {
  try {
    const { startDate, endDate, staff } = req.query;
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: true, entries: [] });
    }
    const headers = data[0];
    let entries = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      obj._parsedDate = parseSheetDate(obj.Date);
      return obj;
    });
    
    if (startDate) {
      const start = new Date(startDate);
      entries = entries.filter(e => e._parsedDate && e._parsedDate >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59);
      entries = entries.filter(e => e._parsedDate && e._parsedDate <= end);
    }
    if (staff) {
      entries = entries.filter(e => 
        e.Responsible_Role === staff || 
        e.Staff === staff || 
        e.Assigned_To === staff ||
        e.Execution_Responsible === staff
      );
    }
    
    entries.forEach(e => delete e._parsedDate);
    res.json({ ok: true, entries: entries.reverse() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

function isRealViolation(entry) {
  // 1. PRIORITY: If Is_Violation checkbox is explicitly set to "Yes" - definite violation
  const isViolationField = (entry.Is_Violation || entry.IsViolation || '').toLowerCase().trim();
  if (isViolationField === 'yes' || isViolationField === 'نعم') {
    return true;
  }
  
  // 2. If status is explicitly "خلل" (issue) - it's a violation
  if (entry.Status === 'خلل' || entry.Status === 'violation' || entry.Status === 'issue') {
    return true;
  }
  
  const negNotes = (entry.Negative_Notes || entry.NegativeNotes || '').trim();
  
  // 3. If Negative_Notes contains "نقاط الخلل:" - means checklist items were marked "لا" (No)
  if (negNotes.includes('نقاط الخلل:') || negNotes.includes('نقاط الخلل :')) {
    return true;
  }
  
  // 4. If there's an Execution_Responsible assigned AND negative notes exist
  const execResp = (entry.Execution_Responsible || entry.Exec_Responsible || '').trim();
  if (execResp && execResp !== '' && negNotes !== '') {
    return true;
  }
  
  // 5. No negative notes = NOT a violation
  if (!negNotes || negNotes === '') {
    return false;
  }
  
  // 6. Check for explicit negative keywords that indicate real problems
  const realIssueKeywords = [
    'عطل', 'معطل', 'مكسور', 'تالف', 'ناقص', 'غير متوفر', 'لا يعمل', 
    'يحتاج صيانة', 'يحتاج تصليح', 'خطير', 'متسخ جدا', 'رائحة كريهة'
  ];
  
  const hasRealIssue = realIssueKeywords.some(kw => negNotes.includes(kw));
  if (hasRealIssue) return true;
  
  // 7. Positive notes only are NOT violations
  const positiveOnlyKeywords = ['نظيف', 'جيد', 'ممتاز', 'سليم', 'يعمل', 'متوفر', 'مكتمل', 'خالي'];
  const seemsPositive = positiveOnlyKeywords.some(kw => negNotes.includes(kw));
  if (seemsPositive && !hasRealIssue) return false;
  
  return false;
}

app.get('/api/rounds/violations', async (req, res) => {
  try {
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: true, violations: [], resolved: [], repeated: [], summary: { total: 0, pending: 0, resolved: 0, byArea: {}, byStaff: {} } });
    }
    const headers = data[0];
    const entries = data.slice(1).map((row, idx) => {
      const obj = { _rowIndex: idx };
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    
    const allViolations = entries.filter(isRealViolation);
    
    // Separate resolved vs pending violations
    const resolvedViolations = allViolations.filter(v => v.Is_Resolved === 'Yes');
    const pendingViolations = allViolations.filter(v => v.Is_Resolved !== 'Yes');
    
    const violationCounts = {};
    const byArea = {};
    const byStaff = {};
    
    pendingViolations.forEach(v => {
      const area = v.Area || v.Round_Name || 'غير محدد';
      const staff = v.Responsible_Role || v.Execution_Responsible || 'غير محدد';
      const issue = v.Negative_Notes || v.NegativeNotes || '';
      
      byArea[area] = (byArea[area] || 0) + 1;
      byStaff[staff] = (byStaff[staff] || 0) + 1;
      
      const key = area + '|' + issue;
      if (!violationCounts[key]) {
        violationCounts[key] = { 
          area, 
          issue,
          count: 0, 
          dates: [],
          assignedTo: v.Execution_Responsible || v.Assigned_To || ''
        };
      }
      violationCounts[key].count++;
      violationCounts[key].dates.push(v.Date || v.Timestamp);
    });
    
    const repeated = Object.values(violationCounts).filter(v => v.count > 1);
    
    res.json({ 
      ok: true, 
      violations: pendingViolations,
      resolved: resolvedViolations,
      repeated,
      summary: {
        total: allViolations.length,
        pending: pendingViolations.length,
        resolved: resolvedViolations.length,
        byArea,
        byStaff
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/delayed', async (req, res) => {
  try {
    const data = await getSheetData('Rounds_Log');
    const tasksData = await getSheetData('MASTER_TASKS');
    
    if (!data || data.length === 0) {
      return res.json({ ok: true, delayed: [] });
    }
    
    const headers = data[0];
    const entries = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    
    const delayed = entries.filter(e => 
      e.Status === 'متأخر' || e.Status === 'delayed' || e.Status === 'late'
    );
    
    res.json({ ok: true, delayed: delayed.reverse() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/rounds/log', async (req, res) => {
  try {
    const { date, time, roundName, staff, execResponsible, status, positiveNotes, negativeNotes, actionsTaken, isViolation } = req.body;
    
    const now = new Date();
    const dateStr = date || now.toLocaleDateString('en-US') + ' ' + now.toLocaleTimeString('en-US', {hour12: false});
    
    const values = [
      dateStr,
      '',
      '1',
      roundName,
      '',
      time || now.toLocaleTimeString('ar-SA', {hour: '2-digit', minute: '2-digit'}),
      time || now.toLocaleTimeString('ar-SA', {hour: '2-digit', minute: '2-digit'}),
      '0',
      '60',
      status,
      status === 'متأخر' ? '🔔' : '',
      staff,
      execResponsible || '',
      positiveNotes || '',
      negativeNotes || '',
      actionsTaken || '',
      'N',
      '',
      isViolation || 'No'
    ];
    
    await appendRow('Rounds_Log', values);
    res.json({ ok: true, message: 'تم حفظ الجولة بنجاح' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Create Staff_Passcodes sheet with default passcodes
app.post('/api/rounds/create-passcodes', async (req, res) => {
  try {
    await createSheet('Staff_Passcodes');
    
    const passcodeData = [
      ['Staff_Name', 'Passcode', 'Role', 'Created_Date'],
      ['عدنان الرفاعي', '1234', 'مسؤول جولات', new Date().toLocaleDateString('en-US')],
      ['بلال نتو', '5678', 'مسؤول جولات', new Date().toLocaleDateString('en-US')],
      ['عبدالسلام الضوراني', '9012', 'مسؤول جولات', new Date().toLocaleDateString('en-US')],
      ['خالد الخطاب', '3456', 'مسؤول جولات', new Date().toLocaleDateString('en-US')]
    ];
    
    await batchUpdate('Staff_Passcodes', passcodeData);
    
    res.json({ 
      ok: true, 
      message: 'Staff_Passcodes sheet created',
      passcodes: passcodeData.slice(1).map(row => ({ name: row[0], code: row[1] }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Verify staff passcode
app.post('/api/rounds/verify-passcode', async (req, res) => {
  try {
    const { staffName, passcode } = req.body;
    
    const data = await getSheetData('Staff_Passcodes');
    if (!data || data.length < 2) {
      return res.json({ ok: false, verified: false, message: 'لم يتم إعداد الرموز السرية' });
    }
    
    const headers = data[0];
    const staffNameIndex = headers.indexOf('Staff_Name');
    const passcodeIndex = headers.indexOf('Passcode');
    
    // Flexible matching: check if staffName contains or is contained in stored name
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const storedName = row[staffNameIndex] || '';
      const storedCode = row[passcodeIndex] || '';
      
      // Check for exact match, partial match, or first name match
      const nameMatch = storedName === staffName || 
                       storedName.includes(staffName) || 
                       staffName.includes(storedName) ||
                       storedName.split(' ')[0] === staffName.split(' ')[0];
      
      if (nameMatch && storedCode === passcode) {
        return res.json({ ok: true, verified: true, message: 'تم التحقق بنجاح' });
      }
    }
    
    res.json({ ok: true, verified: false, message: 'الرمز السري غير صحيح' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Mark violation as resolved
app.post('/api/rounds/resolve-violation', async (req, res) => {
  try {
    const { rowIndex, staffName, resolvedBy, resolvedDate } = req.body;
    
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: false, message: 'لا توجد بيانات' });
    }
    
    const headers = data[0];
    
    // Find or add Is_Resolved column (column T = index 19)
    let resolvedColIndex = headers.indexOf('Is_Resolved');
    if (resolvedColIndex === -1) {
      resolvedColIndex = 19;
      await updateCell('Rounds_Log', 'T1', 'Is_Resolved');
    }
    
    // Find Resolved_By column (column U = index 20)
    let resolvedByColIndex = headers.indexOf('Resolved_By');
    if (resolvedByColIndex === -1) {
      resolvedByColIndex = 20;
      await updateCell('Rounds_Log', 'U1', 'Resolved_By');
    }
    
    // Find Resolved_Date column (column V = index 21)
    let resolvedDateColIndex = headers.indexOf('Resolved_Date');
    if (resolvedDateColIndex === -1) {
      resolvedDateColIndex = 21;
      await updateCell('Rounds_Log', 'V1', 'Resolved_Date');
    }
    
    // Update the row
    const actualRow = rowIndex + 2; // +1 for header, +1 for 1-based index
    await updateCell('Rounds_Log', `T${actualRow}`, 'Yes');
    await updateCell('Rounds_Log', `U${actualRow}`, resolvedBy || staffName);
    await updateCell('Rounds_Log', `V${actualRow}`, resolvedDate || new Date().toLocaleDateString('en-US'));
    
    res.json({ ok: true, message: 'تم تسجيل المعالجة بنجاح', row: actualRow });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get staff passcodes (for admin)
app.get('/api/rounds/passcodes', async (req, res) => {
  try {
    const data = await getSheetData('Staff_Passcodes');
    if (!data || data.length < 2) {
      return res.json({ ok: true, passcodes: [], message: 'لم يتم إعداد الرموز. استخدم POST /api/rounds/create-passcodes' });
    }
    
    const headers = data[0];
    const passcodes = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
    
    res.json({ ok: true, passcodes });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/staff', async (req, res) => {
  try {
    const data = await getSheetData('MASTER_TASKS');
    if (!data || data.length === 0) {
      return res.json({ ok: true, staff: [] });
    }
    
    const headers = data[0];
    const assignedToIndex = headers.findIndex(h => h === 'Assigned_To' || h === 'المسؤول');
    
    if (assignedToIndex === -1) {
      return res.json({ ok: true, staff: [] });
    }
    
    const staffSet = new Set();
    data.slice(1).forEach(row => {
      if (row[assignedToIndex]) {
        staffSet.add(row[assignedToIndex]);
      }
    });
    
    res.json({ ok: true, staff: Array.from(staffSet) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/staff-summary', async (req, res) => {
  try {
    const [tasksData, logData] = await Promise.all([
      getSheetData('MASTER_TASKS'),
      getSheetData('Rounds_Log')
    ]);
    
    if (!tasksData || tasksData.length === 0) {
      return res.json({ ok: true, staffSummary: [] });
    }
    
    const taskHeaders = tasksData[0];
    const tasks = tasksData.slice(1).map(row => {
      const obj = {};
      taskHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
    
    const logHeaders = logData?.[0] || [];
    const logs = (logData?.slice(1) || []).map(row => {
      const obj = {};
      logHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      obj._parsedDate = parseSheetDate(obj.Date);
      return obj;
    });
    
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-CA');
    const dayMap = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };
    const dayKey = dayMap[today.getDay()];
    
    const staffMap = {};
    
    tasks.forEach(t => {
      const staff = t.Assigned_To;
      if (!staff) return;
      
      if (!staffMap[staff]) {
        staffMap[staff] = {
          name: staff,
          todayTasks: 0,
          todayDone: 0,
          todayRemaining: 0,
          weeklyTotal: 0,
          topRounds: []
        };
      }
      
      const isToday = t[dayKey]?.toLowerCase() === 'yes';
      const roundsPerDay = parseInt(t.Rounds_Per_Day) || 1;
      
      if (isToday) {
        staffMap[staff].todayTasks += roundsPerDay;
        staffMap[staff].topRounds.push({
          taskId: t.TaskID,
          name: t.Round_Name_AR || t.Round_Name_EN,
          targetTime: t.Target_Time,
          allowedMin: t.Allowed_Time_Min,
          roundsRequired: roundsPerDay
        });
      }
      
      ['Sat','Sun','Mon','Tue','Wed','Thu'].forEach(d => {
        if (t[d]?.toLowerCase() === 'yes') {
          staffMap[staff].weeklyTotal += roundsPerDay;
        }
      });
    });
    
    const todayLogs = logs.filter(l => {
      if (!l._parsedDate) return false;
      return l._parsedDate.toLocaleDateString('en-CA') === todayStr;
    });
    
    Object.keys(staffMap).forEach(staff => {
      const staffLogs = todayLogs.filter(l => 
        l.Responsible_Role === staff || 
        l.Staff === staff || 
        l.Responsible_Role?.includes(staff) || 
        l.Staff?.includes(staff)
      );
      
      staffMap[staff].todayDone = staffLogs.length;
      staffMap[staff].todayRemaining = Math.max(0, staffMap[staff].todayTasks - staffLogs.length);
      
      staffMap[staff].topRounds.forEach(r => {
        const roundLogs = staffLogs.filter(l => 
          l.Area === r.name || 
          l.TaskID === r.taskId ||
          l.Round_Name === r.name ||
          l.Area?.includes(r.name?.substring(0, 20)) ||
          r.name?.includes(l.Area?.substring(0, 20))
        );
        r.done = roundLogs.length;
        r.remaining = Math.max(0, r.roundsRequired - roundLogs.length);
      });
    });
    
    res.json({ ok: true, staffSummary: Object.values(staffMap) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/checklist/:taskId', async (req, res) => {
  try {
    let { taskId } = req.params;
    // Normalize taskId - remove 'R' prefix if exists, then format correctly
    let numericId = taskId.toString().replace(/^R/i, '');
    const sheetPrefix = `R${numericId.toString().padStart(2, '0')}`;
    
    // Get all sheet names to find the correct one (e.g., R01_PublicToilets)
    const allSheetNames = await getSheetNames();
    const matchingSheet = allSheetNames.find(name => name.startsWith(sheetPrefix));
    
    const [checklistData, taskData] = await Promise.all([
      matchingSheet ? getSheetData(matchingSheet).catch(() => null) : Promise.resolve(null),
      getSheetData('MASTER_TASKS')
    ]);
    
    const taskHeaders = taskData[0];
    const tasks = taskData.slice(1).map(row => {
      const obj = {};
      taskHeaders.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
    const task = tasks.find(t => t.TaskID === taskId);
    
    if (!checklistData || checklistData.length === 0) {
      return res.json({ 
        ok: true, 
        task,
        checklist: [],
        responsibles: [task?.Responsible_1, task?.Responsible_2, task?.Responsible_3].filter(Boolean)
      });
    }
    
    const headers = checklistData[0];
    // Find the column index for Item_Description_AR or similar
    const itemColIndex = headers.findIndex(h => 
      h && (h.includes('Description') || h.includes('Item_Description') || 
            h.includes('البند') || h.includes('الوصف'))
    );
    const roundNameColIndex = headers.findIndex(h => h && h.includes('Round_Name'));
    
    // Use Item_Description_AR (index 3 typically) or fall back to column search
    const textCol = itemColIndex >= 0 ? itemColIndex : 3;
    const categoryCol = roundNameColIndex >= 0 ? roundNameColIndex : 1;
    
    const items = checklistData.slice(1).map((row, idx) => ({
      id: idx + 1,
      item: row[textCol] || '',
      category: row[categoryCol] || ''
    })).filter(item => item.item && item.item.trim() !== '');
    
    res.json({ 
      ok: true, 
      task,
      checklist: items,
      responsibles: [task?.Responsible_1, task?.Responsible_2, task?.Responsible_3, task?.Responsible_4, task?.Responsible_5].filter(Boolean)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/rounds/metrics', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const [logData, tasksData] = await Promise.all([
      getSheetData('Rounds_Log'),
      getSheetData('MASTER_TASKS')
    ]);
    
    if (!logData || logData.length === 0) {
      return res.json({ ok: true, metrics: { 
        totalRounds: 0, completed: 0, delayed: 0, violations: 0,
        complianceRate: 0, byDay: [], byArea: {}, byStaff: {}
      }});
    }
    
    const headers = logData[0];
    const allEntries = logData.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      obj._parsedDate = parseSheetDate(obj.Date);
      return obj;
    });
    
    // Filter entries by the specified period
    const entries = allEntries.filter(e => e._parsedDate && e._parsedDate >= cutoffDate);
    
    const totalRounds = entries.length;
    const completed = entries.filter(e => e.Status === 'مكتمل' || e.Status === 'في الوقت' || e.Status === 'completed').length;
    const delayed = entries.filter(e => e.Status === 'متأخر' || e.Status === 'delayed').length;
    const violations = entries.filter(isRealViolation).length;
    const complianceRate = totalRounds > 0 ? Math.round((completed / totalRounds) * 100) : 0;
    
    const byDay = {};
    const byArea = {};
    const byStaff = {};
    
    entries.forEach(e => {
      if (e._parsedDate) {
        const dayKey = e._parsedDate.toISOString().split('T')[0];
        if (!byDay[dayKey]) byDay[dayKey] = { total: 0, completed: 0, delayed: 0, violations: 0 };
        byDay[dayKey].total++;
        if (e.Status === 'مكتمل' || e.Status === 'في الوقت') byDay[dayKey].completed++;
        if (e.Status === 'متأخر') byDay[dayKey].delayed++;
        if (isRealViolation(e)) byDay[dayKey].violations++;
      }
      
      const area = e.Area || e.Round_Name || 'غير محدد';
      const staff = e.Responsible_Role || 'غير محدد';
      
      if (!byArea[area]) byArea[area] = { total: 0, completed: 0, delayed: 0 };
      byArea[area].total++;
      if (e.Status === 'مكتمل' || e.Status === 'في الوقت') byArea[area].completed++;
      if (e.Status === 'متأخر') byArea[area].delayed++;
      
      if (!byStaff[staff]) byStaff[staff] = { total: 0, completed: 0, delayed: 0 };
      byStaff[staff].total++;
      if (e.Status === 'مكتمل' || e.Status === 'في الوقت') byStaff[staff].completed++;
      if (e.Status === 'متأخر') byStaff[staff].delayed++;
    });
    
    const sortedDays = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, data]) => ({ date, ...data }));
    
    res.json({ 
      ok: true, 
      metrics: {
        totalRounds, completed, delayed, violations, complianceRate,
        byDay: sortedDays,
        byArea,
        byStaff
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// Complaints System API - Get Locations from Sheet (العمود F و G)
// ============================================
app.get('/api/complaints/locations', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: COMPLAINTS_SPREADSHEET_ID,
      range: 'Master!F:G', // Room Code و Room Description
    });
    
    const data = response.data.values || [];
    const locations = [];
    
    for (let i = 1; i < data.length; i++) {
      const code = (data[i][0] || '').trim(); // F = Room Code
      const name = (data[i][1] || '').trim(); // G = Room Description
      if (code && name) {
        locations.push({ code, name });
      }
    }
    
    res.json({ ok: true, locations });
  } catch (err) {
    console.error('Error fetching locations:', err.message);
    res.status(500).json({ ok: false, error: err.message, locations: [] });
  }
});

// ============================================
// Complaints System API - Get Routing & Escalation from Master
// ============================================
app.get('/api/complaints/routing', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: COMPLAINTS_SPREADSHEET_ID,
      range: 'Master!C:E', // Assign, type of complain, Escalation
    });
    
    const data = response.data.values || [];
    const routing = {};       // { "شكوى مالية": "أ. صابر عبده", ... }
    const escalationSet = new Set();
    const assignmentSet = new Set();
    
    for (let i = 1; i < data.length; i++) {
      const assignName = (data[i][0] || '').trim();    // C - Assign
      const complaintType = (data[i][1] || '').trim(); // D - type of complain
      const escName = (data[i][2] || '').trim();       // E - Escalation
      
      if (complaintType && assignName) {
        routing[complaintType] = assignName;
      }
      if (assignName) {
        assignmentSet.add(assignName);
      }
      if (escName) {
        escalationSet.add(escName);
      }
    }
    
    // ثابتين دائمًا للتصعيد
    escalationSet.add('حسين بابصيل');
    escalationSet.add('أ. بلال نتو');
    
    res.json({ 
      ok: true, 
      routing,
      assignment: Array.from(assignmentSet),
      escalation: Array.from(escalationSet)
    });
  } catch (err) {
    console.error('Error fetching routing:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// Complaints System API - Get Staff from Master
// ============================================
app.get('/api/complaints/staff', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: COMPLAINTS_SPREADSHEET_ID,
      range: 'Master!A:E', // Name, Passcode, Assign, Type, Escalation
    });
    
    const data = response.data.values || [];
    const staff = [];
    const assignmentSet = new Set();
    const escalationSet = new Set();
    
    for (let i = 1; i < data.length; i++) {
      const name = (data[i][0] || '').trim();   // A - اسم الموظف
      const pass = (data[i][1] || '').trim();   // B - الرقم السري
      const assign = (data[i][2] || '').trim(); // C - Assign
      const escName = (data[i][4] || '').trim(); // E - Escalation
      
      if (name) {
        staff.push({ name, hasCode: !!pass });
      }
      if (assign) {
        assignmentSet.add(assign);
      }
      if (escName) {
        escalationSet.add(escName);
      }
    }
    
    // ثابتين للتصعيد
    escalationSet.add('حسين بابصيل');
    escalationSet.add('أ. بلال نتو');
    
    res.json({ 
      ok: true, 
      staff,
      assignment: Array.from(assignmentSet),
      escalation: Array.from(escalationSet)
    });
  } catch (err) {
    console.error('Error fetching staff:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// Firebase Admin API - Complete User Deletion
// ============================================
app.delete('/api/admin/user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email is required' });
    }
    
    if (!firebaseAdmin) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin not initialized' });
    }
    
    let authDeleted = false;
    let authError = null;
    
    // Try to delete from Firebase Auth
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      await admin.auth().deleteUser(userRecord.uid);
      authDeleted = true;
      console.log(`Deleted user ${email} from Firebase Auth`);
    } catch (authErr) {
      if (authErr.code === 'auth/user-not-found') {
        authError = 'User not found in Auth';
        console.log(`User ${email} not found in Firebase Auth (already deleted or never existed)`);
      } else {
        authError = authErr.message;
        console.error(`Error deleting from Auth: ${authErr.message}`);
      }
    }
    
    res.json({ 
      ok: true, 
      message: authDeleted ? 'تم حذف المستخدم بالكامل من Firebase' : 'تم الحذف من Firestore فقط',
      authDeleted,
      authError
    });
  } catch (err) {
    console.error('Error in admin delete:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get all Firebase Auth users (for syncing)
app.get('/api/admin/auth-users', async (req, res) => {
  try {
    if (!firebaseAdmin) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin not initialized' });
    }
    
    const listUsersResult = await admin.auth().listUsers(1000);
    const users = listUsersResult.users.map(u => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName || '',
      disabled: u.disabled,
      createdAt: u.metadata.creationTime
    }));
    
    res.json({ ok: true, users });
  } catch (err) {
    console.error('Error listing auth users:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sync Firebase Auth users to Firestore staff_roles
app.post('/api/admin/sync-users', async (req, res) => {
  try {
    if (!firebaseAdmin) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin not initialized' });
    }
    
    const db = admin.firestore();
    const listUsersResult = await admin.auth().listUsers(1000);
    
    let synced = 0;
    let skipped = 0;
    let errors = [];
    
    for (const user of listUsersResult.users) {
      try {
        const docRef = db.collection('staff_roles').doc(user.uid);
        const docSnap = await docRef.get();
        
        if (!docSnap.exists) {
          // Check if there's a membership request
          const requestsSnap = await db.collection('membershipRequests')
            .where('uid', '==', user.uid)
            .limit(1)
            .get();
          
          let userData = {
            email: user.email || '',
            fullName: user.displayName || user.email?.split('@')[0] || 'Unknown',
            role: 'staff',
            status: 'active',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            syncedFromAuth: true
          };
          
          // If there's a membership request, use its data
          if (!requestsSnap.empty) {
            const reqData = requestsSnap.docs[0].data();
            userData.fullName = reqData.fullName || userData.fullName;
            userData.department = reqData.department || '';
            userData.jobTitle = reqData.jobTitle || '';
            userData.phone = reqData.phone || '';
          }
          
          await docRef.set(userData);
          synced++;
        } else {
          skipped++;
        }
      } catch (userErr) {
        errors.push({ email: user.email, error: userErr.message });
      }
    }
    
    res.json({ 
      ok: true, 
      message: `تمت المزامنة: ${synced} جديد، ${skipped} موجود مسبقاً`,
      synced,
      skipped,
      total: listUsersResult.users.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('Error syncing users:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Admin auth middleware - verify Firebase ID token
async function requireAdminAuth(req, res, next) {
  try {
    if (!firebaseAdmin) {
      return res.status(503).json({ ok: false, error: 'Firebase Admin not initialized' });
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: 'Unauthorized - No token provided' });
    }
    
    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Check if user is owner or admin
    const OWNER_EMAIL = 'husseinbabsail@gmail.com';
    if (decodedToken.email === OWNER_EMAIL) {
      req.user = decodedToken;
      return next();
    }
    
    // Check staff_roles for admin role
    const db = admin.firestore();
    const roleDoc = await db.collection('staff_roles').doc(decodedToken.uid).get();
    if (roleDoc.exists && ['owner', 'admin'].includes(roleDoc.data().role)) {
      req.user = decodedToken;
      return next();
    }
    
    return res.status(403).json({ ok: false, error: 'Forbidden - Admin access required' });
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
}

// Reset user password (send reset email)
app.post('/api/admin/users/:uid/reset-password', requireAdminAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const user = await admin.auth().getUser(uid);
    
    if (!user.email) {
      return res.status(400).json({ ok: false, error: 'User has no email' });
    }
    
    const resetLink = await admin.auth().generatePasswordResetLink(user.email);
    
    res.json({ 
      ok: true, 
      message: `تم إنشاء رابط إعادة تعيين كلمة السر`,
      email: user.email,
      resetLink
    });
  } catch (err) {
    console.error('Error resetting password:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Delete user completely (Auth + Firestore)
app.delete('/api/admin/users/:uid', requireAdminAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const db = admin.firestore();
    
    let authDeleted = false;
    let firestoreDeleted = false;
    let email = '';
    
    // Get user email first
    try {
      const user = await admin.auth().getUser(uid);
      email = user.email || '';
    } catch (e) {}
    
    // Delete from Firebase Auth
    try {
      await admin.auth().deleteUser(uid);
      authDeleted = true;
    } catch (e) {
      console.error('Auth delete error:', e.message);
    }
    
    // Delete from Firestore staff_roles
    try {
      await db.collection('staff_roles').doc(uid).delete();
      firestoreDeleted = true;
    } catch (e) {
      console.error('Firestore delete error:', e.message);
    }
    
    // Delete from membershipRequests if exists
    if (email) {
      try {
        const requestsSnap = await db.collection('membershipRequests')
          .where('email', '==', email).get();
        for (const doc of requestsSnap.docs) {
          await doc.ref.delete();
        }
      } catch (e) {}
    }
    
    res.json({ 
      ok: true, 
      message: 'تم حذف المستخدم بالكامل',
      authDeleted,
      firestoreDeleted
    });
  } catch (err) {
    console.error('Error deleting user:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update user status (active/suspended)
app.patch('/api/admin/users/:uid/status', requireAdminAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const { status } = req.body;
    
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    }
    
    const db = admin.firestore();
    await db.collection('staff_roles').doc(uid).update({ status });
    
    // Also disable/enable in Firebase Auth
    await admin.auth().updateUser(uid, { disabled: status === 'suspended' });
    
    res.json({ ok: true, message: `تم تحديث الحالة إلى ${status}` });
  } catch (err) {
    console.error('Error updating status:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update user role
app.patch('/api/admin/users/:uid/role', requireAdminAuth, async (req, res) => {
  try {
    const { uid } = req.params;
    const { role } = req.body;
    
    const validRoles = ['owner', 'admin', 'chair', 'member', 'staff', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role' });
    }
    
    const db = admin.firestore();
    await db.collection('staff_roles').doc(uid).update({ role });
    
    res.json({ ok: true, message: `تم تحديث الدور إلى ${role}` });
  } catch (err) {
    console.error('Error updating role:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Emergency Plan Documents API
app.get('/api/emergency-docs', async (req, res) => {
  try {
    const emergencyDocsSpreadsheetId = process.env.EMERGENCY_DOCS_SPREADSHEET_ID;
    if (!emergencyDocsSpreadsheetId) {
      throw new Error('EMERGENCY_DOCS_SPREADSHEET_ID not configured');
    }
    
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: emergencyDocsSpreadsheetId,
      range: 'A2:C100'
    });
    
    const rows = response.data.values || [];
    const documents = rows
      .filter(row => row[0] && row[2] && !row[0].startsWith('Sources'))
      .map(row => {
        const filename = row[0] || '';
        const desc = row[1] || filename;
        const url = row[2] || '';
        
        const typeMatch = filename.match(/EOC-([A-Z]+)-/);
        const type = typeMatch ? typeMatch[1] : 'other';
        
        const name = desc.replace(/-/g, '/');
        
        return { name, desc, type, url };
      });
    
    res.json({ ok: true, documents });
  } catch (err) {
    console.error('Error fetching emergency docs:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// EOC Emergency Plan Spreadsheet (Contains Room Codes + Reports Log)
const EOC_PLAN_SPREADSHEET_ID = '1tZeJs7bUELdoGgxxujaeKXSSSXLApPfmis3YrpaAVVA';

// EOC Drills API - Emergency Drills Log
const EOC_DRILLS_SPREADSHEET_ID = '1so2p5mp7Pe8A0TAaOCZvSHqWN6Df5NH___D0FouW_as';

// ============================================
// EOC Room Codes API - Get room codes from sheet
// ============================================
app.get('/api/eoc/room-codes', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
      range: 'تكويد الغرف!A2:C100'
    });
    
    const rows = response.data.values || [];
    const rooms = rows
      .filter(row => row[0])
      .map(row => ({
        code: row[0] || '',
        name: row[1] || '',
        floor: row[2] || ''
      }));
    
    res.json({ ok: true, rooms });
  } catch (err) {
    console.error('Error fetching room codes:', err.message);
    res.json({ 
      ok: true, 
      rooms: [
        { code: 'G01', name: 'المختبر', floor: 'الدور الأرضي' },
        { code: 'G02', name: 'مكاتب إدارية', floor: 'الدور الأرضي' },
        { code: 'G03', name: 'العلاج الطبيعي', floor: 'الدور الأرضي' },
        { code: 'G04', name: 'الأشعة', floor: 'الدور الأرضي' },
        { code: 'G05', name: 'الألتراساوند', floor: 'الدور الأرضي' },
        { code: 'F01', name: 'الاستقبال الرئيسي', floor: 'الدور الأول' },
        { code: 'F02', name: 'الباطنية', floor: 'الدور الأول' },
        { code: 'F03', name: 'العظام', floor: 'الدور الأول' },
        { code: 'F04', name: 'الطوارئ', floor: 'الدور الأول' },
        { code: 'F05', name: 'الطب العام', floor: 'الدور الأول' },
        { code: 'F06', name: 'الضماد', floor: 'الدور الأول' },
        { code: 'F07', name: 'النساء والولادة', floor: 'الدور الأول' },
        { code: 'S01', name: 'الأسنان', floor: 'الدور الثاني' },
        { code: 'S02', name: 'الباطنية 2', floor: 'الدور الثاني' },
        { code: 'S03', name: 'الباطنية 3', floor: 'الدور الثاني' }
      ]
    });
  }
});

// ============================================
// EOC Emergency Report API - Submit emergency report
// ============================================
app.post('/api/eoc/report', async (req, res) => {
  try {
    const { disasterType, location, notes } = req.body;
    
    // Validate required fields
    if (!disasterType || typeof disasterType !== 'string' || disasterType.trim() === '') {
      return res.status(400).json({ ok: false, error: 'نوع الطوارئ مطلوب' });
    }
    if (!location || typeof location !== 'string' || location.trim() === '') {
      return res.status(400).json({ ok: false, error: 'الموقع مطلوب' });
    }
    
    const validDisasterTypes = ['حريق', 'انقطاع كهرباء', 'تسرب مياه', 'إغماء/إصابة', 'تفشي عدوى', 'أخرى'];
    if (!validDisasterTypes.includes(disasterType)) {
      return res.status(400).json({ ok: false, error: 'نوع الطوارئ غير صالح' });
    }
    
    const reportId = 'EMR-' + Date.now();
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-SA');
    const timeStr = now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
    
    const sheets = await getGoogleSheetsClient();
    let appendSuccess = false;
    
    // Try to append to Reports_Log sheet
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
        range: 'بلاغات_الطوارئ!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[reportId, dateStr, timeStr, disasterType.trim(), location.trim(), (notes || '').trim(), 'جديد']]
        }
      });
      appendSuccess = true;
    } catch (sheetErr) {
      // If sheet doesn't exist, create it
      console.log('Creating emergency reports sheet...', sheetErr.message);
      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: 'بلاغات_الطوارئ' }
              }
            }]
          }
        });
        
        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
          range: 'بلاغات_الطوارئ!A1:G1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [['رقم البلاغ', 'التاريخ', 'الوقت', 'نوع الطوارئ', 'الموقع', 'ملاحظات', 'الحالة']]
          }
        });
        
        // Append the report
        await sheets.spreadsheets.values.append({
          spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
          range: 'بلاغات_الطوارئ!A:G',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[reportId, dateStr, timeStr, disasterType.trim(), location.trim(), (notes || '').trim(), 'جديد']]
          }
        });
        appendSuccess = true;
      } catch (createErr) {
        console.error('Error creating sheet:', createErr.message);
        return res.status(500).json({ ok: false, error: 'فشل في حفظ البلاغ: ' + createErr.message });
      }
    }
    
    if (!appendSuccess) {
      return res.status(500).json({ ok: false, error: 'فشل في حفظ البلاغ في النظام' });
    }
    
    console.log(`Emergency report submitted: ${reportId} - ${disasterType} at ${location}`);
    res.json({ ok: true, reportId, message: 'تم إرسال البلاغ بنجاح' });
  } catch (err) {
    console.error('Error submitting report:', err.message);
    res.status(500).json({ ok: false, error: 'حدث خطأ في النظام: ' + err.message });
  }
});

// ============================================
// EOC Emergency Reports List API
// ============================================
app.get('/api/eoc/reports', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: EOC_PLAN_SPREADSHEET_ID,
      range: 'بلاغات_الطوارئ!A2:G100'
    });
    
    const rows = response.data.values || [];
    const reports = rows
      .filter(row => row[0])
      .map(row => ({
        id: row[0] || '',
        date: row[1] || '',
        time: row[2] || '',
        type: row[3] || '',
        location: row[4] || '',
        notes: row[5] || '',
        status: row[6] || 'جديد'
      }))
      .reverse();
    
    res.json({ ok: true, reports });
  } catch (err) {
    console.error('Error fetching reports:', err.message);
    // Return empty array only if sheet doesn't exist
    if (err.message && err.message.includes('Unable to parse range')) {
      res.json({ ok: true, reports: [], message: 'لا توجد بلاغات بعد' });
    } else {
      res.status(500).json({ ok: false, error: 'فشل في جلب البلاغات: ' + err.message, reports: [] });
    }
  }
});

app.get('/api/eoc/drills', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: EOC_DRILLS_SPREADSHEET_ID,
      range: 'A2:F50'
    });
    
    const rows = response.data.values || [];
    const drills = rows
      .filter(row => row[0])
      .map(row => ({
        date: row[0] || '',
        type: row[1] || 'تمرين إخلاء',
        location: row[2] || '',
        participants: row[3] || '',
        result: row[4] || 'ناجح',
        notes: row[5] || ''
      }));
    
    res.json({ ok: true, drills });
  } catch (err) {
    console.error('Error fetching EOC drills:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// EOC Log Drill - Record new drill
app.post('/api/eoc/drills', async (req, res) => {
  try {
    const { date, type, location, participants, result, notes } = req.body;
    const sheets = await getGoogleSheetsClient();
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: EOC_DRILLS_SPREADSHEET_ID,
      range: 'A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[date, type, location, participants, result, notes]]
      }
    });
    
    res.json({ ok: true, message: 'Drill logged successfully' });
  } catch (err) {
    console.error('Error logging drill:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================
// Owner Dashboard Stats API - Direct from Sheets
// ============================================
app.get('/api/owner/stats', async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    
    // Get complaints stats
    const complaintsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: COMPLAINTS_SPREADSHEET_ID,
      range: 'Complaints_Log!R2:R1000' // Status column
    });
    
    const statuses = (complaintsRes.data.values || []).flat();
    const openComplaints = statuses.filter(s => 
      s && s !== 'closed' && s !== 'مغلق' && s !== 'مغلقة'
    ).length;
    const totalComplaints = statuses.length;
    
    // Get today's date in Saudi timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    
    res.json({
      ok: true,
      complaints: {
        open: openComplaints,
        total: totalComplaints,
        needsFollowup: openComplaints
      },
      incidents: { open: 0, total: 0 },
      risks: { active: 0, total: 0 },
      rounds: { today: 0, completed: 0, delayed: 0 },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching owner stats:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Static file serving - github-deploy folder first
app.use(express.static(path.join(__dirname, 'github-deploy'), {
  extensions: ['html'],
  index: 'index.html'
}));

// Then root folder as fallback
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

app.use((req, res) => {
  const requestedPath = req.path;
  if (!requestedPath.includes('.')) {
    const htmlPath = path.join(__dirname, requestedPath + '.html');
    if (fs.existsSync(htmlPath)) {
      res.sendFile(htmlPath);
    } else {
      res.sendFile(path.join(__dirname, 'index.html'));
    }
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
