/* UI 组件库：字符串模板 + 事件委托，无框架、无构建
   约定：所有组件只产出 HTML 片段（TMS.ui.xxx(...) → String），由页面拼进外壳后统一注入；
        弹窗/抽屉/Toast 是唯一直接操作 DOM 的部分，因为它们要脱离页面渲染周期
   样式类名一律 tms- 前缀，与 css/app.css 一一对应——组件产出的 class 若在 CSS 里找不到就是缺陷 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util;

    /* ---------- 基础 ---------- */

    function esc(v) { return util.esc(v); }

    /* 拼 HTML 片段：null/undefined 渲染空串而不是 "undefined"；
       数组必须逐项相接，不能落到 String(v) 上——
       String(['<div>a</div>', '<div>b</div>']) 会在两段之间留下一个逗号，
       浏览器把它当作匿名栅格/弹性子项，于是 split 多出一格、卡片被挤成 1/3 宽 */
    function out(v) {
        if (v == null || v === false) return '';
        if (Array.isArray(v)) {
            var s = '';
            for (var i = 0; i < v.length; i++) s += out(v[i]);
            return s;
        }
        return String(v);
    }

    function attr(name, value) {
        if (value == null || value === false || value === '') return '';
        return ' ' + name + '="' + esc(value) + '"';
    }

    function cls() {
        var list = [];
        for (var i = 0; i < arguments.length; i++) {
            var a = arguments[i];
            if (!a) continue;
            if (typeof a === 'string') list.push(a);
            else Object.keys(a).forEach(function (k) { if (a[k]) list.push(k); });
        }
        return list.join(' ');
    }

    var fmt = util.fmt;

    function money(v) { return fmt.money(Number(v) || 0); }
    function num(v, unit) { return fmt.number(v) + (unit ? ' ' + unit : ''); }
    function pct(v) { return fmt.percent(Number(v) || 0); }
    function dash(v, fallback) { return (v == null || v === '') ? (fallback == null ? '—' : fallback) : v; }

    /* ---------- 结构块 ---------- */

    function page(opts) {
        var o = opts || {};
        return '<div class="' + cls('tms-page', o.className) + '">' +
            (o.title || o.actions ? pageHead(o) : '') +
            out(o.body) +
            (o.foot ? '<div class="tms-card tms-card-foot">' + out(o.foot) + '</div>' : '') +
            '</div>';
    }

    function pageHead(opts) {
        var o = opts || {};
        return '<div class="tms-page-head"><div>' +
            '<h2>' + esc(o.title || '') + (o.badge ? ' ' + o.badge : '') + '</h2>' +
            (o.sub ? '<div class="tms-sub">' + out(o.sub) + '</div>' : '') +
            '</div>' +
            (o.actions ? '<div class="tms-page-actions">' + out(o.actions) + '</div>' : '') +
            '</div>';
    }

    /* 卡片：title/sub/tools(右侧操作区)/body/foot/tone/left|right 布局对齐 */
    function card(opts) {
        var o = opts || {};
        var body = o.body;
        if (typeof body === 'function') body = body(o.data || o);
        return '<section class="' + cls('tms-card', o.className, o.tone && ('tms-tone-' + o.tone)) + '">' +
            (o.title || o.tools ? '<header class="tms-card-head">' +
                (o.icon ? '<span class="tms-ico">' + esc(o.icon) + '</span>' : '') +
                (o.title ? '<h3>' + out(o.title) + '</h3>' : '') +
                (o.sub ? '<span class="tms-sub">' + out(o.sub) + '</span>' : '') +
                (o.tools ? '<div class="tms-card-tools">' + out(o.tools) + '</div>' : '') +
                '</header>' : '') +
            '<div class="' + cls('tms-card-body', o.flat && 'flat', o.tight && 'tight') + '">' + out(body) + '</div>' +
            (o.foot ? '<footer class="tms-card-foot">' + out(o.foot) + '</footer>' : '') +
            '</section>';
    }

    function kpi(opts) {
        var o = opts || {};
        var trend = '';
        if (o.trend != null && o.trend !== '') {
            var up = Number(o.trend) >= 0;
            trend = '<span class="tms-trend ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' +
                Math.abs(Number(o.trend)) + (o.trendUnit || '%') + '</span>';
        }
        return '<div class="' + cls('tms-kpi', o.tone && ('tone-' + o.tone)) + '"' +
            (o.act ? ' data-act="' + esc(o.act) + '" data-arg="' + esc(o.arg == null ? '' : o.arg) + '"' : '') + '>' +
            '<div class="tms-kpi-label">' + (o.icon ? '<span class="tms-ico">' + esc(o.icon) + '</span>' : '') + esc(o.label) + '</div>' +
            '<div class="tms-kpi-value">' + out(o.value) + (o.unit ? '<small>' + esc(o.unit) + '</small>' : '') + '</div>' +
            (o.sub || trend ? '<div class="tms-kpi-sub">' + trend + out(o.sub) + '</div>' : '') +
            '</div>';
    }

    function kpis(items) {
        return '<div class="tms-kpis">' + (items || []).map(kpi).join('') + '</div>';
    }

    /* split(cols): '2' | '3' | 'side' | 'auto' */
    function split(cols, items, className) {
        var map = { '2': 'tms-split-2', '3': 'tms-split-3', side: 'tms-split-side' };
        return '<div class="' + cls('tms-split', map[cols] || 'tms-split-2', className) + '">' + out(items) + '</div>';
    }

    function row(items, className) {
        return '<div class="' + cls('tms-row', className) + '">' + (items || []).map(function (it) {
            return '<div class="tms-col">' + out(it) + '</div>';
        }).join('') + '</div>';
    }

    function stack(items, gap) {
        return '<div class="' + cls('tms-stack', gap === 'sm' && 'tms-gap-sm') + '">' + out(items) + '</div>';
    }

    function notice(text, tone, title) {
        return '<div class="' + cls('tms-notice', tone) + '">' +
            '<span class="tms-ico">' + (tone === 'danger' ? '⚠' : tone === 'warn' ? '◆' : tone === 'success' ? '✓' : 'ℹ') + '</span>' +
            '<div>' + (title ? '<b>' + esc(title) + '</b>' : '') + out(text) + '</div></div>';
    }

    function empty(text, sub, icon) {
        return '<div class="tms-empty"><span class="tms-ico">' + esc(icon || '○') + '</span>' +
            '<p>' + esc(text || '暂无数据') + '</p>' +
            (sub ? '<div class="tms-sub">' + out(sub) + '</div>' : '') + '</div>';
    }

    /* 全站页脚署名：三套外壳 + 登录页共用这一份，文案与链接都取自 cfg.brand，
       换署名只改配置一处。用 div 而非 footer，门户壳里它本就嵌在 footer 内 */
    function copyright() {
        var b = (TMS.cfg && TMS.cfg.brand) || {};
        return '<div class="tms-copyright">© ' + new Date().getFullYear() +
            ' <a href="' + esc(b.site || '#') + '" target="_blank" rel="noopener noreferrer">' +
            esc(b.author || '') + '</a></div>';
    }

    function skeleton(lines) {
        var n = lines || 4, s = '';
        for (var i = 0; i < n; i++) s += '<div class="tms-skeleton" style="width:' + (100 - i * 9) + '%"></div>';
        return s;
    }

    /* ---------- 标记 ---------- */

    function badge(text, tone, opts) {
        var o = opts || {};
        return '<span class="' + cls('tms-badge', tone && ('tone-' + tone), o.dot && 'dot', o.solid && 'solid') + '">' + out(text) + '</span>';
    }

    function chip(label, opts) {
        var o = opts || {};
        return '<span class="' + cls('tms-chip', o.on && 'on', o.act && 'clickable') + '"' +
            (o.act ? ' data-act="' + esc(o.act) + '" data-arg="' + esc(o.arg == null ? '' : o.arg) + '"' : '') + '>' +
            out(label) + (o.count != null ? ' <b class="tms-dim">' + esc(o.count) + '</b>' : '') + '</span>';
    }

    /* chips：一行可点的筛选标签。
       传 {name, value} 时点击走外壳的 chip 动作，把值写回 state.filters[name]（空串即「全部」）；
       传 {act} 时由页面自己接管点击，arg 前可加 argPrefix 拼参数。 */
    function chips(list, opts) {
        var o = opts || {};
        return (list || []).map(function (it) {
            var val = it.value == null ? it : it.value;
            var label = it.label == null ? it : it.label;
            var on = o.name != null ? String(o.value || '') === String(val) : !!it.on;
            var act = o.act || (o.name != null ? 'chip' : '');
            var arg = act === 'chip' ? o.name + '|' + val : (o.argPrefix == null ? val : o.argPrefix + val);
            return chip(label + (it.count != null ? ' ' + it.count : ''), {
                on: on, act: act, arg: arg
            });
        }).join('');
    }

    function progress(value, opts) {
        var o = opts || {};
        var max = o.max == null ? 100 : Number(o.max);
        var p = max ? Math.max(0, Math.min(100, (Number(value) || 0) / max * 100)) : 0;
        var tone = o.tone || (p >= (o.warnAt || 100) ? 'danger' : p >= (o.okAt || 80) ? 'warn' : 'success');
        return '<div class="' + cls('tms-progress', o.thin && 'thin', o.thick && 'thick', 'tone-' + tone) + '"><i style="width:' + util.round(p, 1) + '%"></i></div>';
    }

    /* 分段计量条：多段占比一眼看出结构（如成本构成、状态分布） */
    function meter(parts) {
        var total = util.sum(parts || [], function (p) { return Number(p.value) || 0; }) || 1;
        return '<div class="tms-meter">' + (parts || []).map(function (p) {
            return '<i style="width:' + util.round((Number(p.value) || 0) / total * 100, 2) + '%;background:' + esc(p.color || 'var(--tms-brand)') + '"></i>';
        }).join('') + '</div>';
    }

    function desc(items, opts) {
        var o = opts || {};
        return '<dl class="' + cls('tms-desc', o.inline && 'inline') + '">' + (items || []).filter(Boolean).map(function (it) {
            return '<div><dt>' + esc(it.label) + '</dt><dd>' + out(it.value == null ? '—' : (typeof it.value === 'function' ? it.value() : it.value)) + '</dd></div>';
        }).join('') + '</dl>';
    }

    function kv(label, value, opts) {
        var o = opts || {};
        return '<div class="' + cls('tms-kv', o.total && 'total') + '"><span>' + esc(label) + '</span><b>' + out(value) + '</b></div>';
    }

    function rank(n) {
        return '<span class="' + cls('tms-rank', n <= 3 && 'top') + '">' + n + '</span>';
    }

    function tabs(items, active) {
        return '<div class="tms-tabs">' + (items || []).map(function (it) {
            var val = it.value == null ? it : it.value;
            var label = it.label == null ? it : it.label;
            return '<button type="button" class="' + (String(active) === String(val) ? 'on' : '') +
                '" data-act="tab" data-arg="' + esc(val) + '">' + esc(label) +
                (it.count != null ? '<span class="tms-count">' + esc(it.count) + '</span>' : '') + '</button>';
        }).join('') + '</div>';
    }

    /* 履约进度步骤条：{label,time,state:done|current|late|todo} */
    function steps(items) {
        return '<div class="tms-steps">' + (items || []).map(function (s) {
            return '<div class="tms-step ' + esc(s.state || 'todo') + '">' +
                '<div class="tms-node">' + (s.state === 'done' ? '✓' : s.state === 'late' ? '!' : (s.icon || '·')) + '</div>' +
                '<div class="tms-step-name">' + esc(s.label) + '</div>' +
                '<div class="tms-step-time">' + out(s.time || '') + '</div></div>';
        }).join('') + '</div>';
    }

    /* 轨迹时间轴：{title,time,body,tone} */
    function timeline(items) {
        if (!items || !items.length) return empty('暂无作业留痕');
        return '<div class="tms-timeline">' + items.map(function (it) {
            return '<div class="tms-tl-item ' + esc(it.tone || 'ok') + '">' +
                '<div class="tms-tl-head"><b>' + out(it.title) + '</b><span>' + out(it.time || '') + '</span>' +
                (it.badge ? '<span style="margin-left:auto">' + it.badge + '</span>' : '') + '</div>' +
                (it.body ? '<div class="tms-tl-body">' + out(it.body) + '</div>' : '') + '</div>';
        }).join('') + '</div>';
    }

    function list(items, opts) {
        var o = opts || {};
        return '<div class="tms-list">' + (items || []).map(function (it) {
            return '<div class="' + cls('tms-list-item', it.act && 'clickable') + '"' +
                (it.act ? ' data-act="' + esc(it.act) + '" data-arg="' + esc(it.arg == null ? '' : it.arg) + '"' : '') + '>' +
                (it.left || '') +
                '<div class="tms-li-main"><div class="tms-li-title">' + out(it.title) + '</div>' +
                (it.sub ? '<div class="tms-li-sub">' + out(it.sub) + '</div>' : '') + '</div>' +
                (it.right || '') + '</div>';
        }).join('') + (items && items.length ? '' : empty(o.empty || '暂无记录')) + '</div>';
    }

    /* ---------- 按钮 / 图标 ---------- */

    function btn(label, opts) {
        var o = opts || {};
        var tone = o.tone || o.kind;
        return '<button type="' + (o.type || 'button') + '" class="' + cls('tms-btn', tone, o.size, o.block && 'block', o.disabled && 'disabled', o.className) + '"' +
            attr('data-act', o.act) + attr('data-arg', o.arg == null ? '' : o.arg) +
            (o.disabled ? ' disabled' : '') + attr('title', o.title) + '>' +
            (o.icon ? '<span class="tms-ico">' + esc(o.icon) + '</span>' : '') + esc(label) + '</button>';
    }

    function link(label, act, arg, opts) {
        var o = opts || {};
        return '<span class="tms-btn xs' + (o.tone ? ' ' + o.tone : '') + '" data-act="' + esc(act) + '" data-arg="' + esc(arg == null ? '' : arg) + '">' +
            (o.icon ? esc(o.icon) + ' ' : '') + esc(label) + '</span>';
    }

    function iconBtn(glyph, act, title, opts) {
        var o = opts || {};
        return '<button type="button" class="' + cls('tms-iconbtn', o.on && 'on') + '"' + attr('data-act', act) +
            attr('data-arg', o.arg == null ? '' : o.arg) + attr('title', title) + '>' + esc(glyph) +
            (o.dot ? '<span class="tms-dot">' + esc(o.dot) + '</span>' : '') + '</button>';
    }

    function seg(items, active) {
        return '<div class="tms-seg">' + (items || []).map(function (it) {
            var val = it.value == null ? it : it.value;
            var label = it.label == null ? it : it.label;
            return '<button type="button" class="' + (String(active) === String(val) ? 'on' : '') +
                '" data-act="seg" data-arg="' + esc(val) + '">' + esc(label) + '</button>';
        }).join('') + '</div>';
    }

    /* ---------- 表单 ---------- */

    var CITY_DATALIST = null;
    function cityList() {
        if (!CITY_DATALIST) {
            CITY_DATALIST = (TMS.master && TMS.master.CITIES ? TMS.master.CITIES : []).map(function (c) { return c.name; });
        }
        return CITY_DATALIST;
    }

    function normalizeOptions(options) {
        if (!options) return [];
        var list = typeof options === 'function' ? options() : options;
        return (list || []).map(function (it) {
            if (it == null) return { value: '', label: '' };
            if (typeof it === 'object') return { value: it.value == null ? it.id : it.value, label: it.label == null ? (it.name || it.id) : it.label, disabled: it.disabled };
            return { value: it, label: it };
        });
    }

    function optionsHtml(options, value) {
        return normalizeOptions(options).map(function (o) {
            return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(value) ? ' selected' : '') +
                (o.disabled ? ' disabled' : '') + '>' + esc(o.label) + '</option>';
        }).join('');
    }

    /* field(def, value, domId)：def.type 决定控件形态，未知 type 一律当 text（不静默丢弃）
       domId 只在同一页要放两组同名字段时才需要（筛选栏用它避开重复 id） */
    function field(def, value, domId) {
        var f = typeof def === 'string' ? { key: def, label: def } : (def || {});
        var v = value == null ? (f.value == null ? '' : f.value) : value;
        var type = f.type || 'text';
        var id = domId || 'f_' + f.key;
        var change = attr('data-change', f.change);
        var input;
        var datalist = '';

        if (type === 'hidden') return '<input type="hidden" name="' + esc(f.key) + '" value="' + esc(v) + '">';

        if (type === 'select') {
            input = '<select class="tms-select" id="' + id + '" name="' + esc(f.key) + '"' + change + (f.multiple ? ' multiple' : '') + (f.disabled ? ' disabled' : '') + '>' +
                (f.placeholder !== false ? '<option value="">' + esc(f.placeholder || '请选择') + '</option>' : '') +
                optionsHtml(f.options, v) + '</select>';
        } else if (type === 'textarea') {
            input = '<textarea class="tms-textarea" id="' + id + '" name="' + esc(f.key) + '" rows="' + (f.rows || 3) + '"' + change +
                attr('placeholder', f.placeholder) + (f.required ? ' required' : '') + '>' + esc(v) + '</textarea>';
        } else if (type === 'static') {
            input = '<div class="tms-input" style="background:var(--tms-bg-2)">' + out(f.render ? f.render(v) : dash(v)) + '</div>';
        } else if (type === 'checkbox') {
            return '<label class="tms-check" style="padding-top:20px"><input type="checkbox" id="' + id + '" name="' + esc(f.key) + '"' +
                (v ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>';
        } else if (type === 'radio') {
            input = normalizeOptions(f.options).map(function (o) {
                return '<label class="tms-check" style="margin-right:12px"><input type="radio" name="' + esc(f.key) + '" value="' + esc(o.value) + '"' + change +
                    (String(o.value) === String(v) ? ' checked' : '') + '><span>' + esc(o.label) + '</span></label>';
            }).join('');
        } else if (type === 'city') {
            datalist = '<datalist id="tms-cities">' + cityList().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>';
            input = '<input class="tms-input" id="' + id + '" name="' + esc(f.key) + '" list="tms-cities" value="' + esc(v) + '"' + change +
                attr('placeholder', f.placeholder || '输入城市名') + (f.required ? ' required' : '') + ' autocomplete="off">';
        } else if (type === 'datetime') {
            input = '<input class="tms-input" id="' + id + '" type="datetime-local" name="' + esc(f.key) + '" value="' + esc(String(v || '').slice(0, 16)) + '"' + change + (f.disabled ? ' disabled' : '') + '>';
        } else if (type === 'date') {
            input = '<input class="tms-input" id="' + id + '" type="date" name="' + esc(f.key) + '" value="' + esc(String(v || '').slice(0, 10)) + '"' + change + (f.disabled ? ' disabled' : '') + '>';
        } else if (type === 'number') {
            input = '<input class="tms-input" id="' + id + '" type="number" name="' + esc(f.key) + '" value="' + esc(v) + '"' + change +
                attr('placeholder', f.placeholder) + attr('min', f.min) + attr('max', f.max) + attr('step', f.step || 'any') +
                (f.readonly ? ' readonly' : '') + (f.required ? ' required' : '') + '>';
        } else {
            input = '<input class="tms-input" id="' + id + '" type="' + (type === 'password' ? 'password' : 'text') + '" name="' + esc(f.key) + '" value="' + esc(v) + '"' + change +
                attr('placeholder', f.placeholder) + (f.readonly ? ' readonly' : '') + (f.disabled ? ' disabled' : '') +
                attr('maxlength', f.maxlength) + (f.required ? ' required' : '') + ' autocomplete="off">';
        }

        /* prepend/append 单位、prefix/suffix 文本一律渲染进 input-group，不依赖组件外部样式 */
        if (f.unit || f.prefix || f.suffix) {
            input = '<div class="tms-input-group">' + (f.prefix ? '<span class="tms-addon">' + esc(f.prefix) + '</span>' : '') +
                input + (f.unit || f.suffix ? '<span class="tms-addon">' + esc(f.unit || f.suffix) + '</span>' : '') + '</div>';
        }

        return '<div class="' + cls('tms-field', f.span === 2 && 'span-2') + '"' + (f.when ? ' data-when="' + esc(f.when) + '"' : '') + '>' +
            '<label for="' + id + '">' + esc(f.label || f.key) + (f.required ? ' <em>*</em>' : '') +
            (f.tip ? ' <span class="tms-dim" title="' + esc(f.tip) + '">ⓘ</span>' : '') + '</label>' +
            input + datalist + (f.hint ? '<span class="tms-hint">' + out(f.hint) + '</span>' : '') +
            '</div>';
    }

    function form(opts) {
        var o = opts || {};
        var values = o.values || {};
        return '<form class="' + cls('tms-form', o.className) + '"' + (o.name ? ' name="' + esc(o.name) + '"' : '') +
            (o.id ? ' id="' + esc(o.id) + '"' : '') + ' onsubmit="return false">' +
            (o.notice || '').toString() +
            (o.fields || []).map(function (f) { return field(f, values[f.key]); }).join('') +
            (o.error ? '<div class="tms-form-error">' + esc(o.error) + '</div>' : '') +
            (o.extra ? '<div class="span-2">' + out(o.extra) + '</div>' : '') +
            (o.actions === false ? '' : '<div class="tms-form-actions span-2">' + out(o.actions) + '</div>') +
            '</form>';
    }

    /* 读取表单值：name → value，checkbox 取布尔，number 取数值 */
    function values(root) {
        var out = {};
        if (!root) return out;
        var nodes = root.querySelectorAll ? root.querySelectorAll('input[name],select[name],textarea[name]') : [];
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i], key = el.name;
            if (el.type === 'checkbox') out[key] = !!el.checked;
            else if (el.type === 'radio') { if (el.checked) out[key] = el.value; }
            else if (el.type === 'number') out[key] = el.value === '' ? '' : Number(el.value);
            else if (el.tagName === 'SELECT' && el.multiple) {
                out[key] = Array.prototype.slice.call(el.options).filter(function (x) { return x.selected; }).map(function (x) { return x.value; });
            } else out[key] = el.value;
        }
        return out;
    }

    /* ---------- 弹层（直接操作 DOM） ---------- */

    var modalStack = [];

    function overlay(inner, opts) {
        var o = opts || {};
        var wrap = document.createElement('div');
        wrap.className = 'tms-overlay' + (o.className ? ' ' + o.className : '');
        wrap.innerHTML = inner;
        document.body.appendChild(wrap);
        var close = function () {
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
            var i = modalStack.indexOf(handle);
            if (i > -1) modalStack.splice(i, 1);
            if (o.onClose) o.onClose();
        };
        var handle = { el: wrap, close: close, body: wrap.querySelector('.tms-modal-body, .tms-drawer-body') || wrap };
        wrap.addEventListener('click', function (e) {
            if (e.target === wrap && o.dismiss !== false) close();
        });
        modalStack.push(handle);
        global.setTimeout(function () {
            var first = wrap.querySelector('input:not([type=hidden]):not([readonly]),textarea,select');
            if (first && !o.noFocus) first.focus();
        }, 30);
        return handle;
    }

    function modal(opts) {
        var o = opts || {};
        var inner = '<div class="' + cls('tms-modal', o.size) + '">' +
            (o.title ? '<header class="tms-modal-head"><div><h3>' + out(o.title) + '</h3>' +
                (o.sub ? '<div class="tms-sub">' + out(o.sub) + '</div>' : '') + '</div>' +
                '<button type="button" class="tms-modal-close" data-close>×</button></header>' : '') +
            '<div class="tms-modal-body">' + out(o.body) + '</div>' +
            (o.footer === false ? '' : '<footer class="tms-modal-foot">' + out(o.footer) + '</footer>') +
            '</div>';
        var handle = overlay(inner, o);
        var x = handle.el.querySelector('[data-close]');
        if (x) x.addEventListener('click', handle.close);
        return handle;
    }

    function drawer(opts) {
        var o = opts || {};
        var inner = '<div class="tms-drawer-panel">' +
            '<header class="tms-drawer-head">' + (o.back ? link(o.back, 'drawer:close', '', { icon: '←' }) : '') +
            '<div><h3 style="font-size:15px">' + out(o.title || '') + '</h3>' +
            (o.sub ? '<div class="tms-sub">' + out(o.sub) + '</div>' : '') + '</div>' +
            '<button type="button" class="tms-modal-close" data-close style="margin-left:auto">×</button></header>' +
            '<div class="tms-drawer-body">' + out(o.body) + '</div>' +
            (o.footer ? '<footer class="tms-drawer-foot">' + out(o.footer) + '</footer>' : '') +
            '</div>';
        var wrap = document.createElement('div');
        wrap.className = 'tms-drawer';
        wrap.innerHTML = inner;
        document.body.appendChild(wrap);
        var handle = {
            el: wrap, body: wrap.querySelector('.tms-drawer-body'),
            close: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); if (o.onClose) o.onClose(); }
        };
        wrap.querySelector('[data-close]').addEventListener('click', handle.close);
        wrap.addEventListener('click', function (e) { if (e.target === wrap && o.dismiss !== false) handle.close(); });
        return handle;
    }

    function confirm(opts) {
        var o = typeof opts === 'string' ? { message: opts } : (opts || {});
        return new Promise(function (resolve) {
            var done = false;
            var finish = function (v) { if (!done) { done = true; resolve(v); } };
            var handle = modal({
                size: 'narrow',
                title: o.title || '请确认',
                body: '<div style="font-size:13.5px;line-height:1.7">' + out(o.message || '确定执行该操作？') + '</div>' +
                    (o.detail ? '<div class="tms-notice ' + (o.danger ? 'danger' : 'warn') + '" style="margin-top:10px">' + out(o.detail) + '</div>' : ''),
                dismiss: false,
                footer: btn(o.cancelText || '取消', { act: 'no' }) +
                    btn(o.okText || '确定', { tone: o.danger ? 'danger' : 'primary', act: 'yes' }),
                onClose: function () { finish(false); }
            });
            handle.el.addEventListener('click', function (e) {
                var t = e.target.closest ? e.target.closest('[data-act]') : null;
                if (!t) return;
                var yes = t.getAttribute('data-act') === 'yes';
                handle.close();
                finish(yes);
            });
            handle.el.querySelectorAll('.tms-btn').forEach(function (b) { b.style.cursor = 'pointer'; });
        });
    }

    /* formModal：字段驱动的业务弹窗
       opts = {title, sub, fields, values, notice, extra, okText, cancel:false, width,
               onSubmit(values, ctx) → true/undefined 关闭，字符串 → 作为错误信息留在弹窗内}
       notice/extra 是被显式消费的扩展位：notice 顶部提示条，extra 表单下方自定义块 */
    function formModal(opts) {
        var o = opts || {};
        var handle = null;
        var render = function (error) {
            handle.body.innerHTML = form({
                fields: o.fields, values: o.values, notice: o.notice || '', error: error,
                extra: o.extra, actions: false
            });
            var foot = handle.el.querySelector('.tms-modal-foot');
            foot.innerHTML = (o.footNote ? '<span class="tms-note">' + out(o.footNote) + '</span>' : '') +
                (o.cancel === false ? '' : btn('取消', { act: 'ui:close' })) +
                btn(o.okText || '提交', { tone: o.danger ? 'danger' : 'primary', act: 'ui:submit' });
        };
        handle = modal({
            size: o.size || (o.fields && o.fields.length > 6 ? 'wide' : ''),
            title: o.title, sub: o.sub, body: '', dismiss: false,
            onClose: function () { if (o.onClose) o.onClose(); }
        });
        render('');
        handle.el.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target.closest('[data-act]') : null;
            if (!t) return;
            var act = t.getAttribute('data-act');
            if (act === 'ui:close') handle.close();
            else if (act === 'ui:submit') {
                var data = values(handle.el.querySelector('form'));
                var res = o.onSubmit ? o.onSubmit(data, handle) : undefined;
                if (res && typeof res === 'string') render(res);
                else if (res === false) { /* 保持打开，由调用方接管 */ }
                else handle.close();
            } else if (o.onAction) {
                o.onAction(act, t.getAttribute('data-arg'), values(handle.el.querySelector('form')));
            }
        });
        handle.el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                var s = handle.el.querySelector('[data-act="ui:submit"]');
                if (s) { e.preventDefault(); s.click(); }
            }
        });
        return handle;
    }

    /* ---------- Toast ---------- */

    var toastBox = null;
    function toast(message, type, ms) {
        if (!global.document || !document.body) return;
        if (!toastBox) {
            toastBox = document.createElement('div');
            toastBox.className = 'tms-toasts';
            document.body.appendChild(toastBox);
        }
        var el = document.createElement('div');
        el.className = 'tms-toast ' + (type || 'info');
        el.innerHTML = '<span class="tms-ico">' + (type === 'error' ? '✕' : type === 'success' ? '✓' : type === 'warn' ? '⚠' : 'ℹ') + '</span>' +
            '<div>' + out(message) + '</div>';
        toastBox.appendChild(el);
        var life = ms || (type === 'error' ? 5200 : 2600);
        global.setTimeout(function () {
            el.className += ' out';
            global.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
        }, life);
    }

    /* ---------- 浮层菜单 ---------- */

    function popup(anchor, items, opts) {
        var o = opts || {};
        closePopup();
        var box = document.createElement('div');
        box.className = 'tms-pop';
        box.innerHTML = (o.title ? '<div class="tms-pop-head">' + esc(o.title) + '</div>' : '') +
            (items || []).map(function (it) {
                if (it === '-') return '<div class="tms-pop-sep"></div>';
                return '<div class="' + cls('tms-pop-item', it.on && 'on', it.tone === 'danger' && 'danger') + '"' +
                    attr('data-act', it.act) + attr('data-arg', it.arg == null ? '' : it.arg) + '>' +
                    (it.icon ? '<span class="tms-ico">' + esc(it.icon) + '</span>' : '') + '<span>' + out(it.label) + '</span>' +
                    (it.right ? '<span class="tms-dim" style="margin-left:auto">' + out(it.right) + '</span>' : '') + '</div>';
            }).join('');
        document.body.appendChild(box);
        var rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 8, bottom: 8 };
        var w = box.offsetWidth, h = box.offsetHeight;
        var left = Math.max(8, Math.min(window.innerWidth - w - 8, o.align === 'left' ? rect.left : rect.right - w));
        var top = rect.bottom + 6;
        if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
        box.style.position = 'fixed';
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        popup.current = box;
        box.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target.closest('[data-act]') : null;
            if (!t) return;
            var act = t.getAttribute('data-act'), arg = t.getAttribute('data-arg');
            closePopup();
            if (o.onPick) o.onPick(act, arg);
            else fire(document, act, arg, t);
        });
        global.setTimeout(function () {
            var away = function (ev) {
                if (box.parentNode && !box.contains(ev.target) && !anchor.contains(ev.target)) {
                    closePopup();
                    document.removeEventListener('mousedown', away);
                }
            };
            document.addEventListener('mousedown', away);
            box._away = away;
        }, 0);
        return box;
    }

    function closePopup() {
        if (popup.current) {
            if (popup.current._away) document.removeEventListener('mousedown', popup.current._away);
            if (popup.current.parentNode) popup.current.parentNode.removeChild(popup.current);
            popup.current = null;
        }
    }

    /* ---------- 事件委托 ---------- */

    function on(root, type, selector, handler) {
        var r = root || document;
        var fn = function (e) {
            var t = e.target && e.target.closest ? e.target.closest(selector) : null;
            if (!t || !r.contains(t)) return;
            handler(t, e);
        };
        r.addEventListener(type, fn);
        return function () { r.removeEventListener(type, fn); };
    }

    /* fire：把 data-act 派发给当前注册的 action 表（由 shell 装配） */
    function fire(root, act, arg, el) {
        var table = ui.actions || {};
        var fn = table[act];
        if (!fn) {
            if (global.console) console.warn('[TMS.ui] 未注册的动作：' + act);
            return false;
        }
        try { fn(arg, el); } catch (err) {
            toast('操作失败：' + (err && err.message ? err.message : err), 'error');
            if (global.console) console.error(err);
        }
        return true;
    }

    /* bindActions：在容器上装一次委托，后续 TMS.ui.actions 换表也不需要重新绑定 */
    function bindActions(root) {
        var r = root || document;
        if (r._tmsAct) return;
        r._tmsAct = true;
        on(r, 'click', '[data-act]', function (el, e) {
            var act = el.getAttribute('data-act');
            if (act === 'ui:close') { closeTop(); return; }
            if (e.cancelable && el.tagName !== 'A') e.preventDefault();
            fire(r, act, el.getAttribute('data-arg'), el);
        });
        on(r, 'change', '[data-change]', function (el) {
            fire(r, el.getAttribute('data-change'), el.value, el);
        });
    }

    function closeTop() {
        if (modalStack.length) modalStack.pop().close();
        else closePopup();
    }

    /* Esc 关弹窗 */
    if (global.document) {
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeTop();
        });
    }

    /* ---------- 表格 ---------- */

    /* table({columns:[{key,label,width,align,className,sortable,render(row,i),sub(row)}],
             rows, empty, dense, zebra, onRow:'order:open'（点击行触发的动作键）, selected})
       render 返回 HTML 片段（已包含徽章/链接），故列内容不做二次转义——列内自由文本请用 esc() */
    function table(opts) {
        var o = opts || {};
        var cols = o.columns || [];
        var rows = o.rows || [];
        if (!rows.length) return empty(o.emptyText || '没有符合条件的数据', o.emptySub, o.emptyIcon);
        var head = '<tr>' + cols.map(function (c) {
            return '<th class="' + cls(c.align, c.sortable !== false && c.key && 'sortable', c.sorted && 'sorted', c.headClass) + '"' +
                (c.width ? ' style="width:' + esc(c.width) + '"' : '') +
                (c.sortable !== false && c.key ? ' data-act="sort" data-arg="' + esc(c.key) + '"' : '') + '>' +
                esc(c.label) + (c.sorted ? '<span class="tms-sort">' + (c.dir === 'asc' ? '▲' : '▼') + '</span>' : '') + '</th>';
        }).join('') + '</tr>';
        var body = rows.map(function (row, i) {
            var tds = cols.map(function (c) {
                var v = c.render ? c.render(row, i) : esc(row[c.key] == null ? '—' : row[c.key]);
                return '<td class="' + cls(c.align, c.className) + '"' + (c.nowrap === false ? '' : ' style="white-space:nowrap"') + '>' + v + '</td>';
            }).join('');
            return '<tr class="' + cls(o.onRow && 'clickable', o.selected && o.selected === rowId(row, o) && 'selected') + '"' +
                (o.onRow ? ' data-act="' + esc(o.onRow) + '" data-arg="' + esc(rowId(row, o)) + '"' : '') + '>' + tds + '</tr>';
        }).join('');
        return '<div class="' + cls('tms-table-wrap', o.scroll && 'tms-scroll-y') + '"><table class="' + cls('tms-table', o.dense && 'dense', o.zebra && 'zebra', o.className) + '">' +
            '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }

    function rowId(row, o) {
        return row[(o && o.keyName) || 'id'] || '';
    }

    /* 移动端的表格降级：同一份 rows/columns 渲染为卡片列表 */
    function cards(opts) {
        var o = opts || {};
        var rows = o.rows || [];
        if (!rows.length) return empty(o.emptyText || '没有符合条件的数据');
        var cols = (o.columns || []).filter(function (c) { return c.mobile !== false; });
        return '<div class="tms-cards">' + rows.map(function (row) {
            var main = cols[0], rest = cols.slice(1);
            return '<article class="tms-datacard"' + (o.onRow ? ' data-act="' + esc(o.onRow) + '" data-arg="' + esc(rowId(row, o)) + '"' : '') + '>' +
                '<div class="tms-datacard-head"><span class="tms-title">' + (main ? out(main.render ? main.render(row) : esc(row[main.key])) : '') + '</span>' +
                (o.badge ? out(o.badge(row)) : '') + '</div>' +
                (rest.length ? '<div class="tms-datacard-grid">' + rest.map(function (c) {
                    return '<div>' + esc(c.label) + '<b>' + out(c.render ? c.render(row) : esc(row[c.key] == null ? '—' : row[c.key])) + '</b></div>';
                }).join('') + '</div>' : '') +
                (o.actions ? '<div class="tms-datacard-foot">' + out(o.actions(row)) + '</div>' : '') +
                '</article>';
        }).join('') + '</div>';
    }

    function pager(state, opts) {
        var o = opts || {};
        var page = Math.max(1, Number(state.page) || 1);
        var pages = Math.max(1, Number(state.pages) || 1);
        var win = [];
        var from = Math.max(1, page - 2), to = Math.min(pages, from + 4);
        for (var i = from; i <= to; i++) win.push(i);
        return '<div class="tms-pager"><span>' + esc(o.label || '共') + ' <b class="tms-strong">' + fmt.number(state.total || 0) + '</b> ' +
            esc(o.unit || '条') + (state.rows && state.rows.length ? '，本页 ' + state.rows.length + ' 条' : '') + '</span>' +
            (o.sizeOptions ? '<span>每页 ' + '<select class="tms-select" style="width:auto;display:inline-block;padding:2px 6px" data-change="page:size">' +
                optionsHtml(o.sizeOptions, state.pageSize) + '</select></span>' : '') +
            '<div class="tms-pager-btns">' +
            '<button type="button" data-act="page" data-arg="1"' + (page <= 1 ? ' disabled' : '') + '>«</button>' +
            '<button type="button" data-act="page" data-arg="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>‹</button>' +
            win.map(function (n) {
                return '<button type="button" class="' + (n === page ? 'on' : '') + '" data-act="page" data-arg="' + n + '">' + n + '</button>';
            }).join('') +
            '<button type="button" data-act="page" data-arg="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>›</button>' +
            '<button type="button" data-act="page" data-arg="' + pages + '"' + (page >= pages ? ' disabled' : '') + '>»</button>' +
            '</div></div>';
    }

    /* 筛选栏：字段与 field() 同构，值从 state 取；控件自动带 data-change="filter"，
       外壳委托后由页面把 change 写回 state 并重渲染，输入即筛选无需回车 */
    var filterSeq = 0;
    function filters(fields, state, opts) {
        var o = opts || {};
        return '<div class="tms-filters">' + (fields || []).map(function (f) {
            var def = {};
            Object.keys(f).forEach(function (k) { def[k] = f[k]; });
            if (!def.type) def.type = 'select';
            if (!def.change) def.change = 'filter';
            /* 一页放两张表时同名筛选框会撞 id，label 指到上面那张的输入口：
               id 每次渲染递增，name 保持字段名不变（委托靠 name 回写状态） */
            def.key = def.key || 'f';
            var id = 'flt_' + (++filterSeq) + '_' + def.key;
            var isSearch = def.type === 'search';
            if (isSearch) { def.type = 'text'; def.placeholder = def.placeholder || def.label || '单号 / 客户 / 地址'; }
            var html = field(def, (state || {})[f.key], id);
            /* 每格都包一个 tms-filter：栅格宽度给外壳，输入框自己填满，
               不包的话 .tms-field 只是包装 div 的后代，flex 尺寸根本落不到栏位上 */
            return '<div class="tms-filter' + (isSearch ? ' tms-search' : '') + '">' + (isSearch ? '<span class="tms-ico">⌕</span>' : '') + html + '</div>';
        }).join('') +
            (o.actions ? '<div class="tms-filter-actions">' + out(o.actions) + '</div>' : '') +
            '</div>';
    }

    /* ---------- 业务字典渲染（页面共用，避免每页重复映射表） ---------- */

    var STATUS_TONE = {
        created: 'info', collected: 'info', inbound: 'brand', sorted: 'brand', transit: 'warn',
        arrived: 'brand', delivering: 'warn', signed: 'success', problem: 'danger', returned: 'muted', cancelled: 'muted',
        pending: 'warn', processing: 'info', resolved: 'success', closed: 'muted', escalated: 'danger',
        active: 'success', inactive: 'muted', online: 'success', offline: 'muted', fault: 'danger',
        busy: 'warn', available: 'success', maintenance: 'info',
        unpaid: 'danger', paid: 'success', overdue: 'danger', partial: 'warn', settled: 'success', unsettled: 'warn',
        open: 'warn', draft: 'muted', confirmed: 'success', approved: 'success', rejected: 'danger', submitted: 'info',
        pending_review: 'warn', loading: 'info', departed: 'warn', completed: 'success',
        low: 'warn', out: 'danger', normal: 'success', plan: 'info'
    };

    function statusTone(status) { return STATUS_TONE[status] || 'muted'; }

    function statusLabel(status) {
        if (TMS.cfg.orderLabels[status]) return TMS.cfg.orderLabels[status];
        return String(status == null ? '—' : status);
    }

    function statusBadge(status, label) {
        return badge(label || statusLabel(status), statusTone(status), { dot: true });
    }

    /* 常用选项：直接给表单/筛选栏用，避免各页手抄字典 */
    function optionsOf(list, valueKey, labelKey) {
        return (list || []).map(function (r) {
            return { value: valueKey ? r[valueKey] : r, label: labelKey ? r[labelKey] : r };
        });
    }

    function statusOptions() {
        return TMS.order.statusOptions ? TMS.order.statusOptions() : TMS.cfg.orderFlow.map(function (s) {
            return { value: s, label: TMS.cfg.orderLabels[s] };
        });
    }

    /* ---------- 数字排版 ---------- */

    function delta(value, opts) {
        var o = opts || {};
        var v = Number(value) || 0;
        var tone = o.invert ? (v > 0 ? 'danger' : v < 0 ? 'success' : 'muted') : (v > 0 ? 'success' : v < 0 ? 'danger' : 'muted');
        var sign = v > 0 ? '+' : '';
        return '<span class="tms-badge tone-' + tone + '">' + sign + util.round(v, o.digits == null ? 1 : o.digits) + (o.unit || '') + '</span>';
    }

    function moneyCell(v, opts) {
        var o = opts || {};
        return '<span class="tms-money' + (o.strong ? ' strong' : '') + '">' + money(v) + '</span>';
    }

    function timeCell(v) { return '<span class="tms-nowrap tms-dim">' + esc(fmt.dateTime(v)) + '</span>'; }

    function idCell(v, act, opts) {
        var o = opts || {};
        return '<span class="' + (act ? 'link' : 'tms-mono') + '"' + (act ? ' data-act="' + esc(act) + '" data-arg="' + esc(v) + '"' : '') + '>' +
            esc(o.short ? String(v).slice(-8) : v) + '</span>';
    }

    var ui = {
        esc: esc, out: out, cls: cls, fmt: fmt, money: money, num: num, pct: pct, dash: dash,
        page: page, pageHead: pageHead, card: card, kpi: kpi, kpis: kpis, split: split, row: row, stack: stack,
        notice: notice, empty: empty, skeleton: skeleton, copyright: copyright,
        badge: badge, chip: chip, chips: chips, progress: progress, meter: meter, desc: desc, kv: kv, rank: rank,
        tabs: tabs, steps: steps, timeline: timeline, list: list,
        btn: btn, link: link, iconBtn: iconBtn, seg: seg,
        field: field, form: form, values: values, optionsHtml: optionsHtml, normalizeOptions: normalizeOptions,
        modal: modal, drawer: drawer, confirm: confirm, formModal: formModal, toast: toast, popup: popup, closePopup: closePopup, closeTop: closeTop,
        table: table, cards: cards, pager: pager, filters: filters,
        on: on, fire: fire, bindActions: bindActions,
        statusTone: statusTone, statusLabel: statusLabel, statusBadge: statusBadge,
        optionsOf: optionsOf, statusOptions: statusOptions,
        delta: delta, moneyCell: moneyCell, timeCell: timeCell, idCell: idCell,
        actions: {},
        /* 页面状态机：列表页的 页码/排序/筛选 统一由 kit 保管，跨渲染不丢 */
        state: function (key, init) {
            ui.state.map = ui.state.map || {};
            if (!ui.state.map[key]) ui.state.map[key] = init || { page: 1, pageSize: TMS.cfg.pageSize, sort: null, dir: 'desc', filters: {} };
            return ui.state.map[key];
        },
        /* 同一个状态对象挂到多个键上：页面自己持有的 ctx.state 与列表卡片上的 data-sk
           必须指向同一份，否则委托写回的是列表状态、页面读的却是页状态，筛选会「点了不生效」 */
        useState: function (key, obj) {
            ui.state.map = ui.state.map || {};
            if (obj) ui.state.map[key] = obj;
            return ui.state(key);
        },
        resetState: function (key) { if (ui.state.map) delete ui.state.map[key]; }
    };

    TMS.ui = ui;
})(window);
