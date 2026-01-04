/**
 * سكربت تحويل allowedSystems إلى permissions
 * يُنفَّذ مرة واحدة فقط في Firebase Console أو Node.js
 * 
 * الخطوات:
 * 1. افتح Firebase Console → Firestore
 * 2. اضغط على زر Cloud Shell أو استخدم Node.js محلياً
 * 3. انسخ والصق هذا الكود
 */

// ========================
// للتشغيل في Firebase Console
// ========================

/*
const db = firebase.firestore();

async function migratePermissions() {
    const snapshot = await db.collection('staff_roles').get();
    let migrated = 0;
    let skipped = 0;
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        
        // تخطي إذا كان لديه permissions بالفعل
        if (data.permissions && Object.keys(data.permissions).length > 0) {
            console.log(`Skipped ${data.email} - already has permissions`);
            skipped++;
            continue;
        }
        
        // تحويل allowedSystems إلى permissions
        const permissions = {};
        const allowedSystems = data.allowedSystems || [];
        
        // قائمة كل الأنظمة
        const allSystems = [
            'dashboard', 'eoc', 'complaints', 'incidents', 
            'risks', 'rounds', 'calibration', 'maintenance', 
            'needlestick', 'insurance', 'cbahi'
        ];
        
        // للمالك والمدير: كل الصلاحيات
        if (data.role === 'owner' || data.role === 'admin') {
            allSystems.forEach(sys => permissions[sys] = true);
        } else {
            // للموظفين: فقط ما في allowedSystems
            allSystems.forEach(sys => {
                permissions[sys] = allowedSystems.includes(sys);
            });
        }
        
        // تحديث المستند
        await db.collection('staff_roles').doc(doc.id).update({
            permissions: permissions,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Migrated ${data.email} - Role: ${data.role}`);
        migrated++;
    }
    
    console.log(`\n✅ Migration complete!`);
    console.log(`   Migrated: ${migrated}`);
    console.log(`   Skipped: ${skipped}`);
}

migratePermissions();
*/

// ========================
// للتشغيل في Node.js
// ========================

const admin = require('firebase-admin');

// Initialize with service account
// const serviceAccount = require('./path-to-service-account.json');
// admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function migratePermissions() {
    const db = admin.firestore();
    const snapshot = await db.collection('staff_roles').get();
    
    let migrated = 0;
    let skipped = 0;
    
    const allSystems = [
        'dashboard', 'eoc', 'complaints', 'incidents', 
        'risks', 'rounds', 'calibration', 'maintenance', 
        'needlestick', 'insurance', 'cbahi'
    ];
    
    for (const doc of snapshot.docs) {
        const data = doc.data();
        
        if (data.permissions && Object.keys(data.permissions).length > 0) {
            console.log(`Skipped ${data.email} - already has permissions`);
            skipped++;
            continue;
        }
        
        const permissions = {};
        const allowedSystems = data.allowedSystems || [];
        
        if (data.role === 'owner' || data.role === 'admin') {
            allSystems.forEach(sys => permissions[sys] = true);
        } else {
            allSystems.forEach(sys => {
                permissions[sys] = allowedSystems.includes(sys);
            });
        }
        
        await db.collection('staff_roles').doc(doc.id).update({
            permissions: permissions,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`Migrated ${data.email} - Role: ${data.role}`);
        migrated++;
    }
    
    console.log(`\n✅ Migration complete! Migrated: ${migrated}, Skipped: ${skipped}`);
}

// migratePermissions().then(() => process.exit(0));

console.log(`
========================================
سكربت تحويل الصلاحيات
========================================

لتشغيل هذا السكربت:

1️⃣ في Firebase Console:
   - اذهب إلى Firestore
   - افتح Cloud Shell
   - انسخ الكود الموجود في القسم الأول

2️⃣ في Node.js:
   - احصل على Service Account من Firebase Console
   - قم بتفعيل admin.initializeApp
   - شغّل: node migration-script.js

========================================
`);
