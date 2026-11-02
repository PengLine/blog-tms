/* 应用外壳：桌面（运营端·网点端）/ 移动（分拣·司机·派送）/ 门户（客户端）三套骨架 + 路由 + 全局动作
   页面只写内容与导航，导航、权限、刷新、告警、时钟都由 shell 统一装配
   路由：每个菜单项一个 HTML 文件（无 SPA），按角色分目录存放，
        hash 形如 #pageId?orderId=HL… 支持深链到子页 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, cfg = TMS.cfg;

    var shell = {
        state: { portal: 'admin', pageId: '', session: null, params: {}, days: 7, root: null, renderCount: 0 }
    };

    /* ---------- 参数与路由 ---------- */

    function parseHash(hash) {
        var raw = String(hash || '').replace(/^#/, '');
        var qi = raw.indexOf('?');
        var pageId = qi > -1 ? raw.slice(0, qi) : raw;
        var params = {};
        var qsPart = qi > -1 ? raw.slice(qi + 1) : '';
        qsPart.split('&').forEach(function (kv) {
            if (!kv) return;
            var i = kv.indexOf('=');
            var k = i > -1 ? kv.slice(0, i) : kv;
            var v = i > -1 ? kv.slice(i + 1) : '';
            params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
        });
        return { pageId: pageId, params: params };
    }

    function buildHash(pageId, params) {
        var qs = Object.keys(params || {}).filter(function (k) { return params[k] !== '' && params[k] != null; })
            .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
        return '#' + pageId + (qs ? '?' + qs : '');
    }

    function fileOf(pageId, role) {
        var def = TMS.pages.get(pageId);
        if (def && def.file) return def.file;
        var item = TMS.rbac.findMenu(role, pageId);
        return item ? item.file : null;
    }

    /* 菜单里的 file 是站点根相对路径（admin/order.html），页面自己住在角色目录里，
       所以链接一律经 util.url 换算基准：根目录的登录页基准为空，角色页的基准是 ../。
       少这一步，角色页点侧栏就会跳去 admin/admin/order.html */
    function currentFile() {
        var segs = String(global.location.pathname || '').split('/').filter(Boolean);
        return segs.length > 1 ? segs.slice(-2).join('/') : (segs[0] || 'index.html');
    }

    function hrefOf(file) {
        return file ? util.url(file) : file;
    }

    function go(pageId, params, opts) {
        var o = opts || {};
        var s = shell.state;
        var target = fileOf(pageId, s.session ? s.session.role : s.portal);
        if (target && target !== currentFile() && !o.forceHash) {
            global.location.href = hrefOf(target) + buildHash(pageId, params);
            return;
        }
        global.location.hash = buildHash(pageId, params);
        mount({ pageId: pageId, params: params, portal: s.portal, session: s.session, root: s.root });
    }

    /* ---------- 外壳渲染 ---------- */

    /* 外壳形态由 cfg.roles 声明，不在这里写死角色名单：
       运营端和网点端是后台（desktop），分拣/司机/派送是手持作业（mobile），客户是网页门户（portal） */
    function layoutOf(portal) {
        var conf = cfg.roles[portal] || {};
        return conf.layout || 'mobile';
    }

    /* 侧栏角标：运营端数全库，网点只数自己这一份。
       不加口径的后果是网点工作台顶着一个「异常 47」，其中 40 单根本不归它管 */
    function navCounts(session) {
        var out = {};
        try {
            var orders = db.col('orders').filter(TMS.pages.orderScope(session));
            var mine = {};
            orders.forEach(function (o) { mine[o.id] = true; });
            out.order = orders.length;
            out['tms-order'] = out.order;
            out.exception = db.col('exceptions').filter(function (e) {
                return e.status !== 'resolved' && (!e.orderId || mine[e.orderId]);
            }).length;
            out['b-service'] = out.exception;
            out.transport = db.col('transports').filter(function (t) { return ['pending', 'loading', 'departed'].indexOf(t.status) > -1; }).length;
            out.pending = db.col('payables').filter(function (p) { return p.status === 'pending'; }).length;
            out.overdue = orders.filter(function (o) { return TMS.order.isLate(o); }).length;
            out.cod = db.col('codRecords').filter(function (r) { return r.remitStatus === 'pending'; }).length;
        } catch (err) { /* 主数据未就绪时不打断外壳渲染 */ }
        return out;
    }

    function sideNav(session, activeId) {
        var menu = TMS.rbac.navGroups(session);
        var counts = navCounts(session);
        return '<nav class="tms-side-nav">' + menu.map(function (g) {
            return '<div class="tms-nav-group">' + esc(g.group) + '</div>' + g.items.map(function (it) {
                var n = counts[it.id] || counts[it.perm && it.perm.split(':')[0]] || 0;
                return '<a class="tms-nav-item' + (it.id === activeId ? ' active' : '') + '" href="' + esc(hrefOf(it.file)) + buildHash(it.id, {}) + '">' +
                    '<span class="tms-ico">' + esc(it.icon) + '</span><span>' + esc(it.label) + '</span>' +
                    (n ? '<span class="tms-nav-count' + (it.id === 'exception' ? ' alert' : '') + '">' + n + '</span>' : '') + '</a>';
            }).join('');
        }).join('') + '</nav>';
    }

    var ALERT_PAGE = {
        orders: 'order', scans: 'scan', transports: 'transport', exceptions: 'exception',
        receivables: 'receivable', payables: 'payable', vehicles: 'vehicle', materials: 'material',
        devices: 'monitor', claims: 'claim', codRecords: 'cod', customers: 'customer'
    };

    function alertsPanel() {
        var rows = util.sortBy(db.col('alerts').filter(function (a) { return a.status === 'open'; }), 'lastAt', 'desc').slice(0, 14);
        if (!rows.length) return ui.empty('暂无未闭环告警', 'SLA 巡检会自动登记超时、滞留、逾期与设备异常', '✓');
        return ui.list(rows.map(function (a) {
            return {
                title: ui.badge(a.level === 'error' ? '严重' : a.level === 'warn' ? '警告' : '提示',
                    a.level === 'error' ? 'danger' : a.level === 'warn' ? 'warn' : 'info') + ' ' + esc(a.title || ''),
                sub: esc(a.message || '') + ' · 最近 ' + fmtTime(a.lastAt) + ' · 命中 ' + (a.hitCount || 1) + ' 次',
                act: 'alert:read', arg: a.key,
                right: ALERT_PAGE[a.entity] ? ui.link(esc(db.meta(a.entity).label || a.entity), 'alert:goto', ALERT_PAGE[a.entity] + '|' + (a.refId || '')) : ''
            };
        }));
    }

    function bell(session) {
        var open = db.col('alerts').filter(function (a) { return a.status === 'open'; }).length;
        return ui.iconBtn('◷', 'shell:alerts', '系统告警', { dot: open || null });
    }

    function userChip(session) {
        return '<div class="tms-user" data-act="shell:user">' +
            '<span class="tms-avatar">' + esc(String(session.name || session.username || 'T').slice(0, 1)) + '</span>' +
            '<span class="tms-user-txt"><b>' + esc(session.name || session.username) + '</b>' +
            '<span>' + esc(cfg.roles[session.role] ? cfg.roles[session.role].name : session.role) + (session.orgName ? ' · ' + esc(session.orgName) : '') + '</span></span>' +
            '<span class="tms-dim">▾</span></div>';
    }

    /* 时间窗切换不能用通用 seg 动作：那个只写页面 state，
       而 days 是跨页面的外壳状态（仪表盘、报表、监控都按它取数） */
    function daysSeg(active) {
        return '<div class="tms-seg">' + [7, 14, 30].map(function (n) {
            return '<button type="button" class="' + (Number(active) === n ? 'on' : '') + '" data-act="shell:days" data-arg="' + n + '">' + n + ' 日</button>';
        }).join('') + '</div>';
    }

    function desktopChrome(session, pageId, title) {
        var menu = TMS.rbac.navGroups(session);
        var crumb = '';
        menu.forEach(function (g) {
            g.items.forEach(function (it) {
                if (it.id === pageId) crumb = esc(g.group) + ' / ';
            });
        });
        var el = document.createElement('div');
        el.className = 'tms-shell';
        el.innerHTML =
            '<aside class="tms-side" id="tms-side">' +
            '<div class="tms-side-brand"><span class="tms-side-logo">' + esc(cfg.brand.short) + '</span>' +
            '<div><b>' + esc(cfg.brand.name) + '</b><span>' + esc(roleName(session)) + '</span></div></div>' +
            sideNav(session, pageId) +
            '<div class="tms-side-foot" id="tms-side-foot"></div></aside>' +
            '<div class="tms-main">' +
            '<header class="tms-topbar">' +
            '<button type="button" class="tms-iconbtn tms-burger" data-act="shell:menu">☰</button>' +
            '<div class="tms-crumb">' + crumb + '<b>' + esc(title) + '</b></div>' +
            '<div class="tms-topbar-spacer"></div>' +
            '<div class="tms-search tms-jump">' +
            '<span class="tms-ico">⌕</span><input class="tms-input" id="tms-jump" placeholder="单号 / 运单号，回车直达" autocomplete="off"></div>' +
            '<span class="tms-clock" id="tms-clock"></span>' +
            '<span id="tms-days">' + daysSeg(shell.state.days) + '</span>' +
            bell(session) +
            (hasPerm('data:reset') ? ui.iconBtn('⚙', 'shell:data', '演示数据维护', {}) : '') +
            userChip(session) +
            '</header>' +
            '<main class="tms-content" id="tms-content"></main>' +
            '</div>';
        return el;
    }

    /* 侧栏副标题点出这是哪一端：网点和运营的桌面壳长得一样，
       不写清楚的话使用者会以为自己在总部后台 */
    function roleName(session) {
        var conf = cfg.roles[session.role];
        return session.role === 'admin' ? '运输管理系统' : ((conf && conf.name) || session.role);
    }

    function mobileChrome(session, pageId, title) {
        var items = TMS.rbac.portalMenu(session.role);
        var tabs = items.filter(function (it) { return it.tab && hasPerm(it.perm); });
        var more = items.filter(function (it) { return !it.tab && hasPerm(it.perm); });
        var el = document.createElement('div');
        el.className = 'tms-shell-mobile';
        el.innerHTML =
            '<header class="tms-appbar"><div class="tms-appbar-row">' +
            '<div style="flex:1"><b>' + esc(title) + '</b><div class="tms-muted">' +
            esc(session.orgName || '') + ' · ' + esc(session.name || '') + '</div></div>' +
            (more.length ? ui.iconBtn('☰', 'shell:more', '更多功能', {}) : '') +
            bell(session) +
            ui.iconBtn('⏻', 'shell:logout', '退出登录', {}) +
            '</div>' +
            (tabs.length > 4 ? '<div class="tms-tabs-mid">' + tabs.map(function (it) {
                return '<span class="tms-chip' + (it.id === pageId ? ' on' : '') + '" style="background:rgba(255,255,255,.18);border-color:transparent;color:#fff"' +
                    (it.id === pageId ? '' : ' data-act="nav" data-arg="' + esc(it.id) + '"') + '>' + esc(it.label) + '</span>';
            }).join('') + '</div>' : '') +
            '</header>' +
            '<main class="tms-content" id="tms-content"></main>' +
            '<nav class="tms-tabbar">' + tabs.slice(0, 5).map(function (it) {
                return '<a class="tms-tab' + (it.id === pageId ? ' active' : '') + '" href="' + esc(hrefOf(it.file)) + buildHash(it.id, {}) + '">' +
                    '<span class="tms-ico">' + esc(it.icon) + '</span><span>' + esc(it.label) + '</span></a>';
            }).join('') + '</nav>';
        return el;
    }

    function portalChrome(session, pageId, title) {
        var items = TMS.rbac.portalMenu(session.role);
        var el = document.createElement('div');
        el.className = 'tms-shell tms-shell-portal';
        el.innerHTML =
            '<header class="tms-portal-head"><div class="tms-portal-inner">' +
            '<div class="tms-portal-brand"><span class="tms-side-logo">' + esc(cfg.brand.short) + '</span><b>' + esc(cfg.brand.name) + '</b></div>' +
            '<nav class="tms-portal-nav">' + items.filter(function (it) { return hasPerm(it.perm); }).map(function (it) {
                return '<a class="' + (it.id === pageId ? 'active' : '') + '" href="' + esc(hrefOf(it.file)) + buildHash(it.id, {}) + '">' + esc(it.label) + '</a>';
            }).join('') + '</nav>' +
            '<div class="tms-portal-side">' + userChip(session) +
            ui.btn('退出', { size: 'sm', act: 'shell:logout' }) + '</div>' +
            '</div></header>' +
            '<main class="tms-content" id="tms-content"></main>' +
            '<footer class="tms-portal-foot"><div>' + esc(cfg.brand.name) + ' · 演示环境，全部数据存于本机浏览器 localStorage，' +
            '重建数据或清理浏览器记录即恢复初始状态</div></footer>';
        return el;
    }

    function hasPerm(perm) { return !perm || TMS.auth.can(perm); }

    function esc(v) { return util.esc(v); }
    function fmtTime(v) { return util.fmt.dateTime(v); }

    /* ---------- 页面挂载 ---------- */

    function mount(opts) {
        var o = opts || {};
        var s = shell.state;
        /* 地址栏 hash 优先：tms-order.html#order-detail?orderId=… 这类深链要落在 hash 指向的页面 */
        var hashed = parseHash(global.location.hash);
        var hash = o.pageId && !hashed.pageId ? { pageId: o.pageId, params: o.params || {} } : hashed;
        var session = o.session || TMS.auth.current();
        if (!session) return;
        var pageId = hash.pageId || defaultPage(session);
        var def = TMS.pages.get(pageId) || TMS.pages.get(defaultPage(session));
        if (!def) {
            var placeholder = o.root || document.getElementById('tms-root') || document.body;
            placeholder.innerHTML = ui.empty('页面「' + pageId + '」尚未注册', '请确认 js/pages/ 下已 define 该页面 id');
            return;
        }
        if (def.perm && !TMS.auth.can(def.perm)) {
            ui.toast('没有访问「' + (def.title || pageId) + '」的权限', 'error');
            global.location.replace(hrefOf(cfg.roles[session.role].portal));
            return;
        }
        /* 深链指向其他页面文件时先跳过去：一个 HTML 只承载自己注册的那组页面 */
        if (def.file && def.file !== currentFile()) {
            global.location.replace(hrefOf(def.file) + buildHash(def.id, hash.params));
            return;
        }

        s.portal = o.portal || session.role;
        s.session = session;
        s.pageId = def.id;
        s.params = hash.params || {};
        s.days = o.days || s.days;

        /* 外壳只在首次或布局类型变化时重建，翻页只换内容区 */
        var layout = def.bare ? 'bare' : layoutOf(session.role);
        if (!s.chrome || s.chromeLayout !== layout || !document.getElementById('tms-content')) {
            if (s.chrome && s.chrome.parentNode) s.chrome.parentNode.removeChild(s.chrome);
            s.chrome = null;
            if (layout === 'bare') {
                s.content = o.root || document.getElementById('tms-root') || document.body;
            } else {
                document.body.classList.add('tms-body');
                var chrome = layout === 'desktop' ? desktopChrome(session, def.id, def.title)
                    : layout === 'mobile' ? mobileChrome(session, def.id, def.title) : portalChrome(session, def.id, def.title);
                var placeholder2 = o.root && o.root.parentNode ? o.root : document.getElementById('tms-root');
                if (placeholder2 && placeholder2.parentNode) placeholder2.parentNode.removeChild(placeholder2);
                document.body.appendChild(chrome);
                s.chrome = chrome;
                s.content = chrome.querySelector('#tms-content');
                bindChrome(chrome);
            }
            s.chromeLayout = layout;
            ui.bindActions(document);
        }
        syncChrome(def);
        render(def);
    }

    /* 翻页后同步外壳的标题、当前菜单高亮与容量脚注 */
    function syncChrome(def) {
        var s = shell.state, chrome = s.chrome;
        if (!chrome) return;
        var titleEl = chrome.querySelector('.tms-crumb b, .tms-appbar b');
        if (titleEl) titleEl.textContent = def.title;
        /* 门户壳顶栏不放页面标题（标题在正文的 .tms-page-head 里），
           但浏览器标签页得有名字，否则客户切个标签回来全是同一个站点名 */
        document.title = def.title + ' · ' + cfg.brand.name;
        var activeId = def.id;
        qsa(chrome, '.tms-nav-item,.tms-tab,.tms-portal-nav a,.tms-chip').forEach(function (a) {
            var on = a.getAttribute('data-arg') === activeId || String(a.getAttribute('href') || '').indexOf('#' + activeId) > -1;
            a.classList.toggle('active', on);
            if (a.classList.contains('tms-chip')) a.classList.toggle('on', on);
        });
        var foot = chrome.querySelector('#tms-side-foot');
        if (foot) {
            var info = db.info();
            foot.innerHTML = '演示库 ' + (info.bytes / 1048576).toFixed(2) + ' MB · ' + util.fmt.number(info.rows.orders) + ' 单 · ' +
                util.fmt.number(info.rows.scans) + ' 条轨迹';
        }
        /* 时间窗是高栏上的活性控件：切换后必须重画，否则「7 日」永远看起来按下去的是它自己 */
        var daysEl = chrome.querySelector('#tms-days');
        if (daysEl) daysEl.innerHTML = daysSeg(s.days);
    }

    function qsa(root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

    function defaultPage(session) {
        var conf = cfg.roles[session.role];
        return conf ? conf.home : 'overview';
    }

    function render(def) {
        var s = shell.state;
        var ctx = {
            shell: s, session: s.session, params: s.params, days: s.days, layout: s.chromeLayout,
            pageId: def.id, role: s.session.role,
            go: go, refresh: function () { render(def); },
            /* 列表页保持筛选/分页状态：kit 的 ui.state 按 pageId 存，重渲染不丢 */
            state: ui.state(def.id),
            toast: ui.toast, confirm: ui.confirm, modal: ui.modal, drawer: ui.drawer, formModal: ui.formModal
        };
        var root = s.content;
        var scrollY = global.pageYOffset || 0;
        var html = '';
        try {
            var data = def.load ? def.load(ctx) : {};
            ctx.data = data;
            html = def.render ? def.render(ctx, data) : '';
        } catch (err) {
            html = ui.card({
                title: '页面渲染异常', tone: 'danger',
                body: ui.notice('<div class="tms-mono">' + esc(err && err.message ? err.message : String(err)) + '</div>' +
                    '<div class="tms-mono tms-dim" style="max-height:180px;overflow:auto">' + esc(((err && err.stack) || '').split('\n').slice(1, 7).join('\n')) + '</div>', 'danger', '请在 tools/smoke.js 复现后修复')
            });
            if (global.console) console.error('[TMS.pages] ' + def.id + ' 渲染失败', err);
        }
        ui.actions = {};
        Object.keys(shell.actions || {}).forEach(function (k) { ui.actions[k] = shell.actions[k]; });
        if (def.actions) Object.keys(def.actions).forEach(function (k) { ui.actions[k] = def.actions[k]; });
        root.innerHTML = html;
        if (def.afterRender) { try { def.afterRender(ctx, root); } catch (e) { if (console) console.error(e); } }
        s.renderCount++;
        /* 同页刷新（动作、告警、数据变更）留在原滚动位置，切页回到顶部 */
        global.scrollTo(0, def.id === s.lastPage ? scrollY : 0);
        s.lastPage = def.id;
    }

    /* ---------- 外壳动作 ---------- */

    function bindChrome(chrome) {
        var jump = chrome.querySelector('#tms-jump');
        if (jump) {
            jump.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                var q = jump.value.trim();
                if (!q) return;
                /* 直达也要讲口径：网点输入别人网点的一票，不该把它拉到详情抽屉里 */
                var session = shell.state.session;
                var inScope = db.col('orders').filter(TMS.pages.orderScope(session));
                var order = inScope.filter(function (o) {
                    return o.id === q || o.waybillNo === q || (o.receiverPhone && String(o.receiverPhone).slice(-4) === q);
                })[0];
                if (!order) { ui.toast('你的数据范围内没有单号 ' + q, 'warn'); return; }
                go(TMS.pages.orderPageFor(session.role), { orderId: order.id });
            });
        }
        var clock = chrome.querySelector('#tms-clock');
        if (clock) tick(clock);
    }

    function tick(el) {
        var d = util.now();
        el.textContent = util.dateKey(d) + ' ' + util.fmt.time(d);
        global.setTimeout(function () { if (el.parentNode) tick(el); }, 30000);
    }

    /* 列表控件都包在 [data-sk] 里：一页放两张表时它们的状态必须分开，
       否则「待揽收」翻页会把「今日揽收记录」一起拽到第 2 页。
       页签、时间窗这类不属于列表的控件回落到页面级状态 */
    function stateFor(el) {
        var host = el && el.closest ? el.closest('[data-sk]') : null;
        return ui.state(host ? host.getAttribute('data-sk') : shell.state.pageId);
    }

    shell.actions = {
        'shell:menu': function () {
            var side = document.getElementById('tms-side');
            if (!side) return;
            side.classList.toggle('open');
            if (side.classList.contains('open') && !document.querySelector('.tms-side-mask')) {
                var mask = document.createElement('div');
                mask.className = 'tms-side-mask';
                mask.addEventListener('click', function () {
                    side.classList.remove('open');
                    mask.parentNode && mask.parentNode.removeChild(mask);
                });
                document.body.appendChild(mask);
            }
        },
        'shell:alerts': function () {
            ui.modal({
                title: '系统告警', sub: '由 SLA 巡检任务自动登记，处理后自动关闭',
                body: alertsPanel(),
                footer: ui.btn('全部标记已读', { act: 'alert:readAll' }) + ui.btn('关闭', { act: 'ui:close' })
            });
        },
        'shell:data': function (arg, el) {
            /* 按钮只对持有 data:reset 的角色露面，动作本身再挡一道：
               键盘/旧链接仍能触达这里，重建会连带清掉别人录的数据 */
            if (!hasPerm('data:reset')) { ui.toast('没有数据维护权限', 'error'); return; }
            ui.popup(el, [
                { icon: '⟳', label: '重建演示数据', act: 'shell:rebuild', tone: 'danger' },
                { icon: '⤓', label: '导出当前库 JSON', act: 'shell:export' },
                { icon: '▤', label: '存储与容量', act: 'shell:capacity' }
            ], { onPick: function (act, a) { shell.actions[act](a); } });
        },
        'shell:user': function (arg, el) {
            var s = shell.state.session;
            ui.popup(el, [
                { icon: '☗', label: s.name + '（' + (cfg.roles[s.role] || {}).name + '）', right: s.orgName || '' },
                { icon: '⚿', label: '我的权限', act: 'shell:perms' },
                '-',
                { icon: '⏻', label: '退出登录', act: 'shell:logout', tone: 'danger' }
            ], { onPick: function (act) { if (shell.actions[act]) shell.actions[act](); } });
        },
        'shell:perms': function () {
            var perms = TMS.rbac.permissionsFor(shell.state.session.role);
            ui.modal({
                title: '我的权限点', sub: '共 ' + perms.length + ' 项，控制菜单与按钮可见性',
                body: '<div class="tms-row">' + perms.map(function (p) {
                    var meta = TMS.rbac.PERMISSIONS.filter(function (x) { return x.code === p; })[0];
                    return ui.chip(p === '*' ? '全部权限' : ((meta ? meta.name + ' ' : '') + p), {});
                }).join(' ') + '</div>',
                footer: ui.btn('关闭', { act: 'ui:close' })
            });
        },
        'shell:more': function (arg, el) {
            var items = TMS.rbac.portalMenu(shell.state.session.role).filter(function (it) { return !it.tab && hasPerm(it.perm); });
            ui.popup(el, items.map(function (it) {
                return { icon: it.icon, label: it.label, act: 'nav', arg: it.id };
            }).concat(['-', { icon: '⏻', label: '退出登录', act: 'shell:logout', tone: 'danger' }]), { align: 'left', title: '更多功能' });
        },
        'nav': function (pageId) { if (pageId) go(pageId, {}); },
        'alert:read': function (key) {
            if (!key) return;
            TMS.jobs.closeAlert(key, shell.state.session.name + ' 已确认');
            ui.toast('告警已确认', 'success');
            ui.closeTop();
            scheduleRefresh();
        },
        'alert:readAll': function () {
            db.col('alerts').filter(function (a) { return a.status === 'open'; })
                .forEach(function (a) { TMS.jobs.closeAlert(a.key, shell.state.session.name + ' 批量确认'); });
            ui.closeTop();
            ui.toast('全部告警已确认', 'success');
            scheduleRefresh();
        },
        'alert:goto': function (arg) {
            var parts = String(arg || '').split('|');
            ui.closeTop();
            if (!parts[0]) return;
            go(parts[0], parts[1] ? { orderId: parts[1], id: parts[1] } : {});
        },
        'shell:rebuild': function () {
            ui.confirm({ title: '重建演示数据', message: '将清空 localStorage 并按当前种子引擎重新生成全库，页面上手工录入的数据会一并丢失。', danger: true, okText: '重建' })
                .then(function (yes) {
                    if (!yes) return;
                    TMS.maintenance.rebuild();
                    ui.toast('演示数据已重建', 'success');
                    global.location.reload();
                });
        },
        'shell:export': function () {
            var text = TMS.maintenance.export();
            var blob = new Blob([text], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = global.URL.createObjectURL(blob);
            a.download = 'tms-' + util.dateKey(util.now()) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            ui.toast('已导出 ' + (text.length / 1024).toFixed(0) + ' KB', 'success');
        },
        'shell:capacity': function () {
            var info = db.info();
            var rows = Object.keys(info.rows).filter(function (k) { return info.rows[k]; })
                .sort(function (a, b) { return info.rows[b] - info.rows[a]; })
                .map(function (k) { return { label: (db.meta(k).label || k), value: info.rows[k] }; });
            ui.modal({
                title: '存储与容量', size: 'wide',
                sub: 'schema ' + info.schema + ' · 键 ' + cfg.storage.key + ' · 建库于 ' + fmtTime(info.seededAt),
                body: ui.kpis([
                    { label: '库容量', value: (info.bytes / 1024 / 1024).toFixed(2), unit: 'MB', tone: info.bytes > cfg.storage.softLimitBytes ? 'danger' : 'success', sub: '软上限 ' + (cfg.storage.softLimitBytes / 1024 / 1024).toFixed(1) + ' MB' },
                    { label: '总行数', value: util.fmt.number(info.total), tone: 'info' },
                    { label: '序列计数器', value: Object.keys(db.counters()).length, tone: 'muted', sub: '单据号当日流水' }
                ]) + ui.card({
                    title: '集合行数分布', sub: rows.length + ' 个非空集合', flat: true,
                    body: TMS.charts.hbars({ data: rows, rowH: 22, limit: 40, labelWidth: 150, valueWidth: 70 })
                }) +
                    (db.archiveStats().length
                        ? ui.notice(db.archiveStats().map(function (a) { return esc(db.meta(a.name).label || a.name) + ' 归档 ' + a.count + ' 行'; }).join('；'), 'warn', '容量治理已触发')
                        : ui.notice('未触发归档裁剪，全量数据均在窗口期内', 'success')) +
                    ui.card({ title: '容量策略', flat: true, body: ui.desc([
                        { label: '软阈值', value: (cfg.storage.softLimitBytes / 1048576).toFixed(1) + ' MB（超阈值按天裁剪流水表）' },
                        { label: '硬阈值', value: (cfg.storage.hardLimitBytes / 1048576).toFixed(1) + ' MB（仍超则按集合优先级归档最旧记录）' },
                        { label: '归档顺序', value: cfg.storage.archiveOrder.map(function (k) { return db.meta(k).label || k; }).join(' → ') },
                        { label: '可裁剪表', value: Object.keys(cfg.storage.archiveFloor).map(function (k) { return (db.meta(k).label || k) + ' ≥' + cfg.storage.archiveFloor[k]; }).join('、') }
                    ]) }),
                footer: ui.btn('关闭', { act: 'ui:close' })
            });
        },
        'shell:logout': function () { TMS.auth.logout(); },
        'shell:days': function (n) { shell.state.days = Number(n) || 7; shell.refresh(); },
        'sort': function (key, el) {
            var st = stateFor(el);
            if (st.sort === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
            else { st.sort = key; st.dir = 'desc'; }
            shell.refresh();
        },
        'page': function (n, el) { var st = stateFor(el); st.page = Number(n) || 1; shell.refresh(); },
        'page:size': function (n, el) { var st = stateFor(el); st.pageSize = Number(n); st.page = 1; shell.refresh(); },
        'filter': function (value, el) {
            var st = stateFor(el);
            var name = el.getAttribute('name');
            if (!name) return;
            st.filters[name] = value;
            st.page = 1;
            /* 文本框在容器内输入：局部状态已更新，直接重渲染即可保留焦点外的其他状态。
               重渲染会换掉整个 DOM，要把焦点还回同一个列表的同一个输入口，
               否则在一页两张表时打字会跳到上面那张的搜索框里 */
            shell.refresh();
            var host = el.closest ? (el.closest('[data-sk]') || document) : document;
            var again = host.querySelector('[name="' + name + '"]');
            if (again && again.focus) {
                again.focus();
                if (typeof again.setSelectionRange === 'function') {
                    var len = String(again.value || '').length;
                    again.setSelectionRange(len, len);
                }
            }
        },
        /* chips 标签筛选：arg 形如 status|transit，竖线后的空串表示回到「全部」 */
        'chip': function (arg, el) {
            var s = String(arg || '');
            var i = s.indexOf('|');
            if (i < 0) return;
            var st = stateFor(el);
            st.filters[s.slice(0, i)] = s.slice(i + 1);
            st.page = 1;
            shell.refresh();
        },
        'tab': function (arg) {
            var st = ui.state(shell.state.pageId);
            st.tab = arg;
            shell.refresh();
        },
        'seg': function (arg) {
            var st = ui.state(shell.state.pageId);
            st.seg = arg;
            shell.refresh();
        },
        'noop': function () {}
    };

    /* 数据变更 → 页面自动刷新（领域动作都走 db.commit，这里统一收口） */
    var refreshTimer = null;
    function scheduleRefresh() {
        if (refreshTimer) global.clearTimeout(refreshTimer);
        refreshTimer = global.setTimeout(function () {
            refreshTimer = null;
            var def = TMS.pages.get(shell.state.pageId);
            if (def && def.live !== false && shell.state.content) render(def);
        }, 140);
    }

    if (TMS.bus) {
        TMS.bus.on('data:change', scheduleRefresh);
        TMS.bus.on('data:external', scheduleRefresh);
    }

    /* 页内 hash 变化（详情深链）也触发重渲染 */
    if (global.document) {
        global.addEventListener('hashchange', function () {
            var hash = parseHash(global.location.hash);
            if (hash.pageId && hash.pageId !== shell.state.pageId) mount({ pageId: hash.pageId, params: hash.params });
            else { shell.state.params = hash.params; shell.refresh(); }
        });
    }

    shell.mount = mount;
    shell.refresh = function () {
        var def = TMS.pages.get(shell.state.pageId);
        if (def) render(def);
    };
    shell.go = go;
    shell.parseHash = parseHash;
    shell.buildHash = buildHash;
    shell.current = function () { return shell.state; };
    shell.days = function () { return shell.state.days; };
    TMS.shell = shell;
})(window);
