/**
 * Guard - حماية الصفحات
 * يُستخدم في أعلى كل صفحة نظام
 */

import { RBAC } from './rbac.js';

export function guardSystemPage(userData, permissionKey) {
    const rbac = new RBAC(userData);
    return rbac.guardPage(permissionKey);
}

export function guardDashboardPage(userData, dashboardType) {
    const rbac = new RBAC(userData);
    return rbac.guardDashboard(dashboardType);
}

export function checkPermission(userData, permissionKey) {
    const rbac = new RBAC(userData);
    return rbac.can(permissionKey);
}
