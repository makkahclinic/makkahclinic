  /**
   * نظام الجودة المتكامل - Google Apps Script
   * مجمع مكة الطبي بالزاهر
   * 
   * يشمل:
   * - نظام جولات السلامة
   * - نظام الاجتماعات واللجان
   * - نظام حوادث سلامة المرضى
   */
  
  const SPREADSHEET_ID = '1JB-I7_r6MiafNFkqau4U7ZJFFooFodObSMVLLm8LRRc';
  
  function doPost(e) {
    try {
      const body = JSON.parse(e.postData.contents);
      const action = body.action;
      const payload = body.payload || {};
      
      let result;
      
      switch (action) {
        case 'getHomeData':
          result = getHomeData();
          break;
        case 'getRoundsLog':
          result = getRoundsLog(payload.limit || 100);
          break;
        case 'logRound':
          result = logRound(payload);
          break;
        case 'getMasterTasks':
          result = getMasterTasks();
          break;
        case 'getStaff':
          result = getStaff();
          break;
        case 'getStaffSummary':
          result = getStaffSummary();
          break;
        case 'getDelayed':
          result = getDelayed();
          break;
        case 'getViolations':
          result = getViolations();
          break;
        case 'getHistory':
          result = getHistory(payload);
          break;
        case 'getMetrics':
          result = getMetrics(payload.days || 14);
          break;
        case 'getChecklist':
          result = getChecklist(payload.taskId);
          break;
        case 'verifyPasscode':
          result = verifyPasscode(payload.staffName, payload.passcode);
          break;
        case 'resolveViolation':
          result = resolveViolation(payload);
          break;
        case 'debug':
          result = debugInfo();
          break;
        // Committee Meeting APIs
        case 'getMeetingData':
          result = getMeetingData(payload.committee);
          break;
        case 'saveMeeting':
          result = saveMeeting(payload);
          break;
        case 'getMeetingRecommendations':
          result = getMeetingRecommendations(payload.committee);
          break;
        case 'getDelayedMeetings':
          result = getDelayedMeetings(payload.committee);
          break;
        case 'closeMeetingRecommendation':
          result = closeMeetingRecommendation(payload);
          break;
        case 'getMeetingsArchive':
          result = getMeetingsArchive(payload);
          break;
        case 'getMeetingsDashboard':
          result = getMeetingsDashboard(payload.year);
          break;
        // Patient Safety Incidents APIs
        case 'submitIncident':
          result = submitIncident(payload);
          break;
        case 'getIncidents':
          result = getIncidents(payload);
          break;
        case 'getIncidentDetails':
          result = getIncidentDetails(payload.incidentId);
          break;
        case 'updateIncidentStatus':
          result = updateIncidentStatus(payload);
          break;
        case 'getIncidentStats':
          result = getIncidentStats(payload);
          break;
        case 'addIncidentFollowup':
          result = addIncidentFollowup(payload);
          break;
        case 'getIncidentStaff':
          result = getIncidentStaff();
          break;
        case 'verifyIncidentPasscode':
          result = verifyIncidentPasscode(payload.staffName, payload.passcode);
          break;
        case 'getEscalationList':
          result = getEscalationList();
          break;
        case 'assignIncident':
          result = assignIncident(payload);
          break;
        case 'escalateIncident':
          result = escalateIncident(payload);
          break;
        case 'closeIncident':
          result = closeIncident(payload);
          break;
        case 'saveRCA':
          result = saveRCA(payload);
          break;
        // Complaints APIs
        case 'submitComplaint':
          result = submitComplaint(payload);
          break;
        case 'getComplaintStaff':
          result = getComplaintStaff();
          break;
        case 'verifyComplaintPasscode':
          result = verifyComplaintPasscode(payload.staffName, payload.passcode);
          break;
        case 'getComplaintStats':
          result = getComplaintStats(payload);
          break;
        case 'getComplaints':
          result = getComplaints(payload);
          break;
        case 'getComplaintDetails':
          result = getComplaintDetails(payload.complaintId);
          break;
        case 'updateComplaint':
          result = updateComplaint(payload);
          break;
        case 'getComplaintHistory':
          result = getComplaintHistory(payload.complaintId);
          break;
        case 'getComplaintAssignmentList':
          result = getComplaintAssignmentList();
          break;
        case 'getComplaintEscalationList':
          result = getComplaintEscalationList();
          break;
        default:
          throw new Error('Unknown action: ' + action);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ ok: true, ...result }))
        .setMimeType(ContentService.MimeType.JSON);
        
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  function doGet(e) {
    // تجهيز الشيتات تلقائياً
    ensureEocReady_();
    
    const p = e && e.parameter ? e.parameter : {};
    const action = p.action;
    const callback = p.callback;
    
    function output_(obj) {
      const json = JSON.stringify(obj);
      if (callback) {
        const safe = String(callback).replace(/[^\w$.]/g, '');
        return ContentService.createTextOutput(safe + '(' + json + ');')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // EOC Config APIs
    if (action === 'getBuildingConfig') {
      return output_(getBuildingConfig());
    }
    
    if (action === 'getScenarioGuides') {
      return output_(getScenarioGuides());
    }
    
    if (action === 'getScenarioProfiles') {
      return output_(getScenarioProfiles());
    }
    
    if (action === 'getTrainingRoster') {
      return output_(getTrainingRoster());
    }
    
    if (action === 'logTrainingSession') {
      return output_(logTrainingSession(p));
    }
    
    if (action === 'saveTrainingSession') {
      return output_(logTrainingSession(p));
    }
    
    if (action === 'getTrainingSessions') {
      return output_(getTrainingSessions(p));
    }
    
    // Aliases (compatibility)
    if (action === 'getDrillLog') {
      return output_(getTrainingSessions(p));
    }
    
    if (action === 'updateEmergencyReportStatus') {
      return output_(updateEmergencyReportStatus(p));
    }
    
    if (action === 'debug') {
      const result = debugInfo();
      return output_({ ok: true, ...result });
    }
    
    if (action === 'submitEmergencyReport') {
      const result = submitEmergencyReport(p);
      return output_(result);
    }
    
    if (action === 'getEmergencyReports') {
      const result = getEmergencyReports(p);
      return output_(result);
    }
    
    if (action === 'updateEmergencyStatus') {
      const result = updateEmergencyReportStatus(p);
      return output_(result);
    }
    
    if (action === 'getEmergencyAnalytics') {
      const result = getEmergencyAnalytics();
      return output_(result);
    }
    
    if (action === 'getEmergencyStaff') {
      const result = getEmergencyStaff();
      return output_(result);
    }
    
    if (action === 'setActiveCommand') {
      const result = setActiveCommand(p);
      return output_(result);
    }
    
    if (action === 'getActiveCommand') {
      const result = getActiveCommand();
      return output_(result);
    }
    
    if (action === 'getRoomCodes') {
      const result = getRoomCodes();
      return output_(result);
    }
    
    if (action === 'clearActiveCommand') {
      const result = clearActiveCommand();
      return output_(result);
    }

    if (action === 'closeActiveCommand') {
      const result = closeActiveCommand(p);
      return output_(result);
    }
    
    if (action === 'getEocDrills') {
      const result = getEocDrills(p);
      return output_(result);
    }
    
    return output_({ ok: false, error: 'Unknown action: ' + (action || '') });
  }
  
  // Emergency Report Functions
  // الشيت الرئيسي للطوارئ والإخلاء
  const EOC_SPREADSHEET_ID = '1tZeJs7bUELdoGgxxujaeKXSSSXLApPfmis3YrpaAVVA';

  /******************** EOC BOOTSTRAP ********************/
  const EOC_BOOTSTRAP_VERSION = 2;

  // أسماء الشيتات
  const SHEET_MAP = 'EOC_MAP';
  const SHEET_MUSTER = 'EOC_MUSTER';
  const SHEET_SCENARIOS = 'EOC_SCENARIOS';
  const SHEET_ROSTER = 'Training_Roster';
  const SHEET_TRAINING_LOG = 'Training_Log';
  const SHEET_ACTIVE_CMD = 'أوامر_نشطة';
  const SHEET_PROFILE = 'EOC_PROFILE';

  // هيدرز
  const HEADERS_MAP = ['floor_order','floor_key','floor_name','dept_id','dept_name','dept_icon','active'];
  const HEADERS_MUSTER = ['key','name','description','active'];
  const HEADERS_SCEN = ['scenario_key','scenario_label','bucket','step_no','icon','text','active'];
  const HEADERS_ROSTER = ['name','department','role','active'];
  const HEADERS_TRAINING = ['session_id','date','start_time','end_time','duration_min','scenario_key','scenario_label','trainer','attendees','notes'];
  const HEADERS_ACTIVE = ['active','responseType','reportType','location','muster','timestamp','mode','scenarioKey','scenarioLabel','sessionId','trainer'];
  const HEADERS_PROFILE = ['scenario_key','scenario_label','icon','color','default_responseType','body_class','active'];

  function ensureEocReady_() {
    const props = PropertiesService.getScriptProperties();
    const v = Number(props.getProperty('EOC_BOOTSTRAP_VERSION') || '0');
    if (v === EOC_BOOTSTRAP_VERSION) return;

    setupEocWorkbook_();
    props.setProperty('EOC_BOOTSTRAP_VERSION', String(EOC_BOOTSTRAP_VERSION));
  }

  function setupEocWorkbook_() {
    const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);

    const shMap = ensureSheet_(ss, SHEET_MAP, HEADERS_MAP);
    const shMuster = ensureSheet_(ss, SHEET_MUSTER, HEADERS_MUSTER);
    const shScen = ensureSheet_(ss, SHEET_SCENARIOS, HEADERS_SCEN);
    const shProfile = ensureSheet_(ss, SHEET_PROFILE, HEADERS_PROFILE);
    ensureSheet_(ss, SHEET_ROSTER, HEADERS_ROSTER);
    ensureSheet_(ss, SHEET_TRAINING_LOG, HEADERS_TRAINING);
    ensureSheet_(ss, SHEET_ACTIVE_CMD, HEADERS_ACTIVE);

    if (shMap.getLastRow() === 1) seedMap_(shMap);
    if (shMuster.getLastRow() === 1) {
      shMuster.appendRow(['A','نقطة تجمع A','الموقف الأمامي','نعم']);
      shMuster.appendRow(['B','نقطة تجمع B','الساحة الخلفية','نعم']);
    }
    if (shScen.getLastRow() === 1) seedScenarios_(shScen);
    if (shProfile.getLastRow() === 1) seedProfiles_(shProfile);
  }

  function seedProfiles_(sh) {
    const rows = [
      ['fire','حريق','fa-fire','#ef4444','full_evacuation','fire','نعم'],
      ['power','انقطاع كهرباء','fa-bolt','#f59e0b','send_team','power','نعم'],
      ['water','تسرب مياه','fa-tint','#0ea5e9','send_team','water','نعم'],
      ['injury','إغماء/إصابة','fa-heartbeat','#dc2626','send_team','injury','نعم'],
      ['outbreak','تفشي عدوى','fa-virus','#8b5cf6','isolation_evacuation','infection','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }

  function ensureSheet_(ss, name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }

  function seedMap_(sh) {
    const rows = [
      [2,'2','الدور الثاني','dental','الأسنان','fa-tooth','نعم'],
      [2,'2','الدور الثاني','internal2','الباطنية 2','fa-stethoscope','نعم'],
      [2,'2','الدور الثاني','internal3','الباطنية 3','fa-stethoscope','نعم'],
      [1,'1','الدور الأول','reception','الاستقبال','fa-concierge-bell','نعم'],
      [1,'1','الدور الأول','internal1','الباطنية','fa-stethoscope','نعم'],
      [1,'1','الدور الأول','ortho','العظام','fa-bone','نعم'],
      [1,'1','الدور الأول','emergency','الطوارئ','fa-ambulance','نعم'],
      [1,'1','الدور الأول','general','الطب العام','fa-user-md','نعم'],
      [1,'1','الدور الأول','dressing','الضماد','fa-band-aid','نعم'],
      [1,'1','الدور الأول','obgyn','النساء والولادة','fa-baby','نعم'],
      [1,'1','الدور الأول','menreception','استقبال رجال','fa-male','نعم'],
      [1,'1','الدور الأول','womenreception','استقبال نساء','fa-female','نعم'],
      [0,'0','الدور الأرضي','lab','المختبر','fa-flask','نعم'],
      [0,'0','الدور الأرضي','admin','مكاتب إدارية','fa-building','نعم'],
      [0,'0','الدور الأرضي','physio','العلاج الطبيعي','fa-walking','نعم'],
      [0,'0','الدور الأرضي','xray','الأشعة','fa-x-ray','نعم'],
      [0,'0','الدور الأرضي','ultrasound','الألتراساوند','fa-wave-square','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }

  function seedScenarios_(sh) {
    const rows = [
      ['fire','حريق','DO',1,'fa-bolt','أبعد الأشخاص من الخطر فورًا.','نعم'],
      ['fire','حريق','DO',2,'fa-bell','فعّل الإنذار واتبع مسار الإخلاء.','نعم'],
      ['fire','حريق','DO',3,'fa-door-closed','أغلق الأبواب لاحتواء الدخان.','نعم'],
      ['fire','حريق','DONT',1,'fa-elevator','لا تستخدم المصاعد.','نعم'],
      ['fire','حريق','DONT',2,'fa-hand','لا تفتح بابًا ساخنًا.','نعم'],
      ['power','انقطاع كهرباء','DO',1,'fa-battery-full','ثبّت الأجهزة الحرجة على UPS/بطاريات.','نعم'],
      ['power','انقطاع كهرباء','DO',2,'fa-tools','بلّغ الصيانة وEOC لتأكيد تشغيل المولد.','نعم'],
      ['power','انقطاع كهرباء','DONT',1,'fa-plug','لا تشغّل أحمال إضافية بدون توجيه.','نعم'],
      ['water','تسرب مياه','DO',1,'fa-triangle-exclamation','أبعد الناس عن منطقة التسرب.','نعم'],
      ['water','تسرب مياه','DO',2,'fa-bolt','افصل الكهرباء عن المنطقة إن لزم.','نعم'],
      ['water','تسرب مياه','DONT',1,'fa-plug-circle-xmark','لا تلمس مقابس/أسلاك قرب الماء.','نعم'],
      ['injury','إغماء/إصابة','DO',1,'fa-user-check','أمّن المكان وافحص الاستجابة والتنفس.','نعم'],
      ['injury','إغماء/إصابة','DO',2,'fa-phone','اطلب المساعدة وأحضر AED إن توفر.','نعم'],
      ['injury','إغماء/إصابة','DONT',1,'fa-arrows-up-down-left-right','لا تحرك المصاب مع اشتباه العمود الفقري.','نعم'],
      ['outbreak','تفشي عدوى','DO',1,'fa-lock','عزل فوري للحالة/المنطقة وتقييد الدخول.','نعم'],
      ['outbreak','تفشي عدوى','DO',2,'fa-mask-face','استخدم معدات الوقاية المناسبة.','نعم'],
      ['outbreak','تفشي عدوى','DONT',1,'fa-people-group','لا تسمح بتجمعات داخل منطقة العزل.','نعم'],
    ];
    sh.getRange(2,1,rows.length,rows[0].length).setValues(rows);
  }
  /******************** END BOOTSTRAP ********************/

  /******************** EOC CONFIG APIs ********************/
  function getBuildingConfig() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const mapSh = ss.getSheetByName(SHEET_MAP);
      const mustSh = ss.getSheetByName(SHEET_MUSTER);
      const map = mapSh ? mapSh.getDataRange().getValues() : [];
      const mus = mustSh ? mustSh.getDataRange().getValues() : [];

      const floorsByKey = {};
      for (let i=1; i<map.length; i++){
        const r = map[i];
        const active = String(r[6]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        const floorOrder = Number(r[0]);
        const floorKey = String(r[1]||'').trim();
        const floorName = String(r[2]||'').trim();
        const deptId = String(r[3]||'').trim();
        const deptName = String(r[4]||'').trim();
        const deptIcon = String(r[5]||'').trim();
        const k = floorKey || String(floorOrder);
        if (!floorsByKey[k]) floorsByKey[k] = { floorOrder, floorKey: k, floorName, departments: [] };
        floorsByKey[k].departments.push({ id: deptId, name: deptName, icon: deptIcon });
      }
      const floors = Object.values(floorsByKey).sort((a,b)=>b.floorOrder-a.floorOrder);

      const muster = [];
      for (let i=1; i<mus.length; i++){
        const r = mus[i];
        const active = String(r[3]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        muster.push({ key: String(r[0]||'').trim(), name: String(r[1]||'').trim(), desc: String(r[2]||'').trim() });
      }
      return { ok:true, floors, muster };
    } catch(err){ return { ok:false, error: err.message }; }
  }

  function getScenarioGuides() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_SCENARIOS);
      const data = sh ? sh.getDataRange().getValues() : [];
      const out = {};
      for (let i=1; i<data.length; i++){
        const r = data[i];
        const active = String(r[6]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        const key = String(r[0]||'').trim();
        const label = String(r[1]||'').trim();
        const bucket = String(r[2]||'').trim();
        const stepNo = Number(r[3]||0);
        const icon = String(r[4]||'').trim();
        const text = String(r[5]||'').trim();
        if (!out[key]) out[key] = { key, label, DO: [], DONT: [] };
        out[key].label = label;
        out[key][bucket] = out[key][bucket] || [];
        out[key][bucket].push({ stepNo, icon, text });
      }
      Object.values(out).forEach(s=>{
        if (s.DO) s.DO.sort((a,b)=>a.stepNo-b.stepNo);
        if (s.DONT) s.DONT.sort((a,b)=>a.stepNo-b.stepNo);
      });
      return { ok:true, scenarios: out };
    } catch(err){ return { ok:false, error: err.message }; }
  }

  function getEmergencyStaff() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName('Staff');
      if (!sh) return { ok: true, staff: [] };

      const data = sh.getDataRange().getValues();
      const staff = [];
      for (let i = 1; i < data.length; i++) {
        const name = String(data[i][0] || '').trim();
        const phone = String(data[i][1] || '').trim();
        if (name && phone) {
          staff.push({ name, phone });
        }
      }
      return { ok: true, staff };
    } catch (err) {
      return { ok: false, error: err.message, staff: [] };
    }
  }

  function getScenarioProfiles() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_PROFILE);
      if (!sh) return { ok: true, profiles: {} };

      const data = sh.getDataRange().getValues();
      const profiles = {};
      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const active = String(r[6] || '').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;

        const key = String(r[0] || '').trim();
        if (!key) continue;

        profiles[key] = {
          scenarioKey: key,
          scenarioLabel: String(r[1] || '').trim(),
          icon: String(r[2] || '').trim(),
          color: String(r[3] || '').trim(),
          defaultResponseType: String(r[4] || '').trim(),
          bodyClass: String(r[5] || '').trim(),
        };
      }
      return { ok: true, profiles };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function getTrainingRoster() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sh = ss.getSheetByName(SHEET_ROSTER);

      // إذا لم يوجد أو فارغ، حاول الاستيراد من Staff
      if (!sh || sh.getLastRow() <= 1) {
        importRosterFromStaff_(ss);
        sh = ss.getSheetByName(SHEET_ROSTER);
      }

      if (!sh) return { ok: true, roster: [] };
      const data = sh.getDataRange().getValues();
      const roster = [];
      for (let i=1; i<data.length; i++){
        const r = data[i];
        const active = String(r[3]||'').trim();
        if (active && active !== 'نعم' && active.toLowerCase() !== 'yes' && active !== 'true' && active !== '1') continue;
        roster.push({ name: String(r[0]||'').trim(), department: String(r[1]||'').trim(), role: String(r[2]||'').trim() });
      }
      return { ok: true, roster };
    } catch(err){ return { ok: false, error: err.message }; }
  }

  /** استيراد قائمة المتدربين من شيت Staff إذا كان Training_Roster فارغاً */
  function importRosterFromStaff_(ss) {
    try {
      const staffSh = ss.getSheetByName('Staff');
      if (!staffSh || staffSh.getLastRow() <= 1) return;

      let rosterSh = ss.getSheetByName(SHEET_ROSTER);
      if (!rosterSh) {
        rosterSh = ss.insertSheet(SHEET_ROSTER);
        rosterSh.getRange(1,1,1,4).setValues([['الاسم', 'القسم', 'الدور', 'نشط']]);
      }

      // اقرأ Staff (A=اسم، B=رقم/قسم)
      const staffData = staffSh.getDataRange().getValues();
      const rows = [];
      for (let i = 1; i < staffData.length; i++) {
        const name = String(staffData[i][0] || '').trim();
        const dept = String(staffData[i][1] || '').trim();
        if (name) {
          rows.push([name, dept, '', 'نعم']);
        }
      }

      if (rows.length > 0) {
        rosterSh.getRange(2, 1, rows.length, 4).setValues(rows);
      }
    } catch (e) {
      Logger.log('importRosterFromStaff_ error: ' + e.message);
    }
  }

  function durationToMinutes_(v) {
    if (v === null || v === undefined || v === '') return 0;
    const n = Number(v);
    if (!isNaN(n) && n >= 0) return Math.round(n);
    const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return 0;
    const hh = Number(m[1] || 0);
    const mm = Number(m[2] || 0);
    const ss = Number(m[3] || 0);
    return Math.max(0, Math.round((hh * 3600 + mm * 60 + ss) / 60));
  }

  function logTrainingSession(params) {
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sh = ss.getSheetByName(SHEET_TRAINING_LOG);
      if (!sh) {
        sh = ss.insertSheet(SHEET_TRAINING_LOG);
        sh.getRange(1,1,1,HEADERS_TRAINING.length).setValues([HEADERS_TRAINING]);
      }

      // تأكد من وجود الهيدرز
      const lastRow = sh.getLastRow();
      if (lastRow === 0 || lastRow === 1) {
        sh.getRange(1,1,1,HEADERS_TRAINING.length).setValues([HEADERS_TRAINING]);
      }

      const tz = 'Asia/Riyadh';
      const now = new Date();

      const sessionId = String(params.session_id || params.sessionId || ('TRN-' + now.getTime()));
      const startIso = String(params.startIso || '');
      const endIso = String(params.endIso || '');

      const startDate = startIso ? new Date(startIso) : now;
      const endDate = endIso ? new Date(endIso) : now;

      const dateStr = Utilities.formatDate(startDate, tz, 'yyyy-MM-dd');
      const startTime = String(params.start_time || params.startTime || Utilities.formatDate(startDate, tz, 'HH:mm'));
      const endTime = String(params.end_time || params.endTime || Utilities.formatDate(endDate, tz, 'HH:mm'));

      let durationMin = durationToMinutes_(params.duration_min || params.durationMin || params.duration);
      if (!durationMin && startIso && endIso) {
        durationMin = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
      }

      sh.appendRow([
        sessionId,
        dateStr,
        startTime,
        endTime,
        durationMin,
        String(params.scenarioKey || ''),
        String(params.scenarioLabel || ''),
        String(params.trainer || ''),
        String(params.attendees || ''),
        String(params.notes || '')
      ]);

      SpreadsheetApp.flush();
      return { ok: true, sessionId };
    } catch(err) {
      return { ok: false, error: err.message };
    } finally {
      try { lock.releaseLock(); } catch(e) {}
    }
  }

  function getTrainingSessions(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sh = ss.getSheetByName(SHEET_TRAINING_LOG);
      if (!sh) return { ok: true, sessions: [], debug: 'Sheet not found' };

      const lastRow = sh.getLastRow();
      if (lastRow <= 1) return { ok: true, sessions: [], debug: 'No data rows (lastRow=' + lastRow + ')' };

      const data = sh.getRange(2, 1, lastRow - 1, 10).getValues();
      const sessions = [];

      const limit = Math.min(Number(params.limit) || 50, 300);
      const startDate = String(params.startDate || '').trim();
      const endDate = String(params.endDate || '').trim();

      for (let i = data.length - 1; i >= 0 && sessions.length < limit; i--) {
        const r = data[i];
        if (!r[0]) continue;
        
        let dateVal = r[1];
        let d = '';
        if (dateVal instanceof Date) {
          d = Utilities.formatDate(dateVal, 'Asia/Riyadh', 'yyyy-MM-dd');
        } else {
          d = String(dateVal || '').trim();
        }

        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;

        sessions.push({
          sessionId: String(r[0] || ''),
          date: d,
          startTime: String(r[2] || ''),
          endTime: String(r[3] || ''),
          durationMin: Number(r[4] || 0),
          scenarioKey: String(r[5] || ''),
          scenarioLabel: String(r[6] || ''),
          trainer: String(r[7] || ''),
          attendees: String(r[8] || ''),
          notes: String(r[9] || '')
        });
      }

      return { ok: true, sessions, debug: 'Found ' + data.length + ' rows, returned ' + sessions.length + ' sessions' };
    } catch(err){ return { ok: false, error: err.message, sessions: [] }; }
  }
  /******************** END EOC CONFIG APIs ********************/
  
  function submitEmergencyReport(params) {
    try {
      const lock = LockService.getScriptLock();
      lock.tryLock(10000);

      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sheet = ss.getSheetByName('بلاغات_الطوارئ');

      if (!sheet) {
        sheet = ss.insertSheet('بلاغات_الطوارئ');
        sheet.appendRow(['رقم البلاغ', 'التاريخ', 'الوقت', 'نوع الكارثة', 'الموقع', 'ملاحظات', 'الحالة', 'المستجيب', 'إجراءات']);
      }

      const now = new Date();
      const reportId = String(params.reportId || ('EMR-' + now.getTime()));

      // تخزين ثابت يسهل الفرز والتحليل
      const dateStr = Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd');
      const timeStr = Utilities.formatDate(now, 'Asia/Riyadh', 'HH:mm:ss');

      sheet.appendRow([
        reportId,
        dateStr,
        timeStr,
        String(params.disasterType || '').trim(),
        String(params.location || '').trim(),
        String(params.notes || '').trim(),
        'جديد',
        '',
        ''
      ]);

      lock.releaseLock();
      return { ok: true, reportId };

    } catch (err) {
      try { LockService.getScriptLock().releaseLock(); } catch(e) {}
      return { ok: false, error: err.message };
    }
  }
  
  function getEmergencyReports(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      if (!sheet) return { ok: true, reports: [] };

      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return { ok: true, reports: [] };

      const limit = Math.min(parseInt((params && params.limit) || '20', 10) || 20, 200);

      const reports = [];
      for (let i = data.length - 1; i >= 1 && reports.length < limit; i--) {
        reports.push({
          id: data[i][0],
          date: data[i][1],
          time: data[i][2],
          type: data[i][3],
          location: data[i][4],
          notes: data[i][5],
          status: data[i][6] || 'جديد'
        });
      }
      return { ok: true, reports };

    } catch (err) {
      return { ok: false, error: err.message, reports: [] };
    }
  }
  
  function updateEmergencyReportStatus(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      if (!sheet) return { ok: false, error: 'Sheet not found' };

      const data = sheet.getDataRange().getValues();
      let rowIndex = -1;

      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === String(params.reportId)) {
          rowIndex = i + 1;
          break;
        }
      }
      if (rowIndex === -1) return { ok: false, error: 'Report not found' };

      sheet.getRange(rowIndex, 7).setValue(String(params.status || '').trim());

      // responder = col 8, actionNotes = col 9
      if (sheet.getLastColumn() < 8) sheet.getRange(1, 8).setValue('المستجيب');
      if (sheet.getLastColumn() < 9) sheet.getRange(1, 9).setValue('إجراءات');

      if (params.responder) sheet.getRange(rowIndex, 8).setValue(String(params.responder).trim());
      if (params.actionNotes) sheet.getRange(rowIndex, 9).setValue(String(params.actionNotes).trim());

      return { ok: true, message: 'Status updated successfully' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function getEmergencyAnalytics() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('بلاغات_الطوارئ');
      
      if (!sheet) {
        return { ok: true, analytics: { total: 0, byType: {}, byStatus: {}, byLocation: {} } };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, analytics: { total: 0, byType: {}, byStatus: {}, byLocation: {} } };
      }
      
      const analytics = {
        total: data.length - 1,
        byType: {},
        byStatus: {},
        byLocation: {},
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        avgResponseTime: 0
      };
      
      const now = new Date();
      const todayStr = Utilities.formatDate(now, 'Asia/Riyadh', 'yyyy-MM-dd');
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      for (let i = 1; i < data.length; i++) {
        const type = data[i][3] || 'غير محدد';
        const location = data[i][4] || 'غير محدد';
        const status = data[i][6] || 'جديد';
        const dateStr = String(data[i][1]);
        
        // Count by type
        analytics.byType[type] = (analytics.byType[type] || 0) + 1;
        
        // Count by status
        analytics.byStatus[status] = (analytics.byStatus[status] || 0) + 1;
        
        // Count by location (floor)
        const floor = location.includes('الأرضي') ? 'الأرضي' : 
                     location.includes('الأول') ? 'الأول' : 
                     location.includes('الثاني') ? 'الثاني' : 'أخرى';
        analytics.byLocation[floor] = (analytics.byLocation[floor] || 0) + 1;
        
        // Time-based counts
        if (dateStr.includes(todayStr)) analytics.today++;
        
        try {
          const reportDate = new Date(dateStr);
          if (reportDate >= weekAgo) analytics.thisWeek++;
          if (reportDate >= monthAgo) analytics.thisMonth++;
        } catch(e) {}
      }
      
      return { ok: true, analytics: analytics };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  // Active Command Functions for Emergency Display Screen
  function isTrueFlag_(v) {
    const s = String(v).toLowerCase().trim();
    return v === true || s === 'true' || s === 'yes' || s === '1';
  }

  function setActiveCommand(params) {
    ensureEocReady_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      let sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) sheet = ss.insertSheet(SHEET_ACTIVE_CMD);

      sheet.getRange(1, 1, 1, HEADERS_ACTIVE.length).setValues([HEADERS_ACTIVE]);

      const lastRow = sheet.getLastRow();
      if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);

      sheet.appendRow([
        true,
        params.responseType || '',
        params.reportType || '',
        params.location || '',
        params.muster || '',
        new Date().toISOString(),
        params.mode || 'real',
        params.scenarioKey || '',
        params.scenarioLabel || '',
        params.sessionId || '',
        params.trainer || ''
      ]);

      SpreadsheetApp.flush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }

  function getActiveCommand() {
    ensureEocReady_();
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: true, command: null };

      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return { ok: true, command: null };

      const row = data[1];
      if (!isTrueFlag_(row[0])) return { ok: true, command: null };

      return {
        ok: true,
        command: {
          active: true,
          responseType: row[1] || '',
          reportType: row[2] || '',
          location: row[3] || '',
          muster: row[4] || '',
          timestamp: row[5] || '',
          mode: row[6] || 'real',
          scenarioKey: row[7] || '',
          scenarioLabel: row[8] || '',
          sessionId: row[9] || '',
          trainer: row[10] || ''
        }
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  
  function clearActiveCommand() {
    ensureEocReady_();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: true };

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return { ok: true };

      sheet.getRange(2, 1).setValue(false);
      SpreadsheetApp.flush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }

  /** إغلاق رسمي للأمر النشط مع تسجيل من أغلق ولماذا */
  function closeActiveCommand(params) {
    ensureEocReady_();
    const closedBy = String(params.closedBy || '').trim();
    if (!closedBy) return { ok: false, error: 'closedBy is required' };

    const closeReason = String(params.closeReason || '').trim();

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName(SHEET_ACTIVE_CMD);
      if (!sheet) return { ok: false, error: 'No active command sheet' };

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return { ok: false, error: 'No active command' };

      const data = sheet.getDataRange().getValues();
      const row = data[1];
      if (!isTrueFlag_(row[0])) return { ok: false, error: 'No active command' };

      // Set active to false
      sheet.getRange(2, 1).setValue(false);

      // Log closure to Training_Log if it was a training, or to emergency reports log
      const mode = String(row[6] || 'real').toLowerCase();
      const endTs = new Date().toISOString();

      // Try to log in EOC_COMMAND_LOG if exists
      let logSh = ss.getSheetByName('EOC_COMMAND_LOG');
      if (!logSh) {
        logSh = ss.insertSheet('EOC_COMMAND_LOG');
        logSh.getRange(1,1,1,8).setValues([['timestamp', 'action', 'mode', 'responseType', 'location', 'closedBy', 'closeReason', 'notes']]);
      }

      logSh.appendRow([
        endTs,
        'close',
        mode,
        String(row[1] || ''),
        String(row[3] || ''),
        closedBy,
        closeReason,
        mode === 'training' ? 'إيقاف تمرين' : 'إلغاء طوارئ'
      ]);

      SpreadsheetApp.flush();
      return { ok: true, closedAt: endTs };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      lock.releaseLock();
    }
  }
  
  function getEocDrills(params) {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('EOC_DRILLS');
      
      if (!sheet) {
        return { ok: true, drills: [] };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, drills: [] };
      }
      
      const limit = Math.min(parseInt(params.limit || '10', 10), 100);
      const drills = [];
      
      for (let i = data.length - 1; i >= 1 && drills.length < limit; i--) {
        drills.push({
          date: data[i][0] || '',
          type: data[i][1] || '',
          result: data[i][2] || 'ناجح'
        });
      }
      
      return { ok: true, drills: drills };
    } catch (err) {
      return { ok: false, error: err.message, drills: [] };
    }
  }
  
  function getRoomCodes() {
    try {
      const ss = SpreadsheetApp.openById(EOC_SPREADSHEET_ID);
      const sheet = ss.getSheetByName('Rooms');
      
      if (!sheet) {
        return { ok: true, rooms: [] };
      }
      
      const data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return { ok: true, rooms: [] };
      }
      
      const rooms = [];
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) {
          rooms.push({
            code: String(data[i][0]),
            name: String(data[i][1] || '')
          });
        }
      }
      
      return { ok: true, rooms: rooms };
    } catch (err) {
      return { ok: false, error: err.message, rooms: [] };
    }
  }
  
  function getSheet(name) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return ss.getSheetByName(name);
  }
  
  function sheetToObjects(sheet) {
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    
    const headers = data[0];
    const rows = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = { _rowIndex: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = data[i][j];
      }
      rows.push(row);
    }
    
    return rows;
  }
  
  function getSaudiDate() {
    // توقيت السعودية UTC+3
    const now = new Date();
    const saudiOffset = 3 * 60; // 3 hours in minutes
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcTime + (saudiOffset * 60000));
  }
  
  function getTodayString() {
    const today = getSaudiDate();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  
  function formatTime(value) {
    if (!value) return '';
    if (value instanceof Date) {
      const h = String(value.getHours()).padStart(2, '0');
      const m = String(value.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
    const str = String(value);
    if (str.includes('T')) {
      const timePart = str.split('T')[1];
      if (timePart) return timePart.substring(0, 5);
    }
    return str;
  }
  
  function formatDate(value) {
    if (!value) return '';
    if (value instanceof Date) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    const str = String(value);
    if (str.includes('T')) {
      return str.split('T')[0];
    }
    return str;
  }
  
  function getDayNameAr() {
    // Sheet uses English day abbreviations: Sun, Mon, Tue, Wed, Thu, Fri, Sat
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[getSaudiDate().getDay()];
  }
  
  function getDayNameArDisplay() {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[getSaudiDate().getDay()];
  }
  
  function getHomeData() {
    const todayStr = getTodayString();
    const dayName = getDayNameAr();
    
    const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    
    const todayLog = roundsLog.filter(r => {
      const logDate = parseLogDate(r.Date);
      if (!logDate) return false;
      const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
      return logStr === todayStr;
    });
    
    const staffMap = {};
    masterTasks.forEach(task => {
      const assignee = task.Assigned_To || '';
      if (!assignee) return;
      
      const dayCol = task[dayName];
      if (dayCol !== 'Yes' && dayCol !== true && dayCol !== 'yes') return;
      
      if (!staffMap[assignee]) {
        staffMap[assignee] = {
          name: assignee,
          todayTasks: 0,
          todayDone: 0,
          todayRemaining: 0,
          weeklyTotal: 0,
          topRounds: []
        };
      }
      
      const rpd = parseInt(task.Rounds_Per_Day) || 1;
      staffMap[assignee].todayTasks += rpd;
      
      staffMap[assignee].topRounds.push({
        taskId: task.TaskID || '',
        name: task.Round_Name_AR || task.Round_Name_EN || task.TaskID || 'غير محدد',
        roundsRequired: rpd,
        done: 0,
        targetTime: formatTime(task.Target_Time)
      });
      
      const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      weekDays.forEach(d => {
        if (task[d] === 'Yes' || task[d] === true || task[d] === 'yes') {
          staffMap[assignee].weeklyTotal += rpd;
        }
      });
    });
    
    todayLog.forEach(log => {
      const staff = log.Responsible_Role || log.Execution_Responsible || '';
      const taskId = log.TaskID || '';
      if (staffMap[staff]) {
        staffMap[staff].todayDone++;
        // Update done count for the specific round
        const round = staffMap[staff].topRounds.find(r => r.taskId === taskId);
        if (round) round.done++;
      }
    });
    
    Object.values(staffMap).forEach(s => {
      s.todayRemaining = Math.max(0, s.todayTasks - s.todayDone);
    });
    
    // تحقق إذا اليوم إجازة (لا توجد مهام مجدولة)
    const staffList = Object.values(staffMap);
    const isHoliday = staffList.length === 0;
    const holidayMessage = isHoliday ? 'اليوم إجازة! 🎉 استمتع بيومك وارتح' : '';
    
    return {
      todayDate: todayStr,
      dayName: getDayNameArDisplay(),
      staff: staffList,
      isHoliday: isHoliday,
      holidayMessage: holidayMessage
    };
  }
  
  function getRoundsLog(limit) {
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    
    roundsLog.sort((a, b) => {
      const dateA = new Date(a.Date + ' ' + (a.Actual_Time || ''));
      const dateB = new Date(b.Date + ' ' + (b.Actual_Time || ''));
      return dateB - dateA;
    });
    
    // Map to frontend expected format with formatted date/time
    const entries = roundsLog.slice(0, limit).map(r => ({
      Date: formatDate(r.Date),
      Actual_Time: formatTime(r.Actual_Time),
      TaskID: r.TaskID,
      Round: r.TaskID,
      Round_Name: r.Round_Name || r.Area || r.TaskID || '',
      Area: r.Area || r.Round_Name || '',
      Staff: r.Responsible_Role || '',
      Exec_Responsible: r.Execution_Responsible || '',
      Status: r.Status || '',
      Negative_Notes: r.Negative_Notes || '',
      Positive_Notes: r.Positive_Notes || '',
      Is_Violation: r.Is_Violation || '',
      Closed_YN: r.Closed_YN || ''
    }));
    
    return { entries };
  }
  
  function getMasterTasks() {
    return { tasks: sheetToObjects(getSheet('MASTER_TASKS')) };
  }
  
  function getStaff() {
    const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
    const staffSet = new Set();
    masterTasks.forEach(t => {
      if (t.Assigned_To) staffSet.add(t.Assigned_To);
    });
    return { staff: Array.from(staffSet) };
  }
  
  function getStaffSummary() {
    const homeData = getHomeData();
    return { 
      staff: homeData.staff,
      isHoliday: homeData.isHoliday,
      holidayMessage: homeData.holidayMessage,
      dayName: homeData.dayName
    };
  }
  
  function getDelayed() {
    const todayStr = getTodayString();
    const dayName = getDayNameAr();
    const now = getSaudiDate();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    const schedule = sheetToObjects(getSheet('Round_Schedule'));
    
    const todayLog = roundsLog.filter(r => {
      const logDate = parseLogDate(r.Date);
      if (!logDate) return false;
      const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
      return logStr === todayStr;
    });
    
    const delayed = [];
    
    masterTasks.forEach(task => {
      const dayCol = task[dayName];
      const dayVal = String(dayCol || '').toLowerCase().trim();
      if (dayVal !== 'yes' && dayVal !== 'true' && dayVal !== 'نعم' && dayVal !== '1') return;
      
      const taskId = task.TaskID;
      const rpd = parseInt(task.Rounds_Per_Day) || 1;
      
      const doneCount = todayLog.filter(l => l.TaskID === taskId).length;
      
      for (let roundNum = 1; roundNum <= rpd; roundNum++) {
        if (roundNum <= doneCount) continue;
        
        // البحث بكلا الاسمين Task_ID و TaskID
        const scheduleRow = schedule.find(s => s.Task_ID === taskId || s.TaskID === taskId);
        if (!scheduleRow) continue;
        
        const endTimeStr = scheduleRow[`Round_${roundNum}_End`];
        if (!endTimeStr) continue;
        
        const [h, m] = String(endTimeStr).split(':').map(Number);
        const endMinutes = h * 60 + m;
        
        if (currentMinutes > endMinutes) {
          const delayMinutes = currentMinutes - endMinutes;
          
          delayed.push({
            taskId: taskId,
            roundName: task.Round_Name_AR || taskId,
            staff: task.Assigned_To || '',
            roundNumber: roundNum,
            expectedTime: endTimeStr,
            delayMinutes: delayMinutes,
            delayFormatted: Math.floor(delayMinutes / 60) + ':' + String(delayMinutes % 60).padStart(2, '0')
          });
        }
      }
    });
    
    return { delayed: delayed };
  }
  
  function getViolations() {
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
  
    // استخراج جميع المخالفات مع معلوماتها
    const allViolations = roundsLog.filter(r => {
      const isViolation = String(r.Is_Violation || '').toLowerCase();
      if (isViolation === 'true' || isViolation === 'yes') return true;
  
      const status = String(r.Status || '').toLowerCase();
      const notes = String(r.Negative_Notes || '').toLowerCase();
      return status.includes('خلل') || notes.includes('نقاط الخلل') || notes.includes('❌');
    }).map(r => {
      let area = r.Area || r.Round_Name || '';
      if (/^\d+$/.test(String(area).trim())) {
        area = r.Round_Name || 'منطقة غير محددة';
      }
      
      // استخراج البنود الفاشلة كـ Set للمقارنة
      const failedItems = extractFailedItems(r.Negative_Notes);
      
      return {
        _rowIndex: r._rowIndex,
        Date: formatDate(r.Date),
        Actual_Time: formatTime(r.Actual_Time),
        Area: area,
        Round_Name: r.Round_Name || area || '',
        Responsible_Role: r.Responsible_Role || '',
        Execution_Responsible: r.Execution_Responsible || '',
        Status: r.Status || '',
        Negative_Notes: r.Negative_Notes || r.Notes || '',
        Is_Resolved: String(r.Closed_YN || r.Is_Resolved || 'no').toLowerCase(),
        failedItems: failedItems
      };
    });
  
    // فصل المخالفات: مفتوحة vs معالجة
    const openViolations = allViolations.filter(v => v.Is_Resolved !== 'yes');
    const resolvedViolations = allViolations.filter(v => v.Is_Resolved === 'yes');
  
    // حساب التكرار الذكي: نفس المنطقة + نفس البند الفاشل = تكرار
    // المفتاح: Area فقط - ونبحث عن تشابه في البنود
    const repeatGroups = {};
    
    openViolations.forEach(v => {
      const area = v.Area || v.Round_Name || 'غير محدد';
      
      // البحث عن مجموعة موجودة بنفس المنطقة وأي تشابه في البنود
      let foundGroup = null;
      
      // نبحث في كل المجموعات الموجودة بنفس المنطقة
      for (const key in repeatGroups) {
        if (key.startsWith(area + '||')) {
          const existingItems = repeatGroups[key].allFailedItems;
          const overlap = v.failedItems.filter(item => existingItems.includes(item));
          
          // أي تشابه = تكرار (حتى لو بند واحد)
          if (overlap.length > 0) {
            foundGroup = repeatGroups[key];
            break;
          }
        }
      }
      
      if (foundGroup) {
        foundGroup.count++;
        if (v.Date && !foundGroup.dates.includes(v.Date)) foundGroup.dates.push(v.Date);
        if (v._rowIndex) foundGroup.rowIndices.push(v._rowIndex);
        // دمج البنود الفاشلة
        v.failedItems.forEach(item => {
          if (!foundGroup.allFailedItems.includes(item)) {
            foundGroup.allFailedItems.push(item);
          }
        });
        foundGroup.issue = v.Negative_Notes || foundGroup.issue;
        // تحديث المكلف بآخر مخالفة
        foundGroup.assignedTo = v.Execution_Responsible || foundGroup.assignedTo;
      } else {
        // مجموعة جديدة بمفتاح المنطقة + timestamp للتفريق
        const groupKey = `${area}||${v._rowIndex || Date.now()}`;
        repeatGroups[groupKey] = {
          area: area,
          issue: v.Negative_Notes || 'مخالفة',
          assignedTo: v.Execution_Responsible || 'غير محدد',
          detectedBy: v.Responsible_Role,
          count: 1,
          dates: v.Date ? [v.Date] : [],
          rowIndices: v._rowIndex ? [v._rowIndex] : [],
          allFailedItems: [...v.failedItems]
        };
      }
    });
  
    // المخالفات المتكررة = count >= 2 (نفس المنطقة + نفس البند مكرر)
    const repeated = Object.values(repeatGroups)
      .filter(x => x.count >= 2)
      .sort((a,b) => b.count - a.count);
  
    return {
      violations: allViolations,
      repeated,
      resolved: resolvedViolations,
      total: allViolations.length,
      pending: openViolations.length
    };
  }
  
  // دالة تحليل التواريخ بمختلف التنسيقات
  function parseLogDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
    
    const str = String(dateValue).trim();
    
    // YYYY-MM-DD أو YYYY/MM/DD
    let match = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (match) {
      return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    
    // DD-MM-YYYY أو DD/MM/YYYY
    match = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (match) {
      return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    }
    
    // المحاولة العادية
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? null : d;
  }
  
  // دالة مساعدة لاستخراج البنود الفاشلة من النص
  function extractFailedItems(notes) {
    if (!notes) return [];
    
    const items = String(notes)
      .split(/[|\n]/)
      .map(s => s.replace(/❌/g, '').replace(/نقاط الخلل[:\s]*/g, '').trim())
      .filter(s => s && s.length > 5);
    
    // تطبيع النص (إزالة التشكيل والأحرف الخاصة)
    return items.map(item => 
      item.replace(/[\u064B-\u065F]/g, '') // إزالة التشكيل
          .replace(/[^\u0621-\u064Aa-zA-Z0-9\s]/g, '') // إبقاء الحروف فقط
          .trim()
          .substring(0, 40) // أول 40 حرف للمقارنة
    );
  }
  
  function getHistory(params) {
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    
    let filtered = roundsLog;
    
    // دعم فلتر عدد الأيام
    if (params.days && params.days > 0) {
      const cutoff = getSaudiDate();
      cutoff.setDate(cutoff.getDate() - parseInt(params.days));
      filtered = filtered.filter(r => {
        const logDate = parseLogDate(r.Date);
        return logDate && logDate >= cutoff;
      });
    }
    
    if (params.startDate) {
      filtered = filtered.filter(r => {
        const logDate = parseLogDate(r.Date);
        if (!logDate) return false;
        return logDate >= new Date(params.startDate);
      });
    }
    
    if (params.endDate) {
      filtered = filtered.filter(r => {
        const logDate = parseLogDate(r.Date);
        if (!logDate) return false;
        return logDate <= new Date(params.endDate + 'T23:59:59');
      });
    }
    
    if (params.staff) {
      filtered = filtered.filter(r => r.Responsible_Role === params.staff || r.Execution_Responsible === params.staff);
    }
    
    if (params.round) {
      filtered = filtered.filter(r => r.TaskID === params.round);
    }
    
    filtered.sort((a, b) => {
      const dateA = parseLogDate(a.Date);
      const dateB = parseLogDate(b.Date);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB - dateA;
    });
    
    // Map to frontend expected format - تضمين حقول المعالجة + حقول التأخير
    const entries = filtered.map(r => {
      // حساب وقت التأخير إذا كانت الحالة متأخر
      let delayMin = 0;
      const status = String(r.Status || '').toLowerCase();
      if (status.includes('متأخر') || status.includes('تأخر')) {
        // حساب التأخير من الفرق بين الوقت الفعلي والمخطط
        if (r.Planned_Time && r.Actual_Time) {
          try {
            const planned = parseTime(r.Planned_Time);
            const actual = parseTime(r.Actual_Time);
            if (planned && actual) {
              delayMin = Math.round((actual - planned) / 60000);
              if (delayMin < 0) delayMin = 0;
            }
          } catch(e) {}
        }
        // إذا لم يمكن الحساب، استخدم قيمة افتراضية
        if (delayMin === 0) delayMin = 15;
      }
      
      return {
        Date: formatDate(r.Date),
        Actual_Time: formatTime(r.Actual_Time),
        Time: formatTime(r.Actual_Time),
        Planned_Time: formatTime(r.Planned_Time) || '',
        Delay_Min: delayMin,
        TaskID: r.TaskID,
        Area: r.Area || r.Round_Name,
        Round_Name: r.Round_Name,
        Staff: r.Responsible_Role,
        Responsible_Role: r.Responsible_Role,
        Exec_Responsible: r.Execution_Responsible,
        Execution_Responsible: r.Execution_Responsible,
        Status: r.Status,
        Negative_Notes: r.Negative_Notes,
        Positive_Notes: r.Positive_Notes,
        Is_Violation: r.Is_Violation,
        Closed_YN: r.Closed_YN,
        Is_Resolved: r.Closed_YN,
        Resolved_By: r.Resolved_By,
        Resolved_Date: r.Resolved_Date
      };
    });
    
    return { entries };
  }
  
  // دالة تحويل نص الوقت إلى كائن Date
  function parseTime(timeStr) {
    if (!timeStr) return null;
    const str = String(timeStr);
    const match = str.match(/(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const d = new Date();
    d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
    return d;
  }
  
  function getMetrics(days) {
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const filtered = roundsLog.filter(r => {
      const logDate = parseLogDate(r.Date);
      return logDate && logDate >= cutoff;
    });
    
    const total = filtered.length;
    
    // تصنيف الحالات بشكل صحيح
    const COMPLETED_STATUS = ['تم', 'مكتمل', 'مكتملة', 'OK', 'في الوقت', 'done', 'complete'];
    const DELAYED_STATUS = ['متأخر', 'متأخرة', 'تأخر', 'delayed', 'late'];
    const VIOLATION_STATUS = ['خلل', 'مخالفة', 'violation'];
    
    let completed = 0;
    let delayed = 0;
    let violations = 0;
    
    filtered.forEach(r => {
      const status = String(r.Status || '').toLowerCase().trim();
      const notes = String(r.Negative_Notes || '').toLowerCase();
      const isViol = String(r.Is_Violation || '').toLowerCase();
      
      // تحقق من المخالفات أولاً
      const isViolation = isViol === 'true' || isViol === 'yes' || 
          VIOLATION_STATUS.some(s => status.includes(s.toLowerCase())) ||
          notes.includes('نقاط الخلل') || notes.includes('❌');
      
      if (isViolation) {
        violations++;
        // المخالفات لا تُحسب كمكتملة
      } else if (COMPLETED_STATUS.some(s => status.includes(s.toLowerCase()))) {
        completed++;
      } else if (DELAYED_STATUS.some(s => status.includes(s.toLowerCase()))) {
        delayed++;
      } else {
        // جولة مسجلة بدون حالة واضحة = مكتملة
        completed++;
      }
    });
    
    const byDate = {};
    const byStaff = {};
    const byArea = {};
    const byStatus = {};
    
    filtered.forEach(r => {
      const parsedDate = parseLogDate(r.Date);
      const dateKey = parsedDate ? `${parsedDate.getFullYear()}-${String(parsedDate.getMonth()+1).padStart(2,'0')}-${String(parsedDate.getDate()).padStart(2,'0')}` : 'unknown';
      const status = String(r.Status || '').toLowerCase().trim();
      const notes = String(r.Negative_Notes || '').toLowerCase();
      const isViol = String(r.Is_Violation || '').toLowerCase();
      
      // تحديد التصنيف
      const isViolation = isViol === 'true' || isViol === 'yes' || 
          VIOLATION_STATUS.some(s => status.includes(s.toLowerCase())) ||
          notes.includes('نقاط الخلل') || notes.includes('❌');
      const isCompleted = !isViolation && COMPLETED_STATUS.some(s => status.includes(s.toLowerCase()));
      const isDelayed = !isViolation && DELAYED_STATUS.some(s => status.includes(s.toLowerCase()));
      
      // تجميع حسب التاريخ مع التفصيل
      if (!byDate[dateKey]) byDate[dateKey] = { total: 0, completed: 0, delayed: 0, violations: 0 };
      byDate[dateKey].total++;
      if (isViolation) byDate[dateKey].violations++;
      else if (isCompleted) byDate[dateKey].completed++;
      else if (isDelayed) byDate[dateKey].delayed++;
      else byDate[dateKey].completed++;
      
      // تجميع حسب الموظف مع التفصيل
      const staff = r.Responsible_Role || r.Execution_Responsible || 'غير محدد';
      if (!byStaff[staff]) byStaff[staff] = { total: 0, completed: 0, delayed: 0, violations: 0 };
      byStaff[staff].total++;
      if (isViolation) byStaff[staff].violations++;
      else if (isCompleted) byStaff[staff].completed++;
      else if (isDelayed) byStaff[staff].delayed++;
      else byStaff[staff].completed++;
      
      // تجميع حسب المنطقة مع التفصيل
      const area = r.Area || r.Round_Name || r.TaskID || 'غير محدد';
      if (!byArea[area]) byArea[area] = { total: 0, completed: 0, delayed: 0, violations: 0 };
      byArea[area].total++;
      if (isViolation) byArea[area].violations++;
      else if (isCompleted) byArea[area].completed++;
      else if (isDelayed) byArea[area].delayed++;
      else byArea[area].completed++;
      
      // تجميع حسب الحالة
      const statusKey = r.Status || 'غير محدد';
      byStatus[statusKey] = (byStatus[statusKey] || 0) + 1;
    });
    
    return {
      total: total,
      completed: completed,
      violations: violations,
      delayed: delayed,
      compliance: total > 0 ? Math.round((completed / total) * 100) : 0,
      byDate: byDate,
      byStaff: byStaff,
      byArea: byArea,
      byStatus: byStatus
    };
  }
  
  function getChecklist(taskId) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
    const id = String(taskId || '').trim();
    const pad = id.padStart(2, '0');
    const prefix = `R${pad}_`; // R01_, R02_ ...
  
    // دور على أي شيت اسمه يبدأ بـ R01_ مثلا
    const sheet = ss.getSheets().find(sh => sh.getName().startsWith(prefix));
  
    if (!sheet) {
      return { items: [], error: 'Checklist sheet not found for TaskID=' + id + ' (expected prefix ' + prefix + ')' };
    }
  
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { items: [] };
  
    // هيكل الشيت الصحيح:
    // A: TaskID, B: Round_Name_AR, C: Item_No, D: Item_Description_AR (البند الحقيقي)
    const items = [];
    for (let i = 1; i < data.length; i++) {
      // العمود D (index 3) = Item_Description_AR = البند الفعلي
      const desc = data[i][3];
      if (desc && String(desc).trim()) {
        items.push({
          id: i,
          text: String(desc).trim(),
          item: String(desc).trim()
        });
      }
    }
    
    // جلب المسؤولين من MASTER_TASKS للمهمة المحددة
    const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
    const task = masterTasks.find(t => String(t.TaskID) === id);
    
    const responsibles = [];
    if (task) {
      for (let i = 1; i <= 5; i++) {
        const resp = task[`Responsible_${i}`];
        if (resp && String(resp).trim()) {
          responsibles.push(String(resp).trim());
        }
      }
    }
  
    return { items: items, sheetName: sheet.getName(), responsibles: responsibles };
  }
  
  function verifyPasscode(staffName, passcode) {
    const passcodes = sheetToObjects(getSheet('Staff_Passcodes'));
    
    // البحث عن أي موظف لديه هذا الرمز السري
    const staffByPasscode = passcodes.find(p => 
      String(p.Passcode) === String(passcode) || String(p.Code) === String(passcode)
    );
    
    if (staffByPasscode) {
      // الرمز صحيح - نرجع اسم الموظف صاحب الرمز
      return { 
        valid: true, 
        staffName: staffByPasscode.Staff_Name || staffByPasscode.Name || staffName 
      };
    }
    
    return { valid: false, error: 'الرمز السري غير صحيح' };
  }
  
  function resolveViolation(params) {
    const sheet = getSheet('Rounds_Log');
    if (!sheet) return { success: false, error: 'Sheet not found' };
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row' };
    
    // Use correct column names from Sheet
    const closedYNCol = headers.indexOf('Closed_YN');
    const closedDateCol = headers.indexOf('Closed_Date');
    const resolvedByCol = headers.indexOf('Resolved_By');
    
    if (closedYNCol === -1) return { success: false, error: 'Closed_YN column not found' };
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    sheet.getRange(rowIndex, closedYNCol + 1).setValue('Yes');
    
    if (closedDateCol !== -1) {
      sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
    }
    
    if (resolvedByCol !== -1) {
      sheet.getRange(rowIndex, resolvedByCol + 1).setValue(params.resolvedBy || '');
    }
    
    return { success: true };
  }
  
  function logRound(payload) {
    const sheet = getSheet('Rounds_Log');
    if (!sheet) return { success: false, error: 'Rounds_Log sheet not found' };
    
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const row = headers.map(h => {
      switch(h) {
        case 'Date': return dateStr;
        case 'Actual_Time': return payload.time || timeStr;
        case 'Planned_Time': return payload.plannedTime || '';
        case 'TaskID': return payload.taskId || '';
        case 'RoundNo': return payload.roundNo || '';
        case 'Round_Name': return payload.roundName || payload.area || '';
        case 'Area': return payload.area || payload.roundName || '';
        case 'Domain': return payload.domain || '';
        case 'Responsible_Role': return payload.staff || '';
        case 'Execution_Responsible': return payload.execResponsible || '';
        case 'Status': return payload.status || 'تم';
        case 'Positive_Notes': return payload.positiveNotes || '';
        case 'Negative_Notes': return payload.negativeNotes || payload.notes || '';
        case 'Is_Violation': return payload.isViolation ? 'TRUE' : 'FALSE';
        case 'Closed_YN': return 'No';
        case 'Alert': return '';
        case 'Delay_Min': return '';
        case 'MaxDelay_Min': return '';
        default: return '';
      }
    });
    
    sheet.appendRow(row);
    
    return { success: true };
  }
  
  // دالة تشخيصية لفحص البيانات
  function debugInfo() {
    const saudiNow = getSaudiDate();
    const todayStr = getTodayString();
    const dayName = getDayNameAr();
    const currentMinutes = saudiNow.getHours() * 60 + saudiNow.getMinutes();
    
    const masterTasks = sheetToObjects(getSheet('MASTER_TASKS'));
    const schedule = sheetToObjects(getSheet('Round_Schedule'));
    const roundsLog = sheetToObjects(getSheet('Rounds_Log'));
    
    // أسماء أعمدة الأيام في MASTER_TASKS
    const masterHeaders = masterTasks.length > 0 ? Object.keys(masterTasks[0]) : [];
    const dayColumns = masterHeaders.filter(h => 
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat','Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].includes(h)
    );
    
    // المهام المجدولة اليوم (بكل القيم الممكنة)
    const todayTasks = masterTasks.filter(t => {
      const dayCol = t[dayName];
      const val = String(dayCol || '').toLowerCase().trim();
      return val === 'yes' || val === 'true' || val === 'نعم' || val === '1';
    });
    
    // عينة من قيم عمود اليوم
    const dayColumnValues = masterTasks.slice(0, 10).map(t => ({
      TaskID: t.TaskID,
      dayValue: t[dayName],
      dayValueType: typeof t[dayName]
    }));
    
    // أسماء الأعمدة في Round_Schedule
    const scheduleHeaders = schedule.length > 0 ? Object.keys(schedule[0]) : [];
    
    // أول 3 صفوف من الجدول الزمني
    const scheduleSample = schedule.slice(0, 3);
    
    // سجل اليوم
    const todayLog = roundsLog.filter(r => {
      const logDate = parseLogDate(r.Date);
      if (!logDate) return false;
      const logStr = `${logDate.getFullYear()}-${String(logDate.getMonth()+1).padStart(2,'0')}-${String(logDate.getDate()).padStart(2,'0')}`;
      return logStr === todayStr;
    });
    
    return {
      debug: {
        saudiTime: saudiNow.toISOString(),
        todayStr: todayStr,
        dayName: dayName,
        dayNameDisplay: getDayNameArDisplay(),
        currentMinutes: currentMinutes,
        currentTimeFormatted: Math.floor(currentMinutes/60) + ':' + String(currentMinutes%60).padStart(2,'0'),
        masterTasksCount: masterTasks.length,
        masterHeaders: masterHeaders,
        dayColumns: dayColumns,
        todayTasksCount: todayTasks.length,
        todayTasksSample: todayTasks.slice(0, 5).map(t => ({
          TaskID: t.TaskID,
          name: t.Round_Name_AR,
          assignee: t.Assigned_To,
          rpd: t.Rounds_Per_Day,
          dayValue: t[dayName]
        })),
        dayColumnValues: dayColumnValues,
        scheduleRowsCount: schedule.length,
        scheduleHeaders: scheduleHeaders,
        scheduleSample: scheduleSample,
        roundsLogCount: roundsLog.length,
        todayLogCount: todayLog.length
      }
    };
  }
  
  // ==================== COMMITTEE MEETINGS APIs ====================
  
  const MEETINGS_SHEET_ID = '1BOq20XMppleeaVHhY0F2Hf_fUPENDvJgk9fP_BqMcJM'; // ملف منفصل للاجتماعات
  
  function getMeetingsSheet(name) {
    const ss = SpreadsheetApp.openById(MEETINGS_SHEET_ID);
    return ss.getSheetByName(name);
  }
  
  // بيانات اللجان المطلوبة
  const COMMITTEE_CONFIG = {
    RM: { name: 'إدارة المخاطر', frequency: 'monthly', required: 10, members: 6 },
    FMS: { name: 'السلامة والمرافق', frequency: 'monthly', required: 10, members: 6 },
    PSC: { name: 'سلامة المرضى', frequency: 'monthly', required: 10, members: 6 },
    IPC: { name: 'مكافحة العدوى', frequency: 'monthly', required: 10, members: 6 },
    QI: { name: 'الجودة والتحسين', frequency: 'quarterly', required: 4, members: 5 },
    EOC: { name: 'الطوارئ والكوارث', frequency: 'semiannual', required: 2, members: 8 },
    EXEC: { name: 'الإدارة العليا', frequency: 'monthly', required: 10, members: 5 }
  };
  
  function getMeetingData(committee) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log')) || [];
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations')) || [];
    
    const year = new Date().getFullYear();
    const config = COMMITTEE_CONFIG[committee] || {};
    
    // فلترة اجتماعات اللجنة للسنة الحالية
    const committeeMeetings = meetingsLog.filter(m => {
      if (m.Committee !== committee) return false;
      const dateVal = m.Date;
      if (!dateVal) return false;
      // Handle Date objects
      if (dateVal instanceof Date) {
        return dateVal.getFullYear() === year;
      }
      // Handle strings
      return String(dateVal).includes(String(year));
    });
    
    // فلترة التوصيات
    const committeeRecs = recommendations.filter(r => r.Committee === committee);
    const openRecs = committeeRecs.filter(r => String(r.Status).toLowerCase() !== 'closed');
    const overdueRecs = committeeRecs.filter(r => {
      if (String(r.Status).toLowerCase() === 'closed') return false;
      if (!r.Due_Date) return false;
      return new Date(r.Due_Date) < new Date();
    });
    
    // حساب متوسط الحضور (نسبة الحاضرين من إجمالي أعضاء اللجنة)
    let avgAttendance = 0;
    if (committeeMeetings.length > 0) {
      const membersCount = config.members || 6; // عدد أعضاء اللجنة
      const totalAttendance = committeeMeetings.reduce((sum, m) => 
        sum + (parseInt(m.Attendees_Count) || 0), 0
      );
      // متوسط الحضور = (إجمالي الحاضرين / عدد الاجتماعات / عدد الأعضاء) × 100
      avgAttendance = Math.round((totalAttendance / committeeMeetings.length / membersCount) * 100);
      // التأكد من عدم تجاوز 100%
      avgAttendance = Math.min(avgAttendance, 100);
    }
    
    // حساب الاجتماعات المتأخرة
    const delayedCount = calculateDelayedMeetings(committee, committeeMeetings);
    
    return {
      completed: committeeMeetings.length,
      required: config.required || 10,
      delayed: delayedCount,
      openRecommendations: openRecs.length,
      overdueRecommendations: overdueRecs.length,
      avgAttendance: avgAttendance,
      meetings: committeeMeetings.slice(0, 10).map(m => ({
        date: formatDate(m.Date),
        type: m.Meeting_Type || 'حضوري',
        attendees: parseInt(m.Attendees_Count) || 0,
        recommendations: parseInt(m.Recommendations_Count) || 0
      }))
    };
  }
  
  function calculateDelayedMeetings(committee, meetings) {
    const config = COMMITTEE_CONFIG[committee];
    if (!config) return 0;
    
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let expectedMeetings = 0;
    
    if (config.frequency === 'monthly') {
      // شهري: كل شهر ماعدا 7 (أغسطس) و11 (ديسمبر لبعض اللجان)
      expectedMeetings = Math.min(currentMonth + 1, 10);
    } else if (config.frequency === 'quarterly') {
      // ربع سنوي: مارس، يونيو، سبتمبر، ديسمبر
      const quarterMonths = [2, 5, 8, 11];
      expectedMeetings = quarterMonths.filter(m => m <= currentMonth).length;
    } else if (config.frequency === 'semiannual') {
      // نصف سنوي: يونيو وديسمبر
      const semiMonths = [5, 11];
      expectedMeetings = semiMonths.filter(m => m <= currentMonth).length;
    }
    
    return Math.max(0, expectedMeetings - meetings.length);
  }
  
  function saveMeeting(payload) {
    const sheet = getMeetingsSheet('Meetings_Log');
    if (!sheet) return { success: false, error: 'Meetings_Log sheet not found' };
    
    const now = getSaudiDate();
    const timestamp = now.toISOString();
    
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    const row = headers.map(h => {
      switch(h) {
        case 'Meeting_ID': return `MTG-${payload.committee}-${Date.now()}`;
        case 'Committee': return payload.committee || '';
        case 'Date': return payload.date || '';
        case 'Meeting_Type': return payload.type || 'حضوري';
        case 'Zoom_Link': return payload.zoomLink || '';
        case 'Attendees': return (payload.attendees || []).join(', ');
        case 'Attendees_Count': return payload.attendeesCount || 0;
        case 'Quorum_Met': return payload.quorumMet ? 'Yes' : 'No';
        case 'Recommendations_Count': return (payload.recommendations || []).length;
        case 'Recorder': return payload.recorder || '';
        case 'Created_At': return timestamp;
        default: return '';
      }
    });
    
    sheet.appendRow(row);
    
    // حفظ التوصيات
    if (payload.recommendations && payload.recommendations.length > 0) {
      const recsSheet = getMeetingsSheet('Meeting_Recommendations');
      if (recsSheet) {
        const recsHeaders = recsSheet.getRange(1, 1, 1, recsSheet.getLastColumn()).getValues()[0];
        
        payload.recommendations.forEach((rec, idx) => {
          const recRow = recsHeaders.map(h => {
            switch(h) {
              case 'Rec_ID': return `REC-${payload.committee}-${Date.now()}-${idx}`;
              case 'Committee': return payload.committee || '';
              case 'Meeting_Date': return payload.date || '';
              case 'Recommendation': return rec;
              case 'Status': return 'Open';
              case 'Due_Date': return '';
              case 'Assigned_To': return '';
              case 'Created_At': return timestamp;
              default: return '';
            }
          });
          recsSheet.appendRow(recRow);
        });
      }
    }
    
    return { success: true, meetingId: `MTG-${payload.committee}-${Date.now()}` };
  }
  
  function getMeetingRecommendations(committee) {
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations'));
    
    let filtered = recommendations;
    if (committee) {
      filtered = recommendations.filter(r => r.Committee === committee);
    }
    
    return {
      recommendations: filtered.map(r => ({
        id: r.Rec_ID || r._rowIndex,
        rowIndex: r._rowIndex,
        committee: r.Committee,
        meetingDate: formatDate(r.Meeting_Date),
        recommendation: r.Recommendation,
        status: r.Status || 'Open',
        dueDate: formatDate(r.Due_Date),
        assignedTo: r.Assigned_To || '',
        closedDate: formatDate(r.Closed_Date),
        closedBy: r.Closed_By || ''
      }))
    };
  }
  
  function getDelayedMeetings(committee) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const delayed = [];
    
    for (const [code, config] of Object.entries(COMMITTEE_CONFIG)) {
      if (committee && code !== committee) continue;
      
      const year = new Date().getFullYear();
      const committeeMeetings = meetingsLog.filter(m => 
        m.Committee === code && String(m.Date).includes(String(year))
      );
      
      const delayCount = calculateDelayedMeetings(code, committeeMeetings);
      
      if (delayCount > 0) {
        delayed.push({
          committee: code,
          committeeName: config.name,
          completed: committeeMeetings.length,
          required: config.required,
          delayed: delayCount,
          lastMeeting: committeeMeetings.length > 0 ? formatDate(committeeMeetings[committeeMeetings.length - 1].Date) : 'لا يوجد'
        });
      }
    }
    
    return { delayed };
  }
  
  function closeMeetingRecommendation(params) {
    const sheet = getMeetingsSheet('Meeting_Recommendations');
    if (!sheet) return { success: false, error: 'Sheet not found' };
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) return { success: false, error: 'Invalid row' };
    
    const statusCol = headers.indexOf('Status');
    const closedDateCol = headers.indexOf('Closed_Date');
    const closedByCol = headers.indexOf('Closed_By');
    
    if (statusCol === -1) return { success: false, error: 'Status column not found' };
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    sheet.getRange(rowIndex, statusCol + 1).setValue('Closed');
    
    if (closedDateCol !== -1) {
      sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
    }
    
    if (closedByCol !== -1) {
      sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
    }
    
    return { success: true };
  }
  
  function getMeetingsArchive(params) {
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const now = getSaudiDate();
    
    let filtered = meetingsLog;
    
    if (params.committee) {
      filtered = filtered.filter(m => m.Committee === params.committee);
    }
    
    if (params.year) {
      filtered = filtered.filter(m => String(m.Date).includes(String(params.year)));
    }
    
    // فلتر الفترة (بالشهور)
    if (params.period) {
      const months = parseInt(params.period) || 0;
      if (months > 0) {
        const cutoffDate = new Date(now);
        cutoffDate.setMonth(cutoffDate.getMonth() - months);
        filtered = filtered.filter(m => {
          const meetingDate = parseLogDate(m.Date);
          return meetingDate && meetingDate >= cutoffDate;
        });
      }
    }
    
    // فلتر الحالة
    if (params.status) {
      filtered = filtered.filter(m => {
        const meetingStatus = m.Quorum_Met === 'Yes' ? 'completed' : 'delayed';
        return meetingStatus === params.status;
      });
    }
    
    filtered.sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    return {
      meetings: filtered.map(m => ({
        id: m.Meeting_ID || '',
        committee: m.Committee,
        date: formatDate(m.Date),
        type: m.Meeting_Type || 'حضوري',
        attendees: m.Attendees || '',
        attendeesCount: parseInt(m.Attendees_Count) || 0,
        quorumMet: m.Quorum_Met === 'Yes',
        status: m.Quorum_Met === 'Yes' ? 'completed' : 'delayed',
        recommendations: m.Recommendations || '',
        recommendationsCount: parseInt(m.Recommendations_Count) || 0,
        recorder: m.Recorder || ''
      }))
    };
  }
  
  function getMeetingsDashboard(year) {
    const currentYear = year || new Date().getFullYear();
    const meetingsLog = sheetToObjects(getMeetingsSheet('Meetings_Log'));
    const recommendations = sheetToObjects(getMeetingsSheet('Meeting_Recommendations'));
    
    const yearMeetings = meetingsLog.filter(m => String(m.Date).includes(String(currentYear)));
    const yearRecs = recommendations.filter(r => String(r.Meeting_Date).includes(String(currentYear)));
    
    // إحصائيات حسب اللجنة
    const byCommittee = {};
    for (const [code, config] of Object.entries(COMMITTEE_CONFIG)) {
      const commMeetings = yearMeetings.filter(m => m.Committee === code);
      byCommittee[code] = {
        name: config.name,
        completed: commMeetings.length,
        required: config.required,
        percentage: Math.round((commMeetings.length / config.required) * 100)
      };
    }
    
    // إحصائيات التوصيات
    const openRecs = yearRecs.filter(r => String(r.Status).toLowerCase() !== 'closed').length;
    const closedRecs = yearRecs.filter(r => String(r.Status).toLowerCase() === 'closed').length;
    const overdueRecs = yearRecs.filter(r => {
      if (String(r.Status).toLowerCase() === 'closed') return false;
      if (!r.Due_Date) return false;
      return new Date(r.Due_Date) < new Date();
    }).length;
    
    // إحصائيات الحضور الشهرية
    const attendanceByMonth = {};
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 
                    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    
    yearMeetings.forEach(m => {
      const date = parseLogDate(m.Date);
      if (date) {
        const month = date.getMonth();
        if (!attendanceByMonth[month]) {
          attendanceByMonth[month] = { total: 0, count: 0 };
        }
        attendanceByMonth[month].total += parseInt(m.Attendees_Count) || 0;
        attendanceByMonth[month].count++;
      }
    });
    
    const monthlyAttendance = months.map((name, idx) => ({
      month: name,
      average: attendanceByMonth[idx] ? 
        Math.round(attendanceByMonth[idx].total / attendanceByMonth[idx].count) : 0
    }));
    
    return {
      year: currentYear,
      totalMeetings: yearMeetings.length,
      byCommittee,
      recommendations: {
        total: yearRecs.length,
        open: openRecs,
        closed: closedRecs,
        overdue: overdueRecs
      },
      monthlyAttendance
    };
  }
  
  // ============================================================
  // نظام بلاغات حوادث سلامة المرضى
  // Patient Safety Incidents System
  // ============================================================
  
  const INCIDENTS_SPREADSHEET_ID = '12SS-Nn_TpvIsIoUfdOPRzC_tgLqmb2hfZZi53_dSyVI';
  
  const INCIDENT_TYPES = {
    'medication_error': 'خطأ دوائي',
    'patient_fall': 'سقوط مريض',
    'infection': 'عدوى مكتسبة',
    'diagnosis_error': 'خطأ تشخيصي',
    'procedure_error': 'خطأ إجراءات',
    'near_miss': 'كاد يحدث (Near Miss)',
    'equipment_failure': 'عطل معدات',
    'communication': 'خطأ تواصل',
    'documentation': 'خطأ توثيق',
    'other': 'أخرى'
  };
  
  const SEVERITY_LEVELS = {
    'none': { name: 'بدون ضرر', color: '#28a745', priority: 1 },
    'minor': { name: 'ضرر بسيط', color: '#ffc107', priority: 2 },
    'moderate': { name: 'ضرر متوسط', color: '#fd7e14', priority: 3 },
    'severe': { name: 'ضرر جسيم', color: '#dc3545', priority: 4 },
    'death': { name: 'وفاة', color: '#000000', priority: 5 }
  };
  
  const INCIDENT_STATUS = {
    'new': 'جديد',
    'under_review': 'قيد المراجعة',
    'rca_required': 'يتطلب RCA',
    'in_progress': 'قيد المعالجة',
    'closed': 'مغلق'
  };
  
  function getIncidentsSheet(name) {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(name);
    
    if (!sheet) {
      sheet = ss.insertSheet(name);
      
      if (name === 'Incidents_Log') {
        sheet.appendRow([
          'Incident_ID', 'Date', 'Time', 'Report_Date', 'Department',
          'Incident_Type', 'Severity', 'Description', 'Discovery_Method',
          'Immediate_Action', 'Doctor_Notified', 'Patient_Notified',
          'Anonymous', 'Reporter_Name', 'Status', 'Assigned_To',
          'RCA_Required', 'Closed_Date', 'Closed_By', 'Root_Cause',
          'Corrective_Actions', 'Lessons_Learned'
        ]);
      } else if (name === 'Incidents_Followup') {
        sheet.appendRow([
          'Followup_ID', 'Incident_ID', 'Date', 'Action', 'By', 'Notes', 'Status'
        ]);
      }
    }
    
    return sheet;
  }
  
  function generateIncidentId() {
    const now = getSaudiDate();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `INC-${year}${month}-${random}`;
  }
  
  function submitIncident(payload) {
    if (!payload.incidentDate) {
      return { success: false, error: 'تاريخ الحادث مطلوب' };
    }
    if (!payload.department) {
      return { success: false, error: 'القسم مطلوب' };
    }
    if (!payload.incidentType) {
      return { success: false, error: 'نوع الحادث مطلوب' };
    }
    if (!payload.severity) {
      return { success: false, error: 'مستوى الخطورة مطلوب' };
    }
    if (!payload.description || payload.description.length < 10) {
      return { success: false, error: 'وصف الحادث مطلوب (10 أحرف على الأقل)' };
    }
    
    const sheet = getIncidentsSheet('Incidents_Log');
    const now = getSaudiDate();
    
    const incidentId = generateIncidentId();
    const reportDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const reportTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    const isAnonymous = payload.anonymous === true || payload.anonymous === 'true';
    const severity = payload.severity || 'none';
    const requiresRCA = ['severe', 'death', 'moderate'].includes(severity);
    const isSentinel = ['severe', 'death'].includes(severity);
    
    sheet.appendRow([
      incidentId,
      payload.incidentDate || reportDate,
      payload.incidentTime || '',
      reportDate + ' ' + reportTime,
      payload.department || '',
      payload.incidentType || '',
      severity,
      payload.description || '',
      payload.discoveryMethod || '',
      payload.immediateAction || '',
      payload.doctorNotified || 'لا',
      payload.patientNotified || 'لا',
      isAnonymous ? 'نعم' : 'لا',
      isAnonymous ? '' : (payload.reporterName || ''),
      isSentinel ? 'rca_required' : 'new',
      '',
      requiresRCA ? 'نعم' : 'لا',
      '',
      '',
      '',
      '',
      ''
    ]);
    
    return {
      success: true,
      incidentId: incidentId,
      message: 'تم تسجيل البلاغ بنجاح',
      requiresRCA: requiresRCA
    };
  }
  
  function getIncidents(params) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    
    let filtered = incidents;
    
    if (params.status && params.status !== 'all') {
      filtered = filtered.filter(i => i.Status === params.status);
    }
    
    if (params.department) {
      filtered = filtered.filter(i => i.Department === params.department);
    }
    
    if (params.severity) {
      filtered = filtered.filter(i => i.Severity === params.severity);
    }
    
    if (params.incidentType) {
      filtered = filtered.filter(i => i.Incident_Type === params.incidentType);
    }
    
    if (params.dateFrom) {
      filtered = filtered.filter(i => i.Date >= params.dateFrom);
    }
    
    if (params.dateTo) {
      filtered = filtered.filter(i => i.Date <= params.dateTo);
    }
    
    filtered.sort((a, b) => new Date(b.Report_Date) - new Date(a.Report_Date));
    
    const limit = params.limit || 100;
    filtered = filtered.slice(0, limit);
    
    return {
      incidents: filtered.map(i => ({
        id: i.Incident_ID,
        date: i.Date,
        time: i.Time,
        reportDate: i.Report_Date,
        department: i.Department,
        type: i.Incident_Type,
        typeName: INCIDENT_TYPES[i.Incident_Type] || i.Incident_Type,
        severity: i.Severity,
        severityName: SEVERITY_LEVELS[i.Severity]?.name || i.Severity,
        severityColor: SEVERITY_LEVELS[i.Severity]?.color || '#6c757d',
        description: i.Description,
        status: i.Status,
        statusName: INCIDENT_STATUS[i.Status] || i.Status,
        anonymous: i.Anonymous === 'نعم',
        rcaRequired: i.RCA_Required === 'نعم',
        rowIndex: i._rowIndex
      })),
      total: incidents.length,
      filtered: filtered.length
    };
  }
  
  function getIncidentDetails(incidentId) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    const incident = incidents.find(i => i.Incident_ID === incidentId);
    
    if (!incident) {
      return { success: false, error: 'البلاغ غير موجود' };
    }
    
    const followups = sheetToObjects(getIncidentsSheet('Incidents_Followup'));
    const incidentFollowups = followups
      .filter(f => f.Incident_ID === incidentId)
      .sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    return {
      success: true,
      incident: {
        id: incident.Incident_ID,
        date: incident.Date,
        time: incident.Time,
        reportDate: incident.Report_Date,
        department: incident.Department,
        type: incident.Incident_Type,
        typeName: INCIDENT_TYPES[incident.Incident_Type] || incident.Incident_Type,
        severity: incident.Severity,
        severityName: SEVERITY_LEVELS[incident.Severity]?.name || incident.Severity,
        severityColor: SEVERITY_LEVELS[incident.Severity]?.color || '#6c757d',
        description: incident.Description,
        discoveryMethod: incident.Discovery_Method,
        immediateAction: incident.Immediate_Action,
        doctorNotified: incident.Doctor_Notified,
        patientNotified: incident.Patient_Notified,
        anonymous: incident.Anonymous === 'نعم',
        reporterName: incident.Reporter_Name,
        status: incident.Status,
        statusName: INCIDENT_STATUS[incident.Status] || incident.Status,
        assignedTo: incident.Assigned_To,
        rcaRequired: incident.RCA_Required === 'نعم',
        closedDate: incident.Closed_Date,
        closedBy: incident.Closed_By,
        rootCause: incident.Root_Cause,
        correctiveActions: incident.Corrective_Actions,
        lessonsLearned: incident.Lessons_Learned,
        rowIndex: incident._rowIndex
      },
      followups: incidentFollowups.map(f => ({
        id: f.Followup_ID,
        date: f.Date,
        action: f.Action,
        by: f.By,
        notes: f.Notes,
        status: f.Status
      }))
    };
  }
  
  function updateIncidentStatus(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const updates = {};
    
    if (params.status) {
      const statusCol = headers.indexOf('Status');
      if (statusCol !== -1) {
        sheet.getRange(rowIndex, statusCol + 1).setValue(params.status);
      }
      
      if (params.status === 'closed') {
        const closedDateCol = headers.indexOf('Closed_Date');
        const closedByCol = headers.indexOf('Closed_By');
        if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
        if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
      }
    }
    
    if (params.assignedTo) {
      const col = headers.indexOf('Assigned_To');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.assignedTo);
    }
    
    if (params.rootCause) {
      const col = headers.indexOf('Root_Cause');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.rootCause);
    }
    
    if (params.correctiveActions) {
      const col = headers.indexOf('Corrective_Actions');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.correctiveActions);
    }
    
    if (params.lessonsLearned) {
      const col = headers.indexOf('Lessons_Learned');
      if (col !== -1) sheet.getRange(rowIndex, col + 1).setValue(params.lessonsLearned);
    }
    
    return { success: true, message: 'تم تحديث البلاغ بنجاح' };
  }
  
  function addIncidentFollowup(params) {
    const sheet = getIncidentsSheet('Incidents_Followup');
    const now = getSaudiDate();
    
    const followupId = `FU-${Date.now()}`;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    sheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      params.action || '',
      params.by || '',
      params.notes || '',
      params.status || 'pending'
    ]);
    
    return { success: true, followupId: followupId };
  }
  
  function getIncidentStats(params) {
    const incidents = sheetToObjects(getIncidentsSheet('Incidents_Log'));
    const now = getSaudiDate();
    const currentYear = params.year || now.getFullYear();
    
    const yearIncidents = incidents.filter(i => {
      const date = i.Date || i.Report_Date;
      return date && String(date).includes(String(currentYear));
    });
    
    // إحصائيات حسب النوع
    const byType = {};
    for (const [code, name] of Object.entries(INCIDENT_TYPES)) {
      byType[code] = {
        name: name,
        count: yearIncidents.filter(i => i.Incident_Type === code).length
      };
    }
    
    // إحصائيات حسب الخطورة
    const bySeverity = {};
    for (const [code, config] of Object.entries(SEVERITY_LEVELS)) {
      bySeverity[code] = {
        name: config.name,
        color: config.color,
        count: yearIncidents.filter(i => i.Severity === code).length
      };
    }
    
    // إحصائيات حسب الحالة
    const byStatus = {};
    for (const [code, name] of Object.entries(INCIDENT_STATUS)) {
      byStatus[code] = {
        name: name,
        count: yearIncidents.filter(i => i.Status === code).length
      };
    }
    
    // إحصائيات شهرية
    const byMonth = {};
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    
    yearIncidents.forEach(i => {
      const date = parseLogDate(i.Date || i.Report_Date);
      if (date) {
        const month = date.getMonth();
        if (!byMonth[month]) byMonth[month] = 0;
        byMonth[month]++;
      }
    });
    
    const monthlyStats = months.map((name, idx) => ({
      month: name,
      count: byMonth[idx] || 0
    }));
    
    // نسبة Near Miss
    const nearMissCount = yearIncidents.filter(i => i.Incident_Type === 'near_miss').length;
    const nearMissPercentage = yearIncidents.length > 0 ?
      Math.round((nearMissCount / yearIncidents.length) * 100) : 0;
    
    // البلاغات المفتوحة
    const openIncidents = yearIncidents.filter(i => i.Status !== 'closed').length;
    
    // متوسط وقت الإغلاق (بالأيام)
    const closedIncidents = yearIncidents.filter(i => i.Status === 'closed' && i.Closed_Date);
    let avgClosureTime = 0;
    if (closedIncidents.length > 0) {
      const totalDays = closedIncidents.reduce((sum, i) => {
        const reportDate = parseLogDate(i.Report_Date);
        const closedDate = parseLogDate(i.Closed_Date);
        if (reportDate && closedDate) {
          return sum + Math.ceil((closedDate - reportDate) / (1000 * 60 * 60 * 24));
        }
        return sum;
      }, 0);
      avgClosureTime = Math.round(totalDays / closedIncidents.length);
    }
    
    return {
      year: currentYear,
      total: yearIncidents.length,
      open: openIncidents,
      closed: yearIncidents.length - openIncidents,
      nearMissPercentage: nearMissPercentage,
      avgClosureTime: avgClosureTime,
      byType,
      bySeverity,
      byStatus,
      monthlyStats
    };
  }

  // ==================== نظام المتابعين والتعيين ====================
  // يقرأ من شيت On_Charge: عمود A=الاسم, B=الرمز, C=التصعيد

  function getIncidentStaff() {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('On_Charge');
    
    if (!sheet) {
      return { staff: [], escalationList: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { staff: [], escalationList: [] };
    }
    
    // أرقام الأعمدة مباشرة: A=0, B=1, C=2
    const staff = [];
    const escalationList = [];
    
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();      // عمود A - الاسم
      const code = String(data[i][1] || '').trim();      // عمود B - الرمز
      const escalateTo = String(data[i][2] || '').trim(); // عمود C - التصعيد
      
      if (name) {
        staff.push({
          name: name,
          hasCode: code.length > 0
        });
        
        if (escalateTo) {
          escalationList.push({
            name: escalateTo,
            role: 'مسؤول تصعيد'
          });
        }
      }
    }
    
    // إزالة التكرارات
    const uniqueEscalation = [...new Map(escalationList.map(e => [e.name, e])).values()];
    
    return { staff, escalationList: uniqueEscalation };
  }

  function verifyIncidentPasscode(staffName, passcode) {
    const ss = SpreadsheetApp.openById(INCIDENTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('On_Charge');
    
    if (!sheet) {
      return { verified: false, error: 'شيت On_Charge غير موجود' };
    }
    
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      return { verified: false, error: 'لا توجد بيانات' };
    }
    
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();  // عمود A
      const code = String(data[i][1] || '').trim();  // عمود B
      
      if (name === staffName && code === String(passcode).trim()) {
        return { verified: true, staffName: name };
      }
    }
    
    return { verified: false, error: 'الاسم أو الرمز غير صحيح' };
  }

  function getEscalationList() {
    const result = getIncidentStaff();
    return { escalationList: result.escalationList || [] };
  }

  function assignIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const assignedCol = headers.indexOf('Assigned_To');
    const statusCol = headers.indexOf('Status');
    
    if (assignedCol !== -1) {
      sheet.getRange(rowIndex, assignedCol + 1).setValue(params.assignedTo);
    }
    
    if (statusCol !== -1 && params.assignedTo) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('under_review');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم تعيين المسؤول: ${params.assignedTo}`,
      params.assignedBy || 'النظام',
      params.notes || '',
      'completed'
    ]);
    
    return { success: true, message: 'تم تعيين المسؤول بنجاح' };
  }

  function escalateIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const statusCol = headers.indexOf('Status');
    const rcaCol = headers.indexOf('RCA_Required');
    
    if (statusCol !== -1) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('rca_required');
    }
    
    if (rcaCol !== -1) {
      sheet.getRange(rowIndex, rcaCol + 1).setValue('نعم');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم تصعيد الحادث - يتطلب تحليل السبب الجذري (RCA)`,
      params.escalatedBy || 'النظام',
      params.reason || '',
      'pending'
    ]);
    
    return { success: true, message: 'تم تصعيد الحادث بنجاح' };
  }

  function closeIncident(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const statusCol = headers.indexOf('Status');
    const closedDateCol = headers.indexOf('Closed_Date');
    const closedByCol = headers.indexOf('Closed_By');
    const correctiveCol = headers.indexOf('Corrective_Actions');
    
    if (statusCol !== -1) sheet.getRange(rowIndex, statusCol + 1).setValue('closed');
    if (closedDateCol !== -1) sheet.getRange(rowIndex, closedDateCol + 1).setValue(dateStr);
    if (closedByCol !== -1) sheet.getRange(rowIndex, closedByCol + 1).setValue(params.closedBy || '');
    if (correctiveCol !== -1 && params.correctiveActions) {
      sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions);
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم إغلاق البلاغ`,
      params.closedBy || 'النظام',
      params.summary || '',
      'completed'
    ]);
    
    return { success: true, message: 'تم إغلاق البلاغ بنجاح' };
  }

  function saveRCA(params) {
    const sheet = getIncidentsSheet('Incidents_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    const rootCauseCol = headers.indexOf('Root_Cause');
    const correctiveCol = headers.indexOf('Corrective_Actions');
    const lessonsCol = headers.indexOf('Lessons_Learned');
    const statusCol = headers.indexOf('Status');
    
    if (rootCauseCol !== -1) sheet.getRange(rowIndex, rootCauseCol + 1).setValue(params.rootCause || '');
    if (correctiveCol !== -1) sheet.getRange(rowIndex, correctiveCol + 1).setValue(params.correctiveActions || '');
    if (lessonsCol !== -1) sheet.getRange(rowIndex, lessonsCol + 1).setValue(params.lessonsLearned || '');
    
    if (statusCol !== -1) {
      sheet.getRange(rowIndex, statusCol + 1).setValue('in_progress');
    }
    
    const followupSheet = getIncidentsSheet('Incidents_Followup');
    const followupId = `FU-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.incidentId,
      dateStr,
      `تم إكمال تحليل السبب الجذري (RCA)`,
      params.analyzedBy || 'النظام',
      `السبب: ${(params.rootCause || '').substring(0, 100)}...`,
      'completed'
    ]);
    
    return { success: true, message: 'تم حفظ تحليل السبب الجذري بنجاح' };
  }

  // ============================================
  // نظام الشكاوى - Complaints System
  // ============================================
  
  const COMPLAINTS_SPREADSHEET_ID = '1d4BRDY6qAa2u7zKRwwhtXKHIjDn16Yf0NuWA0FWLdMQ';
  
  function getComplaintsSheet(sheetName) {
    const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      if (sheetName === 'Complaints_Log') {
        sheet.appendRow([
          'Complaint_ID', 'Submit_Date', 'Submit_Time', 'Complaint_Type', 'Complainant_Name',
          'Complainant_Phone', 'Complainant_Email', 'Complaint_DateTime', 'Locations',
          'Description', 'Complaint_Against', 'Attachments', 'Additional_Notes',
          'Status', 'Priority', 'Assigned_To', 'Assigned_Date', 'Resolution',
          'Resolution_Date', 'Closed_By', 'Response_Sent', 'Days_Open'
        ]);
      } else if (sheetName === 'Complaints_Followup') {
        sheet.appendRow(['Followup_ID', 'Complaint_ID', 'Date', 'Action', 'Action_By', 'Notes', 'Status']);
      } else if (sheetName === 'Complaints_Staff') {
        sheet.appendRow(['Name', 'Passcode', 'Role', 'Active']);
        sheet.appendRow(['مدير الجودة', '1234', 'admin', 'نعم']);
        sheet.appendRow(['مسؤول الشكاوى', '5678', 'analyst', 'نعم']);
      }
    }
    
    return sheet;
  }
  
  function submitComplaint(payload) {
    const sheet = getComplaintsSheet('Complaints_Log');
    const now = getSaudiDate();
    
    const complaintId = `CMP-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${Date.now().toString().slice(-6)}`;
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    
    const locations = Array.isArray(payload.locations) ? payload.locations.join(', ') : (payload.locations || '');
    
    sheet.appendRow([
      complaintId,
      dateStr,
      timeStr,
      payload.complaintType || '',
      payload.complainantName || '',
      payload.complainantPhone || '',
      payload.complainantEmail || '',
      payload.complaintDateTime || '',
      locations,
      payload.description || '',
      payload.complaintAgainst || '',
      '', // Attachments
      payload.additionalNotes || '',
      'new', // Status
      'medium', // Priority
      '', // Assigned_To
      '', // Assigned_Date
      '', // Resolution
      '', // Resolution_Date
      '', // Closed_By
      'no', // Response_Sent
      0  // Days_Open
    ]);
    
    return { 
      success: true, 
      complaintId: complaintId,
      message: 'تم استلام شكواك بنجاح'
    };
  }
  
  function getComplaintStaff() {
    const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Master');
    
    if (!sheet) {
      return { staff: [], assignment: [], escalation: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    const staff = [];
    const assignment = [];
    const escalation = [];
    
    // بدءاً من الصف الثاني (بعد العناوين)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // عمود A: أسماء مديري الشكاوى
      if (row[0] && String(row[0]).trim()) {
        staff.push({
          name: String(row[0]).trim(),
          hasCode: row[1] ? true : false
        });
      }
      // عمود C: أسماء التكليف
      if (row[2] && String(row[2]).trim()) {
        const assignName = String(row[2]).trim();
        if (!assignment.includes(assignName)) {
          assignment.push(assignName);
        }
      }
      // عمود D: أسماء التصعيد
      if (row[3] && String(row[3]).trim()) {
        const escalateName = String(row[3]).trim();
        if (!escalation.includes(escalateName)) {
          escalation.push(escalateName);
        }
      }
    }
    
    return { staff, assignment, escalation };
  }
  
  function verifyComplaintPasscode(staffName, passcode) {
    const ss = SpreadsheetApp.openById(COMPLAINTS_SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Master');
    
    if (!sheet) {
      return { verified: false, error: 'ورقة Master غير موجودة' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // البحث في عمود A (الاسم) وعمود B (الرمز)
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      const code = String(data[i][1] || '').trim();
      
      if (name === staffName && code === String(passcode)) {
        return { verified: true, name: name };
      }
    }
    
    return { verified: false, error: 'الاسم أو الرمز السري غير صحيح' };
  }
  
  function getComplaintAssignmentList() {
    const result = getComplaintStaff();
    return { assignment: result.assignment || [] };
  }
  
  function getComplaintEscalationList() {
    const result = getComplaintStaff();
    return { escalation: result.escalation || [] };
  }
  
  function getComplaintStats(params) {
    const sheet = getComplaintsSheet('Complaints_Log');
    const data = sheetToObjects(sheet);
    
    const now = getSaudiDate();
    let filtered = data;
    
    // فلترة حسب الفترة
    if (params && params.days) {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - parseInt(params.days));
      filtered = data.filter(c => {
        const d = parseLogDate(c.Submit_Date);
        return d && d >= cutoff;
      });
    }
    
    const total = filtered.length;
    const newCount = filtered.filter(c => c.Status === 'new').length;
    const inProgress = filtered.filter(c => c.Status === 'in_progress').length;
    const closed = filtered.filter(c => c.Status === 'closed').length;
    
    // حساب متوسط أيام الحل
    const closedWithDays = filtered.filter(c => c.Status === 'closed' && c.Days_Open);
    const avgDays = closedWithDays.length > 0 
      ? Math.round(closedWithDays.reduce((sum, c) => sum + (parseInt(c.Days_Open) || 0), 0) / closedWithDays.length)
      : 0;
    
    // توزيع حسب النوع
    const byType = {};
    filtered.forEach(c => {
      const type = c.Complaint_Type || 'غير محدد';
      byType[type] = (byType[type] || 0) + 1;
    });
    
    // توزيع حسب الحالة
    const byStatus = {
      new: newCount,
      in_progress: inProgress,
      closed: closed
    };
    
    return {
      total,
      new: newCount,
      inProgress,
      closed,
      avgResolution: avgDays,
      byType,
      byStatus
    };
  }
  
  function getComplaints(params) {
    const sheet = getComplaintsSheet('Complaints_Log');
    const data = sheetToObjects(sheet);
    
    let filtered = data;
    
    // فلترة حسب الحالة
    if (params && params.status && params.status !== 'all') {
      filtered = filtered.filter(c => c.Status === params.status);
    }
    
    // فلترة حسب النوع
    if (params && params.type && params.type !== 'all') {
      filtered = filtered.filter(c => c.Complaint_Type === params.type);
    }
    
    // فلترة حسب التاريخ
    if (params && params.startDate) {
      filtered = filtered.filter(c => {
        const d = parseLogDate(c.Submit_Date);
        return d && d >= new Date(params.startDate);
      });
    }
    
    if (params && params.endDate) {
      filtered = filtered.filter(c => {
        const d = parseLogDate(c.Submit_Date);
        return d && d <= new Date(params.endDate + 'T23:59:59');
      });
    }
    
    // ترتيب من الأحدث للأقدم
    filtered.sort((a, b) => {
      const dateA = parseLogDate(a.Submit_Date);
      const dateB = parseLogDate(b.Submit_Date);
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB - dateA;
    });
    
    // تحديث أيام الفتح للشكاوى المفتوحة
    const now = getSaudiDate();
    const complaints = filtered.map(c => {
      let daysOpen = parseInt(c.Days_Open) || 0;
      if (c.Status !== 'closed') {
        const submitDate = parseLogDate(c.Submit_Date);
        if (submitDate) {
          daysOpen = Math.floor((now - submitDate) / (1000 * 60 * 60 * 24));
        }
      }
      
      return {
        id: c.Complaint_ID,
        _rowIndex: c._rowIndex,
        submitDate: formatDate(c.Submit_Date),
        submitTime: c.Submit_Time || '',
        type: c.Complaint_Type,
        complainantName: c.Complainant_Name,
        complainantPhone: c.Complainant_Phone || '',
        locations: c.Locations,
        description: (c.Description || '').substring(0, 100) + ((c.Description || '').length > 100 ? '...' : ''),
        complaintAgainst: c.Complaint_Against || '',
        status: c.Status,
        priority: c.Priority || 'medium',
        assignedTo: c.Assigned_To || '',
        daysOpen: daysOpen
      };
    });
    
    return { complaints };
  }
  
  function getComplaintDetails(complaintId) {
    const sheet = getComplaintsSheet('Complaints_Log');
    const data = sheetToObjects(sheet);
    
    const complaint = data.find(c => c.Complaint_ID === complaintId);
    
    if (!complaint) {
      return { error: 'الشكوى غير موجودة' };
    }
    
    // حساب أيام الفتح
    const now = getSaudiDate();
    let daysOpen = parseInt(complaint.Days_Open) || 0;
    if (complaint.Status !== 'closed') {
      const submitDate = parseLogDate(complaint.Submit_Date);
      if (submitDate) {
        daysOpen = Math.floor((now - submitDate) / (1000 * 60 * 60 * 24));
      }
    }
    
    // جلب سجل المتابعة
    const followupSheet = getComplaintsSheet('Complaints_Followup');
    const followups = sheetToObjects(followupSheet)
      .filter(f => f.Complaint_ID === complaintId)
      .map(f => ({
        date: formatDate(f.Date),
        action: f.Action,
        actionBy: f.Action_By,
        notes: f.Notes,
        status: f.Status
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return {
      complaint: {
        id: complaint.Complaint_ID,
        _rowIndex: complaint._rowIndex,
        submitDate: formatDate(complaint.Submit_Date),
        submitTime: complaint.Submit_Time || '',
        type: complaint.Complaint_Type,
        complainantName: complaint.Complainant_Name,
        complainantPhone: complaint.Complainant_Phone || '',
        complainantEmail: complaint.Complainant_Email || '',
        complaintDateTime: complaint.Complaint_DateTime || '',
        locations: complaint.Locations,
        description: complaint.Description,
        complaintAgainst: complaint.Complaint_Against || '',
        additionalNotes: complaint.Additional_Notes || '',
        status: complaint.Status,
        priority: complaint.Priority || 'medium',
        assignedTo: complaint.Assigned_To || '',
        assignedDate: formatDate(complaint.Assigned_Date),
        resolution: complaint.Resolution || '',
        resolutionDate: formatDate(complaint.Resolution_Date),
        closedBy: complaint.Closed_By || '',
        responseSent: complaint.Response_Sent || 'no',
        daysOpen: daysOpen
      },
      followups
    };
  }
  
  function updateComplaint(params) {
    const sheet = getComplaintsSheet('Complaints_Log');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const rowIndex = params.rowIndex;
    if (!rowIndex || rowIndex < 2) {
      return { success: false, error: 'صف غير صالح' };
    }
    
    const now = getSaudiDate();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    
    // تحديث الحقول المطلوبة
    const updates = {
      'Status': params.status,
      'Priority': params.priority,
      'Assigned_To': params.assignedTo,
      'Resolution': params.resolution,
      'Response_Sent': params.responseSent
    };
    
    // إذا تم تعيين مسؤول
    if (params.assignedTo && !params.skipAssignDate) {
      updates['Assigned_Date'] = dateStr;
    }
    
    // إذا تم الإغلاق
    if (params.status === 'closed') {
      updates['Resolution_Date'] = dateStr;
      updates['Closed_By'] = params.closedBy || params.actionBy || '';
      
      // حساب أيام الفتح
      const submitDateCol = headers.indexOf('Submit_Date');
      if (submitDateCol !== -1) {
        const submitDate = parseLogDate(data[rowIndex - 1][submitDateCol]);
        if (submitDate) {
          updates['Days_Open'] = Math.floor((now - submitDate) / (1000 * 60 * 60 * 24));
        }
      }
    }
    
    // تطبيق التحديثات
    for (const [field, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const colIndex = headers.indexOf(field);
        if (colIndex !== -1) {
          sheet.getRange(rowIndex, colIndex + 1).setValue(value);
        }
      }
    }
    
    // إضافة سجل متابعة
    const followupSheet = getComplaintsSheet('Complaints_Followup');
    const followupId = `CF-${Date.now()}`;
    followupSheet.appendRow([
      followupId,
      params.complaintId,
      dateStr,
      params.action || 'تحديث الشكوى',
      params.actionBy || 'النظام',
      params.notes || '',
      'completed'
    ]);
    
    return { success: true, message: 'تم تحديث الشكوى بنجاح' };
  }
  
  function getComplaintHistory(complaintId) {
    const followupSheet = getComplaintsSheet('Complaints_Followup');
    const data = sheetToObjects(followupSheet);
    
    const history = data
      .filter(f => f.Complaint_ID === complaintId)
      .map(f => ({
        date: formatDate(f.Date),
        action: f.Action,
        actionBy: f.Action_By,
        notes: f.Notes,
        status: f.Status
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return { history };
  }
  