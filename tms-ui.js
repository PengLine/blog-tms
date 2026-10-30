/**
 * TMS 共享 UI 组件库
 * ------------------------------------------------------------
 * 提供列表、搜索/筛选/分页、表单弹窗、确认框、Toast、SVG 图表等能力。
 * 所有组件以 tms- 前缀命名，避免与各页面原有样式冲突。
 */
(function (global) {
    'use strict';

    /* ============================== 基础 ============================== */

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    var fmt = {
        date: function (value) {
            if (!value) return '-';
            var d = new Date(value);
            if (isNaN(d)) return String(value);
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        },
        dateTime: function (value) {
            if (!value) return '-';
            var d = new Date(value);
            if (isNaN(d)) return String(value);
            return fmt.date(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        },
        time: function (value) {
            if (!value) return '-';
            var d = new Date(value);
            if (isNaN(d)) return String(value);
            return pad(d.getHours()) + ':' + pad(d.getMinutes());
        },
        money: function (value) {
            var n = Number(value || 0);
            return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        number: function (value) {
            return Number(value || 0).toLocaleString('zh-CN');
        },
        percent: function (value, digits) {
            var n = Number(value || 0);
            return n.toFixed(digits == null ? 1 : digits) + '%';
        }
    };

    var STATUS_CLASS = {
        pending: 'warn', processing: 'info', resolved: 'success', closed: 'muted',
        inbound: 'info', sorted: 'info', shipping: 'info', arrived: 'warn',
        delivering: 'warn', signed: 'success', cancelled: 'muted',
        done: 'success', completed: 'success', active: 'success', inactive: 'muted',
        online: 'success', transporting: 'info', maintenance: 'danger', offline: 'muted',
        approved: 'success', rejected: 'danger', paid: 'success',
        settled: 'success', void: 'muted', normal: 'success', low: 'warn', out: 'danger',
        available: 'success', busy: 'warn', expired: 'muted',
        suspended: 'danger', on_leave: 'warn', resigned: 'muted',
        unpaid: 'warn', partial: 'info', overdue: 'danger',
        draft: 'muted', confirmed: 'info', disputed: 'danger'
    };

    function statusBadge(status, entity) {
        var labels = (global.TmsStore && global.TmsStore.labels[entity]) || {};
        var label = labels[status] || status || '-';
        var cls = STATUS_CLASS[status] || 'muted';
        return '<span class="tms-badge tms-badge-' + cls + '">' + esc(label) + '</span>';
    }

    function badge(text, tone) {
        return '<span class="tms-badge tms-badge-' + (tone || 'muted') + '">' + esc(text) + '</span>';
    }

    function uniqueId(prefix) {
        return (prefix || 'tms') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ============================== Toast ============================== */

    function toast(message, type, duration) {
        var container = document.getElementById('tms-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tms-toast-container';
            container.className = 'tms-toast-container';
            document.body.appendChild(container);
        }
        var el = document.createElement('div');
        el.className = 'tms-toast tms-toast-' + (type || 'info');
        el.innerHTML = '<span class="tms-toast-dot"></span><span>' + esc(message) + '</span>';
        container.appendChild(el);
        setTimeout(function () { el.classList.add('show'); }, 10);
        setTimeout(function () {
            el.classList.remove('show');
            setTimeout(function () { el.remove(); }, 220);
        }, duration || 2600);
    }

    /* ============================== 弹窗 ============================== */

    function modal(options) {
        var opts = options || {};
        var overlay = document.createElement('div');
        overlay.className = 'tms-modal-overlay';
        overlay.innerHTML =
            '<div class="tms-modal" role="dialog" aria-modal="true" style="max-width:' + (opts.width || 560) + 'px;">' +
            '<div class="tms-modal-head"><h3>' + esc(opts.title || '') + '</h3>' +
            '<button type="button" class="tms-modal-close" aria-label="关闭">×</button></div>' +
            '<div class="tms-modal-body">' + (opts.body || '') + '</div>' +
            (opts.footer === null ? '' : '<div class="tms-modal-foot">' + (opts.footer || '') + '</div>') +
            '</div>';
        document.body.appendChild(overlay);

        function close() {
            overlay.classList.remove('show');
            setTimeout(function () { overlay.remove(); }, 180);
            document.removeEventListener('keydown', onKey);
        }
        function onKey(e) {
            if (e.key === 'Escape') close();
        }
        overlay.querySelector('.tms-modal-close').addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKey);
        setTimeout(function () { overlay.classList.add('show'); }, 10);
        return { el: overlay, close: close, body: overlay.querySelector('.tms-modal-body') };
    }

    function confirmDialog(options) {
        var opts = options || {};
        return new Promise(function (resolve) {
            var m = modal({
                title: opts.title || '操作确认',
                width: 420,
                body: '<div class="tms-confirm-text">' + esc(opts.message || '确定执行该操作吗？') + '</div>',
                footer: '<button type="button" class="tms-btn tms-btn-light" data-act="cancel">' + esc(opts.cancelText || '取消') + '</button>' +
                    '<button type="button" class="tms-btn ' + (opts.danger ? 'tms-btn-danger' : 'tms-btn-primary') + '" data-act="ok">' + esc(opts.okText || '确定') + '</button>'
            });
            m.el.querySelector('[data-act="cancel"]').addEventListener('click', function () {
                m.close();
                resolve(false);
            });
            m.el.querySelector('[data-act="ok"]').addEventListener('click', function () {
                m.close();
                resolve(true);
            });
        });
    }

    /**
     * 表单弹窗
     * fields: [{key,label,type,options,required,placeholder,value,help,min,max,step,rows}]
     * onSubmit(values) 返回 false 或抛错时保持弹窗打开
     */
    function formModal(options) {
        var opts = options || {};
        var fields = opts.fields || [];
        var values = opts.values || {};

        var html = '<form class="tms-form" novalidate>';
        fields.forEach(function (f) {
            var val = values[f.key] != null ? values[f.key] : (f.value != null ? f.value : '');
            var required = f.required ? ' required' : '';
            var control = '';
            if (f.type === 'select') {
                control = '<select name="' + esc(f.key) + '"' + required + (f.disabled ? ' disabled' : '') + '>';
                control += '<option value="">' + esc(f.placeholder || '请选择') + '</option>';
                (f.options || []).forEach(function (o) {
                    var ov = typeof o === 'string' ? o : o.value;
                    var ol = typeof o === 'string' ? o : o.label;
                    control += '<option value="' + esc(ov) + '"' + (String(ov) === String(val) ? ' selected' : '') + '>' + esc(ol) + '</option>';
                });
                control += '</select>';
            } else if (f.type === 'textarea') {
                control = '<textarea name="' + esc(f.key) + '" rows="' + (f.rows || 3) + '"' + required +
                    ' placeholder="' + esc(f.placeholder || '') + '">' + esc(val) + '</textarea>';
            } else if (f.type === 'checkbox') {
                control = '<label class="tms-check"><input type="checkbox" name="' + esc(f.key) + '"' + (val ? ' checked' : '') + '><span>' + esc(f.checkboxLabel || '是') + '</span></label>';
            } else {
                control = '<input type="' + (f.type || 'text') + '" name="' + esc(f.key) + '" value="' + esc(val) + '"' + required +
                    (f.min != null ? ' min="' + f.min + '"' : '') +
                    (f.max != null ? ' max="' + f.max + '"' : '') +
                    (f.step != null ? ' step="' + f.step + '"' : '') +
                    (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
            }
            html += '<div class="tms-field' + (f.full ? ' full' : '') + '">' +
                '<label>' + esc(f.label || '') + (f.required ? ' <em>*</em>' : '') + '</label>' +
                control +
                (f.help ? '<small>' + esc(f.help) + '</small>' : '') +
                '</div>';
        });
        html += '<div class="tms-form-error" hidden></div></form>';

        var m = modal({
            title: opts.title || '编辑',
            width: opts.width || 620,
            body: html,
            footer: '<button type="button" class="tms-btn tms-btn-light" data-act="cancel">取消</button>' +
                '<button type="button" class="tms-btn tms-btn-primary" data-act="submit">' + esc(opts.submitText || '保存') + '</button>'
        });

        var form = m.el.querySelector('form');
        var errorEl = m.el.querySelector('.tms-form-error');
        var submitBtn = m.el.querySelector('[data-act="submit"]');

        function collect() {
            var data = {};
            fields.forEach(function (f) {
                var input = form.querySelector('[name="' + f.key + '"]');
                if (!input) return;
                if (f.type === 'checkbox') data[f.key] = input.checked;
                else if (f.type === 'number') data[f.key] = input.value === '' ? '' : Number(input.value);
                else data[f.key] = input.value;
            });
            return data;
        }

        function showError(msg) {
            errorEl.hidden = false;
            errorEl.textContent = msg;
        }

        m.el.querySelector('[data-act="cancel"]').addEventListener('click', m.close);
        submitBtn.addEventListener('click', function () {
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.dispatchEvent(new Event('submit', { cancelable: true }));
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            errorEl.hidden = true;
            var data = collect();
            var missing = fields.filter(function (f) {
                return f.required && (data[f.key] === '' || data[f.key] == null);
            });
            if (missing.length) {
                showError('请填写：' + missing.map(function (f) { return f.label; }).join('、'));
                return;
            }
            if (typeof opts.onSubmit !== 'function') {
                m.close();
                return;
            }
            submitBtn.disabled = true;
            var result;
            try {
                result = opts.onSubmit(data, m);
            } catch (err) {
                submitBtn.disabled = false;
                showError(err.message || '保存失败');
                return;
            }
            if (result && typeof result.then === 'function') {
                result.then(function (ok) {
                    submitBtn.disabled = false;
                    if (ok !== false) {
                        m.close();
                        toast(opts.successText || '保存成功', 'success');
                    }
                }).catch(function (err) {
                    submitBtn.disabled = false;
                    showError(err.message || '保存失败');
                });
            } else if (result !== false) {
                m.close();
                toast(opts.successText || '保存成功', 'success');
            } else {
                submitBtn.disabled = false;
            }
        });

        setTimeout(function () {
            var first = form.querySelector('input:not([type=hidden]),select,textarea');
            if (first) first.focus();
        }, 60);
        return m;
    }

    /* ============================== 列表 ============================== */

    /**
     * 通用数据表格
     * config = {
     *   entity, rows (可选，覆盖 entity 查询),
     *   columns:[{key,label,render,width,sortable}],
     *   actions:[{label,className,onClick(row)}],
     *   search, searchFields, searchPlaceholder,
     *   filters:[{key,label,options}],
     *   pageSize=10, defaultSort, toolbar:[{text,className,onClick}],
     *   emptyText, onRowClick, rowClass
     * }
     */
    function table(container, config) {
        if (!container) return null;
        var cfg = config || {};
        var state = {
            search: '',
            filters: {},
            page: 1,
            sort: cfg.defaultSort || null,
            pageSize: cfg.pageSize === 0 ? 0 : (cfg.pageSize || 10)
        };
        var uid = uniqueId('tms-table');
        var unsubscribe = null;

        function sourceRows() {
            if (typeof cfg.rows === 'function') return cfg.rows() || [];
            if (Array.isArray(cfg.rows)) return cfg.rows;
            if (cfg.entity && global.TmsStore) {
                return global.TmsStore.list(cfg.entity, { sort: state.sort }).rows;
            }
            return [];
        }

        function filteredRows() {
            var rows = sourceRows();
            if (typeof cfg.rows === 'function' || Array.isArray(cfg.rows)) {
                if (state.search) {
                    var q = state.search.toLowerCase();
                    var fields = cfg.searchFields || Object.keys(rows[0] || {});
                    rows = rows.filter(function (r) {
                        return fields.some(function (f) { return r[f] != null && String(r[f]).toLowerCase().indexOf(q) > -1; });
                    });
                }
                Object.keys(state.filters).forEach(function (key) {
                    var val = state.filters[key];
                    if (val === '' || val == null) return;
                    rows = rows.filter(function (r) { return String(r[key]) === String(val); });
                });
                if (state.sort && state.sort.key) {
                    var s = state.sort;
                    var dir = s.dir === 'asc' ? 1 : -1;
                    rows = rows.slice().sort(function (a, b) {
                        var av = a[s.key], bv = b[s.key];
                        if (av == null) return 1;
                        if (bv == null) return -1;
                        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                        return String(av).localeCompare(String(bv), 'zh-CN') * dir;
                    });
                }
            } else if (cfg.entity && global.TmsStore) {
                var res = global.TmsStore.list(cfg.entity, {
                    search: state.search,
                    searchFields: cfg.searchFields,
                    filters: state.filters,
                    sort: state.sort,
                    page: state.page,
                    pageSize: state.pageSize
                });
                return res;
            }
            return rows;
        }

        function render() {
            var result = filteredRows();
            var rows = Array.isArray(result) ? result : result.rows;
            var total = Array.isArray(result) ? result.length : result.total;
            var page = Array.isArray(result) ? state.page : result.page;
            var pages = state.pageSize ? Math.max(1, Math.ceil(total / state.pageSize)) : 1;
            if (Array.isArray(result) && state.pageSize) {
                rows = rows.slice((page - 1) * state.pageSize, page * state.pageSize);
            }

            var toolbarHtml = '';
            var hasToolbar = cfg.search !== false || (cfg.filters && cfg.filters.length) || (cfg.toolbar && cfg.toolbar.length);
            if (hasToolbar) {
                toolbarHtml = '<div class="tms-toolbar">';
                if (cfg.search !== false) {
                    toolbarHtml += '<div class="tms-search"><input type="search" data-role="search" placeholder="' +
                        esc(cfg.searchPlaceholder || '搜索关键字') + '" value="' + esc(state.search) + '"></div>';
                }
                (cfg.filters || []).forEach(function (f) {
                    toolbarHtml += '<select class="tms-filter" data-filter="' + esc(f.key) + '">';
                    toolbarHtml += '<option value="">' + esc(f.label || '全部') + '</option>';
                    (f.options || []).forEach(function (o) {
                        var ov = typeof o === 'string' ? o : o.value;
                        var ol = typeof o === 'string' ? o : o.label;
                        toolbarHtml += '<option value="' + esc(ov) + '"' + (String(state.filters[f.key]) === String(ov) ? ' selected' : '') + '>' + esc(ol) + '</option>';
                    });
                    toolbarHtml += '</select>';
                });
                toolbarHtml += '<div class="tms-toolbar-right">';
                (cfg.toolbar || []).forEach(function (btn, i) {
                    toolbarHtml += '<button type="button" class="' + (btn.className || 'tms-btn tms-btn-primary') + '" data-toolbar="' + i + '">' + esc(btn.text) + '</button>';
                });
                toolbarHtml += '<span class="tms-total">共 ' + total + ' 条</span></div></div>';
            }

            var headHtml = '<thead><tr>';
            cfg.columns.forEach(function (col) {
                var sortable = col.sortable !== false && (cfg.entity || (cfg.rows && cfg.rows.length));
                var arrow = '';
                if (state.sort && state.sort.key === col.key) arrow = state.sort.dir === 'asc' ? ' ↑' : ' ↓';
                headHtml += '<th' + (col.width ? ' style="width:' + col.width + '"' : '') + (sortable ? ' class="tms-sortable" data-sort-key="' + esc(col.key) + '"' : '') + '>' + esc(col.label) + arrow + '</th>';
            });
            if (cfg.actions && cfg.actions.length) headHtml += '<th class="tms-actions-col">操作</th>';
            headHtml += '</tr></thead>';

            var bodyHtml = '<tbody>';
            if (!rows.length) {
                bodyHtml += '<tr><td class="tms-empty" colspan="' + (cfg.columns.length + (cfg.actions && cfg.actions.length ? 1 : 0)) + '">' +
                    esc(cfg.emptyText || '暂无数据') + '</td></tr>';
            } else {
                rows.forEach(function (row) {
                    bodyHtml += '<tr data-row-id="' + esc(row.id) + '"' + (cfg.rowClass ? ' class="' + cfg.rowClass(row) + '"' : '') + '>';
                    cfg.columns.forEach(function (col) {
                        var content = col.render ? col.render(row) : esc(row[col.key]);
                        bodyHtml += '<td' + (col.align ? ' style="text-align:' + col.align + '"' : '') + '>' + (content == null ? '-' : content) + '</td>';
                    });
                    if (cfg.actions && cfg.actions.length) {
                        bodyHtml += '<td class="tms-actions-cell">';
                        cfg.actions.forEach(function (act, ai) {
                            if (act.show && !act.show(row)) return;
                            bodyHtml += '<button type="button" class="tms-btn tms-btn-xs ' + (act.className || 'tms-btn-light') + '" data-row-action="' + ai + '">' + esc(act.label) + '</button>';
                        });
                        bodyHtml += '</td>';
                    }
                    bodyHtml += '</tr>';
                });
            }
            bodyHtml += '</tbody>';

            var pagerHtml = '';
            if (state.pageSize && total > state.pageSize) {
                pagerHtml = '<div class="tms-pagination">';
                pagerHtml += '<button type="button" class="tms-page-btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';
                var start = Math.max(1, page - 2), end = Math.min(pages, start + 4);
                start = Math.max(1, end - 4);
                for (var p = start; p <= end; p++) {
                    pagerHtml += '<button type="button" class="tms-page-btn' + (p === page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
                }
                pagerHtml += '<button type="button" class="tms-page-btn" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button>';
                pagerHtml += '<span class="tms-page-info">第 ' + page + ' / ' + pages + ' 页</span></div>';
            }

            container.innerHTML = toolbarHtml +
                '<div class="tms-table-wrap"><table class="tms-table" id="' + uid + '">' + headHtml + bodyHtml + '</table></div>' +
                pagerHtml;

            bind();
        }

        function bind() {
            var searchInput = container.querySelector('[data-role="search"]');
            if (searchInput) {
                var timer = null;
                searchInput.addEventListener('input', function () {
                    clearTimeout(timer);
                    var v = this.value;
                    timer = setTimeout(function () {
                        state.search = v;
                        state.page = 1;
                        render();
                    }, 220);
                });
            }
            container.querySelectorAll('[data-filter]').forEach(function (sel) {
                sel.addEventListener('change', function () {
                    state.filters[this.dataset.filter] = this.value;
                    state.page = 1;
                    render();
                });
            });
            container.querySelectorAll('[data-toolbar]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var item = (cfg.toolbar || [])[Number(this.dataset.toolbar)];
                    if (item && item.onClick) item.onClick();
                });
            });
            container.querySelectorAll('[data-sort-key]').forEach(function (th) {
                th.addEventListener('click', function () {
                    var key = this.dataset.sortKey;
                    if (state.sort && state.sort.key === key) {
                        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
                    } else {
                        state.sort = { key: key, dir: 'asc' };
                    }
                    state.page = 1;
                    render();
                });
            });
            container.querySelectorAll('[data-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var p = Number(this.dataset.page);
                    if (p >= 1) {
                        state.page = p;
                        render();
                    }
                });
            });
            container.querySelectorAll('[data-row-action]').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var tr = this.closest('tr');
                    var id = tr.dataset.rowId;
                    var act = cfg.actions[Number(this.dataset.rowAction)];
                    var row = sourceRows().find(function (r) { return String(r.id) === String(id); });
                    if (act && row) act.onClick(row);
                });
            });
            if (cfg.onRowClick) {
                container.querySelectorAll('tbody tr[data-row-id]').forEach(function (tr) {
                    tr.classList.add('tms-row-clickable');
                    tr.addEventListener('click', function () {
                        var row = sourceRows().find(function (r) { return String(r.id) === String(tr.dataset.rowId); });
                        if (row) cfg.onRowClick(row);
                    });
                });
            }
        }

        render();

        if (cfg.entity && global.TmsStore) {
            unsubscribe = global.TmsStore.subscribe(function () {
                var active = document.activeElement;
                if (active && container.contains(active) && active.matches('input,select,textarea')) return;
                if (state.pageSize) {
                    var total = global.TmsStore.list(cfg.entity, {
                        search: state.search, searchFields: cfg.searchFields, filters: state.filters
                    }).total;
                    state.page = Math.min(state.page, Math.max(1, Math.ceil(total / state.pageSize)));
                }
                render();
            });
        }

        return {
            refresh: render,
            state: state,
            destroy: function () { if (unsubscribe) unsubscribe(); }
        };
    }

    /* ============================== KPI 与图表 ============================== */

    function kpis(container, items) {
        if (!container) return;
        container.innerHTML = (items || []).map(function (it) {
            return '<div class="tms-kpi">' +
                '<div class="tms-kpi-label">' + esc(it.label) + '</div>' +
                '<div class="tms-kpi-value" style="color:' + (it.color || '#3d4b5c') + '">' + (it.value == null ? '-' : it.value) + '</div>' +
                (it.sub ? '<div class="tms-kpi-sub">' + esc(it.sub) + '</div>' : '') +
                '</div>';
        }).join('');
    }

    function chartFrame(container, inner, height) {
        container.innerHTML = '<div class="tms-chart" style="height:' + (height || 240) + 'px"><svg viewBox="0 0 720 260" preserveAspectRatio="none">' + inner + '</svg></div>';
    }

    function scale(value, min, max, outMin, outMax) {
        if (max === min) return outMin;
        return outMin + (value - min) / (max - min) * (outMax - outMin);
    }

    function niceMax(value) {
        if (value <= 5) return 5;
        var pow = Math.pow(10, Math.floor(Math.log10(value)));
        var n = Math.ceil(value / pow) * pow;
        return n;
    }

    function lineChart(container, options) {
        var opts = options || {};
        var labels = opts.labels || [];
        var series = opts.series || [];
        var w = 720, h = 260, pl = 44, pr = 16, pt = 20, pb = 32;
        var all = [];
        series.forEach(function (s) { all = all.concat(s.data || []); });
        var max = niceMax(Math.max.apply(null, all.concat([1])));
        var inner = '';

        for (var g = 0; g <= 4; g++) {
            var y = pt + (h - pt - pb) * g / 4;
            var val = Math.round(max * (1 - g / 4));
            inner += '<line x1="' + pl + '" y1="' + y + '" x2="' + (w - pr) + '" y2="' + y + '" stroke="#eef1f5"/>';
            inner += '<text x="' + (pl - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#98a4b3">' + val + '</text>';
        }
        labels.forEach(function (label, i) {
            var x = labels.length === 1 ? pl : pl + (w - pl - pr) * i / (labels.length - 1);
            inner += '<text x="' + x + '" y="' + (h - 10) + '" text-anchor="middle" font-size="11" fill="#98a4b3">' + esc(label) + '</text>';
        });
        series.forEach(function (s) {
            var data = s.data || [];
            var points = data.map(function (v, i) {
                var x = data.length === 1 ? pl : pl + (w - pl - pr) * i / (data.length - 1);
                var y = scale(v, 0, max, h - pb, pt);
                return x.toFixed(1) + ',' + y.toFixed(1);
            });
            if (opts.area && series.length === 1) {
                inner += '<polygon points="' + pl + ',' + (h - pb) + ' ' + points.join(' ') + ' ' + (w - pr) + ',' + (h - pb) + '" fill="' + (s.color || '#4ecdc4') + '" opacity="0.12"/>';
            }
            inner += '<polyline points="' + points.join(' ') + '" fill="none" stroke="' + (s.color || '#4ecdc4') + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
            data.forEach(function (v, i) {
                var x = data.length === 1 ? pl : pl + (w - pl - pr) * i / (data.length - 1);
                var y = scale(v, 0, max, h - pb, pt);
                inner += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#fff" stroke="' + (s.color || '#4ecdc4') + '" stroke-width="2"/>';
            });
        });

        var legend = series.map(function (s) {
            return '<span class="tms-legend-item"><i style="background:' + (s.color || '#4ecdc4') + '"></i>' + esc(s.name || '') + '</span>';
        }).join('');
        chartFrame(container, inner, opts.height);
        if (legend) container.insertAdjacentHTML('beforeend', '<div class="tms-legend">' + legend + '</div>');
    }

    function barChart(container, options) {
        var opts = options || {};
        var labels = opts.labels || [];
        var series = opts.series || [];
        var w = 720, h = 260, pl = 44, pr = 16, pt = 20, pb = 32;
        var all = [];
        series.forEach(function (s) { all = all.concat(s.data || []); });
        var max = niceMax(Math.max.apply(null, all.concat([1])));
        var inner = '';
        for (var g = 0; g <= 4; g++) {
            var y = pt + (h - pt - pb) * g / 4;
            inner += '<line x1="' + pl + '" y1="' + y + '" x2="' + (w - pr) + '" y2="' + y + '" stroke="#eef1f5"/>';
            inner += '<text x="' + (pl - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#98a4b3">' + Math.round(max * (1 - g / 4)) + '</text>';
        }
        var groupWidth = (w - pl - pr) / Math.max(labels.length, 1);
        labels.forEach(function (label, i) {
            var cx = pl + groupWidth * (i + 0.5);
            var barW = Math.min(26, groupWidth / (series.length + 1));
            series.forEach(function (s, si) {
                var data = s.data || [];
                var v = data[i] || 0;
                var bh = (h - pt - pb) * v / max;
                var x = cx - (series.length * barW) / 2 + si * barW;
                inner += '<rect x="' + x.toFixed(1) + '" y="' + (h - pb - bh).toFixed(1) + '" width="' + (barW - 3).toFixed(1) +
                    '" height="' + Math.max(bh, 0).toFixed(1) + '" rx="3" fill="' + (s.color || '#4ecdc4') + '"/>';
            });
            inner += '<text x="' + cx + '" y="' + (h - 10) + '" text-anchor="middle" font-size="11" fill="#98a4b3">' + esc(label) + '</text>';
        });
        var legend = series.map(function (s) {
            return '<span class="tms-legend-item"><i style="background:' + (s.color || '#4ecdc4') + '"></i>' + esc(s.name || '') + '</span>';
        }).join('');
        chartFrame(container, inner, opts.height);
        if (legend) container.insertAdjacentHTML('beforeend', '<div class="tms-legend">' + legend + '</div>');
    }

    function donutChart(container, options) {
        var opts = options || {};
        var data = (opts.data || []).filter(function (d) { return Number(d.value) > 0; });
        var total = data.reduce(function (s, d) { return s + Number(d.value); }, 0) || 1;
        var colors = ['#4ecdc4', '#667eea', '#ffb74d', '#4caf50', '#ff6b6b', '#90a4ae', '#26c6da', '#ab47bc'];
        var r = 78, cx = 260, cy = 130, stroke = 30;
        var circumference = 2 * Math.PI * r;
        var offset = 0;
        var inner = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#eef1f5" stroke-width="' + stroke + '"/>';
        data.forEach(function (d, i) {
            var ratio = Number(d.value) / total;
            var len = ratio * circumference;
            inner += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + (d.color || colors[i % colors.length]) +
                '" stroke-width="' + stroke + '" stroke-dasharray="' + (len - 2) + ' ' + (circumference - len + 2) +
                '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
            offset += len;
        });
        inner += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" font-size="13" fill="#98a4b3">总计</text>';
        inner += '<text x="' + cx + '" y="' + (cy + 24) + '" text-anchor="middle" font-size="26" font-weight="700" fill="#3d4b5c">' + total + '</text>';
        var legend = data.map(function (d, i) {
            return '<span class="tms-legend-item"><i style="background:' + (d.color || colors[i % colors.length]) + '"></i>' +
                esc(d.label) + ' <b>' + d.value + '</b></span>';
        }).join('');
        container.innerHTML = '<div class="tms-donut-wrap"><div class="tms-chart" style="height:' + (opts.height || 260) + 'px"><svg viewBox="0 0 520 260">' + inner + '</svg></div>' +
            '<div class="tms-donut-legend">' + legend + '</div></div>';
    }

    /* ============================== 详情展示 ============================== */

    function detailModal(title, html, width) {
        return modal({ title: title, width: width || 680, body: html, footer: '<button type="button" class="tms-btn tms-btn-light" data-act="close">关闭</button>' });
    }

    function detailGrid(items) {
        return '<div class="tms-detail-grid">' + (items || []).map(function (it) {
            return '<div class="tms-detail-item"><span>' + esc(it.label) + '</span><strong>' + (it.value == null ? '-' : it.value) + '</strong></div>';
        }).join('') + '</div>';
    }

    function timeline(items) {
        return '<ul class="tms-timeline">' + (items || []).map(function (it) {
            return '<li><span class="tms-timeline-dot"></span><div><strong>' + esc(it.label || it.status) +
                '</strong><p>' + esc(fmt.dateTime(it.time)) + (it.actor ? ' · ' + esc(it.actor) : '') + '</p></div></li>';
        }).join('') + '</ul>';
    }

    /* ============================== 页面外壳 ============================== */

    function initShell(options) {
        var opts = options || {};
        var path = (location.pathname.split('/').pop() || 'tms-index.html');
        document.querySelectorAll('.nav a').forEach(function (a) {
            a.classList.remove('active');
            var href = (a.getAttribute('href') || '').split('#')[0];
            if (href && href === path) a.classList.add('active');
        });

        document.querySelectorAll('.has-submenu > a').forEach(function (item) {
            item.addEventListener('click', function (e) {
                e.preventDefault();
                item.parentElement.classList.toggle('active');
            });
        });

        var logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn && !logoutBtn.dataset.tmsBound) {
            logoutBtn.dataset.tmsBound = '1';
            logoutBtn.addEventListener('click', function () {
                if (typeof global.logout === 'function') global.logout();
            });
        }

        if (typeof global.displayCurrentUser === 'function') global.displayCurrentUser();

        // 异常待办角标
        try {
            if (global.TmsStore) {
                var pending = global.TmsStore.list('exceptions', { filters: { status: 'pending' } }).total +
                    global.TmsStore.list('exceptions', { filters: { status: 'processing' } }).total;
                var link = document.querySelector('.nav a[href="tms-exception.html"]');
                if (link && pending) {
                    var span = link.querySelector('.tms-nav-badge');
                    if (!span) {
                        span = document.createElement('span');
                        span.className = 'tms-nav-badge';
                        link.appendChild(span);
                    }
                    span.textContent = pending;
                }
            }
        } catch (e) { /* 角标失败不影响页面 */ }
    }

    function pageHeader(title, subtitle, actionsHtml) {
        return '<div class="tms-page-head"><div><h2>' + esc(title) + '</h2>' +
            (subtitle ? '<p>' + esc(subtitle) + '</p>' : '') + '</div>' +
            (actionsHtml ? '<div class="tms-page-actions">' + actionsHtml + '</div>' : '') + '</div>';
    }

    function emptyState(text) {
        return '<div class="tms-empty-state">' + esc(text || '暂无数据') + '</div>';
    }

    global.TmsUI = {
        esc: esc,
        fmt: fmt,
        toast: toast,
        modal: modal,
        confirm: confirmDialog,
        formModal: formModal,
        table: table,
        kpis: kpis,
        charts: {
            line: lineChart,
            bar: barChart,
            donut: donutChart
        },
        statusBadge: statusBadge,
        badge: badge,
        detailModal: detailModal,
        detailGrid: detailGrid,
        timeline: timeline,
        initShell: initShell,
        pageHeader: pageHeader,
        emptyState: emptyState,
        uniqueId: uniqueId
    };
})(window);
