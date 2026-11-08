/* 架构设计读模型：服务目录是「设计意图」的唯一事实来源，落地映射与覆盖度一律读取时派生。
   页面只渲染，不在页面里数表、数接口、算依赖——同一份口径在拓扑图、清单、矩阵里必须一致。
   目录里写的每个模块 / 接口 / 页面 / 集合都要在当前工程里真实存在，coverage() 负责当场核对，
   对不上的进 missing 列表并在页面上标红：架构文档最容易烂在「写的时候是真的」 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, db = TMS.db, cfg = TMS.cfg;

    /* ---------- 分层 ---------- */

    var LAYERS = [
        {
            id: 'edge', no: 1, name: '接入层', hue: '#3d8bff', icon: '⛩',
            sub: '一个域名进来，身份与配额在这里定',
            duty: '统一入口、路由转发、鉴权、限流熔断、审计收口',
            forbid: '不写业务规则、不落业务库'
        },
        {
            id: 'bff', no: 2, name: '聚合层', hue: '#4ecdc4', icon: '⛶',
            sub: '按端裁剪与拼装，端有多少个 BFF 就有多少个',
            duty: '面向 APP / PC / 小程序的聚合接口，并行取数、字段裁剪、视图适配',
            forbid: '只做编排和适配，不写业务逻辑、不直连数据库'
        },
        {
            id: 'domain', no: 3, name: '领域服务层', hue: '#f0a92e', icon: '⬢',
            sub: '六个服务各管一段事实，每张表只有一个写入者',
            duty: '订单、网点、调度跟踪、结算计费、TMS 核心、运营考核',
            forbid: '不跨库写别人的表、不在同步调用里成环'
        },
        {
            id: 'support', no: 4, name: '支撑服务层', hue: '#8b7cf6', icon: '⚙',
            sub: '横切能力独立成服务，业务服务不私挂定时器、不自建索引',
            duty: '定时任务统一调度、检索与 GIS 读模型',
            forbid: '不拥有业务主表、不下业务结论'
        },
        {
            id: 'infra', no: 5, name: '基础设施', hue: '#9aa7bd', icon: '⛁',
            sub: '存储、消息、缓存、调度、观测：服务无状态的前提',
            duty: 'MySQL / Redis / RocketMQ / ES / PostGIS / XXL-Job / OSS / Nacos / 观测',
            forbid: '业务语义不下沉到基础设施配置里'
        }
    ];

    /* ---------- 十个服务 ---------- */

    var SERVICES = [
        {
            id: 'gateway', no: 1, name: '网关服务', en: 'API Gateway', layer: 'edge',
            hue: '#3d8bff', icon: '⛩', tag: '入口 · 鉴权 · 限流',
            mission: '统一入口、路由、鉴权、限流',
            duty: [
                '统一域名与路由：/api/{service}/v1/** 前缀转发，灰度按 header 与权重分流',
                '鉴权：校验令牌签名与有效期，把 userId / role / permissionCodes 注入下游上下文',
                '限流熔断：按「角色 + 接口」令牌桶，下游超时熔断后降级为只读缓存',
                '审计收口：各服务的审计事件在这里追加哈希链，形成不可篡改留痕',
                '协议适配：HTTPS / WSS 终结、跨域、请求体上限、附件直传对象存储的签名下发'
            ],
            boundary: [
                '不写业务规则：能不能派送、该收多少钱一律问领域服务',
                '不落业务库：只读令牌与配额，业务数据不进网关'
            ],
            apis: [
                { m: 'POST', p: '/api/auth/login', d: '账号口令换令牌，返回角色与权限点', kind: 'sync' },
                { m: 'GET', p: '/api/auth/context', d: '当前身份、角色、权限点、数据范围', kind: 'sync' },
                { m: 'POST', p: '/api/auth/refresh', d: '令牌续期与注销黑名单', kind: 'sync' },
                { m: 'ALL', p: '/api/{service}/v1/**', d: '路由转发 + 限流 + 灰度', kind: 'sync' },
                { m: 'POST', p: '/api/audit/events', d: '审计事件批量收口，追加哈希链', kind: 'event' }
            ],
            owns: ['users', 'roles', 'permissions', 'auditLogs'],
            deps: [],
            events: [
                { name: 'audit.appended', dir: 'in', peer: '全部服务', d: '审计 SDK 投递，网关侧统一追加 prev + 内容哈希' }
            ],
            impl: {
                modules: ['js/core/auth.js', 'js/core/rbac.js', 'js/ui/shell.js'],
                apis: ['TMS.auth.login', 'TMS.auth.can', 'TMS.rbac.guard', 'TMS.rbac.permissionsFor', 'TMS.audit.log', 'TMS.audit.verify'],
                pages: ['user', 'monitor'],
                note: '演示环境没有独立进程：鉴权、权限点字典与路由守卫由 auth + rbac + shell 三件套承担，菜单与页面权限都从同一份字典出'
            },
            consistency: '令牌无状态，权限变更靠版本号即时失效；审计只追加，事后改库必定断链',
            capacity: '单实例 3k QPS；限流阈值按角色分级，审计事件异步批量落盘'
        },
        {
            id: 'bff', no: 2, name: '客户端 BFF 服务', en: 'Backend For Frontend', layer: 'bff',
            hue: '#4ecdc4', icon: '⛶', tag: '聚合编排 · 端适配',
            mission: '面向 APP / PC / 小程序的聚合接口，只做编排和适配，不写业务逻辑',
            duty: [
                '按端裁剪字段：客户只看运费与轨迹，运营端才看成本与毛利',
                '一次请求聚合多服务：订单详情 = 订单 + 计费 + 轨迹 + 路由，并行取数后拼装',
                '视图适配：分页 / 排序 / 筛选参数翻译、枚举字典本地化、窄屏卡片降级',
                '端上缓存与 ETag：字典类长缓存、业务类短缓存，变更事件主动失效'
            ],
            boundary: [
                '不写业务逻辑：金额、时效、状态机一律由领域服务给出，BFF 不做二次计算',
                '不直连数据库：只经网关调领域服务接口',
                '不沉淀口径：同一指标在两个 BFF 里各算一遍就是漂移的开始'
            ],
            apis: [
                { m: 'GET', p: '/bff/app/home', d: '作业端工作台聚合（任务 + 绩效 + 告警）', kind: 'sync' },
                { m: 'GET', p: '/bff/pc/orders', d: '列表管线：筛选 / 排序 / 分页', kind: 'sync' },
                { m: 'GET', p: '/bff/pc/orders/{id}', d: '详情聚合：订单 + 费用 + 成本 + 轨迹 + 路由', kind: 'sync' },
                { m: 'POST', p: '/bff/app/scan', d: '作业端扫描提交透传，不做业务判定', kind: 'sync' },
                { m: 'GET', p: '/bff/mp/track/{code}', d: '小程序单号直达，按端裁剪轨迹节点', kind: 'sync' }
            ],
            owns: [],
            deps: ['order', 'branch', 'dispatch', 'billing', 'tms', 'kpi', 'search'],
            events: [],
            impl: {
                modules: ['js/pages/registry.js', 'js/ui/shell.js', 'js/boot.js'],
                apis: ['TMS.pages.grid', 'TMS.pages.orderColumns', 'TMS.pages.visibleTabs', 'TMS.shell.go'],
                pages: ['overview', 'b-home', 'c-home', 'd-home', 't-home', 's-home'],
                note: '演示里 BFF 的职责由「页面注册器 + 三套外壳」承担：列表管线与共用视图只做编排，聚合口径全部回落 js/domain/*；成本页签按角色裁剪就是端适配的实例'
            },
            consistency: '无状态可水平扩容；聚合按块降级——费用取不到显示「计费中」，不整页报错',
            capacity: '并行取数，单块超时 800ms 即降级；字典缓存 10 分钟'
        },
        {
            id: 'order', no: 3, name: '订单服务', en: 'Order Service', layer: 'domain',
            hue: '#f0a92e', icon: '▦', tag: '建单 · 改单 · 取价',
            mission: '订单提取、修改、运费/服务费计算、支付、积分扣除、网点折扣、修改通知',
            duty: [
                '订单提取与建单：渠道单号幂等去重，生成订单号与运单号',
                '改单 / 拦截 / 取消：状态机校验 + 差价重算 + 通知下游',
                '取价落账：向计费服务取报价（带运价卡版本），把金额快照写进订单',
                '支付与积分：支付回调幂等，积分扣除 / 返还与订单同事务',
                '网点折扣：向网点服务取折扣规则，按客户等级叠加后交计费算钱',
                '修改通知：改单事件广播给调度、TMS 核心、检索与客户端推送'
            ],
            boundary: [
                '不自算费率：运费 / 服务费 / 附加费的规则本体在计费服务，订单只存结果快照',
                '不写作业事实：扫描、分拣、装卸由 TMS 核心写入，订单订阅事件推进主状态'
            ],
            apis: [
                { m: 'POST', p: '/api/order/v1/orders', d: '建单，幂等键 = 渠道 + 外部单号', kind: 'sync' },
                { m: 'GET', p: '/api/order/v1/orders/{code}', d: '订单号 / 运单号 / 手机后四位统一解析', kind: 'sync' },
                { m: 'PATCH', p: '/api/order/v1/orders/{id}', d: '改单：收件人 / 地址 / 服务 / 货物', kind: 'sync' },
                { m: 'POST', p: '/api/order/v1/orders/{id}/intercept', d: '拦截与取消，退回发起', kind: 'sync' },
                { m: 'POST', p: '/api/order/v1/orders/{id}/pay', d: '支付回调，按交易号幂等', kind: 'sync' },
                { m: 'POST', p: '/api/order/v1/orders/{id}/points', d: '积分扣除 / 返还，与订单同事务', kind: 'sync' },
                { m: 'GET', p: '/api/order/v1/orders/{id}/quote', d: '取价：转计费服务并落金额快照', kind: 'sync' }
            ],
            owns: ['orders', 'customers', 'points', 'tickets'],
            deps: ['branch', 'billing', 'dispatch'],
            events: [
                { name: 'order.created', dir: 'out', peer: 'search / kpi', d: '建检索索引与经营投影' },
                { name: 'order.changed', dir: 'out', peer: 'dispatch / tms / search', d: '改单后路由重规划与拦截作业' },
                { name: 'order.paid', dir: 'out', peer: 'billing / kpi', d: '支付结果落账与收入投影' },
                { name: 'order.signed', dir: 'out', peer: 'billing / kpi', d: '触发应收与签收率' },
                { name: 'tms.scan.recorded', dir: 'in', peer: 'tms', d: '作业事实推进订单主状态' }
            ],
            impl: {
                modules: ['js/domain/order.js', 'js/domain/people.js'],
                apis: ['TMS.order.create', 'TMS.order.change', 'TMS.order.cancel', 'TMS.order.byCode', 'TMS.order.advance', 'TMS.people.awardPoints', 'TMS.people.redeemPoints'],
                pages: ['order', 'c-send', 'c-order', 'b-collect', 'd-collection', 'service'],
                note: '主状态机 created → collected → inbound → sorted → transit → arrived → delivering → signed 单点维护在 cfg.orderFlow；客服工单随订单生命周期挂在订单服务'
            },
            consistency: '建单幂等键 = 渠道 + 外部单号；支付按交易号去重；改单用乐观锁 version，冲突回读重放',
            capacity: '峰值建单 1.2k TPS；读多写少走读写分离，列表读检索服务投影'
        },
        {
            id: 'branch', no: 4, name: '网点服务', en: 'Branch Service', layer: 'domain',
            hue: '#46c07a', icon: '⌖', tag: '可到货 · 可派送',
            mission: '网点搜索、可到货/可派送判断、网点折扣规则',
            duty: [
                '网点档案：营业时间、服务能力（冷链 / 大件 / 自提）、归属分拨',
                '可到货判断：到件扫描落点是否落在分拨场地围栏内',
                '可派送判断：收件地址是否落在机构派送围栏内，不在就只能自提',
                '派送员编号围栏：地址落在谁的圈里就自动绑那个编号',
                '网点折扣规则：按线路 / 货量 / 结算周期发布折扣率与生效条件',
                '派送地址档案与审核流：网点与派送员维护，运营端下审核结论'
            ],
            boundary: [
                '不算钱：只发布折扣率与生效条件，金额由计费服务算',
                '不规划干线：路径与运力归调度跟踪服务',
                '不自审自批：地址维护权可以下沉一线，审核结论只在运营端'
            ],
            apis: [
                { m: 'GET', p: '/api/branch/v1/branches', d: '网点搜索：城市 / 关键字 / 服务能力（转检索）', kind: 'sync' },
                { m: 'POST', p: '/api/branch/v1/deliverable', d: '可派送判断：地址 → 省市区三级 → 围栏', kind: 'sync' },
                { m: 'POST', p: '/api/branch/v1/arrivable', d: '可到货判断：落点 → 场地围栏', kind: 'sync' },
                { m: 'GET', p: '/api/branch/v1/discount-rules', d: '网点折扣规则（带生效期与版本）', kind: 'sync' },
                { m: 'GET', p: '/api/branch/v1/courier-fence', d: '地址 → 派送员编号围栏', kind: 'sync' },
                { m: 'POST', p: '/api/branch/v1/addresses', d: '地址建档 / 维护，留提交痕', kind: 'sync' },
                { m: 'POST', p: '/api/branch/v1/addresses/{id}/review', d: '审核通过 / 打回，仅运营端权限', kind: 'sync' }
            ],
            owns: ['branches', 'hubs', 'addresses', 'addressReviews', 'geofences'],
            deps: ['search'],
            events: [
                { name: 'branch.deliverability.changed', dir: 'out', peer: 'order / dispatch', d: '围栏改动后判定结论失效' },
                { name: 'address.approved', dir: 'out', peer: 'dispatch / search', d: '地址通过后才可自动派单' },
                { name: 'branch.updated', dir: 'out', peer: 'search', d: '网点索引增量更新' }
            ],
            impl: {
                modules: ['js/domain/network.js', 'js/domain/address.js', 'js/data/master.js'],
                apis: ['TMS.network.deliverBranch', 'TMS.network.collectBranch', 'TMS.network.pointInFence', 'TMS.network.courierFenceAt', 'TMS.network.fenceGaps', 'TMS.address.review', 'TMS.pricing.discountFor'],
                pages: ['network', 'address', 'geofence', 'b-address', 'b-geofence', 'c-branch', 'd-areas', 'd-address'],
                note: '三类围栏（到货 / 机构派送 / 派送员编号）与省市区三级归属是判定精度的底座；区内直送与市内跨区的分级也在这里认'
            },
            consistency: '围栏改动即时失效判定缓存；地址审核双留痕（提交 + 结论），打回返工有时限',
            capacity: '判定接口 P99 < 80ms：GeoHash 预筛 + 射线法精判'
        },
        {
            id: 'dispatch', no: 5, name: '调度跟踪服务', en: 'Dispatch & Tracking', layer: 'domain',
            hue: '#8b7cf6', icon: '⇄', tag: '运力 · 路径 · 轨迹',
            mission: '运力匹配、路径规划、派单/抢单 + GPS 轨迹、在途异常',
            duty: [
                '路径规划：省市区三级 + 范围分级（区内直送 / 市内跨区 / 省内跨市 / 跨省），干支分离',
                '运力匹配：自有整车与外协零担成本择优，车型与装载率约束',
                '派单 / 抢单：按编号围栏自动绑派送员，抢单池加锁防重',
                'GPS 轨迹：车载与手机定位批量上报，偏航与长时间停留判定',
                '在途异常：延误、事故、拒收、地址不明，定责与超时升级'
            ],
            boundary: [
                '不写作业流水：扫描 / 分拣 / 装卸的事实由 TMS 核心落库',
                '不改订单主状态：只发事件，订单服务自己推进',
                '不算成本单价：择优用的是计费服务发布的成本口径'
            ],
            apis: [
                { m: 'POST', p: '/api/dispatch/v1/route-plan', d: '路径规划：起止 + 服务等级 + 区级归属', kind: 'sync' },
                { m: 'POST', p: '/api/dispatch/v1/capacity-match', d: '运力匹配：自有 / 外协成本择优', kind: 'sync' },
                { m: 'POST', p: '/api/dispatch/v1/assign', d: '派单：编号围栏 → 派送员', kind: 'sync' },
                { m: 'POST', p: '/api/dispatch/v1/grab', d: '抢单：分布式锁 + 版本号', kind: 'sync' },
                { m: 'POST', p: '/api/dispatch/v1/gps', d: '定位批量上报，按设备时间戳重排', kind: 'sync' },
                { m: 'POST', p: '/api/dispatch/v1/exceptions', d: '在途异常上报与定责', kind: 'sync' },
                { m: 'GET', p: '/api/dispatch/v1/tracks/{code}', d: '轨迹回放与偏航明细', kind: 'sync' }
            ],
            owns: ['routes', 'trips', 'vehicles', 'carriers', 'exceptions'],
            deps: ['branch', 'tms'],
            events: [
                { name: 'dispatch.assigned', dir: 'out', peer: 'tms / kpi', d: '派单结果驱动作业与绩效' },
                { name: 'dispatch.deviated', dir: 'out', peer: 'order / kpi', d: '偏航与延误触发在途异常' },
                { name: 'track.point.appended', dir: 'out', peer: 'search / bff', d: '轨迹索引与客户端实时跟踪' },
                { name: 'tms.scan.recorded', dir: 'in', peer: 'tms', d: '作业事实校正预计到达' }
            ],
            impl: {
                modules: ['js/domain/network.js', 'js/domain/operation.js', 'js/domain/service.js'],
                apis: ['TMS.network.planRoute', 'TMS.network.scopeOfOrder', 'TMS.network.pickVehicle', 'TMS.network.loadPlan', 'TMS.operation.dispatch', 'TMS.operation.reportPosition', 'TMS.operation.reportTripException', 'TMS.service.createException'],
                pages: ['route', 'tracking', 'transport', 'capacity', 'exception', 't-route', 't-departure', 'd-tasks'],
                note: '范围分级口径单点在 network.scopeOf，路由页、订单列与巡检共用；区内直送合并只相加段工时，承诺时效与成本口径不动'
            },
            consistency: '抢单用原子锁 + 版本号；GPS 乱序按设备时间戳重排，轨迹只追加不改点',
            capacity: '定位上报 5k 点/秒；轨迹按单号分片，热单缓存最近 200 点'
        },
        {
            id: 'billing', no: 6, name: '结算/计费服务', en: 'Billing & Settlement', layer: 'domain',
            hue: '#ff6b6b', icon: '¥', tag: '计价 · 对账 · 结算',
            mission: '运费、服务费、附加费、罚款、对账',
            duty: [
                '运价卡与费率版本：起重 / 续重、体积重换算比、一票最低收费',
                '运费与服务费：保价、到付手续费、代收货款服务费、燃油与偏远附加费',
                '罚款与理赔：异常定责后的扣罚与赔付单审批',
                '应收应付：签收生成应收、车次成本生成应付、月结账单',
                '对账与复核：重量复核触发差价、账单确认、计费复核留痕'
            ],
            boundary: [
                '唯一的算钱处：订单服务取价必须走这里，禁止第二份费率表',
                '不判定作业事实：成本分摊依据 TMS 核心的扫描重量与车次里程',
                '不改业务单据：差价用反向冲销行，不回头改原始流水'
            ],
            apis: [
                { m: 'POST', p: '/api/billing/v1/quote', d: '计价：费用明细 + 运价卡版本号', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/reprice', d: '改单重算差价，按原快照补退', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/surcharges', d: '附加费与罚款登记', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/receivables', d: '应收生成 / 调整 / 核销', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/payables', d: '应付生成 / 结算 / 费用登记', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/bills', d: '月结账单生成与确认', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/cod/remit', d: '代收货款上划与对账', kind: 'sync' },
                { m: 'POST', p: '/api/billing/v1/recheck', d: '重量复核触发计费复核', kind: 'sync' }
            ],
            owns: ['rateCards', 'receivables', 'payables', 'bills', 'finances', 'rechecks', 'codRecords', 'claims'],
            deps: ['branch'],
            events: [
                { name: 'billing.quoted', dir: 'out', peer: 'order', d: '报价结果带版本回写订单快照' },
                { name: 'billing.settled', dir: 'out', peer: 'kpi / search', d: '收入成本落账投影' },
                { name: 'billing.cod.remitted', dir: 'out', peer: 'kpi / job', d: '上划完成核销代收超时告警' },
                { name: 'tms.scan.recorded', dir: 'in', peer: 'tms', d: '复称重量触发复核' },
                { name: 'order.signed', dir: 'in', peer: 'order', d: '签收生成应收' }
            ],
            impl: {
                modules: ['js/domain/pricing.js', 'js/domain/finance.js'],
                apis: ['TMS.pricing.quote', 'TMS.pricing.matchCard', 'TMS.pricing.reprice', 'TMS.pricing.costOf', 'TMS.finance.ensureReceivable', 'TMS.finance.generateBills', 'TMS.finance.remitCOD', 'TMS.finance.recheckWeight'],
                pages: ['rate', 'finance', 'receivable', 'payable', 'audit', 'cod', 'claim'],
                note: '报价与成本两条线分开：报价对外吃运价卡，成本对内吃车次分摊与外协采购价；两者共用同一份费用科目字典'
            },
            consistency: '金额一律整数分；计价结果带版本快照；应收应付只追加冲销不删行，账期关账后锁版',
            capacity: '计价 P99 < 120ms；运价卡全量缓存 + 版本失效，账期任务夜间低峰跑'
        },
        {
            id: 'tms', no: 7, name: 'TMS 核心服务', en: 'TMS Core', layer: 'domain',
            hue: '#2fa8e0', icon: '⛴', tag: '运单 · 扫描 · 作业',
            mission: '运输管理、运单、发车、到货、转运、分拨、扫描、装卸、货箱',
            duty: [
                '运单与作业单：分拣任务、装卸任务、车次执行全景',
                '发车 / 到货 / 转运：班次执行与节点时间戳，中转分拨路由',
                '扫描作业：PDA / 固定扫描门 / 高拍仪流水，称重环节带重量',
                '货箱与物料：容器 / 包材 / 物料档案、仓库库存与出入库流水',
                '作业事实唯一写入者：扫描只追加，订单主状态由订单服务订阅推进'
            ],
            boundary: [
                '不算钱：成本单价来自计费服务，核心只报事实（重量 / 件数 / 里程 / 工时）',
                '不派单：谁去运由调度决定，核心记录运到哪一步',
                '不改历史流水：补录走新行 + 备注，不覆盖原扫描'
            ],
            apis: [
                { m: 'POST', p: '/api/tms/v1/scans', d: '扫描上报，幂等键 = 设备 + 单号 + 节点 + 时间', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/sorting-tasks', d: '分拣任务建立 / 完成 / 格口分配', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/loading-tasks', d: '装卸任务建立 / 完成', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/transports/depart', d: '发车：车次 +  crew + 装载清单', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/transports/arrive', d: '到货确认与卸车', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/transfers', d: '转运 / 分拨交接', kind: 'sync' },
                { m: 'GET', p: '/api/tms/v1/waybills/{code}', d: '运单作业全景（扫描 + 任务 + 车次）', kind: 'sync' },
                { m: 'POST', p: '/api/tms/v1/containers', d: '货箱 / 物料出入库与盘点', kind: 'sync' }
            ],
            owns: ['scans', 'sortingTasks', 'loadingTasks', 'transports', 'devices', 'warehouses', 'materials', 'stocks', 'stockMovements', 'suppliers'],
            deps: ['branch'],
            events: [
                { name: 'tms.scan.recorded', dir: 'out', peer: 'order / billing / dispatch / kpi / search', d: '作业事实总线，按单号分区保顺序' },
                { name: 'tms.trip.departed', dir: 'out', peer: 'billing / dispatch', d: '发车触发成本归集与预计到达' },
                { name: 'tms.stock.moved', dir: 'out', peer: 'search / job', d: '库存索引与安全库存巡检' }
            ],
            impl: {
                modules: ['js/domain/operation.js', 'js/domain/order.js'],
                apis: ['TMS.operation.createSortingTask', 'TMS.operation.finishSortingTask', 'TMS.operation.createLoadingTask', 'TMS.operation.finishLoading', 'TMS.operation.startTransport', 'TMS.operation.arriveTransport', 'TMS.order.addScan', 'TMS.order.noteScan'],
                pages: ['sorting', 'loading', 'transport', 'scan', 'delivery', 'warehouse', 'material', 's-scan', 's-sorting', 't-loading', 'b-inbound', 'b-outbound'],
                note: '扫描行只存节点编码，名称与标准工时读取时由 cfg.nodeOf 派生；轨迹时间轴与 SLA 巡检共用同一份节点字典'
            },
            consistency: '扫描幂等键去重，只追加；作业单与车次用版本号乐观锁；库存流水与库存行同事务',
            capacity: '扫描写入 3k 条/秒；流水按 90 天窗口裁剪，历史转冷存储'
        },
        {
            id: 'kpi', no: 8, name: '运营考核服务', en: 'Operation & KPI', layer: 'domain',
            hue: '#d96bb0', icon: '★', tag: '考核 · 绩效 · 运营',
            mission: '考核、绩效、订单运营',
            duty: [
                '绩效计算：扫描量 / 签收率 / 及时率 / 异常率 / 回款率，按岗位权重合成',
                '考核评级：周期考核、等级评定、改进计划跟踪',
                '订单运营：签收率、扫描率、改单率、超时运单台账、经营报表与毛利结构',
                '排班打卡：班次定义与考勤事实，作为绩效输入',
                '组织人事：员工与部门档案，考核对象的唯一来源'
            ],
            boundary: [
                '只读事实不改事实：绩效读订单 / 扫描 / 财务的投影，不回写业务库',
                '口径单点：同一指标在报表与考核里必须是同一个算法',
                '不定责：异常定责结论来自调度与客服，考核只引用'
            ],
            apis: [
                { m: 'POST', p: '/api/kpi/v1/performances/compute', d: '绩效计算，按周期可重放', kind: 'sync' },
                { m: 'GET', p: '/api/kpi/v1/performances', d: '绩效看板与排名', kind: 'sync' },
                { m: 'POST', p: '/api/kpi/v1/evaluations', d: '考核评级 / 定稿锁版', kind: 'sync' },
                { m: 'GET', p: '/api/kpi/v1/operation-report', d: '经营报表：收入 - 成本 - 毛利', kind: 'sync' },
                { m: 'GET', p: '/api/kpi/v1/overtime', d: '超时运单台账（八项固定指标）', kind: 'sync' },
                { m: 'POST', p: '/api/kpi/v1/shifts', d: '排班 assign 与 roster 查询', kind: 'sync' },
                { m: 'POST', p: '/api/kpi/v1/clock', d: '打卡签到 / 签退', kind: 'sync' }
            ],
            owns: ['evaluations', 'performances', 'clockRecords', 'shifts', 'employees', 'departments'],
            deps: [],
            events: [
                { name: 'order.signed', dir: 'in', peer: 'order', d: '签收率与及时率投影' },
                { name: 'tms.scan.recorded', dir: 'in', peer: 'tms', d: '扫描量与作业效率投影' },
                { name: 'billing.settled', dir: 'in', peer: 'billing', d: '收入成本与毛利投影' },
                { name: 'dispatch.exception.closed', dir: 'in', peer: 'dispatch', d: '异常率与定责结果投影' }
            ],
            impl: {
                modules: ['js/domain/people.js', 'js/domain/stats.js'],
                apis: ['TMS.people.computePerformance', 'TMS.people.evaluate', 'TMS.people.generatePerformances', 'TMS.stats.overview', 'TMS.stats.overtimeStats', 'TMS.stats.timingStats'],
                pages: ['evaluation', 'performance', 'hr', 'operation', 'timing', 'overtime', 's-performance', 't-performance', 'd-performance', 's-clock', 's-schedule'],
                note: '超时运单台账的八项指标口径单点在 stats.overtimeStats，页面只渲染不重算；绩效按周期快照，重算可重放'
            },
            consistency: '绩效按周期快照重算可重放；考核定稿后锁版，事实变更需走复核流程',
            capacity: '全量绩效重算按员工分片并行，夜间低峰跑；报表走预聚合投影'
        },
        {
            id: 'job', no: 9, name: '定时任务服务', en: 'Scheduled Jobs', layer: 'support',
            hue: '#9aa7bd', icon: '⧗', tag: 'XXL-Job 统一调度',
            mission: '订单超时等所有定时触发逻辑，接 XXL-Job 统一调度',
            duty: [
                '统一调度：所有定时逻辑注册为 XXL-Job 执行器，禁止业务服务内私挂 crontab',
                '订单超时：节点超时、压单预警、签收超时、代收上划超时、POD 回件超时',
                '财务定时：应收逾期与信用管控、月结账单、期间费用计提',
                '资源定时：车辆保养、物料安全库存、采购到货超期、扫描设备健康',
                '网络定时：围栏缺口巡检、地址审核与打回通知、班次未按时发车',
                '告警闭环：条件型告警双向收口（命中补建、消除核销）与归档清理'
            ],
            boundary: [
                '不写业务规则：超时阈值读配置与领域服务，任务只负责按时触发 + 幂等执行',
                '不长跑：单次执行分片，失败重试与告警由调度中心接管',
                '不持状态：执行器无状态，可随意扩容与重启'
            ],
            apis: [
                { m: 'JOB', p: 'traceOvertime', d: '轨迹超时巡检：只看最后一个节点', kind: 'job' },
                { m: 'JOB', p: 'slaBacklog', d: '压单预警：在途积压与超承诺', kind: 'job' },
                { m: 'JOB', p: 'receivableOverdue', d: '应收逾期与信用管控', kind: 'job' },
                { m: 'JOB', p: 'addressReview', d: '派送地址审核与打回通知', kind: 'job' },
                { m: 'JOB', p: 'fenceCoverage', d: '电子围栏缺口巡检', kind: 'job' },
                { m: 'JOB', p: 'purgeAlerts', d: '告警归档清理与双向核销', kind: 'job' }
            ],
            owns: ['alerts'],
            deps: ['order', 'tms', 'billing', 'branch', 'kpi', 'dispatch'],
            events: [
                { name: 'job.swept', dir: 'out', peer: 'kpi / bff', d: '一轮巡检结果与未闭环告警数' }
            ],
            impl: {
                modules: ['js/domain/jobs.js', 'js/boot.js'],
                apis: ['TMS.jobs.sweep', 'TMS.jobs.run', 'TMS.jobs.addAlert', 'TMS.jobs.closeAlert'],
                pages: ['monitor', 'overtime', 'overview'],
                note: '演示环境在每次进入页面时按时间窗补跑一轮；真实环境由 XXL-Job 按 cron 触发执行器，13 个 handler 与下面清单一一对应'
            },
            consistency: '每个 handler 幂等（按业务键去重）；分片广播 + 失败重试；告警按 key 去重并累计命中次数',
            capacity: '13 个 handler，最密 5 分钟一轮，单轮目标 < 30s；执行器按任务组分池'
        },
        {
            id: 'search', no: 10, name: '检索服务', en: 'Search & GIS', layer: 'support',
            hue: '#7ed957', icon: '⌕', tag: '物资 · GIS · 网点',
            mission: '物资、GIS、网点检索',
            duty: [
                '网点检索：关键字 / 城市 / 服务能力 / 营业状态，拼音与错字容错',
                'GIS 检索：坐标 → 省市区三级、半径与多边形内网点围栏、GeoHash 预筛',
                '物资检索：物料 / 库存 / 仓库多条件聚合，安全库存与呆滞预警',
                '订单检索：单号 / 客户 / 货物 / 收件人模糊匹配（读模型，不回写订单库）',
                '索引维护：消费领域事件增量建索引，全量重建可重放'
            ],
            boundary: [
                '只读投影：不拥有主表，索引可随时丢弃重建',
                '不下判定结论：可到货 / 可派送由网点服务给，检索只负责找到候选',
                '不做事务：索引延迟不影响下单与围栏精判'
            ],
            apis: [
                { m: 'GET', p: '/api/search/v1/branches', d: '网点检索：q / city / geo / 服务能力', kind: 'sync' },
                { m: 'GET', p: '/api/search/v1/geo/reverse', d: '坐标反查省市区三级', kind: 'sync' },
                { m: 'GET', p: '/api/search/v1/geo/within', d: '多边形 / 半径内的网点与围栏候选', kind: 'sync' },
                { m: 'GET', p: '/api/search/v1/materials', d: '物资与库存多条件检索', kind: 'sync' },
                { m: 'GET', p: '/api/search/v1/orders', d: '订单读模型检索', kind: 'sync' },
                { m: 'POST', p: '/api/search/v1/reindex', d: '全量重建索引，可重放', kind: 'job' }
            ],
            owns: [],
            deps: [],
            events: [
                { name: 'order.created', dir: 'in', peer: 'order', d: '订单索引增量' },
                { name: 'branch.updated', dir: 'in', peer: 'branch', d: '网点与围栏索引增量' },
                { name: 'tms.stock.moved', dir: 'in', peer: 'tms', d: '物资库存索引增量' },
                { name: 'track.point.appended', dir: 'in', peer: 'dispatch', d: '轨迹与 GIS 索引增量' }
            ],
            impl: {
                modules: ['js/data/master.js', 'js/domain/network.js', 'js/core/db.js'],
                apis: ['TMS.master.cityByName', 'TMS.master.matchDistrict', 'TMS.master.districtPoint', 'TMS.network.cityOfText', 'TMS.network.branchesOf', 'TMS.network.nearestCity', 'TMS.network.fencesAt'],
                pages: ['material', 'warehouse', 'network', 'c-branch', 'b-stock'],
                note: '演示环境用内存过滤 + 派生坐标承担检索；真实环境换 Elasticsearch + PostGIS，接口形状与调用方不变'
            },
            consistency: '索引最终一致（秒级延迟）；关键判定不依赖索引，围栏精判走网点服务',
            capacity: '检索 P99 < 200ms；索引按天全量校验 + 事件增量，重建可重放'
        }
    ];

    /* ---------- 基础设施与终端 ---------- */

    var INFRA = [
        { id: 'mysql', name: 'MySQL 8', sub: '按服务分库 · ShardingSphere 分片' },
        { id: 'redis', name: 'Redis 7', sub: '令牌 · 配额 · Redisson 抢单锁' },
        { id: 'mq', name: 'RocketMQ', sub: '领域事件 · 按单号分区保顺序' },
        { id: 'es', name: 'Elasticsearch', sub: '订单 / 物资 / 网点检索' },
        { id: 'gis', name: 'PostGIS', sub: '围栏精判与坐标反查' },
        { id: 'xxl', name: 'XXL-Job', sub: '13 个 handler 统一调度' },
        { id: 'oss', name: 'OSS / MinIO', sub: 'POD 图片 · 账单附件' },
        { id: 'nacos', name: 'Nacos', sub: '注册发现 · 配置中心 · 灰度' },
        { id: 'obs', name: '观测三件套', sub: 'Prometheus · SkyWalking · Loki' }
    ];

    var CLIENTS = [
        { id: 'app', name: 'APP', sub: '派送 / 运输 / 分拣' },
        { id: 'pc', name: 'PC 网页', sub: '运营后台 · 网点后台' },
        { id: 'mp', name: '小程序', sub: '客户寄件与跟踪' },
        { id: 'pda', name: 'PDA 作业端', sub: '扫描门 · 高拍仪' },
        { id: 'open', name: '开放平台', sub: '渠道商 API 对接' }
    ];

    /* ---------- 调用链路 ---------- */

    var FLOWS = [
        {
            id: 'quote', no: 1, name: '下单计费与支付', hue: '#f0a92e',
            sub: '客户提交寄件 → 判定可派送 → 取价 → 落单扣积分 → 支付',
            trigger: '客户在 APP / 小程序 / 开放平台提交寄件',
            outcome: '一票订单带金额快照与积分流水落地，检索与考核秒级可见',
            sla: '端到端 P99 < 1.5s',
            steps: [
                { from: 'bff', to: 'order', kind: 'sync', api: 'POST /orders', payload: '渠道单号 + 起止 + 货物', note: '幂等键 = 渠道 + 外部单号，重复提交返回同一单' },
                { from: 'order', to: 'branch', kind: 'sync', api: 'POST /deliverable', payload: '收件地址 → 省市区三级', note: '不在机构派送围栏内直接拒单或转自提' },
                { from: 'order', to: 'branch', kind: 'sync', api: 'GET /discount-rules', payload: '网点 + 线路 + 客户等级', note: '折扣规则只取不算，金额交计费服务' },
                { from: 'order', to: 'billing', kind: 'sync', api: 'POST /quote', payload: '重量 / 体积 / 服务 / 折扣', note: '返回费用明细 + 运价卡版本号，订单存快照' },
                { from: 'order', to: 'order', kind: 'self', api: '落单 + 积分扣除', payload: '金额快照 + 积分流水', note: '订单与积分同事务，任一步失败整单回滚' },
                { from: 'order', to: 'search', kind: 'event', api: 'order.created', payload: '单号 / 客户 / 起止 / 货物', note: '建检索索引，秒级可查' },
                { from: 'bff', to: 'order', kind: 'sync', api: 'POST /pay', payload: '支付交易号', note: '回调按交易号幂等，重复通知不重复扣积分' },
                { from: 'order', to: 'kpi', kind: 'event', api: 'order.paid', payload: '单量 / 收入', note: '经营报表与绩效投影增量更新' }
            ]
        },
        {
            id: 'trunk', no: 2, name: '揽收与干线发运', hue: '#8b7cf6',
            sub: '路径规划 → 运力择优 → 分拣装卸 → 扫描推进 → 发车挂成本',
            trigger: '订单已支付，进入揽收与干线执行',
            outcome: '干线发出，运单进入运输中，车次成本同步挂应付',
            sla: '揽收到发车 ≤ 12h（标准件）',
            steps: [
                { from: 'order', to: 'dispatch', kind: 'sync', api: 'POST /route-plan', payload: '起止 + 服务等级 + 区级归属', note: '范围分级决定要不要干线段：区内直送合并为一段' },
                { from: 'dispatch', to: 'branch', kind: 'sync', api: 'GET /branches', payload: '取件网点与归属分拨', note: '干支分离：揽收支线 → 干线 → 派送支线' },
                { from: 'dispatch', to: 'tms', kind: 'sync', api: 'POST /sorting-tasks', payload: '分拣 + 装卸任务', note: '任务按格口与车次建立，作业事实归核心' },
                { from: 'tms', to: 'tms', kind: 'self', api: '扫描作业', payload: '揽收 / 入库 / 分拣 / 装车', note: '称重环节带重量，幂等键去重只追加' },
                { from: 'tms', to: 'order', kind: 'event', api: 'tms.scan.recorded', payload: '节点编码 + 时间戳', note: '订单订阅事件推进主状态，核心不改订单' },
                { from: 'dispatch', to: 'tms', kind: 'sync', api: 'POST /transports/depart', payload: '车次 +  crew + 装载清单', note: '自有整车与外协零担按成本择优结果执行' },
                { from: 'tms', to: 'billing', kind: 'event', api: 'tms.trip.departed', payload: '里程 / 重量 / 工时', note: '车次成本归集生成应付，单价来自计费' },
                { from: 'tms', to: 'search', kind: 'event', api: 'tms.scan.recorded', payload: '轨迹与作业索引', note: '客户端跟踪读投影，不压核心库' }
            ]
        },
        {
            id: 'lastmile', no: 3, name: '末端派送与 POD/COD 回款', hue: '#46c07a',
            sub: '编号围栏绑人 → 派单抢单 → 签收拍照 → 应收与代收上划',
            trigger: '运单到达目的网点，进入末端派送',
            outcome: '签收、应收、代收上划三段闭环，超时自动进告警台账',
            sla: 'POD 回件 24h / 代收上划 48h',
            steps: [
                { from: 'dispatch', to: 'branch', kind: 'sync', api: 'GET /courier-fence', payload: '收件地址 → 编号围栏', note: '落在谁的圈里就自动绑谁，认不出转人工指定' },
                { from: 'dispatch', to: 'tms', kind: 'sync', api: 'POST /assign', payload: '派送员 + 任务清单', note: '抢单池加原子锁，同一单不会被两人抢走' },
                { from: 'tms', to: 'tms', kind: 'self', api: '派送扫描 + POD + 签收', payload: '签收照片 / 签名 / 代收金额', note: 'POD 附件直传对象存储，库里只存键' },
                { from: 'tms', to: 'order', kind: 'event', api: 'tms.scan.recorded', payload: 'SIGNED 节点', note: '订单推进到已签收，触发后续账务' },
                { from: 'order', to: 'billing', kind: 'event', api: 'order.signed', payload: '签收时间 + 金额快照', note: '生成应收，月结客户进账期' },
                { from: 'billing', to: 'billing', kind: 'self', api: '代收货款上划', payload: 'COD 金额 + 上划凭证', note: '签收后 48 小时未上划即计代收超时' },
                { from: 'job', to: 'billing', kind: 'job', api: 'codRemit / podReturn 巡检', payload: '超时限的签收单', note: '命中补建告警，上划完成自动核销' },
                { from: 'tms', to: 'kpi', kind: 'event', api: '签收事实投影', payload: '签收率 / 及时率 / 回款率', note: '派送员绩效与网点考核共用同一口径' }
            ]
        },
        {
            id: 'change', no: 4, name: '改单与拦截', hue: '#ff6b6b',
            sub: '改单申请 → 差价重算 → 路由重规划 → 拦截作业 → 通知',
            trigger: '客户或运营发起改单 / 拦截',
            outcome: '差价、路由、作业三处同步生效，修改通知全程留痕',
            sla: '改单生效 < 5min',
            steps: [
                { from: 'bff', to: 'order', kind: 'sync', api: 'PATCH /orders/{id}', payload: '收件人 / 地址 / 服务 / 货物', note: '状态机校验：已签收不可改，只能走售后' },
                { from: 'order', to: 'billing', kind: 'sync', api: 'POST /reprice', payload: '原快照版本 + 新要素', note: '按原运价卡版本算差价，补退用反向行' },
                { from: 'order', to: 'dispatch', kind: 'sync', api: 'POST /route-plan', payload: '新起止 + 服务等级', note: '跨区改跨省要重排干线段与承诺时效' },
                { from: 'dispatch', to: 'tms', kind: 'sync', api: 'POST /intercept', payload: '拦截指令 + 当前节点', note: '在途拦截落到最近分拨，已装车则随车退回' },
                { from: 'order', to: 'order', kind: 'self', api: '乐观锁校验 + 落改单痕', payload: 'version + 改单前后快照', note: '版本冲突回读重放，不覆盖别人的改单' },
                { from: 'order', to: 'search', kind: 'event', api: 'order.changed', payload: '新起止 / 新服务', note: '索引与客户端查询同步更新' },
                { from: 'order', to: 'bff', kind: 'event', api: '修改通知', payload: '改单结果 + 差价', note: '推送客户与网点，通知本身也留痕' }
            ]
        },
        {
            id: 'sweep', no: 5, name: '超时巡检与告警闭环', hue: '#9aa7bd',
            sub: 'XXL-Job 触发 → 跨服务读事实 → 双向收口 → 告警投影',
            trigger: 'XXL-Job 按 cron 触发（最密 5 分钟一轮）',
            outcome: '13 项巡检一轮跑完，告警去重累计命中，条件消除自动核销',
            sla: '单轮 < 30s，失败重试 3 次',
            steps: [
                { from: 'job', to: 'job', kind: 'self', api: '执行器分片广播', payload: '分片号 + 时间窗', note: '执行器无状态，按业务键幂等，重跑不重复建告警' },
                { from: 'job', to: 'order', kind: 'sync', api: '读节点时间戳与承诺', payload: '在途单 + 承诺时效', note: '节点超时只看最后一个节点，前序已被后续扫描证明' },
                { from: 'job', to: 'tms', kind: 'sync', api: '读最后扫描与滞留', payload: '滞留时长 + 设备状态', note: '滞留超时与设备离线分别登记' },
                { from: 'job', to: 'billing', kind: 'sync', api: '读应收逾期与代收', payload: '账期 + 上划状态', note: '逾期触发信用管控，代收超时催上划' },
                { from: 'job', to: 'branch', kind: 'sync', api: '读地址待审与打回', payload: '审核状态 + 提交时间', note: '待审超时限催审核人，打回超时限催维护人' },
                { from: 'job', to: 'job', kind: 'self', api: '命中补建 + 消除核销', payload: '本轮命中键集合', note: '双向收口：只建不关的告警会让看板与真实风险脱钩' },
                { from: 'job', to: 'kpi', kind: 'event', api: 'job.swept', payload: '告警数 + 超时台账', note: '超时运单管理页八项指标由此投影' }
            ]
        },
        {
            id: 'settle', no: 6, name: '月结对账与经营报表', hue: '#d96bb0',
            sub: '账期触发 → 账单生成 → 成本核对 → 差异挂账 → 毛利重算',
            trigger: '每月 1 日 02:00 账期任务',
            outcome: '账单确认、对账差异可追到每一票，毛利按大区拆解',
            sla: '账期次日 08:00 前出表',
            steps: [
                { from: 'job', to: 'billing', kind: 'job', api: '账期触发', payload: '客户 + 账期', note: '月结客户按结算周期切账，现付到付不进账单' },
                { from: 'billing', to: 'billing', kind: 'self', api: '生成月结账单', payload: '应收汇总 + 明细行', note: '账单只追加，确认前可调整，确认后锁版' },
                { from: 'billing', to: 'tms', kind: 'sync', api: '取车次成本与作业量', payload: '车次 + 装卸 + 扫描量', note: '成本核对到车次，差异定位到票' },
                { from: 'billing', to: 'billing', kind: 'self', api: '应收应付对冲 + 差异挂账', payload: '对账结果 + 差异行', note: '差异不抹平，挂账后人工复核' },
                { from: 'billing', to: 'kpi', kind: 'event', api: 'billing.settled', payload: '收入 / 成本 / 毛利', note: '经营报表投影增量更新' },
                { from: 'kpi', to: 'kpi', kind: 'self', api: '经营报表与毛利结构重算', payload: '按大区 / 客户 / 线路', note: '口径单点：报表与考核吃同一份算法' },
                { from: 'bff', to: 'kpi', kind: 'sync', api: 'GET /operation-report', payload: '时间窗 + 维度', note: 'BFF 只拼装不重算，导出与页面同一份数' }
            ]
        }
    ];

    /* ---------- 定时任务清单：与 jobs.RULES 一一对应 ---------- */

    var JOB_PLAN = {
        traceOvertime: { cron: '0 */5 * * * ?', target: 'order / tms', note: '节点超时只看最后一个节点，超时补建异常工单' },
        exceptionEscalate: { cron: '0 */10 * * * ?', target: 'dispatch', note: '异常工单超 SLA 升级，定责超时催责任方' },
        receivableOverdue: { cron: '0 30 1 * * ?', target: 'billing', note: '应收逾期登记 + 信用额度管控' },
        vehicleMaintenance: { cron: '0 0 6 * * ?', target: 'dispatch', note: '保养到期与年检提醒，到期车辆停派' },
        materialStock: { cron: '0 0 7 * * ?', target: 'tms', note: '安全库存与呆滞预警，触发采购建议' },
        purchaseOverdue: { cron: '0 0 8 * * ?', target: 'tms', note: '采购到货超期催供应商' },
        deviceHealth: { cron: '0 */30 * * * ?', target: 'tms', note: '离线超 12 小时、低电量与故障登记' },
        fenceCoverage: { cron: '0 0 3 * * ?', target: 'branch', note: '三类围栏缺口巡检：到货 / 派送 / 编号' },
        addressReview: { cron: '0 */15 * * * ?', target: 'branch', note: '待审核超时限催审核人，打回超时限催维护人' },
        tripDeparture: { cron: '0 */10 * * * ?', target: 'dispatch', note: '班次未按时发车登记延误' },
        slaBacklog: { cron: '0 */5 * * * ?', target: 'order', note: '在途积压与超承诺压单预警' },
        perfGuard: { cron: '0 0 9 ? * MON', target: 'kpi', note: '绩效改进计划跟踪，每周一复盘' },
        purgeAlerts: { cron: '0 0 4 * * ?', target: 'job', note: '告警归档清理，条件消除自动核销' }
    };

    /* ---------- 技术栈与演进 ---------- */

    var STACK = [
        { layer: '接入', component: 'Nginx + Spring Cloud Gateway', why: '统一入口、令牌桶限流、按 header 灰度；WSS 终结给轨迹实时推送' },
        { layer: '负载', component: 'Nacos + OpenFeign + Nginx', why: '三级接力：入口分流、进程内选实例、注册中心供名单；权重轮询 + 故障双摘除' },
        { layer: '聚合', component: 'NestJS BFF × 3（APP / PC / 小程序）', why: '端差异大，聚合层按端独立部署；只编排不算钱，接口形状与领域服务解耦' },
        { layer: '领域', component: 'Spring Boot 3 + Spring Cloud Alibaba', why: '六个领域服务同构，团队换手成本低；OpenFeign 同步调用，事务消息与本地事务表保一致性' },
        { layer: '注册配置', component: 'Nacos 2', why: '注册发现 + 配置中心 + 灰度元数据；超时阈值与费率开关改配置不发版' },
        { layer: '治理', component: 'Sentinel 1.8', why: '限流 / 熔断 / 降级；规则持久化 Nacos 动态生效，降级兜底讲业务不猜价' },
        { layer: '消息', component: 'RocketMQ 5', why: '按单号分区保顺序，事务消息保「建单成功」与「事件发出」一致' },
        { layer: '存储', component: 'MySQL 8 + ShardingSphere', why: '按服务分库；订单与扫描按时间 + 单号分片，流水表按窗口归档' },
        { layer: '事务', component: 'Seata 2（AT 模式）', why: '跨服务写原子性：落单扣积分、改单差价、代收上划；长事务走本地消息表' },
        { layer: '缓存', component: 'Redis 7 Cluster + Redisson', why: '令牌与配额、抢单分布式锁（看门狗续期）、运价卡全量缓存、GeoHash 预筛' },
        { layer: '标识', component: '雪花算法 Snowflake', why: '64bit 全局唯一趋势递增；分片主键与单据号底座，时钟回拨拒发兜底' },
        { layer: '检索', component: 'Elasticsearch 8', why: '订单 / 物资 / 网点全文与聚合；索引是投影，可随时重建' },
        { layer: '空间', component: 'PostGIS 3', why: '围栏精判与坐标反查；检索只给候选，结论由网点服务下' },
        { layer: '调度', component: 'XXL-Job 2.4', why: '13 个 handler 统一调度、分片广播、失败重试与执行日志，杜绝服务内私挂 crontab' },
        { layer: '对象', component: 'MinIO / 阿里云 OSS', why: 'POD 图片与账单附件直传，库里只存对象键与哈希' },
        { layer: '观测', component: 'Prometheus + Grafana + SkyWalking + Loki', why: '指标 / 链路 / 日志三件套；跨服务调用带 traceId，告警可追到那一跳' },
        { layer: '交付', component: 'Jenkins + Docker + Kubernetes', why: 'Jenkinsfile 流水线即代码；镜像不可变，金丝雀 + 滚动发布，按服务独立扩缩' }
    ];

    var PHASES = [
        {
            id: 'p0', name: 'P0 · 当前形态', when: '已落地', tone: 'success',
            scope: '纯前端演示：localStorage 单库 + 六端静态壳 + 领域脚本分层（core / data / domain / ui / pages）',
            value: '先把口径与流程跑通：状态机、计价、范围分级、围栏判定、巡检闭环都有单一事实来源',
            risk: '单库无并发控制，容量受浏览器配额限制；没有真正的服务边界与网络调用',
            exit: '接口形状与领域函数一一对应，可直接映射成后端契约'
        },
        {
            id: 'p1', name: 'P1 · 单体后端', when: '第一步', tone: 'info',
            scope: '一个 Spring Boot 进程按包分模块，单库 MySQL；网关与 BFF 先独立出去',
            value: '把 localStorage 换成真库，鉴权与限流先收口；领域模块包边界即未来服务边界',
            risk: '模块间仍是进程内调用，容易写出跨模块直连表的捷径',
            exit: '禁止跨包写表（架构守护测试拦住），事件总线先跑起来'
        },
        {
            id: 'p2', name: 'P2 · 先拆边界清晰的', when: '第二步', tone: 'warn',
            scope: '先拆计费与检索（读多写少、边界清晰），再拆订单与 TMS 核心',
            value: '计价单点先立住，订单不再自算费率；检索投影分担列表压力',
            risk: '分布式事务与幂等第一次真正出现，需要对账与补偿机制',
            exit: '计价 P99 达标、索引延迟秒级、跨服务调用全带 traceId'
        },
        {
            id: 'p3', name: 'P3 · 完整微服务', when: '目标态', tone: 'brand',
            scope: '10 个服务 + XXL-Job + 事件总线 + 分库分片 + 全链路观测',
            value: '按服务独立扩缩与发布；扫描与定位高峰单独扩容，考核重算夜间分片跑',
            risk: '运维复杂度与分布式一致性成本上升，需要专职 SRE 与契约测试',
            exit: '同步依赖无环、每表单一写入者、告警双向收口、账期次日准时出表'
        }
    ];

    var PRINCIPLES = [
        { no: 1, name: '单一写入者', text: '每张表只有一个服务能写，其余服务只读投影或订阅事件。跨库写别人的表是拆分后最常见的回退路径。', tone: 'brand' },
        { no: 2, name: '算钱只有一处', text: '费率本体在计费服务，订单只存带运价卡版本的金额快照。两处算钱必然漂移，对账时才发现就晚了。', tone: 'danger' },
        { no: 3, name: 'BFF 不写业务', text: '聚合与适配之外的任何计算都要下沉。BFF 里出现 sum / groupBy 就是口径分裂的开始。', tone: 'accent' },
        { no: 4, name: '同步依赖必须无环', text: '有环就用事件解。事件按单号分区保顺序，消费端幂等；同步调用成环会让故障沿着环传染。', tone: 'warn' },
        { no: 5, name: '幂等键先行', text: '建单、支付、扫描、抢单、巡检都要有业务幂等键。重试与重放是分布式的常态，不是异常。', tone: 'info' },
        { no: 6, name: '口径单点', text: '同一指标只允许一个算法，页面只渲染不重算。报表与考核吃同一份投影，数字才对得上。', tone: 'success' },
        { no: 7, name: '事实只追加', text: '扫描、审计、财务流水不改不删，冲销用反向行。历史可重放，事后改库必定露馅。', tone: 'muted' },
        { no: 8, name: '判定与检索分离', text: '检索找候选，判定给结论。索引有秒级延迟，围栏精判与可派送结论不能依赖索引。', tone: 'brand' }
    ];

    /* ---------- 分布式与运维技术体系 ----------
       目标态的十件组件：每件都回答「在 TMS 里管什么、落在哪些服务、坏了怎么兜底」。
       services / tables / flows 全部引用真实目录 id，冒烟逐条核对，写错即漂移 */

    var DIST_CATS = [
        { id: 'traffic', name: '接入与负载', hue: '#3d8bff', icon: '⛩', sub: '流量从域名到实例的三级接力' },
        { id: 'govern', name: '服务治理', hue: '#4ecdc4', icon: '⚙', sub: '实例名单、配置开关、流量保险丝' },
        { id: 'data', name: '数据与一致性', hue: '#f0a92e', icon: '⛁', sub: '拆分、事务、锁与全局标识' },
        { id: 'observe', name: '可观测性', hue: '#2fa8e0', icon: '◉', sub: '链路与指标：慢在哪、错在哪' },
        { id: 'delivery', name: '交付与运维', hue: '#8b7cf6', icon: '⎈', sub: '从提交到发布的全自动流水线' }
    ];

    var ALL_SVC = ['gateway', 'bff', 'order', 'branch', 'dispatch', 'billing', 'tms', 'kpi', 'job', 'search'];

    var DISTRIBUTED = [
        {
            id: 'lb', no: 1, name: '负载均衡', product: 'Nginx + OpenFeign + Nacos', version: '三级接力',
            cat: 'traffic', hue: '#7ed957', icon: '⚖',
            role: '入口分流、客户端选实例、注册中心供名单，三级各管一段',
            why: 'Nginx 管入口七层分流与健康检查；Feign 进程内负载省去一跳代理；Nacos 实时上下线让实例名单永远新鲜',
            scenario: '客户请求 → Nginx（轮询 + 被动健康检查）→ 网关集群 → Feign 从 Nacos 拉 order-service 实例列表按权重轮询 → 具体实例；扫描高峰 tms-core 扩容后新实例秒级进入名单',
            points: [
                'Nginx：upstream 轮询 + max_fails 摘除 + keepalive 长连接 + keepalived VIP 防单点',
                'Feign：负载均衡器订阅 Nacos，本地缓存名单 + 变更推送，权重 = 实例规格',
                '灰度实例权重 5%，配合 Nacos 元数据 version 分组逐步放量',
                '超时：连接 1s / 读 3s；只有幂等 GET 允许重试，写操作重试靠幂等键',
                '会话不粘滞：服务无状态，令牌与配额都在 Redis'
            ],
            fallback: '实例连续失败被 Feign 临时摘除，Nacos 心跳 15s 剔除双保险；Nginx 单点由 keepalived VIP 漂移接管',
            services: ['gateway', 'bff', 'order', 'branch', 'dispatch', 'billing', 'tms', 'kpi', 'search'],
            tables: [], flows: ['quote', 'trunk', 'lastmile', 'change'],
            metrics: [{ k: '接力层级', v: '3 级' }, { k: '实例策略', v: '权重轮询' }, { k: '故障摘除', v: '< 15s' }]
        },
        {
            id: 'nacos', no: 2, name: '注册中心', product: 'Nacos', version: '2.4 · 注册发现 + 配置中心',
            cat: 'govern', hue: '#4ecdc4', icon: '⌂',
            role: '服务实例的户口本，也是不发版改配置的开关台',
            why: '注册发现与配置中心二合一，Spring Cloud Alibaba 原生集成；临时实例 AP 保可用，持久配置 CP 保一致',
            scenario: '十个服务与 XXL-Job 执行器全部注册；超时阈值、巡检 cron、费率开关、灰度分组放配置中心，改配置秒级推送不发版',
            points: [
                '命名空间按环境隔离：dev / staging / prod 互不串线',
                '灰度分批：实例元数据 version = 灰度批次，网关按 header 路由',
                '临时实例心跳 5s，15s 未心跳标记不健康，30s 剔除',
                '配置监听 @RefreshScope 热生效；费率开关改动留审计',
                '注册中心 3 节点集群，Raft 选主，机房级容灾'
            ],
            fallback: '客户端本地缓存实例名单：Nacos 全挂时存量调用不中断，只暂停新实例上下线；配置读本地快照兜底',
            services: ALL_SVC, tables: [], flows: ['quote', 'trunk', 'lastmile', 'change', 'sweep', 'settle'],
            metrics: [{ k: '集群', v: '3 节点' }, { k: '心跳', v: '5s' }, { k: '配置推送', v: '< 1s' }]
        },
        {
            id: 'sentinel', no: 3, name: '服务熔断', product: 'Sentinel', version: '1.8 · 限流 / 熔断 / 降级',
            cat: 'govern', hue: '#ff6b6b', icon: '⚡',
            role: '流量洪峰与下游故障的保险丝：限流、熔断、降级三件套',
            why: '规则可推送 Nacos 动态生效，带控制台与实时监控；比 Hystrix 活跃，与 Feign / Gateway 原生集成',
            scenario: '网关按客户配额令牌桶；下单链路对计费 / 网点调用按异常比例熔断；扫描高峰对检索降级为只写不查，列表走缓存投影',
            points: [
                '网关层：按客户 + 接口双维度 QPS 令牌桶，单客户爆量不影响他人',
                'Feign 熔断：异常比例 > 50% 或慢调用比例 > 60% 打开，30s 后半开试探',
                '规则持久化到 Nacos dataId，控制台改规则全集群秒级生效',
                '降级兜底讲业务：可派送判定失败转人工、计价失败拒单——绝不猜价放行',
                '热点参数限流：大促客户单独配额，防止击穿共享池'
            ],
            fallback: '熔断打开走兜底逻辑（拒单 / 转人工 / 缓存旧值）；控制台不可用时客户端本地默认规则兜底，治理不中断',
            services: ['gateway', 'bff', 'order', 'dispatch', 'billing', 'tms'],
            tables: [], flows: ['quote', 'trunk', 'change'],
            metrics: [{ k: '熔断阈值', v: '异常 50%' }, { k: '半开试探', v: '30s' }, { k: '限流维度', v: '客户 × 接口' }]
        },
        {
            id: 'sharding', no: 4, name: '分库分表', product: 'Apache ShardingSphere', version: '5.5 · JDBC 无代理',
            cat: 'data', hue: '#3d8bff', icon: '⛁',
            role: '订单与扫描流水的水平拆分：容量与写入热点一起解决',
            why: '订单 / 扫描是只追加大流水，单表过亿后索引维护比拆分更贵；JDBC 形态与业务同进程，没有代理层的网络损耗',
            scenario: 'orders 按 customer_id 分 8 库；scans / sortingTasks / loadingTasks 按运单号哈希分 16 表；运价卡与字典作广播表，orders ↔ points 绑定表同键同片避免跨片 JOIN',
            points: [
                '分片键：订单 customer_id，作业流水 waybill_no——查询主路径都带键',
                '广播表：rateCards 与字典全片同步，本地 JOIN 不跨网络',
                '绑定表：orders ↔ points 同分片键，积分扣减与订单同片事务',
                '主键接雪花算法，禁用各片自增；单据号 = 前缀 + 日期 + 雪花尾段',
                '流水按窗口归档：scans 90 天 / finances 120 天，与容量治理同一口径'
            ],
            fallback: '不带分片键的查询强制走检索服务投影，禁止全片广播扫描；分片键选定后不可在线改，改键等于重建',
            services: ['order', 'tms', 'billing', 'search'],
            tables: ['orders', 'scans', 'sortingTasks', 'loadingTasks', 'finances', 'points'],
            flows: ['quote', 'trunk', 'settle'],
            metrics: [{ k: '订单', v: '8 库' }, { k: '流水', v: '16 表' }, { k: '单片水位', v: '< 5000 万行' }]
        },
        {
            id: 'seata', no: 5, name: '分布式事务', product: 'Seata', version: '2.x · AT 模式',
            cat: 'data', hue: '#f0a92e', icon: '⛓',
            role: '跨服务写操作的原子性：要么全成，要么全回滚',
            why: 'AT 模式自动代理数据源、生成反向 SQL，业务零侵入；与 ShardingSphere 可组合；长事务留给本地消息表',
            scenario: '下单「落单 + 扣积分」跨订单库与积分片；改单「差价重算 + 路由重排」跨订单 / 计费 / 调度；代收上划「COD 核销 + 财务流水」跨计费两片',
            points: [
                'AT：一阶段本地提交 + undo_log，二阶段异步清理或反向补偿',
                '全局锁防脏写：改单乐观锁 + Seata 全局锁双保险',
                'TC 集群 3 节点注册到 Nacos，事务分组映射 TC 集群',
                '悬挂 / 空回滚 / 幂等三大防护开启，undo_log 保留 7 天',
                '月结这类长事务不用 AT：本地消息表 + 对账补偿，锁不住几十分钟'
            ],
            fallback: 'TC 不可用时新全局事务直接拒绝——宁可拒单不脏账；已提交的一阶段由恢复重试完成二阶段',
            services: ['order', 'billing', 'dispatch', 'tms'],
            tables: ['orders', 'points', 'finances', 'codRecords'],
            flows: ['quote', 'change', 'lastmile'],
            metrics: [{ k: 'TC 集群', v: '3 节点' }, { k: '全局超时', v: '60s' }, { k: 'undo_log', v: '7 天' }]
        },
        {
            id: 'redis', no: 6, name: '分布式锁', product: 'Redis + Redisson', version: '7 Cluster · 看门狗续期',
            cat: 'data', hue: '#d96bb0', icon: '⚿',
            role: '抢单、幂等、配额的原子裁判：同一时刻只有一个赢家',
            why: '抢单高并发下数据库行锁会打满连接池；Redis 原子命令 + Redisson 看门狗续期，锁粒度到单号，抢不到立即失败',
            scenario: '派送抢单 lock:assign:{waybill} 同一单不会被两人抢走；支付回调 lock:pay:{tradeNo} 重复通知不重复扣积分；巡检 lock:job:{key} 防多执行器重跑',
            points: [
                'tryLock(waitTime = 0)：抢不到立即失败转下家，不排队空耗',
                '看门狗自动续期 30s；持锁进程宕机，锁到期自动释放',
                '锁 value = 请求标识，Lua 脚本校验持有者再解锁，防误删',
                '不上红锁：主从异步复制的极端丢锁由业务幂等键兜底',
                '配额计数 INCR + 过期窗口；令牌桶在网关，锁只管互斥'
            ],
            fallback: 'Redis 不可用：抢单降级为调度台指派模式，幂等退到数据库唯一索引；恢复后自动切回',
            services: ['gateway', 'order', 'dispatch', 'tms', 'job'],
            tables: ['orders', 'points'], flows: ['quote', 'lastmile', 'sweep'],
            metrics: [{ k: '锁粒度', v: '单号 / 交易号' }, { k: '续期', v: '30s' }, { k: '抢锁', v: '失败即转' }]
        },
        {
            id: 'snowflake', no: 7, name: '分布式 ID', product: '雪花算法 Snowflake', version: '64bit · 本地生成',
            cat: 'data', hue: '#8fa8c8', icon: '❄',
            role: '全局唯一、趋势递增的 64 位 ID：分片主键与单据号的共同底座',
            why: '分库分表后自增主键失效，UUID 无序撑爆 B+ 树；雪花本地生成零网络开销，时间有序对索引友好',
            scenario: 'orders / scans / finances 分片主键；运单号 = 前缀 + 日期 + 雪花尾段；workerId 按 K8s StatefulSet 序号注入，数据中心位按机房划分',
            points: [
                '64bit = 1 符号 + 41 时间戳 + 5 数据中心 + 5 工作节点 + 12 序列号',
                '自定义纪元 2024-01-01 起可用 69 年；单节点每毫秒 4096 个',
                '理论峰值单节点 409.6 万 ID / 秒，生成不出进程',
                '时钟回拨 ≤ 5ms 等待追平，> 5ms 拒绝发号并上报告警',
                'workerId 启动自检：与 Nacos 登记的实例身份冲突则拒绝上线'
            ],
            fallback: '回拨超容忍宁可失败不发重号；号段模式（Leaf-segment）作应急兜底，恢复后切回雪花',
            services: ['order', 'branch', 'dispatch', 'billing', 'tms', 'kpi'],
            tables: ['orders', 'scans', 'finances', 'receivables', 'payables'],
            flows: ['quote', 'trunk', 'settle'],
            metrics: [{ k: '位宽', v: '64 bit' }, { k: '每毫秒', v: '4096 个' }, { k: '纪元寿命', v: '69 年' }]
        },
        {
            id: 'skywalking', no: 8, name: '应用监控', product: 'SkyWalking', version: '10 · 全链路追踪',
            cat: 'observe', hue: '#2fa8e0', icon: '◉',
            role: '跨服务一跳一跳的 traceId 追踪：慢在哪一跳、错在哪一跳一眼可见',
            why: 'Java Agent 无侵入探针，自动埋点 Spring / Feign / MySQL / Redis / RocketMQ；OAP 集群水平扩展',
            scenario: '下单 8 步链路全程一个 traceId；改单差价重算的慢调用定位到 billing reprice；巡检跨 6 服务读事实的耗时逐跳拆解',
            points: [
                'Agent 挂载零代码改动；traceId 透传 HTTP header / MQ 属性 / 调度上下文',
                '采样：正常 10%，错误与慢调用全量保留',
                '服务拓扑自动发现，依赖图与架构目录互验',
                'P99 超阈值 webhook 到告警台账，与业务告警同一入口',
                '日志打 traceId（Loki），指标 / 链路 / 日志三向互查'
            ],
            fallback: 'OAP 不可用时探针本地缓冲后丢弃，业务零影响；链路缺失以 Prometheus 指标 + 日志 traceId 互查',
            services: ALL_SVC, tables: [], flows: ['quote', 'change', 'sweep', 'settle'],
            metrics: [{ k: '采样', v: '10% + 错误全量' }, { k: '埋点', v: '零侵入' }, { k: '告警', v: 'P99 阈值' }]
        },
        {
            id: 'prometheus', no: 9, name: '指标监控', product: 'Prometheus + Grafana', version: 'Alertmanager 告警分级',
            cat: 'observe', hue: '#e8632c', icon: '∿',
            role: '数值形态的观测：QPS、延迟、错误率、资源水位与分级告警',
            why: '拉模式契合 K8s 服务发现，PromQL 表达力强；与 SkyWalking 互补——指标看趋势，链路看个案',
            scenario: '十服务 RED 指标 + MySQL 分片水位 + Redis 命中率 + 巡检耗时；告警 P1 电话 / P2 企微，落 alerts 台账双向收口',
            points: [
                'ServiceMonitor 自动发现抓取目标，新实例上线即被监控',
                '黄金指标 + USE：错误率 > 1% 持续 5min / P99 > 2s / 分片水位 > 80% 触发',
                'Alertmanager 分组 / 抑制 / 静默，发布窗口自动静默',
                'Grafana 三视角看板：服务健康 / 链路耗时 / 容量水位',
                '本地保留 15 天，Thanos 侧车长期存储 1 年'
            ],
            fallback: 'exporter 失联标记 down 并告警；Prometheus 双副本互备；告警通道故障时本地台账兜底可查',
            services: ALL_SVC, tables: ['alerts'], flows: ['sweep'],
            metrics: [{ k: '抓取间隔', v: '15s' }, { k: '本地保留', v: '15 天' }, { k: '长期存储', v: '1 年' }]
        },
        {
            id: 'cicd', no: 10, name: 'CI/CD 运维', product: 'Jenkins + Docker + Kubernetes', version: 'Harbor 仓库 · 金丝雀发布',
            cat: 'delivery', hue: '#8b7cf6', icon: '⎈',
            role: '从 git push 到生产发布的全自动流水线，按服务独立交付',
            why: 'Jenkinsfile 流水线即代码进库评审；Docker 镜像不可变；K8s 滚动 + 金丝雀把发布风险关进笼子',
            scenario: '十服务各自 Jenkinsfile；扫描上报高峰单独扩容 tms-core；发布带 Nacos 灰度元数据按 5% → 30% → 全量；回滚 = 切上一镜像 tag',
            points: [
                '八阶段：提交 → 触发 → 检查 → 构建 → 仓库 → 金丝雀 → 全量 → 验证',
                '镜像 tag = git sha 禁止 latest；Harbor 签名 + 漏洞扫描',
                'K8s HPA：CPU 70% 或 QPS 阈值自动扩缩，扫描高峰单独扩 tms-core',
                '就绪探针接 Nacos 注册：未就绪不接流量，发布不掉单',
                '发布窗口与账期任务互斥：月结凌晨不发布'
            ],
            fallback: '金丝雀指标异常自动回滚上一 tag（< 2min）；节点故障 Pod 自动漂移；Jenkins 故障只影响新发布排队',
            services: ALL_SVC, tables: [], flows: [],
            metrics: [{ k: '流水线', v: '8 阶段' }, { k: '金丝雀', v: '5% → 30% → 全量' }, { k: '回滚', v: '< 2min' }]
        }
    ];

    /* CI/CD 八阶段：与 cicd 组件的 points 同一口径，阶段点击看出口条件与失败处置 */
    var CICD = [
        { id: 'git', no: 1, name: '提交代码', tool: 'GitLab', hue: '#7ed957', dur: '即时',
            action: 'git push / MR 合并触发 webhook，分支保护 + 评审通过才进主干',
            exit: '评审通过，流水线参数（服务 / 环境 / tag）校验合法', fail: '评审打回，webhook 不触发' },
        { id: 'jenkins', no: 2, name: '触发流水线', tool: 'Jenkins', hue: '#8b7cf6', dur: '< 10s',
            action: 'Jenkinsfile 声明式流水线，按服务独立 job，构建参数注入镜像 tag',
            exit: 'job 排队成功，工作区清理完毕', fail: '参数非法直接拒绝，不占构建资源' },
        { id: 'check', no: 3, name: '检查与单测', tool: 'SonarQube + JUnit', hue: '#4ecdc4', dur: '3–5min',
            action: '静态扫描 + 架构守护测试（禁止跨包写表）+ 契约测试 + 覆盖率门禁',
            exit: '覆盖率 ≥ 70%，无阻断级异味，契约测试全绿', fail: '任一门禁红即停，通知提交人' },
        { id: 'docker', no: 4, name: '构建镜像', tool: 'Docker', hue: '#3d8bff', dur: '2–4min',
            action: '多阶段构建瘦身，tag = git sha，层缓存复用依赖层',
            exit: '镜像构建成功且扫描无高危漏洞', fail: '高危漏洞阻断推送，修复后重跑' },
        { id: 'harbor', no: 5, name: '推送仓库', tool: 'Harbor', hue: '#2fa8e0', dur: '< 1min',
            action: '推送私有仓库，镜像签名 + 漏洞扫描报告归档',
            exit: '集群可拉取，签名验证通过', fail: '推送失败重试 3 次，仓库不可用暂停发布' },
        { id: 'canary', no: 6, name: '金丝雀发布', tool: 'K8s + Nacos 灰度', hue: '#f0a92e', dur: '15min 观察',
            action: '灰度实例权重 5%，Nacos 元数据 version 分组，对比基线错误率与 P99',
            exit: '15min 指标无异常，放量 30% 再观察', fail: '指标异常自动回滚上一 tag，告警 P2' },
        { id: 'full', no: 7, name: '全量滚动', tool: 'K8s RollingUpdate', hue: '#46c07a', dur: '3–8min',
            action: 'maxSurge 1 / maxUnavailable 0 逐批替换，就绪探针接 Nacos 注册',
            exit: '全部实例就绪且进入负载名单', fail: '就绪探针失败暂停滚动，保留旧实例继续服务' },
        { id: 'verify', no: 8, name: '发布后验证', tool: 'Prometheus + SkyWalking', hue: '#e8632c', dur: '30min',
            action: '错误率 / P99 对比发布基线，链路抽查，告警静默解除',
            exit: '30min 无异常，发布单自动关闭归档', fail: '异常触发回滚预案，发布单转事故复盘' }
    ];

    /* 负载均衡三级接力：每一跳的策略与兜底都标在图上 */
    var LB_PATH = {
        hops: [
            { id: 'client', name: '客户端', sub: 'APP / PC / 小程序 / PDA / 开放平台', hue: '#9aa7bd', icon: '▣' },
            { id: 'nginx', name: 'Nginx', sub: '入口七层负载', policy: '轮询 + max_fails 健康检查', detail: 'keepalive 长连接 · keepalived VIP 防单点', hue: '#7ed957', icon: '⚖' },
            { id: 'gateway', name: '网关集群', sub: 'Spring Cloud Gateway × 2', policy: '路由 + 鉴权 + 配额限流', detail: 'Sentinel 令牌桶按客户 × 接口', hue: '#3d8bff', icon: '⛩' },
            { id: 'feign', name: 'OpenFeign', sub: '进程内客户端负载', policy: '权重轮询 · 本地缓存名单', detail: '连接 1s / 读 3s · 幂等 GET 才重试', hue: '#4ecdc4', icon: '⇄' },
            { id: 'instance', name: '服务实例', sub: 'order-service × 3', policy: '无状态 · 灰度权重 5%', detail: '新实例扩容秒级进名单', hue: '#f0a92e', icon: '▦' }
        ],
        registry: { name: 'Nacos 注册中心', sub: '心跳 5s · 15s 摘除 · 变更推送', hue: '#4ecdc4' }
    };

    /* ---------- 派生读模型 ---------- */

    function services() { return SERVICES.slice(); }

    function service(id) {
        for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].id === id) return SERVICES[i];
        return null;
    }

    function layers() {
        return LAYERS.map(function (l) {
            var items = SERVICES.filter(function (s) { return s.layer === l.id; });
            return {
                id: l.id, no: l.no, name: l.name, hue: l.hue, icon: l.icon, sub: l.sub,
                duty: l.duty, forbid: l.forbid, count: items.length,
                services: items.map(function (s) { return { id: s.id, no: s.no, name: s.name, hue: s.hue }; })
            };
        });
    }

    function collectionNames() { return Object.keys(db.COLLECTIONS); }

    /* boot.js 自己是装配器，不在它注入的 MODULES 清单里，但它确实是运行时的一部分：
       不补这一条，BFF 与定时任务映射到 js/boot.js 就会被自己的核对表判成漂移 */
    function moduleNames() {
        var list = (TMS.boot && TMS.boot.modules) ? TMS.boot.modules.slice() : [];
        if (list.indexOf('js/boot.js') < 0) list.unshift('js/boot.js');
        return list;
    }

    function pageIds() {
        var out = [];
        TMS.rbac.ADMIN_MENU.forEach(function (g) { g.items.forEach(function (it) { out.push(it.id); }); });
        Object.keys(TMS.rbac.PORTAL_MENU).forEach(function (role) {
            TMS.rbac.PORTAL_MENU[role].forEach(function (it) { out.push(it.id); });
        });
        return out;
    }

    /* 把 'TMS.order.create' 解析成真实函数：映射写错当场看得见，而不是文档里看着像真的 */
    function resolveApi(path) {
        var parts = String(path || '').split('.');
        if (parts[0] !== 'TMS') return null;
        var node = TMS;
        for (var i = 1; i < parts.length; i++) {
            node = node ? node[parts[i]] : null;
            if (node == null) return null;
        }
        return typeof node === 'function' ? node : null;
    }

    function coverage(id) {
        var s = service(id);
        if (!s) return null;
        var impl = s.impl || {};
        var mods = moduleNames(), pages = pageIds(), cols = collectionNames();
        var wantMods = impl.modules || [], wantPages = impl.pages || [], wantApis = impl.apis || [];
        var owns = s.owns || [];
        var rows = 0;
        owns.forEach(function (c) { rows += db.col(c).length; });
        var jobKeys = (TMS.jobs && TMS.jobs.RULES ? TMS.jobs.RULES : []).map(function (r) { return r.key; });
        return {
            id: id,
            modules: wantMods.filter(function (m) { return mods.indexOf(m) > -1; }),
            missingModules: wantMods.filter(function (m) { return mods.indexOf(m) < 0; }),
            pages: wantPages.filter(function (p) { return pages.indexOf(p) > -1 && !!TMS.pages.get(p); }),
            missingPages: wantPages.filter(function (p) { return pages.indexOf(p) < 0 || !TMS.pages.get(p); }),
            apis: wantApis.filter(function (a) { return !!resolveApi(a); }),
            missingApis: wantApis.filter(function (a) { return !resolveApi(a); }),
            collections: owns.filter(function (c) { return cols.indexOf(c) > -1; }),
            missingCollections: owns.filter(function (c) { return cols.indexOf(c) < 0; }),
            rows: rows,
            jobs: id === 'job' ? jobKeys : [],
            apiCount: (s.apis || []).length,
            eventCount: (s.events || []).length,
            dutyCount: (s.duty || []).length
        };
    }

    function stats() {
        var cols = collectionNames();
        var owned = [];
        SERVICES.forEach(function (s) { (s.owns || []).forEach(function (c) { owned.push(c); }); });
        var orphan = cols.filter(function (c) { return owned.indexOf(c) < 0; });
        var pages = pageIds();
        var registered = pages.filter(function (p) { return !!TMS.pages.get(p); });
        /* 公开架构页不住在六端菜单里，但注册表给了它真实文件：
           菜单项数与落地页数是两个口径，说明书自己也算一页落地 */
        TMS.pages.all().forEach(function (d) {
            if (d.file && pages.indexOf(d.id) < 0) registered.push(d.id);
        });
        var mods = moduleNames();
        var steps = 0, apis = 0, sync = 0, async = 0;
        FLOWS.forEach(function (f) {
            steps += f.steps.length;
            f.steps.forEach(function (st) { if (st.kind === 'sync') sync++; else async++; });
        });
        SERVICES.forEach(function (s) { apis += (s.apis || []).length; });
        var rows = 0;
        cols.forEach(function (c) { rows += db.col(c).length; });
        return {
            services: SERVICES.length,
            layers: LAYERS.length,
            domainServices: SERVICES.filter(function (s) { return s.layer === 'domain'; }).length,
            collections: cols.length,
            owned: owned.length,
            orphan: orphan,
            pages: pages.length,
            registeredPages: registered.length,
            modules: mods.length,
            domainModules: mods.filter(function (m) { return m.indexOf('js/domain/') === 0; }).length,
            jobs: (TMS.jobs && TMS.jobs.RULES ? TMS.jobs.RULES : []).length,
            flows: FLOWS.length,
            steps: steps,
            syncSteps: sync,
            asyncSteps: async,
            apis: apis,
            principles: PRINCIPLES.length,
            rows: rows,
            schema: cfg.storage.schema,
            roles: Object.keys(cfg.roles).length
        };
    }

    /* 数据归属矩阵：一张表一行，写入者唯一；只读方从事件与 deps 推 */
    function matrix() {
        var cols = collectionNames();
        return cols.map(function (name) {
            var owner = null;
            SERVICES.forEach(function (s) { if ((s.owns || []).indexOf(name) > -1) owner = s; });
            var readers = SERVICES.filter(function (s) {
                if (!owner || s.id === owner.id) return false;
                return (s.events || []).some(function (e) { return e.dir === 'in' && e.peer === owner.id; }) ||
                    (s.deps || []).indexOf(owner.id) > -1;
            });
            var meta = db.meta(name);
            return {
                name: name, label: meta.label || name, prefix: meta.prefix || '',
                trim: meta.trim || 0, rows: db.col(name).length,
                owner: owner ? owner.id : '', ownerName: owner ? owner.name : '未归属',
                hue: owner ? owner.hue : '#d43b3b', readers: readers.map(function (s) { return s.id; })
            };
        });
    }

    /* 写入者分布：一张表只能有一个主人，这里把「谁管多少表、多少行」算给页面，
       页面不再自己 groupBy——矩阵、拓扑、清单三处的表数必须同源 */
    function ownership() {
        var rows = matrix();
        var total = rows.length || 1;
        return SERVICES.map(function (s) {
            var mine = rows.filter(function (r) { return r.owner === s.id; });
            var n = 0;
            mine.forEach(function (r) { n += r.rows; });
            return {
                id: s.id, no: s.no, name: s.name, hue: s.hue,
                tables: mine.length, rows: n,
                share: util.round(mine.length / total * 100, 1),
                collections: mine.map(function (r) { return r.name; })
            };
        });
    }

    function neighbors(id) {
        var s = service(id);
        if (!s) return { down: [], up: [], eventsIn: [], eventsOut: [] };
        var down = (s.deps || []).map(service).filter(Boolean);
        var up = SERVICES.filter(function (x) { return (x.deps || []).indexOf(id) > -1; });
        return {
            down: down, up: up,
            eventsIn: (s.events || []).filter(function (e) { return e.dir === 'in'; }),
            eventsOut: (s.events || []).filter(function (e) { return e.dir === 'out'; })
        };
    }

    function flows() {
        return FLOWS.map(function (f) {
            return {
                id: f.id, no: f.no, name: f.name, sub: f.sub, hue: f.hue,
                trigger: f.trigger, outcome: f.outcome, sla: f.sla,
                participants: participants(f),
                steps: f.steps.map(function (st, i) {
                    var a = service(st.from), b = service(st.to);
                    return {
                        seq: i + 1, from: st.from, to: st.to, kind: st.kind, api: st.api,
                        payload: st.payload, note: st.note,
                        fromName: a ? a.name : st.from, toName: b ? b.name : st.to,
                        hue: a ? a.hue : '#9aa7bd', toHue: b ? b.hue : '#9aa7bd',
                        missing: !a || !b
                    };
                })
            };
        });
    }

    function participants(f) {
        var seen = [];
        f.steps.forEach(function (st) {
            [st.from, st.to].forEach(function (id) { if (seen.indexOf(id) < 0) seen.push(id); });
        });
        return seen.map(function (id) {
            var s = service(id);
            return { id: id, name: s ? s.name : id, hue: s ? s.hue : '#9aa7bd', no: s ? s.no : 0 };
        });
    }

    function flow(id) {
        var list = flows();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return list[0] || null;
    }

    function jobPlan() {
        var rules = (TMS.jobs && TMS.jobs.RULES) ? TMS.jobs.RULES : [];
        return rules.map(function (r) {
            var p = JOB_PLAN[r.key] || {};
            return {
                key: r.key, name: r.name, cron: p.cron || '', target: p.target || '',
                note: p.note || '', handler: r.key + 'Handler', planned: !!p.cron
            };
        });
    }

    function stack() { return STACK.slice(); }
    function evolution() { return PHASES.slice(); }
    function principles() { return PRINCIPLES.slice(); }
    function infra() { return INFRA.slice(); }
    function clients() { return CLIENTS.slice(); }

    /* ---------- 拓扑坐标：分层布局，同步依赖走下方走线槽、事件走上方 ---------- */

    var W = 1180, H = 620;
    var DOMAIN_X = [22, 214, 406, 598, 790, 982];
    var DOMAIN_ORDER = ['order', 'branch', 'dispatch', 'billing', 'tms', 'kpi'];

    function bands() {
        return [
            { id: 'clients', name: '终端', y: 14, h: 48, sub: 'APP / PC / 小程序 / PDA / 开放平台' },
            { id: 'edge', name: '接入层', y: 74, h: 84, sub: '统一入口 · 鉴权 · 限流' },
            { id: 'bff', name: '聚合层', y: 170, h: 84, sub: '只编排与适配，不写业务逻辑' },
            { id: 'domain', name: '领域服务层', y: 266, h: 150, sub: '每张表只有一个写入者' },
            { id: 'support', name: '支撑服务层', y: 428, h: 84, sub: '定时调度 · 检索读模型' },
            { id: 'infra', name: '基础设施', y: 524, h: 76, sub: '存储 · 消息 · 缓存 · 调度 · 观测' }
        ];
    }

    function nodes() {
        var out = [];
        out.push({ id: 'gateway', x: 390, y: 84, w: 400, h: 62 });
        out.push({ id: 'bff', x: 290, y: 180, w: 600, h: 62 });
        DOMAIN_ORDER.forEach(function (id, i) {
            out.push({ id: id, x: DOMAIN_X[i], y: 286, w: 176, h: 110, col: i });
        });
        out.push({ id: 'job', x: 190, y: 438, w: 380, h: 62 });
        out.push({ id: 'search', x: 610, y: 438, w: 380, h: 62 });
        return out.map(function (n) {
            var s = service(n.id), cov = coverage(n.id);
            return {
                id: n.id, no: s.no, name: s.name, en: s.en, layer: s.layer, hue: s.hue,
                icon: s.icon, tag: s.tag, mission: s.mission,
                x: n.x, y: n.y, w: n.w, h: n.h, col: n.col == null ? -1 : n.col,
                tables: cov.collections.length, pages: cov.pages.length, rows: cov.rows,
                apis: cov.apiCount, deps: (s.deps || []).length
            };
        });
    }

    /* 同步依赖成环就是拆分失败：这里按 deps 做一次拓扑排序，页面与冒烟都用同一份结论 */
    function syncCycle() {
        var state = {}, stack = [], cycle = [];
        function visit(id) {
            if (state[id] === 2) return;
            if (state[id] === 1) { cycle = stack.slice(stack.indexOf(id)).concat(id); return; }
            state[id] = 1; stack.push(id);
            var s = service(id);
            (s && s.deps ? s.deps : []).forEach(visit);
            stack.pop(); state[id] = 2;
        }
        SERVICES.forEach(function (s) { visit(s.id); });
        return cycle;
    }

    function edgeList() {
        var out = [];
        function add(from, to, kind, label) {
            if (!service(from) || !service(to)) return;
            out.push({ from: from, to: to, kind: kind, label: label || '' });
        }
        add('gateway', 'bff', 'sync', '路由转发');
        var bffTargets = ['order', 'branch', 'dispatch', 'billing', 'tms', 'kpi'];
        bffTargets.forEach(function (id) { add('bff', id, 'sync', '聚合取数'); });
        add('bff', 'search', 'sync', '检索聚合');
        add('order', 'branch', 'sync', '可派送 / 折扣');
        add('order', 'billing', 'sync', '计价 / 差价');
        add('order', 'dispatch', 'sync', '路径 / 运力');
        add('dispatch', 'branch', 'sync', '网点 / 围栏');
        add('dispatch', 'tms', 'sync', '派单 / 作业单');
        add('tms', 'branch', 'sync', '场地档案');
        add('billing', 'branch', 'sync', '折扣规则');
        add('branch', 'search', 'read', '网点候选');
        add('tms', 'order', 'event', '作业事实');
        add('tms', 'billing', 'event', '成本事实');
        add('tms', 'kpi', 'event', '绩效投影');
        add('tms', 'search', 'event', '轨迹 / 库存索引');
        add('order', 'kpi', 'event', '签收 / 收入投影');
        add('order', 'search', 'event', '订单索引');
        add('billing', 'kpi', 'event', '收入成本投影');
        add('dispatch', 'order', 'event', '在途异常');
        add('dispatch', 'kpi', 'event', '异常率投影');
        ['order', 'tms', 'billing', 'branch', 'kpi', 'dispatch'].forEach(function (id) { add('job', id, 'job', '定时巡检'); });
        return out;
    }

    function nodeById(list, id) {
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    /* 走线：跨层用竖直贝塞尔，领域层内部同步走下方线槽、事件走上方线槽，
       BFF 到检索绕右侧外沿——线压在节点上就没法看了 */
    function edgePath(a, b, kind, index) {
        var acx = a.x + a.w / 2, bcx = b.x + b.w / 2;
        if (a.id === 'bff' && b.id === 'search') {
            return 'M ' + (a.x + a.w) + ' ' + (a.y + a.h / 2) +
                ' L 1168 ' + (a.y + a.h / 2) + ' L 1168 ' + (b.y + b.h / 2) + ' L ' + (b.x + b.w) + ' ' + (b.y + b.h / 2);
        }
        if (a.layer === 'domain' && b.layer === 'domain') {
            var gutter = kind === 'sync' ? 410 : 276;
            if (Math.abs(a.col - b.col) === 1 && kind === 'sync') {
                var sx = a.col < b.col ? a.x + a.w : a.x;
                var ex = a.col < b.col ? b.x : b.x + b.w;
                var my = a.y + a.h / 2;
                return 'M ' + sx + ' ' + my + ' L ' + ex + ' ' + my;
            }
            var sxx = a.col < b.col ? a.x + a.w - 24 : a.x + 24;
            var exx = a.col < b.col ? b.x + 24 : b.x + b.w - 24;
            var sy = kind === 'sync' ? a.y + a.h : a.y;
            var ey = kind === 'sync' ? b.y + b.h : b.y;
            return 'M ' + sxx + ' ' + sy + ' L ' + sxx + ' ' + gutter + ' L ' + exx + ' ' + gutter + ' L ' + exx + ' ' + ey;
        }
        if (a.y + a.h <= b.y) {
            var fx = (index % 5 + 1) / 6;
            var sx2 = a.x + a.w * fx, sy2 = a.y + a.h;
            var ex2 = bcx, ey2 = b.y;
            var dy = Math.max(8, Math.min(46, (ey2 - sy2) * 0.55));
            return 'M ' + sx2 + ' ' + sy2 + ' C ' + sx2 + ' ' + (sy2 + dy) + ', ' + ex2 + ' ' + (ey2 - dy) + ', ' + ex2 + ' ' + ey2;
        }
        if (b.y + b.h <= a.y) {
            var sx3 = acx, sy3 = a.y, ex3 = bcx, ey3 = b.y + b.h;
            var dy2 = Math.max(8, Math.min(40, (sy3 - ey3) * 0.5));
            return 'M ' + sx3 + ' ' + sy3 + ' C ' + sx3 + ' ' + (sy3 - dy2) + ', ' + ex3 + ' ' + (ey3 + dy2) + ', ' + ex3 + ' ' + ey3;
        }
        return 'M ' + acx + ' ' + (a.y + a.h / 2) + ' L ' + bcx + ' ' + (b.y + b.h / 2);
    }

    function topology(opts) {
        var o = opts || {};
        var ns = nodes();
        var lines = o.lines || 'all';
        var es = edgeList().filter(function (e) {
            if (lines === 'sync') return e.kind === 'sync';
            if (lines === 'async') return e.kind !== 'sync';
            return true;
        }).map(function (e, i) {
            var a = nodeById(ns, e.from), b = nodeById(ns, e.to);
            var hue = e.kind === 'sync' ? a.hue : (e.kind === 'job' ? '#9aa7bd' : e.kind === 'read' ? '#7ed957' : '#4ecdc4');
            return {
                from: e.from, to: e.to, kind: e.kind, label: e.label, hue: hue,
                path: edgePath(a, b, e.kind, i),
                dashed: e.kind !== 'sync',
                delay: util.round((i % 9) * 0.42, 2)
            };
        });
        return {
            width: W, height: H, nodes: ns, edges: es, bands: bands(),
            clients: CLIENTS.slice(), infra: INFRA.slice(),
            cycle: syncCycle(),
            counts: {
                sync: es.filter(function (e) { return e.kind === 'sync'; }).length,
                event: es.filter(function (e) { return e.kind === 'event'; }).length,
                job: es.filter(function (e) { return e.kind === 'job'; }).length,
                read: es.filter(function (e) { return e.kind === 'read'; }).length
            }
        };
    }

    /* ---------- 分布式体系读模型 ---------- */

    function distCats() {
        return DIST_CATS.map(function (c) {
            var items = DISTRIBUTED.filter(function (t) { return t.cat === c.id; });
            return {
                id: c.id, name: c.name, hue: c.hue, icon: c.icon, sub: c.sub,
                count: items.length, techs: items.map(function (t) { return t.id; })
            };
        });
    }

    function distributed() { return DISTRIBUTED.slice(); }

    function distTech(id) {
        for (var i = 0; i < DISTRIBUTED.length; i++) if (DISTRIBUTED[i].id === id) return DISTRIBUTED[i];
        return null;
    }

    /* 技术 × 服务覆盖矩阵：行是组件，列是服务，交叉点给出「管什么」一句话 */
    function distMatrix() {
        return DISTRIBUTED.map(function (t) {
            return {
                id: t.id, no: t.no, name: t.name, product: t.product, hue: t.hue, cat: t.cat,
                cells: SERVICES.map(function (s) { return t.services.indexOf(s.id) > -1; }),
                count: t.services.length
            };
        });
    }

    function distStats() {
        var links = 0, full = 0;
        DISTRIBUTED.forEach(function (t) {
            links += t.services.length;
            if (t.services.length === SERVICES.length) full++;
        });
        return {
            techs: DISTRIBUTED.length, cats: DIST_CATS.length, links: links, full: full,
            stages: CICD.length,
            points: DISTRIBUTED.reduce(function (a, t) { return a + t.points.length; }, 0)
        };
    }

    function cicd() { return CICD.slice(); }
    function lbPath() { return LB_PATH; }

    TMS.architecture = {
        services: services, service: service, layers: layers, coverage: coverage,
        stats: stats, matrix: matrix, ownership: ownership, neighbors: neighbors,
        flows: flows, flow: flow, jobPlan: jobPlan,
        stack: stack, evolution: evolution, principles: principles,
        infra: infra, clients: clients, topology: topology, syncCycle: syncCycle,
        distCats: distCats, distributed: distributed, distTech: distTech,
        distMatrix: distMatrix, distStats: distStats, cicd: cicd, lbPath: lbPath
    };
})(window);