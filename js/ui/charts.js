/* SVG 图表：无第三方依赖，全部产出字符串（可直接拼进卡片 body）
   约定：opts.data 为 [{label, value|series:[..]}]；单位/格式化由 opts.fmt 决定，图表不做业务口径计算
   响应式：viewBox 定宽 + width:100%，文字随画布等比缩放，容器再窄也不会溢出 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util;

    var W = 720;
    var PALETTE = ['#1668dc', '#4ecdc4', '#d98207', '#2e9e5b', '#d43b3b', '#7c5cd6', '#4a7fb5', '#e0719c', '#3fb6a8', '#8a94a6'];

    function esc(v) { return util.esc(v); }
    function color(i) { return PALETTE[i % PALETTE.length]; }

    /* 好看的刻度：把最大值抬到 1/2/5×10^n 的整数倍 */
    function niceMax(max, ticks) {
        if (!(max > 0)) return 1;
        var n = ticks || 4;
        var raw = max / n;
        var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
        var norm = raw / mag;
        var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
        return util.round(step * n, 6);
    }

    function tickValue(v, fmt) {
        if (!fmt) {
            if (Math.abs(v) >= 10000) return util.round(v / 10000, Math.abs(v) >= 100000 ? 0 : 1) + '万';
            if (Math.abs(v) >= 1000) return util.round(v / 1000, 1) + 'k';
            return String(util.round(v, Math.abs(v) < 10 ? 1 : 0));
        }
        return fmt(v);
    }

    function frame(opts, height) {
        var o = opts || {};
        var h = height || o.height || 240;
        return {
            w: W, h: h,
            padL: o.padL == null ? 46 : o.padL,
            padR: o.padR == null ? 14 : o.padR,
            padT: o.padT == null ? 14 : o.padT,
            padB: o.padB == null ? 26 : o.padB
        };
    }

    function svg(inner, h) {
        return '<div class="tms-chart"><svg viewBox="0 0 ' + W + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">' +
            inner + '</svg></div>';
    }

    function grid(f, max, ticks, fmt, opts) {
        var o = opts || {};
        var innerH = f.h - f.padT - f.padB;
        var lines = '';
        for (var i = 0; i <= ticks; i++) {
            var y = f.padT + innerH - innerH * (i / ticks);
            var v = max * (i / ticks);
            lines += '<line x1="' + f.padL + '" y1="' + y + '" x2="' + (f.w - f.padR) + '" y2="' + y +
                '" stroke="' + (i === 0 ? '#dfe6ee' : '#eef2f7') + '" stroke-width="1"/>';
            lines += '<text x="' + (f.padL - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" font-size="10.5" fill="#a4b0c2">' +
                esc(tickValue(v, fmt)) + '</text>';
        }
        if (o.seriesLabel) {
            lines += '<text x="' + f.padL + '" y="' + (f.padT - 3) + '" font-size="10" fill="#a4b0c2">' + esc(o.seriesLabel) + '</text>';
        }
        return lines;
    }

    function xLabels(f, labels, step) {
        var innerW = f.w - f.padL - f.padR;
        var n = labels.length || 1;
        var bw = innerW / n;
        var every = step || Math.ceil(n / 12);
        var out = '';
        labels.forEach(function (lb, i) {
            if (i % every) return;
            out += '<text x="' + (f.padL + bw * (i + 0.5)) + '" y="' + (f.h - f.padB + 15) +
                '" text-anchor="middle" font-size="10.5" fill="#8a94a6">' + esc(lb) + '</text>';
        });
        return out;
    }

    function legend(items) {
        if (!items || items.length < 2) return '';
        return '<div class="tms-chart-legend">' + items.map(function (it) {
            return '<span><i style="background:' + esc(it.color) + '"></i>' + esc(it.label) + '</span>';
        }).join('') + '</div>';
    }

    function path(points, close, baseY) {
        if (!points.length) return '';
        var d = points.map(function (p, i) { return (i ? 'L' : 'M') + util.round(p[0], 1) + ' ' + util.round(p[1], 1); }).join(' ');
        if (close) d += ' L' + util.round(points[points.length - 1][0], 1) + ' ' + baseY + ' L' + util.round(points[0][0], 1) + ' ' + baseY + ' Z';
        return d;
    }

    /* ---------- 折线 / 面积 ---------- */
    /* line({data:[{label,series:[..]}] 或 series:[{name,data:[..]}]}, labels, area, fmt) */
    function line(opts) {
        var o = opts || {};
        var f = frame(o, o.height || 240);
        var series = o.series || [{ name: o.name || '', data: (o.data || []).map(function (d) { return d.value; }) }];
        var labels = o.labels || (o.data || []).map(function (d) { return d.label; });
        var innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
        var all = [];
        series.forEach(function (s) { (s.data || []).forEach(function (v) { if (v != null && !isNaN(v)) all.push(Number(v)); }); });
        var max = niceMax(Math.max.apply(null, all.concat([0])), o.ticks || 4);
        var min = o.min != null ? o.min : 0;
        var n = Math.max(1, labels.length);
        var x = function (i) { return f.padL + innerW * ((n === 1 ? 0.5 : i / (n - 1))); };
        var y = function (v) { return f.padT + innerH - innerH * ((Number(v) - min) / (max - min || 1)); };

        var body = grid(f, max, o.ticks || 4, o.fmt) + xLabels(f, labels, o.labelEvery);
        series.forEach(function (s, si) {
            var pts = (s.data || []).map(function (v, i) { return [x(i), v == null || isNaN(v) ? null : y(v)]; });
            var c = s.color || color(si);
            var valid = pts.filter(function (p) { return p[1] != null; });
            if (o.area && series.length === 1) {
                body += '<path d="' + path(valid, true, f.padT + innerH) + '" fill="' + c + '" fill-opacity=".10"/>';
            }
            body += '<path d="' + path(valid, false) + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
            if ((valid.length || 0) <= 40) {
                (s.data || []).forEach(function (v, i) {
                    if (v == null || isNaN(v)) return;
                    body += '<circle cx="' + util.round(x(i), 1) + '" cy="' + util.round(y(v), 1) + '" r="2.6" fill="#fff" stroke="' + c + '" stroke-width="1.6">' +
                        '<title>' + esc(labels[i] || '') + (s.name ? ' · ' + esc(s.name) : '') + ' ' +
                        esc(o.fmt ? o.fmt(v) : util.round(v, 2)) + '</title></circle>';
                });
            }
        });
        return svg(body, f.h) + legend(series.map(function (s, i) { return { label: s.name || ('系列' + (i + 1)), color: s.color || color(i) }; }));
    }

    /* ---------- 柱状 ---------- */
    function bars(opts) {
        var o = opts || {};
        var f = frame(o, o.height || 240);
        var rows = o.data || [];
        var innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
        var max = niceMax(Math.max.apply(null, rows.map(function (d) { return Number(d.value) || 0; }).concat([0])), o.ticks || 4);
        var n = Math.max(1, rows.length);
        var bw = innerW / n;
        var barW = Math.max(3, Math.min(o.barWidth || 26, bw * 0.62));
        var body = grid(f, max, o.ticks || 4, o.fmt) + xLabels(f, rows.map(function (d) { return d.label; }), o.labelEvery);
        rows.forEach(function (d, i) {
            var v = Number(d.value) || 0;
            var h = innerH * (v / (max || 1));
            var cx = f.padL + bw * (i + 0.5);
            var fill = d.color || o.color || color(i % 10);
            body += '<rect x="' + util.round(cx - barW / 2, 1) + '" y="' + util.round(f.padT + innerH - h, 1) +
                '" width="' + util.round(barW, 1) + '" height="' + util.round(Math.max(0, h), 1) +
                '" rx="2.5" fill="' + fill + '" fill-opacity="' + (o.opacity || .88) + '">' +
                '<title>' + esc(d.label) + '：' + esc(o.fmt ? o.fmt(v) : util.round(v, 2)) + (d.sub ? '（' + esc(d.sub) + '）' : '') + '</title></rect>';
            if (o.valueLabels && n <= 14) {
                body += '<text x="' + cx + '" y="' + util.round(f.padT + innerH - h - 5, 1) + '" text-anchor="middle" font-size="10" fill="#75839a">' +
                    esc(tickValue(v, o.fmt)) + '</text>';
            }
        });
        return svg(body, f.h) + legend(o.seriesLabel ? [{ label: o.seriesLabel, color: o.color || color(0) }] : null);
    }

    /* ---------- 条形（排行榜，标签在左） ---------- */
    function hbars(opts) {
        var o = opts || {};
        var rows = (o.data || []).slice(0, o.limit || 12);
        var rowH = o.rowH || 26;
        var h = Math.max(40, rows.length * rowH + 16);
        var labelW = o.labelWidth || 128;
        var valueW = o.valueWidth || 84;
        var trackW = W - labelW - valueW - 12;
        var max = Math.max.apply(null, rows.map(function (d) { return Number(d.value) || 0; }).concat([1]));
        var body = '<rect x="0" y="0" width="' + W + '" height="' + h + '" fill="none"/>';
        rows.forEach(function (d, i) {
            var y = i * rowH + 8;
            var w = Math.max(2, trackW * ((Number(d.value) || 0) / max));
            body += '<text x="' + (labelW - 8) + '" y="' + (y + 13) + '" text-anchor="end" font-size="11.5" fill="#43516a">' + esc(d.label) + '</text>';
            body += '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + trackW + '" height="' + (rowH - 14) + '" rx="3" fill="#eef2f7"/>';
            body += '<rect x="' + labelW + '" y="' + (y + 4) + '" width="' + util.round(w, 1) + '" height="' + (rowH - 14) +
                '" rx="3" fill="' + (d.color || o.color || color(i)) + '" fill-opacity=".9"><title>' +
                esc(d.label) + '：' + esc(o.fmt ? o.fmt(d.value) : util.round(d.value, 2)) + '</title></rect>';
            body += '<text x="' + (labelW + trackW + 8) + '" y="' + (y + 13) + '" font-size="11.5" fill="#1f2a3a" font-weight="600">' +
                esc(o.fmt ? o.fmt(d.value) : util.round(d.value, 2)) + '</text>';
            if (d.sub) {
                body += '<text x="' + (labelW + trackW + valueW - 4) + '" y="' + (y + 13) + '" text-anchor="end" font-size="10.5" fill="#a4b0c2">' + esc(d.sub) + '</text>';
            }
        });
        return svg(body || '<text x="8" y="20" font-size="12" fill="#a4b0c2">暂无数据</text>', h);
    }

    /* ---------- 堆叠柱 ---------- */
    /* stacked({labels, series:[{name,color,data:[]}], pct}) */
    function stacked(opts) {
        var o = opts || {};
        var f = frame(o, o.height || 250);
        var labels = o.labels || [];
        var series = o.series || [];
        var innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
        var totals = labels.map(function (_, i) { return util.sum(series, function (s) { return Number((s.data || [])[i]) || 0; }); });
        var max = niceMax(Math.max.apply(null, totals.concat([0])), o.ticks || 4);
        var bw = innerW / Math.max(1, labels.length);
        var barW = Math.max(4, Math.min(30, bw * 0.6));
        var body = grid(f, max, o.ticks || 4, o.fmt) + xLabels(f, labels, o.labelEvery);
        labels.forEach(function (lb, i) {
            var acc = 0;
            var cx = f.padL + bw * (i + 0.5);
            series.forEach(function (s, si) {
                var v = Number((s.data || [])[i]) || 0;
                if (!v) { acc += 0; return; }
                var h = innerH * (v / (max || 1));
                var y = f.padT + innerH - h - acc;
                acc += h;
                body += '<rect x="' + util.round(cx - barW / 2, 1) + '" y="' + util.round(y, 1) + '" width="' + util.round(barW, 1) +
                    '" height="' + util.round(h, 1) + '" fill="' + (s.color || color(si)) + '" fill-opacity=".9">' +
                    '<title>' + esc(lb) + ' · ' + esc(s.name) + '：' + esc(o.fmt ? o.fmt(v) : util.round(v, 2)) + '</title></rect>';
            });
        });
        return svg(body, f.h) + legend(series.map(function (s, i) { return { label: s.name, color: s.color || color(i) }; }));
    }

    /* ---------- 柱线组合（单量 vs 金额/毛利率） ---------- */
    function combo(opts) {
        var o = opts || {};
        var f = frame(o, o.height || 260);
        var labels = o.labels || [];
        var barsData = o.bars || [];
        var lineData = o.line || [];
        var innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
        var maxB = niceMax(Math.max.apply(null, barsData.map(function (v) { return Number(v) || 0; }).concat([0])), o.ticks || 4);
        var maxL = niceMax(Math.max.apply(null, lineData.map(function (v) { return Number(v) || 0; }).concat([0])), o.ticks || 4);
        var n = Math.max(1, labels.length);
        var bw = innerW / n;
        var barW = Math.max(4, Math.min(26, bw * 0.55));
        var body = grid(f, maxB, o.ticks || 4, o.fmt) + xLabels(f, labels, o.labelEvery);
        barsData.forEach(function (v, i) {
            var h = innerH * ((Number(v) || 0) / (maxB || 1));
            var cx = f.padL + bw * (i + 0.5);
            body += '<rect x="' + util.round(cx - barW / 2, 1) + '" y="' + util.round(f.padT + innerH - h, 1) + '" width="' + util.round(barW, 1) +
                '" height="' + util.round(Math.max(0, h), 1) + '" rx="2.5" fill="' + (o.barColor || '#c7dcf5') + '">' +
                '<title>' + esc(labels[i]) + ' · ' + esc(o.barName || '') + ' ' + esc(o.fmt ? o.fmt(v) : util.round(v, 2)) + '</title></rect>';
        });
        var pts = lineData.map(function (v, i) {
            return [f.padL + bw * (i + 0.5), f.padT + innerH - innerH * ((Number(v) || 0) / (maxL || 1))];
        });
        var lc = o.lineColor || '#d98207';
        body += '<path d="' + path(pts, false) + '" fill="none" stroke="' + lc + '" stroke-width="2"/>';
        pts.forEach(function (p, i) {
            body += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#fff" stroke="' + lc + '" stroke-width="1.6">' +
                '<title>' + esc(labels[i]) + ' · ' + esc(o.lineName || '') + ' ' + esc(util.round(lineData[i], 1)) + '</title></circle>';
        });
        if (o.rightAxis) {
            body += '<text x="' + (f.w - f.padR) + '" y="' + (f.padT + 4) + '" text-anchor="end" font-size="10" fill="#d98207">' +
                esc(o.rightAxis) + ' 0~' + tickValue(maxL) + '</text>';
        }
        return svg(body, f.h) + legend([
            { label: o.barName || '柱', color: o.barColor || '#c7dcf5' },
            { label: o.lineName || '线', color: lc }
        ]);
    }

    /* ---------- 环形 / 饼 ---------- */
    function donut(opts) {
        var o = opts || {};
        var rows = (o.data || []).filter(function (d) { return (Number(d.value) || 0) > 0; }).slice(0, o.limit || 8);
        /* 图例每项两行（名称 + 数值·占比），行距必须容纳下行文字的全高：
           19px 行距下数值行被下一项名称压住；画布高度随项数自适应，不裁切 */
        var pitch = 28;
        var h = Math.max(o.height || 240, rows.length * pitch + 26);
        var size = Math.min(h, 210);
        var cx = size / 2 + 4, cy = h / 2, r = size / 2 - 10, r2 = o.ring === false ? r : r * 0.62;
        var total = util.sum(rows, 'value') || 1;
        var a0 = -Math.PI / 2;
        var body = '';
        function arc(from, to, radius, inner) {
            var large = to - from > Math.PI ? 1 : 0;
            var x1 = cx + radius * Math.cos(from), y1 = cy + radius * Math.sin(from);
            var x2 = cx + radius * Math.cos(to), y2 = cy + radius * Math.sin(to);
            if (!inner) return 'M' + x1 + ' ' + y1 + ' A' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2;
            var x3 = cx + inner * Math.cos(to), y3 = cy + inner * Math.sin(to);
            var x4 = cx + inner * Math.cos(from), y4 = cy + inner * Math.sin(from);
            return 'M' + x1 + ' ' + y1 + ' A' + radius + ' ' + radius + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
                ' L' + x3 + ' ' + y3 + ' A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + x4 + ' ' + y4 + ' Z';
        }
        rows.forEach(function (d, i) {
            var frac = (Number(d.value) || 0) / total;
            var a1 = a0 + frac * Math.PI * 2;
            var c = d.color || color(i);
            body += '<path d="' + arc(a0, Math.min(a1, a0 + Math.PI * 1.999), r, r2) + '" fill="' + c + '" fill-opacity=".92">' +
                '<title>' + esc(d.label) + '：' + esc(o.fmt ? o.fmt(d.value) : util.round(d.value, 2)) +
                '（' + util.round(frac * 100, 1) + '%）</title></path>';
            a0 = a1;
        });
        if (o.center) {
            body += '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" font-size="19" font-weight="700" fill="#1f2a3a">' + esc(o.center.value) + '</text>';
            body += '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" font-size="11" fill="#a4b0c2">' + esc(o.center.label) + '</text>';
        }
        /* 右侧图例带数值，小占比也能读出绝对量 */
        var lx = size + 22;
        rows.forEach(function (d, i) {
            var y = cy - (rows.length * pitch) / 2 + i * pitch + 10;
            body += '<rect x="' + lx + '" y="' + (y - 8) + '" width="9" height="9" rx="2" fill="' + (d.color || color(i)) + '"/>';
            body += '<text x="' + (lx + 15) + '" y="' + y + '" font-size="11.5" fill="#43516a">' + esc(d.label) + '</text>';
            body += '<text x="' + (lx + 15) + '" y="' + (y + 13) + '" font-size="10.5" fill="#a4b0c2">' +
                esc(o.fmt ? o.fmt(d.value) : util.round(d.value, 2)) + ' · ' + util.round((Number(d.value) || 0) / total * 100, 1) + '%</text>';
        });
        return svg(body, h);
    }

    /* ---------- 仪表盘（单指标达成率） ---------- */
    function gauge(opts) {
        var o = opts || {};
        var h = o.height || 150;
        var cx = W / 2, cy = h - 18, r = Math.min(96, h - 34);
        var value = Math.max(0, Math.min(100, Number(o.value) || 0));
        /* 轨道是上半圆：屏幕坐标 y 向下，端点角必须从 π 走到 2π 才经过顶部；
           写成 0 会让数值弧端点落到下半圆，彩色弧整段脱离轨道 */
        var start = Math.PI, end = Math.PI * 2;
        var ang = start + (end - start) * (value / 100);
        function pt(a, rad) { return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; }
        var p0 = pt(start, r), p1 = pt(end, r), pv = pt(ang, r);
        /* 调用方有传语义色（warn/danger）的：直接拼进 stroke 是无效颜色，弧会整段隐形 */
        var TONES = { success: '#2e9e5b', warn: '#d98207', danger: '#d43b3b', info: '#1668dc', brand: '#1668dc', muted: '#8a94a6' };
        var tone = TONES[o.tone] || o.tone || (value >= (o.okAt || 90) ? '#2e9e5b' : value >= (o.warnAt || 70) ? '#d98207' : '#d43b3b');
        var body = '<path d="M' + p0[0] + ' ' + p0[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + p1[0] + ' ' + p1[1] +
            '" fill="none" stroke="#eef2f7" stroke-width="13" stroke-linecap="round"/>' +
            '<path d="M' + p0[0] + ' ' + p0[1] + ' A' + r + ' ' + r + ' 0 0 1 ' + pv[0] + ' ' + pv[1] +
            '" fill="none" stroke="' + tone + '" stroke-width="13" stroke-linecap="round"/>' +
            '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle" font-size="26" font-weight="700" fill="#1f2a3a">' +
            util.round(value, 1) + '<tspan font-size="13" fill="#a4b0c2">%</tspan></text>' +
            (o.label ? '<text x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" font-size="11.5" fill="#75839a">' + esc(o.label) + '</text>' : '');
        return svg(body, h);
    }

    /* ---------- 迷你走势 ---------- */
    function sparkline(data, opts) {
        var o = opts || {};
        var h = o.height || 34, w = o.width || 120;
        var arr = (data || []).map(function (v) { return Number(v) || 0; });
        if (arr.length < 2) return '<span class="tms-dim">—</span>';
        var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr);
        var span = max - min || 1;
        var pts = arr.map(function (v, i) { return [w * (i / (arr.length - 1)), h - 3 - (h - 6) * ((v - min) / span)]; });
        var c = o.color || (arr[arr.length - 1] >= arr[0] ? '#2e9e5b' : '#d43b3b');
        return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none">' +
            '<path d="' + path(pts, true, h) + '" fill="' + c + '" fill-opacity=".12"/>' +
            '<path d="' + path(pts, false) + '" fill="none" stroke="' + c + '" stroke-width="1.6"/></svg>';
    }

    /* ---------- 漏斗（履约转化） ---------- */
    function funnel(opts) {
        var o = opts || {};
        var rows = o.data || [];
        var rowH = o.rowH || 34;
        var h = Math.max(60, rows.length * rowH + 10);
        var max = Math.max.apply(null, rows.map(function (d) { return Number(d.value) || 0; }).concat([1]));
        var body = '';
        rows.forEach(function (d, i) {
            var v = Number(d.value) || 0;
            var w = (W - 250) * (v / max);
            var x = (W - 250 - w) / 2 + 130;
            var y = i * rowH + 6;
            body += '<text x="124" y="' + (y + 17) + '" text-anchor="end" font-size="11.5" fill="#43516a">' + esc(d.label) + '</text>';
            body += '<rect x="' + util.round(x, 1) + '" y="' + y + '" width="' + util.round(Math.max(2, w), 1) + '" height="' + (rowH - 12) +
                '" rx="3" fill="' + (d.color || color(i)) + '" fill-opacity=".88"><title>' + esc(d.label) + '：' + esc(v) + '</title></rect>';
            body += '<text x="' + (W - 118) + '" y="' + (y + 17) + '" font-size="12" font-weight="600" fill="#1f2a3a">' + esc(o.fmt ? o.fmt(v) : util.fmt.number(v)) + '</text>';
            var rate = i ? util.round(v / (Number(rows[i - 1].value) || 1) * 100, 1) : 100;
            body += '<text x="' + (W - 12) + '" y="' + (y + 17) + '" text-anchor="end" font-size="10.5" fill="#a4b0c2">' + rate + '%</text>';
        });
        return svg(body || '<text x="8" y="20" font-size="12" fill="#a4b0c2">暂无数据</text>', h);
    }

    /* ---------- 热力矩阵（小时×星期、网点×状态等） ---------- */
    function heat(opts) {
        var o = opts || {};
        var cols = o.cols || [], rows = o.rows || [];   // rows: [{label, values:[..]}]
        var cell = o.cell || 46, gap = 3, headH = 22, labelW = 92;
        var h = headH + rows.length * (cell + gap) + 6;
        var max = o.max || Math.max.apply(null, rows.reduce(function (a, r) { return a.concat((r.values || []).map(function (v) { return Number(v) || 0; })); }, [0]).concat([1]));
        var body = '';
        cols.forEach(function (c, i) {
            body += '<text x="' + (labelW + i * (cell + gap) + cell / 2) + '" y="14" text-anchor="middle" font-size="10" fill="#8a94a6">' + esc(c) + '</text>';
        });
        rows.forEach(function (r, ri) {
            var y = headH + ri * (cell + gap);
            body += '<text x="' + (labelW - 8) + '" y="' + (y + cell / 2 + 4) + '" text-anchor="end" font-size="11" fill="#43516a">' + esc(r.label) + '</text>';
            (r.values || []).forEach(function (v, ci) {
                var t = max ? (Number(v) || 0) / max : 0;
                body += '<rect x="' + (labelW + ci * (cell + gap)) + '" y="' + y + '" width="' + cell + '" height="' + cell +
                    '" rx="4" fill="' + (t > 0 ? 'rgba(22,104,220,' + util.round(0.08 + t * 0.82, 2) + ')' : '#f2f5f9') + '">' +
                    '<title>' + esc(r.label) + ' / ' + esc(cols[ci] || '') + '：' + esc(v == null ? 0 : v) + '</title></rect>';
                if (v && cell >= 34) {
                    body += '<text x="' + (labelW + ci * (cell + gap) + cell / 2) + '" y="' + (y + cell / 2 + 4) +
                        '" text-anchor="middle" font-size="10.5" fill="' + (t > 0.55 ? '#fff' : '#2f3b4a') + '">' + esc(v) + '</text>';
                }
            });
        });
        return svg(body, h);
    }

    /* ---------- 散点（重量×运费之类的分布诊断） ---------- */
    function scatter(opts) {
        var o = opts || {};
        var f = frame(o, o.height || 240);
        var pts = o.points || [];
        var innerW = f.w - f.padL - f.padR, innerH = f.h - f.padT - f.padB;
        var maxX = niceMax(Math.max.apply(null, pts.map(function (p) { return Number(p.x) || 0; }).concat([1])), 4);
        var maxY = niceMax(Math.max.apply(null, pts.map(function (p) { return Number(p.y) || 0; }).concat([1])), 4);
        var body = grid(f, maxY, 4, o.fmtY);
        pts.forEach(function (p, i) {
            body += '<circle cx="' + util.round(f.padL + innerW * ((Number(p.x) || 0) / maxX), 1) + '" cy="' +
                util.round(f.padT + innerH - innerH * ((Number(p.y) || 0) / maxY), 1) + '" r="' + (p.r || 3.4) +
                '" fill="' + (p.color || color(i % 6)) + '" fill-opacity=".55" stroke="' + (p.color || color(i % 6)) + '" stroke-width="1">' +
                '<title>' + esc(p.label || '') + '　' + esc(o.xName || 'x') + ' ' + util.round(p.x, 2) + '　' + esc(o.yName || 'y') + ' ' + util.round(p.y, 2) + '</title></circle>';
        });
        if (o.trend) {
            body += '<line x1="' + f.padL + '" y1="' + util.round(f.padT + innerH - innerH * o.trend.intercept, 1) +
                '" x2="' + (f.w - f.padR) + '" y2="' + util.round(f.padT + innerH - innerH * (o.trend.slope + o.trend.intercept), 1) +
                '" stroke="#d43b3b" stroke-width="1.4" stroke-dasharray="5 4"/>';
        }
        body += '<text x="' + (f.w - f.padR) + '" y="' + (f.h - 4) + '" text-anchor="end" font-size="10.5" fill="#8a94a6">' + esc(o.xName || '') + ' 0~' + tickValue(maxX) + '</text>';
        return svg(body, f.h);
    }

    /* ---------- 雷达（绩效多维） ---------- */
    function radar(opts) {
        var o = opts || {};
        var axes = o.axes || [];
        var h = o.height || 250;
        var cx = W / 2, cy = h / 2 + 4, r = Math.min(h, 250) / 2 - 30;
        var body = '';
        function pt(i, frac) {
            var a = -Math.PI / 2 + (Math.PI * 2 * i / Math.max(1, axes.length));
            return [cx + r * frac * Math.cos(a), cy + r * frac * Math.sin(a)];
        }
        [0.25, 0.5, 0.75, 1].forEach(function (ring) {
            var d = axes.map(function (_, i) { var p = pt(i, ring); return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ') + ' Z';
            body += '<path d="' + d + '" fill="none" stroke="#e6ebf2" stroke-width="1"/>';
        });
        axes.forEach(function (a, i) {
            var p = pt(i, 1.14);
            body += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="#eef2f7"/>';
            body += '<text x="' + p[0] + '" y="' + (p[1] + 3.5) + '" text-anchor="middle" font-size="10.5" fill="#75839a">' + esc(a.label) + '</text>';
        });
        (o.series || [{ values: axes.map(function (a) { return a.value; }) }]).forEach(function (s, si) {
            var d = axes.map(function (a, i) {
                var raw = s.values && s.values[i] != null ? s.values[i] : a.value;
                var v = Math.max(0, Math.min(100, Number(raw) || 0)) / 100;
                var p = pt(i, v);
                return (i ? 'L' : 'M') + p[0] + ' ' + p[1];
            }).join(' ') + ' Z';
            var c = s.color || color(si);
            body += '<path d="' + d + '" fill="' + c + '" fill-opacity=".16" stroke="' + c + '" stroke-width="1.8"/>';
        });
        return svg(body, h) + legend((o.series || []).map(function (s, i) { return { label: s.name, color: s.color || color(i) }; }));
    }

    /* ---------- 分组对比条（网点/客服指标） ---------- */
    function compare(opts) {
        var o = opts || {};
        var rows = o.data || [];
        var rowH = o.rowH || 30;
        var h = Math.max(40, rows.length * rowH + 10);
        var labelW = 116, trackW = W - labelW - 96;
        var max = Math.max.apply(null, rows.map(function (d) { return Math.max(Number(d.value) || 0, Number(d.target) || 0); }).concat([1]));
        var body = '';
        rows.forEach(function (d, i) {
            var y = i * rowH + 6;
            var vw = trackW * ((Number(d.value) || 0) / max);
            var tw = trackW * ((Number(d.target) || 0) / max);
            body += '<text x="' + (labelW - 8) + '" y="' + (y + 14) + '" text-anchor="end" font-size="11.5" fill="#43516a">' + esc(d.label) + '</text>';
            body += '<rect x="' + labelW + '" y="' + (y + 8) + '" width="' + util.round(tw, 1) + '" height="5" rx="2.5" fill="#dfe6ee"/>';
            body += '<rect x="' + labelW + '" y="' + (y + 2) + '" width="' + util.round(Math.max(2, vw), 1) + '" height="12" rx="3" fill="' + (d.color || (Number(d.value) >= Number(d.target) ? '#2e9e5b' : '#d98207')) + '" fill-opacity=".9"><title>' +
                esc(d.label) + '：' + esc(d.value) + ' / 目标 ' + esc(d.target) + '</title></rect>';
            body += '<text x="' + (labelW + trackW + 8) + '" y="' + (y + 14) + '" font-size="11.5" fill="#1f2a3a" font-weight="600">' + esc(d.text || util.round(d.value, 1)) + '</text>';
        });
        return svg(body || '<text x="8" y="20" font-size="12" fill="#a4b0c2">暂无数据</text>', h);
    }

    TMS.charts = {
        PALETTE: PALETTE, color: color, niceMax: niceMax, legend: legend,
        line: line, bars: bars, hbars: hbars, stacked: stacked, combo: combo,
        donut: donut, gauge: gauge, sparkline: sparkline, funnel: funnel,
        heat: heat, scatter: scatter, radar: radar, compare: compare
    };
})(window);
