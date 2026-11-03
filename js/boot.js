/* 运行时装配：按依赖顺序注入模块（无构建工具、file:// 可直开），并完成建库、巡检与启动
   用法：页面只需 <script src="../js/boot.js?v=token"></script> 与 TMS.boot.start(portal, pageId) */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    var MODULES = [
        'js/core/config.js',
        'js/core/utils.js',
        'js/core/bus.js',
        'js/core/db.js',
        'js/core/ids.js',
        'js/core/auth.js',
        'js/core/rbac.js',
        'js/core/migrations.js',
        'js/data/master.js',
        'js/domain/pricing.js',
        'js/domain/network.js',
        'js/data/seed.js',
        'js/domain/order.js',
        'js/domain/operation.js',
        'js/domain/finance.js',
        'js/domain/service.js',
        'js/domain/address.js',
        'js/domain/people.js',
        'js/domain/stats.js',
        'js/domain/audit.js',
        'js/domain/jobs.js',
        'js/ui/kit.js',
        'js/ui/charts.js',
        'js/ui/map.js',
        'js/ui/shell.js',
        'js/pages/registry.js',
        'js/pages/portal.js',
        'js/pages/admin.js',
        'js/pages/branch.js',
        'js/pages/sorter.js',
        'js/pages/transporter.js',
        'js/pages/deliveryman.js',
        'js/pages/client.js'
    ];

    /* 站点根基准与缓存 token 都从 boot.js 自己的 src 反推：
       登录页在根目录（src='js/boot.js'）、业务页在角色目录（src='../js/boot.js'），
       同一份清单不能对两边都写成相对当前页的路径，否则子目录页会去加载 admin/js/core/config.js。
       currentScript 只在本脚本同步执行期间有效，所以这里一次性取好，后面都用这个值 */
    var SELF_SRC = (function () {
        var self = global.document && document.currentScript;
        return self ? String(self.getAttribute('src') || '') : '';
    })();

    function selfPath(name) {
        var i = SELF_SRC.indexOf(name);
        return i > 0 ? SELF_SRC.slice(0, i) : '';
    }

    var BASE = selfPath('js/boot.js');
    /* 先挂到 TMS 上再注入模块：utils 之后的 shell/auth 都靠它拼跨目录跳转的地址 */
    TMS.base = BASE;

    /* 缓存 token 跟随 boot.js 自身：python tools/gen_pages.py --token v=xxx 改一处即可全量刷新所有页面外壳 */
    function token() {
        var m = /[?&]v=([\w-]+)/.exec(SELF_SRC);
        return m ? 'v=' + m[1] : '';
    }

    function inject() {
        var t = token();
        var doc = global.document;
        if (!doc) return;
        MODULES.forEach(function (path) {
            doc.write('<script src="' + BASE + path + (t ? '?' + t : '') + '"><\/script>');
        });
    }

    function ready() {
        if (!TMS.db || !TMS.seed) {
            if (global.console) console.error('[TMS] 模块未加载完成，请检查 js/boot.js 的 MODULES 清单');
            return false;
        }
        TMS.db.load();
        if (!TMS.db.isSeeded()) TMS.db.reseed();
        else { backfillAddresses(); backfillFences(); }
        return true;
    }

    /* v11 之前的库没有派送员编号围栏：图1 右支缺中间那一格，派单永远停在「需人工指定」。
       补建档要读员工档案、走 saveFence 的校验与审计，只能在库就绪后做，标记用完即清 */
    function backfillFences() {
        var raw = TMS.db.load();
        if (!raw.pendingCourierFence) return;
        raw.pendingCourierFence = 0;
        try {
            TMS.network.backfillCourierFences();
            TMS.db.persist('geofence:migrate');
        } catch (err) {
            if (global.console) console.warn('[TMS] 编号围栏补建档失败', err);
        }
    }

    /* 迁移过来的老库地址档案是空的，但建档要读订单、写审核记录，只能在库就绪后补。
       标记由 v10 迁移打上、这里用完即清——不清的话用户主动删空的地址簿会在下次进页面凭空复活 */
    function backfillAddresses() {
        var raw = TMS.db.load();
        if (!raw.pendingAddressBackfill) return;
        raw.pendingAddressBackfill = 0;
        try {
            TMS.address.backfill({ limit: 74, days: 26 });
            TMS.db.persist('address:migrate');
        } catch (err) {
            if (global.console) console.warn('[TMS] 派送地址建档失败', err);
        }
    }

    function start(portal, pageId, rootSelector) {
        if (!ready()) return;
        var session = TMS.auth.require(TMS.cfg.roles[portal] ? portal : null);
        if (!session) return;
        // 定时任务模拟：进入页面先跑一轮 SLA 巡检，产出超时/升级/告警
        try { TMS.jobs.sweep(); } catch (err) { if (console) console.error('[TMS] 巡检失败', err); }
        var root = document.querySelector(rootSelector || '.content');
        if (!root) return;
        TMS.shell.mount({ portal: portal, pageId: pageId, root: root, session: session });
    }

    /* 演示数据维护：重建 / 导出 / 容量查看，供系统监控页调用 */
    function maintenance() {
        return {
            rebuild: function () { TMS.db.reset(); TMS.db.reseed(); TMS.bus.emit('data:change', { reason: 'rebuild' }); },
            info: function () { return TMS.db.info(); },
            export: function () { return JSON.stringify(TMS.db.load(), null, 2); }
        };
    }

    TMS.boot = { inject: inject, start: start, ready: ready, modules: MODULES };
    TMS.maintenance = maintenance();

    /* 未捕获异常统一提示，避免页面白屏无反馈 */
    global.addEventListener('error', function (e) {
        if (TMS.ui && TMS.ui.toast) TMS.ui.toast('运行时异常：' + (e.message || '未知错误'), 'error', 5000);
    });

    inject();
})(window);
