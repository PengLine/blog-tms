/* 会话与身份：登录态、当前用户、页面级访问控制 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var cfg = TMS.cfg;

    function store() {
        try { return global.localStorage; } catch (err) { return null; }
    }

    function readSession() {
        var s = store();
        if (!s) return null;
        try {
            var raw = s.getItem(cfg.storage.userKey);
            return raw ? JSON.parse(raw) : null;
        } catch (err) { return null; }
    }

    function writeSession(session) {
        var s = store();
        if (!s) return;
        if (session) s.setItem(cfg.storage.userKey, JSON.stringify(session));
        else s.removeItem(cfg.storage.userKey);
        TMS.bus.emit('auth:change', session);
    }

    function current() { return readSession(); }

    function role() {
        var u = current();
        return u ? u.role : '';
    }

    /* 校验口令：账号档案一律取 users 集合（演示账号也由种子引擎写入该表并绑定真实组织/人员），
       cfg.demoAccounts 只在数据库尚未就绪时兜底，保证「登录看到的身份」和「用户权限页」同源 */
    function verify(username, password) {
        var row = null;
        try {
            row = TMS.db.findOne('users', function (u) { return u.username === username && u.status !== 'inactive'; });
        } catch (err) { row = null; }
        if (row) {
            if (match(row, password)) return { ok: true, profile: profileOf(row) };
            return { ok: false, message: '用户名或密码错误' };
        }
        var demo = cfg.demoAccounts.filter(function (a) { return a.username === username; })[0];
        if (demo) {
            if (demo.password !== password) return { ok: false, message: '用户名或密码错误' };
            return { ok: true, profile: {
                username: demo.username, name: demo.name, role: demo.role,
                orgId: demo.orgId || '', orgName: orgName(demo.orgId, demo.role)
            } };
        }
        return { ok: false, message: '账号不存在' };
    }

    function profileOf(row) {
        return {
            username: row.username, name: row.name, role: row.role,
            orgId: row.orgId || '', orgName: row.orgName || orgName(row.orgId, row.role),
            /* personId：一线岗绑定员工档案，页面据此过滤「我的任务/我的打卡/我的绩效」
               customerId：客户身份挂在客户档案上，门户只看本企业单据 */
            personId: row.personId || '', customerId: row.customerId || (row.role === 'client' ? row.orgId : ''),
            userId: row.id || ''
        };
    }

    function match(user, password) {
        var expect = user.passwordHash || user.password || '';
        if (expect && /^h:/.test(expect)) return expect === 'h:' + TMS.util.hash(password);
        return expect === password;
    }

    function orgName(orgId, r) {
        if (!orgId) return cfg.roles[r] ? cfg.roles[r].name : '';
        var name = '';
        try {
            var pool = r === 'client' ? 'customers' : (r === 'branch' || r === 'deliveryman' ? 'branches' : (r === 'sorter' ? 'hubs' : 'departments'));
            var row = TMS.db.get(pool, orgId);
            if (row) name = row.name || row.title || '';
        } catch (err) { name = ''; }
        return name || orgId;
    }

    function login(username, password) {
        var res = verify(String(username || '').trim(), String(password || ''));
        if (!res.ok) return res;
        var portal = cfg.roles[res.profile.role];
        var session = {
            username: res.profile.username, name: res.profile.name, role: res.profile.role,
            orgId: res.profile.orgId, orgName: res.profile.orgName,
            personId: res.profile.personId || '', customerId: res.profile.customerId || '',
            portal: portal ? portal.portal : 'index.html',
            permissions: TMS.rbac.permissionsFor(res.profile.role),
            loginAt: TMS.util.iso(TMS.util.now())
        };
        writeSession(session);
        return { ok: true, session: session, redirect: session.portal };
    }

    function logout() {
        writeSession(null);
        global.location.href = 'index.html';
    }

    /* 页面守卫：角色不符即退回登录页；require 为空表示只要求登录 */
    function require(allowedRoles) {
        var s = readSession();
        if (!s) { global.location.replace('index.html'); return null; }
        if (allowedRoles && allowedRoles.length) {
            var list = typeof allowedRoles === 'string' ? [allowedRoles] : allowedRoles;
            if (list.indexOf(s.role) === -1) {
                global.location.replace(s.portal || 'index.html');
                return null;
            }
        }
        return s;
    }

    /* 校验授权一律现读角色当前权限，不用登录时快照在 session 里的那份：
       快照会让「用户权限页改了角色」只影响菜单、不影响路由守卫与按钮，
       同一个角色两套答案比错到底层更糟。快照仅在数据库还没就绪时兜底 */
    function can(perm) {
        if (!perm) return true;
        var s = readSession();
        if (!s) return false;
        var perms;
        try { perms = TMS.rbac.permissionsFor(s.role); }
        catch (err) { perms = s.permissions || []; }
        if (perms.indexOf('*') > -1) return true;
        return perms.indexOf(perm) > -1 ||
            perms.indexOf(perm.split(':')[0] + ':*') > -1;
    }

    TMS.auth = {
        current: current, role: role, login: login, logout: logout,
        require: require, can: can, orgName: orgName,
        write: writeSession
    };
})(window);
