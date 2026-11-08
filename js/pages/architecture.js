/* 架构设计页：把 js/domain/architecture.js 的服务目录渲染成可操作的工程图纸。
   页面只做三件事——画图、列清单、开抽屉；服务数、表数、覆盖度、依赖环一律读领域派生值。
   拓扑与时序图都是自包含 SVG（样式与当前视图状态一起内联），所以「导出 SVG」拿到的就是眼前这张图 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui, db = TMS.db, cfg = TMS.cfg, pg = TMS.pages, ch = TMS.charts;
    var arch = TMS.architecture;
    var esc = util.esc, fmt = util.fmt;

    var PAGE = 'architecture';

    var TABS = [
        { value: 'topo', label: '架构总览' },
        { value: 'services', label: '服务清单' },
        { value: 'flows', label: '调用链路' },
        { value: 'data', label: '数据与一致性' },
        { value: 'dist', label: '分布式与运维' },
        { value: 'deploy', label: '部署与演进' }
    ];

    /* 视图状态与列表状态分开：翻页筛选不该把「关掉动画」这件事重置掉 */
    var VIEW_DEFAULT = {
        lines: 'all', focus: '', distFocus: '', anim: 1, speed: 1, zoom: 1,
        metrics: 1, grid: 1, glow: 1, theme: 'dark', play: 1, step: 1
    };

    function view() {
        var st = ui.state(PAGE);
        if (!st.arch) st.arch = {};
        Object.keys(VIEW_DEFAULT).forEach(function (k) {
            if (st.arch[k] === undefined) st.arch[k] = VIEW_DEFAULT[k];
        });
        return st.arch;
    }

    function setView(patch) {
        var v = view();
        Object.keys(patch || {}).forEach(function (k) { v[k] = patch[k]; });
        TMS.shell.refresh();
    }

    function curCtx() {
        var s = TMS.shell.current();
        return {
            shell: s, session: s.session, params: s.params, days: s.days, layout: s.layout,
            pageId: s.pageId, role: s.session && s.session.role, state: ui.state(s.pageId)
        };
    }

    /* ---------- 通用小件 ---------- */

    function hueDot(h) {
        return '<i class="ar-dot" style="background:' + esc(h) + '"></i>';
    }

    function svcTag(s) {
        return '<span class="ar-svctag" style="--h:' + esc(s.hue) + '">' + hueDot(s.hue) + esc(s.name) + '</span>';
    }

    var LAYER_NAME = {};
    arch.layers().forEach(function (l) { LAYER_NAME[l.id] = l; });

    function layerBadge(id) {
        var l = LAYER_NAME[id];
        if (!l) return ui.badge(esc(id), 'muted');
        return '<span class="ar-layer" style="--h:' + esc(l.hue) + '">' + esc(l.name) + '</span>';
    }

    var KIND = {
        sync: { label: '同步调用', tone: 'info', hue: '#3d8bff' },
        event: { label: '领域事件', tone: 'accent', hue: '#4ecdc4' },
        job: { label: '定时触发', tone: 'muted', hue: '#9aa7bd' },
        self: { label: '服务内事务', tone: 'warn', hue: '#f0a92e' },
        read: { label: '只读投影', tone: 'success', hue: '#7ed957' }
    };

    function kindBadge(k) {
        var d = KIND[k] || { label: k, tone: 'muted' };
        return ui.badge(d.label, d.tone);
    }

    function methodBadge(m) {
        var tone = m === 'GET' ? 'info' : m === 'POST' ? 'success' : m === 'PATCH' ? 'warn'
            : m === 'DELETE' ? 'danger' : m === 'JOB' ? 'muted' : 'brand';
        return '<span class="tms-badge tone-' + tone + ' tms-mono">' + esc(m) + '</span>';
    }

    /* SVG 里没有自动换行，超宽的文字必须自己截：估算字宽（中日韩按全角，其余按半角） */
    function textW(s, size) {
        var str = String(s == null ? '' : s), w = 0;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            w += c > 0x2e80 ? size : (c === 32 ? size * 0.3 : size * 0.56);
        }
        return w;
    }

    function fit(s, max, size) {
        var str = String(s == null ? '' : s);
        if (textW(str, size) <= max) return str;
        var out = '';
        for (var i = 0; i < str.length; i++) {
            if (textW(out + str.charAt(i) + '…', size) > max) break;
            out += str.charAt(i);
        }
        return out + '…';
    }

    function save(name, text, mime) {
        var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
        var a = document.createElement('a');
        a.href = global.URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        ui.toast('已导出 ' + name + '（' + (text.length / 1024).toFixed(1) + ' KB）', 'success');
    }

    function toCsv(cols, rows) {
        var cell = function (v) {
            var s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        return [cols.map(function (c) { return cell(c.label); }).join(',')].concat(rows.map(function (r) {
            return cols.map(function (c) { return cell(typeof c.value === 'function' ? c.value(r) : r[c.key]); }).join(',');
        })).join('\n');
    }

    /* ---------- 拓扑图 ---------- */

    var SVG_STYLE = [
        '.ar-svg{font-family:"Segoe UI","Microsoft YaHei",sans-serif}',
        '.ar-name{font-size:13px;font-weight:600}',
        '.ar-en{font-size:8.5px;letter-spacing:.5px}',
        '.ar-tag{font-size:9.5px}',
        '.ar-metric{font-size:9px}',
        '.ar-no{font-size:10px;font-weight:700}',
        '.ar-band-name{font-size:10.5px;font-weight:600;letter-spacing:1.2px}',
        '.ar-band-sub{font-size:9px}',
        '.ar-chip-name{font-size:10.5px;font-weight:600}',
        '.ar-chip-sub{font-size:7.5px}',
        '.ar-node{cursor:pointer}',
        '.ar-box{transition:stroke-width .18s ease,fill-opacity .18s ease}',
        '.ar-node:hover .ar-box{stroke-width:2.6}',
        '.ar-node:hover .ar-halo{fill-opacity:.3}',
        '.ar-node.ar-focus .ar-halo{animation:arHalo 1.6s ease-in-out infinite}',
        '@keyframes arHalo{0%,100%{fill-opacity:.16}50%{fill-opacity:.48}}',
        '.no-anim .ar-node.ar-focus .ar-halo{animation:none}',
        '.ar-flow{animation:arDash calc(4s / var(--arch-speed,1)) linear infinite}',
        '@keyframes arDash{to{stroke-dashoffset:-157}}',
        '.no-anim .ar-flow{display:none}',
        '.no-grid .ar-grid{display:none}'
    ].join('');

    function palette(theme) {
        return theme === 'light'
            ? { bg: '#f6f9fd', band: '#ffffff', bandLine: '#dbe4f0', ink: '#1f2a3a', dim: '#5b6b85', faint: '#94a2b8', grid: '#e4ebf5', node: '#ffffff', nodeOp: 1 }
            : { bg: '#080e1c', band: '#0e1729', bandLine: '#1e2d4a', ink: '#e9effb', dim: '#93a6c4', faint: '#5f7392', grid: '#131f36', node: '#101b30', nodeOp: 1 };
    }

    /* 邻接从当前可见边推导：事件 / 定时 / 只读相连的同样是邻居。
       只按同步 deps 算会把 TMS 核心、考核、检索这些事件大户误判成「无关」 */
    function nearMap(t, focus) {
        var near = {};
        if (!focus) return near;
        near[focus] = 1;
        t.edges.forEach(function (e) {
            if (e.from === focus) near[e.to] = 1;
            if (e.to === focus) near[e.from] = 1;
        });
        return near;
    }

    function topoSvg(v) {
        var t = arch.topology({ lines: v.lines });
        var C = palette(v.theme);
        var focus = v.focus && arch.service(v.focus) ? v.focus : '';
        var near = nearMap(t, focus);
        var s = [];
        var cls = 'ar-svg' + (v.anim ? '' : ' no-anim') + (v.grid ? '' : ' no-grid');
        s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t.width + ' ' + t.height +
            '" class="' + cls + '" style="--arch-speed:' + esc(v.speed) + '" role="img" aria-label="汇通物流 TMS 十服务架构拓扑">');
        s.push('<style>' + SVG_STYLE + '</style>');

        /* 箭头按色号各建一份：marker 里取不到描边色，共用一个箭头会让十种线都长出灰脑袋 */
        var hues = [], marker = {};
        t.edges.forEach(function (e) {
            if (marker[e.hue]) return;
            marker[e.hue] = 'ar-ah-' + hues.length;
            hues.push(e.hue);
        });
        s.push('<defs>');
        s.push('<pattern id="arGridP" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<path d="M26 0H0V26" fill="none" stroke="' + C.grid + '" stroke-width="1"/></pattern>');
        s.push('<filter id="arGlowF" x="-70%" y="-70%" width="240%" height="240%">' +
            '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        hues.forEach(function (h) {
            s.push('<marker id="' + marker[h] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
                '<path d="M0 0L10 5L0 10z" fill="' + h + '"/></marker>');
        });
        s.push('</defs>');

        s.push('<rect x="0" y="0" width="' + t.width + '" height="' + t.height + '" rx="14" fill="' + C.bg + '"/>');
        s.push('<rect class="ar-grid" x="0" y="0" width="' + t.width + '" height="' + t.height + '" rx="14" fill="url(#arGridP)"/>');

        /* 分层带 */
        t.bands.forEach(function (b) {
            s.push('<rect x="8" y="' + b.y + '" width="' + (t.width - 16) + '" height="' + b.h + '" rx="11" fill="' + C.band +
                '" fill-opacity="' + (v.theme === 'light' ? '.78' : '.62') + '" stroke="' + C.bandLine + '" stroke-width="1"/>');
            s.push('<text class="ar-band-name" x="18" y="' + (b.y + 15) + '" fill="' + C.dim + '">' + esc(b.name) + '</text>');
            if (b.id !== 'clients' && b.id !== 'infra') {
                s.push('<text class="ar-band-sub" x="' + (t.width - 18) + '" y="' + (b.y + 15) + '" text-anchor="end" fill="' + C.faint + '">' +
                    esc(fit(b.sub, 300, 9)) + '</text>');
            }
        });

        /* 终端与基础设施：这两排不是服务，画成 chips 免得被当成第十一个服务 */
        function chipRow(items, y, h, x0, nameSize, subSize) {
            var gap = 8, w = (t.width - 18 - x0 - gap * (items.length - 1)) / items.length;
            return items.map(function (it, i) {
                var x = x0 + i * (w + gap);
                return '<g><rect x="' + util.round(x, 1) + '" y="' + y + '" width="' + util.round(w, 1) + '" height="' + h +
                    '" rx="8" fill="' + C.bg + '" stroke="' + C.bandLine + '" stroke-width="1"/>' +
                    '<text class="ar-chip-name" x="' + util.round(x + w / 2, 1) + '" y="' + (y + (subSize ? 19 : h / 2 + 4)) +
                    '" text-anchor="middle" font-size="' + nameSize + '" fill="' + C.ink + '">' + esc(fit(it.name, w - 12, nameSize)) + '</text>' +
                    (subSize ? '<text class="ar-chip-sub" x="' + util.round(x + w / 2, 1) + '" y="' + (y + 34) +
                        '" text-anchor="middle" font-size="' + subSize + '" fill="' + C.faint + '">' + esc(fit(it.sub, w - 10, subSize)) + '</text>' : '') +
                    '<title>' + esc(it.name + ' — ' + it.sub) + '</title></g>';
            }).join('');
        }
        s.push(chipRow(t.clients, 22, 32, 110, 10.5, 0));
        s.push(chipRow(t.infra, 542, 48, 110, 10.5, 7.5));

        /* 连线：底线 + 一条跑动的光带。光带用 dashoffset 动画，不挂任何 JS 定时器 */
        var flows = [];
        s.push('<g class="ar-edges">');
        t.edges.forEach(function (e, i) {
            var dim = focus && !(near[e.from] && near[e.to]);
            var dash = e.kind === 'sync' ? '' : e.kind === 'event' ? ' stroke-dasharray="6 5"' : e.kind === 'job' ? ' stroke-dasharray="2 4"' : ' stroke-dasharray="1 6"';
            s.push('<g opacity="' + (dim ? '.16' : '1') + '"><path class="ar-line" d="' + e.path + '" fill="none" stroke="' + e.hue +
                '" stroke-width="1.5" stroke-opacity="' + (e.kind === 'sync' ? '.62' : '.48') + '"' + dash +
                ' marker-end="url(#' + marker[e.hue] + ')"/><title>' + esc(e.from + ' → ' + e.to + ' · ' + (KIND[e.kind] || {}).label + ' · ' + e.label) + '</title></g>');
            if (!dim) {
                flows.push('<path class="ar-flow" d="' + e.path + '" fill="none" stroke="' + e.hue + '" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="7 150" style="animation-delay:-' + esc(e.delay) + 's"/>');
            }
        });
        s.push('</g>');
        s.push('<g class="ar-flows"' + (v.glow ? ' filter="url(#arGlowF)"' : '') + '>' + flows.join('') + '</g>');

        /* 服务节点 */
        s.push('<g class="ar-nodes">');
        t.nodes.forEach(function (n) {
            /* 聚焦只淡出无关连线，服务节点永不压暗：压暗的服务看起来像坏了，
               而且事件相连的邻居本来就不该被算成「无关」 */
            var wide = n.h < 100;
            var x = n.x, y = n.y, w = n.w, h = n.h;
            s.push('<g class="ar-node' + (focus === n.id ? ' ar-focus' : '') + '" data-act="arch:open" data-arg="' + esc(n.id) + '" opacity="1">');
            s.push('<rect class="ar-box" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="' + C.node +
                '" stroke="' + n.hue + '" stroke-width="' + (focus === n.id ? 2.6 : 1.4) + '" stroke-opacity=".85"/>');
            s.push('<rect x="' + x + '" y="' + (y + 10) + '" width="3.5" height="' + (h - 20) + '" rx="1.8" fill="' + n.hue + '"/>');
            s.push('<circle class="ar-halo" cx="' + (x + 24) + '" cy="' + (wide ? y + h / 2 : y + 24) + '" r="12" fill="' + n.hue + '" fill-opacity=".16" stroke="' + n.hue + '" stroke-opacity=".45"/>');
            s.push('<text class="ar-no" x="' + (x + 24) + '" y="' + (wide ? y + h / 2 + 4 : y + 28) + '" text-anchor="middle" fill="' + n.hue + '">' + n.no + '</text>');
            if (wide) {
                s.push('<text class="ar-name" x="' + (x + 44) + '" y="' + (y + 25) + '" font-size="14" fill="' + C.ink + '">' + esc(fit(n.name, w - 200, 14)) + '</text>');
                s.push('<text class="ar-tag" x="' + (x + 44) + '" y="' + (y + 44) + '" fill="' + n.hue + '">' + esc(fit(n.tag, w - 200, 9.5)) + '</text>');
                if (v.metrics) {
                    s.push('<text class="ar-metric" x="' + (x + w - 16) + '" y="' + (y + 25) + '" text-anchor="end" fill="' + C.dim + '">' +
                        esc('表 ' + n.tables + ' · 页 ' + n.pages + ' · 接口 ' + n.apis) + '</text>');
                    s.push('<text class="ar-metric" x="' + (x + w - 16) + '" y="' + (y + 43) + '" text-anchor="end" fill="' + C.faint + '">' +
                        esc('行 ' + fmt.number(n.rows) + ' · 依赖 ' + n.deps) + '</text>');
                }
            } else {
                s.push('<text class="ar-name" x="' + (x + 44) + '" y="' + (y + 21) + '" fill="' + C.ink + '">' + esc(fit(n.name, w - 54, 13)) + '</text>');
                s.push('<text class="ar-en" x="' + (x + 44) + '" y="' + (y + 34) + '" fill="' + C.faint + '">' + esc(fit(n.en, w - 54, 8.5)) + '</text>');
                s.push('<text class="ar-tag" x="' + (x + 14) + '" y="' + (y + 56) + '" fill="' + n.hue + '">' + esc(fit(n.tag, w - 26, 9.5)) + '</text>');
                if (v.metrics) {
                    s.push('<text class="ar-metric" x="' + (x + 14) + '" y="' + (y + 76) + '" fill="' + C.dim + '">' +
                        esc('表 ' + n.tables + ' · 页 ' + n.pages + ' · 接口 ' + n.apis) + '</text>');
                    s.push('<text class="ar-metric" x="' + (x + 14) + '" y="' + (y + 92) + '" fill="' + C.faint + '">' +
                        esc('行 ' + fmt.number(n.rows) + ' · 依赖 ' + n.deps) + '</text>');
                }
            }
            s.push('<title>' + esc(n.no + ' ' + n.name + ' — ' + n.mission) + '</title>');
            s.push('</g>');
        });
        s.push('</g>');
        s.push('</svg>');
        return s.join('');
    }

    /* ---------- 时序图 ---------- */

    function flowSvg(f, v) {
        var ps = f.participants, n = ps.length || 1;
        var W = 1080, laneW = (W - 40) / n, x0 = 20;
        var rowH = 62, y0 = 78, steps = f.steps.length;
        var H = y0 + steps * rowH + 24;
        var C = palette(v.theme);
        var lane = {};
        ps.forEach(function (p, i) { lane[p.id] = x0 + laneW * (i + 0.5); });
        var win = util.round(100 / steps, 3);
        var kf = 'arSeq_' + f.id;
        var s = [];
        s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="ar-svg ar-seq' +
            (v.play ? ' playing' : '') + '" style="--arch-speed:' + esc(v.speed) + ';--arch-rows:' + steps + '" role="img" aria-label="' + esc(f.name) + ' 调用时序">');
        s.push('<style>' + SVG_STYLE +
            '.ar-lane{font-size:11px;font-weight:600}' +
            '.ar-api{font-size:10px}' +
            '.ar-pay{font-size:8.5px}' +
            '.ar-seqno{font-size:9px;font-weight:700}' +
            '.ar-row{cursor:pointer}' +
            '.ar-row .ar-rowbg{fill-opacity:0;transition:fill-opacity .18s ease}' +
            '.ar-row:hover .ar-rowbg{fill-opacity:.1}' +
            '.ar-row.on .ar-rowbg{fill-opacity:.16}' +
            '.ar-row.done .ar-lifeline-dot{fill-opacity:1}' +
            '.ar-playhead{animation:arHead calc(1.05s * var(--arch-rows,8) / var(--arch-speed,1)) linear infinite}' +
            '@keyframes arHead{from{transform:translateY(0)}to{transform:translateY(' + (steps * rowH) + 'px)}}' +
            '.playing .ar-step-g{animation:' + kf + ' calc(1.05s * var(--arch-rows,8) / var(--arch-speed,1)) linear infinite;animation-delay:calc(var(--i) * 1.05s / var(--arch-speed,1))}' +
            '@keyframes ' + kf + '{0%{opacity:1}' + win + '%{opacity:1}' + util.round(win + 0.01, 3) + '%{opacity:.34}100%{opacity:.34}}' +
            '.ar-step-g{opacity:.34}' +
            '.playing .ar-step-g{opacity:.34}' +
            '.ar-seq:not(.playing) .ar-playhead{display:none}' +
            '.ar-seq:not(.playing) .ar-step-g{opacity:1}' +
            '</style>');
        s.push('<defs>');
        var hues = [], marker = {};
        f.steps.forEach(function (st) {
            var h = (KIND[st.kind] || {}).hue || st.hue;
            if (marker[h]) return;
            marker[h] = 'ar-sq-' + f.id + '-' + hues.length;
            hues.push(h);
        });
        hues.forEach(function (h) {
            s.push('<marker id="' + marker[h] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
                '<path d="M0 0L10 5L0 10z" fill="' + h + '"/></marker>');
        });
        s.push('</defs>');
        s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="12" fill="' + C.bg + '"/>');

        /* 泳道头与生命线 */
        ps.forEach(function (p, i) {
            var cx = lane[p.id], bw = Math.min(laneW - 12, 168);
            s.push('<rect x="' + util.round(cx - bw / 2, 1) + '" y="14" width="' + util.round(bw, 1) + '" height="40" rx="9" fill="' + C.node +
                '" stroke="' + p.hue + '" stroke-width="1.3" stroke-opacity=".8"/>');
            s.push('<text class="ar-lane" x="' + util.round(cx, 1) + '" y="32" text-anchor="middle" fill="' + C.ink + '">' + esc(fit(p.name, bw - 14, 11)) + '</text>');
            s.push('<text class="ar-chip-sub" x="' + util.round(cx, 1) + '" y="46" text-anchor="middle" fill="' + p.hue + '">服务 ' + p.no + '</text>');
            s.push('<path d="M' + util.round(cx, 1) + ' 58V' + (H - 14) + '" stroke="' + C.bandLine + '" stroke-width="1.2" stroke-dasharray="3 5"/>');
        });

        /* 播放头：一条横扫全图的光线，跟着动画走完一轮正好回到第一步 */
        s.push('<g class="ar-playhead"><rect x="10" y="' + (y0 - 6) + '" width="' + (W - 20) + '" height="2" rx="1" fill="' + f.hue + '" fill-opacity=".55"/></g>');

        f.steps.forEach(function (st, i) {
            var y = y0 + i * rowH + 22;
            var a = lane[st.from], b = lane[st.to];
            var hue = (KIND[st.kind] || {}).hue || st.hue;
            var mid = marker[hue];
            var on = !v.play && Number(v.step) === st.seq;
            var done = !v.play && Number(v.step) > st.seq;
            var rowCls = 'ar-row' + (on ? ' on' : '') + (done ? ' done' : '');
            s.push('<g class="' + rowCls + '" data-act="arch:step" data-arg="' + st.seq + '">');
            s.push('<rect class="ar-rowbg" x="10" y="' + (y0 + i * rowH) + '" width="' + (W - 20) + '" height="' + rowH + '" rx="8" fill="' + hue + '"/>');
            s.push('<text class="ar-seqno" x="16" y="' + (y + 4) + '" fill="' + (on ? hue : C.faint) + '">' + (st.seq < 10 ? '0' + st.seq : st.seq) + '</text>');
            s.push('<g class="ar-step-g" style="--i:' + i + '">');
            var label = fit(st.api, Math.max(90, Math.abs(b - a) - 16), 10);
            if (st.kind === 'self' || a === b) {
                var lx = a + 12;
                s.push('<path d="M' + util.round(a, 1) + ' ' + (y - 8) + 'H' + util.round(lx + 46, 1) + 'V' + (y + 8) + 'H' + util.round(a + 4, 1) +
                    '" fill="none" stroke="' + hue + '" stroke-width="1.6" marker-end="url(#' + mid + ')"/>');
                s.push('<text class="ar-api" x="' + util.round(lx + 54, 1) + '" y="' + (y - 10) + '" fill="' + C.ink + '">' + esc(label) + '</text>');
                s.push('<text class="ar-pay" x="' + util.round(lx + 54, 1) + '" y="' + (y + 22) + '" fill="' + C.faint + '">' + esc(fit(st.payload, W - lx - 80, 8.5)) + '</text>');
            } else {
                var dir = b > a ? 1 : -1;
                var sx = a + dir * 3, ex = b - dir * 5;
                var dash = st.kind === 'sync' ? '' : ' stroke-dasharray="6 4"';
                s.push('<path d="M' + util.round(sx, 1) + ' ' + y + 'H' + util.round(ex, 1) + '" fill="none" stroke="' + hue +
                    '" stroke-width="1.7"' + dash + ' marker-end="url(#' + mid + ')"/>');
                var tx = Math.min(a, b) + Math.abs(b - a) / 2;
                s.push('<text class="ar-api" x="' + util.round(tx, 1) + '" y="' + (y - 7) + '" text-anchor="middle" fill="' + C.ink + '">' + esc(label) + '</text>');
                s.push('<text class="ar-pay" x="' + util.round(tx, 1) + '" y="' + (y + 15) + '" text-anchor="middle" fill="' + C.faint + '">' +
                    esc(fit(st.payload, Math.abs(b - a) - 10, 8.5)) + '</text>');
            }
            s.push('<circle class="ar-lifeline-dot" cx="' + util.round(a, 1) + '" cy="' + y + '" r="3.4" fill="' + hue + '" fill-opacity=".55"/>');
            s.push('</g>');
            s.push('<title>' + esc(st.seq + '. ' + st.fromName + ' → ' + st.toName + ' · ' + st.api + ' — ' + st.note) + '</title>');
            s.push('</g>');
        });
        s.push('</svg>');
        return s.join('');
    }

    /* ---------- 控件区 ---------- */

    function toggle(label, key, hint) {
        var v = view();
        return '<label class="ar-ctl' + (v[key] ? ' on' : '') + '">' +
            '<button type="button" class="ar-switch" data-act="arch:' + key + '" role="switch" aria-checked="' + (!!v[key]) + '" aria-label="' + esc(label) + '"><i></i></button>' +
            '<span class="ar-ctl-name">' + esc(label) + '</span>' +
            (hint ? '<span class="ar-ctl-hint">' + esc(hint) + '</span>' : '') + '</label>';
    }

    function slider(label, key, min, max, step, unit) {
        var v = view();
        return '<div class="ar-ctl slider">' +
            '<div class="ar-ctl-line"><span class="ar-ctl-name">' + esc(label) + '</span>' +
            '<b class="ar-ctl-val" data-arch-out="' + key + '">' + esc(v[key]) + esc(unit || '') + '</b></div>' +
            '<input type="range" class="ar-range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + esc(v[key]) +
            '" data-arch-live="' + key + '" data-change="arch:' + key + '" data-arg="" aria-label="' + esc(label) + '">' +
            '</div>';
    }

    function selectCtl(label, act, value, options) {
        return '<div class="ar-ctl">' +
            '<span class="ar-ctl-name">' + esc(label) + '</span>' +
            '<select class="tms-select ar-select" data-change="' + esc(act) + '" aria-label="' + esc(label) + '">' +
            ui.optionsHtml(options, value) + '</select></div>';
    }

    function controls() {
        var v = view();
        var svcOpts = [{ value: '', label: '不聚焦（看全图）' }].concat(arch.services().map(function (s) {
            return { value: s.id, label: s.no + ' · ' + s.name };
        }));
        return '<aside class="ar-controls" aria-label="架构图控制台">' +
            '<header class="ar-controls-head"><b>图纸控制台</b><span>十二个旋钮，即时生效</span></header>' +
            '<div class="ar-controls-body">' +
            selectCtl('连线过滤', 'arch:lines', v.lines, [
                { value: 'all', label: '全部（同步 + 异步 + 调度）' },
                { value: 'sync', label: '仅同步调用' },
                { value: 'async', label: '仅事件 / 调度 / 只读' }
            ]) +
            selectCtl('聚焦服务', 'arch:focus', v.focus, svcOpts) +
            selectCtl('图纸底色', 'arch:theme', v.theme, [
                { value: 'dark', label: '深色蓝图' }, { value: 'light', label: '浅色工程图' }
            ]) +
            '<div class="ar-ctl-sep">动画与标注</div>' +
            toggle('数据流动画', 'anim', '光带沿调用方向跑') +
            toggle('节点指标', 'metrics', '表 / 页 / 接口 / 行数') +
            toggle('分层参考网格', 'grid', '26px 蓝图网格') +
            toggle('光带辉光', 'glow', '异步链路更醒目') +
            '<div class="ar-ctl-sep">尺度</div>' +
            slider('流速', 'speed', 0.4, 2.5, 0.1, '×') +
            slider('画布缩放', 'zoom', 0.8, 1.8, 0.05, '×') +
            '<div class="ar-ctl-sep">输出</div>' +
            '<div class="ar-ctl-btns">' +
            ui.btn('重置视图', { size: 'sm', act: 'arch:reset', icon: '⟲', block: true }) +
            ui.btn('导出 SVG', { size: 'sm', tone: 'primary', act: 'arch:svg', icon: '⤓', block: true }) +
            ui.btn('导出服务目录', { size: 'sm', act: 'arch:csv', icon: '▤', block: true }) +
            '</div>' +
            '<p class="ar-ctl-note">点节点看服务契约；拖滑块即时改图，导出的 SVG 就是眼前这一张。</p>' +
            '</div></aside>';
    }

    /* ---------- 抽屉与弹窗 ---------- */

    function apiTable(apis) {
        return ui.table({
            dense: true, zebra: true,
            columns: [
                { key: 'm', label: '方法', width: 74, render: function (r) { return methodBadge(r.m); } },
                { key: 'p', label: '接口 / 任务', render: function (r) { return '<span class="tms-mono">' + esc(r.p) + '</span>'; } },
                { key: 'd', label: '说明', render: function (r) { return esc(r.d); } },
                { key: 'kind', label: '形态', width: 92, render: function (r) { return kindBadge(r.kind); } }
            ],
            rows: apis || [], emptyText: '该服务不对外暴露接口'
        });
    }

    function bullets(items, tone) {
        return '<ul class="ar-bullets' + (tone ? ' ' + tone : '') + '">' + (items || []).map(function (x) {
            return '<li>' + esc(x) + '</li>';
        }).join('') + '</ul>';
    }

    function coverageCell(c) {
        var total = c.modules.length + c.pages.length + c.apis.length + c.collections.length;
        var missing = c.missingModules.length + c.missingPages.length + c.missingApis.length + c.missingCollections.length;
        var ok = total - missing;
        return ui.progress(total ? ok / total * 100 : 100, { thin: true, tone: missing ? 'danger' : 'success' }) +
            '<span class="ar-covnum">' + ok + '/' + total + (missing ? ' <b class="ar-bad">缺 ' + missing + '</b>' : '') + '</span>';
    }

    function serviceBody(s) {
        var c = arch.coverage(s.id), nb = arch.neighbors(s.id);
        var impl = s.impl || {};
        var blocks = [];
        blocks.push(ui.notice(esc(s.mission), 'info', '职责边界一句话'));
        blocks.push(ui.card({
            title: '承担职责', flat: true, sub: c.dutyCount + ' 条',
            body: bullets(s.duty)
        }));
        blocks.push(ui.card({
            title: '明确不做', flat: true, tone: 'warn',
            body: bullets(s.boundary, 'warn')
        }));
        blocks.push(ui.card({
            title: '接口契约', flat: true, sub: c.apiCount + ' 个入口',
            body: apiTable(s.apis)
        }));
        blocks.push(ui.card({
            title: '数据所有权', flat: true, sub: '唯一写入者 · ' + c.collections.length + ' 张表 · ' + fmt.number(c.rows) + ' 行',
            body: c.collections.length
                ? '<div class="ar-chips">' + c.collections.map(function (n) {
                    return ui.chip(esc(db.meta(n).label || n) + ' <b class="tms-dim">' + fmt.number(db.col(n).length) + '</b>', { act: 'arch:table', arg: n });
                }).join('') + '</div>'
                : ui.empty('不拥有业务主表', s.id === 'bff' ? '聚合层只编排，不落自己的库' : '只读投影，索引可随时重建', '○')
        }));
        blocks.push(ui.card({
            title: '依赖与被依赖', flat: true,
            body: ui.desc([
                { label: '同步依赖（下游）', value: nb.down.length ? nb.down.map(function (x) { return svcTag(x); }).join(' ') : '<span class="tms-dim">无下游，可独立部署</span>' },
                { label: '被依赖（上游）', value: nb.up.length ? nb.up.map(function (x) { return svcTag(x); }).join(' ') : '<span class="tms-dim">无上游同步调用</span>' }
            ])
        }));
        if ((s.events || []).length) {
            blocks.push(ui.card({
                title: '事件契约', flat: true, sub: c.eventCount + ' 条 · 按单号分区保顺序',
                body: ui.table({
                    dense: true,
                    columns: [
                        { key: 'dir', label: '方向', width: 64, render: function (r) { return ui.badge(r.dir === 'out' ? '发布' : '订阅', r.dir === 'out' ? 'accent' : 'info'); } },
                        { key: 'name', label: '事件', render: function (r) { return '<span class="tms-mono">' + esc(r.name) + '</span>'; } },
                        { key: 'peer', label: '对端', width: 120, render: function (r) { return esc(r.peer); } },
                        { key: 'd', label: '载荷与用途', render: function (r) { return esc(r.d); } }
                    ],
                    rows: s.events
                })
            }));
        }
        blocks.push(ui.card({
            title: '当前工程落地', flat: true, sub: '映射逐项核对，对不上当场标红',
            body: ui.stack([
                coverageCell(c),
                ui.desc([
                    { label: '模块', value: c.modules.length ? c.modules.map(function (m) { return '<code>' + esc(m) + '</code>'; }).join('<br>') : '<span class="tms-dim">—</span>' },
                    { label: '领域接口', value: c.apis.length ? c.apis.map(function (a) { return '<code>' + esc(a) + '</code>'; }).join('<br>') : '<span class="tms-dim">—</span>' },
                    { label: '落地页面', value: c.pages.length ? c.pages.map(function (p) { return ui.link(esc((pg.get(p) || {}).title || p), 'arch:goto', p); }).join(' ') : '<span class="tms-dim">—</span>' },
                    { label: '一致性', value: esc(s.consistency) },
                    { label: '容量与性能', value: esc(s.capacity) }
                ]),
                impl.note ? ui.notice(esc(impl.note), 'info', '演示态说明') : '',
                (c.missingModules.length + c.missingPages.length + c.missingApis.length + c.missingCollections.length)
                    ? ui.notice('漂移项：' + esc([].concat(c.missingModules, c.missingApis, c.missingPages, c.missingCollections).join('、')), 'danger', '映射与当前工程不一致')
                    : ''
            ])
        }));
        return ui.stack(blocks);
    }

    function serviceDrawer(id) {
        var s = arch.service(id);
        if (!s) { ui.toast('服务目录里没有「' + id + '」', 'warn'); return; }
        ui.drawer({
            title: '<span class="ar-drawer-title" style="--h:' + esc(s.hue) + '"><i>' + esc(s.icon) + '</i>' + esc(s.no + ' · ' + s.name) + '</span>',
            sub: esc(s.en) + ' · ' + esc(s.tag) + ' · ' + esc((LAYER_NAME[s.layer] || {}).name || s.layer),
            body: serviceBody(s),
            footer: ui.btn('关闭', { act: 'ui:close' }) +
                ui.btn('在拓扑中聚焦', { act: 'arch:focus', arg: s.id, tone: 'primary', icon: '⌖' }) +
                ui.btn('看调用链路', { act: 'arch:flowsof', arg: s.id, icon: '⇄' })
        });
    }

    function tableModal(name) {
        var row = null;
        arch.matrix().forEach(function (r) { if (r.name === name) row = r; });
        if (!row) { ui.toast('集合「' + name + '」不在数据字典里', 'warn'); return; }
        var owner = arch.service(row.owner);
        var readers = row.readers.map(arch.service).filter(Boolean);
        ui.modal({
            title: esc(row.label) + ' <code class="tms-dim">' + esc(row.name) + '</code>',
            size: 'wide',
            sub: '单一写入者原则 · 前缀 ' + esc(row.prefix || '—') + ' · 当前 ' + fmt.number(row.rows) + ' 行',
            body: ui.stack([
                ui.kpis([
                    { label: '唯一写入者', value: owner ? esc(owner.name) : '未归属', tone: owner ? 'brand' : 'danger', icon: '✎' },
                    { label: '只读方', value: readers.length, unit: '个', tone: 'info', icon: '⌕' },
                    { label: '当前行数', value: fmt.number(row.rows), tone: 'muted', icon: '▤' },
                    { label: '归档策略', value: row.trim ? row.trim + ' 天' : '不裁剪', tone: row.trim ? 'warn' : 'success', icon: '⧗', sub: row.trim ? '超窗口按天裁剪流水' : '主数据长期保留' }
                ]),
                ui.card({
                    title: '读写边界', flat: true,
                    body: ui.desc([
                        { label: '写入路径', value: owner ? svcTag(owner) + ' <span class="tms-dim">其余服务不得直接写这张表</span>' : '<span class="ar-bad">无主表，必须补归属</span>' },
                        { label: '只读 / 订阅方', value: readers.length ? readers.map(function (x) { return svcTag(x); }).join(' ') : '<span class="tms-dim">暂无跨服务读取</span>' },
                        { label: '跨服务取数方式', value: '同步接口取事实，或订阅事件建本地投影；不共享库、不跨库 JOIN' }
                    ])
                }),
                owner ? ui.card({ title: '写入者职责', flat: true, body: bullets(owner.duty.slice(0, 3)) }) : ''
            ]),
            footer: ui.btn('关闭', { act: 'ui:close' }) + (owner ? ui.btn('看 ' + owner.name, { act: 'arch:open', arg: owner.id, tone: 'primary' }) : '')
        });
    }

    function jobModal(key) {
        var job = null;
        arch.jobPlan().forEach(function (j) { if (j.key === key) job = j; });
        if (!job) { ui.toast('调度清单里没有「' + key + '」', 'warn'); return; }
        var targets = String(job.target || '').split('/').map(function (x) { return x.trim(); }).map(arch.service).filter(Boolean);
        ui.modal({
            title: esc(job.name),
            sub: '<code>' + esc(job.handler) + '</code> · XXL-Job 执行器',
            body: ui.stack([
                ui.desc([
                    { label: 'cron', value: '<code>' + esc(job.cron || '未登记') + '</code>' },
                    { label: '目标服务', value: targets.length ? targets.map(function (s) { return svcTag(s); }).join(' ') : esc(job.target) },
                    { label: '巡检口径', value: esc(job.note) },
                    { label: '幂等与重试', value: '按业务键去重，命中累计 hitCount；条件消除自动核销，失败重试 3 次' },
                    { label: '落地函数', value: '<code>TMS.jobs.run(\'' + esc(job.key) + '\')</code> / <code>TMS.jobs.sweep()</code>' }
                ]),
                ui.notice('业务服务里不挂 crontab：所有定时触发统一由调度中心下发，执行器无状态可扩容。', 'info', '为什么独立成服务')
            ]),
            footer: ui.btn('关闭', { act: 'ui:close' }) + ui.btn('跑一轮巡检', {
                act: 'arch:sweep', tone: 'primary', icon: '⟳'
            })
        });
    }

    /* ---------- 各页签 ---------- */

    function healthNotices(st) {
        var cycle = arch.syncCycle();
        var missing = 0;
        arch.services().forEach(function (s) {
            var c = arch.coverage(s.id);
            missing += c.missingModules.length + c.missingPages.length + c.missingApis.length + c.missingCollections.length;
        });
        return ui.row([
            cycle.length
                ? ui.notice('同步依赖成环：' + esc(cycle.join(' → ')) + '，必须用事件解环', 'danger', '拆分校验失败')
                : ui.notice('十个服务的同步依赖构成有向无环图，故障不会沿环传染', 'success', '同步依赖无环'),
            st.orphan.length
                ? ui.notice('无主表：' + esc(st.orphan.join('、')), 'danger', '写入者缺失')
                : ui.notice(st.collections + ' 张集合各有唯一写入者，已归属 ' + st.owned + ' 张', 'success', '单一写入者'),
            missing
                ? ui.notice(missing + ' 处落地映射与当前工程不一致，详见服务清单', 'warn', '文档漂移')
                : ui.notice('目录里登记的模块 / 接口 / 页面 / 集合全部在当前工程里存在', 'success', '落地映射核对通过')
        ], 'ar-health');
    }

    function tabTopo(ctx, d) {
        var v = view(), st = d.stats;
        var kpi = ui.kpis([
            { label: '服务总数', value: st.services, unit: '个', tone: 'brand', icon: '⬢', sub: '领域服务 ' + st.domainServices + ' 个' },
            { label: '架构分层', value: st.layers, unit: '层', tone: 'info', icon: '⛩', sub: '接入 / 聚合 / 领域 / 支撑 / 基础设施' },
            { label: '数据集合', value: st.collections, unit: '张', tone: 'accent', icon: '⛁', sub: '已归属 ' + st.owned + ' · 无主 ' + st.orphan.length },
            { label: '对外接口', value: st.apis, unit: '个', tone: 'success', icon: '⇄', sub: '同步 / 事件 / 调度三类形态' },
            { label: '调用链路', value: st.flows, unit: '条', tone: 'warn', icon: '◈', sub: st.steps + ' 步 · 异步 ' + st.asyncSteps + ' 步' },
            { label: '定时任务', value: st.jobs, unit: '项', tone: 'muted', icon: '⧗', sub: 'XXL-Job 统一调度' },
            { label: '落地页面', value: st.registeredPages, unit: '页', tone: 'info', icon: '▦', sub: '六端菜单 ' + st.pages + ' 项' },
            { label: '领域模块', value: st.domainModules, unit: '个', tone: 'brand', icon: '⚙', sub: '全量模块 ' + st.modules + ' 个 · schema ' + st.schema }
        ]);

        var t = arch.topology({ lines: v.lines });
        var legend = '<div class="ar-legend">' + [
            { k: 'sync', n: t.counts.sync }, { k: 'event', n: t.counts.event },
            { k: 'job', n: t.counts.job }, { k: 'read', n: t.counts.read }
        ].map(function (x) {
            return '<span class="ar-legend-item"><i style="background:' + KIND[x.k].hue + '"></i>' + KIND[x.k].label + ' <b>' + x.n + '</b></span>';
        }).join('') + '<span class="ar-legend-item ar-legend-hint">点节点看契约 · 滚轮区可横向拖动</span></div>';

        /* 聚焦态必须一眼可辨、一键可退：否则访客只看到几张线淡了，不知道自己在哪 */
        var focusSvc = v.focus ? arch.service(v.focus) : null;
        var focusBar = '';
        if (focusSvc) {
            var linked = Object.keys(nearMap(t, focusSvc.id)).length - 1;
            focusBar = '<div class="ar-focus-bar" style="--h:' + esc(focusSvc.hue) + '">' +
                '<i class="ar-focus-dot"></i>' +
                '<b>聚焦 · ' + esc(focusSvc.no + ' ' + focusSvc.name) + '</b>' +
                '<span class="ar-focus-sub">高亮 ' + linked + ' 个直接相连服务（同步 / 事件 / 调度 / 只读），无关连线已淡出</span>' +
                '<span class="ar-focus-acts">' +
                ui.btn('看服务契约', { size: 'sm', act: 'arch:open', arg: focusSvc.id }) +
                ui.btn('退出聚焦', { size: 'sm', tone: 'primary', act: 'arch:focus', arg: '', icon: '✕' }) +
                '</span></div>';
        }

        var stage = '<div class="ar-stage">' +
            '<div class="ar-canvas-wrap" style="--arch-zoom:' + esc(v.zoom) + '">' +
            '<div class="ar-canvas" data-arch-canvas>' + topoSvg(v) + '</div></div>' +
            controls() + '</div>';

        var layerCards = arch.layers().map(function (l) {
            return ui.card({
                title: '<span class="ar-layer-title" style="--h:' + esc(l.hue) + '"><i>' + esc(l.icon) + '</i>' + esc(l.no + ' ' + l.name) + '</span>',
                sub: esc(l.sub), flat: true, className: 'ar-layer-card',
                body: ui.stack([
                    '<div class="ar-chips">' + (l.services.length ? l.services.map(function (s) {
                        return ui.chip(esc(s.no + ' ' + s.name), { act: 'arch:open', arg: s.id });
                    }).join('') : '<span class="tms-dim">本层不含业务服务</span>') + '</div>',
                    ui.desc([
                        { label: '职责', value: esc(l.duty) },
                        { label: '禁止', value: '<span class="ar-forbid">' + esc(l.forbid) + '</span>' }
                    ])
                ], 'sm')
            });
        });

        return ui.stack([
            kpi,
            healthNotices(st),
            ui.card({
                title: '服务拓扑总图', sub: '十服务 · 五层 · ' + (t.counts.sync + t.counts.event + t.counts.job + t.counts.read) + ' 条调用关系',
                flat: true, className: 'ar-topo-card', tools: legend, body: focusBar + stage
            }),
            ui.card({ title: '分层职责与禁区', sub: '每一层能做什么、绝不能做什么', flat: true, body: '<div class="ar-layers">' + layerCards.join('') + '</div>' }),
            ui.split('2', [
                ui.card({
                    title: '接入终端', sub: '端有多少个，BFF 就有多少个', flat: true,
                    body: ui.list(arch.clients().map(function (c) {
                        return { title: esc(c.name), sub: esc(c.sub), left: '<span class="ar-glyph">▣</span>' };
                    }))
                }),
                ui.card({
                    title: '八条设计原则', sub: '拆分之后最容易回退的八件事', flat: true,
                    body: '<div class="ar-principles">' + arch.principles().slice(0, 8).map(function (p) {
                        return '<div class="ar-principle tone-' + esc(p.tone) + '"><b>' + p.no + '</b><div><strong>' + esc(p.name) + '</strong><p>' + esc(p.text) + '</p></div></div>';
                    }).join('') + '</div>'
                })
            ])
        ]);
    }

    function serviceRows() {
        return arch.services().map(function (s) {
            var c = arch.coverage(s.id);
            var missing = c.missingModules.length + c.missingPages.length + c.missingApis.length + c.missingCollections.length;
            return {
                id: s.id, no: s.no, name: s.name, en: s.en, layer: s.layer, hue: s.hue, icon: s.icon,
                tag: s.tag, mission: s.mission, duty: (s.duty || []).join(' '),
                apis: c.apiCount, events: c.eventCount, tables: c.collections.length, rows: c.rows,
                pages: c.pages.length, modules: c.modules.length, deps: (s.deps || []).length,
                missing: missing, dutyCount: c.dutyCount
            };
        });
    }

    function tabServices(ctx) {
        var rows = serviceRows();
        var own = arch.ownership();
        var chips = [{ label: '全部', value: '', count: rows.length }].concat(arch.layers().filter(function (l) {
            return l.count;
        }).map(function (l) { return { label: l.name, value: l.id, count: l.count }; }));
        return ui.stack([
            ui.split('2', [
                ui.card({
                    title: '服务规模对比', sub: '接口数与事件数：谁在承担复杂度', flat: true,
                    body: ch.hbars({
                        data: rows.map(function (r) { return { label: r.no + ' ' + r.name, value: r.apis }; }),
                        rowH: 24, labelWidth: 132, valueWidth: 46
                    })
                }),
                ui.card({
                    title: '数据归属分布', sub: '每张表只有一个写入者', flat: true,
                    body: ch.hbars({
                        data: own.filter(function (o) { return o.tables; }).map(function (o) { return { label: o.name, value: o.tables }; }),
                        rowH: 24, labelWidth: 132, valueWidth: 46,
                        fmt: function (v) { return v + ' 张'; }
                    })
                })
            ]),
            pg.grid({
                title: '服务目录', sub: '点任意一行展开完整契约：职责 / 禁区 / 接口 / 数据 / 事件 / 落地映射',
                stateKey: PAGE + ':services',
                rows: rows, keyName: 'id', onRow: 'arch:open', unit: '个服务',
                chips: chips, chipsName: 'layer', pageSize: 12,
                search: function (r) { return [r.name, r.en, r.mission, r.tag, r.duty, r.id].join(' '); },
                searchLabel: '搜索服务 / 职责 / 接口关键字',
                fields: [{ key: 'q', type: 'search', label: '关键字', placeholder: '如：计费、围栏、幂等、XXL-Job' }],
                filter: function (r, fs) { return !fs.layer || r.layer === fs.layer; },
                valueOf: function (r, k) { return r[k]; },
                columns: [
                    { key: 'no', label: '#', width: 52, sortable: true, render: function (r) { return ui.rank(r.no); } },
                    {
                        key: 'name', label: '服务', sortable: true, render: function (r) {
                            return '<span class="ar-svcname" style="--h:' + esc(r.hue) + '">' + hueDot(r.hue) + '<b>' + esc(r.name) + '</b></span>' +
                                '<div class="tms-sub tms-mono">' + esc(r.en) + '</div>';
                        }
                    },
                    { key: 'layer', label: '分层', width: 104, render: function (r) { return layerBadge(r.layer); } },
                    { key: 'mission', label: '职责', render: function (r) { return esc(r.mission) + '<div class="tms-sub">' + esc(r.tag) + '</div>'; } },
                    { key: 'apis', label: '接口', width: 66, align: 'right', sortable: true },
                    { key: 'events', label: '事件', width: 66, align: 'right', sortable: true },
                    { key: 'tables', label: '拥有表', width: 78, align: 'right', sortable: true, render: function (r) { return r.tables ? r.tables + ' 张' : '<span class="tms-dim">0</span>'; } },
                    { key: 'rows', label: '数据行', width: 92, align: 'right', sortable: true, render: function (r) { return fmt.number(r.rows); } },
                    {
                        key: 'missing', label: '落地核对', width: 132, sortable: true, render: function (r) {
                            return coverageCell(arch.coverage(r.id));
                        }
                    },
                    { key: 'op', label: '', width: 70, render: function (r) { return ui.link('契约', 'arch:open', r.id, { icon: '→' }); } }
                ],
                tools: ui.btn('导出目录 CSV', { size: 'sm', act: 'arch:csv', icon: '⤓' }),
                emptyText: '没有匹配的服务', emptySub: '换个关键字，或把分层标签切回「全部」'
            })
        ]);
    }

    function tabFlows(ctx) {
        var v = view();
        var list = arch.flows();
        var st = ui.state(PAGE);
        var fid = st.seg || list[0].id;
        var f = arch.flow(fid);
        if (!f) { f = list[0]; fid = f.id; }
        var step = f.steps.filter(function (x) { return x.seq === Number(v.step); })[0] || f.steps[0];
        var seg = ui.seg(list.map(function (x) { return { value: x.id, label: x.no + ' ' + x.name }; }), fid);
        var broken = f.steps.filter(function (x) { return x.missing; }).length;

        var player = '<div class="ar-player">' +
            ui.btn(v.play ? '暂停' : '播放', { size: 'sm', tone: v.play ? 'warn' : 'primary', act: 'arch:play', icon: v.play ? '❚❚' : '▶' }) +
            ui.iconBtn('←', 'arch:prev', '上一步') +
            '<span class="ar-player-step">第 <b>' + step.seq + '</b> / ' + f.steps.length + ' 步</span>' +
            ui.iconBtn('→', 'arch:next', '下一步') +
            ui.btn('回到第一步', { size: 'sm', act: 'arch:step', arg: '1', icon: '⟲' }) +
            '<span class="ar-player-speed">流速</span>' +
            '<input type="range" class="ar-range inline" min="0.4" max="2.5" step="0.1" value="' + esc(v.speed) +
            '" data-arch-live="speed" data-change="arch:speed" aria-label="流速">' +
            '<b class="ar-ctl-val" data-arch-out="speed">' + esc(v.speed) + '×</b>' +
            '<span class="ar-player-sla">' + ui.badge(esc(f.sla), 'info') + '</span>' +
            '</div>';

        var detail = ui.card({
            title: '第 ' + step.seq + ' 步 · ' + esc(step.api), flat: true, className: 'ar-step-card',
            sub: esc(step.fromName) + ' → ' + esc(step.toName),
            tools: kindBadge(step.kind),
            body: ui.desc([
                { label: '调用方', value: svcTag(arch.service(step.from) || { id: step.from, name: step.fromName, hue: '#9aa7bd' }) },
                { label: '被调方', value: step.from === step.to ? '<span class="tms-dim">服务内本地事务</span>' : svcTag(arch.service(step.to) || { id: step.to, name: step.toName, hue: '#9aa7bd' }) },
                { label: '载荷', value: '<code>' + esc(step.payload) + '</code>' },
                { label: '设计要点', value: esc(step.note) }
            ])
        });

        return ui.stack([
            ui.card({
                title: '六条端到端链路', sub: '从下单到月结，每一跳都标了调用形态、载荷与幂等要点', flat: true,
                body: ui.stack([seg, '<div class="ar-flow-meta">' +
                    ui.kv('触发', esc(f.trigger)) + ui.kv('结果', esc(f.outcome)) + ui.kv('参与服务', f.participants.length + ' 个') +
                    ui.kv('步骤', f.steps.length + ' 步（同步 ' + f.steps.filter(function (x) { return x.kind === 'sync'; }).length +
                        ' / 事件 ' + f.steps.filter(function (x) { return x.kind === 'event'; }).length +
                        ' / 调度 ' + f.steps.filter(function (x) { return x.kind === 'job'; }).length +
                        ' / 本地 ' + f.steps.filter(function (x) { return x.kind === 'self'; }).length + '）') +
                    '</div>', player,
                    broken ? ui.notice(broken + ' 步指向了目录外的服务', 'danger') : '',
                    '<div class="ar-canvas-wrap seq" style="--arch-zoom:1"><div class="ar-canvas" data-arch-canvas>' + flowSvg(f, v) + '</div></div>'
                ])
            }),
            ui.split('side', [
                ui.card({
                    title: '逐步说明', sub: '点时序图任意一行即可定位到该步', flat: true,
                    body: ui.list(f.steps.map(function (x) {
                        return {
                            title: '<b class="ar-stepno">' + (x.seq < 10 ? '0' + x.seq : x.seq) + '</b> ' + esc(x.api) +
                                ' <span class="tms-dim">' + esc(x.fromName) + ' → ' + esc(x.toName) + '</span>',
                            sub: esc(x.note),
                            act: 'arch:step', arg: String(x.seq),
                            left: '<span class="ar-kinddot" style="background:' + ((KIND[x.kind] || {}).hue || '#9aa7bd') + '"></span>',
                            right: kindBadge(x.kind)
                        };
                    }))
                }),
                ui.stack([detail, ui.card({
                    title: '参与服务', flat: true, sub: '按出场顺序',
                    body: '<div class="ar-chips">' + f.participants.map(function (p) {
                        return ui.chip(esc(p.no + ' ' + p.name), { act: 'arch:open', arg: p.id });
                    }).join('') + '</div>'
                })])
            ])
        ]);
    }

    function tabData(ctx) {
        var st = arch.stats(), rows = arch.matrix(), own = arch.ownership();
        var kpi = ui.kpis([
            { label: '数据集合', value: st.collections, unit: '张', tone: 'brand', icon: '⛁', sub: '全库 ' + fmt.number(st.rows) + ' 行' },
            { label: '已归属', value: st.owned, unit: '张', tone: st.orphan.length ? 'warn' : 'success', icon: '✎', sub: '无主 ' + st.orphan.length + ' 张' },
            { label: '设计原则', value: st.principles, unit: '条', tone: 'accent', icon: '⚖', sub: '一致性 / 幂等 / 口径单点' },
            { label: '同步依赖环', value: arch.syncCycle().length, unit: '处', tone: arch.syncCycle().length ? 'danger' : 'success', icon: '⟳', sub: '有环必须用事件解' }
        ]);
        return ui.stack([
            kpi,
            st.orphan.length ? ui.notice('未归属集合：' + esc(st.orphan.join('、')) + ' —— 必须指定唯一写入者', 'danger', '所有权缺口') : '',
            ui.split('side', [
                pg.grid({
                    title: '数据所有权矩阵', sub: '一张表一行：写入者唯一，只读方从事件与依赖推导',
                    stateKey: PAGE + ':matrix',
                    rows: rows, keyName: 'name', onRow: 'arch:table', unit: '张表', pageSize: 15,
                    sizeOptions: [15, 30, 50],
                    search: function (r) { return [r.name, r.label, r.ownerName, r.prefix].join(' '); },
                    fields: [{ key: 'q', type: 'search', label: '关键字', placeholder: '表名 / 中文名 / 写入者' }],
                    chips: [{ label: '全部', value: '', count: rows.length }].concat(own.filter(function (o) { return o.tables; }).map(function (o) {
                        return { label: o.name, value: o.id, count: o.tables };
                    })),
                    chipsName: 'owner',
                    filter: function (r, fs) { return !fs.owner || r.owner === fs.owner; },
                    columns: [
                        {
                            key: 'name', label: '集合', sortable: true, render: function (r) {
                                return '<b>' + esc(r.label) + '</b><div class="tms-sub tms-mono">' + esc(r.name) + '</div>';
                            }
                        },
                        { key: 'prefix', label: '主键前缀', width: 96, render: function (r) { return '<code>' + esc(r.prefix || '—') + '</code>'; } },
                        { key: 'rows', label: '行数', width: 90, align: 'right', sortable: true, render: function (r) { return fmt.number(r.rows); } },
                        {
                            key: 'owner', label: '唯一写入者', width: 168, sortable: true, render: function (r) {
                                var s = arch.service(r.owner);
                                return s ? svcTag(s) : '<span class="ar-bad">未归属</span>';
                            }
                        },
                        {
                            key: 'readers', label: '只读 / 订阅方', render: function (r) {
                                if (!r.readers.length) return '<span class="tms-dim">仅写入者自读</span>';
                                return '<span class="ar-readers">' + r.readers.map(function (id) {
                                    var s = arch.service(id);
                                    return s ? '<i style="background:' + esc(s.hue) + '" title="' + esc(s.name) + '"></i>' : '';
                                }).join('') + '</span> <span class="tms-dim">' + r.readers.length + ' 个</span>';
                            }
                        },
                        {
                            key: 'trim', label: '归档', width: 92, sortable: true, render: function (r) {
                                return r.trim ? ui.badge(r.trim + ' 天', 'warn') : ui.badge('长期保留', 'muted');
                            }
                        }
                    ],
                    emptyText: '没有匹配的集合', emptySub: '换个关键字或把写入者标签切回「全部」'
                }),
                ui.stack([
                    ui.card({
                        title: '写入者负载', sub: '表数与行数：谁该先拆出去', flat: true,
                        body: ch.hbars({
                            data: own.filter(function (o) { return o.rows; }).map(function (o) { return { label: o.name, value: o.rows }; }),
                            rowH: 24, labelWidth: 118, valueWidth: 66, fmt: function (v) { return fmt.number(v); }
                        })
                    }),
                    ui.card({
                        title: '一致性策略', sub: '每个服务自己说明怎么保一致', flat: true,
                        body: ui.list(arch.services().map(function (s) {
                            return {
                                title: svcTag(s), sub: esc(s.consistency), act: 'arch:open', arg: s.id,
                                left: '<span class="ar-kinddot" style="background:' + esc(s.hue) + '"></span>'
                            };
                        }))
                    })
                ])
            ]),
            ui.card({
                title: '八条设计原则', sub: '拆分之后最容易回退的八件事，逐条都是可校验的约束', flat: true,
                body: '<div class="ar-principles wide">' + arch.principles().map(function (p) {
                    return '<div class="ar-principle tone-' + esc(p.tone) + '"><b>' + p.no + '</b><div><strong>' + esc(p.name) + '</strong><p>' + esc(p.text) + '</p></div></div>';
                }).join('') + '</div>'
            })
        ]);
    }

    /* ---------- 分布式与运维 ---------- */

    function distCatName(id) {
        var name = id;
        arch.distCats().forEach(function (c) { if (c.id === id) name = c.name; });
        return name;
    }

    function distFocusBar(v) {
        var t = v.distFocus ? arch.distTech(v.distFocus) : null;
        if (!t) return '';
        return '<div class="ar-focus-bar" style="--h:' + esc(t.hue) + '">' +
            '<i class="ar-focus-dot"></i>' +
            '<b>聚焦 · ' + esc(t.no + ' ' + t.name) + '</b>' +
            '<span class="ar-focus-sub">' + esc(t.product) + ' —— 高亮 ' + t.services.length + ' 个覆盖服务并画出连线</span>' +
            '<span class="ar-focus-acts">' +
            ui.btn('看技术契约', { size: 'sm', act: 'arch:dist-tech', arg: t.id }) +
            ui.btn('退出聚焦', { size: 'sm', tone: 'primary', act: 'arch:dist-focus', arg: '', icon: '✕' }) +
            '</span></div>';
    }

    /* 全景控制台常驻图上方：与拓扑共用视图状态（底色/动画/流速/缩放），聚焦独立 */
    function distControls() {
        var v = view();
        var opts = [{ value: '', label: '不聚焦（看全景）' }].concat(arch.distributed().map(function (t) {
            return { value: t.id, label: t.no + ' · ' + t.name };
        }));
        return '<div class="ar-dist-controls" role="group" aria-label="全景图控制台">' +
            selectCtl('聚焦技术', 'arch:dist-focus', v.distFocus, opts) +
            selectCtl('图纸底色', 'arch:theme', v.theme, [
                { value: 'dark', label: '深色蓝图' }, { value: 'light', label: '浅色工程图' }
            ]) +
            toggle('数据流', 'anim') +
            toggle('网格', 'grid') +
            toggle('辉光', 'glow') +
            slider('流速', 'speed', 0.4, 2.5, 0.1, '×') +
            slider('缩放', 'zoom', 0.8, 1.8, 0.05, '×') +
            ui.btn('重置', { size: 'sm', act: 'arch:reset', icon: '⟲' }) +
            ui.btn('导出全景 SVG', { size: 'sm', tone: 'primary', act: 'arch:dist-svg', icon: '⤓' }) +
            '</div>';
    }

    /* 全景：上排五类十件，下排十个服务；聚焦才画覆盖连线，组件与服务永不压暗 */
    function distSvg(v) {
        var C = palette(v.theme);
        var cats = arch.distCats(), techs = arch.distributed(), svcs = arch.services();
        var W = 1180, H = 560;
        var focus = v.distFocus && arch.distTech(v.distFocus) ? arch.distTech(v.distFocus) : null;
        var bandW = (W - 32 - 4 * 10) / 5, chipW = (W - 32 - 24 - 9 * 8) / 10;
        var nodePos = {}, chipPos = {};
        cats.forEach(function (c, i) {
            var items = techs.filter(function (t) { return t.cat === c.id; });
            var totalH = items.length * 64 + (items.length - 1) * 10;
            var oy = 58 + (364 - totalH) / 2;
            items.forEach(function (t, j) {
                nodePos[t.id] = { x: util.round(16 + i * (bandW + 10) + 10, 1), y: util.round(oy + j * 74, 1), w: util.round(bandW - 20, 1), h: 64 };
            });
        });
        svcs.forEach(function (svc, i) {
            chipPos[svc.id] = { x: util.round(28 + i * (chipW + 8), 1), y: 478, w: util.round(chipW, 1), h: 52 };
        });
        var s = [];
        var cls = 'ar-svg' + (v.anim ? '' : ' no-anim') + (v.grid ? '' : ' no-grid');
        s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="' + cls +
            '" style="--arch-speed:' + esc(v.speed) + '" role="img" aria-label="分布式与运维技术全景">');
        s.push('<style>' + SVG_STYLE + '</style>');
        s.push('<defs>');
        s.push('<pattern id="arDGridP" width="26" height="26" patternUnits="userSpaceOnUse">' +
            '<path d="M26 0H0V26" fill="none" stroke="' + C.grid + '" stroke-width="1"/></pattern>');
        s.push('<filter id="arDGlowF" x="-70%" y="-70%" width="240%" height="240%">' +
            '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        if (focus) {
            s.push('<marker id="ar-dah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
                '<path d="M0 0L10 5L0 10z" fill="' + focus.hue + '"/></marker>');
        }
        s.push('</defs>');
        s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="14" fill="' + C.bg + '"/>');
        s.push('<rect class="ar-grid" x="0" y="0" width="' + W + '" height="' + H + '" rx="14" fill="url(#arDGridP)"/>');

        cats.forEach(function (c, i) {
            var bx = util.round(16 + i * (bandW + 10), 1);
            s.push('<rect x="' + bx + '" y="16" width="' + util.round(bandW, 1) + '" height="416" rx="11" fill="' + C.band +
                '" fill-opacity="' + (v.theme === 'light' ? '.78' : '.62') + '" stroke="' + C.bandLine + '" stroke-width="1"/>');
            s.push('<rect x="' + bx + '" y="16" width="' + util.round(bandW, 1) + '" height="3" rx="1.5" fill="' + c.hue + '"/>');
            s.push('<text class="ar-band-name" x="' + (bx + 12) + '" y="34" fill="' + c.hue + '">' + esc(c.icon + ' ' + c.name) + '</text>');
            s.push('<text class="ar-band-sub" x="' + util.round(bx + bandW - 12, 1) + '" y="34" text-anchor="end" fill="' + C.faint + '">' + c.count + ' 件</text>');
            s.push('<text class="ar-band-sub" x="' + (bx + 12) + '" y="48" fill="' + C.faint + '">' + esc(fit(c.sub, bandW - 24, 9)) + '</text>');
        });

        s.push('<rect x="16" y="448" width="1148" height="96" rx="11" fill="' + C.band +
            '" fill-opacity="' + (v.theme === 'light' ? '.78' : '.62') + '" stroke="' + C.bandLine + '" stroke-width="1"/>');
        s.push('<text class="ar-band-name" x="28" y="468" fill="' + C.dim + '">领域服务 · 十件套</text>');
        s.push('<text class="ar-band-sub" x="1152" y="468" text-anchor="end" fill="' + C.faint + '">' +
            (focus ? '已高亮 ' + focus.services.length + ' 个覆盖服务' : '聚焦任一组件看覆盖连线') + '</text>');

        var flows = [];
        if (focus) {
            var a = nodePos[focus.id];
            s.push('<g class="ar-edges">');
            focus.services.forEach(function (id, i) {
                var b = chipPos[id], svc = arch.service(id);
                if (!a || !b || !svc) return;
                var sx = util.round(a.x + a.w / 2, 1), sy = a.y + a.h;
                var ex = util.round(b.x + b.w / 2, 1), ey = b.y;
                var dy = Math.max(20, Math.min(52, (ey - sy) * 0.5));
                var p = 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + (sy + dy) + ', ' + ex + ' ' + (ey - dy) + ', ' + ex + ' ' + ey;
                s.push('<path d="' + p + '" fill="none" stroke="' + focus.hue + '" stroke-width="1.6" stroke-opacity=".55" stroke-dasharray="5 4" marker-end="url(#ar-dah)">' +
                    '<title>' + esc(focus.name + ' → ' + svc.name) + '</title></path>');
                flows.push('<path class="ar-flow" d="' + p + '" fill="none" stroke="' + focus.hue +
                    '" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="7 150" style="animation-delay:-' + util.round(i * 0.3, 2) + 's"/>');
            });
            s.push('</g>');
            s.push('<g class="ar-flows"' + (v.glow ? ' filter="url(#arDGlowF)"' : '') + '>' + flows.join('') + '</g>');
        }

        s.push('<g class="ar-nodes">');
        techs.forEach(function (t) {
            var p = nodePos[t.id], isF = focus && focus.id === t.id;
            s.push('<g class="ar-node' + (isF ? ' ar-focus' : '') + '" data-act="arch:dist-tech" data-arg="' + esc(t.id) + '" opacity="1">');
            s.push('<rect class="ar-box" x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="10" fill="' + C.node +
                '" stroke="' + t.hue + '" stroke-width="' + (isF ? 2.6 : 1.4) + '" stroke-opacity=".85"/>');
            s.push('<rect x="' + p.x + '" y="' + (p.y + 8) + '" width="3.5" height="' + (p.h - 16) + '" rx="1.8" fill="' + t.hue + '"/>');
            s.push('<circle class="ar-halo" cx="' + (p.x + 22) + '" cy="' + (p.y + 20) + '" r="12" fill="' + t.hue + '" fill-opacity=".16" stroke="' + t.hue + '" stroke-opacity=".45"/>');
            s.push('<text class="ar-no" x="' + (p.x + 22) + '" y="' + (p.y + 24) + '" text-anchor="middle" fill="' + t.hue + '">' + t.no + '</text>');
            s.push('<text class="ar-name" x="' + (p.x + 40) + '" y="' + (p.y + 20) + '" font-size="12.5" fill="' + C.ink + '">' + esc(fit(t.name, p.w - 52, 12.5)) + '</text>');
            s.push('<text class="ar-en" x="' + (p.x + 40) + '" y="' + (p.y + 33) + '" fill="' + C.faint + '">' + esc(fit(t.product, p.w - 52, 8.5)) + '</text>');
            s.push('<text class="ar-metric" x="' + (p.x + 12) + '" y="' + (p.y + 52) + '" fill="' + C.dim + '">' +
                esc(fit('覆盖 ' + t.services.length + ' 服务' + (t.tables.length ? ' · ' + t.tables.length + ' 表' : '') +
                    (t.flows.length ? ' · ' + t.flows.length + ' 链路' : ''), p.w - 24, 9)) + '</text>');
            s.push('<title>' + esc(t.no + ' ' + t.name + ' · ' + t.product + ' — ' + t.role) + '</title>');
            s.push('</g>');
        });
        s.push('</g>');

        s.push('<g class="ar-nodes">');
        svcs.forEach(function (svc) {
            var p = chipPos[svc.id];
            var hit = focus && focus.services.indexOf(svc.id) > -1;
            s.push('<g class="ar-node" data-act="arch:open" data-arg="' + esc(svc.id) + '" opacity="1">');
            s.push('<rect class="ar-box" x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="9" fill="' + C.bg +
                '" stroke="' + (hit ? svc.hue : C.bandLine) + '" stroke-width="' + (hit ? 2.2 : 1) + '"/>');
            s.push('<circle cx="' + (p.x + 14) + '" cy="' + (p.y + 17) + '" r="4" fill="' + svc.hue + '"/>');
            s.push('<text class="ar-chip-name" x="' + (p.x + 24) + '" y="' + (p.y + 21) + '" fill="' + C.ink + '">' + esc(fit(svc.no + ' ' + svc.name, p.w - 30, 10.5)) + '</text>');
            s.push('<text class="ar-chip-sub" x="' + (p.x + 14) + '" y="' + (p.y + 38) + '" fill="' + C.faint + '">' + esc(fit(svc.en, p.w - 24, 7.5)) + '</text>');
            s.push('<title>' + esc(svc.name + (hit ? ' — 被 ' + focus.name + ' 覆盖' : ' — 点看服务契约')) + '</title>');
            s.push('</g>');
        });
        s.push('</g>');
        s.push('</svg>');
        return s.join('');
    }

    /* CI/CD 八阶段：主链路顺跑，金丝雀挂一条回到仓库的回滚弧线 */
    function cicdSvg(v) {
        var C = palette(v.theme);
        var stages = arch.cicd();
        var W = 1180, H = 236, x0 = 20, gap = 12;
        var w = (W - 40 - 7 * gap) / 8, y = 78, h = 96;
        var s = [];
        var cls = 'ar-svg' + (v.anim ? '' : ' no-anim');
        s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="' + cls +
            '" style="--arch-speed:' + esc(v.speed) + '" role="img" aria-label="CI/CD 八阶段流水线">');
        s.push('<style>' + SVG_STYLE + '</style>');
        var hues = [], marker = {};
        stages.forEach(function (st) {
            if (marker[st.hue]) return;
            marker[st.hue] = 'ar-ca-' + hues.length;
            hues.push(st.hue);
        });
        s.push('<defs>');
        hues.forEach(function (h) {
            s.push('<marker id="' + marker[h] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
                '<path d="M0 0L10 5L0 10z" fill="' + h + '"/></marker>');
        });
        s.push('<marker id="ar-ca-rb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
            '<path d="M0 0L10 5L0 10z" fill="#ff6b6b"/></marker>');
        s.push('<filter id="arCGlowF" x="-70%" y="-70%" width="240%" height="240%">' +
            '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        s.push('</defs>');
        s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="14" fill="' + C.bg + '"/>');

        var flows = [];
        s.push('<g class="ar-edges">');
        for (var i = 0; i < stages.length - 1; i++) {
            var sx = util.round(x0 + i * (w + gap) + w + 2, 1), ex = util.round(x0 + (i + 1) * (w + gap) - 3, 1);
            var cy = y + h / 2;
            var p = 'M ' + sx + ' ' + cy + ' L ' + ex + ' ' + cy;
            s.push('<path d="' + p + '" fill="none" stroke="' + stages[i].hue + '" stroke-width="1.6" stroke-opacity=".6" marker-end="url(#' + marker[stages[i].hue] + ')"/>');
            flows.push('<path class="ar-flow" d="' + p + '" fill="none" stroke="' + stages[i].hue +
                '" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="6 150" style="animation-delay:-' + util.round(i * 0.35, 2) + 's"/>');
        }
        var cxCanary = util.round(x0 + 5 * (w + gap) + w / 2, 1), cxHarbor = util.round(x0 + 4 * (w + gap) + w / 2, 1);
        var rb = 'M ' + cxCanary + ' ' + y + ' C ' + cxCanary + ' 44, ' + cxHarbor + ' 44, ' + cxHarbor + ' ' + y;
        s.push('<path d="' + rb + '" fill="none" stroke="#ff6b6b" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ar-ca-rb)">' +
            '<title>金丝雀指标异常：自动回滚上一镜像 tag</title></path>');
        flows.push('<path class="ar-flow" d="' + rb + '" fill="none" stroke="#ff6b6b" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="6 150"/>');
        s.push('<text x="' + util.round((cxCanary + cxHarbor) / 2, 1) + '" y="42" text-anchor="middle" font-size="9" fill="#ff6b6b">指标异常 · 自动回滚 &lt; 2min</text>');
        s.push('</g>');
        s.push('<g class="ar-flows"' + (v.glow ? ' filter="url(#arCGlowF)"' : '') + '>' + flows.join('') + '</g>');

        s.push('<g class="ar-nodes">');
        stages.forEach(function (st, i) {
            var x = util.round(x0 + i * (w + gap), 1);
            s.push('<g class="ar-node" data-act="arch:dist-stage" data-arg="' + esc(st.id) + '" opacity="1">');
            s.push('<rect class="ar-box" x="' + x + '" y="' + y + '" width="' + util.round(w, 1) + '" height="' + h + '" rx="10" fill="' + C.node +
                '" stroke="' + st.hue + '" stroke-width="1.4" stroke-opacity=".85"/>');
            s.push('<circle class="ar-halo" cx="' + (x + 18) + '" cy="' + (y + 18) + '" r="11" fill="' + st.hue + '" fill-opacity=".16" stroke="' + st.hue + '" stroke-opacity=".45"/>');
            s.push('<text class="ar-no" x="' + (x + 18) + '" y="' + (y + 22) + '" text-anchor="middle" fill="' + st.hue + '">' + st.no + '</text>');
            s.push('<text class="ar-name" x="' + (x + 34) + '" y="' + (y + 22) + '" font-size="12" fill="' + C.ink + '">' + esc(fit(st.name, w - 42, 12)) + '</text>');
            s.push('<text class="ar-en" x="' + (x + 12) + '" y="' + (y + 44) + '" fill="' + C.faint + '">' + esc(fit(st.tool, w - 24, 8.5)) + '</text>');
            s.push('<text class="ar-tag" x="' + (x + 12) + '" y="' + (y + 62) + '" fill="' + st.hue + '">' + esc(fit(st.dur, w - 24, 9.5)) + '</text>');
            s.push('<text class="ar-metric" x="' + (x + 12) + '" y="' + (y + 80) + '" fill="' + C.dim + '">点看出口条件</text>');
            s.push('<title>' + esc(st.no + ' ' + st.name + ' · ' + st.tool + ' — ' + st.action) + '</title>');
            s.push('</g>');
        });
        s.push('</g>');
        s.push('<text x="' + (W / 2) + '" y="208" text-anchor="middle" font-size="9.5" fill="' + C.dim + '">' +
            '镜像 tag = git sha · 覆盖率门禁 ≥ 70% · 金丝雀 5% → 30% → 全量 · 发布窗口与月结互斥</text>');
        s.push('</svg>');
        return s.join('');
    }

    /* 负载均衡：五跳主链 + Nacos 在下方给 Feign 推名单、收实例心跳 */
    function lbSvg(v) {
        var C = palette(v.theme);
        var lb = arch.lbPath(), hops = lb.hops;
        var W = 1180, H = 300, x0 = 20, gap = 34;
        var w = (W - 40 - 4 * gap) / 5, y = 44, h = 104;
        var s = [];
        var cls = 'ar-svg' + (v.anim ? '' : ' no-anim');
        s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" class="' + cls +
            '" style="--arch-speed:' + esc(v.speed) + '" role="img" aria-label="负载均衡三级接力">');
        s.push('<style>' + SVG_STYLE + '</style>');
        var hues = [], marker = {};
        hops.concat([lb.registry]).forEach(function (hp) {
            if (marker[hp.hue]) return;
            marker[hp.hue] = 'ar-la-' + hues.length;
            hues.push(hp.hue);
        });
        s.push('<defs>');
        hues.forEach(function (h) {
            s.push('<marker id="' + marker[h] + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
                '<path d="M0 0L10 5L0 10z" fill="' + h + '"/></marker>');
        });
        s.push('<filter id="arLGlowF" x="-70%" y="-70%" width="240%" height="240%">' +
            '<feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>');
        s.push('</defs>');
        s.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="14" fill="' + C.bg + '"/>');

        var flows = [];
        s.push('<g class="ar-edges">');
        for (var i = 0; i < hops.length - 1; i++) {
            var sx = util.round(x0 + i * (w + gap) + w + 2, 1), ex = util.round(x0 + (i + 1) * (w + gap) - 3, 1);
            var cy = y + h / 2;
            var p = 'M ' + sx + ' ' + cy + ' L ' + ex + ' ' + cy;
            s.push('<path d="' + p + '" fill="none" stroke="' + hops[i].hue + '" stroke-width="1.8" stroke-opacity=".65" marker-end="url(#' + marker[hops[i].hue] + ')"/>');
            flows.push('<path class="ar-flow" d="' + p + '" fill="none" stroke="' + hops[i].hue +
                '" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="7 150" style="animation-delay:-' + util.round(i * 0.4, 2) + 's"/>');
        }
        var feignCx = util.round(x0 + 3 * (w + gap) + w / 2, 1), instCx = util.round(x0 + 4 * (w + gap) + w / 2, 1);
        var ry = 216, rh = 60, rw = 440, rx = util.round((feignCx + instCx) / 2 - rw / 2, 1);
        var up = 'M ' + feignCx + ' ' + ry + ' L ' + feignCx + ' ' + (y + h + 4);
        var down = 'M ' + instCx + ' ' + (y + h + 4) + ' L ' + instCx + ' ' + (ry - 4);
        s.push('<path d="' + up + '" fill="none" stroke="' + lb.registry.hue + '" stroke-width="1.5" stroke-dasharray="4 4" marker-end="url(#' + marker[lb.registry.hue] + ')">' +
            '<title>Nacos → OpenFeign：实例名单变更推送</title></path>');
        s.push('<path d="' + down + '" fill="none" stroke="' + lb.registry.hue + '" stroke-width="1.5" stroke-dasharray="4 4" marker-end="url(#' + marker[lb.registry.hue] + ')">' +
            '<title>服务实例 → Nacos：注册与心跳 5s</title></path>');
        flows.push('<path class="ar-flow" d="' + up + '" fill="none" stroke="' + lb.registry.hue + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="6 150"/>');
        flows.push('<path class="ar-flow" d="' + down + '" fill="none" stroke="' + lb.registry.hue + '" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="6 150" style="animation-delay:-.5s"/>');
        s.push('<text x="' + (feignCx + 8) + '" y="186" font-size="8.5" fill="' + lb.registry.hue + '">名单推送</text>');
        s.push('<text x="' + (instCx + 8) + '" y="186" font-size="8.5" fill="' + lb.registry.hue + '">注册 · 心跳 5s</text>');
        s.push('</g>');
        s.push('<g class="ar-flows"' + (v.glow ? ' filter="url(#arLGlowF)"' : '') + '>' + flows.join('') + '</g>');

        s.push('<g class="ar-nodes">');
        hops.forEach(function (hp, i) {
            var x = util.round(x0 + i * (w + gap), 1);
            var policy = hp.policy || '统一入口 · HTTPS', detail = hp.detail || 'DNS → keepalived VIP';
            s.push('<g class="ar-node" data-act="arch:dist-tech" data-arg="lb" opacity="1">');
            s.push('<rect class="ar-box" x="' + x + '" y="' + y + '" width="' + util.round(w, 1) + '" height="' + h + '" rx="10" fill="' + C.node +
                '" stroke="' + hp.hue + '" stroke-width="1.4" stroke-opacity=".85"/>');
            s.push('<circle class="ar-halo" cx="' + (x + 20) + '" cy="' + (y + 20) + '" r="12" fill="' + hp.hue + '" fill-opacity=".16" stroke="' + hp.hue + '" stroke-opacity=".45"/>');
            s.push('<text x="' + (x + 20) + '" y="' + (y + 25) + '" text-anchor="middle" font-size="12" fill="' + hp.hue + '">' + esc(hp.icon) + '</text>');
            s.push('<text class="ar-name" x="' + (x + 38) + '" y="' + (y + 24) + '" fill="' + C.ink + '">' + esc(fit(hp.name, w - 48, 13)) + '</text>');
            s.push('<text class="ar-en" x="' + (x + 38) + '" y="' + (y + 38) + '" fill="' + C.faint + '">' + esc(fit(hp.sub, w - 48, 8.5)) + '</text>');
            s.push('<text class="ar-tag" x="' + (x + 14) + '" y="' + (y + 62) + '" fill="' + hp.hue + '">' + esc(fit(policy, w - 28, 9.5)) + '</text>');
            s.push('<text class="ar-metric" x="' + (x + 14) + '" y="' + (y + 80) + '" fill="' + C.dim + '">' + esc(fit(detail, w - 28, 8.5)) + '</text>');
            s.push('<title>' + esc(hp.name + ' — ' + policy + ' · ' + detail) + '</title>');
            s.push('</g>');
        });
        s.push('<g class="ar-node" data-act="arch:dist-tech" data-arg="nacos" opacity="1">');
        s.push('<rect class="ar-box" x="' + rx + '" y="' + ry + '" width="' + rw + '" height="' + rh + '" rx="10" fill="' + C.node +
            '" stroke="' + lb.registry.hue + '" stroke-width="1.6" stroke-opacity=".9"/>');
        s.push('<text class="ar-name" x="' + util.round(rx + rw / 2, 1) + '" y="' + (ry + 25) + '" text-anchor="middle" fill="' + C.ink + '">' + esc(lb.registry.name) + '</text>');
        s.push('<text class="ar-tag" x="' + util.round(rx + rw / 2, 1) + '" y="' + (ry + 43) + '" text-anchor="middle" fill="' + lb.registry.hue + '">' + esc(lb.registry.sub) + '</text>');
        s.push('<title>Nacos 注册中心 — 点看组件契约</title>');
        s.push('</g>');
        s.push('</g>');
        s.push('<text x="' + (W / 2) + '" y="293" text-anchor="middle" font-size="9" fill="' + C.dim + '">' +
            '会话不粘滞 · 令牌与配额在 Redis · 只有幂等 GET 允许重试 · 新实例扩容秒级进名单</text>');
        s.push('</svg>');
        return s.join('');
    }

    function distMatrixHtml() {
        var rows = arch.distMatrix(), svcs = arch.services();
        var s = ['<div class="ar-mx-wrap"><div class="ar-mx">'];
        s.push('<div class="ar-mx-row ar-mx-head"><span class="ar-mx-name">组件 × 服务</span>' + svcs.map(function (svc) {
            return '<span class="ar-mx-cell"><i style="background:' + esc(svc.hue) + '"></i><span>' + esc(svc.name) + '</span></span>';
        }).join('') + '<span class="ar-mx-count">覆盖</span></div>');
        rows.forEach(function (r) {
            s.push('<div class="ar-mx-row clickable" data-act="arch:dist-tech" data-arg="' + esc(r.id) + '" style="--h:' + esc(r.hue) + '">');
            s.push('<span class="ar-mx-name"><i class="ar-dot" style="background:' + esc(r.hue) + '"></i><span><b>' + esc(r.no + ' ' + r.name) + '</b><small>' + esc(r.product) + '</small></span></span>');
            r.cells.forEach(function (on, i) {
                s.push('<span class="ar-mx-cell"><i class="' + (on ? 'on' : 'off') + '"' + (on ? ' title="' + esc(r.name + ' 覆盖 ' + svcs[i].name) + '"' : '') + '></i></span>');
            });
            s.push('<span class="ar-mx-count">' + r.count + '/10</span></div>');
        });
        s.push('</div></div>');
        return s.join('');
    }

    function distCatalog() {
        var st = ui.state(PAGE);
        var cat = st.distCat || '';
        var cats = arch.distCats();
        var chips = [{ label: '全部', value: '', count: arch.distributed().length, on: !cat }].concat(cats.map(function (c) {
            return { label: c.name, value: c.id, count: c.count, on: cat === c.id };
        }));
        var items = arch.distributed().filter(function (t) { return !cat || t.cat === cat; });
        return '<div class="ar-chips ar-dist-chips">' + ui.chips(chips, { act: 'arch:dist-cat' }) + '</div>' +
            '<div class="ar-dist-cards">' + items.map(function (t) {
                return '<div class="ar-dist-card" style="--h:' + esc(t.hue) + '" data-act="arch:dist-tech" data-arg="' + esc(t.id) + '">' +
                    '<div class="ar-dist-head"><i>' + esc(t.icon) + '</i><div><b>' + esc(t.no + '. ' + t.name) + '</b><span>' + esc(t.product) + '</span></div><em>' + esc(distCatName(t.cat)) + '</em></div>' +
                    '<p class="ar-dist-role">' + esc(t.role) + '</p>' +
                    '<div class="ar-dist-metrics">' + t.metrics.map(function (m) { return '<span><b>' + esc(m.v) + '</b>' + esc(m.k) + '</span>'; }).join('') + '</div>' +
                    '<div class="ar-dist-foot"><span>服务 ' + t.services.length + ' · 表 ' + t.tables.length + ' · 链路 ' + t.flows.length + '</span>' +
                    ui.link('契约', 'arch:dist-tech', t.id, { icon: '→' }) + '</div>' +
                    '</div>';
            }).join('') + '</div>';
    }

    function techDrawer(id) {
        var t = arch.distTech(id);
        if (!t) { ui.toast('技术目录里没有「' + id + '」', 'warn'); return; }
        ui.drawer({
            title: '<span class="ar-drawer-title" style="--h:' + esc(t.hue) + '"><i>' + esc(t.icon) + '</i>' + esc(t.no + ' · ' + t.name) + '</span>',
            sub: esc(t.product) + ' · ' + esc(t.version) + ' · ' + esc(distCatName(t.cat)),
            body: ui.stack([
                ui.notice(esc(t.role), 'info', '在 TMS 里管什么'),
                ui.card({ title: '为什么选它', flat: true, body: '<p class="ar-p">' + esc(t.why) + '</p>' }),
                ui.card({ title: 'TMS 落地场景', flat: true, body: '<p class="ar-p">' + esc(t.scenario) + '</p>' }),
                ui.card({ title: '设计要点', flat: true, sub: t.points.length + ' 条', body: bullets(t.points) }),
                ui.card({ title: '故障兜底', flat: true, tone: 'warn', body: '<p class="ar-p">' + esc(t.fallback) + '</p>' }),
                ui.card({
                    title: '覆盖范围', flat: true, sub: t.services.length + ' 服务 · ' + t.tables.length + ' 表 · ' + t.flows.length + ' 链路',
                    body: ui.stack([
                        '<div class="ar-chips">' + t.services.map(function (sid) {
                            var svc = arch.service(sid);
                            return svc ? ui.chip(esc(svc.no + ' ' + svc.name), { act: 'arch:open', arg: sid }) : '';
                        }).join('') + '</div>',
                        t.tables.length ? '<div class="ar-chips">' + t.tables.map(function (n) {
                            return ui.chip(esc(db.meta(n).label || n), { act: 'arch:table', arg: n });
                        }).join('') + '</div>' : '',
                        t.flows.length ? '<div class="ar-chips">' + t.flows.map(function (fid) {
                            var f = arch.flow(fid);
                            return f ? ui.chip(esc(f.no + ' ' + f.name), { act: 'arch:dist-flow', arg: fid }) : '';
                        }).join('') + '</div>' : ''
                    ], 'sm')
                }),
                ui.card({
                    title: '关键口径', flat: true,
                    body: '<div class="ar-dist-metrics">' + t.metrics.map(function (m) { return '<span><b>' + esc(m.v) + '</b>' + esc(m.k) + '</span>'; }).join('') + '</div>'
                })
            ]),
            footer: ui.btn('关闭', { act: 'ui:close' }) +
                ui.btn('在全景中聚焦', { act: 'arch:dist-focus', arg: t.id, tone: 'primary', icon: '⌖' }) +
                (t.flows.length ? ui.btn('看相关链路', { act: 'arch:dist-flow', arg: t.flows[0], icon: '⇄' }) : '')
        });
    }

    function stageModal(id) {
        var stg = null;
        arch.cicd().forEach(function (x) { if (x.id === id) stg = x; });
        if (!stg) { ui.toast('流水线里没有「' + id + '」阶段', 'warn'); return; }
        ui.modal({
            title: esc(stg.no + '. ' + stg.name),
            sub: esc(stg.tool) + ' · 耗时 ' + esc(stg.dur),
            body: ui.stack([
                ui.desc([
                    { label: '做什么', value: esc(stg.action) },
                    { label: '出口条件', value: esc(stg.exit) },
                    { label: '失败处置', value: '<span class="ar-forbid">' + esc(stg.fail) + '</span>' }
                ]),
                ui.notice('流水线即代码：Jenkinsfile 进库评审，任一阶段失败即停并通知提交人；发布全程镜像 tag = git sha，回滚就是切上一 tag。', 'info', '发布纪律')
            ]),
            footer: ui.btn('关闭', { act: 'ui:close' }) + ui.btn('看 CI/CD 组件', { act: 'arch:dist-tech', arg: 'cicd', tone: 'primary', icon: '⎈' })
        });
    }

    /* ---------- 雪花发号器 ----------
       64 位超出 Number 安全整数：二进制串拼位，十进制用字符串乘 2 加位，绝不碰 BigInt/浮点 */
    var SNOW_EPOCH = 1704067200000; /* 2024-01-01 UTC：自定义纪元，41 位时间戳可用 69 年 */
    var SNOW_DEFAULT = { snowDc: 1, snowWorker: 1, snowCount: 8, snowClock: 'ok', ids: [], picked: '0', seq: 0, lastTs: 0, alert: null };

    function snowState() {
        var st = ui.state(PAGE);
        if (!st.snow) st.snow = {};
        Object.keys(SNOW_DEFAULT).forEach(function (k) {
            if (st.snow[k] === undefined) st.snow[k] = util.clone(SNOW_DEFAULT[k]);
        });
        return st.snow;
    }

    function snowBits(num, width) {
        var s = Number(num).toString(2);
        while (s.length < width) s = '0' + s;
        return s;
    }

    function snowDec(bin) {
        var out = '0';
        for (var i = 0; i < bin.length; i++) {
            var carry = bin.charAt(i) === '1' ? 1 : 0, next = '';
            for (var j = out.length - 1; j >= 0; j--) {
                var d = (out.charCodeAt(j) - 48) * 2 + carry;
                carry = d > 9 ? 1 : 0;
                next = String(d % 10) + next;
            }
            if (carry) next = '1' + next;
            out = next;
        }
        return out;
    }

    function snowHex(bin) {
        var out = '';
        for (var i = 0; i < 64; i += 4) out += '0123456789abcdef'.charAt(parseInt(bin.substr(i, 4), 2));
        return out;
    }

    function snowClockText(ms) {
        var d = new Date(ms);
        return d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) + ' ' +
            util.pad(d.getHours()) + ':' + util.pad(d.getMinutes()) + ':' + util.pad(d.getSeconds()) + '.' + ('00' + d.getMilliseconds()).slice(-3);
    }

    function snowBatch() {
        var s = snowState();
        var real = util.now().getTime() - SNOW_EPOCH;
        s.alert = null;
        /* 时钟模式是演示注入：把 lastTs 人为推未来，模拟 NTP 回拨后的发号决策 */
        if (s.snowClock === 'wait') s.lastTs = real + 3;
        if (s.snowClock === 'reject') s.lastTs = real + 12;
        var ts = real;
        if (ts < s.lastTs) {
            var back = s.lastTs - ts;
            if (back > 5) {
                s.alert = { tone: 'danger', text: '检测到时钟回拨 ' + back + 'ms（> 5ms 容忍）：本批 ' + s.snowCount + ' 个 ID 全部拒发并上报告警。宁可失败，不发重号。' };
                return false;
            }
            s.alert = { tone: 'warn', text: '检测到时钟回拨 ' + back + 'ms（≤ 5ms）：等待追平后继续发号，序列不清零。' };
            ts = s.lastTs;
        }
        var ids = [];
        for (var i = 0; i < s.snowCount; i++) {
            if (ts === s.lastTs) {
                s.seq = (s.seq + 1) % 4096;
                if (s.seq === 0) ts = s.lastTs + 1; /* 本毫秒序列耗尽：借下一毫秒 */
            } else {
                s.seq = 0;
            }
            s.lastTs = ts;
            var bin = '0' + snowBits(ts, 41) + snowBits(s.snowDc, 5) + snowBits(s.snowWorker, 5) + snowBits(s.seq, 12);
            ids.push({
                key: String(i), bin: bin, dec: snowDec(bin), hex: snowHex(bin),
                ts: ts, dc: s.snowDc, worker: s.snowWorker, seq: s.seq,
                at: snowClockText(SNOW_EPOCH + ts)
            });
        }
        s.ids = ids;
        s.picked = '0';
        return true;
    }

    function snowSlider(label, key, min, max) {
        var s = snowState();
        var act = key === 'snowDc' ? 'arch:snow-dc' : key === 'snowWorker' ? 'arch:snow-worker' : 'arch:snow-count';
        return '<div class="ar-ctl slider">' +
            '<div class="ar-ctl-line"><span class="ar-ctl-name">' + esc(label) + '</span>' +
            '<b class="ar-ctl-val" data-arch-out="' + key + '">' + s[key] + '</b></div>' +
            '<input type="range" class="ar-range" min="' + min + '" max="' + max + '" step="1" value="' + s[key] +
            '" data-arch-live="' + key + '" data-change="' + act + '" aria-label="' + esc(label) + '">' +
            '</div>';
    }

    function snowAnatomy(id) {
        var d = {
            ts: parseInt(id.bin.substr(1, 41), 2),
            dc: parseInt(id.bin.substr(42, 5), 2),
            worker: parseInt(id.bin.substr(47, 5), 2),
            seq: parseInt(id.bin.substr(52, 12), 2)
        };
        var groups = [
            { name: '符号', n: 1, hue: '#9aa7bd', val: '0', desc: '恒为 0' },
            { name: '时间戳', n: 41, hue: '#3d8bff', val: fmt.number(d.ts) + ' ms', desc: snowClockText(SNOW_EPOCH + d.ts) },
            { name: '数据中心', n: 5, hue: '#4ecdc4', val: String(d.dc), desc: '机房 ' + d.dc },
            { name: '工作节点', n: 5, hue: '#f0a92e', val: String(d.worker), desc: '节点 ' + d.worker },
            { name: '序列号', n: 12, hue: '#8b7cf6', val: String(d.seq), desc: '本毫秒第 ' + (d.seq + 1) + ' 个' }
        ];
        var off = 0;
        var cells = groups.map(function (g) {
            var seg = id.bin.substr(off, g.n);
            off += g.n;
            var bitsHtml = '';
            for (var i = 0; i < seg.length; i++) bitsHtml += '<i class="' + (seg.charAt(i) === '1' ? 'on' : '') + '">' + seg.charAt(i) + '</i>';
            return '<div class="ar-snow-group" style="--h:' + g.hue + ';flex-grow:' + g.n + '">' +
                '<div class="ar-snow-group-head"><b>' + g.name + '</b><span>' + g.n + ' bit</span></div>' +
                '<div class="ar-snow-cells">' + bitsHtml + '</div>' +
                '<div class="ar-snow-group-val"><b>' + esc(g.val) + '</b><span>' + esc(g.desc) + '</span></div></div>';
        }).join('');
        return '<div class="ar-snow-id"><span>十进制</span><b>' + esc(id.dec) + '</b><span class="ar-snow-hex">hex ' + esc(id.hex) + '</span></div>' +
            '<div class="ar-snow-bits-wrap"><div class="ar-snow-bits">' + cells + '</div></div>';
    }

    function snowIds(s) {
        if (!s.ids.length) return '';
        return '<div class="ar-snow-ids"><div class="ar-snow-ids-wrap"><div class="ar-snow-ids-inner">' +
            '<div class="ar-snow-idrow head"><span>#</span><span>十进制 ID</span><span>时间（纪元偏移还原）</span><span>机房</span><span>节点</span><span>序列</span></div>' +
            s.ids.map(function (x) {
                return '<div class="ar-snow-idrow' + (x.key === s.picked ? ' on' : '') + '" data-act="arch:snow-pick" data-arg="' + x.key + '">' +
                    '<span>' + (Number(x.key) + 1) + '</span><span class="dec">' + esc(x.dec) + '</span><span>' + esc(x.at) + '</span>' +
                    '<span>' + x.dc + '</span><span>' + x.worker + '</span><span>' + x.seq + '</span></div>';
            }).join('') + '</div></div></div>';
    }

    function snowLab() {
        var s = snowState();
        var picked = null;
        s.ids.forEach(function (x) { if (x.key === s.picked) picked = x; });
        if (!picked && s.ids.length) picked = s.ids[0];
        var controls = '<aside class="ar-controls ar-snow-controls" aria-label="雪花发号控制台">' +
            '<header class="ar-controls-head"><b>发号控制台</b><span>八个旋钮，即时生效</span></header>' +
            '<div class="ar-controls-body">' +
            snowSlider('数据中心位', 'snowDc', 0, 31) +
            snowSlider('工作节点位', 'snowWorker', 0, 31) +
            snowSlider('每批数量', 'snowCount', 1, 24) +
            selectCtl('时钟模式', 'arch:snow-clock', s.snowClock, [
                { value: 'ok', label: '正常发号' },
                { value: 'wait', label: '回拨 3ms · 等待追平' },
                { value: 'reject', label: '回拨 12ms · 拒发告警' }
            ]) +
            '<div class="ar-ctl-sep">发号与输出</div>' +
            '<div class="ar-ctl-btns">' +
            ui.btn('生成一批', { size: 'sm', tone: 'primary', act: 'arch:snow-gen', icon: '❄', block: true }) +
            ui.btn('复制选中 ID', { size: 'sm', act: 'arch:snow-copy', icon: '⧉', block: true }) +
            ui.btn('导出本批 CSV', { size: 'sm', act: 'arch:snow-csv', icon: '⤓', block: true }) +
            ui.btn('复位', { size: 'sm', act: 'arch:snow-reset', icon: '⟲', block: true }) +
            '</div>' +
            '<p class="ar-ctl-note">纪元 2024-01-01 · 单节点每毫秒 4096 个 · workerId 由 K8s StatefulSet 序号注入 · 点列表行选中解剖</p>' +
            '</div></aside>';
        var main = '<div class="ar-snow-main">' +
            (s.alert ? ui.notice(esc(s.alert.text), s.alert.tone, s.alert.tone === 'danger' ? '拒绝发号' : '时钟回拨容忍') : '') +
            (picked ? snowAnatomy(picked) : '<div class="ar-snow-empty"><i>❄</i><b>还没有发号</b><span>调好机房与节点位，点「生成一批」——64 位解剖图与批次清单就在这里</span></div>') +
            snowIds(s) +
            '</div>';
        return '<div class="ar-snow">' + controls + main + '</div>';
    }

    function copyText(text) {
        var nav = global.navigator;
        if (nav && nav.clipboard && nav.clipboard.writeText) {
            nav.clipboard.writeText(text).then(function () { ui.toast('已复制 ' + text, 'success'); }, function () { copyFallback(text); });
        } else copyFallback(text);
    }

    function copyFallback(text) {
        if (!global.document || !document.execCommand) { ui.toast('当前环境不支持一键复制，请手动记录', 'warn'); return; }
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); ui.toast('已复制 ' + text, 'success'); }
        catch (e) { ui.toast('复制失败，请手动记录', 'warn'); }
        document.body.removeChild(ta);
    }

    function tabDist(ctx) {
        var v = view(), ds = arch.distStats();
        var kpi = ui.kpis([
            { label: '技术组件', value: ds.techs, unit: '件', tone: 'brand', icon: '⬢', sub: ds.cats + ' 个分类 · 逐件有兜底' },
            { label: '覆盖连接', value: ds.links, unit: '条', tone: 'info', icon: '⇄', sub: '组件 × 服务映射' },
            { label: '全量覆盖', value: ds.full, unit: '件', tone: 'accent', icon: '◉', sub: '十个服务全接入' },
            { label: '流水线阶段', value: ds.stages, unit: '段', tone: 'warn', icon: '⎈', sub: '金丝雀 5% → 30% → 全量' },
            { label: '设计要点', value: ds.points, unit: '条', tone: 'success', icon: '⚖', sub: '逐件可校验的约束' }
        ]);
        var legend = '<div class="ar-legend">' + arch.distCats().map(function (c) {
            return '<span class="ar-legend-item"><i style="background:' + esc(c.hue) + '"></i>' + esc(c.name) + ' <b>' + c.count + '</b></span>';
        }).join('') + '<span class="ar-legend-item ar-legend-hint">点组件看契约 · 聚焦画覆盖连线</span></div>';
        return ui.stack([
            kpi,
            ui.card({
                title: '分布式技术全景', sub: '五类十件 · 上承组件、下接服务', flat: true, tools: legend,
                body: distFocusBar(v) + distControls() +
                    '<div class="ar-canvas-wrap" style="--arch-zoom:' + esc(v.zoom) + '"><div class="ar-canvas" data-arch-canvas>' + distSvg(v) + '</div></div>'
            }),
            ui.card({ title: '覆盖矩阵', sub: '组件 × 服务：哪件技术落在哪些服务上，点行看契约', flat: true, body: distMatrixHtml() }),
            ui.card({
                title: '技术目录', sub: '每件回答：管什么、为什么、怎么兜底', flat: true,
                tools: ui.btn('导出目录 CSV', { size: 'sm', act: 'arch:dist-csv', icon: '⤓' }),
                body: distCatalog()
            }),
            ui.card({
                title: 'CI/CD 流水线', sub: 'Jenkins + Docker + Kubernetes · 八阶段 · 点阶段看出口条件与失败处置', flat: true,
                body: '<div class="ar-canvas-wrap seq pipe"><div class="ar-canvas" data-arch-canvas>' + cicdSvg(v) + '</div></div>'
            }),
            ui.card({
                title: '负载均衡三级接力', sub: 'Nginx → 网关 → OpenFeign · Nacos 供名单', flat: true,
                body: '<div class="ar-canvas-wrap seq lb"><div class="ar-canvas" data-arch-canvas>' + lbSvg(v) + '</div></div>'
            }),
            ui.card({
                title: '雪花发号器', sub: '64 位 ID 现场生成与解剖：调位、发号、时钟回拨演练', flat: true,
                body: snowLab()
            })
        ]);
    }

    function tabDeploy(ctx) {
        var jobs = arch.jobPlan();
        var unplanned = jobs.filter(function (j) { return !j.planned; }).length;
        return ui.stack([
            ui.card({
                title: '技术选型', sub: '每一层选什么、为什么选它', flat: true,
                body: ui.table({
                    zebra: true,
                    columns: [
                        { key: 'layer', label: '层次', width: 96, render: function (r) { return ui.badge(esc(r.layer), 'brand'); } },
                        { key: 'component', label: '组件', width: 300, render: function (r) { return '<b>' + esc(r.component) + '</b>'; } },
                        { key: 'why', label: '选型理由', render: function (r) { return esc(r.why); } }
                    ],
                    rows: arch.stack()
                })
            }),
            ui.card({
                title: '基础设施', sub: '服务无状态的前提：存储 / 消息 / 缓存 / 调度 / 观测', flat: true,
                body: '<div class="ar-infra">' + arch.infra().map(function (x) {
                    return '<div class="ar-infra-item"><b>' + esc(x.name) + '</b><span>' + esc(x.sub) + '</span></div>';
                }).join('') + '</div>'
            }),
            ui.card({
                title: '定时任务清单', sub: '与 TMS.jobs.RULES 一一对应 · ' + jobs.length + ' 个 handler 全部接 XXL-Job',
                flat: true, tools: unplanned ? ui.badge(unplanned + ' 项未登记 cron', 'danger') : ui.badge('cron 全部登记', 'success'),
                body: ui.table({
                    zebra: true, dense: true, onRow: 'arch:job', keyName: 'key',
                    columns: [
                        { key: 'name', label: '巡检任务', render: function (r) { return '<b>' + esc(r.name) + '</b><div class="tms-sub tms-mono">' + esc(r.handler) + '</div>'; } },
                        { key: 'cron', label: 'cron', width: 152, render: function (r) { return '<code>' + esc(r.cron || '未登记') + '</code>'; } },
                        { key: 'target', label: '目标服务', width: 140, render: function (r) { return esc(r.target); } },
                        { key: 'note', label: '口径', render: function (r) { return esc(r.note); } },
                        { key: 'op', label: '', width: 66, render: function (r) { return ui.link('详情', 'arch:job', r.key, { icon: '→' }); } }
                    ],
                    rows: jobs
                })
            }),
            ui.card({
                title: '演进路线', sub: '从当前纯前端演示到完整微服务，四步各自的出口条件', flat: true,
                body: '<div class="ar-phases">' + arch.evolution().map(function (p, i) {
                    return '<div class="ar-phase tone-' + esc(p.tone) + '">' +
                        '<div class="ar-phase-head"><span class="ar-phase-no">' + (i + 1) + '</span><b>' + esc(p.name) + '</b>' + ui.badge(esc(p.when), p.tone) + '</div>' +
                        ui.desc([
                            { label: '范围', value: esc(p.scope) },
                            { label: '拿到什么', value: esc(p.value) },
                            { label: '代价与风险', value: '<span class="ar-forbid">' + esc(p.risk) + '</span>' },
                            { label: '出口条件', value: esc(p.exit) }
                        ]) + '</div>';
                }).join('') + '</div>'
            }),
            ui.notice('当前运行态：schema ' + cfg.storage.schema + ' · ' + arch.stats().modules + ' 个模块 · ' +
                arch.stats().registeredPages + ' 个已注册页面 · ' + fmt.number(arch.stats().rows) + ' 行演示数据。' +
                '接口形状与领域函数一一对应，可直接映射成后端契约。', 'info', 'P0 已落地')
        ]);
    }

    /* ---------- 注册 ---------- */

    /* 公开页 masthead：架构说明书挂在站点根（architecture.html），访客从登录首页进来，
       没有侧栏也没有退出口，顶部必须常驻「返回登录」；已登录会话则给「进入系统」直达门户 */
    function publicMasthead(ctx) {
        var sess = ctx.session || {};
        var conf = TMS.cfg.roles[sess.role];
        var home = esc(util.url('index.html'));
        var right = conf && !sess.guest
            ? '<a class="ar-mast-enter" href="' + esc(util.url(conf.portal)) + '">进入系统 · ' + esc(sess.name || conf.name) + ' →</a>'
            : '<a class="ar-mast-enter" href="' + home + '">返回登录 →</a>';
        return '<header class="ar-mast">' +
            '<a class="ar-mast-brand" href="' + home + '"><i>汇</i><b>汇通物流 TMS</b><span>架构设计说明书</span></a>' +
            '<span class="ar-mast-tag">公开文档 · 无需登录</span>' +
            '<nav class="ar-mast-nav">' + right + '</nav>' +
            '</header>';
    }

    pg.define(PAGE, {
        title: '架构设计',
        file: 'architecture.html',
        bare: true,
        sub: '十个服务怎么拆、谁写哪张表、一跳一跳怎么调用、落地到当前工程的哪些模块',
        live: false,
        load: function (ctx) {
            var st = ui.state(PAGE), v = view();
            /* 首页的服务胶囊带 service 参数进来：只在参数变化时应用一次，
               否则每次刷新都把用户手动改掉的聚焦又拽回去 */
            var want = ctx.params && ctx.params.service ? String(ctx.params.service) : '';
            if (want && arch.service(want) && st.archParam !== want) {
                st.archParam = want;
                v.focus = want;
                st.tab = 'topo';
            }
            if (ctx.params && ctx.params.tab && !st.tab) st.tab = String(ctx.params.tab);
            return { stats: arch.stats(), tab: st.tab || 'topo' };
        },
        render: function (ctx, d) {
            var st = ui.state(PAGE);
            var tab = st.tab || 'topo';
            var body = tab === 'services' ? tabServices(ctx)
                : tab === 'flows' ? tabFlows(ctx)
                    : tab === 'data' ? tabData(ctx)
                        : tab === 'dist' ? tabDist(ctx)
                            : tab === 'deploy' ? tabDeploy(ctx)
                                : tabTopo(ctx, d);
            var tabs = TABS.map(function (t) {
                var n = t.value === 'services' ? d.stats.services : t.value === 'flows' ? d.stats.flows
                    : t.value === 'data' ? d.stats.collections : t.value === 'dist' ? arch.distStats().techs
                        : t.value === 'deploy' ? arch.jobPlan().length : 0;
                return n ? { value: t.value, label: t.label, count: n } : { value: t.value, label: t.label };
            });
            var page = ui.page({
                title: '架构设计',
                badge: ui.badge('目标态 · 10 服务', 'brand'),
                sub: '网关 / BFF / 订单 / 网点 / 调度跟踪 / 结算计费 / TMS 核心 / 运营考核 / 定时任务 / 检索 —— ' +
                    esc(d.stats.layers + ' 层拆分 · ' + d.stats.collections + ' 张表单一写入者 · ' + d.stats.steps + ' 步端到端链路 · 十件分布式与运维组件'),
                actions: ui.btn('导出服务目录', { size: 'sm', act: 'arch:csv', icon: '⤓' }) +
                    ui.btn('导出拓扑 SVG', { size: 'sm', tone: 'primary', act: 'arch:svg', icon: '⌬' }),
                body: ui.stack([ui.tabs(tabs, tab), body])
            });
            /* 裸页没有外壳的内容区 padding，也没有侧栏品牌：masthead 全宽常驻，正文自己收宽 */
            return ctx.layout === 'bare'
                ? publicMasthead(ctx) + '<div class="ar-public-body">' + page + '</div>'
                : page;
        },
        afterRender: function (ctx, root) { bindLive(root); },
        actions: {
            'arch:open': function (id) { serviceDrawer(id); },
            'arch:table': function (name) { tableModal(name); },
            'arch:job': function (key) { jobModal(key); },
            'arch:goto': function (pageId) {
                if (!pageId || !pg.get(pageId)) { ui.toast('页面尚未注册', 'warn'); return; }
                ui.closeTop();
                TMS.shell.go(pageId);
            },
            'arch:focus': function (id) {
                ui.closeTop();
                var st = ui.state(PAGE);
                st.tab = 'topo';
                setView({ focus: arch.service(id) ? id : '' });
            },
            'arch:flowsof': function (id) {
                ui.closeTop();
                var hit = arch.flows().filter(function (f) {
                    return f.steps.some(function (x) { return x.from === id || x.to === id; });
                })[0];
                var st = ui.state(PAGE);
                st.tab = 'flows';
                st.seg = hit ? hit.id : st.seg;
                view().step = 1;
                TMS.shell.refresh();
            },
            'arch:lines': function (val) { setView({ lines: val || 'all' }); },
            'arch:theme': function (val) { setView({ theme: val === 'light' ? 'light' : 'dark' }); },
            'arch:anim': function () { var v = view(); setView({ anim: v.anim ? 0 : 1 }); },
            'arch:metrics': function () { var v = view(); setView({ metrics: v.metrics ? 0 : 1 }); },
            'arch:grid': function () { var v = view(); setView({ grid: v.grid ? 0 : 1 }); },
            'arch:glow': function () { var v = view(); setView({ glow: v.glow ? 0 : 1 }); },
            'arch:speed': function (val) { setView({ speed: clamp(Number(val) || 1, 0.4, 2.5) }); },
            'arch:zoom': function (val) { setView({ zoom: clamp(Number(val) || 1, 0.8, 1.8) }); },
            'arch:reset': function () {
                var st = ui.state(PAGE);
                st.arch = {};
                view();
                TMS.shell.refresh();
                ui.toast('视图已复位：全图 / 深色 / 动画开 / 1×', 'success');
            },
            'arch:play': function () { var v = view(); setView({ play: v.play ? 0 : 1 }); },
            'arch:step': function (seq) {
                var f = currentFlow();
                var n = clamp(Number(seq) || 1, 1, f.steps.length);
                setView({ step: n, play: 0 });
            },
            'arch:prev': function () {
                var v = view(), f = currentFlow();
                setView({ step: clamp((Number(v.step) || 1) - 1, 1, f.steps.length), play: 0 });
            },
            'arch:next': function () {
                var v = view(), f = currentFlow();
                setView({ step: clamp((Number(v.step) || 1) + 1, 1, f.steps.length), play: 0 });
            },
            'arch:sweep': function () {
                var r = TMS.jobs.sweep(true);
                ui.toast('巡检完成：' + (r.jobs || []).length + ' 项任务，未闭环告警 ' + r.alerts + ' 条', 'success');
            },
            'arch:svg': function () {
                save('TMS架构拓扑-' + util.dateKey(util.now()) + '.svg', topoSvg(view()), 'image/svg+xml;charset=utf-8');
            },
            'arch:csv': function () {
                var rows = serviceRows();
                save('TMS服务目录-' + util.dateKey(util.now()) + '.csv', '\ufeff' + toCsv([
                    { label: '编号', key: 'no' }, { label: '服务', key: 'name' }, { label: '英文名', key: 'en' },
                    { label: '分层', value: function (r) { return (LAYER_NAME[r.layer] || {}).name || r.layer; } },
                    { label: '职责', key: 'mission' }, { label: '接口数', key: 'apis' }, { label: '事件数', key: 'events' },
                    { label: '拥有表', key: 'tables' }, { label: '数据行', key: 'rows' }, { label: '落地页面', key: 'pages' },
                    { label: '落地模块', key: 'modules' }, { label: '同步依赖', key: 'deps' }, { label: '漂移项', key: 'missing' }
                ], rows), 'text/csv;charset=utf-8');
            },
            'arch:dist-focus': function (id) {
                ui.closeTop();
                var st = ui.state(PAGE);
                st.tab = 'dist';
                setView({ distFocus: arch.distTech(id) ? id : '' });
            },
            'arch:dist-tech': function (id) { techDrawer(id); },
            'arch:dist-cat': function (val) {
                var st = ui.state(PAGE);
                st.distCat = val || '';
                TMS.shell.refresh();
            },
            'arch:dist-stage': function (id) { stageModal(id); },
            'arch:dist-flow': function (id) {
                var f = arch.flow(id);
                if (!f) { ui.toast('链路目录里没有「' + id + '」', 'warn'); return; }
                ui.closeTop();
                var st = ui.state(PAGE);
                st.tab = 'flows';
                st.seg = f.id;
                view().step = 1;
                TMS.shell.refresh();
            },
            'arch:dist-svg': function () {
                save('TMS分布式全景-' + util.dateKey(util.now()) + '.svg', distSvg(view()), 'image/svg+xml;charset=utf-8');
            },
            'arch:dist-csv': function () {
                save('TMS分布式技术目录-' + util.dateKey(util.now()) + '.csv', '\ufeff' + toCsv([
                    { label: '编号', key: 'no' }, { label: '技术', key: 'name' }, { label: '组件', key: 'product' },
                    { label: '版本', key: 'version' }, { label: '分类', value: function (r) { return distCatName(r.cat); } },
                    { label: '职责', key: 'role' }, { label: '选型理由', key: 'why' }, { label: '落地场景', key: 'scenario' },
                    { label: '故障兜底', key: 'fallback' },
                    { label: '覆盖服务', value: function (r) { return r.services.map(function (sid) { var s = arch.service(sid); return s ? s.name : sid; }).join('/'); } },
                    { label: '涉及表', value: function (r) { return r.tables.map(function (n) { return db.meta(n).label || n; }).join('/'); } },
                    { label: '相关链路', value: function (r) { return r.flows.map(function (fid) { var f = arch.flow(fid); return f ? f.name : fid; }).join('/'); } }
                ], arch.distributed()), 'text/csv;charset=utf-8');
            },
            'arch:snow-dc': function (val) { snowState().snowDc = clamp(Math.round(Number(val) || 0), 0, 31); },
            'arch:snow-worker': function (val) { snowState().snowWorker = clamp(Math.round(Number(val) || 0), 0, 31); },
            'arch:snow-count': function (val) { snowState().snowCount = clamp(Math.round(Number(val) || 1), 1, 24); },
            'arch:snow-clock': function (val) {
                snowState().snowClock = val === 'wait' || val === 'reject' ? val : 'ok';
                TMS.shell.refresh();
            },
            'arch:snow-gen': function () {
                var ok = snowBatch();
                TMS.shell.refresh();
                if (ok) ui.toast('已发号 ' + snowState().ids.length + ' 个：机房 ' + snowState().snowDc + ' · 节点 ' + snowState().snowWorker, 'success');
            },
            'arch:snow-pick': function (key) {
                var s = snowState();
                s.picked = String(key == null || key === '' ? '0' : key);
                TMS.shell.refresh();
            },
            'arch:snow-copy': function () {
                var s = snowState(), hit = null;
                s.ids.forEach(function (x) { if (x.key === s.picked) hit = x; });
                if (!hit) hit = s.ids[0];
                if (!hit) { ui.toast('还没有可复制的 ID，先生成一批', 'warn'); return; }
                copyText(hit.dec);
            },
            'arch:snow-csv': function () {
                var s = snowState();
                if (!s.ids.length) { ui.toast('本批为空，先生成一批再导出', 'warn'); return; }
                /* 19 位十进制超 Excel 15 位精度：="..." 公式写法保住尾数 */
                save('TMS雪花ID批次-' + util.dateKey(util.now()) + '.csv', '\ufeff' + toCsv([
                    { label: '序号', value: function (r) { return Number(r.key) + 1; } },
                    { label: '十进制ID', value: function (r) { return '="' + r.dec + '"'; } },
                    { label: '十六进制', key: 'hex' }, { label: '时间', key: 'at' },
                    { label: '机房', key: 'dc' }, { label: '节点', key: 'worker' }, { label: '序列', key: 'seq' }
                ], s.ids), 'text/csv;charset=utf-8');
            },
            'arch:snow-reset': function () {
                ui.state(PAGE).snow = {};
                snowState();
                TMS.shell.refresh();
                ui.toast('发号器已复位：机房 1 · 节点 1 · 每批 8 · 时钟正常', 'success');
            }
        }
    });

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    function currentFlow() {
        var st = ui.state(PAGE);
        var list = arch.flows();
        var f = arch.flow(st.seg || list[0].id);
        return f || list[0];
    }

    /* 滑块要「手一动图就变」：input 事件里只改 CSS 变量与读数，不整页重渲染，
       否则拖动过程中 SVG 被反复重建，动画每次都从头开始，手感就是卡的。
       change 事件仍走动作表，保证状态落进 ui.state，切页签回来还在 */
    function bindLive(root) {
        if (!root || root._archLive || !root.addEventListener) return;
        root._archLive = true;
        root.addEventListener('input', function (e) {
            var el = e.target;
            if (!el || !el.getAttribute) return;
            var key = el.getAttribute('data-arch-live');
            var val = Number(el.value);
            if (!isFinite(val)) return;
            if (key === 'speed' || key === 'zoom') {
                view()[key] = val;
                applyLive(root, key, val);
                return;
            }
            /* 雪花旋钮只改状态与读数：已发 ID 是历史事实，下一批才用新节点位 */
            if (key === 'snowDc' || key === 'snowWorker' || key === 'snowCount') {
                val = key === 'snowCount' ? clamp(Math.round(val), 1, 24) : clamp(Math.round(val), 0, 31);
                snowState()[key] = val;
                applyLive(root, key, val);
            }
        });
    }

    function applyLive(root, key, val) {
        var hosts = root.querySelectorAll ? root.querySelectorAll('[data-arch-canvas]') : [];
        var i;
        if (key === 'speed') {
            for (i = 0; i < hosts.length; i++) {
                var svg = hosts[i].querySelector ? hosts[i].querySelector('svg') : null;
                if (svg && svg.style) svg.style.setProperty ? svg.style.setProperty('--arch-speed', String(val)) : (svg.style['--arch-speed'] = val);
            }
        } else if (key === 'zoom') {
            var wraps = root.querySelectorAll('.ar-canvas-wrap');
            for (i = 0; i < wraps.length; i++) {
                if (wraps[i].classList && wraps[i].classList.contains('seq')) continue;
                if (wraps[i].style && wraps[i].style.setProperty) wraps[i].style.setProperty('--arch-zoom', String(val));
            }
        }
        var outs = root.querySelectorAll('[data-arch-out="' + key + '"]');
        for (i = 0; i < outs.length; i++) outs[i].textContent = val + (key === 'speed' || key === 'zoom' ? '×' : '');
    }
})(window);