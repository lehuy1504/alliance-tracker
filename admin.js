    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
    import { getDatabase, ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
    import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

    const firebaseConfig = { apiKey: "AIzaSyCp6L4C-4KhZNm67VpC3hu7ws_n2C5XTfA", authDomain: "alliance-tracker-ddc87.firebaseapp.com", databaseURL: "https://alliance-tracker-ddc87-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "alliance-tracker-ddc87", storageBucket: "alliance-tracker-ddc87.firebasestorage.app", messagingSenderId: "910735026600", appId: "1:910735026600:web:d2199d026f1e476cb4d59d" };
    const fbApp = initializeApp(firebaseConfig), fbDB = getDatabase(fbApp), fbAuth = getAuth(fbApp);

    let DATA = {}, isAdmin = false, curServer = null, curDate = null;
    let activeTab = 'view', sortCol = 'merit', sortDir = 'desc', numFmt = 'short', searchQuery = '';
    let cmpSrv = null, cmpD1 = null, cmpD2 = null;
    let cmpNumFmt = 'short', cmpSortKey = 'dm', cmpSortDir = 'desc', cmpSearchQ = '', cmpTop10Key = 'dm', top10Dir = 'desc';
    let _cmpDiffs = [];

    // ══════════════════════════════════════════════
    // Column config for compare table
    // ══════════════════════════════════════════════
    // Fixed cols always visible; extra cols toggleable
    const CMP_FIXED = [
      { k: 'dm', l: 'Công Trạng' }, { k: 'dk', l: 'Tiêu Diệt' }, { k: 'dh', l: 'Chữa Lính' },
      { k: 'dd', l: 'Tử Trận' }, { k: 'dp', l: 'Lực Chiến' }, { k: 'dn', l: 'Tiêu Mana' },
    ];
    const CMP_EXTRA = [
      { k: 'dgs', l: 'Vàng Tiêu' }, { k: 'dws', l: 'Gỗ Tiêu' }, { k: 'dss', l: 'Đá Tiêu' }, { k: 'dges', l: 'Gem Tiêu' },
      { k: 'dgg', l: 'Vàng Thu' }, { k: 'dwg', l: 'Gỗ Thu' }, { k: 'dsg', l: 'Đá Thu' }, { k: 'dmg', l: 'Mana Thu' }, { k: 'dgeg', l: 'Gem Thu' },
    ];
    let cmpExtraVis = new Set(); // extra cols currently visible

    // Column config for top10
    const TOP10_COLS = [
      { k: 'before', l: 'Giá Trị Trước' }, { k: 'after', l: 'Giá Trị Sau' }, { k: 'diff', l: 'Chênh Lệch' },
    ];
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
    // fixedCols = always-on (shown greyed out), extraCols = toggleable
    function makePicker(dropId, fixedCols, extraCols, visSet, toggleFnName) {
      const shown = fixedCols.length + visSet.size, total = fixedCols.length + extraCols.length;
      const hasExtra = visSet.size > 0;
      const fixedItems = fixedCols.length ? `
      <div class="cpgroup-label">Mặc định</div>
      ${fixedCols.map(c => `<div class="cpitem disabled"><input type="checkbox" checked disabled><label>${c.l}</label></div>`).join('')}
      <div class="cpsep"></div>
      <div class="cpgroup-label">Tùy chọn thêm</div>`: '';
      const extraItems = extraCols.map(c => `
      <div class="cpitem"><input type="checkbox" id="cp_${dropId}_${c.k}" ${visSet.has(c.k) ? 'checked' : ''} onchange="${toggleFnName}('${c.k}',this.checked)"><label for="cp_${dropId}_${c.k}">${c.l}</label></div>`).join('');
      return `<div class="cpw">
      <button class="cpbtn ${hasExtra ? 'active' : ''}" onclick="event.stopPropagation();cpToggle('${dropId}')">⚙ Cột&nbsp;<span style="opacity:.65">(${shown}/${total})</span></button>
      <div class="cpdrop" id="${dropId}">
        <div class="cpactions">
          <a onclick="${toggleFnName}('__all')">Tất cả</a>
          <a onclick="${toggleFnName}('__none')">Bỏ thêm</a>
          <a onclick="${toggleFnName}('__reset')">Mặc định</a>
        </div>
        ${fixedItems}${extraItems}
      </div>
    </div>`;
    }

    // ── CMP table column toggle ──
    window.onCmpColToggle = (key, checked) => {
      if (key === '__all') CMP_EXTRA.forEach(c => cmpExtraVis.add(c.k));
      else if (key === '__none' || key === '__reset') cmpExtraVis = new Set();
      else checked ? cmpExtraVis.add(key) : cmpExtraVis.delete(key);
      _redrawCmpTable(); _syncPickerBtn('cmpColPick', CMP_FIXED, CMP_EXTRA, cmpExtraVis);
      CMP_EXTRA.forEach(c => { const cb = document.getElementById(`cp_cmpColPick_${c.k}`); if (cb) cb.checked = cmpExtraVis.has(c.k); });
    };

    // ── Top10 column toggle ──
    window.onTop10ColToggle = (key, checked) => {
      if (key === '__all') TOP10_COLS.forEach(c => top10Vis.add(c.k));
      else if (key === '__none') top10Vis = new Set();
      else if (key === '__reset') top10Vis = new Set(['before', 'after', 'diff']);
      else checked ? top10Vis.add(key) : top10Vis.delete(key);
      const el = document.getElementById('top10Body'); if (el) el.innerHTML = buildTop10(_cmpDiffs, cmpTop10Key);
      _syncPickerBtn('top10ColPick', [], TOP10_COLS, top10Vis);
      TOP10_COLS.forEach(c => { const cb = document.getElementById(`cp_top10ColPick_${c.k}`); if (cb) cb.checked = top10Vis.has(c.k); });
    };

    function _syncPickerBtn(dropId, fixedCols, extraCols, visSet) {
      const btn = document.querySelector(`#${dropId}`);
      if (!btn) return;
      const prevBtn = btn.previousElementSibling; if (!prevBtn) return;
      const shown = fixedCols.length + visSet.size, total = fixedCols.length + extraCols.length;
      prevBtn.innerHTML = `⚙ Cột&nbsp;<span style="opacity:.65">(${shown}/${total})</span>`;
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
      badge.innerHTML = isOn ? (filtered.length === 0 ? '❌ Không tìm thấy' : `<b>${filtered.length}</b> / ${total} người`) : `<b>${total}</b> người chơi`;
    }

    function buildCmpTable(filtered) {
      const allCols = [...CMP_FIXED, ...CMP_EXTRA.filter(c => cmpExtraVis.has(c.k))];
      const q = cmpSearchQ;
      const rows = !filtered.length
        ? `<tr class="no-results"><td colspan="${4 + allCols.length}">😔 Không tìm thấy — thử từ khác?</td></tr>`
        : filtered.map((d, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1, rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : '';
          return `<tr>
            <td class="rank ${rc}">${medal}</td>
            <td class="id-click" onclick="showDiffDetail('${d.id}')" title="Xem chi tiết">${d.id}</td>
            <td class="left name" onclick="showDiffDetail('${d.id}',true)">${hl(d.name, q)}</td>
            <td class="left ally">[${hl(d.alliance, q)}]</td>
            ${allCols.map(c => `<td class="${dcls(d[c.k])}">${arrow(d[c.k], cmpNumFmt)}</td>`).join('')}
          </tr>`;
        }).join('');
      return `<table><thead><tr>
        <th style="width:38px">#</th>
        <th class="nosort" style="width:54px">ID 🔍</th>
        <th class="left" style="min-width:140px">Tên</th>
        <th class="left" style="width:76px">Liên Minh</th>
        ${allCols.map(c => `<th class="${cmpSortKey === c.k ? 'sorted' : ''}" onclick="setCmpSort('${c.k}')" style="min-width:110px">+/- ${c.l} ${cmpSortKey === c.k ? (cmpSortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}
      </tr></thead>
      <tbody id="cmpTbody">${rows}</tbody>
    </table>`;
    }

    // ══════════════════════════════════════════════
    // Firebase
    // ══════════════════════════════════════════════
    onAuthStateChanged(fbAuth, user => {
      isAdmin = !!user;
      if (isAdmin) { document.getElementById('loginModal').classList.remove('open'); if (activeTab === 'view') activeTab = 'import'; }
      else { if (['import', 'manage'].includes(activeTab)) activeTab = 'view'; }
      renderAll(); showTab(activeTab);
    });
    onValue(ref(fbDB, 'servers'), snap => {
      DATA = snap.val() || {};
      document.getElementById('loadingScreen').style.display = 'none';
      renderAll();
    });
    async function saveData(p, v) { document.getElementById('savingBadge').style.display = ''; try { await set(ref(fbDB, p), v); } catch (e) { alert('Lỗi lưu: ' + e.message); } document.getElementById('savingBadge').style.display = 'none'; }
    async function removeData(p) { document.getElementById('savingBadge').style.display = ''; try { await remove(ref(fbDB, p)); } catch (e) { alert('Lỗi xóa: ' + e.message); } document.getElementById('savingBadge').style.display = 'none'; }

    window.openLoginModal = () => { document.getElementById('loginEmail').value = ''; document.getElementById('loginPassword').value = ''; document.getElementById('loginError').style.display = 'none'; document.getElementById('loginModal').classList.add('open'); setTimeout(() => document.getElementById('loginEmail').focus(), 100); };
    window.doLogin = async () => { const email = document.getElementById('loginEmail').value.trim(), pw = document.getElementById('loginPassword').value, err = document.getElementById('loginError'), btn = document.getElementById('loginBtn'); if (!email || !pw) { err.textContent = 'Vui lòng nhập đầy đủ!'; err.style.display = ''; return; } btn.textContent = 'Đang đăng nhập...'; btn.disabled = true; err.style.display = 'none'; try { await signInWithEmailAndPassword(fbAuth, email, pw); } catch (e) { const m = { 'auth/invalid-credential': 'Sai email hoặc mật khẩu!', 'auth/wrong-password': 'Sai email hoặc mật khẩu!', 'auth/user-not-found': 'Email không tồn tại!', 'auth/too-many-requests': 'Quá nhiều lần thử!', 'auth/invalid-email': 'Email không hợp lệ!' }; err.textContent = m[e.code] || 'Đăng nhập thất bại!'; err.style.display = ''; } btn.textContent = 'Đăng Nhập'; btn.disabled = false; };
    window.doLogout = async () => { await signOut(fbAuth); };

    const fmtNum = n => { if (!n || isNaN(n)) return '0'; if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return Number(n).toLocaleString(); };
    const fmtFull = n => { if (!n || isNaN(n)) return '0'; return Number(n).toLocaleString('de-DE'); };
    const fmtAuto = (n, fmt) => fmt === 'short' ? fmtNum(n) : fmtFull(n);
    const fmtDate = k => { if (!k) return ''; const [y, m, d] = k.split('-'); return `${d}/${m}/${y}`; };
    const arrow = (v, fmt) => (v >= 0 ? '▲ ' : '▼ ') + fmtAuto(Math.abs(v), fmt);
    const dcls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    function hl(t, q) { if (!q) return String(t); const e = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return String(t).replace(new RegExp(e, 'gi'), m => `<span class="hl">${m}</span>`); }

    function renderAll() { renderTabBar(); renderAdminArea(); renderTab(activeTab); }
    function renderTabBar() { const tabs = isAdmin ? [['view', '📊 Xem Dữ Liệu'], ['compare', '🔄 So Sánh'], ['import', '📥 Nhập Dữ Liệu'], ['manage', '⚙️ Quản Lý']] : [['view', '📊 Xem Dữ Liệu'], ['compare', '🔄 So Sánh']]; document.getElementById('tabBar').innerHTML = tabs.map(([k, l]) => `<button class="tab-btn ${activeTab === k ? 'active' : ''}" data-tab="${k}" onclick="showTab('${k}')">${l}</button>`).join(''); }
    function renderAdminArea() { document.getElementById('adminArea').innerHTML = isAdmin ? `<span style="font-size:.78rem;color:var(--green);margin-right:4px">🔓 Admin</span><button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;color:var(--red);border-color:rgba(255,68,85,.3)" onclick="doLogout()">Đăng Xuất</button>` : `<button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem" onclick="openLoginModal()">🔒 Admin</button>`; }
    function renderTab(name) { if (name === 'view') renderView(); if (name === 'compare') renderCompare(); if (name === 'import' && isAdmin) renderImport(); if (name === 'manage' && isAdmin) renderManage(); }
    window.showTab = name => { activeTab = name; document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none'); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); const el = document.getElementById('tab-' + name); if (el) el.style.display = ''; document.querySelectorAll('.tab-btn').forEach(el => { if (el.dataset.tab === name) el.classList.add('active'); }); renderTab(name); };

    function parseRaw(raw) {
      const sm = raw.match(/Thông tin server[:\s]+(\d+)/i); if (!sm) throw new Error('Không tìm thấy số server');
      const dm = raw.match(/Dữ liệu được lấy lúc[:\s]+(\d+)\/(\d+)\/(\d+)/i); if (!dm) throw new Error('Không tìm thấy ngày');
      const dateKey = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      const rows = []; const re = /\{([^}]+)\}/g; let m;
      while ((m = re.exec(raw)) !== null) { const p = m[1].split(',').map(s => s.trim().replace(/^"|"$/g, '')); if (p.length < 20) continue; const n = i => { const x = parseFloat(p[i].replace(/[^0-9.-]/g, '')); return isNaN(x) ? 0 : x; }; const s = i => p[i].replace(/"/g, '').trim(); rows.push({ id: s(0), name: s(1), alliance: s(2), merit: n(3), power: n(4), powerMax: n(5), meritRate: n(6), dead: n(7), heal: n(8), kill: n(9), goldSpend: n(10), woodSpend: n(11), stoneSpend: n(12), manaSpend: n(13), gemSpend: n(14), goldGather: n(15), woodGather: n(16), stoneGather: n(17), manaGather: n(18), gemGather: n(19) }); }
      if (!rows.length) throw new Error('Không tìm thấy dữ liệu người chơi');
      return { server: sm[1], dateKey, rows };
    }

    // ════════════════════════════════════
    // TAB: XEM DỮ LIỆU
    // ════════════════════════════════════
    function filterRows(rows) { const q = searchQuery.trim().toLowerCase(); if (!q) return rows; return rows.filter(r => r.name.toLowerCase().includes(q) || r.alliance.toLowerCase().includes(q) || r.id.toString().includes(q)); }
    function buildRows(filtered, q) {
      const fmt = numFmt === 'short' ? fmtNum : fmtFull;
      if (!filtered.length) return `<tr class="no-results"><td colspan="11">😔 Không tìm thấy "<b>${q}</b>"</td></tr>`;
      return filtered.map((r, i) => { const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1; const rc = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : ''; return `<tr><td class="rank ${rc}">${medal}</td><td>${r.id}</td><td class="left name" onclick="showPlayerDetail('${r.id}',false)">${hl(r.name, q)}</td><td class="left ally">[${hl(r.alliance, q)}]</td><td>${fmt(r.merit)}</td><td class="rate">${r.meritRate}%</td><td>${fmt(r.power)}</td><td>${fmt(r.kill)}</td><td>${fmt(r.dead)}</td><td>${fmt(r.heal)}</td><td>${fmt(r.manaSpend)}</td></tr>`; }).join('');
    }

    function renderView() {
      const servers = Object.keys(DATA).sort((a, b) => +a - +b);
      if (!curServer && servers.length) curServer = servers[0];
      if (curServer && DATA[curServer]) { const ds = Object.keys(DATA[curServer]).sort(); if (!curDate || !DATA[curServer][curDate]) curDate = ds[ds.length - 1]; }
      const rows = (curServer && curDate && DATA[curServer]?.[curDate]) || [];
      const dates = curServer && DATA[curServer] ? Object.keys(DATA[curServer]).sort().reverse() : [];
      let html = `<div class="panel"><div class="panel-title">🗺 Chọn Server</div>`;
      if (!servers.length) html += `<div class="empty">⚔️<br><br>Chưa có dữ liệu — Admin cần nhập trước</div>`;
      else html += `<div class="server-grid">${servers.map(s => `<div class="server-card ${s === curServer ? 'active' : ''}" onclick="selectServer('${s}')"><div class="server-num">S${s}</div><div class="server-sub">Server ${s}</div><div class="server-days">📅 ${Object.keys(DATA[s]).length} ngày</div></div>`).join('')}</div>`;
      html += `</div>`;
      if (curServer && dates.length) {
        html += `<div class="panel"><div class="panel-title">📅 Chọn Ngày</div><div class="date-list">${dates.map(d => `<div class="chip ${d === curDate ? 'active' : ''}" onclick="selectDate('${d}')">📅 ${fmtDate(d)}${isAdmin ? `<button class="chip-del" onclick="event.stopPropagation();deleteDate('${curServer}','${d}')">✕</button>` : ''}</div>`).join('')}</div></div>`;
        if (rows.length) {
          const tM = rows.reduce((s, r) => s + r.merit, 0), tK = rows.reduce((s, r) => s + r.kill, 0), tH = rows.reduce((s, r) => s + r.heal, 0), tN = rows.reduce((s, r) => s + r.manaSpend, 0), tP = rows.reduce((s, r) => s + r.power, 0);
          const al = [...new Set(rows.map(r => r.alliance))];
          html += `<div class="stats-row"><div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">Người Chơi</div><div class="stat-val">${rows.length}</div><div class="stat-sub">${al.length} liên minh</div></div><div class="stat-card" style="--accent:var(--gold)"><div class="stat-label">Tổng Lực Chiến</div><div class="stat-val">${fmtNum(tP)}</div></div><div class="stat-card" style="--accent:var(--purple)"><div class="stat-label">Tổng Công Trạng</div><div class="stat-val">${fmtNum(tM)}</div></div><div class="stat-card" style="--accent:var(--red)"><div class="stat-label">Tổng Tiêu Diệt</div><div class="stat-val">${fmtNum(tK)}</div></div><div class="stat-card" style="--accent:var(--green)"><div class="stat-label">Tổng Chữa Lính</div><div class="stat-val">${fmtNum(tH)}</div></div><div class="stat-card" style="--accent:var(--blue)"><div class="stat-label">Tổng Tiêu Mana</div><div class="stat-val">${fmtNum(tN)}</div></div></div>`;
        }
        const cols = [{ k: 'merit', l: 'Công Trạng' }, { k: 'meritRate', l: 'Tỉ Lệ CT' }, { k: 'power', l: 'Lực Chiến' }, { k: 'kill', l: 'Tiêu Diệt' }, { k: 'dead', l: 'Tử Trận' }, { k: 'heal', l: 'Chữa Lính' }, { k: 'manaSpend', l: 'Tiêu Mana' }];
        const sorted = [...rows].sort((a, b) => sortDir === 'desc' ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]);
        const q = searchQuery.trim(); const filtered = filterRows(sorted); const isOn = !!q;
        const badge = isOn ? (filtered.length === 0 ? '❌ Không tìm thấy' : `<b>${filtered.length}</b> / ${sorted.length} người`) : `<b>${sorted.length}</b> người chơi`;
        html += `<div class="panel" style="padding:0;overflow:hidden">
        <div style="padding:14px 18px 10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div style="display:flex;align-items:center;gap:10px"><div class="panel-title" style="margin:0">📊 Bảng Xếp Hạng</div><span class="count-badge ${isOn ? 'on' : ''}">${badge}</span></div>
          <div class="flex-row">
            <div class="search-wrap"><input class="search-input" type="text" id="searchInput" placeholder="🔍 Tìm tên / liên minh / ID..." value="${q.replace(/"/g, '&quot;')}" oninput="onSearch(this.value)" autocomplete="off"><button class="search-clear ${q ? 'show' : ''}" id="searchClearBtn" onclick="onSearch('');document.getElementById('searchInput').value='';document.getElementById('searchInput').focus()">✕</button></div>
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:100px" onclick="toggleFmt()">${numFmt === 'short' ? '🔢 Rút gọn' : '🔢 Đầy đủ'}</button>
            <select onchange="setSortColFn(this.value)" style="width:auto">${cols.map(c => `<option value="${c.k}" ${sortCol === c.k ? 'selected' : ''}>${c.l}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-wrap"><table style="min-width:700px">
          <thead><tr><th style="width:42px">#</th><th style="width:60px">ID</th><th class="left" style="min-width:150px">Tên</th><th class="left" style="width:80px">Liên Minh</th>${cols.map(c => `<th class="${sortCol === c.k ? 'sorted' : ''}" onclick="setSortColFn('${c.k}')" style="width:105px">${c.l} ${sortCol === c.k ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}</th>`).join('')}</tr></thead>
          <tbody id="rankTbody">${buildRows(filtered, q)}</tbody>
        </table></div>
      </div>`;
      }
      document.getElementById('tab-view').innerHTML = html;
      if (searchQuery) { const inp = document.getElementById('searchInput'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    }

    window.selectServer = s => { curServer = s; curDate = null; searchQuery = ''; renderView(); };
    window.selectDate = d => { curDate = d; renderView(); };
    window.setSortColFn = c => { if (c === sortCol) sortDir = sortDir === 'desc' ? 'asc' : 'desc'; else { sortCol = c; sortDir = 'desc'; } renderView(); };
    window.toggleFmt = () => { numFmt = numFmt === 'short' ? 'full' : 'short'; renderView(); };
    window.onSearch = q => {
      searchQuery = q;
      const cb = document.getElementById('searchClearBtn'); if (cb) cb.classList.toggle('show', !!q);
      const rows = (curServer && curDate && DATA[curServer]?.[curDate]) || []; if (!rows.length) return;
      const sorted = [...rows].sort((a, b) => sortDir === 'desc' ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]); const filtered = filterRows(sorted); const isOn = !!q.trim();
      const badge = document.querySelector('#tab-view .count-badge');
      if (badge) { badge.className = 'count-badge' + (isOn ? ' on' : ''); badge.innerHTML = isOn ? (filtered.length === 0 ? '❌ Không tìm thấy' : `<b>${filtered.length}</b> / ${sorted.length} người`) : `<b>${sorted.length}</b> người chơi`; }
      const tbody = document.getElementById('rankTbody'); if (tbody) tbody.innerHTML = buildRows(filtered, q);
    };

    window.showPlayerDetail = (id, fromCmp) => {
      let r = null;
      if (!fromCmp && curServer && curDate) { r = (DATA[curServer]?.[curDate] || []).find(x => x.id == id); }
      if (!r && cmpSrv) { r = (DATA[cmpSrv]?.[cmpD2] || []).find(x => x.id == id); if (!r) r = (DATA[cmpSrv]?.[cmpD1] || []).find(x => x.id == id); }
      if (!r) return;
      document.getElementById('pModalName').textContent = r.name;
      document.getElementById('pModalSub').textContent = `[${r.alliance}] · ID: ${r.id}`;
      const secs = [
        { t: '⚔️ Chiến Đấu', rows: [['ID', r.id], ['Liên Minh', r.alliance], ['Công Trạng', fmtFull(r.merit)], ['Tỉ Lệ CT', r.meritRate + '%'], ['Lực Chiến', fmtFull(r.power)], ['Lực Chiến Max', fmtFull(r.powerMax)], ['Tiêu Diệt', fmtFull(r.kill)], ['Tử Trận', fmtFull(r.dead)], ['Chữa Lính', fmtFull(r.heal)]] },
        { t: '💰 Tiêu Thụ', rows: [['Vàng', fmtFull(r.goldSpend)], ['Gỗ', fmtFull(r.woodSpend)], ['Đá', fmtFull(r.stoneSpend)], ['Mana', fmtFull(r.manaSpend)], ['Gem', fmtFull(r.gemSpend)]] },
        { t: '🌾 Thu Thập', rows: [['Vàng', fmtFull(r.goldGather)], ['Gỗ', fmtFull(r.woodGather)], ['Đá', fmtFull(r.stoneGather)], ['Mana', fmtFull(r.manaGather)], ['Gem', fmtFull(r.gemGather)]] }
      ];
      document.getElementById('pModalBody').innerHTML = secs.map(sec => `<div class="detail-sec"><div class="detail-sec-title">${sec.t}</div>${sec.rows.map(([k, v]) => `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`).join('')}</div>`).join('');
      document.getElementById('playerModal').classList.add('open');
    };

    // ════════════════════════════════════
    // TAB: SO SÁNH
    // ════════════════════════════════════
    const DIFF_SORT_OPTS = [
      { v: 'dm', l: 'Công Trạng' }, { v: 'dp', l: 'Lực Chiến' }, { v: 'dk', l: 'Tiêu Diệt' },
      { v: 'dd', l: 'Tử Trận' }, { v: 'dh', l: 'Chữa Lính' }, { v: 'dn', l: 'Tiêu Mana' },
      { v: 'dgs', l: 'Vàng Tiêu' }, { v: 'dws', l: 'Gỗ Tiêu' }, { v: 'dss', l: 'Đá Tiêu' },
      { v: 'dges', l: 'Gem Tiêu' }, { v: 'dgg', l: 'Vàng Thu' }, { v: 'dwg', l: 'Gỗ Thu' },
      { v: 'dsg', l: 'Đá Thu' }, { v: 'dmg', l: 'Mana Thu' }, { v: 'dgeg', l: 'Gem Thu' },
    ];
    const TOP10_METAS = [
      { v: 'dm', l: '▲ Công Trạng', field: 'merit' }, { v: 'dk', l: '▲ Tiêu Diệt', field: 'kill' },
      { v: 'dh', l: '▲ Chữa Lính', field: 'heal' }, { v: 'dd', l: '▲ Tử Trận', field: 'dead' },
      { v: 'dp', l: '▲ Lực Chiến', field: 'power' }, { v: 'dn', l: '▲ Tiêu Mana', field: 'manaSpend' },
      { v: 'dmg', l: '▲ Thu Mana', field: 'manaGather' },
    ];
    const DIFF_SECTIONS = [
      { t: '⚔️ Chiến Đấu', fields: [['Công Trạng', 'merit'], ['Tỉ Lệ CT', 'meritRate', true], ['Lực Chiến', 'power'], ['Lực Chiến Max', 'powerMax'], ['Tiêu Diệt', 'kill'], ['Tử Trận', 'dead'], ['Chữa Lính', 'heal']] },
      { t: '💰 Tiêu Thụ', fields: [['Vàng', 'goldSpend'], ['Gỗ', 'woodSpend'], ['Đá', 'stoneSpend'], ['Mana', 'manaSpend'], ['Gem', 'gemSpend']] },
      { t: '🌾 Thu Thập', fields: [['Vàng', 'goldGather'], ['Gỗ', 'woodGather'], ['Đá', 'stoneGather'], ['Mana', 'manaGather'], ['Gem', 'gemGather']] },
    ];

    function computeDiffs(r1, r2) {
      const m1 = Object.fromEntries(r1.map(r => [r.id, r])), m2 = Object.fromEntries(r2.map(r => [r.id, r]));
      const ids = [...new Set([...Object.keys(m1), ...Object.keys(m2)])];
      return ids.map(id => {
        const a = m1[id] || {}, b = m2[id] || {}, g = (o, k) => o[k] || 0;
        return {
          id, name: b.name || a.name || id, alliance: b.alliance || a.alliance || '', a, b,
          dm: g(b, 'merit') - g(a, 'merit'), dp: g(b, 'power') - g(a, 'power'), dk: g(b, 'kill') - g(a, 'kill'),
          dd: g(b, 'dead') - g(a, 'dead'), dh: g(b, 'heal') - g(a, 'heal'), dn: g(b, 'manaSpend') - g(a, 'manaSpend'),
          dgs: g(b, 'goldSpend') - g(a, 'goldSpend'), dws: g(b, 'woodSpend') - g(a, 'woodSpend'),
          dss: g(b, 'stoneSpend') - g(a, 'stoneSpend'), dges: g(b, 'gemSpend') - g(a, 'gemSpend'),
          dgg: g(b, 'goldGather') - g(a, 'goldGather'), dwg: g(b, 'woodGather') - g(a, 'woodGather'),
          dsg: g(b, 'stoneGather') - g(a, 'stoneGather'), dmg: g(b, 'manaGather') - g(a, 'manaGather'),
          dgeg: g(b, 'gemGather') - g(a, 'gemGather'),
        };
      });
    }
    function filterDiffs(diffs) { const q = cmpSearchQ.trim().toLowerCase(); if (!q) return diffs; return diffs.filter(d => d.name.toLowerCase().includes(q) || d.alliance.toLowerCase().includes(q) || d.id.toString().includes(q)); }

    function renderCompare() {
      const servers = Object.keys(DATA).sort((a, b) => +a - +b);
      if (!servers.length) { document.getElementById('tab-compare').innerHTML = `<div class="panel empty">Chưa có dữ liệu</div>`; return; }
      if (!cmpSrv || !DATA[cmpSrv]) cmpSrv = curServer || servers[0];
      const dates = DATA[cmpSrv] ? Object.keys(DATA[cmpSrv]).sort() : [];
      if (!cmpD1 || !DATA[cmpSrv]?.[cmpD1]) cmpD1 = dates.length >= 2 ? dates[dates.length - 2] : dates[0] || '';
      if (!cmpD2 || !DATA[cmpSrv]?.[cmpD2]) cmpD2 = dates.length >= 1 ? dates[dates.length - 1] : '';
      const mkOpts = srv => (DATA[srv] ? Object.keys(DATA[srv]).sort() : []).map(d => `<option value="${d}">${fmtDate(d)}</option>`).join('');
      document.getElementById('tab-compare').innerHTML = `
      <div class="panel">
        <div class="panel-title">🔄 So Sánh Giữa Hai Ngày</div>
        <div class="flex-row" style="margin-bottom:16px;gap:12px">
          <div><div class="section-label">Server</div><select id="cmpSrvSel" style="width:auto" onchange="onCmpSrvChange(this.value)">${servers.map(s => `<option value="${s}" ${s === cmpSrv ? 'selected' : ''}>Server ${s}</option>`).join('')}</select></div>
          <div><div class="section-label">Ngày Trước</div><select id="cmpD1Sel" style="width:auto" onchange="onCmpDateChange()">${mkOpts(cmpSrv)}</select></div>
          <div><div class="section-label">Ngày Sau</div><select id="cmpD2Sel" style="width:auto" onchange="onCmpDateChange()">${mkOpts(cmpSrv)}</select></div>
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
      if (cmpD1 === cmpD2) { el.innerHTML = `<div class="status info show">Vui lòng chọn 2 ngày khác nhau</div>`; return; }
      const r1 = DATA[cmpSrv]?.[cmpD1] || [], r2 = DATA[cmpSrv]?.[cmpD2] || [];
      _cmpDiffs = computeDiffs(r1, r2);

      const totMetrics = [{ k: 'merit', l: 'Công Trạng', acc: 'var(--purple)' }, { k: 'power', l: 'Lực Chiến', acc: 'var(--gold)' }, { k: 'kill', l: 'Tiêu Diệt', acc: 'var(--red)' }, { k: 'dead', l: 'Tử Trận', acc: 'var(--text-dim)' }, { k: 'heal', l: 'Chữa Lính', acc: 'var(--green)' }, { k: 'manaSpend', l: 'Tiêu Mana', acc: 'var(--blue)' }];
      const tot = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
      let html = `<div class="flex-row" style="margin-bottom:14px">
        <div style="padding:7px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:.83rem">📅 <span style="color:var(--text-dim)">Trước:</span> <b>${fmtDate(cmpD1)}</b> — ${r1.length} người</div>
        <div style="padding:7px 14px;background:var(--bg3);border:1px solid var(--border-gold);border-radius:8px;font-size:.83rem">📅 <span style="color:var(--text-dim)">Sau:</span> <b style="color:var(--gold)">${fmtDate(cmpD2)}</b> — ${r2.length} người</div>
      </div>
      <div class="section-label">Thay Đổi Tổng Cộng</div>
      <div class="cmp-grid">`;
      totMetrics.forEach(m => { const s1 = tot(r1, m.k), s2 = tot(r2, m.k), diff = s2 - s1, pct = s1 > 0 ? ((diff / s1) * 100).toFixed(1) : '—'; html += `<div class="cmp-card" style="border-top-color:${m.acc}"><div class="cmp-title">${m.l}</div><div class="cmp-row"><span class="cmp-key">Ngày trước</span><span class="cmp-val">${fmtAuto(s1, cmpNumFmt)}</span></div><div class="cmp-row"><span class="cmp-key">Ngày sau</span><span class="cmp-val">${fmtAuto(s2, cmpNumFmt)}</span></div><div class="cmp-row"><span class="cmp-key">Thay đổi</span><span class="cmp-val ${dcls(diff)}">${arrow(diff, cmpNumFmt)} (${pct}%)</span></div></div>`; });
      html += `</div>`;

      // ── Detail table with column picker ──
      const sorted = [..._cmpDiffs].sort((a, b) => cmpSortDir === 'desc' ? b[cmpSortKey] - a[cmpSortKey] : a[cmpSortKey] - b[cmpSortKey]);
      const filtered = filterDiffs(sorted); const isOn = !!cmpSearchQ.trim();
      const badge = isOn ? (filtered.length === 0 ? '❌ Không tìm thấy' : `<b>${filtered.length}</b> / ${sorted.length} người`) : `<b>${sorted.length}</b> người chơi`;
      const cmpPicker = makePicker('cmpColPick', CMP_FIXED, CMP_EXTRA, cmpExtraVis, 'onCmpColToggle');

      html += `
      <div style="margin-top:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-family:'Cinzel',serif;font-size:.85rem;color:var(--gold)">Chi Tiết Từng Người</span>
            <span class="count-badge ${isOn ? 'on' : ''}" id="cmpBadge">${badge}</span>
          </div>
          <div class="flex-row">
            <div class="search-wrap">
              <input class="search-input" id="cmpSearch" type="text" placeholder="🔍 Tìm người chơi..." value="${cmpSearchQ.replace(/"/g, '&quot;')}" oninput="onCmpSearch(this.value)" autocomplete="off">
              <button class="search-clear ${cmpSearchQ ? 'show' : ''}" id="cmpSearchClear" onclick="onCmpSearch('');document.getElementById('cmpSearch').value='';document.getElementById('cmpSearch').focus()">✕</button>
            </div>
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem;min-width:105px" onclick="toggleCmpFmt()">${cmpNumFmt === 'short' ? '🔢 Rút gọn' : '🔢 Đầy đủ'}</button>
            <select style="width:auto" id="cmpSortSel" onchange="setCmpSort(this.value)">${DIFF_SORT_OPTS.map(o => `<option value="${o.v}" ${cmpSortKey === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}</select>
            ${cmpPicker}
          </div>
        </div>
        <div class="panel" style="padding:0;overflow:hidden;margin-bottom:0">
          <div class="table-wrap" id="cmpTableWrap">${buildCmpTable(filtered)}</div>
        </div>
      </div>`;

      // ── Top 10 with column picker ──
      const top10Picker = makePicker('top10ColPick', [], TOP10_COLS, top10Vis, 'onTop10ColToggle');
      html += `
      <div style="margin-top:22px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div class="section-label" style="margin:0">🏆 Top 10 Theo Chênh Lệch</div>
          <div class="flex-row">
            <button class="btn btn-ghost" style="padding:5px 12px;font-size:.8rem" onclick="toggleTop10Dir()">${top10Dir === 'desc' ? '↓ Cao → Thấp' : '↑ Thấp → Cao'}</button>
            ${top10Picker}
          </div>
        </div>
        <div class="metric-tabs" id="top10Tabs">${TOP10_METAS.map(m => `<button class="metric-tab ${cmpTop10Key === m.v ? 'active' : ''}" onclick="setCmpTop10('${m.v}')">${m.l}</button>`).join('')}</div>
        <div id="top10Body">${buildTop10(_cmpDiffs, cmpTop10Key)}</div>
      </div>`;

      el.innerHTML = html;
      if (cmpSearchQ) { const inp = document.getElementById('cmpSearch'); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
    }

    function buildTop10(diffs, key) {
      const meta = TOP10_METAS.find(m => m.v === key) || TOP10_METAS[0];
      const top = [...diffs].sort((a, b) => top10Dir === 'desc' ? b[key] - a[key] : a[key] - b[key]).slice(0, 10);
      if (!top.length) return `<div class="empty" style="padding:20px">Không có dữ liệu</div>`;
      const showBefore = top10Vis.has('before'), showAfter = top10Vis.has('after'), showDiff = top10Vis.has('diff');
      return `<div class="panel" style="padding:0;overflow:hidden;margin-bottom:0"><div class="table-wrap"><table>
      <thead><tr>
        <th style="width:38px">#</th>
        <th class="left">Tên</th>
        <th class="left" style="width:80px">Liên Minh</th>
        <th class="nosort" style="width:60px">ID</th>
        ${showBefore ? `<th class="nosort">Trước (${fmtDate(cmpD1)})</th>` : ''}
        ${showAfter ? `<th class="nosort">Sau (${fmtDate(cmpD2)})</th>` : ''}
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
      if (btn) btn.textContent = top10Dir === 'desc' ? '↓ Cao → Thấp' : '↑ Thấp → Cao';
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
      const allRows = DIFF_SECTIONS.map(sec => {
        const hdr = `<tr><td colspan="4" style="padding:10px 10px 4px;font-size:.7rem;text-transform:uppercase;letter-spacing:2px;color:var(--text-dim);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">${sec.t}</td></tr>`;
        const drows = sec.fields.map(([label, field, isPct]) => {
          const va = d.a[field] || 0, vb = d.b[field] || 0, diff = vb - va;
          const fA = isPct ? va + '%' : fmtFull(va), fB = isPct ? vb + '%' : fmtFull(vb);
          const fD = isPct ? (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%' : (diff >= 0 ? '▲ ' : '▼ ') + fmtFull(Math.abs(diff));
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
          <th style="padding:8px 12px;text-align:right;font-size:.72rem;letter-spacing:1px;background:rgba(61,255,160,.07);border:1px solid rgba(61,255,160,.2);border-radius:4px;color:var(--green)">📊 Chênh Lệch</th>
        </tr></thead>
        <tbody>${allRows}</tbody>
      </table>
      <div style="font-size:.75rem;color:var(--text-dim);margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        💡 Tất cả số hiển thị dạng <b style="color:var(--gold)">đầy đủ</b> · Trước → Sau → Chênh lệch
      </div>`;
      document.getElementById('diffModal').classList.add('open');
    };

    // ════════════════════════════════════
    // TAB: IMPORT
    // ════════════════════════════════════
    function renderImport() { document.getElementById('tab-import').innerHTML = `<div class="panel"><div class="panel-title">📥 Nhập Dữ Liệu Mới</div><textarea id="importTxt" placeholder="Dán dữ liệu từ Tabi vào đây...&#10;&#10;Thông tin server: 174&#10;Dữ liệu được lấy lúc: 9/3/2026&#10;{ 8010298, &quot;Player&quot;, &quot;S2AK&quot;, ... }"></textarea><div style="font-size:.8rem;color:var(--text-dim);margin-top:7px;line-height:1.7"><b style="color:var(--gold)">Ngày trùng</b> → thay thế &nbsp;·&nbsp; <b style="color:var(--green)">Ngày mới</b> → thêm lịch sử</div><div class="flex-row" style="margin-top:12px"><button class="btn btn-primary" onclick="doImport()">⚔️ Nhập Dữ Liệu</button><button class="btn btn-ghost" onclick="document.getElementById('importTxt').value='';document.getElementById('importStatus').className='status'">🗑 Xóa</button></div><div id="importStatus" class="status"></div></div><div class="panel"><div class="panel-title">📋 Hướng Dẫn</div><div style="font-size:.85rem;color:var(--text-dim);line-height:2.1">1️⃣ Lấy dữ liệu từ Tabi mỗi ngày, dán vào ô trên<br>2️⃣ Nhấn <b style="color:var(--gold)">Nhập Dữ Liệu</b> — tự nhận server &amp; ngày<br>3️⃣ Lưu Firebase — mọi người thấy ngay lập tức<br>4️⃣ Người dùng thường chỉ thấy Xem &amp; So Sánh</div></div>`; }
    window.doImport = async () => { const raw = document.getElementById('importTxt').value.trim(); const st = document.getElementById('importStatus'); if (!raw) { st.className = 'status error show'; st.textContent = 'Vui lòng dán dữ liệu vào ô trên!'; return; } try { const { server, dateKey, rows } = parseRaw(raw); const isReplace = !!(DATA[server]?.[dateKey]); await saveData(`servers/${server}/${dateKey}`, rows); st.className = 'status success show'; st.textContent = `${isReplace ? '🔄 Đã thay thế' : '✅ Đã thêm mới'} Server ${server} ngày ${fmtDate(dateKey)} — ${rows.length} người chơi`; document.getElementById('importTxt').value = ''; setTimeout(() => { if (st) st.className = 'status'; }, 5000); } catch (e) { st.className = 'status error show'; st.textContent = '❌ ' + e.message; } };

    // ════════════════════════════════════
    // TAB: MANAGE
    // ════════════════════════════════════
    function renderManage() { const servers = Object.keys(DATA).sort((a, b) => +a - +b); let html = `<div class="panel"><div class="panel-title">⚙️ Quản Lý Dữ Liệu</div>`; if (!servers.length) { html += `<div class="empty">Chưa có dữ liệu</div>`; } else { html += servers.map(s => { const dates = Object.keys(DATA[s]).sort(); const total = Object.values(DATA[s]).reduce((sum, r) => sum + r.length, 0); return `<div class="manage-server"><div class="flex-row" style="justify-content:space-between;margin-bottom:10px"><div><span style="font-family:'Cinzel',serif;font-size:1.05rem;color:var(--gold)">Server ${s}</span><span style="color:var(--text-dim);font-size:.8rem;margin-left:10px">${dates.length} ngày · ${total} bản ghi</span></div><button class="btn btn-danger" style="padding:5px 12px;font-size:.82rem" onclick="deleteServer('${s}')">🗑 Xóa Server</button></div><div class="date-list">${dates.map(d => `<div class="chip">📅 ${fmtDate(d)} (${DATA[s][d].length})<button class="chip-del" onclick="deleteDate('${s}','${d}')">✕</button></div>`).join('')}</div></div>`; }).join(''); } html += `</div><div class="panel"><div class="panel-title">💾 Backup</div><div class="flex-row"><button class="btn btn-ghost" onclick="exportData()">⬇️ Xuất JSON</button></div><div style="font-size:.8rem;color:var(--text-dim);margin-top:8px">Backup dữ liệu ra file JSON dự phòng.</div><div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)"><button class="btn btn-danger" onclick="clearAll()">🗑 Xóa Toàn Bộ</button></div></div>`; document.getElementById('tab-manage').innerHTML = html; }
    window.deleteDate = async (s, d) => { if (!confirm(`Xóa Server ${s} ngày ${fmtDate(d)}?`)) return; await removeData(`servers/${s}/${d}`); if (curServer === s && curDate === d) curDate = null; };
    window.deleteServer = async s => { if (!confirm(`Xóa toàn bộ Server ${s}? Không thể hoàn tác!`)) return; await removeData(`servers/${s}`); if (curServer === s) { curServer = null; curDate = null; } };
    window.clearAll = async () => { if (!confirm('Xóa TOÀN BỘ? Không thể hoàn tác!')) return; await removeData('servers'); };
    window.exportData = () => { const b = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };