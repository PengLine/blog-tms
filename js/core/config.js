/* TMS 全局配置：命名空间、存储契约、业务常量 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    var cfg = {
        brand: { name: '汇通物流', short: 'TMS', en: 'HUITONG TMS' },

        /* 存储契约：换 schema 版本前先写迁移，切勿直接改 key */
        storage: {
            key: 'tmsDB_v7',
            userKey: 'tmsSession',
            profileKey: 'tmsProfile',
            schema: 8,
            /* localStorage 配额按 UTF-16 计，浏览器约 5MB（≈250 万字符）：
               建库设计点控制在 ~1.8M 字符（3.6MB）以内，留出运行期写入余量；
               超软阈值先按天裁剪流水，仍超硬阈值才按集合优先级归档最旧记录，保证写入不会整库失败 */
            softLimitBytes: 3.9 * 1024 * 1024,
            hardLimitBytes: 4.6 * 1024 * 1024,
            archiveOrder: ['auditLogs', 'alerts', 'points', 'clockRecords', 'shifts', 'performances', 'scans', 'finances', 'loadingTasks', 'sortingTasks'],
            /* 归档下限必须高于建库后的实际行数，否则二级归档会把轨迹/作业单/告警整表清空，
               破坏「每单有轨迹、每单有收入、每车次有装卸单」这类业务不变量 */
            archiveFloor: {
                scans: 3000, finances: 900, auditLogs: 160, clockRecords: 300, shifts: 400,
                points: 500, performances: 220, sortingTasks: 260, loadingTasks: 200, alerts: 160
            }
        },

        /* 订单主状态机：created → collected → inbound → sorted → transit → arrived → delivering → signed */
        orderFlow: ['created', 'collected', 'inbound', 'sorted', 'transit', 'arrived', 'delivering', 'signed'],
        orderLabels: {
            created: '已下单', collected: '已揽收', inbound: '已入库', sorted: '已分拣',
            transit: '运输中', arrived: '已到件', delivering: '派送中', signed: '已签收',
            problem: '问题件', returned: '已退回', cancelled: '已取消'
        },
        /* 状态 → 轨迹节点编码，扫描与轨迹由状态推进派生 */
        stageNode: {
            created: 'CREATED', collected: 'GOT', inbound: 'INBOUND', sorted: 'SORTING',
            transit: 'DEPARTURE', arrived: 'ARRIVED', delivering: 'DELIVERING', signed: 'SIGNED',
            returned: 'RETURNED', cancelled: 'INTERCEPT', problem: 'PROBLEM'
        },

        /* 轨迹节点字典：stdHours 用于 SLA 与超时巡检 */
        /* 作业节点字典：顺序即履约顺序，stdHours 为该环节的标准耗时。
           term = 该环节的默认终端，扫描流水只在终端偏离默认时（称重台/DWS/人工补录）才存设备，
           每省一个设备字段少 ~14 字符，全链路 4000 条流水就是 50KB 容量 */
        traceNodes: [
            { code: 'CREATED', name: '订单创建', stdHours: 2, stage: 'created', term: '线上下单' },
            { code: 'GOT', name: '揽收上门', stdHours: 6, stage: 'collected', term: 'PDA-9000' },
            { code: 'INBOUND', name: '网点入库', stdHours: 8, stage: 'inbound', term: 'PDA-9000' },
            { code: 'SORTING', name: '分拨分拣', stdHours: 10, stage: 'sorted', term: 'PDA-7500' },
            { code: 'LOADING', name: '装车出发', stdHours: 4, stage: 'transit', term: 'PDA-7500' },
            { code: 'DEPARTURE', name: '干线发出', stdHours: 0, stage: 'transit', term: '车载终端' },
            { code: 'TRANSIT', name: '中转在途', stdHours: 12, stage: 'transit', term: '车载终端' },
            { code: 'ARRIVED', name: '目的到件', stdHours: 6, stage: 'arrived', term: '固定式扫描门' },
            { code: 'DELIVERING', name: '末端派送', stdHours: 12, stage: 'delivering', term: 'PDA-9000' },
            { code: 'SIGNED', name: '签收完成', stdHours: 4, stage: 'signed', term: '高拍仪' },
            { code: 'RETURNED', name: '退回发起', stdHours: 24, stage: 'returned', term: 'PDA-9000' },
            { code: 'INTERCEPT', name: '订单拦截', stdHours: 8, stage: 'cancelled', term: '运营后台' },
            { code: 'PROBLEM', name: '问题件', stdHours: 24, stage: 'problem', term: 'PDA-9000' },
            { code: 'CHANGE', name: '订单改单', stdHours: 0, stage: '', term: '运营后台' },
            { code: 'RELEASE', name: '问题件放行', stdHours: 0, stage: '', term: '运营后台' }
        ],

        /* 称重环节节点：只有这些环节在扫描流水上带重量，其余环节不重复存（揽收称重 + 分拨复称 + 装车） */
        weighNodes: ['GOT', 'INBOUND', 'SORTING', 'LOADING', 'DEPARTURE'],

        serviceLevels: ['标准', '加急', '经济', '冷链'],
        paymentMethods: ['现付', '到付', '月结'],
        customerLevels: [
            { level: 'KA', name: '战略客户', discount: 0.18, settleCycle: '月结', creditLimit: 500000 },
            { level: 'A', name: '重点客户', discount: 0.10, settleCycle: '月结', creditLimit: 200000 },
            { level: 'B', name: '成长客户', discount: 0.05, settleCycle: '半月结', creditLimit: 80000 },
            { level: 'C', name: '散客', discount: 0, settleCycle: '现付', creditLimit: 0 }
        ],

        /* 计费与作业单价：真实项目里这些参数在运价卡/成本中心维护 */
        billing: {
            defaultThrowRatio: 6000,   // 体积重换算比 cm³/kg
            insuredRate: 0.003,        // 保价费率
            codRate: 0.008,            // 到付手续费率（按运费）
            codServiceRate: 0.02,      // 代收货款服务费率
            codMinService: 2,
            fuelRate: 0.08,            // 燃油附加费率
            remoteSurcharge: 12,       // 偏远地区附加费/票
            minCharge: 25              // 一票最低收费（快运起重价）
        },

        /* 成本标准：干线优先按实际车次成本分摊，无车次时按标准单价折算；
           自有整车与外协零担按「成本择优」决策——本网络日均百余票，绝大多数线路填不满 9.6 米车，
           干线采购外协舱位、自有运力留给冷链专车和整车大票，这才是小快运网络的真实形态。
           外协采购价含提货分拨两端操作，因此单价高于自有整车满载单价，但低于自有空载单价 */
        cost: {
            linehaulPerKgKm: 0.00042,   // 干线标准成本 元/kg·km（未挂车次的兜底口径）
            selfLoadMin: 0.35,         // 自有整车最低装载率，低于此值优先考虑外协
            ltlBasePerKg: 0.42,        // 外协零担起步 元/kg（含两端提货分拨操作）
            ltlPerKgKm: 0.00058,       // 外协零担里程系数 元/kg·km
            ltlMinTicket: 90,          // 外协最低一票（不足按最低票计费）
            bulkMinMarkup: 1.2,        // 大票商务报价对采购成本的最低加成（商务最低限价）
            airCostFactor: 2.4,        // 航空舱位成本系数
            coldCostFactor: 1.5,       // 冷链车成本系数
            hubHandlingPerKg: 0.08,    // 分拨中转装卸 元/kg·次
            sortPerPiece: 0.55,        // 分拨分拣 元/件
            collectPerOrder: 3.5,      // 上门揽收 元/票
            firstMilePerKg: 0.04,      // 揽收支线 元/kg
            deliverPerOrder: 9,        // 末端派送 元/票
            lastMilePerKg: 0.05,       // 送货上门/上楼 元/kg
            packagingPerPiece: 0.7,    // 包材 元/件
            overheadPerOrder: 7,       // 场地/客服/系统间接分摊 元/票
            overheadPerKg: 0.03,       // 间接分摊 元/kg
            fuelPerKm: 2.25,           // 油费 元/km
            tollPerKm: 0.85,           // 路桥费 元/km
            driverAllowance: 320,      // 司机补贴 元/天
            vehicleFixed: 180,         // 车辆折旧 元/天
            quoteMinMargin: 0.2       // 报价对单票全成本的最低加成（商务托底 ≈ 17% 毛利）
        },

        sla: {
            exceptionHours: 4,         // 异常工单默认 SLA
            escalteHours: 12,          // 超时升级
            complaintHours: 24,        // 客服工单
            claimDays: 7               // 理赔时效
        },

        roles: {
            admin: { name: '运营管理员', portal: 'tms-index.html', home: 'overview' },
            branch: { name: '网点管理员', portal: 'branch-index.html', home: 'b-home' },
            sorter: { name: '分拣员', portal: 'sorter-index.html', home: 's-home' },
            transporter: { name: '运输员', portal: 'transporter-index.html', home: 't-home' },
            deliveryman: { name: '派送员', portal: 'deliveryman-index.html', home: 'd-home' },
            client: { name: '客户', portal: 'client-index.html', home: 'c-home' }
        },

        /* 演示账号：只登记口令与角色，所属组织和人员档案由种子引擎绑定真实员工/客户
           （见 js/data/master.js buildUsers）——组织、身份、页面数据三者同源，
           派送员登录后才能看到派给自己的任务，而不是一个档案里不存在的空账号 */
        demoAccounts: [
            { username: 'admin', password: '123456', name: '张运营', role: 'admin' },
            { username: 'branch', password: '123456', name: '李网点', role: 'branch' },
            { username: 'sorter', password: '123456', name: '王分拣', role: 'sorter' },
            { username: 'driver', password: '123456', name: '赵师傅', role: 'transporter' },
            { username: 'courier', password: '123456', name: '孙派送', role: 'deliveryman' },
            { username: 'client', password: '123456', name: '周先生', role: 'client' }
        ],

        pageSize: 12
    };

    /* 轨迹节点字典：扫描行只存 code，名称/标准时效读取时派生，避免每条流水重复中文 */
    var nodeMap = null;
    cfg.nodeOf = function (code) {
        if (!nodeMap) {
            nodeMap = {};
            cfg.traceNodes.forEach(function (n) { nodeMap[n.code] = n; });
        }
        return nodeMap[code] || { code: code, name: code, stdHours: 8, stage: '' };
    };

    TMS.cfg = cfg;
})(window);
