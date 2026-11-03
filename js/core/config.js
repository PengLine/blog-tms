/* TMS 全局配置：命名空间、存储契约、业务常量 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    var cfg = {
        /* 署名是全站约定，六端外壳与登录页共用一份：写在配置里而不是各页复制，
           改一次就全站生效，冒烟校验也按这一处断言 */
        brand: {
            name: '汇通物流', short: 'TMS', en: 'HUITONG TMS',
            author: '余一叶知秋尽', site: 'https://pengline.cn/'
        },

        /* 存储契约：换 schema 版本前先写迁移，切勿直接改 key */
        storage: {
            key: 'tmsDB_v7',
            userKey: 'tmsSession',
            profileKey: 'tmsProfile',
            schema: 11,
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
            claimDays: 7,              // 理赔时效
            codRemitHours: 48,         // 代收货款回款时限：签收后 48 小时未上划即计代收超时
            podReturnHours: 24,        // 回件返交时限：签收后 24 小时未回传 POD 即计未回件
            addressReviewHours: 24,    // 派送地址待审核时限：超时就进「待审核积压」告警，催有审核权的人
            addressFixHours: 48        // 地址打回后的返工时限：超时算网点侧滞留，催的是维护人
        },

        /* 派送地址：审核状态机与规范化规则。
           状态名与页面字典都从这里出，页面写死中文就会和迁移、告警文案对不上 */
        address: {
            FLOW: ['pending', 'revise', 'revised', 'approved'],
            LABEL: { pending: '待审核', revise: '待修改', revised: '已修改', approved: '通过' },
            /* 规范化判定：区/镇缺失、门牌号缺失、整串过长（网点现场手抄的长地址多半是没拆解的）
               这三类是地址审核里真正会打回的，不放「看起来不规范」这种无法复核的软标准 */
            maxLen: 60,
            doorRe: /[0-9０-９]+\s*(号|号楼|栋|幢|单元|室|层|座)/
        },

        /* 电子围栏：图1 的三类问题各自对应一类围栏，类型码沿用库里的 hub/branch（
           作业与告警判定都按这两个码写死的，改名等于把历史数据全量迁移一遍），
           新增 courier 承接「给派送员指定编号围栏」。中文名只在这里维护一份 */
        fence: {
            TYPES: ['hub', 'branch', 'courier'],
            LABEL: { hub: '到货围栏', branch: '机构派送围栏', courier: '派送员编号围栏' },
            /* 每一类回答图1 的哪个问题：写在页面上，避免用户对着三个圈猜用途 */
            ASKS: {
                hub: '件到没到——到件扫描的落点是否落在场地围栏内',
                branch: '送不送——收件地址是否落在机构派送围栏内，不在就只能自提',
                courier: '谁去送——收件地址落在哪位派送员的编号围栏内，就自动绑那个编号'
            },
            /* 谁能改哪一类：网点自己勾得出派送与编号围栏，但场地围栏是总部规划的，
               给网点一个改分拨围栏的入口等于让它改写干线的前提 */
            BRANCH_TYPES: ['branch', 'courier'],
            STATUS: { active: '在用', draft: '草稿', disabled: '已停用' },
            /* 勾画围栏的顶点数下限与上限：少于三个点连不成面，
               多于四十个点是现场勾不动也查不清的自虐 */
            minPoints: 3,
            maxPoints: 40,
            /* 没勾多边形时的兜底半径围栏：老数据与快速建圈都靠它 */
            defaultRadiusM: 3000
        },

        /* 每个角色一个目录，页面文件名不再重复角色前缀（admin/order.html 就是运营端订单页）。
           dir 是登录门户与跨角色跳转的路径来源，菜单里的 file 必须落在同一个目录下，
           对不上的话 gen_pages.py 会生成到别处、guard 也会把人弹回首页。
           layout 决定外壳骨架：desktop＝侧栏+顶栏的桌面后台，mobile＝一线作业的手感，
           portal＝客户的网页门户——网点管理员做的是订单、库存、客服、经营报表，
           本质是后台管理，不是举着手机的作业岗，所以和运营端共用桌面壳 */
        roles: {
            admin: { name: '运营管理员', dir: 'admin', home: 'overview', layout: 'desktop' },
            branch: { name: '网点管理员', dir: 'branch', home: 'b-home', layout: 'desktop' },
            sorter: { name: '分拣员', dir: 'sorter', home: 's-home', layout: 'mobile' },
            transporter: { name: '运输员', dir: 'transporter', home: 't-home', layout: 'mobile' },
            deliveryman: { name: '派送员', dir: 'deliveryman', home: 'd-home', layout: 'mobile' },
            client: { name: '客户', dir: 'client', home: 'c-home', layout: 'portal' }
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

    /* 门户文件由目录派生：目录名就是角色 key，登录跳转与守卫只需要读 roles[x].portal 一处 */
    Object.keys(cfg.roles).forEach(function (key) {
        var r = cfg.roles[key];
        r.key = key;
        r.portal = r.dir + '/index.html';
    });

    TMS.cfg = cfg;
})(window);
