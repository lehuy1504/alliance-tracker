    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
    import { T, getLang, setLang } from './lang.js';

    const firebaseConfig = { apiKey: "AIzaSyCp6L4C-4KhZNm67VpC3hu7ws_n2C5XTfA", authDomain: "alliance-tracker-ddc87.firebaseapp.com", databaseURL: "https://alliance-tracker-ddc87-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "alliance-tracker-ddc87", storageBucket: "alliance-tracker-ddc87.firebasestorage.app", messagingSenderId: "910735026600", appId: "1:910735026600:web:d2199d026f1e476cb4d59d" };
    const fbApp = initializeApp(firebaseConfig), fbDB = getDatabase(fbApp);

    // Update loading text to match saved language
    { const el = document.getElementById('loadingText'); if (el) el.textContent = T('loading'); }

    // ── localStorage cache (5 min TTL) ──
    const _CACHE_KEY = 'at_cache_v1';
    const _CACHE_TTL = 5 * 60 * 1000;
    function _saveCache(data) { try { localStorage.setItem(_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch (_) {} }
    function _loadCache() { try { const p = JSON.parse(localStorage.getItem(_CACHE_KEY) || 'null'); return p && (Date.now() - p.ts < _CACHE_TTL) ? p.data : null; } catch (_) { return null; } }
    function _debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

    let DATA = {}, curServer = null, curDate = null;
    let activeTab = 'view', sortCol = 'merit', sortDir = 'desc', numFmt = 'short', searchQuery = '';
    let cmpSrv = null, cmpD1 = null, cmpD2 = null;
    let cmpNumFmt = 'short', cmpSortKey = 'dm', cmpSortDir = 'desc', cmpSearchQ = '', cmpTop10Key = 'dm', top10Dir = 'desc';
    let _cmpDiffs = [];
    let allianceSrv = null, allianceSortCol = 'power', allianceSortDir = 'desc', allianceNumFmt = 'short', allianceSearch = '';
    let allianceExtraVis = new Set();
    let allianceViewMode = 'members'; // 'members' | 'servers'
    let allianceDataMode = 'total'; // 'total' | 'growth'
    let allianceFromDate = null, allianceToDate = null;

    // ══════════════════════════════════════════════
    // Column config (localized getter functions)
    // ══════════════════════════════════════════════
    const getCmpFixed = () => [
      { k: 'dm', l: T('col_merit') }, { k: 'merit_rate_calc', l: T('excel_merit_rate_calc'), pct: true },
      { k: 'dk', l: T('col_kill') }, { k: 'dh', l: T('col_heal') },
      { k: 'dd', l: T('col_dead') }, { k: 'dp', l: T('col_power') }, { k: 'dpi', l: T('col_pvp_infantry') },
    ];
    const getCmpExtra = () => [
      { k: 'dpc', l: T('col_pvp_cavalry') }, { k: 'dpa', l: T('col_pvp_archer') }, { k: 'dpm', l: T('col_pvp_magic') },
      { k: 'dgg', l: T('col_gold_gather') }, { k: 'dwg', l: T('col_wood_gather') }, { k: 'dsg', l: T('col_stone_gather') }, { k: 'dmg', l: T('col_mana_gather') }, { k: 'dgeg', l: T('col_gem_gather') },
    ];
    const getTop10Cols = () => [
      { k: 'before', l: T('top10_before') }, { k: 'after', l: T('top10_after') }, { k: 'diff', l: T('top10_diff') },
    ];
    const getDiffSortOpts = () => [
      { v: 'dm', l: T('col_merit') }, { v: 'merit_rate_calc', l: T('excel_merit_rate_calc') }, { v: 'dp', l: T('col_power') }, { v: 'dk', l: T('col_kill') },
      { v: 'dd', l: T('col_dead') }, { v: 'dh', l: T('col_heal') },
      { v: 'dpi', l: T('col_pvp_infantry') }, { v: 'dpc', l: T('col_pvp_cavalry') }, { v: 'dpa', l: T('col_pvp_archer') }, { v: 'dpm', l: T('col_pvp_magic') },
      { v: 'dgg', l: T('col_gold_gather') }, { v: 'dwg', l: T('col_wood_gather') },
      { v: 'dsg', l: T('col_stone_gather') }, { v: 'dmg', l: T('col_mana_gather') }, { v: 'dgeg', l: T('col_gem_gather') },
    ];
    const getTop10Metas = () => [
      { v: 'dm', l: T('top10_merit'), field: 'merit' }, { v: 'dk', l: T('top10_kill'), field: 'kill' },
      { v: 'dh', l: T('top10_heal'), field: 'heal' }, { v: 'dd', l: T('top10_dead'), field: 'dead' },
      { v: 'dp', l: T('top10_power'), field: 'power' },
      { v: 'dmg', l: T('top10_mana_gather'), field: 'manaGather' },
    ];
    const getDiffSections = () => [
      { t: T('section_battle'), fields: [
        [T('field_merit'), 'merit'], [T('field_merit_rate'), 'meritRate', true],
        [T('excel_merit_rate_calc'), null, false, (a, b) => { const pm = b.powerMax || a.powerMax; if (!pm) return { va: 0, vb: 0, diff: 0 }; const va = Math.round((a.merit || 0) / pm * 10000) / 100; const vb = Math.round((b.merit || 0) / pm * 10000) / 100; return { va, vb, diff: +((vb - va).toFixed(2)) }; }],
        [T('field_power'), 'power'], [T('field_power_max'), 'powerMax'], [T('field_kill'), 'kill'], [T('field_dead'), 'dead'], [T('field_heal'), 'heal']] },
      { t: T('section_pvp'), fields: [[T('field_infantry'), 'pvpInfantry'], [T('field_cavalry'), 'pvpCavalry'], [T('field_archer'), 'pvpArcher'], [T('field_magic'), 'pvpMagic']] },
      { t: T('section_gather'), fields: [[T('field_gold'), 'goldGather'], [T('field_wood'), 'woodGather'], [T('field_stone'), 'stoneGather'], [T('field_mana'), 'manaGather'], [T('field_gem'), 'gemGather']] },
    ];

    const getAllianceFixed = () => [
      { k: 'power', l: T('col_power') }, { k: 'merit', l: T('col_merit') }, { k: 'meritRate', l: T('col_merit_rate') },
      { k: 'kill', l: T('col_kill') }, { k: 'dead', l: T('col_dead') }, { k: 'heal', l: T('col_heal') },
    ];
    const getAllianceExtra = () => [
      { k: 'pvpInfantry', l: T('col_pvp_infantry') }, { k: 'pvpCavalry', l: T('col_pvp_cavalry') },
      { k: 'pvpArcher', l: T('col_pvp_archer') }, { k: 'pvpMagic', l: T('col_pvp_magic') },
      { k: 'goldGather', l: T('col_gold_gather') }, { k: 'woodGather', l: T('col_wood_gather') },
      { k: 'stoneGather', l: T('col_stone_gather') }, { k: 'manaGather', l: T('col_mana_gather') }, { k: 'gemGather', l: T('col_gem_gather') },
    ];

    let cmpExtraVis = new Set(); // extra cols currently visible
    let top10Vis = new Set(['before', 'after', 'diff']); // all on by default

    // ── Close pickers on outside click ──
    document.addEventListener('click', e => {
      if (!e.target.closest('.cpw'))
        document.querySelectorAll('.cpdrop.open').forEach(d => d.classList.remove('open'));
    });
    window.cpToggle = id => {
      const d = document.getElementById(id); if (!d) return;
      document.querySelectorAll('.cpdrop.open').forEach(x => { if (x.id !== id) x.classList.remove('open'); });
      d.classList.toggle('open');
    };

    // Build a column picker widget
    function makePicker(dropId, fixedCols, extraCols, visSet, toggleFnName) {
      const shown = fixedCols.length + visSet.size, total = fixedCols.length + extraCols.length;
      const hasExtra = visSet.size > 0;
      const fixedItems = fixedCols.length ? `
      <div class="cpgroup-label">${T('cp_default')}</div>
      ${fixedCols.map(c => `<div class="cpitem disabled"><input type="checkbox" checked disabled><label>${c.l}</label></div>`).join('')}
      <div class="cpsep"></div>
      <div class="cpgroup-label">${T('cp_extra')}</div>`: '';
      const extraItems = extraCols.map(c => `
      <div class="cpitem"><input type="checkbox" id="cp_${dropId}_${c.k}" ${visSet.has(c.k) ? 'checked' : ''} onchange="${toggleFnName}('${c.k}',this.checked)"><label for="cp_${dropId}_${c.k}">${c.l}</label></div>`).join('');
      return `<div class="cpw">
      <button class="cpbtn ${hasExtra ? 'active' : ''}" onclick="event.stopPropagation();cpToggle('${dropId}')">⚙ ${T('cp_col')}&nbsp;<span style="opacity:.65">(${shown}/${total})</span></button>
      <div class="cpdrop" id="${dropId}">
        <div class="cpactions">
          <a onclick="${toggleFnName}('__all')">${T('cp_all')}</a>
          <a onclick="${toggleFnName}('__none')">${T('cp_none')}</a>
          <a onclick="${toggleFnName}('__reset')">${T('cp_reset')}</a>
        </div>
        ${fixedItems}${extraItems}
      </div>
    </div>`;
    }

    // ── CMP table column toggle ──
    window.onCmpColToggle = (key, checked) => {
      const extra = getCmpExtra();
      if (key === '__all') extra.forEach(c => cmpExtraVis.add(c.k));
      else if (key === '__none' || key === '__reset') cmpExtraVis = new Set();
      else checked ? cmpExtraVis.add(key) : cmpExtraVis.delete(key);
      _redrawCmpTable(); _syncPickerBtn('cmpColPick', getCmpFixed(), getCmpExtra(), cmpExtraVis);
      getCmpExtra().forEach(c => { const cb = document.getElementById(`cp_cmpColPick_${c.k}`); if (cb) cb.checked = cmpExtraVis.has(c.k); });
    };

    // ── Top10 column toggle ──
    window.onTop10ColToggle = (key, checked) => {
      const cols = getTop10Cols();
      if (key === '__all') cols.forEach(c => top10Vis.add(c.k));
      else if (key === '__none') top10Vis = new Set();
      else if (key === '__reset') top10Vis = new Set(['before', 'after', 'diff']);
      else checked ? top10Vis.add(key) : top10Vis.delete(key);
      const el = document.getElementById('top10Body'); if (el) el.innerHTML = buildTop10(_cmpDiffs, cmpTop10Key);
      _syncPickerBtn('top10ColPick', [], cols, top10Vis);
      cols.forEach(c => { const cb = document.getElementById(`cp_top10ColPick_${c.k}`); if (cb) cb.checked = top10Vis.has(c.k); });
    };

    function _syncPickerBtn(dropId, fixedCols, extraCols, visSet) {
      const btn = document.querySelector(`#${dropId}`);
      if (!btn) return;
      const prevBtn = btn.previousElementSibling; if (!prevBtn) return;
      const shown = fixedCols.length + visSet.size, total = fixedCols.length + extraCols.length;
      prevBtn.innerHTML = `⚙ ${T('cp_col')}&nbsp;<span style="opacity:.65">(${shown}/${total})</span>`;
      prevBtn.className = 'cpbtn' + (visSet.size > 0 ? ' active' : '');
    }

    function _redrawCmpTable() {
      const wrap = document.getElementById('cmpTableWrap'); if (!wrap) return;
      const sorted = [..._cmpDiffs].sort((a, b) => cmpSortDir === 'desc' ? b[cmpSortKey] - a[cmpSortKey] : a[cmpSortKey] - b[cmpSortKey]);
      const filtered = filterDiffs(sorted);
      wrap.innerHTML = buildCmpTable(filtered);
      _updateCmpBadge(filtered, sorted.length);
    }
    function _updateCmpBadge(filtered, total) {
      const badge = document.getElementById('cmpBadge'); if (!badge) return;
      const isOn = !!cmpSearchQ.trim();
      badge.className = 'count-badge' + (isOn ? ' on' : '');
      badge.innerHTML = isOn ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${total} ${T('players_count')}`) : `<b>${total}</b> ${T('players_count')}`;
    }

    function buildCmpTable(filtered) {
      const CMP_FIXED = getCmpFixed(), CMP_EXTRA = getCmpExtra();
      const allCols = [...CMP_FIXED, ...CMP_EXTRA.filter(c => cmpExtraVis.has(c.k))];
      const q = cmpSearchQ;
      const rows = !filtered.length
        ? `<tr class="no-results"><td colspan="${4 + allCols.length}">${T('not_found_row')}</td></tr>`
        : filtered.map((d, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
          return `<tr>
            <td class="rank ${rc}">${medal}</td>
            <td class="id-click" onclick="showDiffDetail('${d.id}')" title="${T('view_detail')}">${d.id}</td>
            <td class="left name" onclick="showDiffDetail('${d.id}',true)">${hl(d.name, q)}</td>
            <td class="left ally">[${hl(d.alliance, q)}]</td>
            ${allCols.map(c => `<td class="${dcls(d[c.k])}">${c.pct ? (d[c.k] >= 0 ? '+' : '') + (+d[c.k] || 0).toFixed(2) + '%' : arrow(d[c.k], cmpNumFmt)}</td>`).join('')}
          </tr>`;
        }).join('');
      return `<table><thead><tr>
        <th style="width:38px">#</th>
        <th class="nosort" style="width:54px">ID 🔍</th>
        <th class="left" style="min-width:140px">${T('col_name')}</th>
        <th class="left" style="width:76px">${T('col_alliance')}</th>
        ${allCols.map(c => `<th class="${cmpSortKey === c.k ? 'sorted' : ''}" onclick="setCmpSort('${c.k}')" style="min-width:110px">${c.pct ? '' : '+/- '}${c.l} ${cmpSortKey === c.k ? (cmpSortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}
      </tr></thead>
      <tbody id="cmpTbody">${rows}</tbody>
    </table>`;
    }

    // ══════════════════════════════════════════════
    // Firebase
    // ══════════════════════════════════════════════
    let _lastDataStr = '';
    async function loadData(fromCache = true) {
      if (fromCache) {
        const cached = _loadCache();
        if (cached) {
          DATA = cached; _lastDataStr = JSON.stringify(cached);
          document.getElementById('loadingScreen').style.display = 'none';
          renderAll(); showTab(activeTab);
        }
      }
      try {
        const snap = await get(ref(fbDB, 'servers'));
        const fresh = snap.val() || {};
        const freshStr = JSON.stringify(fresh);
        _saveCache(fresh);
        if (freshStr !== _lastDataStr) {
          DATA = fresh; _lastDataStr = freshStr;
          document.getElementById('loadingScreen').style.display = 'none';
          renderAll(); showTab(activeTab);
        } else {
          document.getElementById('loadingScreen').style.display = 'none';
        }
        _updateRefreshBtn(false);
      } catch (e) {
        console.error('Firebase load error:', e);
        if (!_lastDataStr) { const el = document.getElementById('loadingText'); if (el) el.textContent = 'Lỗi tải dữ liệu. Vui lòng thử lại.'; }
        _updateRefreshBtn(false);
      }
    }
    function _updateRefreshBtn(loading) {
      const btn = document.getElementById('refreshBtn');
      if (btn) { btn.textContent = loading ? '⏳' : '🔄'; btn.disabled = loading; }
    }
    window.refreshData = () => { _updateRefreshBtn(true); loadData(false); };

    const _PINNED_SERVERS = ['174', '104', '249', '283', '345', '357'];
    const _sortServers = keys => { const pinned = _PINNED_SERVERS.filter(k => keys.includes(k)); const rest = keys.filter(k => !_PINNED_SERVERS.includes(k)).sort((a, b) => +a - +b); return [...pinned, ...rest]; };
    const SERVER_ALLIANCE = { '174': 'S2AK', '104': 'WI-C' };
    let serverGridExpanded = false;
    function _getDominantAlliance(srv) {
      if (SERVER_ALLIANCE[srv]) return SERVER_ALLIANCE[srv];
      const srvData = DATA[srv]; if (!srvData) return '';
      const dates = Object.keys(srvData).sort();
      const rows = srvData[dates[dates.length - 1]] || [];
      const count = {};
      rows.forEach(r => { if (r.alliance) count[r.alliance] = (count[r.alliance] || 0) + 1; });
      const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      return top ? top[0] : '';
    }
    const fmtNum = n => { if (!n || isNaN(n)) return '0'; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return Number(n).toLocaleString(); };
    const fmtFull = n => { if (!n || isNaN(n)) return '0'; return Number(n).toLocaleString('de-DE'); };
    const fmtAuto = (n, fmt) => fmt === 'short' ? fmtNum(n) : fmtFull(n);
    const fmtDate = k => { if (!k) return ''; const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
    const arrow = (v, fmt) => (v >= 0 ? '▲ ' : '▼ ') + fmtAuto(Math.abs(v), fmt);
    const dcls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    function hl(t, q) { if (!q) return String(t); const e = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return String(t).replace(new RegExp(e, 'gi'), m => `<span class="hl">${m}</span>`); }

    function renderAll() { renderTabBar(); renderTab(activeTab); }
    function renderTabBar() {
      const tabs = [
        { k: 'view',     icon: '📊', label: T('tab_view'),     color: '#b06aff' },
        { k: 'alliance', icon: '🌐', label: T('tab_alliance'), color: '#4fa8ff' },
        { k: 'compare',  icon: '⚖️', label: T('tab_compare'),  color: '#3dffa0' },
      ];
      document.getElementById('tabBar').innerHTML =
        tabs.map(t => `<button class="tab-btn ${activeTab === t.k ? 'active' : ''}" data-tab="${t.k}" onclick="showTab('${t.k}')" style="--tab-accent:${t.color}">${t.label}</button>`).join('') +
        `<button id="refreshBtn" class="tab-btn" style="margin-left:auto;font-size:1rem;padding:8px 14px;border-bottom-color:transparent" title="Tải lại dữ liệu" onclick="refreshData()">🔄</button>`;
    }
    function renderTab(name) { if (name === 'view') renderView(); if (name === 'compare') renderCompare(); if (name === 'alliance') renderAlliance(); }
    window.showTab = name => { activeTab = name; document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); const el = document.getElementById('tab-' + name); if (el) el.style.display = ''; document.querySelectorAll('.tab-btn').forEach(el => { if (el.dataset.tab === name) el.classList.add('active'); }); renderTab(name); };


    // ════════════════════════════════════
    // TAB: XEM DỮ LIỆU
    // ════════════════════════════════════
    function filterRows(rows) { const q = searchQuery.trim().toLowerCase(); if (!q) return rows; return rows.filter(r => r.name.toLowerCase().includes(q) || r.alliance.toLowerCase().includes(q) || r.id.toString().includes(q)); }
    function buildRows(filtered, q) {
      const fmt = numFmt === 'short' ? fmtNum : fmtFull;
      if (!filtered.length) return `<tr class="no-results"><td colspan="11">${T('not_found_row')}</td></tr>`;
      return filtered.map((r, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1; const rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : ''; return `<tr><td class="rank ${rc}">${medal}</td><td>${r.id}</td><td class="left name" onclick="showPlayerDetail('${r.id}',false)">${hl(r.name, q)}</td><td class="left ally">[${hl(r.alliance, q)}]</td><td>${fmt(r.merit)}</td><td class="rate">${r.meritRate}%</td><td>${fmt(r.power)}</td><td>${fmt(r.kill)}</td><td>${fmt(r.dead)}</td><td>${fmt(r.heal)}</td><td>${fmt(r.pvpInfantry)}</td></tr>`; }).join('');
    }

    function renderView() {
      const servers = _sortServers(Object.keys(DATA));
      if (!curServer && servers.length) curServer = servers[0];
      if (curServer && DATA[curServer]) { const ds = Object.keys(DATA[curServer]).sort(); if (!curDate || !DATA[curServer][curDate]) curDate = ds[ds.length - 1]; }
      const rows = (curServer && curDate && DATA[curServer]?.[curDate]) || [];
      const dates = curServer && DATA[curServer] ? Object.keys(DATA[curServer]).sort().reverse() : [];
      let html = `<div class="panel"><div class="panel-title">${T('select_server')}</div>`;
      if (!servers.length) html += `<div class="empty">⚔️<br><br>${T('no_data_admin')}</div>`;
      else {
        const _MAX_VISIBLE = 6;
        const visibleServers = serverGridExpanded ? servers : servers.slice(0, _MAX_VISIBLE);
        const hiddenCount = servers.length - _MAX_VISIBLE;
        html += `<div class="server-grid">${visibleServers.map(s => {
          const allyName = _getDominantAlliance(s);
          const isHome = s === '174';
          return `<div class="server-card ${s === curServer ? 'active' : ''} ${isHome ? 'server-home' : ''}" onclick="selectServer('${s}')">
            <div class="server-num">S${s}${isHome ? ' <span style="font-size:.55rem;font-family:\'Rajdhani\',sans-serif;color:var(--gold);letter-spacing:1px;vertical-align:middle;opacity:.9">HOME</span>' : ''}</div>
            ${allyName ? `<div class="server-ally-tag">${allyName}</div>` : ''}
            <div class="server-sub">${T('server_prefix')} ${s}</div>
            <div class="server-days">📅 ${Object.keys(DATA[s]).length} ${T('server_days')}</div>
          </div>`;
        }).join('')}</div>`;
        if (servers.length > _MAX_VISIBLE) {
          html += `<div style="text-align:center;margin-top:12px">
            <button class="btn btn-ghost" style="font-size:.95rem;font-weight:600;padding:8px 28px;border-radius:20px;letter-spacing:.5px" onclick="toggleServerGrid()">
              ${serverGridExpanded ? T('server_collapse') : T('server_expand_btn')(hiddenCount)}
            </button>
          </div>`;
        }
      }
      html += `</div>`;
      if (curServer && dates.length) {
        html += `<div class="panel"><div class="panel-title">${T('select_date')}</div><div class="date-list">${dates.map(d => `<div class="chip ${d === curDate ? 'active' : ''}" onclick="selectDate('${d}')">📅 ${fmtDate(d)}</div>`).join('')}</div></div>`;
        if (rows.length) {
          const tM = rows.reduce((s, r) => s + r.merit, 0), tK = rows.reduce((s, r) => s + r.kill, 0), tH = rows.reduce((s, r) => s + r.heal, 0), tP = rows.reduce((s, r) => s + r.power, 0);
          const al = [...new Set(rows.map(r => r.alliance))];
          html += `<div class="stats-row"><div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">${T('stat_players')}</div><div class="stat-val">${rows.length}</div><div class="stat-sub">${al.length} ${T('stat_alliances')}</div></div><div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">${T('stat_total_power')}</div><div class="stat-val">${fmtNum(tP)}</div></div><div class="stat-card" style="--accent:var(--purple)"><div class="stat-label">${T('stat_total_merit')}</div><div class="stat-val">${fmtNum(tM)}</div></div><div class="stat-card" style="--accent:var(--red)"><div class="stat-label">${T('stat_total_kill')}</div><div class="stat-val">${fmtNum(tK)}</div></div><div class="stat-card" style="--accent:var(--green)"><div class="stat-label">${T('stat_total_heal')}</div><div class="stat-val">${fmtNum(tH)}</div></div></div>`;
          html += _buildViewCharts(rows);
        }
        const cols = [{ k: 'merit', l: T('col_merit') }, { k: 'meritRate', l: T('col_merit_rate') }, { k: 'power', l: T('col_power') }, { k: 'kill', l: T('col_kill') }, { k: 'dead', l: T('col_dead') }, { k: 'heal', l: T('col_heal') }, { k: 'pvpInfantry', l: T('col_pvp_infantry') }];
        const sorted = [...rows].sort((a, b) => sortDir === 'desc' ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);
        const q = searchQuery.trim(); const filtered = filterRows(sorted); const isOn = !!q;
        const badge = isOn ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${sorted.length} ${T('players_count')}`) : `<b>${sorted.length}</b> ${T('players_count')}`;
        html += `<div class="panel" style="padding:0;overflow:hidden">
        <div style="padding:14px 18px 10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px"><div class="panel-title" style="margin:0">${T('ranking')}</div><span class="count-badge ${isOn ? 'on' : ''}">${badge}</span></div>
          <div class="flex-row">
            <div class="search-wrap"><input class="search-input" type="text" id="searchInput" placeholder="${T('search_placeholder')}" value="${q.replace(/"/g, '&quot;')}" oninput="onSearch(this.value)" autocomplete="off"><button class="search-clear ${q ? 'show' : ''}" id="searchClearBtn" onclick="onSearch('');document.getElementById('searchInput').value='';document.getElementById('searchInput').focus()">✕</button></div>
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:100px" onclick="toggleFmt()">${numFmt === 'short' ? T('fmt_short') : T('fmt_full')}</button>
            <select onchange="setSortColFn(this.value)" style="width:auto">${cols.map(c => `<option value="${c.k}" ${sortCol === c.k ? 'selected' : ''}>${c.l}</option>`).join('')}</select>
            <button class="btn btn-ghost" style="padding:4px 11px;font-size:.78rem;border-color:rgba(240,180,41,.45);color:var(--gold-light);white-space:nowrap" onclick="showViewExportModal()">${T('excel_btn')}</button>
          </div>
        </div>
        <div class="table-wrap"><table style="min-width:700px">
          <thead><tr><th style="width:42px">#</th><th style="width:60px">ID</th><th class="left" style="min-width:150px">${T('col_name')}</th><th class="left" style="width:80px">${T('col_alliance')}</th>${cols.map(c => `<th class="${sortCol === c.k ? 'sorted' : ''}" onclick="setSortColFn('${c.k}')" style="width:105px">${c.l} ${sortCol === c.k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}</tr></thead>
          <tbody id="rankTbody">${buildRows(filtered, q)}</tbody>
        </table></div>
      </div>`;
      }
      document.getElementById('tab-view').innerHTML = html;
      if (searchQuery) { const inp = document.getElementById('searchInput'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    }

    window.selectServer = s => { curServer = s; curDate = null; searchQuery = ''; renderView(); };
    window.toggleServerGrid = () => { serverGridExpanded = !serverGridExpanded; renderView(); };
    window.selectDate = d => { curDate = d; renderView(); };
    window.setSortColFn = c => { if (c === sortCol) sortDir = sortDir === 'desc' ? 'asc' : 'desc'; else { sortCol = c; sortDir = 'desc'; } renderView(); };
    window.toggleFmt = () => { numFmt = numFmt === 'short' ? 'full' : 'short'; renderView(); };
    window.onSearch = q => {
      searchQuery = q;
      const cb = document.getElementById('searchClearBtn'); if (cb) cb.classList.toggle('show', !!q);
      const rows = (curServer && curDate && DATA[curServer]?.[curDate]) || []; if (!rows.length) return;
      const sorted = [...rows].sort((a, b) => sortDir === 'desc' ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]); const filtered = filterRows(sorted); const isOn = !!q.trim();
      const badge = document.querySelector('#tab-view .count-badge');
      if (badge) { badge.className = 'count-badge' + (isOn ? ' on' : ''); badge.innerHTML = isOn ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${sorted.length} ${T('players_count')}`) : `<b>${sorted.length}</b> ${T('players_count')}`; }
      const tbody = document.getElementById('rankTbody'); if (tbody) tbody.innerHTML = buildRows(filtered, q);
    };

    window.showPlayerDetail = (id, fromCmp, srvHint) => {
      let r = null;
      if (srvHint && DATA[srvHint]) {
        const dates = Object.keys(DATA[srvHint]).sort();
        r = (DATA[srvHint]?.[dates[dates.length - 1]] || []).find(x => x.id == id);
      }
      if (!r && !fromCmp && curServer && curDate) { r = (DATA[curServer]?.[curDate] || []).find(x => x.id == id); }
      if (!r && cmpSrv) { r = (DATA[cmpSrv]?.[cmpD2] || []).find(x => x.id == id); if (!r) r = (DATA[cmpSrv]?.[cmpD1] || []).find(x => x.id == id); }
      if (!r) { for (const s of Object.keys(DATA)) { const dd = Object.keys(DATA[s]).sort(); r = (DATA[s]?.[dd[dd.length - 1]] || []).find(x => x.id == id); if (r) break; } }
      if (!r) return;
      document.getElementById('pModalName').textContent = r.name;
      document.getElementById('pModalSub').textContent = `[${r.alliance}] · ID: ${r.id}`;
      const secs = [
        { t: T('section_battle'), rows: [['ID', r.id], [T('field_alliance'), r.alliance], [T('field_merit'), fmtFull(r.merit)], [T('field_merit_rate'), r.meritRate + '%'], [T('field_power'), fmtFull(r.power)], [T('field_power_max'), fmtFull(r.powerMax)], [T('field_kill'), fmtFull(r.kill)], [T('field_dead'), fmtFull(r.dead)], [T('field_heal'), fmtFull(r.heal)]] },
        { t: T('section_pvp'), rows: [[T('field_infantry'), fmtFull(r.pvpInfantry)], [T('field_cavalry'), fmtFull(r.pvpCavalry)], [T('field_archer'), fmtFull(r.pvpArcher)], [T('field_magic'), fmtFull(r.pvpMagic)]] },
        { t: T('section_gather'), rows: [[T('field_gold'), fmtFull(r.goldGather)], [T('field_wood'), fmtFull(r.woodGather)], [T('field_stone'), fmtFull(r.stoneGather)], [T('field_mana'), fmtFull(r.manaGather)], [T('field_gem'), fmtFull(r.gemGather)]] }
      ];
      document.getElementById('pModalBody').innerHTML = secs.map(sec => `<div class="detail-sec"><div class="detail-sec-title">${sec.t}</div>${sec.rows.map(([k, v]) => `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`).join('')}</div>`).join('');
      document.getElementById('playerModal').classList.add('open');
    };

    // ════════════════════════════════════
    // TAB: SO SÁNH
    // ════════════════════════════════════
    function computeDiffs(r1, r2) {
      const m1 = Object.fromEntries(r1.map(r => [r.id, r])), m2 = Object.fromEntries(r2.map(r => [r.id, r]));
      const ids = [...new Set([...Object.keys(m1), ...Object.keys(m2)])];
      return ids.map(id => {
        const a = m1[id] || {}, b = m2[id] || {}, g = (o, k) => o[k] || 0;
        return {
          id, name: b.name || a.name || id, alliance: b.alliance || a.alliance || '', a, b,
          merit_before: g(a, 'merit'), merit_after: g(b, 'merit'),
          merit_rate_calc: b.powerMax ? Math.round((g(b, 'merit') - g(a, 'merit')) / b.powerMax * 10000) / 100 : 0,
          dm: g(b, 'merit') - g(a, 'merit'), dp: g(b, 'power') - g(a, 'power'), dk: g(b, 'kill') - g(a, 'kill'),
          dd: g(b, 'dead') - g(a, 'dead'), dh: g(b, 'heal') - g(a, 'heal'),
          dpi: g(b, 'pvpInfantry') - g(a, 'pvpInfantry'), dpc: g(b, 'pvpCavalry') - g(a, 'pvpCavalry'),
          dpa: g(b, 'pvpArcher') - g(a, 'pvpArcher'), dpm: g(b, 'pvpMagic') - g(a, 'pvpMagic'),
          dgg: g(b, 'goldGather') - g(a, 'goldGather'), dwg: g(b, 'woodGather') - g(a, 'woodGather'),
          dsg: g(b, 'stoneGather') - g(a, 'stoneGather'), dmg: g(b, 'manaGather') - g(a, 'manaGather'),
          dgeg: g(b, 'gemGather') - g(a, 'gemGather'),
        };
      });
    }
    function filterDiffs(diffs) { const q = cmpSearchQ.trim().toLowerCase(); if (!q) return diffs; return diffs.filter(d => d.name.toLowerCase().includes(q) || d.alliance.toLowerCase().includes(q) || d.id.toString().includes(q)); }

    function renderCompare() {
      const servers = _sortServers(Object.keys(DATA));
      if (!servers.length) { document.getElementById('tab-compare').innerHTML = `<div class="panel empty">${T('no_data_cmp')}</div>`; return; }
      if (!cmpSrv || !DATA[cmpSrv]) cmpSrv = curServer || servers[0];
      const dates = DATA[cmpSrv] ? Object.keys(DATA[cmpSrv]).sort() : [];
      if (!cmpD1 || !DATA[cmpSrv]?.[cmpD1]) cmpD1 = dates.length >= 2 ? dates[dates.length - 2] : dates[0] || '';
      if (!cmpD2 || !DATA[cmpSrv]?.[cmpD2]) cmpD2 = dates.length >= 1 ? dates[dates.length - 1] : '';
      const mkOpts = srv => (DATA[srv] ? Object.keys(DATA[srv]).sort() : []).map(d => `<option value="${d}">${fmtDate(d)}</option>`).join('');
      document.getElementById('tab-compare').innerHTML = `
      <div class="panel">
        <div class="panel-title">${T('cmp_title')}</div>
        <div class="flex-row" style="margin-bottom:16px;gap:12px">
          <div><div class="section-label">${T('server_prefix')}</div><select id="cmpSrvSel" style="width:auto" onchange="onCmpSrvChange(this.value)">${servers.map(s => `<option value="${s}" ${s === cmpSrv ? 'selected' : ''}>${T('server_prefix')} ${s}</option>`).join('')}</select></div>
          <div><div class="section-label">${T('cmp_date_before')}</div><select id="cmpD1Sel" style="width:auto" onchange="onCmpDateChange()">${mkOpts(cmpSrv)}</select></div>
          <div><div class="section-label">${T('cmp_date_after')}</div><select id="cmpD2Sel" style="width:auto" onchange="onCmpDateChange()">${mkOpts(cmpSrv)}</select></div>
        </div>
        <div id="cmpBody"></div>
      </div>`;
      const d1s = document.getElementById('cmpD1Sel'), d2s = document.getElementById('cmpD2Sel');
      if (d1s) d1s.value = cmpD1; if (d2s) d2s.value = cmpD2;
      renderCmpBody();
    }

    window.onCmpSrvChange = s => {
      cmpSrv = s; const dates = DATA[s] ? Object.keys(DATA[s]).sort() : [];
      const opts = dates.map(d => `<option value="${d}">${fmtDate(d)}</option>`).join('');
      document.getElementById('cmpD1Sel').innerHTML = opts; document.getElementById('cmpD2Sel').innerHTML = opts;
      cmpD1 = dates.length >= 2 ? dates[dates.length - 2] : dates[0] || ''; cmpD2 = dates.length >= 1 ? dates[dates.length - 1] : '';
      document.getElementById('cmpD1Sel').value = cmpD1; document.getElementById('cmpD2Sel').value = cmpD2;
      cmpSearchQ = ''; renderCmpBody();
    };
    window.onCmpDateChange = () => { cmpD1 = document.getElementById('cmpD1Sel')?.value || ''; cmpD2 = document.getElementById('cmpD2Sel')?.value || ''; cmpSearchQ = ''; renderCmpBody(); };

    function renderCmpBody() {
      const el = document.getElementById('cmpBody'); if (!el) return;
      if (!cmpSrv || !cmpD1 || !cmpD2) { el.innerHTML = ''; return; }
      if (cmpD1 === cmpD2) { el.innerHTML = `<div class="status info show">${T('cmp_select_diff')}</div>`; return; }
      const r1 = DATA[cmpSrv]?.[cmpD1] || [], r2 = DATA[cmpSrv]?.[cmpD2] || [];
      _cmpDiffs = computeDiffs(r1, r2);

      const totMetrics = [{ k: 'merit', l: T('col_merit'), acc: 'var(--purple)' }, { k: 'power', l: T('col_power'), acc: 'var(--gold)' }, { k: 'kill', l: T('col_kill'), acc: 'var(--red)' }, { k: 'dead', l: T('col_dead'), acc: 'var(--text-dim)' }, { k: 'heal', l: T('col_heal'), acc: 'var(--green)' }];
      const tot = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
      let html = `<div class="flex-row" style="margin-bottom:14px">
        <div style="padding:7px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:.83rem">📅 <span style="color:var(--text-dim)">${T('cmp_date_before_short')}:</span> <b>${fmtDate(cmpD1)}</b> — ${r1.length} ${T('players_count')}</div>
        <div style="padding:7px 14px;background:var(--bg3);border:1px solid var(--border-gold);border-radius:8px;font-size:.83rem">📅 <span style="color:var(--text-dim)">${T('cmp_date_after_short')}:</span> <b style="color:var(--gold)">${fmtDate(cmpD2)}</b> — ${r2.length} ${T('players_count')}</div>
      </div>
      <div class="section-label">${T('cmp_total_changes')}</div>
      <div class="cmp-grid">`;
      totMetrics.forEach(m => { const s1 = tot(r1, m.k), s2 = tot(r2, m.k), diff = s2 - s1, pct = s1 > 0 ? ((diff / s1) * 100).toFixed(1) : '—'; html += `<div class="cmp-card" style="border-top-color:${m.acc}"><div class="cmp-title">${m.l}</div><div class="cmp-row"><span class="cmp-key">${T('cmp_date_before')}</span><span class="cmp-val">${fmtAuto(s1, cmpNumFmt)}</span></div><div class="cmp-row"><span class="cmp-key">${T('cmp_date_after')}</span><span class="cmp-val">${fmtAuto(s2, cmpNumFmt)}</span></div><div class="cmp-row"><span class="cmp-key">${T('cmp_change')}</span><span class="cmp-val ${dcls(diff)}">${arrow(diff, cmpNumFmt)} (${pct}%)</span></div></div>`; });
      html += `</div>`;

      // ── Detail table with column picker ──
      const sorted = [..._cmpDiffs].sort((a, b) => cmpSortDir === 'desc' ? b[cmpSortKey] - a[cmpSortKey] : a[cmpSortKey] - b[cmpSortKey]);
      const filtered = filterDiffs(sorted); const isOn = !!cmpSearchQ.trim();
      const badge = isOn ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${sorted.length} ${T('players_count')}`) : `<b>${sorted.length}</b> ${T('players_count')}`;
      const cmpPicker = makePicker('cmpColPick', getCmpFixed(), getCmpExtra(), cmpExtraVis, 'onCmpColToggle');

      html += `
      <div style="margin-top:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-family:Arial,sans-serif;font-size:.85rem;color:var(--gold)">${T('cmp_detail')}</span>
            <span class="count-badge ${isOn ? 'on' : ''}" id="cmpBadge">${badge}</span>
            <button class="btn btn-ghost" style="padding:4px 11px;font-size:.78rem;border-color:rgba(240,180,41,.45);color:var(--gold-light);white-space:nowrap" onclick="showExportModal()">${T('excel_btn')}</button>
          </div>
          <div class="flex-row">
            <div class="search-wrap">
              <input class="search-input" id="cmpSearch" type="text" placeholder="${T('cmp_search')}" value="${cmpSearchQ.replace(/"/g, '&quot;')}" oninput="onCmpSearch(this.value)" autocomplete="off">
              <button class="search-clear ${cmpSearchQ ? 'show' : ''}" id="cmpSearchClear" onclick="onCmpSearch('');document.getElementById('cmpSearch').value='';document.getElementById('cmpSearch').focus()">✕</button>
            </div>
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:105px" onclick="toggleCmpFmt()">${cmpNumFmt === 'short' ? T('fmt_short') : T('fmt_full')}</button>
            <select style="width:auto" id="cmpSortSel" onchange="setCmpSort(this.value)">${getDiffSortOpts().map(o => `<option value="${o.v}" ${cmpSortKey === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>
            ${cmpPicker}
          </div>
        </div>
        <div class="panel" style="padding:0;overflow:hidden;margin-bottom:0">
          <div class="table-wrap" id="cmpTableWrap">${buildCmpTable(filtered)}</div>
        </div>
      </div>`;

      // ── Top 10 with column picker ──
      const top10Picker = makePicker('top10ColPick', [], getTop10Cols(), top10Vis, 'onTop10ColToggle');
      html += `
      <div style="margin-top:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div class="section-label" style="margin:0">${T('cmp_top10')}</div>
          <div class="flex-row">
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem" onclick="toggleTop10Dir()">${top10Dir === 'desc' ? T('dir_desc') : T('dir_asc')}</button>
            ${top10Picker}
          </div>
        </div>
        <div class="metric-tabs" id="top10Tabs">${getTop10Metas().map(m => `<button class="metric-tab ${cmpTop10Key === m.v ? 'active' : ''}" onclick="setCmpTop10('${m.v}')">${m.l}</button>`).join('')}</div>
        <div id="top10Body">${buildTop10(_cmpDiffs, cmpTop10Key)}</div>
      </div>`;

      el.innerHTML = html;
      if (cmpSearchQ) { const inp = document.getElementById('cmpSearch'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
      initStickyHScroll('cmpTableWrap');
    }

    function buildTop10(diffs, key) {
      const _metas = getTop10Metas();
      const meta = _metas.find(m => m.v === key) || _metas[0];
      const top = [...diffs].sort((a, b) => top10Dir === 'desc' ? b[key] - a[key] : a[key] - b[key]).slice(0, 10);
      if (!top.length) return `<div class="empty" style="padding:20px">${T('no_data_short')}</div>`;
      const showBefore = top10Vis.has('before'), showAfter = top10Vis.has('after'), showDiff = top10Vis.has('diff');
      return `<div class="panel" style="padding:0;overflow:hidden;margin-bottom:0"><div class="table-wrap"><table>
      <thead><tr>
        <th style="width:38px">#</th>
        <th class="left">${T('col_name')}</th>
        <th class="left" style="width:80px">${T('col_alliance')}</th>
        <th class="nosort" style="width:60px">ID</th>
        ${showBefore ? `<th class="nosort">${T('cmp_date_before_short')} (${fmtDate(cmpD1)})</th>` : ''}
        ${showAfter ? `<th class="nosort">${T('cmp_date_after_short')} (${fmtDate(cmpD2)})</th>` : ''}
        ${showDiff ? `<th class="nosort">+/- ${meta.l.replace('▲ ', '')}</th>` : ''}
      </tr></thead>
      <tbody>${top.map((d, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        const before = d.a[meta.field] || 0, after = d.b[meta.field] || 0, diff = after - before;
        return `<tr>
          <td class="rank ${rc}">${medal}</td>
          <td class="left name" onclick="showDiffDetail('${d.id}',true)">${d.name}</td>
          <td class="left ally">[${d.alliance}]</td>
          <td class="id-click" onclick="showDiffDetail('${d.id}')">${d.id}</td>
          ${showBefore ? `<td>${fmtAuto(before, cmpNumFmt)}</td>` : ''}
          ${showAfter ? `<td style="font-weight:600">${fmtAuto(after, cmpNumFmt)}</td>` : ''}
          ${showDiff ? `<td class="${dcls(diff)}" style="font-weight:700">${arrow(diff, cmpNumFmt)}</td>` : ''}
        </tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
    }

    window.toggleCmpFmt = () => { cmpNumFmt = cmpNumFmt === 'short' ? 'full' : 'short'; renderCmpBody(); };

    window.setCmpSort = key => {
      if (key === cmpSortKey) cmpSortDir = cmpSortDir === 'desc' ? 'asc' : 'desc'; else { cmpSortKey = key; cmpSortDir = 'desc'; }
      const sorted = [..._cmpDiffs].sort((a, b) => cmpSortDir === 'desc' ? b[cmpSortKey] - a[cmpSortKey] : a[cmpSortKey] - b[cmpSortKey]);
      const filtered = filterDiffs(sorted);
      const wrap = document.getElementById('cmpTableWrap'); if (wrap) wrap.innerHTML = buildCmpTable(filtered);
      _updateCmpBadge(filtered, sorted.length);
      const sel = document.getElementById('cmpSortSel'); if (sel) sel.value = key;
    };

    window.onCmpSearch = q => {
      cmpSearchQ = q;
      const cb = document.getElementById('cmpSearchClear'); if (cb) cb.classList.toggle('show', !!q);
      const sorted = [..._cmpDiffs].sort((a, b) => cmpSortDir === 'desc' ? b[cmpSortKey] - a[cmpSortKey] : a[cmpSortKey] - b[cmpSortKey]);
      const filtered = filterDiffs(sorted);
      const wrap = document.getElementById('cmpTableWrap'); if (wrap) wrap.innerHTML = buildCmpTable(filtered);
      _updateCmpBadge(filtered, sorted.length);
    };

    window.toggleTop10Dir = () => {
      top10Dir = top10Dir === 'desc' ? 'asc' : 'desc';
      const el = document.getElementById('top10Body'); if (el) el.innerHTML = buildTop10(_cmpDiffs, cmpTop10Key);
      const btn = document.querySelector('#top10Tabs').previousElementSibling?.querySelector('button');
      if (btn) btn.textContent = top10Dir === 'desc' ? T('dir_desc') : T('dir_asc');
    };

    window.setCmpTop10 = key => {
      cmpTop10Key = key;
      document.querySelectorAll('#top10Tabs .metric-tab').forEach(b => b.classList.toggle('active', b.getAttribute('onclick') === `setCmpTop10('${key}')`));
      const el = document.getElementById('top10Body'); if (el) el.innerHTML = buildTop10(_cmpDiffs, key);
    };

    // ── Diff Detail Modal ──
    window.showDiffDetail = id => {
      const d = _cmpDiffs.find(x => x.id == id); if (!d) return;
      document.getElementById('diffModalTitle').textContent = `⚔️ ${d.name}`;
      document.getElementById('diffModalSub').textContent = `[${d.alliance}] · ID: ${d.id} · ${fmtDate(cmpD1)} → ${fmtDate(cmpD2)}`;
      const allRows = getDiffSections().map(sec => {
        const hdr = `<tr><td colspan="4" style="padding:10px 10px 4px;font-size:.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-dim);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">${sec.t}</td></tr>`;
        const drows = sec.fields.map(([label, field, isPct, computeFn]) => {
          let va, vb, diff;
          if (computeFn) { ({ va, vb, diff } = computeFn(d.a, d.b)); }
          else { va = d.a[field] || 0; vb = d.b[field] || 0; diff = vb - va; }
          const fA = computeFn ? va.toFixed(2) + '%' : isPct ? va + '%' : fmtFull(va);
          const fB = computeFn ? vb.toFixed(2) + '%' : isPct ? vb + '%' : fmtFull(vb);
          const fD = (computeFn || isPct) ? (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%' : (diff >= 0 ? '▲ ' : '▼ ') + fmtFull(Math.abs(diff));
          return `<tr style="border-bottom:1px solid rgba(42,48,80,.2)">
          <td style="padding:6px 10px;color:var(--text-dim);font-size:.85rem;white-space:nowrap">${label}</td>
          <td style="padding:6px 12px;text-align:right;color:var(--text-dim);font-variant-numeric:tabular-nums;white-space:nowrap">${fA}</td>
          <td style="padding:6px 12px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${fB}</td>
          <td style="padding:6px 12px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap" class="${dcls(diff)}">${fD}</td>
        </tr>`;
        }).join('');
        return hdr + drows;
      }).join('');
      document.getElementById('diffModalBody').innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.88rem">
        <thead><tr>
          <th style="padding:8px 10px;text-align:left;font-size:.72rem;letter-spacing:1px;text-transform:uppercase;color:var(--text-dim);width:30%"></th>
          <th style="padding:8px 12px;text-align:right;font-size:.72rem;letter-spacing:1px;background:rgba(42,48,80,.4);border:1px solid var(--border);border-radius:4px;color:var(--text-dim)">📅 ${fmtDate(cmpD1)}</th>
          <th style="padding:8px 12px;text-align:right;font-size:.72rem;letter-spacing:1px;background:rgba(240,180,41,.07);border:1px solid var(--border-gold);border-radius:4px;color:var(--gold)">📅 ${fmtDate(cmpD2)}</th>
          <th style="padding:8px 12px;text-align:right;font-size:.72rem;letter-spacing:1px;background:rgba(61,255,160,.07);border:1px solid rgba(61,255,160,.2);border-radius:4px;color:var(--green)">${T('diff_col_diff')}</th>
        </tr></thead>
        <tbody>${allRows}</tbody>
      </table>
      <div style="font-size:.75rem;color:var(--text-dim);margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        ${T('diff_tip')}
      </div>`;
      document.getElementById('diffModal').classList.add('open');
    };

    // ════════════════════════════════════
    // TAB: LIÊN MINH / SERVER (tổng hợp)
    // ════════════════════════════════════
    function _getAllianceDates() {
      const dateSet = new Set();
      Object.keys(DATA).forEach(srv => Object.keys(DATA[srv] || {}).forEach(d => dateSet.add(d)));
      return [...dateSet].sort();
    }

    function _getClosestDate(srv, targetDate) {
      const dates = DATA[srv] ? Object.keys(DATA[srv]).sort() : [];
      if (!dates.length) return null;
      if (!targetDate) return dates[dates.length - 1];
      const candidates = dates.filter(d => d <= targetDate);
      return candidates.length ? candidates[candidates.length - 1] : null;
    }

    const _DELTA_KEYS = ['power', 'merit', 'kill', 'dead', 'heal', 'pvpInfantry', 'pvpCavalry', 'pvpArcher', 'pvpMagic', 'goldGather', 'woodGather', 'stoneGather', 'manaGather', 'gemGather'];

    function _getAllianceRows() {
      const servers = _sortServers(Object.keys(DATA));
      const allRows = [], srvInfo = [];
      const isRange = allianceDataMode === 'growth' && !!(allianceFromDate && allianceFromDate !== allianceToDate);
      servers.forEach(srv => {
        const toDate = allianceDataMode === 'total' ? _getClosestDate(srv, null) : _getClosestDate(srv, allianceToDate);
        if (!toDate) return;
        const toRows = DATA[srv][toDate] || [];
        if (isRange) {
          const fromDate = _getClosestDate(srv, allianceFromDate);
          const fromRows = fromDate ? (DATA[srv][fromDate] || []) : [];
          const fromMap = {};
          fromRows.forEach(r => { fromMap[r.id] = r; });
          toRows.forEach(r => {
            const prev = fromMap[r.id] || {};
            const delta = {};
            _DELTA_KEYS.forEach(k => { delta[k] = (r[k] || 0) - (prev[k] || 0); });
            allRows.push({ ...r, ...delta, _server: srv });
          });
          srvInfo.push({ srv, date: toDate, fromDate: fromDate || '?', count: toRows.length });
        } else {
          toRows.forEach(r => allRows.push({ ...r, _server: srv }));
          srvInfo.push({ srv, date: toDate, count: toRows.length });
        }
      });
      return { allRows, srvInfo, servers, isRange };
    }

    function _sortAllianceRows(allRows) {
      return [...allRows].sort((a, b) => {
        if (allianceSortCol === '_server') {
          const va = +a._server || 0, vb = +b._server || 0;
          return allianceSortDir === 'desc' ? vb - va : va - vb;
        }
        return allianceSortDir === 'desc' ? (b[allianceSortCol] || 0) - (a[allianceSortCol] || 0) : (a[allianceSortCol] || 0) - (b[allianceSortCol] || 0);
      });
    }

    function _fmtCell(n, isRange, fmt) {
      const v = n || 0;
      if (!isRange) return fmt(Math.abs(v) === v ? v : v);
      const abs = fmt(Math.abs(v));
      if (v > 0) return `<span class="pos">▲ ${abs}</span>`;
      if (v < 0) return `<span class="neg">▼ ${abs}</span>`;
      return `<span style="opacity:.5">0</span>`;
    }

    function _buildAllianceRows(filtered, allCols, q, isRange) {
      const fmt = n => allianceNumFmt === 'short' ? fmtNum(n) : fmtFull(n);
      if (!filtered.length) return `<tr class="no-results"><td colspan="${5 + allCols.length}">${T('not_found_row')}</td></tr>`;
      return filtered.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        return `<tr>
          <td class="rank ${rc}">${medal}</td>
          <td style="text-align:center;font-weight:600;color:var(--gold-light)">S${r._server}</td>
          <td>${r.id}</td>
          <td class="left name" onclick="showPlayerDetail('${r.id}',false,'${r._server}')">${hl(r.name, q)}</td>
          <td class="left ally">[${hl(r.alliance, q)}]</td>
          ${allCols.map(c => c.k === 'meritRate' ? `<td class="rate">${r.meritRate || 0}%</td>` : `<td>${_fmtCell(r[c.k], isRange, fmt)}</td>`).join('')}
        </tr>`;
      }).join('');
    }

    function _getServerAggRows(allRows) {
      const map = {}, allyCount = {};
      allRows.forEach(r => {
        const s = r._server;
        if (!map[s]) { map[s] = { _server: s, power: 0, merit: 0, kill: 0, dead: 0, heal: 0, pvpInfantry: 0, pvpCavalry: 0, pvpArcher: 0, pvpMagic: 0, goldGather: 0, woodGather: 0, stoneGather: 0, manaGather: 0, gemGather: 0, _playerCount: 0 }; allyCount[s] = {}; }
        const m = map[s];
        m.power += r.power || 0; m.merit += r.merit || 0; m.kill += r.kill || 0; m.dead += r.dead || 0;
        m.heal += r.heal || 0; m.pvpInfantry += r.pvpInfantry || 0; m.pvpCavalry += r.pvpCavalry || 0;
        m.pvpArcher += r.pvpArcher || 0; m.pvpMagic += r.pvpMagic || 0;
        m.goldGather += r.goldGather || 0; m.woodGather += r.woodGather || 0; m.stoneGather += r.stoneGather || 0;
        m.manaGather += r.manaGather || 0; m.gemGather += r.gemGather || 0; m._playerCount++;
        if (r.alliance) allyCount[s][r.alliance] = (allyCount[s][r.alliance] || 0) + 1;
      });
      Object.keys(map).forEach(s => {
        const top = Object.entries(allyCount[s] || {}).sort((a, b) => b[1] - a[1])[0];
        map[s]._topAlliance = top ? top[0] : '';
      });
      return Object.values(map);
    }

    function _sortServerAggRows(rows) {
      const col = allianceSortCol === 'meritRate' ? 'merit' : allianceSortCol;
      return [...rows].sort((a, b) => {
        if (col === '_server') { const va = +a._server || 0, vb = +b._server || 0; return allianceSortDir === 'desc' ? vb - va : va - vb; }
        return allianceSortDir === 'desc' ? (b[col] || 0) - (a[col] || 0) : (a[col] || 0) - (b[col] || 0);
      });
    }

    function _buildServerAggRows(rows, allCols, isRange) {
      const fmt = n => allianceNumFmt === 'short' ? fmtNum(n) : fmtFull(n);
      if (!rows.length) return `<tr class="no-results"><td colspan="${4 + (allCols.length || 0)}">${T('not_found_row')}</td></tr>`;
      return rows.map((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
        return `<tr>
          <td class="rank ${rc}">${medal}</td>
          <td style="text-align:center;font-weight:600;color:var(--gold-light);font-size:1rem">S${r._server}</td>
          <td class="left ally" style="min-width:80px">${r._topAlliance ? `[${r._topAlliance}]` : '—'}</td>
          <td style="text-align:center;color:var(--text-dim)">${r._playerCount}</td>
          ${allCols.map(c => c.k === 'meritRate' ? `<td class="rate">—</td>` : `<td>${_fmtCell(r[c.k], isRange, fmt)}</td>`).join('')}
        </tr>`;
      }).join('');
    }

    function renderAlliance() {
      const { allRows, srvInfo, servers, isRange } = _getAllianceRows();
      if (!servers.length) { document.getElementById('tab-alliance').innerHTML = `<div class="panel empty">⚔️<br><br>${T('no_data_admin')}</div>`; return; }

      const FIXED = getAllianceFixed(), EXTRA = getAllianceExtra();
      const allCols = [...FIXED, ...EXTRA.filter(c => allianceExtraVis.has(c.k))];
      const allDates = _getAllianceDates();
      const selStyle = `width:auto;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:4px 10px;font-size:.8rem;cursor:pointer`;
      const mkDateOpts = (selected, includeEmpty, emptyLabel) =>
        (includeEmpty ? `<option value="">${emptyLabel}</option>` : '') +
        allDates.map(d => `<option value="${d}" ${d === selected ? 'selected' : ''}>${fmtDate(d)}</option>`).join('');

      // View mode toggle
      const viewToggle = `<div style="display:flex;gap:4px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:3px">
        <button class="btn ${allianceViewMode === 'members' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 14px;font-size:.8rem" onclick="setAllianceViewMode('members')">${T('alliance_view_members')}</button>
        <button class="btn ${allianceViewMode === 'servers' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 14px;font-size:.8rem" onclick="setAllianceViewMode('servers')">${T('alliance_view_servers')}</button>
      </div>`;

      // Data mode toggle + conditional date pickers
      const dataToggle = `<div style="display:flex;gap:4px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:3px">
        <button class="btn ${allianceDataMode === 'total' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 14px;font-size:.8rem" onclick="setAllianceDataMode('total')">${T('alliance_mode_total')}</button>
        <button class="btn ${allianceDataMode === 'growth' ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 14px;font-size:.8rem" onclick="setAllianceDataMode('growth')">${T('alliance_mode_growth')}</button>
      </div>`;
      const datePickers = allianceDataMode === 'growth' ? `
        <span style="color:var(--text-dim);font-size:.8rem;white-space:nowrap">${T('alliance_from_date')}:</span>
        <select style="${selStyle}" onchange="setAllianceDateRange('from',this.value)">
          <option value="">—</option>
          ${mkDateOpts(allianceFromDate, false, '')}
        </select>
        <span style="color:var(--text-dim);font-size:.8rem;white-space:nowrap">${T('alliance_to_date')}:</span>
        <select style="${selStyle}" onchange="setAllianceDateRange('to',this.value)">
          ${mkDateOpts(allianceToDate, true, T('alliance_latest_label'))}
        </select>
        ${isRange ? `<span style="background:rgba(0,200,100,.12);color:var(--green);border:1px solid rgba(0,200,100,.3);border-radius:6px;padding:3px 10px;font-size:.78rem;font-weight:600">📈 ${T('alliance_growth_mode')}</span>` : `<span style="color:var(--text-dim);font-size:.78rem">${T('alliance_pick_from')}</span>`}
      ` : '';

      let html = `<div class="panel">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div class="panel-title" style="margin:0">${T('alliance_title')}</div>
          ${viewToggle}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          ${dataToggle}
          ${datePickers}
        </div>
        <div class="flex-row" style="margin-bottom:16px;gap:8px;flex-wrap:wrap">
          ${srvInfo.map(si => `<div style="padding:6px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:.8rem">
            <span style="color:var(--gold);font-weight:700">S${si.srv}</span>
            <span style="color:var(--text-dim);margin:0 5px">·</span>
            ${isRange ? `<span style="color:var(--text-dim)">${fmtDate(si.fromDate)}</span><span style="color:var(--text-dim);margin:0 4px">→</span>` : ''}
            <span>📅 ${fmtDate(si.date)}</span>
            <span style="color:var(--text-dim);margin-left:5px">(${si.count} ${T('players_count')})</span>
          </div>`).join('')}
        </div>`;

      if (allRows.length) {
        const tP = allRows.reduce((s, r) => s + (r.power || 0), 0), tM = allRows.reduce((s, r) => s + (r.merit || 0), 0);
        const tK = allRows.reduce((s, r) => s + (r.kill || 0), 0), tH = allRows.reduce((s, r) => s + (r.heal || 0), 0);
        const al = [...new Set(allRows.map(r => r.alliance))];
        const fmtStat = n => isRange ? (n >= 0 ? `▲ ${fmtNum(n)}` : `▼ ${fmtNum(Math.abs(n))}`) : fmtNum(n);
        html += `<div class="stats-row">
          <div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">${T('stat_players')}</div><div class="stat-val">${allRows.length}</div><div class="stat-sub">${servers.length} ${T('server_count_unit')} · ${al.length} ${T('stat_alliances')}</div></div>
          <div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">${T('stat_total_power')}</div><div class="stat-val">${fmtStat(tP)}</div></div>
          <div class="stat-card" style="--accent:var(--purple)"><div class="stat-label">${T('stat_total_merit')}</div><div class="stat-val">${fmtStat(tM)}</div></div>
          <div class="stat-card" style="--accent:var(--red)"><div class="stat-label">${T('stat_total_kill')}</div><div class="stat-val">${fmtStat(tK)}</div></div>
          <div class="stat-card" style="--accent:var(--green)"><div class="stat-label">${T('stat_total_heal')}</div><div class="stat-val">${fmtStat(tH)}</div></div>
        </div>`;
      }

      if (allianceViewMode === 'servers') {
        // ── Server ranking view ──
        const aggRows = _sortServerAggRows(_getServerAggRows(allRows));
        const srvSortInd = allianceSortCol === '_server' ? (allianceSortDir === 'desc' ? '↓' : '↑') : '↕';
        html += `<div class="panel" style="padding:0;overflow:hidden;margin-bottom:0">
          <div style="padding:14px 18px 10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="panel-title" style="margin:0">${T('alliance_view_servers')}</div>
              <span class="count-badge">${aggRows.length} ${T('server_count_unit')}</span>
            </div>
            <div class="flex-row">
              <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:100px" onclick="toggleAllianceFmt()">${allianceNumFmt === 'short' ? T('fmt_short') : T('fmt_full')}</button>
            </div>
          </div>
          <div class="table-wrap" id="allianceTableWrap">
            <table>
              <thead><tr>
                <th style="width:38px">#</th>
                <th class="${allianceSortCol === '_server' ? 'sorted' : ''}" onclick="setAllianceSort('_server')" style="width:70px">Server ${srvSortInd}</th>
                <th class="left" style="min-width:80px">${T('col_alliance')}</th>
                <th style="width:80px">${T('col_players')}</th>
                ${allCols.map(c => `<th class="${allianceSortCol === c.k ? 'sorted' : ''}" onclick="setAllianceSort('${c.k}')" style="min-width:110px">${c.l} ${allianceSortCol === c.k ? (allianceSortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}
              </tr></thead>
              <tbody>${_buildServerAggRows(aggRows, allCols, isRange)}</tbody>
            </table>
          </div>
        </div>`;
      } else {
        // ── Member ranking view (top 500) ──
        const sorted = _sortAllianceRows(allRows);
        const q = allianceSearch.trim();
        const qL = q.toLowerCase();
        const fullFiltered = qL ? sorted.filter(r => r.name.toLowerCase().includes(qL) || r.alliance.toLowerCase().includes(qL) || r.id.toString().includes(qL) || r._server.includes(qL)) : sorted;
        const filtered = fullFiltered.slice(0, 500);
        const isOn = !!q;
        const badge = isOn
          ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${fullFiltered.length} ${T('players_count')}`)
          : `<b>${filtered.length}</b> / ${sorted.length} ${T('players_count')} · ${T('alliance_top500')}`;
        const srvSortInd = allianceSortCol === '_server' ? (allianceSortDir === 'desc' ? '↓' : '↑') : '↕';
        html += `<div class="panel" style="padding:0;overflow:hidden;margin-bottom:0">
          <div style="padding:14px 18px 10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="panel-title" style="margin:0">${T('ranking')}</div>
              <span class="count-badge ${isOn ? 'on' : ''}" id="allianceBadge">${badge}</span>
            </div>
            <div class="flex-row">
              <div class="search-wrap">
                <input class="search-input" type="text" id="allianceSearchInput" placeholder="${T('search_placeholder')}" value="${q.replace(/"/g, '&quot;')}" oninput="onAllianceSearch(this.value)" autocomplete="off">
                <button class="search-clear ${q ? 'show' : ''}" id="allianceSearchClear" onclick="onAllianceSearch('');document.getElementById('allianceSearchInput').value='';document.getElementById('allianceSearchInput').focus()">✕</button>
              </div>
              <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:100px" onclick="toggleAllianceFmt()">${allianceNumFmt === 'short' ? T('fmt_short') : T('fmt_full')}</button>
            </div>
          </div>
          <div class="table-wrap" id="allianceTableWrap">
            <table>
              <thead><tr>
                <th style="width:38px">#</th>
                <th class="${allianceSortCol === '_server' ? 'sorted' : ''}" onclick="setAllianceSort('_server')" style="width:70px">Server ${srvSortInd}</th>
                <th style="width:60px">ID</th>
                <th class="left" style="min-width:150px">${T('col_name')}</th>
                <th class="left" style="width:80px">${T('col_alliance')}</th>
                ${allCols.map(c => `<th class="${allianceSortCol === c.k ? 'sorted' : ''}" onclick="setAllianceSort('${c.k}')" style="min-width:110px">${c.l} ${allianceSortCol === c.k ? (allianceSortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}
              </tr></thead>
              <tbody id="allianceTbody">${_buildAllianceRows(filtered, allCols, q, isRange)}</tbody>
            </table>
          </div>
        </div>`;
      }

      html += '</div>';
      document.getElementById('tab-alliance').innerHTML = html;
      initStickyHScroll('allianceTableWrap');
      if (allianceViewMode === 'members' && allianceSearch) { const inp = document.getElementById('allianceSearchInput'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    }

    window.setAllianceDateRange = (which, val) => {
      if (which === 'from') allianceFromDate = val || null;
      else allianceToDate = val || null;
      renderAlliance();
    };
    window.setAllianceDataMode = mode => { allianceDataMode = mode; renderAlliance(); };
    window.setAllianceViewMode = mode => { allianceViewMode = mode; allianceSortCol = 'power'; allianceSortDir = 'desc'; renderAlliance(); };
    window.toggleAllianceFmt = () => { allianceNumFmt = allianceNumFmt === 'short' ? 'full' : 'short'; renderAlliance(); };
    window.setAllianceSort = key => {
      if (key === allianceSortCol) allianceSortDir = allianceSortDir === 'desc' ? 'asc' : 'desc'; else { allianceSortCol = key; allianceSortDir = 'desc'; }
      renderAlliance();
    };
    window.onAllianceSearch = q => {
      allianceSearch = q;
      const cb = document.getElementById('allianceSearchClear'); if (cb) cb.classList.toggle('show', !!q);
      const { allRows, isRange } = _getAllianceRows();
      const FIXED = getAllianceFixed(), EXTRA = getAllianceExtra();
      const allCols = [...FIXED, ...EXTRA.filter(c => allianceExtraVis.has(c.k))];
      const sorted = _sortAllianceRows(allRows);
      const qL = q.trim().toLowerCase();
      const fullFiltered = qL ? sorted.filter(r => r.name.toLowerCase().includes(qL) || r.alliance.toLowerCase().includes(qL) || r.id.toString().includes(qL) || r._server.includes(qL)) : sorted;
      const filtered = fullFiltered.slice(0, 500);
      const isOn = !!q.trim();
      const tbody = document.getElementById('allianceTbody');
      if (tbody) tbody.innerHTML = _buildAllianceRows(filtered, allCols, q, isRange);
      const badge = document.getElementById('allianceBadge');
      if (badge) {
        badge.className = 'count-badge' + (isOn ? ' on' : '');
        badge.innerHTML = isOn
          ? (filtered.length === 0 ? T('not_found_badge') : `<b>${filtered.length}</b> / ${fullFiltered.length} ${T('players_count')}`)
          : `<b>${filtered.length}</b> / ${sorted.length} ${T('players_count')} · ${T('alliance_top500')}`;
      }
    };
    window.onAllianceColToggle = (key, checked) => {
      const extra = getAllianceExtra();
      if (key === '__all') extra.forEach(c => allianceExtraVis.add(c.k));
      else if (key === '__none' || key === '__reset') allianceExtraVis = new Set();
      else checked ? allianceExtraVis.add(key) : allianceExtraVis.delete(key);
      renderAlliance();
      getAllianceExtra().forEach(c => { const cb = document.getElementById(`cp_allianceColPick_${c.k}`); if (cb) cb.checked = allianceExtraVis.has(c.k); });
    };

    // ── Sticky horizontal scrollbar ──
    function initStickyHScroll(wrapId) {
      const wrap = document.getElementById(wrapId);
      if (!wrap) return;
      const bar = document.createElement('div');
      bar.className = 'sticky-hscroll';
      const inner = document.createElement('div');
      bar.appendChild(inner);
      wrap.parentElement.insertAdjacentElement('afterend', bar);
      const syncWidth = () => {
        inner.style.width = wrap.scrollWidth + 'px';
        bar.style.display = wrap.scrollWidth > wrap.clientWidth ? 'block' : 'none';
      };
      syncWidth();
      let lock = false;
      bar.addEventListener('scroll', () => { if (!lock) { lock = true; wrap.scrollLeft = bar.scrollLeft; lock = false; } });
      wrap.addEventListener('scroll', () => { if (!lock) { lock = true; bar.scrollLeft = wrap.scrollLeft; lock = false; } });
      new ResizeObserver(syncWidth).observe(wrap);
    }

    // ══════════════════════════════════════════════
    // Export to Excel
    // ══════════════════════════════════════════════
    const _EH = 'a1cde3236ffa871b590111e71f93f29a570556af87319facbaaee5cd4d3fcbbf';
    async function _hp(p) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
      return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    // Diff-based columns (chênh lệch giữa 2 ngày)
    const EXPORT_COLS_DEF = () => [
      { k: 'id',    label: 'ID',                                  field: 'id',    w: 10, num: false, def: true },
      { k: 'name',  label: T('col_name'),                         field: 'name',  w: 22, num: false, def: true },
      { k: 'alliance', label: T('col_alliance'),                  field: 'alliance', w: 12, num: false, def: false },
      { k: 'merit_before', label: T('excel_merit_before'),        field: 'merit_before', w: 18, num: true, def: true },
      { k: 'merit_after',  label: T('excel_merit_after'),         field: 'merit_after',  w: 18, num: true, def: true },
      { k: 'merit_rate_calc', label: T('excel_merit_rate_calc'),  field: 'merit_rate_calc', w: 15, num: true, pct: true, def: true },
      { k: 'dm',    label: '+/- ' + T('col_merit'),               field: 'dm',    w: 18, num: true, def: true, sortDef: true },
      { k: 'dp',    label: '+/- ' + T('col_power'),               field: 'dp',    w: 18, num: true, def: true },
      { k: 'dk',    label: '+/- ' + T('col_kill'),                field: 'dk',    w: 18, num: true, def: true },
      { k: 'dd',    label: '+/- ' + T('col_dead'),                field: 'dd',    w: 15, num: true, def: true },
      { k: 'dh',    label: '+/- ' + T('col_heal'),                field: 'dh',    w: 18, num: true, def: true },
      { k: 'dpi',   label: '+/- ' + T('col_pvp_infantry'),         field: 'dpi',   w: 18, num: true, def: false },
      { k: 'dpc',   label: '+/- ' + T('col_pvp_cavalry'),         field: 'dpc',   w: 18, num: true, def: false },
      { k: 'dpa',   label: '+/- ' + T('col_pvp_archer'),          field: 'dpa',   w: 18, num: true, def: false },
      { k: 'dpm',   label: '+/- ' + T('col_pvp_magic'),           field: 'dpm',   w: 18, num: true, def: false },
      { k: 'dgg',   label: '+/- ' + T('col_gold_gather'),         field: 'dgg',   w: 18, num: true, def: false },
      { k: 'dwg',   label: '+/- ' + T('col_wood_gather'),         field: 'dwg',   w: 18, num: true, def: false },
      { k: 'dsg',   label: '+/- ' + T('col_stone_gather'),        field: 'dsg',   w: 18, num: true, def: false },
      { k: 'dmg',   label: '+/- ' + T('col_mana_gather'),         field: 'dmg',   w: 18, num: true, def: false },
      { k: 'dgeg',  label: '+/- ' + T('col_gem_gather'),          field: 'dgeg',  w: 15, num: true, def: false },
    ];

    window.showExportModal = () => {
      closeExport();
      const ov = document.createElement('div');
      ov.id = 'exportOverlay';
      ov.className = 'modal-overlay open';
      ov.onclick = e => { if (e.target === ov) closeExport(); };
      ov.innerHTML = `
        <div class="modal" style="max-width:600px">
          <div class="modal-header">
            <div>
              <div style="font-size:1.05rem;color:var(--gold)">${T('excel_title')}</div>
              <div style="font-size:.8rem;color:var(--text-dim);margin-top:3px" id="exportSubtitle">${T('excel_pwd_subtitle')}</div>
            </div>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:.85rem;flex-shrink:0" onclick="closeExport()">✕</button>
          </div>
          <div class="modal-body">
            <div id="exportStep1">
              <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${T('excel_pwd_label')}</div>
              <div style="display:flex;gap:8px">
                <div style="position:relative;flex:1">
                  <input type="password" id="exportPwdInput" placeholder="${T('excel_pwd_input')}" style="padding-right:42px" autocomplete="new-password" onkeydown="if(event.key==='Enter')verifyExportPwd()">
                  <button onclick="const i=document.getElementById('exportPwdInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;padding:2px">👁</button>
                </div>
                <button class="btn btn-primary" onclick="verifyExportPwd()">${T('excel_pwd_confirm')}</button>
              </div>
              <div id="exportPwdErr" style="color:var(--red);font-size:.85rem;margin-top:8px;display:none">${T('excel_pwd_err')}</div>
            </div>
            <div id="exportStep2" style="display:none"></div>
          </div>
        </div>`;
      document.body.appendChild(ov);
      setTimeout(() => document.getElementById('exportPwdInput')?.focus(), 80);
    };

    window.closeExport = () => { document.getElementById('exportOverlay')?.remove(); };

    window.verifyExportPwd = async () => {
      const inp = document.getElementById('exportPwdInput');
      const errEl = document.getElementById('exportPwdErr');
      if (!inp) return;
      inp.disabled = true;
      const hash = await _hp(inp.value);
      inp.disabled = false;
      if (hash !== _EH) {
        errEl.style.display = 'block';
        inp.value = ''; inp.focus();
        return;
      }
      errEl.style.display = 'none';
      document.getElementById('exportStep1').style.display = 'none';
      document.getElementById('exportSubtitle').textContent = T('excel_col_subtitle');
      const step2 = document.getElementById('exportStep2');
      step2.style.display = 'block';
      _renderExportCols(step2);
    };

    function _renderExportCols(container) {
      const cols = EXPORT_COLS_DEF();
      const sortCols = cols.filter(c => c.num);
      const srv = cmpSrv || '?';
      const dt = cmpD1 && cmpD2 ? `${fmtDate(cmpD1)} → ${fmtDate(cmpD2)}` : '—';
      container.innerHTML = `
        <div style="margin-bottom:14px">
          <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">${T('excel_col_title')}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">
            ${cols.map(c => `<label style="display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--bg3);border:1px solid ${c.def ? 'var(--border-gold)' : 'var(--border)'};border-radius:8px;cursor:pointer;font-size:.86rem" id="elbl_${c.k}">
              <input type="checkbox" id="ecol_${c.k}" ${c.def ? 'checked' : ''} style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0" onchange="document.getElementById('elbl_${c.k}').style.borderColor=this.checked?'var(--border-gold)':'var(--border)'">
              <span>${c.label}</span>
            </label>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:14px">
          <div>
            <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">${T('excel_sort_label')}</div>
            <select id="exportSortCol" style="width:auto">${sortCols.map(c => `<option value="${c.field}" ${c.sortDef ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
          </div>
          <div>
            <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">${T('excel_dir_label')}</div>
            <select id="exportSortDir" style="width:auto">
              <option value="desc" selected>${T('dir_desc')}</option>
              <option value="asc">${T('dir_asc')}</option>
            </select>
          </div>
          <div style="flex:1;min-width:120px;text-align:right">
            <div style="font-size:.75rem;color:var(--text-dim)">${T('excel_data_label')}</div>
            <div style="font-size:.85rem;color:var(--gold);font-weight:600">Server ${srv} · ${dt}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeExport()">${T('excel_cancel')}</button>
          <button class="btn btn-primary" onclick="runExport()">${T('excel_export_btn')}</button>
        </div>`;
    }

    window.runExport = () => {
      const selectedCols = EXPORT_COLS_DEF().filter(c => document.getElementById('ecol_' + c.k)?.checked);
      if (!selectedCols.length) { alert(T('excel_no_col')); return; }
      const sortField = document.getElementById('exportSortCol')?.value || 'dm';
      const sortDir = document.getElementById('exportSortDir')?.value || 'desc';
      if (!_cmpDiffs.length) { alert(T('excel_no_data')); return; }
      const sorted = [..._cmpDiffs].sort((a, b) => {
        const va = +a[sortField] || 0, vb = +b[sortField] || 0;
        return sortDir === 'desc' ? vb - va : va - vb;
      });
      _doExcelExport(sorted, selectedCols);
      closeExport();
    };

    function _doExcelExport(sorted, cols) {
      const XLSXlib = window.XLSX;
      if (!XLSXlib) { alert('Thư viện XLSX chưa tải xong, vui lòng thử lại!'); return; }

      const srv = cmpSrv || '?';
      const d1str = cmpD1 || '';
      const d2str = cmpD2 || '';
      const dtFile = `${d1str.replace(/-/g, '')}_${d2str.replace(/-/g, '')}`;
      const sheetName = `S${srv} Diff`.substring(0, 31);

      // Header style — dark blue bg, white bold text, center
      const hStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        fill: { fgColor: { rgb: '1F3864' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        border: { top: { style: 'thin', color: { rgb: '2E4272' } }, bottom: { style: 'thin', color: { rgb: '2E4272' } }, left: { style: 'thin', color: { rgb: '2E4272' } }, right: { style: 'thin', color: { rgb: '2E4272' } } }
      };
      const hStyleL = { ...hStyle, alignment: { ...hStyle.alignment, horizontal: 'left' } };

      // Row fill colors
      const rowFills = [
        { rgb: 'FFD700' }, // gold #1
        { rgb: 'BFBFBF' }, // silver #2
        { rgb: 'F4C270' }, // bronze #3
      ];
      const evenFill = { rgb: 'EEF2FF' };
      const oddFill  = { rgb: 'FFFFFF' };

      const cellBorder = { top: { style: 'thin', color: { rgb: 'D9E1F2' } }, bottom: { style: 'thin', color: { rgb: 'D9E1F2' } }, left: { style: 'thin', color: { rgb: 'D9E1F2' } }, right: { style: 'thin', color: { rgb: 'D9E1F2' } } };

      function dataCellStyle(isNum, value, rowIdx, col = null) {
        const fill = { fgColor: rowIdx < 3 ? rowFills[rowIdx] : (rowIdx % 2 === 0 ? evenFill : oddFill) };
        const bold = rowIdx < 3;
        const color = isNum && typeof value === 'number'
          ? (value > 0 ? '2E7D32' : value < 0 ? 'C62828' : '555555')
          : '1A1A2E';
        return {
          font: { bold, color: { rgb: color }, sz: 10 },
          fill,
          alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center' },
          border: cellBorder,
          numFmt: isNum ? (col?.pct ? '0.00' : '#,##0') : '@'
        };
      }

      // Build rows
      const aoa = []; // array of arrays for cell values
      const styles = []; // parallel array of style rows

      // Header row
      const hdrVals = ['#', ...cols.map(c => c.label)];
      const hdrStyles = [hStyle, ...cols.map(c => c.num ? hStyle : hStyleL)];
      aoa.push(hdrVals);
      styles.push(hdrStyles);

      sorted.forEach((r, i) => {
        const vals = [i + 1];
        const rowStyles = [{ ...dataCellStyle(true, i + 1, i), alignment: { horizontal: 'center', vertical: 'center' }, numFmt: '0' }];
        cols.forEach(c => {
          let v = r[c.field];
          if (c.num) {
            v = (v == null || v === '') ? 0 : +v || 0;
          } else {
            v = v != null ? String(v) : '';
          }
          vals.push(v);
          rowStyles.push(dataCellStyle(c.num, c.num ? v : 0, i, c));
        });
        aoa.push(vals);
        styles.push(rowStyles);
      });

      // Build worksheet from aoa
      const ws = XLSXlib.utils.aoa_to_sheet(aoa);

      // Apply styles cell by cell
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      styles.forEach((rowS, ri) => {
        rowS.forEach((s, ci) => {
          const col = ci < 26 ? alpha[ci] : alpha[Math.floor(ci / 26) - 1] + alpha[ci % 26];
          const cellAddr = `${col}${ri + 1}`;
          if (!ws[cellAddr]) ws[cellAddr] = { v: aoa[ri][ci], t: typeof aoa[ri][ci] === 'number' ? 'n' : 's' };
          ws[cellAddr].s = s;
          if (s.numFmt && typeof aoa[ri][ci] === 'number') ws[cellAddr].z = s.numFmt;
        });
      });

      // Column widths
      ws['!cols'] = [{ wch: 5 }, ...cols.map(c => ({ wch: c.w }))];

      // Freeze first row
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };

      // Autofilter on header row
      const lastCol = alpha[cols.length] || alpha[cols.length % 26];
      ws['!autofilter'] = { ref: `A1:${lastCol}1` };

      // Set worksheet range
      ws['!ref'] = XLSXlib.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sorted.length, c: cols.length } });

      const wb = XLSXlib.utils.book_new();
      XLSXlib.utils.book_append_sheet(wb, ws, sheetName);

      // Title info sheet
      const infoWs = XLSXlib.utils.aoa_to_sheet([
        [T('excel_info_title')],
        [`${T('excel_info_server')} ${srv}`],
        [`${T('excel_info_before')} ${fmtDate(d1str)}`],
        [`${T('excel_info_after')} ${fmtDate(d2str)}`],
        [`${T('excel_info_export')} ${new Date().toLocaleString(getLang() === 'vi' ? 'vi-VN' : 'en-US')}`],
      ]);
      XLSXlib.utils.book_append_sheet(wb, infoWs, 'Info');

      XLSXlib.writeFile(wb, `Alliance_S${srv}_${dtFile}.xlsx`);
    }

    // ══════════════════════════════════════════════
    // View Tab — Export to Excel (snapshot by date)
    // ══════════════════════════════════════════════
    const EXPORT_VIEW_COLS_DEF = () => [
      { k: 'id',          label: 'ID',                      field: 'id',          w: 10,  num: false, def: true  },
      { k: 'name',        label: T('col_name'),              field: 'name',        w: 22,  num: false, def: true  },
      { k: 'alliance',    label: T('col_alliance'),          field: 'alliance',    w: 12,  num: false, def: true  },
      { k: 'power',       label: T('col_power'),             field: 'power',       w: 18,  num: true,  def: true  },
      { k: 'merit',       label: T('col_merit'),             field: 'merit',       w: 18,  num: true,  def: true, sortDef: true },
      { k: 'meritRate',   label: T('col_merit_rate'),        field: 'meritRate',   w: 12,  num: true,  def: true, pct: true },
      { k: 'kill',        label: T('col_kill'),              field: 'kill',        w: 18,  num: true,  def: true  },
      { k: 'dead',        label: T('col_dead'),              field: 'dead',        w: 15,  num: true,  def: true  },
      { k: 'heal',        label: T('col_heal'),              field: 'heal',        w: 18,  num: true,  def: true  },
      { k: 'pvpInfantry', label: T('col_pvp_infantry'),       field: 'pvpInfantry', w: 18,  num: true,  def: false },
      { k: 'pvpCavalry',  label: T('col_pvp_cavalry'),       field: 'pvpCavalry',  w: 18,  num: true,  def: false },
      { k: 'pvpArcher',   label: T('col_pvp_archer'),        field: 'pvpArcher',   w: 18,  num: true,  def: false },
      { k: 'pvpMagic',    label: T('col_pvp_magic'),         field: 'pvpMagic',    w: 18,  num: true,  def: false },
      { k: 'goldGather',  label: T('col_gold_gather'),       field: 'goldGather',  w: 18,  num: true,  def: false },
      { k: 'woodGather',  label: T('col_wood_gather'),       field: 'woodGather',  w: 18,  num: true,  def: false },
      { k: 'stoneGather', label: T('col_stone_gather'),      field: 'stoneGather', w: 18,  num: true,  def: false },
      { k: 'manaGather',  label: T('col_mana_gather'),       field: 'manaGather',  w: 18,  num: true,  def: false },
      { k: 'gemGather',   label: T('col_gem_gather'),        field: 'gemGather',   w: 15,  num: true,  def: false },
    ];

    window.showViewExportModal = () => {
      document.getElementById('viewExportOverlay')?.remove();
      const ov = document.createElement('div');
      ov.id = 'viewExportOverlay';
      ov.className = 'modal-overlay open';
      ov.onclick = e => { if (e.target === ov) closeViewExport(); };
      ov.innerHTML = `
        <div class="modal" style="max-width:600px">
          <div class="modal-header">
            <div>
              <div style="font-size:1.05rem;color:var(--gold)">${T('excel_view_title')}</div>
              <div style="font-size:.8rem;color:var(--text-dim);margin-top:3px" id="vExportSubtitle">${T('excel_pwd_subtitle')}</div>
            </div>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:.85rem;flex-shrink:0" onclick="closeViewExport()">✕</button>
          </div>
          <div class="modal-body">
            <div id="vExportStep1">
              <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">${T('excel_pwd_label')}</div>
              <div style="display:flex;gap:8px">
                <div style="position:relative;flex:1">
                  <input type="password" id="vExportPwdInput" placeholder="${T('excel_pwd_input')}" style="padding-right:42px" autocomplete="new-password" onkeydown="if(event.key==='Enter')verifyViewExportPwd()">
                  <button onclick="const i=document.getElementById('vExportPwdInput');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'👁':'🙈'" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;padding:2px">👁</button>
                </div>
                <button class="btn btn-primary" onclick="verifyViewExportPwd()">${T('excel_pwd_confirm')}</button>
              </div>
              <div id="vExportPwdErr" style="color:var(--red);font-size:.85rem;margin-top:8px;display:none">${T('excel_pwd_err')}</div>
            </div>
            <div id="vExportStep2" style="display:none"></div>
          </div>
        </div>`;
      document.body.appendChild(ov);
      setTimeout(() => document.getElementById('vExportPwdInput')?.focus(), 80);
    };

    window.closeViewExport = () => { document.getElementById('viewExportOverlay')?.remove(); };

    window.verifyViewExportPwd = async () => {
      const inp = document.getElementById('vExportPwdInput');
      const errEl = document.getElementById('vExportPwdErr');
      if (!inp) return;
      inp.disabled = true;
      const hash = await _hp(inp.value);
      inp.disabled = false;
      if (hash !== _EH) { errEl.style.display = 'block'; inp.value = ''; inp.focus(); return; }
      errEl.style.display = 'none';
      document.getElementById('vExportStep1').style.display = 'none';
      document.getElementById('vExportSubtitle').textContent = T('excel_col_subtitle');
      const step2 = document.getElementById('vExportStep2');
      step2.style.display = 'block';
      _renderViewExportCols(step2);
    };

    function _renderViewExportCols(container) {
      const cols = EXPORT_VIEW_COLS_DEF();
      const sortCols = cols.filter(c => c.num);
      const srv = curServer || '?';
      const dt = curDate ? fmtDate(curDate) : '—';
      container.innerHTML = `
        <div style="margin-bottom:14px">
          <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">${T('excel_col_title')}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px">
            ${cols.map(c => `<label style="display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--bg3);border:1px solid ${c.def ? 'var(--border-gold)' : 'var(--border)'};border-radius:8px;cursor:pointer;font-size:.86rem" id="velbl_${c.k}">
              <input type="checkbox" id="vecol_${c.k}" ${c.def ? 'checked' : ''} style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0" onchange="document.getElementById('velbl_${c.k}').style.borderColor=this.checked?'var(--border-gold)':'var(--border)'">
              <span>${c.label}</span>
            </label>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-bottom:14px">
          <div>
            <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">${T('excel_sort_label')}</div>
            <select id="vExportSortCol" style="width:auto">${sortCols.map(c => `<option value="${c.field}" ${c.field === sortCol || c.sortDef ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
          </div>
          <div>
            <div style="font-size:.75rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">${T('excel_dir_label')}</div>
            <select id="vExportSortDir" style="width:auto">
              <option value="desc" ${sortDir === 'desc' ? 'selected' : ''}>${T('dir_desc')}</option>
              <option value="asc" ${sortDir === 'asc' ? 'selected' : ''}>${T('dir_asc')}</option>
            </select>
          </div>
          <div style="flex:1;min-width:120px;text-align:right">
            <div style="font-size:.75rem;color:var(--text-dim)">${T('excel_view_data_label')}</div>
            <div style="font-size:.85rem;color:var(--gold);font-weight:600">Server ${srv} · ${dt}</div>
          </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="closeViewExport()">${T('excel_cancel')}</button>
          <button class="btn btn-primary" onclick="runViewExport()">${T('excel_export_btn')}</button>
        </div>`;
    }

    window.runViewExport = () => {
      const selectedCols = EXPORT_VIEW_COLS_DEF().filter(c => document.getElementById('vecol_' + c.k)?.checked);
      if (!selectedCols.length) { alert(T('excel_no_col')); return; }
      const rows = (curServer && curDate && DATA[curServer]?.[curDate]) || [];
      if (!rows.length) { alert(T('excel_view_no_data')); return; }
      const sf = document.getElementById('vExportSortCol')?.value || 'merit';
      const sd = document.getElementById('vExportSortDir')?.value || 'desc';
      const sorted = [...rows].sort((a, b) => sd === 'desc' ? (+b[sf] || 0) - (+a[sf] || 0) : (+a[sf] || 0) - (+b[sf] || 0));
      _doViewExcelExport(sorted, selectedCols);
      closeViewExport();
    };

    function _doViewExcelExport(sorted, cols) {
      const XLSXlib = window.XLSX;
      if (!XLSXlib) { alert('Thư viện XLSX chưa tải xong, vui lòng thử lại!'); return; }
      const srv = curServer || '?';
      const dtFile = (curDate || '').replace(/-/g, '');
      const sheetName = `S${srv} ${curDate || ''}`.substring(0, 31);

      const hStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
        fill: { fgColor: { rgb: '1F3864' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
        border: { top: { style: 'thin', color: { rgb: '2E4272' } }, bottom: { style: 'thin', color: { rgb: '2E4272' } }, left: { style: 'thin', color: { rgb: '2E4272' } }, right: { style: 'thin', color: { rgb: '2E4272' } } }
      };
      const hStyleL = { ...hStyle, alignment: { ...hStyle.alignment, horizontal: 'left' } };
      const rowFills = [{ rgb: 'FFD700' }, { rgb: 'BFBFBF' }, { rgb: 'F4C270' }];
      const cellBorder = { top: { style: 'thin', color: { rgb: 'D9E1F2' } }, bottom: { style: 'thin', color: { rgb: 'D9E1F2' } }, left: { style: 'thin', color: { rgb: 'D9E1F2' } }, right: { style: 'thin', color: { rgb: 'D9E1F2' } } };

      function cellStyle(isNum, rowIdx, col = null) {
        const fill = { fgColor: rowIdx < 3 ? rowFills[rowIdx] : (rowIdx % 2 === 0 ? { rgb: 'EEF2FF' } : { rgb: 'FFFFFF' }) };
        return {
          font: { bold: rowIdx < 3, color: { rgb: '1A1A2E' }, sz: 10 },
          fill, alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center' },
          border: cellBorder, numFmt: isNum ? (col?.pct ? '0.00' : '#,##0') : '@'
        };
      }

      const aoa = [], styles = [];
      aoa.push(['#', ...cols.map(c => c.label)]);
      styles.push([hStyle, ...cols.map(c => c.num ? hStyle : hStyleL)]);

      sorted.forEach((r, i) => {
        const vals = [i + 1];
        const rowS = [{ ...cellStyle(true, i), alignment: { horizontal: 'center', vertical: 'center' }, numFmt: '0' }];
        cols.forEach(c => {
          let v = r[c.field];
          if (c.num) v = (v == null || v === '') ? 0 : +v || 0;
          else v = v != null ? String(v) : '';
          vals.push(v);
          rowS.push(cellStyle(c.num, i, c));
        });
        aoa.push(vals); styles.push(rowS);
      });

      const ws = XLSXlib.utils.aoa_to_sheet(aoa);
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      styles.forEach((rowS, ri) => {
        rowS.forEach((s, ci) => {
          const col = ci < 26 ? alpha[ci] : alpha[Math.floor(ci / 26) - 1] + alpha[ci % 26];
          const ca = `${col}${ri + 1}`;
          if (!ws[ca]) ws[ca] = { v: aoa[ri][ci], t: typeof aoa[ri][ci] === 'number' ? 'n' : 's' };
          ws[ca].s = s;
          if (s.numFmt && typeof aoa[ri][ci] === 'number') ws[ca].z = s.numFmt;
        });
      });

      ws['!cols'] = [{ wch: 5 }, ...cols.map(c => ({ wch: c.w }))];
      ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
      const lastCol = alpha[cols.length] || alpha[cols.length % 26];
      ws['!autofilter'] = { ref: `A1:${lastCol}1` };
      ws['!ref'] = XLSXlib.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sorted.length, c: cols.length } });

      const wb = XLSXlib.utils.book_new();
      XLSXlib.utils.book_append_sheet(wb, ws, sheetName);
      const infoWs = XLSXlib.utils.aoa_to_sheet([
        [T('excel_info_title')],
        [`${T('excel_info_server')} ${srv}`],
        [`${T('excel_info_date')} ${fmtDate(curDate || '')}`],
        [`${T('excel_info_export')} ${new Date().toLocaleString(getLang() === 'vi' ? 'vi-VN' : 'en-US')}`],
      ]);
      XLSXlib.utils.book_append_sheet(wb, infoWs, 'Info');
      XLSXlib.writeFile(wb, `Alliance_S${srv}_${dtFile}.xlsx`);
    }

    // ══════════════════════════════════════════════
    // CHARTS (View tab)
    // ══════════════════════════════════════════════
    function _buildViewCharts(rows) {
      if (!rows || !rows.length) return '';

      // ── Donut: power distribution ──
      const PG = [
        { label: '15–40M', color: '#00b4d8', min: 15e6, max: 40e6 },
        { label: '40–60M', color: '#3dffa0', min: 40e6, max: 60e6 },
        { label: '60–100M', color: '#f0b429', min: 60e6, max: 100e6 },
        { label: '100M+',  color: '#ff6b35', min: 100e6, max: Infinity },
      ];
      const pc = PG.map(g => rows.filter(r => r.power >= g.min && r.power < g.max).length);
      const pt = pc.reduce((s, c) => s + c, 0) || 1;
      const R = 52, CX = 68, CY = 68, SW = 15, circ = 2 * Math.PI * R;
      let off = circ / 4; // start at top
      const segs = PG.map((g, i) => {
        const len = pc[i] / pt * circ;
        const s = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${g.color}" stroke-width="${SW}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" opacity="${pc[i] ? 1 : 0.1}"/>`;
        off -= len;
        return s;
      }).join('');
      const tierCards = PG.map((g, i) => {
        const pct = Math.round(pc[i] / pt * 100);
        return `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:8px 10px;border-left:3px solid ${g.color}">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
            <span style="font-size:.72rem;color:var(--text-dim)">${g.label}</span>
            <span style="font-size:.78rem;font-weight:700;color:${g.color}">${pct}%</span>
          </div>
          <div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:5px">${pc[i]} <span style="font-size:.68rem;font-weight:400;color:var(--text-dim)">${T('chart_players_label')}</span></div>
          <div style="background:rgba(255,255,255,.07);border-radius:3px;height:5px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${g.color};border-radius:3px;transition:width .4s"></div></div>
        </div>`;
      }).join('');
      const donut = `<div style="display:flex;flex-direction:column;align-items:center;gap:12px">
        <svg viewBox="0 0 136 136" width="136" height="136">
          <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="${SW}"/>${segs}
          <text x="${CX}" y="${CY-5}" text-anchor="middle" fill="var(--gold)" font-size="18" font-weight="700" font-family="Arial,sans-serif">${rows.length}</text>
          <text x="${CX}" y="${CY+11}" text-anchor="middle" fill="rgba(255,255,255,.35)" font-size="9" font-family="Arial,sans-serif">${T('chart_players_label')}</text>
        </svg>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%">${tierCards}</div>
      </div>`;

      // ── Horizontal bar chart ──
      function barChart(field, color) {
        const top = [...rows].filter(r => (r[field] || 0) > 0).sort((a, b) => b[field] - a[field]).slice(0, 15);
        if (!top.length) return `<div style="color:var(--text-dim);font-size:.8rem;text-align:center;padding:20px 0">—</div>`;
        const mx = top[0][field];
        return top.map((r, i) => {
          const pct = (r[field] / mx * 100).toFixed(1);
          const nm = r.name.length > 12 ? r.name.slice(0, 11) + '…' : r.name;
          return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:5px"><span style="width:14px;font-size:.67rem;color:var(--text-dim);text-align:right;flex-shrink:0">${i+1}</span><span style="width:76px;font-size:.71rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0" title="${r.name}">${nm}</span><div style="flex:1;background:rgba(255,255,255,.06);border-radius:3px;height:11px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div></div><span style="width:42px;text-align:right;font-size:.7rem;color:${color};font-weight:600;flex-shrink:0">${fmtNum(r[field])}</span></div>`;
        }).join('');
      }

      return `<div class="charts-row">
        <div class="chart-card"><div class="chart-title">⚔️ ${T('chart_power_dist')}</div>${donut}</div>
        <div class="chart-card"><div class="chart-title">🏆 ${T('chart_top_merit')}</div>${barChart('merit','#a78bfa')}</div>
        <div class="chart-card"><div class="chart-title">⚔️ ${T('chart_top_kill')}</div>${barChart('kill','#00b4d8')}</div>
      </div>`;
    }

    // ── Language toggle ──
    window.toggleLang = () => {
      setLang(getLang() === 'vi' ? 'en' : 'vi');
      renderAll();
      _updateFooter();
    };

    function _updateFooter() {
      const el = document.getElementById('footerContact');
      if (el) el.textContent = T('footer_contact');
      const btn = document.getElementById('langToggleBtn');
      if (btn) btn.textContent = T('lang_toggle');
    }

    // ── Start: load data after all functions defined ──
    _updateFooter();
    loadData();
