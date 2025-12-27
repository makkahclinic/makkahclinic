# MRIS - نظام استخبارات الموارد الطبية
## Schema Documentation

---

## 📊 هيكل الشيتات (3 طبقات)

### 🔴 Layer 1: Live Ops (التشغيل اليومي)
> تتغير بشكل متكرر - إدخال يومي

| Sheet Name | الوصف | الأعمدة |
|------------|-------|---------|
| `Staff_Roster` | سجل الموظفين | StaffID, Name, Email, Role, Department, Skills, Status, Phone |
| `Shifts_Live` | الشفتات الحية | ShiftID, Date, DeptID, StaffID, StartTime, EndTime, Status, CheckIn, CheckOut |
| `Workload_Live` | ضغط العمل | ID, Timestamp, DeptID, Patients, Procedures, WaitTime_Avg, PeakHour |
| `Consumption_Live` | الاستهلاك اليومي | ID, Timestamp, DeptID, ItemID, Quantity, Unit, ConsumedBy, Reason |
| `Assets_Status` | حالة الأجهزة | AssetID, Name, DeptID, Status, LastCheck, NextPM, Notes |

---

### 🟡 Layer 2: Decision & Alerts Log (السجل الذهبي)
> Append-only - لا يُعدَّل ولا يُحذف

| Sheet Name | الوصف | الأعمدة |
|------------|-------|---------|
| `Alerts_Log` | سجل التنبيهات | AlertID, Timestamp, Type, Severity, DeptID, Metric, Value, Threshold, Message, Status, ResolvedAt, ResolvedBy |
| `Decisions_Log` | سجل القرارات | DecisionID, Timestamp, AlertID, RecommendationType, Description, Impact, Cost, Risk, ApprovedBy, ApprovalDate, Status |
| `Actions_Log` | سجل الإجراءات | ActionID, Timestamp, DecisionID, ActionType, Description, ExecutedBy, ExecutedAt, Outcome, EvidenceRef |
| `Audit_Trail` | مسار التدقيق | AuditID, Timestamp, UserID, Action, Sheet, RowID, OldValue, NewValue, Reason |

---

### 🟢 Layer 3: Evidence Pack (أدلة سباهي)
> كتابة رسمية فقط - مخرجات موثقة

| Sheet Name | الوصف | الأعمدة |
|------------|-------|---------|
| `Procurement_Decisions` | قرارات الشراء | ProcID, Date, ItemID, Quantity, Justification, AlertRef, ApprovedBy, PRNumber, PONumber, DeliveryDate, Status |
| `Committee_Minutes` | محاضر اللجان | MinutesID, Date, Committee, Attendees, Agenda, Decisions, ActionItems, NextMeeting |
| `KPI_Weekly` | مؤشرات أسبوعية | WeekID, StartDate, EndDate, Coverage_Avg, Understaffed_Days, StressIndex_Avg, ConsumptionIntegrity, RiskLevel |
| `Evidence_Index` | فهرس الأدلة | EvidenceID, Date, Standard, Requirement, EvidenceType, Description, FileRef, CreatedBy |

---

## 🔑 Master Data (البيانات المرجعية)

| Sheet Name | الوصف | الأعمدة |
|------------|-------|---------|
| `Departments` | الأقسام | DeptID, Name, NameEN, Floor, Type, Active, RequiredBase, WorkloadWeight |
| `Rooms` | الغرف | RoomID, DeptID, Name, Type, Capacity, Equipment |
| `Items_Catalog` | كتالوج المواد | ItemID, Name, Category, Unit, MinLevel, MaxLevel, ReorderPoint, CostPerUnit |
| `Roles_Permissions` | الصلاحيات | RoleID, RoleName, CanRead, CanWrite, CanApprove, CanAdmin |
| `Staff_Tokens` | توكنات المصادقة | TokenID, StaffID, Token, RoleID, ExpiresAt, Active |

---

## 📐 حساب المؤشرات الذكية

### Coverage Index (نسبة التغطية)
```
Coverage = (Actual_Staff / Required_Staff) × 100
Required = Base + (Workload × Weight)
```

### Staff Stress Index (مؤشر الإرهاق)
```
Stress = (Hours_Worked / Max_Hours) × 0.4 +
         (Consecutive_Days / Max_Days) × 0.3 +
         (Workload_Per_Person / Target) × 0.3
```

### Consumption Integrity (سلامة الاستهلاك)
```
Integrity = 1 - |Actual - Expected| / Expected
Anomaly if Integrity < 0.7 or > 1.3
```

### Safety Risk Projection (توقع المخاطر)
```
Risk = (Understaffing × 0.3) +
       (HighStress × 0.3) +
       (LowInventory × 0.2) +
       (PendingMaintenance × 0.2)
```

---

## 🔐 API Endpoints

### القراءة (GET)
| Action | الوصف | الصلاحية |
|--------|-------|----------|
| `getHeatmap` | خريطة التغطية | All |
| `getKpis` | المؤشرات الرئيسية | All |
| `getDeptDetails` | تفاصيل القسم | All |
| `getAlerts` | التنبيهات النشطة | All |
| `getConsumablesStatus` | حالة المخزون | All |
| `getStaffRoster` | قائمة الموظفين | HR, Admin |
| `getAuditTrail` | سجل التدقيق | Admin |

### الكتابة (POST)
| Action | الوصف | الصلاحية | Target Sheet |
|--------|-------|----------|--------------|
| `logAlert` | تسجيل تنبيه | System | Alerts_Log |
| `logDecision` | تسجيل قرار | Quality, Admin | Decisions_Log |
| `logAction` | تسجيل إجراء | All | Actions_Log |
| `updateShift` | تحديث شفت | HR, Admin | Shifts_Live |
| `logConsumption` | تسجيل استهلاك | Store, Admin | Consumption_Live |
| `createProcurement` | طلب شراء | Store, Admin | Procurement_Decisions |
| `updateAssetStatus` | تحديث جهاز | FMS, Admin | Assets_Status |

---

## 🔄 Decision-to-Evidence Pipeline

```
Signal → Analysis → Recommendation → Approval → Action → Evidence
  ↓         ↓            ↓              ↓          ↓         ↓
Sheets   Indices    Alerts_Log    Decisions   Actions   Evidence
                                    _Log        _Log      _Index
```

### مثال عملي:
1. **Signal**: الاستهلاك ارتفع 150% في الأسنان
2. **Analysis**: Consumption Integrity = 0.6 (شذوذ)
3. **Recommendation**: تدقيق الهدر + مراجعة المخزون
4. **Approval**: مدير الجودة يعتمد
5. **Action**: تم التدقيق ووُجد خلل تدريبي
6. **Evidence**: تقرير التدقيق + إجراء تصحيحي → Evidence_Index

---

## 🛡️ قواعد الأمان

1. **Token-based Auth**: كل طلب يحمل Token صالح
2. **Role-based Access**: الصلاحيات حسب الدور
3. **Append-only Logs**: السجلات لا تُعدَّل
4. **Validation**: التحقق من البيانات قبل الكتابة
5. **Audit Trail**: تسجيل كل تعديل

---

## 📋 Standards Mapping (ربط سباهي)

| Standard | Requirement | Evidence Source |
|----------|-------------|-----------------|
| LD 4.5 | Resource Adequacy | Staff_Roster, Shifts, KPI_Weekly |
| HR 1 | Staffing Plan | Staff_Roster, Workload_Live |
| FMS 2 | Equipment Maintenance | Assets_Status, Audit_Trail |
| IC 1 | Infection Control | Consumption_Live, Actions_Log |
| QI 1 | Quality Improvement | Decisions_Log, Evidence_Index |
