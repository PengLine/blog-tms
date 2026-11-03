/* 围栏地图：把 Leaflet 收在一处，页面只声明「有哪些围栏、勾完给谁」。
   为什么自己写勾画而不用 leaflet-draw：那是一个已经停维护的插件，多挂一份 CDN 就多一份
   打不开的风险，而需求只是「点几下勾个多边形」——几十行点选逻辑比一个插件可控得多。
   CDN 拉不到时必须整页还能用：地图降级成文字提示，围栏的列表与表单照旧可编辑 */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};
    var util = TMS.util, ui = TMS.ui;
    var esc = util.esc;

    var seq = 0;

    function ready() { return !!global.L && !!global.L.map; }

    /* 容器 + 工具条 + 读数条。真正的地图在 afterRender 里挂上去：
       渲染阶段只是拼字符串，此刻 DOM 还没有尺寸，Leaflet 会算出 0×0 的视口 */
    function box(o) {
        var id = o.id || ('tmsmap' + (++seq));
        var head = '';
        if (o.tools !== false) {
            head = '<div class="tms-map-bar">' +
                '<span class="tms-map-mode" data-map-role="hint">' + esc(o.hint || '选择围栏查看，或点「开始勾画」画一片新的边界') + '</span>' +
                '<span class="tms-map-read" data-map-role="read"></span>' +
                '</div>';
        }
        var body = ready()
            ? '<div class="tms-map-canvas" id="' + esc(id) + '" data-map="1"></div>'
            : '<div class="tms-map-canvas tms-map-offline">' +
            '<div class="tms-map-offline-in"><b>地图组件没有加载出来</b>' +
            '<div>围栏地图依赖 CDN 上的 Leaflet。离线或网络受限时这里会空白，但下面的围栏列表、' +
            '半径与顶点录入都不受影响——勾画可以等设备通了再补，围栏不该因为地图打不开就不能维护。</div></div></div>';
        return '<div class="tms-map" data-map-id="' + esc(id) + '" id="' + esc(id) + '-wrap">' + head + body + '</div>';
    }

    var TONE_COLOR = { hub: '#d98207', branch: '#1668dc', courier: '#1f9d55', other: '#7a8699' };

    function colorOf(g, selected) {
        if (selected) return '#d43b3b';
        return TONE_COLOR[g.type] || TONE_COLOR.other;
    }

    /* 一个围栏 → 一层图形。勾过的用多边形，只有半径的用圆，两者在几何判定上等价 */
    function layerOf(L, g, selected) {
        /* 用哪层图形由领域层判（和点判定同一个口径），否则会出现「地图画成圆、判定按多边形」 */
        var raw = TMS.network ? TMS.network.fenceRing(g) : (Array.isArray(g.polygon) && g.polygon.length >= 3 ? g.polygon : null);
        var ring = raw && raw.map(function (p) { return [p.lat, p.lng]; });
        var style = {
            color: colorOf(g, selected), weight: selected ? 3 : 1.6,
            opacity: selected ? 1 : 0.75, fillOpacity: g.status === 'active' ? (selected ? 0.28 : 0.14) : 0.05,
            dashArray: g.status === 'active' ? null : '5 5'
        };
        var layer = ring ? L.polygon(ring, style)
            : (g.center ? L.circle([g.center.lat, g.center.lng], {
                radius: Number(g.radiusM) || 0, color: style.color, weight: style.weight, opacity: style.opacity,
                fillOpacity: style.fillOpacity, dashArray: style.dashArray
            }) : null);
        if (!layer) return null;
        layer.bindTooltip(String(g.name || g.id) + ' · ' + (TMS.cfg.fence.LABEL[g.type] || g.type), { sticky: true });
        return layer;
    }

    function ringCenter(ring) { return util.ringCentroid(ring); }

    /* mount(el, cfg)
       cfg = { fences, selected, city, onPick(id), onDraw(points), editable, types }
       返回句柄：sync(fences, selected) 重画、focusFence(g) 定位、destroy() */
    function mount(el, cfgOpt) {
        var o = cfgOpt || {};
        if (!el) return null;
        if (!ready()) {
            /* 没有 Leaflet 也要给勾画一个出口：把顶点读出来让人知道当前围栏长什么样，
               并明确说这里的按钮为什么按了没反应，比留个空白框体面 */
            el.innerHTML = '<div class="tms-map-offline"><div class="tms-map-offline-in">' +
                '<b>地图组件没有加载出来</b><div>勾画不可用。可以在编辑表单里直接填半径，' +
                '或等设备能连到 CDN 后再来勾边界。</div></div></div>';
            return {
                offline: true, sync: function () { }, focusFence: function () { },
                startDraft: function () { }, stopDraft: function () { }, destroy: function () { }
            };
        }
        var L = global.L;
        var fences = o.fences || [];
        var selected = o.selected || '';
        var draft = [];
        var mode = 'idle';
        var inst = null, group = null, draftLayer = null, handles = null;

        inst = L.map(el, { zoomControl: true, attributionControl: false }).setView([31.5, 104.5], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, crossOrigin: true }).addTo(inst);
        group = L.layerGroup().addTo(inst);

        var hintEl = el.parentNode ? el.parentNode.querySelector('[data-map-role="hint"]') : null;
        var readEl = el.parentNode ? el.parentNode.querySelector('[data-map-role="read"]') : null;

        function hint(t) { if (hintEl) hintEl.textContent = t; }
        function read(t) { if (readEl) readEl.textContent = t || ''; }

        function redraw() {
            group.clearLayers();
            fences.forEach(function (g) {
                var lyr = layerOf(L, g, g.id === selected);
                if (!lyr) return;
                lyr.on('click', function () { if (o.onPick) o.onPick(g.id); });
                lyr.addTo(group);
            });
        }

        function draftStyle() {
            return { color: '#d43b3b', weight: 2, dashArray: '4 4', fillOpacity: draft.length >= 3 ? 0.16 : 0 };
        }

        function redrawDraft() {
            if (draftLayer) { inst.removeLayer(draftLayer); draftLayer = null; }
            /* draft 存的是 Leaflet 认的 [lat, lng] 数组，直接交出去；
               按 p.lat 取会全取成 undefined，折线一渲染就断，勾画点了第二个点就没反应 */
            if (draft.length >= 3) draftLayer = L.polygon(draft, draftStyle()).addTo(inst);
            else if (draft.length >= 2) draftLayer = L.polyline(draft, draftStyle()).addTo(inst);
            var area = draft.length >= 3 ? util.ringAreaKm2(draft.map(function (p) { return { lat: p[0], lng: p[1] }; })) : 0;
            read(draft.length
                ? '已点 ' + draft.length + ' 个顶点' + (area ? ' · 面积约 ' + area + ' km²' : '') +
                (draft.length < 3 ? ' · 至少 3 个点才能闭合成面' : ' · 点「闭合」保存')
                : '');
            /* 顶点要画出来、而且要能拖：勾错一个点就整圈重画太劝退。
               手柄跟着草稿重建，否则撤点之后旧手柄还挂在原处，拖它等于把已删的点拖回来 */
            if (handles) {
                handles.clearLayers();
                draft.forEach(function (p, i) {
                    var mk = L.circleMarker([p[0], p[1]], { radius: 5, color: '#d43b3b', fillOpacity: 1, draggable: true });
                    mk.on('drag', function (e) {
                        var ll = e.target.getLatLng();
                        draft[i] = [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6];
                        redrawDraft();
                    });
                    mk.addTo(handles);
                });
            }
        }

        function startDraft(existing) {
            mode = 'draw';
            draft = (existing || []).map(function (p) { return [p.lat, p.lng]; });
            handles = L.layerGroup().addTo(inst);
            redrawDraft();
            hint(existing && existing.length ? '拖动顶点调整边界，点「闭合」保存' : '在地图上依次点击落点，围出这片围栏的范围');
        }

        function stopDraft() {
            mode = 'idle';
            draft = [];
            if (draftLayer) { inst.removeLayer(draftLayer); draftLayer = null; }
            if (handles) { inst.removeLayer(handles); handles = null; }
            read('');
            hint('选择围栏查看，或点「开始勾画」画一片新的边界');
        }

        inst.on('click', function (e) {
            if (mode !== 'draw') return;
            draft.push([Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]);
            redrawDraft();
        });

        function commit() {
            if (draft.length < TMS.cfg.fence.minPoints) {
                ui.toast('至少需要 ' + TMS.cfg.fence.minPoints + ' 个顶点才能闭合成围栏', 'warn');
                return false;
            }
            if (draft.length > TMS.cfg.fence.maxPoints) {
                ui.toast('顶点太多（' + draft.length + '），一张围栏不必勾到 ' + TMS.cfg.fence.maxPoints + ' 点以上', 'warn');
                return false;
            }
            var pts = draft.map(function (p) { return { lat: p[0], lng: p[1] }; });
            if (o.onDraw) o.onDraw(pts, ringCenter(pts));
            stopDraft();
            return true;
        }

        /* 工具条由页面拼进 box 之外的位置会各写一遍，收在这里保证两端一致 */
        var bar = el.parentNode ? el.parentNode.querySelector('.tms-map-bar') : null;
        if (bar && o.editable !== false) {
            var btns = document.createElement('div');
            btns.className = 'tms-map-tools';
            btns.innerHTML =
                '<button type="button" class="tms-btn tms-btn-sm" data-map-act="draw">开始勾画</button>' +
                '<button type="button" class="tms-btn tms-btn-sm" data-map-act="undo">撤一个点</button>' +
                '<button type="button" class="tms-btn tms-btn-sm tms-btn-primary" data-map-act="done">闭合保存</button>' +
                '<button type="button" class="tms-btn tms-btn-sm tms-btn-ghost" data-map-act="cancel">取消</button>';
            bar.appendChild(btns);
            btns.addEventListener('click', function (ev) {
                var t = ev.target.closest ? ev.target.closest('[data-map-act]') : null;
                if (!t) return;
                var act = t.getAttribute('data-map-act');
                if (act === 'draw') startDraft(selected ? (find(selected).polygon || null) : null);
                else if (act === 'undo') { draft.pop(); redrawDraft(); }
                else if (act === 'done') commit();
                else if (act === 'cancel') stopDraft();
            });
        }

        function find(id) {
            for (var i = 0; i < fences.length; i++) if (fences[i].id === id) return fences[i];
            return null;
        }

        redraw();
        if (o.fit !== false) {
            var pts = [];
            fences.forEach(function (g) {
                var r = (g.polygon || []).map(function (p) { return [p.lat, p.lng]; });
                if (r.length) pts = pts.concat(r);
                else if (g.center) pts.push([g.center.lat, g.center.lng]);
            });
            if (pts.length > 1) inst.fitBounds(pts, { padding: [18, 18] });
            else if (pts.length === 1) inst.setView(pts[0], 11);
        }

        return {
            offline: false,
            /* 页面可以直接把某张围栏的环交给勾画态（台账里的「改边界」就走这条），
               不必先选中再点按钮——选中态和勾画态在界面上是两回事 */
            startDraft: function (ring) { startDraft(ring); },
            stopDraft: stopDraft,
            sync: function (next, sel) {
                fences = next || fences;
                selected = sel != null ? sel : selected;
                redraw();
                inst.invalidateSize();
            },
            focusFence: function (g) {
                if (!g) return;
                var r = (g.polygon || []).map(function (p) { return [p.lat, p.lng]; });
                if (r.length > 1) inst.fitBounds(r, { padding: [24, 24] });
                else if (g.center) inst.setView([g.center.lat, g.center.lng], 12);
                inst.invalidateSize();
            },
            /* 判定演示：给一个点，告诉用户它落在哪几张围栏里——图1 的两条分支要能在界面上验证，
               不能只信列表上的「覆盖」字样 */
            probe: function (latlng) {
                var hit = fences.filter(function (g) {
                    return g.status === 'active' && TMS.network.pointInFence({ lat: latlng[0], lng: latlng[1] }, g);
                });
                return hit;
            },
            redrawDraft: redrawDraft,
            destroy: function () { try { inst.remove(); } catch (err) { } }
        };
    }

    TMS.map = { ready: ready, box: box, mount: mount, colorOf: colorOf };
})(window);
