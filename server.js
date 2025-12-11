import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getSheetData, appendRow, updateCell, getSheetNames } from './sheets-service.js';

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

// Debug endpoint to see raw sheet data
app.get('/api/debug/sheet/:name', async (req, res) => {
  try {
    const data = await getSheetData(req.params.name);
    res.json({ ok: true, headers: data[0], sampleRows: data.slice(1, 5), totalRows: data.length - 1 });
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
  if (entry.Status === 'خلل' || entry.Status === 'violation') return true;
  
  const notes = (entry.Negative_Notes || entry.NegativeNotes || '').toLowerCase();
  if (!notes || notes.trim() === '') return false;
  
  const positiveKeywords = ['نظيف', 'جيد', 'ممتاز', 'خالي', 'خالية', 'سليم', 'سليمة', 'يعمل', 'تعمل', 'متوفر', 'متوفرة', 'مكتمل', 'مكتملة', 'لا يوجد خلل', 'لا توجد مخالفات'];
  const negativeKeywords = ['خلل', 'مخالفة', 'عطل', 'معطل', 'ناقص', 'غير نظيف', 'متسخ', 'مكسور', 'تالف', 'يحتاج صيانة', 'ينطلب', 'قديم جدا', 'لا يعمل', 'غير متوفر'];
  
  const hasPositive = positiveKeywords.some(kw => notes.includes(kw));
  const hasNegative = negativeKeywords.some(kw => notes.includes(kw));
  
  if (hasNegative && !hasPositive) return true;
  if (hasPositive && !hasNegative) return false;
  
  return false;
}

app.get('/api/rounds/violations', async (req, res) => {
  try {
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: true, violations: [], repeated: [], summary: { total: 0, byArea: {}, byStaff: {} } });
    }
    const headers = data[0];
    const entries = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    
    const violations = entries.filter(isRealViolation);
    
    const violationCounts = {};
    const byArea = {};
    const byStaff = {};
    
    violations.forEach(v => {
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
      violations, 
      repeated,
      summary: {
        total: violations.length,
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
    const { date, time, roundName, staff, execResponsible, status, positiveNotes, negativeNotes, actionsTaken } = req.body;
    
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
      ''
    ];
    
    await appendRow('Rounds_Log', values);
    res.json({ ok: true, message: 'تم حفظ الجولة بنجاح' });
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

// Static file serving
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
