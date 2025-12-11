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

app.get('/api/rounds/violations', async (req, res) => {
  try {
    const data = await getSheetData('Rounds_Log');
    if (!data || data.length === 0) {
      return res.json({ ok: true, violations: [], repeated: [] });
    }
    const headers = data[0];
    const entries = data.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = row[i] || '';
      });
      return obj;
    });
    
    const violations = entries.filter(e => 
      e.Status === 'خلل' || e.Status === 'violation' || e.NegativeNotes || e.Negative_Notes
    );
    
    const violationCounts = {};
    violations.forEach(v => {
      const key = (v.Area || v.Round_Name || '') + '|' + (v.NegativeNotes || v.Negative_Notes || '');
      if (!violationCounts[key]) {
        violationCounts[key] = { 
          area: v.Area || v.Round_Name, 
          issue: v.NegativeNotes || v.Negative_Notes,
          count: 0, 
          dates: [],
          assignedTo: v.Exec_Responsible || v.Assigned_To || ''
        };
      }
      violationCounts[key].count++;
      violationCounts[key].dates.push(v.Date || v.Timestamp);
    });
    
    const repeated = Object.values(violationCounts).filter(v => v.count > 1);
    
    res.json({ ok: true, violations, repeated });
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
    const { date, time, roundName, staff, execResponsible, status, notes, checklistResults } = req.body;
    
    const timestamp = new Date().toISOString();
    const values = [
      timestamp,
      date || new Date().toLocaleDateString('ar-SA'),
      time || new Date().toLocaleTimeString('ar-SA'),
      roundName,
      staff,
      execResponsible || '',
      status,
      notes || '',
      JSON.stringify(checklistResults || {})
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
