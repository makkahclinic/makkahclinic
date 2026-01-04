/**
 * Bootstrap - تهيئة RBAC
 * يُستدعى مرة واحدة بعد تسجيل الدخول
 */

import { RBAC } from './rbac.js';

export function initRBAC(userData) {
    const rbac = new RBAC(userData);
    rbac.applyUI();
    return rbac;
}

export function getRedirectAfterLogin(userData) {
    const rbac = new RBAC(userData);
    return rbac.getRedirectUrl();
}

export function redirectAfterLogin(userData) {
    const url = getRedirectAfterLogin(userData);
    window.location.href = url;
}
