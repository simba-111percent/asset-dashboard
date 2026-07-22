// HW/좌석: 구글시트 실시간 연동
const SEED_ASSETS=[];const SEED_SEATS=[];


// ============ State ============
const LS_KEY = 'asset_dashboard_v1';
const LS_SHEET_KEY = 'asset_dashboard_sheet_config';
const LS_HISTORY_KEY = 'asset_dashboard_history';

let assets = [];
let history = {}; // assetId -> [events]
let statusFilter = '';
let editingId = null;
let curPage = 1;
const PAGE_SIZE = 30;
let charts = {};

// ============ Init / Load ============
function loadAssets() {
  // 내장 데이터 없음 - 구글시트에서만 데이터 가져옴
  // localStorage 캐시가 있으면 임시로 사용 (Pull 전까지)
  try {
    const raw = localStorage.getItem(LS_KEY);
    assets = raw ? JSON.parse(raw) : [];
  } catch(e) { assets = []; }
  try {
    const rawH = localStorage.getItem(LS_HISTORY_KEY);
    history = rawH ? JSON.parse(rawH) : {};
  } catch(e) { history = {}; }
}

function saveAssets() {
  localStorage.setItem(LS_KEY, JSON.stringify(assets));
}

function saveHistory() {
  localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(history));
}

function addHistoryEvent(assetId, type, detail) {
  if (!history[assetId]) history[assetId] = [];
  history[assetId].unshift({
    type, detail,
    at: new Date().toISOString()
  });
  saveHistory();
}

// ============ Navigation ============
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');
  if (view === 'dashboard') renderDashboard();
  if (view === 'list') renderList();
  if (view === 'replace') renderReplaceCandidates();
  if (view === 'stock') renderStock();
  if (view === 'people') renderPeople();
  if (view === 'sw-dashboard') renderSwDashboard();
  if (view === 'sw-list') renderSwList();
  if (view === 'sw-alert') renderSwAlert();
  if (view === 'sync') renderSyncView();
}

// ============ Helpers ============
function fmtMoney(n) {
  if (!n) return '0원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

function yearsSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function isReplaceCandidate(a) {
  if (a.status === '불용') return false;
  // 사용중인 자산만 교체 대상 (재고는 별도 재고 현황으로)
  if (a.status !== '사용중') return false;
  // 사용자 없으면 교체 대상 제외
  if (!a.user || a.user.trim() === '' || a.user === '-') return false;
  const yrs = yearsSince(a.acqDate);
  const overAge = yrs !== null && yrs > 5;
  const zeroResidual = a.residual === 0 && a.price > 0 && yrs !== null && yrs > 1;
  return overAge || zeroResidual;
}

function isUsableStock(a) {
  // 재고 중 사용 가능한 것 (교체 대상 아닌 것)
  if (a.status !== '재고') return false;
  const yrs = yearsSince(a.acqDate);
  const overAge = yrs !== null && yrs > 5;
  const zeroResidual = a.residual === 0 && a.price > 0 && yrs !== null && yrs > 1;
  return !overAge && !zeroResidual;
}

function isOldStock(a) {
  // 재고 중 노후화된 것 (교체 검토 필요)
  if (a.status !== '재고') return false;
  const yrs = yearsSince(a.acqDate);
  const overAge = yrs !== null && yrs > 5;
  const zeroResidual = a.residual === 0 && a.price > 0 && yrs !== null && yrs > 1;
  return overAge || zeroResidual;
}

function statusBadgeClass(status) {
  if (status === '사용중') return 'b-used';
  if (status === '재고') return 'b-stock';
  if (status === '미확인') return 'b-unknown';
  if (status === '불용') return 'b-disposed';
  return 'b-cat';
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============ Dashboard ============
function renderDashboard() {
  const active = assets.filter(a => a.status !== '불용');
  const used = active.filter(a => a.status === '사용중');
  const stock = active.filter(a => a.status === '재고');
  const unknown = active.filter(a => a.status === '미확인');
  const replaceCands = active.filter(isReplaceCandidate);
  const stockNoLoc = stock.filter(a => !a.loc || a.loc.trim() === '');

  document.getElementById('st-total').textContent = active.length.toLocaleString();
  document.getElementById('st-used').textContent = used.length.toLocaleString();
  document.getElementById('st-stock').textContent = stock.length.toLocaleString();
  document.getElementById('st-stock-loc').textContent = `위치 미확인 ${stockNoLoc.length}건 포함`;
  document.getElementById('st-unknown').textContent = unknown.length.toLocaleString();
  document.getElementById('st-replace').textContent = replaceCands.length.toLocaleString();

  const now = new Date();
  document.getElementById('dash-updated').textContent =
    now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) + ' ' +
    now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준 · 전체 ' + assets.length + '건';

  renderCharts(active);
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

const PALETTE = ['#2f5d50', '#9a5b14', '#2f5276', '#a13d2f', '#6b665c', '#7a9e8f', '#c08a4a', '#5a7fa3'];

function countBy(arr, fn) {
  const m = {};
  arr.forEach(a => {
    const k = fn(a) || '미상';
    m[k] = (m[k] || 0) + 1;
  });
  return m;
}

function renderCharts(active) {
  const used = active.filter(a => a.status === '사용중');

  // 유형별 분포 (도넛)
  destroyChart('category');
  const catCount = countBy(active, a => a.cat);
  charts.category = new Chart(document.getElementById('chart-category'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(catCount),
      datasets: [{ data: Object.values(catCount), backgroundColor: PALETTE, borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false }
  });

  // OS 분포 (도넛)
  destroyChart('os');
  const osCount = countBy(active.filter(a => a.os), a => a.os);
  charts.os = new Chart(document.getElementById('chart-os'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(osCount),
      datasets: [{ data: Object.values(osCount), backgroundColor: ['#2f5276', '#2f5d50'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false }
  });

  // RAM 스펙 분포 (사용중, 막대)
  destroyChart('ram');
  const ramRaw = {};
  used.forEach(a => {
    if (!a.ram) return;
    const r = String(a.ram).replace(/GB|gb/g,'').trim();
    if (r && !isNaN(r)) ramRaw[r + 'GB'] = (ramRaw[r + 'GB'] || 0) + 1;
  });
  const ramSorted = Object.entries(ramRaw).sort((a,b) => parseInt(a[0]) - parseInt(b[0]));
  charts.ram = new Chart(document.getElementById('chart-ram'), {
    type: 'bar',
    data: {
      labels: ramSorted.map(e => e[0]),
      datasets: [{ data: ramSorted.map(e => e[1]), backgroundColor: '#2f5d50', borderRadius: 4 }]
    },
    options: {
      plugins: { legend: { display: false } },
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { font: { size: 11 }, stepSize: 1 } }, x: { ticks: { font: { size: 11 } } } }
    }
  });

  // 연도별 취득 추이 (막대)
  destroyChart('yearly');
  const yearCount = {};
  active.forEach(a => {
    const y = a.acqYear || (a.acqDate ? a.acqDate.slice(0,4) : null);
    if (y && y !== '-') yearCount[y] = (yearCount[y] || 0) + 1;
  });
  const years = Object.keys(yearCount).sort();
  charts.yearly = new Chart(document.getElementById('chart-yearly'), {
    type: 'bar',
    data: {
      labels: years,
      datasets: [{ data: years.map(y => yearCount[y]), backgroundColor: '#2f5d50', borderRadius: 4 }]
    },
    options: {
      plugins: { legend: { display: false } },
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { font: { size: 11 } } }, x: { ticks: { font: { size: 11 } } } }
    }
  });

  // 자산명별 분포 (도넛)
  destroyChart('age');
  const nameCount = countBy(active, a => a.name || '기타');
  const nameSorted = Object.entries(nameCount).sort((a, b) => b[1] - a[1]);
  const nameLabels = nameSorted.map(e => e[0]);
  const nameValues = nameSorted.map(e => e[1]);
  const namePalette = ['#2f5d50','#2f5276','#9a5b14','#a13d2f','#5b3ea8','#2f6d4a','#6b665c','#1e3a34','#9d978b','#4a3d6b'];
  charts.age = new Chart(document.getElementById('chart-age'), {
    type: 'doughnut',
    data: {
      labels: nameLabels,
      datasets: [{ data: nameValues, backgroundColor: nameLabels.map((_, i) => namePalette[i % namePalette.length]), borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false }
  });
}

// ============ List View ============
function populateCorpFilter() {
  const sel = document.getElementById('filter-category').nextElementSibling;
}

function setStatusFilter(status) {
  statusFilter = status;
  curPage = 1;
  renderList();
}

function getFilteredAssets() {
  const q = (document.getElementById('search-input').value || '').trim().toLowerCase();
  const catF = document.getElementById('filter-category').value;
  const corpF = document.getElementById('filter-corp').value;

  return assets.filter(a => {
    if (q) {
      const hay = [a.no, a.noOld, a.name, a.user, a.prevUser].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (catF && a.cat !== catF) return false;
    if (corpF && a.corp !== corpF) return false;
    if (statusFilter && a.status !== statusFilter) return false;
    return true;
  });
}

function renderList() {
  // populate corp filter once
  const corpSel = document.getElementById('filter-corp');
  if (corpSel.options.length <= 1) {
    const corps = [...new Set(assets.map(a => a.corp))].sort();
    corps.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      corpSel.appendChild(opt);
    });
  }

  const filtered = getFilteredAssets();
  document.getElementById('list-count').textContent = `총 ${filtered.length}건 (전체 ${assets.length}건 중)`;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (curPage > totalPages) curPage = totalPages;
  const start = (curPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const tbody = document.getElementById('asset-tbody');
  if (!pageItems.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="ic">📭</div>조건에 맞는 자산이 없어요.</div></td></tr>`;
  } else {
    tbody.innerHTML = pageItems.map(a => {
      const spec = [a.cpu, a.ram ? a.ram+'GB' : '', a.ssd].filter(Boolean).join(' / ');
      const loc = a.loc && a.loc.trim() ? escapeHtml(a.loc) : '<span class="empty-loc">미확인</span>';
      return `
      <tr>
        <td>
          <div class="asset-no">${escapeHtml(a.no) || '<span class="empty-loc">미부여</span>'}</div>
          ${a.noOld ? `<div class="asset-no-old">구: ${escapeHtml(a.noOld)}</div>` : ''}
        </td>
        <td>${escapeHtml(a.name)}</td>
        <td><span class="badge b-cat">${escapeHtml(a.cat)}</span></td>
        <td><span class="badge ${statusBadgeClass(a.status)}">${escapeHtml(a.status)}</span></td>
        <td contenteditable="false" class="">${escapeHtml(a.user)}</td>
        <td style="color:var(--text-muted);font-size:12px;">${escapeHtml(a.prevUser) || '—'}</td>
        <td>${loc}</td>
        <td style="color:var(--text-muted); font-size:11.5px;">${escapeHtml(spec) || '—'}</td>
        <td style="white-space:nowrap;">${escapeHtml(a.acqDate) || '—'}</td>
        <td style="color:var(--text-muted); font-size:12px;">${escapeHtml(a.acctNo) || '—'}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('pager-info').textContent = `${filtered.length === 0 ? 0 : start+1}–${Math.min(start+PAGE_SIZE, filtered.length)} / ${filtered.length}건 (${curPage}/${totalPages}페이지)`;
}

function inlineEdit(id, field, value) {
  const a = assets.find(x => x.id === id);
  if (!a) return;
  const old = a[field];
  const newVal = value.trim();
  if (old === newVal) return;
  a[field] = newVal;
  saveAssets();
  addHistoryEvent(id, field === 'user' ? '사용자변경' : '위치변경', `${old || '(비어있음)'} → ${newVal || '(비어있음)'}`);
}

function prevPage() { if (curPage > 1) { curPage--; renderList(); } }
function nextPage() { curPage++; renderList(); }

function exportCSV() {
  const filtered = getFilteredAssets();
  const headers = ['자산번호','구자산번호','유형','자산명','상태','사용자','전사용자','위치','OS','CPU','RAM','SSD','법인','취득일','취득가','잔존가액','비고'];
  const rows = filtered.map(a => [a.no,a.noOld,a.cat,a.name,a.status,a.user,a.prevUser,a.loc,a.os,a.cpu,a.ram,a.ssd,a.corp,a.acqDate,a.price,a.residual,a.note]);
  let csv = '\uFEFF' + headers.join(',') + '\n';
  rows.forEach(r => {
    csv += r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `자산목록_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============ Replace candidates ============
function renderReplaceCandidates() {
  const cands = assets.filter(isReplaceCandidate).sort((a,b) => (a.acqDate||'').localeCompare(b.acqDate||''));
  const el = document.getElementById('replace-list');
  if (!cands.length) {
    el.innerHTML = `<div class="empty-state"><div class="ic">✅</div>현재 교체 대상으로 분류된 장비가 없어요.</div>`;
    return;
  }
  el.innerHTML = cands.map(a => {
    const yrs = yearsSince(a.acqDate);
    const reason = yrs !== null && yrs > 5 ? `취득 ${yrs.toFixed(1)}년 경과` : '잔존가액 0원';
    return `
    <div class="replace-card">
      <div class="replace-info">
        <div class="replace-name">${escapeHtml(a.name)} <span style="color:var(--text-muted); font-weight:400;">· ${escapeHtml(a.no || a.noOld)}</span></div>
        <div class="replace-meta">사용자: ${escapeHtml(a.user) || '—'} · 취득일: ${escapeHtml(a.acqDate) || '—'} · ${escapeHtml(a.cat)}</div>
      </div>
      <span class="replace-reason">${reason}</span>
    </div>`;
  }).join('');
}

// ============ Stock View ============
function renderStock() {
  const usable = assets.filter(isUsableStock).sort((a,b) => (a.cat||'').localeCompare(b.cat||''));
  const old = assets.filter(isOldStock).sort((a,b) => (a.acqDate||'').localeCompare(b.acqDate||''));

  // 통계 업데이트
  document.getElementById('stock-usable-count').textContent = usable.length + '건';
  document.getElementById('stock-old-count').textContent = old.length + '건';

  // 사용 가능 재고 목록
  const usableEl = document.getElementById('stock-usable-list');
  if (!usable.length) {
    usableEl.innerHTML = `<div class="empty-state"><div class="ic">📭</div>사용 가능한 재고가 없어요.</div>`;
  } else {
    usableEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
      <thead>
        <tr style="background:var(--surface-2);">
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">자산번호</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">자산명</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">유형</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">스펙</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">보관 위치</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">취득일</th>
          <th style="padding:8px 12px;text-align:left;border-bottom:0.5px solid var(--border);color:var(--text-muted);font-size:11.5px;">사용기간</th>
          <th style="padding:8px 12px;border-bottom:0.5px solid var(--border);"></th>
        </tr>
      </thead>
      <tbody>
        ${usable.map(a => {
          const yrs = yearsSince(a.acqDate);
          const spec = [a.cpu, a.ram ? a.ram+'GB' : '', a.ssd].filter(Boolean).join(' / ');
          const loc = a.loc && a.loc.trim() ? escapeHtml(a.loc) : '<span class="empty-loc">미확인</span>';
          return `<tr style="border-bottom:0.5px solid var(--border);">
            <td style="padding:8px 12px;">
              <div style="font-weight:600;font-size:12px;">${escapeHtml(a.no) || '<span class="empty-loc">미부여</span>'}</div>
              ${a.noOld ? `<div style="font-size:10.5px;color:var(--text-muted);">구: ${escapeHtml(a.noOld)}</div>` : ''}
            </td>
            <td style="padding:8px 12px;">${escapeHtml(a.name)}</td>
            <td style="padding:8px 12px;"><span class="badge b-cat">${escapeHtml(a.cat)}</span></td>
            <td style="padding:8px 12px;font-size:11.5px;color:var(--text-muted);">${spec || '—'}</td>
            <td style="padding:8px 12px;">${loc}</td>
            <td style="padding:8px 12px;white-space:nowrap;">${escapeHtml(a.acqDate) || '—'}</td>
            <td style="padding:8px 12px;white-space:nowrap;">${yrs !== null ? yrs.toFixed(1) + '년' : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  }

  // 노후 재고 목록
  const oldEl = document.getElementById('stock-old-list');
  if (!old.length) {
    oldEl.innerHTML = `<div class="empty-state"><div class="ic">✅</div>노후화된 재고가 없어요.</div>`;
  } else {
    oldEl.innerHTML = old.map(a => {
      const yrs = yearsSince(a.acqDate);
      const reason = yrs !== null && yrs > 5 ? `취득 ${yrs.toFixed(1)}년 경과` : '잔존가액 0원';
      const spec = [a.cpu, a.ram ? a.ram+'GB' : '', a.ssd].filter(Boolean).join(' / ');
      return `
      <div class="replace-card">
        <div class="replace-info">
          <div class="replace-name">${escapeHtml(a.name)} <span style="color:var(--text-muted);font-weight:400;">· ${escapeHtml(a.no || a.noOld)}</span></div>
          <div class="replace-meta">
            위치: ${escapeHtml(a.loc) || '미확인'} · 취득일: ${escapeHtml(a.acqDate) || '—'} · ${escapeHtml(a.cat)}
            ${spec ? ' · ' + spec : ''}
          </div>
        </div>
        <span class="replace-reason">${reason}</span>
      </div>`;
    }).join('');
  }
}

// ============ Modal: Add/Edit ============
function openAddModal() {
  editingId = null;
  document.getElementById('modal-title').textContent = '자산 등록';
  ['no','noOld','name','user','prevUser','loc','cpu','ram','ssd','acqDate','note'].forEach(f => document.getElementById('f-'+f).value = '');
  document.getElementById('f-cat').value = 'DESKTOP';
  document.getElementById('f-status').value = '사용중';
  document.getElementById('f-os').value = '';
  document.getElementById('f-corp').value = '111percent';
  document.getElementById('f-price').value = '';
  document.getElementById('f-residual').value = '';
  document.getElementById('modal-edit').classList.add('open');
}

function openEditModal(id) {
  const a = assets.find(x => x.id === id);
  if (!a) return;
  editingId = id;
  document.getElementById('modal-title').textContent = '자산 수정';
  document.getElementById('f-no').value = a.no || '';
  document.getElementById('f-noOld').value = a.noOld || '';
  document.getElementById('f-cat').value = a.cat || 'DESKTOP';
  document.getElementById('f-name').value = a.name || '';
  document.getElementById('f-status').value = a.status || '사용중';
  document.getElementById('f-user').value = a.user || '';
  document.getElementById('f-prevUser').value = a.prevUser || '';
  document.getElementById('f-loc').value = a.loc || '';
  document.getElementById('f-os').value = a.os || '';
  document.getElementById('f-corp').value = a.corp || '';
  document.getElementById('f-cpu').value = a.cpu || '';
  document.getElementById('f-ram').value = a.ram || '';
  document.getElementById('f-ssd').value = a.ssd || '';
  document.getElementById('f-acqDate').value = a.acqDate || '';
  document.getElementById('f-price').value = a.price || '';
  document.getElementById('f-residual').value = a.residual || '';
  document.getElementById('f-note').value = a.note || '';
  document.getElementById('modal-edit').classList.add('open');
}

function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function saveAsset() {
  const no = document.getElementById('f-no').value.trim();
  const name = document.getElementById('f-name').value.trim();
  if (!name) { document.getElementById('f-name').focus(); return; }

  const data = {
    no, noOld: document.getElementById('f-noOld').value.trim(),
    cat: document.getElementById('f-cat').value,
    name,
    status: document.getElementById('f-status').value,
    user: document.getElementById('f-user').value.trim(),
    prevUser: document.getElementById('f-prevUser').value.trim(),
    loc: document.getElementById('f-loc').value.trim(),
    os: document.getElementById('f-os').value,
    corp: document.getElementById('f-corp').value.trim(),
    cpu: document.getElementById('f-cpu').value.trim(),
    ram: document.getElementById('f-ram').value.trim(),
    ssd: document.getElementById('f-ssd').value.trim(),
    acqDate: document.getElementById('f-acqDate').value,
    acqYear: document.getElementById('f-acqDate').value ? document.getElementById('f-acqDate').value.slice(0,4) : '',
    price: parseFloat(document.getElementById('f-price').value) || 0,
    residual: parseFloat(document.getElementById('f-residual').value) || 0,
    note: document.getElementById('f-note').value.trim(),
  };

  if (editingId) {
    const a = assets.find(x => x.id === editingId);
    const changes = [];
    Object.keys(data).forEach(k => {
      if (String(a[k] || '') !== String(data[k] || '')) changes.push(k);
    });
    Object.assign(a, data);
    if (changes.length) addHistoryEvent(editingId, '정보수정', changes.join(', ') + ' 변경');
  } else {
    const newId = 'a' + Date.now();
    assets.unshift({ id: newId, ...data });
    addHistoryEvent(newId, '신규등록', `${name} 등록`);
  }
  saveAssets();
  closeModal('modal-edit');
  renderList();
  renderDashboard();
}

// ============ History modal ============
function openHistory(id) {
  const a = assets.find(x => x.id === id);
  if (!a) return;
  document.getElementById('hist-asset-no').textContent = a.no || a.name;
  const events = history[id] || [];
  const el = document.getElementById('hist-list');
  if (!events.length) {
    el.innerHTML = `<div class="empty-state"><div class="ic">🕓</div>아직 기록된 변경 이력이 없어요.</div>`;
  } else {
    el.innerHTML = events.map(e => `
      <div class="hist-item">
        <div class="hist-dot"></div>
        <div class="hist-body">
          <div class="hist-top">
            <span class="hist-type">${escapeHtml(e.type)}</span>
            <span class="hist-date">${new Date(e.at).toLocaleString('ko-KR')}</span>
          </div>
          <div class="hist-detail">${escapeHtml(e.detail)}</div>
        </div>
      </div>
    `).join('');
  }
  document.getElementById('modal-history').classList.add('open');
}

// ============ People (Seat x Asset matching) ============
function renderPeople() {
  const seatData = window._dynamicSeats || [];

  const floorSel = document.getElementById('people-floor-filter');
  if (floorSel.options.length <= 1) {
    const floors = [...new Set(seatData.map(s => s.floor))].sort();
    floors.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f; opt.textContent = f;
      floorSel.appendChild(opt);
    });
  }

  const q = (document.getElementById('people-search').value || '').trim().toLowerCase();
  const floorF = floorSel.value;

  const assetsByUser = {};
  assets.forEach(a => {
    if (!a.user) return;
    if (!assetsByUser[a.user]) assetsByUser[a.user] = [];
    assetsByUser[a.user].push(a);
  });

  if (!seatData.length) {
    document.getElementById('people-tbody').innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="ic">📭</div>좌석배치도 데이터를 가져오는 중이에요.<br>구글시트 연동 메뉴에서 좌석배치도 URL을 설정해주세요.</div></td></tr>`;
    document.getElementById('people-match-rate').textContent = '';
    return;
  }

  let seats = seatData.slice();
  if (floorF) seats = seats.filter(s => s.floor === floorF);
  if (q) seats = seats.filter(s => s.name.toLowerCase().includes(q) || s.seat.toLowerCase().includes(q));
  seats.sort((a,b) => a.floor.localeCompare(b.floor) || a.seat.localeCompare(b.seat, undefined, {numeric:true}));

  const matchedCount = seatData.filter(s => assetsByUser[s.name]).length;
  document.getElementById('people-match-rate').textContent = `좌석 ${seatData.length}명 중 자산 매칭 ${matchedCount}명`;

  const tbody = document.getElementById('people-tbody');
  if (!seats.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><div class="ic">📭</div>조건에 맞는 사람이 없어요.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = seats.map(s => {
    const userAssets = assetsByUser[s.name] || [];
    const assetChips = userAssets.length
      ? userAssets.map(a => `<span class="badge b-cat" title="${escapeHtml(a.name)}">${escapeHtml(a.cat)} · ${escapeHtml(a.no || a.noOld || '번호없음')}</span>`).join(' ')
      : `<span class="empty-loc">등록된 자산 없음</span>`;
    return `
    <tr>
      <td style="font-weight:600;">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.floor)} · ${escapeHtml(s.seat)}</td>
      <td>${userAssets.length}건</td>
      <td><div style="display:flex; gap:5px; flex-wrap:wrap;">${assetChips}</div></td>
    </tr>`;
  }).join('');
}


// ============ SW Asset Management ============
const LS_SW_RESP_KEY = 'sw_responses_v1';
let swList = [];
let swStatusFilter = '';
let swPage = 1;
const SW_PAGE_SIZE = 30;

function loadSw() {
  // 최초 로드 시 임시 표시용 (구글시트 실시간 pull 전까지).
  // `SEED_SW`에는 legacy한 `price` 필드가 쓰여있을 수 있으므로
  // 현재 코드에서 사용하는 `priceRaw`로 정규화하고 `currency` 기본값을 보장함.
  swList = typeof SEED_SW !== 'undefined' ? JSON.parse(JSON.stringify(SEED_SW)) : [];
  swList = swList.map(s => {
    const out = { ...s };
    if (out.priceRaw === undefined) out.priceRaw = (out.price !== undefined ? out.price : null);
    if (!out.currency) out.currency = 'KRW';
    return out;
  });
}

function formatPrice(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const num = parseFloat(amount);
  if (isNaN(num)) return '—';
  if (currency === 'USD') {
    // 달러: 소수점 있으면 유지, 없으면 정수
    const formatted = num % 1 === 0
      ? num.toLocaleString('en-US')
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `$${formatted}`;
  } else {
    // 원화: 소수점 버리고 천단위 쉼표
    return Math.round(num).toLocaleString('ko-KR') + '원';
  }
}

function getMonthEnd() {
  // 이번 달 말일 (YYYY-MM-DD)
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

function getNextMonthSameDay(startDateStr) {
  // 시작일에서 한 달 후 날짜 계산
  // 시작일이 없으면 오늘 기준 한 달 후
  const base = startDateStr ? new Date(startDateStr) : new Date();
  if (isNaN(base)) return null;
  const next = new Date(base);
  next.setMonth(next.getMonth() + 1);
  // 현재보다 과거면 계속 한 달씩 더해서 미래 날짜로
  const now = new Date();
  while (next < now) {
    next.setMonth(next.getMonth() + 1);
  }
  return next.toISOString().slice(0, 10);
}

function getEffectiveExpire(s) {
  if (s.monthlyEnd) return getMonthEnd();          // 매월 말일
  if (s.monthlyCalc) return getNextMonthSameDay(s.startDate || '');  // 시작일+1개월
  return s.expireDate || '';
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return Math.ceil((d - Date.now()) / (1000 * 60 * 60 * 24));
}

function ddayBadge(dateStr) {
  const d = daysUntil(dateStr);
  if (d === null) return `<span class="dday dday-none">만료일 없음</span>`;
  if (d < 0) return `<span class="dday dday-danger">만료됨 (${Math.abs(d)}일 전)</span>`;
  if (d <= 10) return `<span class="dday dday-danger">D-${d}</span>`;
  if (d <= 30) return `<span class="dday dday-warn">D-${d}</span>`;
  return `<span class="dday dday-ok">D-${d}</span>`;
}

function alertTypeBadge(type) {
  if (type === 'none') return `<span class="badge" style="opacity:0.55;">해당없음</span>`;
  if (type === 'personal') return `<span class="badge alert-type-personal">개인 알림</span>`;
  if (type === 'personal_admin') return `<span class="badge alert-type-personal">개인+총무 알림</span>`;
  if (type === 'dual') return `<span class="badge" style="background:var(--info-bg);color:var(--info);border:0.5px solid var(--info-border);">사용자2명+총무 알림</span>`;
  if (type === 'admin_critical') return `<span class="badge alert-type-admin_critical">🚨 퇴사 시 해지 필수</span>`;
  return `<span class="badge alert-type-admin">총무 알림</span>`;
}

function alertTarget(item) {
  if (item.alertType === 'personal') return `${escapeHtml(item.user)} + 심바/시온`;
  if (item.alertType === 'personal_admin') return `${escapeHtml(item.user)} + 심바/시온`;
  if (item.alertType === 'dual') return `${escapeHtml(item.user)} + 심바/시온`;
  if (item.alertType === 'admin_critical') return `심바/시온 (긴급)`;
  return `심바/시온`;
}

function getSwResponses() {
  try { return JSON.parse(localStorage.getItem(LS_SW_RESP_KEY) || '{}'); } catch(e) { return {}; }
}

function setSwResponse(id, resp) {
  const r = getSwResponses();
  r[id] = { resp, at: new Date().toISOString() };
  localStorage.setItem(LS_SW_RESP_KEY, JSON.stringify(r));
  renderSwAlert();
}

function renderSwDashboard() {
  const active = swList.filter(s => !s.expired);
  const soon = swList.filter(s => { const d = daysUntil(getEffectiveExpire(s)); return d !== null && d >= 0 && d <= 10; });
  const expired = swList.filter(s => { const d = daysUntil(getEffectiveExpire(s)); return d !== null && d < 0; });

  // 비용 합계
  const krwTotal = active.filter(s => s.currency === 'KRW' && s.priceRaw).reduce((sum, s) => sum + (s.priceRaw || 0), 0);
  const usdTotal = active.filter(s => s.currency === 'USD' && s.priceRaw).reduce((sum, s) => sum + (s.priceRaw || 0), 0);

  document.getElementById('sw-st-total').textContent = active.length;
  document.getElementById('sw-st-annual').textContent = active.filter(s => s.form === 'Annual').length;
  document.getElementById('sw-st-monthly').textContent = active.filter(s => s.form === 'Monthly' || s.monthlyEnd || s.monthlyCalc).length;
  document.getElementById('sw-st-soon').textContent = soon.length;
  document.getElementById('sw-st-krw').textContent = Math.round(krwTotal).toLocaleString('ko-KR') + '원';
  document.getElementById('sw-st-usd').textContent = '$' + usdTotal.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});

  const now = new Date();
  document.getElementById('sw-dash-updated').textContent =
    now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) + ' ' +
    now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준 · ' + active.length + '건';

  // 월별 만료 예정 (막대)
  if (charts['sw-expire']) { charts['sw-expire'].destroy(); }
  const expireMonths = {};
  active.forEach(s => {
    const d = s.expireDate || '';
    if (d && d.length >= 7) {
      const ym = d.slice(0,7);
      expireMonths[ym] = (expireMonths[ym] || 0) + 1;
    }
  });
  const sortedMonths = Object.keys(expireMonths).sort().filter(m => m >= now.toISOString().slice(0,7));
  const monthLabels = sortedMonths.map(m => {
    const [y, mo] = m.split('-');
    return `${y}.${mo}`;
  });
  const EXPIRE_WARN = '#a13d2f'; // 당월 경고색
  const thisMonth = now.toISOString().slice(0,7);
  charts['sw-expire'] = new Chart(document.getElementById('sw-chart-expire'), {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [{
        data: sortedMonths.map(m => expireMonths[m]),
        backgroundColor: sortedMonths.map(m => m === thisMonth ? EXPIRE_WARN : '#2f5d50'),
        borderRadius: 4
      }]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw}건` } } },
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, ticks: { font: { size: 11 }, stepSize: 5 } }, x: { ticks: { font: { size: 11 } } } }
    }
  });

  // 연간 비용 현황 (KRW/USD 가로 막대)
  if (charts['sw-cost']) { charts['sw-cost'].destroy(); }
  // 탭별 비용
  const tabCostKrw = {};
  const tabCostUsd = {};
  active.forEach(s => {
    if (!s.priceRaw) return;
    if (s.currency === 'KRW') tabCostKrw[s.tab] = (tabCostKrw[s.tab] || 0) + s.priceRaw;
    else tabCostUsd[s.tab] = (tabCostUsd[s.tab] || 0) + s.priceRaw;
  });
  const costTabs = [...new Set([...Object.keys(tabCostKrw), ...Object.keys(tabCostUsd)])];
  charts['sw-cost'] = new Chart(document.getElementById('sw-chart-cost'), {
    type: 'bar',
    data: {
      labels: costTabs,
      datasets: [
        { label: '원화(만원)', data: costTabs.map(t => Math.round((tabCostKrw[t]||0)/10000)), backgroundColor: '#2f5d50', borderRadius: 4 },
        { label: 'USD', data: costTabs.map(t => Math.round(tabCostUsd[t]||0)), backgroundColor: '#2f5276', borderRadius: 4 },
      ]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 10 } } },
      maintainAspectRatio: false,
      scales: { x: { beginAtZero: true, ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 11 } } } }
    }
  });

  // 알림 유형별 도넛
  if (charts['sw-alert']) { charts['sw-alert'].destroy(); }
  const alertCount = { '개인 알림': 0, '총무 알림': 0, '퇴사 해지 필수': 0 };
  active.forEach(s => {
    if (s.alertType === 'none') return; // 영구라이선스 등 알림 대상 아님
    if (s.alertType === 'personal' || s.alertType === 'personal_admin') alertCount['개인 알림']++;
    else if (s.alertType === 'admin_critical') alertCount['퇴사 해지 필수']++;
    else alertCount['총무 알림']++;
  });
  charts['sw-alert'] = new Chart(document.getElementById('sw-chart-alert'), {
    type: 'doughnut',
    data: { labels: Object.keys(alertCount), datasets: [{ data: Object.values(alertCount), backgroundColor: ['#2f6d4a','#9a5b14','#a13d2f'], borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 10, padding: 8 } } }, maintainAspectRatio: false }
  });

  // D-10 임박 목록
  const el = document.getElementById('sw-soon-list');
  if (!soon.length) {
    el.innerHTML = '<div class="empty-state"><div class="ic">✅</div>만료 임박 항목이 없어요.</div>';
  } else {
    el.innerHTML = soon.sort((a,b) => daysUntil(getEffectiveExpire(a)) - daysUntil(getEffectiveExpire(b))).map(s => {
      const effDate = getEffectiveExpire(s);
      return `
      <div class="soon-item">
        ${ddayBadge(effDate)}
        <span class="soon-name">${escapeHtml(s.name)}</span>
        <span class="soon-user">${escapeHtml(s.user)}</span>
        <span class="soon-date">${s.monthlyEnd ? '매월 말일' : s.monthlyCalc ? '월간 자동결제' : escapeHtml(effDate)}</span>
        ${alertTypeBadge(s.alertType)}
      </div>`}).join('');
  }
}

function getFilteredSw() {
  const q = (document.getElementById('sw-search').value || '').trim().toLowerCase();
  const formF = document.getElementById('sw-filter-form').value;
  const alertF = document.getElementById('sw-filter-alert').value;
  const tabF = document.getElementById('sw-filter-tab').value;
  return swList.filter(s => {
    if (q && !([s.name, s.user, s.category, ...(s.users||[])].join(' ').toLowerCase().includes(q))) return false;
    if (formF && s.form !== formF) return false;
    if (alertF && s.alertType !== alertF) return false;
    if (tabF && s.tab !== tabF) return false;
    if (swStatusFilter === 'active') { const d = daysUntil(getEffectiveExpire(s)); return d === null || d >= 0; }
    if (swStatusFilter === 'soon') { const d = daysUntil(getEffectiveExpire(s)); return d !== null && d >= 0 && d <= 10; }
    if (swStatusFilter === 'expired') { const d = daysUntil(getEffectiveExpire(s)); return d !== null && d < 0; }
    if (swStatusFilter === 'nodate') return !s.expireDate && !s.monthlyEnd;
    return true;
  });
}

function setSwStatusFilter(status) {
  swStatusFilter = status;
  document.querySelectorAll('.chip[data-sw-status]').forEach(c => c.classList.toggle('on', c.dataset.swStatus === status));
  swPage = 1;
  renderSwList();
}

function renderSwList() {
  const filtered = getFilteredSw();
  document.getElementById('sw-list-count').textContent = `총 ${filtered.length}건`;
  const totalPages = Math.max(1, Math.ceil(filtered.length / SW_PAGE_SIZE));
  if (swPage > totalPages) swPage = totalPages;
  const start = (swPage - 1) * SW_PAGE_SIZE;
  const items = filtered.slice(start, start + SW_PAGE_SIZE);

  const tbody = document.getElementById('sw-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="ic">📭</div>항목이 없어요.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(s => {
    const effDate = getEffectiveExpire(s);
    const d = daysUntil(effDate);
    const rowStyle = d !== null && d < 0 ? 'opacity:0.5;' : '';
    const expireDisplay = s.monthlyEnd
      ? `매월 말일 <span style="font-size:10.5px;color:var(--text-muted);">(${effDate})</span>`
      : s.monthlyCalc
        ? `월간 자동결제 <span style="font-size:10.5px;color:var(--text-muted);">(다음 결제 ${effDate})</span>`
        : s.form === 'Perpetual'
          ? `<span class="empty-loc">영구</span>`
          : (escapeHtml(s.expireDate) || '<span class="empty-loc">자동결제</span>');
    const usersDisplay = (s.users && s.users.length > 0)
      ? s.users.map(u => `<span style="display:inline-block;background:var(--tag-bg,#e8f0e8);color:var(--tag-text,#2f5d50);border-radius:4px;padding:1px 6px;font-size:11px;margin:1px;">${escapeHtml(u)}</span>`).join(' ')
      : (escapeHtml(s.user) || '<span class="empty-loc">미지정</span>');
    return `<tr style="${rowStyle}">
      <td>
        ${s.tab === 'Unity'
          ? `<div style="font-weight:600;">${escapeHtml(s.name)}</div><div style="font-size:11px;color:var(--text-muted);">${escapeHtml(s.category)}</div>`
          : `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(s.category)}</div><div style="font-weight:600;">${escapeHtml(s.name)}</div>`
        }
      </td>
      <td style="font-size:11.5px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.account)}">${escapeHtml(s.account) || '<span class="empty-loc">—</span>'}</td>
      <td>${usersDisplay}</td>
      <td><span class="badge b-cat">${escapeHtml(s.form) || '—'}</span></td>
      <td style="white-space:nowrap;">${expireDisplay}</td>
      <td>${ddayBadge(effDate)}</td>
      <td style="font-size:12px; white-space:nowrap;">${formatPrice(s.priceRaw, s.currency)}</td>
      <td>${alertTypeBadge(s.alertType)}</td>
      <td style="font-size:11.5px;color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(s.note)}">${escapeHtml(s.note) || '—'}</td>
    </tr>`;
  }).join('');
  document.getElementById('sw-pager-info').textContent = `${start+1}–${Math.min(start+SW_PAGE_SIZE, filtered.length)} / ${filtered.length}건`;
}

function swPrevPage() { if (swPage > 1) { swPage--; renderSwList(); } }
function swNextPage() {
  const totalPages = Math.max(1, Math.ceil(getFilteredSw().length / SW_PAGE_SIZE));
  if (swPage < totalPages) { swPage++; renderSwList(); }
}

function exportSwCSV() {
  const filtered = getFilteredSw();
  const headers = ['제품명','카테고리','사용자','계정','결제형태','만료일','금액','알림유형','비고'];
  let csv = '\uFEFF' + headers.join(',') + '\n';
  filtered.forEach(s => {
    csv += [s.name,s.category,s.user,s.account,s.form,s.expireDate,s.price,s.alertType,s.note]
      .map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `SW라이선스_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function renderSwAlert() {
  const responses = getSwResponses();
  const alertItems = swList.filter(s => {
    const d = daysUntil(getEffectiveExpire(s));
    if (s.alertType === 'admin_critical') return true;
    if (d === null) return false;
    return d <= 30;
  }).sort((a, b) => (daysUntil(getEffectiveExpire(a)) ?? 999) - (daysUntil(getEffectiveExpire(b)) ?? 999));

  const tbody = document.getElementById('sw-alert-tbody');
  if (!alertItems.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="ic">✅</div>30일 이내 만료 예정 항목이 없어요.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = alertItems.map(s => {
    const effDate = getEffectiveExpire(s);
    const resp = responses[s.id];
    const expireDisplay = s.monthlyEnd
      ? `매월 말일 (${effDate})`
      : s.monthlyCalc
        ? `월간 자동결제 (다음 결제 ${effDate})`
        : (escapeHtml(s.expireDate) || '—');
    const respBadge = resp
      ? (resp.resp === 'renew'
        ? `<span class="resp-badge resp-renew">✅ 갱신 요청</span>`
        : `<span class="resp-badge resp-cancel">❌ 해지 요청</span>`)
      : `<div style="display:flex;gap:4px;">
          <button class="btn btn-sm" onclick="setSwResponse('${s.id}','renew')" style="font-size:11px;padding:3px 8px;">✅ 갱신</button>
          <button class="btn btn-sm" onclick="setSwResponse('${s.id}','cancel')" style="font-size:11px;padding:3px 8px;color:var(--danger);border-color:var(--danger-border);">❌ 해지</button>
        </div>`;
    return `<tr>
      <td style="font-weight:600;">${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.user) || '<span class="empty-loc">공용/다수</span>'}</td>
      <td style="white-space:nowrap;">${expireDisplay}</td>
      <td>${ddayBadge(effDate)}</td>
      <td>${alertTypeBadge(s.alertType)}</td>
      <td style="font-size:12px;color:var(--text-sub);">${alertTarget(s)}</td>
      <td>${respBadge}</td>
    </tr>`;
  }).join('');
}

// ============ SW Add / Edit / Delete ============
const LS_SW_KEY = 'sw_user_data_v1';
let swEditing = null;
let swMonthlyType = 'calc';

function loadSwUserData() {
  // localStorage에 사용자가 추가한 SW 데이터 병합
  try {
    const raw = localStorage.getItem(LS_SW_KEY);
    if (raw) {
      const userSw = JSON.parse(raw);
      // SEED에 없는 id만 추가
      const existingIds = new Set(swList.map(s => s.id));
      userSw.forEach(s => { if (!existingIds.has(s.id)) swList.push(s); });
    }
  } catch(e) {}
}

function saveSwUserData() {
  // 사용자가 추가/수정한 항목만 별도 저장 (SEED 아닌 것들)
  const seedIds = new Set(SEED_SW.map(s => s.id));
  const userItems = swList.filter(s => !seedIds.has(s.id));
  localStorage.setItem(LS_SW_KEY, JSON.stringify(userItems));
}

function swFormChange() {
  const form = document.getElementById('sw-f-form').value;
  const monthlyWrap = document.getElementById('sw-f-monthly-type-wrap');
  const expireWrap = document.getElementById('sw-f-expire-wrap');
  if (form === 'Monthly') {
    monthlyWrap.style.display = 'block';
    expireWrap.style.display = 'none';
  } else {
    monthlyWrap.style.display = 'none';
    expireWrap.style.display = 'block';
  }
}

function pickMonthlyType(type) {
  swMonthlyType = type;
  document.querySelectorAll('[data-mt]').forEach(b => {
    b.className = 's-opt';
    if (b.dataset.mt === type) b.classList.add('on-doing');
  });
}

function openSwAddModal() {
  swEditing = null;
  swMonthlyType = 'calc';
  document.getElementById('sw-modal-title').textContent = 'SW 라이선스 등록';
  document.getElementById('sw-modal-delete-btn').style.display = 'none';
  // 초기화
  ['sw-f-category','sw-f-name','sw-f-account','sw-f-user','sw-f-price','sw-f-note'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('sw-f-tab').value = 'AI Tool';
  document.getElementById('sw-f-form').value = 'Annual';
  document.getElementById('sw-f-expire').value = '';
  document.getElementById('sw-f-start').value = '';
  document.getElementById('sw-f-currency').value = 'KRW';
  document.getElementById('sw-f-alert').value = 'personal';
  pickMonthlyType('calc');
  swFormChange();
  document.getElementById('modal-sw-edit').classList.add('open');
  setTimeout(() => document.getElementById('sw-f-name').focus(), 100);
}

function openSwEditModal(id) {
  const s = swList.find(x => x.id === id);
  if (!s) return;
  swEditing = id;
  document.getElementById('sw-modal-title').textContent = 'SW 라이선스 수정';
  document.getElementById('sw-modal-delete-btn').style.display = 'block';
  document.getElementById('sw-f-tab').value = s.tab || 'AI Tool';
  document.getElementById('sw-f-category').value = s.category || '';
  document.getElementById('sw-f-name').value = s.name || '';
  document.getElementById('sw-f-account').value = s.account || '';
  document.getElementById('sw-f-user').value = s.user || '';
  document.getElementById('sw-f-form').value = s.form || 'Annual';
  document.getElementById('sw-f-expire').value = s.expireDate || '';
  document.getElementById('sw-f-start').value = s.startDate || '';
  document.getElementById('sw-f-price').value = s.priceRaw || '';
  document.getElementById('sw-f-currency').value = s.currency || 'KRW';
  document.getElementById('sw-f-alert').value = s.alertType || 'personal';
  document.getElementById('sw-f-note').value = s.note || '';
  swMonthlyType = s.monthlyEnd ? 'end' : 'calc';
  pickMonthlyType(swMonthlyType);
  swFormChange();
  document.getElementById('modal-sw-edit').classList.add('open');
}

function saveSwItem() {
  const name = document.getElementById('sw-f-name').value.trim();
  if (!name) { document.getElementById('sw-f-name').focus(); return; }
  const form = document.getElementById('sw-f-form').value;
  const isMonthly = form === 'Monthly';
  const data = {
    tab: document.getElementById('sw-f-tab').value,
    category: document.getElementById('sw-f-category').value.trim() || name,
    name,
    account: document.getElementById('sw-f-account').value.trim(),
    user: document.getElementById('sw-f-user').value.trim(),
    users: [document.getElementById('sw-f-user').value.trim()].filter(Boolean),
    form,
    expireDate: isMonthly ? '' : (document.getElementById('sw-f-expire').value || ''),
    startDate: document.getElementById('sw-f-start').value || '',
    priceRaw: parseFloat(document.getElementById('sw-f-price').value) || null,
    currency: document.getElementById('sw-f-currency').value,
    alertType: document.getElementById('sw-f-alert').value,
    note: document.getElementById('sw-f-note').value.trim(),
    monthlyEnd: isMonthly && swMonthlyType === 'end',
    monthlyCalc: isMonthly && swMonthlyType === 'calc',
  };

  if (swEditing) {
    const idx = swList.findIndex(x => x.id === swEditing);
    if (idx !== -1) swList[idx] = { ...swList[idx], ...data };
  } else {
    swList.unshift({ id: 'sw_u_' + Date.now(), ...data });
  }
  saveSwUserData();
  closeModal('modal-sw-edit');
  renderSwList();
  renderSwDashboard();
}

function deleteSwItem() {
  if (!swEditing) return;
  if (!confirm('이 항목을 삭제할까요?')) return;
  swList = swList.filter(x => x.id !== swEditing);
  saveSwUserData();
  closeModal('modal-sw-edit');
  renderSwList();
  renderSwDashboard();
}

// ============ Google Sheets 고정 URL ============
const SHEET_URLS = {
  hw:    'https://script.google.com/macros/s/AKfycbyf0TFe9ZQEM11-koNYb0Ww4NqteSKzx5uYZlU9ILF_idfp1Oi_9XeB33Ngip9oAxpQVA/exec',
  sw:    'https://script.google.com/macros/s/AKfycby7QUsoJumQ-fP7w8qIPJzW0z6_JZUhndJv9w-h-hatFGCxHN65Cq6uO9zA6-YZeBlt/exec',
  seats: 'https://script.google.com/macros/s/AKfycbzLvP1YzUTUEtOIpsiqPVG_tm10SVOaDboGxOjOBfDUfOUNLAC1HD4YOefRFrV1M06WqA/exec'
};

// ============ Google Sheets Sync (3개 시트) ============
function loadSheetConfig() {
  return SHEET_URLS;
}

function saveSheetConfig() {
  // URL이 고정이라 저장 불필요 — 입력값만 로그로 남김
  logSync('연동 URL은 고정 설정입니다.');
  startAutoSync();
}

function updateSyncBar() {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-status-text');
  const btnPull = document.getElementById('btn-pull');
  if (dot) dot.className = 'sync-status-dot on';
  if (text) text.innerHTML = `구글시트 연동됨 (HW · 좌석) — <strong>5분마다 자동 갱신</strong>`;
  if (btnPull) btnPull.disabled = false;
}

function logSync(msg, isError) {
  const el = document.getElementById('sync-log');
  if (!el) return;
  const time = new Date().toLocaleTimeString('ko-KR');
  el.innerHTML = `<div style="color:${isError ? 'var(--danger)' : 'var(--text-sub)'}; margin-top:4px;">[${time}] ${escapeHtml(msg)}</div>` + el.innerHTML;
}

function parseHwSheetData(sheetData) {
  // 실제 시트의 탭 이름을 먼저 확인해서 유연하게 매칭
  const allTabs = Object.keys(sheetData);

  // 탭명 유연 매칭 (날짜 부분이나 한글/영문 표기가 바뀌어도 동작하도록 후보 키워드 여러 개 허용)
  function findTab(keywords) {
    const list = Array.isArray(keywords) ? keywords : [keywords];
    return allTabs.find(t => list.some(k => t.toUpperCase().includes(k.toUpperCase()))) || null;
  }

  const tabMap = {
    [findTab(['데스크탑', 'DESKTOP'])]: { headerRow: 7, hasMain: true },
    [findTab(['MAC'])]:                  { headerRow: 7, hasMain: true },
    [findTab(['NT', 'LAPTOP', '노트북'])]: { headerRow: 8, hasMain: true },
    [findTab(['타블렛', 'TABLET', 'OTHER'])]: { headerRow: 8, hasMain: false },
  };
  // null 키 제거
  delete tabMap['null'];
  delete tabMap[null];

  console.log('[HW Pull] 감지된 탭:', allTabs);
  console.log('[HW Pull] 매칭된 탭:', Object.keys(tabMap));

  function normalizeCorp(v) {
    if (!v) return '111percent';
    const s = String(v).trim();
    return (s === '1.11' || s === '') ? '111percent' : s;
  }

  function normalizeCategory(tabName, cat) {
    const t = tabName.toUpperCase();
    if (t.includes('데스크탑') || t.includes('DESKTOP')) return 'DESKTOP';
    if (t.includes('MAC')) return 'MAC';
    if (t.includes('NT') || t.includes('LAPTOP') || t.includes('노트북')) return 'NOTEBOOK';
    const c = String(cat || '').trim();
    if (c === '모바일기기') return 'MOBILE';
    if (c === '타블렛') return 'TABLET';
    if (c === '음향장비') return 'AUDIO';
    return 'ETC';
  }

  function cv(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
    return String(v).trim();
  }

  function cd(v) {
    if (!v) return '';
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
    if (typeof v === 'number') {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toISOString().slice(0,10);
    }
    return String(v).trim();
  }

  const result = [];
  let aid = 1;

  Object.entries(tabMap).forEach(([tabName, cfg]) => {
    if (!tabName || !cfg) return;
    const rowsRaw = sheetData[tabName];
    const rows = Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw && Array.isArray(rowsRaw.values)) ? rowsRaw.values : null;
    if (!rows) return;

    for (let i = cfg.headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.some(c => c !== null && c !== undefined && c !== '')) continue;

      const m = cfg.hasMain ? 1 : 0;
      const location = cv(r[0]);
      const corp     = normalizeCorp(r[1]);
      const category = cv(r[2]);
      const status   = cv(r[3]);
      const noOld    = cv(r[4]);
      const no       = cv(r[5]);
      const user     = cv(r[6 + m]);
      const prevUser = cv(r[7 + m]);
      const name     = cv(r[8 + m]);
      const cpu      = cv(r[9 + m]);
      const ram      = cv(r[10 + m]);
      const ssd      = cv(r[11 + m]);
      const hdd      = cv(r[12 + m]);
      const gpu      = cv(r[13 + m]);
      const acctNo   = cv(r[14 + m]);
      const acqYear  = cv(r[15 + m]);
      const acqDate  = cd(r[16 + m]);
      const price    = parseFloat(cv(r[17 + m])) || 0;
      const residual = parseFloat(cv(r[19 + m])) || 0;
      const note     = cv(r[20 + m]);

      if (!name && !category) continue;
      if (!status) continue;

      const t = tabName.toUpperCase();
      result.push({
        id: `a${aid++}`,
        no: (no === '-' || no === '') ? '' : no,
        noOld: (noOld === '-' || noOld === '') ? '' : noOld,
        cat: normalizeCategory(tabName, category),
        name,
        status: status === '-' ? '미확인' : status,
        user: (user === '-' || user === '') ? '' : user,
        prevUser: prevUser === '-' ? '' : prevUser,
        loc: location,
        os: t.includes('MAC') ? 'macOS' : ((t.includes('데스크탑') || t.includes('DESKTOP') || t.includes('NT') || t.includes('LAPTOP') || t.includes('노트북')) ? 'Windows' : ''),
        cpu, ram, ssd, hdd, gpu,
        acctNo: (acctNo === '-' || acctNo === '') ? '' : acctNo,
        corp,
        acqDate,
        acqYear,
        price,
        residual,
        note,
      });
    }
  });

  return result;
}

function parseSwSheetData(sheetData) {
  // 단순화된 마스터 탭 구성 (각 행 = 사용자별 라이선스)
  const MASTER_CONFIG = {
    tabName: 'rowdata',
    headerRow: 0,
    cols: {
      vendor: 0,      // A: 벤더
      name: 1,        // B: 제품명
      cat: 2,         // C: 구분
      user: 3,        // D: 사용자명
      start: 4,       // E: 시작일
      expire: 5,      // F: 만료일
      form: 6,        // G: 형태
      account: 7,     // H: 계정
      pw: 8,          // I: 비밀번호
      serial: 9,      // J: 시리얼
      qty: 10,        // K: 수량
      price: 11,      // L: 가격
      currency: 12,   // M: 통화
      note: 13,       // N: 비고
      link: 14,       // O: 링크
      payment: 15     // P: 결제정보
    }
  };

  function cv(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  function isEmpty(v) {
    return v === null || v === undefined || cv(v) === '';
  }

  function cd(v) {
    // 날짜 -> yyyy-mm-dd 문자열. Lifetime/'-' 등은 빈 문자열(만료일 없음)로 정규화
    if (isEmpty(v)) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^lifetime$/i.test(s) || s === '-') return '';
    if (typeof v === 'number') {
      // 구글시트 시리얼 넘버 -> 날짜 (거의 안 쓰이지만 대비)
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    return s; // 알 수 없는 형태는 원문 유지 (검색/표시용)
  }

  function parsePrice(raw, fmt) {
    if (isEmpty(raw)) return { price: 0, currency: 'KRW' };
    if (typeof raw === 'number') {
      let currency = 'KRW';
      // 형식 문자열에서 통화 기호 감지 (한국 원 ₩ 와 구별)
      if (fmt) {
        if (fmt.includes('₩')) currency = 'KRW';
        else if (fmt.includes('$') || fmt.includes('USD') || /usd/i.test(fmt)) currency = 'USD';
        else if (fmt.includes('€') || fmt.includes('EUR')) currency = 'EUR';
        else if (fmt.includes('£') || fmt.includes('GBP')) currency = 'GBP';
      }
      return { price: raw, currency };
    }
    const s = String(raw).trim();
    if (s.includes('$')) return { price: parseFloat(s.replace(/[^0-9.]/g, '')) || 0, currency: 'USD' };
    if (s.includes('€')) return { price: parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, '')) || 0, currency: 'EUR' };
    if (s.includes('£')) return { price: parseFloat(s.replace(/[^0-9.]/g, '')) || 0, currency: 'GBP' };
    const n = parseFloat(s.replace(/,/g, ''));
    if (!isNaN(n)) {
      let currency = 'KRW';
      // 형식 문자열에서 통화 기호 감지 (한국 원 ₩ 와 구별)
      if (fmt) {
        if (fmt.includes('₩')) currency = 'KRW';
        else if (fmt.includes('$') || fmt.includes('USD') || /usd/i.test(fmt)) currency = 'USD';
        else if (fmt.includes('€') || fmt.includes('EUR')) currency = 'EUR';
      }
      return { price: n, currency };
    }
    return { price: 0, currency: 'KRW' }; // 숫자로 못 읽으면 0 처리
  }

  function getRows(tabName) {
    let d = sheetData[tabName];
    if (!d) {
      const realKey = Object.keys(sheetData).find(k => k.trim() === tabName.trim());
      if (realKey) d = sheetData[realKey];
    }
    if (!d) return null;
    if (Array.isArray(d)) return d;
    if (d.values) return d.values;
    return null;
  }

  const rows = getRows(MASTER_CONFIG.tabName);
  if (!rows) return []; // 마스터 탭이 없으면 빈 배열 반환

  const result = [];
  let sid = 1;

  // 마스터 탭 파싱 (각 행 = 사용자별 라이선스)
  for (let i = MASTER_CONFIG.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    
    // 빈 행 스킵
    if (!r || !r.some(c => !isEmpty(c))) continue;

    const c = MASTER_CONFIG.cols;
    const vendor = cv(r[c.vendor] || '');
    const name = cv(r[c.name] || '');
    const cat = cv(r[c.cat] || '');
    const user = cv(r[c.user] || '');
    const startDate = cd(r[c.start]);
    const expireDate = cd(r[c.expire]);
    const form = cv(r[c.form] || 'Annual');
    const account = cv(r[c.account] || '');
    const pw = cv(r[c.pw] || '');
    const serial = cv(r[c.serial] || '');
    const qty = parseInt(r[c.qty] || 0) || 0;
    const price = parseFloat(r[c.price] || 0) || 0;
    const currency = cv(r[c.currency] || 'KRW');
    const note = cv(r[c.note] || '');
    const link = cv(r[c.link] || '');

    if (!name && !cat) continue; // 제품명과 구분이 모두 없으면 스킵

    // 비고 조립
    let fullNote = note;
    if (serial && serial !== '-') {
      fullNote = serial.length > 40 ? note : [note, `SN:${serial}`].filter(Boolean).join(' · ');
    }
    if (form === 'Perpetual' || form === 'Lifetime' || /lifetime/i.test(expireDate)) {
      fullNote = [fullNote, '영구 라이선스(Lifetime)'].filter(Boolean).join(' · ');
    }

    // 알림 유형 결정
    let alertType = 'admin';
    if (form === 'Perpetual' || /lifetime/i.test(expireDate)) {
      alertType = 'none'; // 영구라이선스는 알림 없음
    } else if (user) {
      alertType = 'personal'; // 사용자 지정되면 개인 알림
    }

    result.push({
      id: `sw_${i}`, // 행번호 기반 ID
      tab: MASTER_CONFIG.tabName,
      cat: cat || vendor || 'etc',
      category: cat || vendor || 'etc',
      name: name || '(제품명 미상)',
      vendor: vendor,
      account: account,
      users: user ? [user] : [],
      user: user,
      startDate: startDate,
      expireDate: expireDate,
      form: form,
      price: price,
      priceRaw: price,
      currency: currency,
      note: fullNote,
      alertType: alertType,
      monthlyEnd: false,
      monthlyCalc: form === 'Monthly',
    });
  }

  return result;
}

function fetchSheet(url) {
  return new Promise((resolve, reject) => {
    const cbName = '_cb' + Date.now() + Math.floor(Math.random()*10000);
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('요청 타임아웃 (30초)'));
    }, 30000);

    function cleanup() {
      clearTimeout(timeoutId);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function(data) {
      cleanup();
      resolve(data);
    };

    script.src = url + '?callback=' + cbName + '&t=' + Date.now();
    script.onerror = function() {
      cleanup();
      reject(new Error('스크립트 로드 실패'));
    };
    document.head.appendChild(script);
  });
}

async function pullFromSheet(silent = false) {
  const cfg = SHEET_URLS;
  if (!silent) logSync('구글시트에서 가져오는 중...');

  const done = [];

  // HW Pull - 독립 처리
  if (cfg.hw) {
    try {
      const data = await fetchSheet(cfg.hw);

      let hwAssets = [];

      // 형태 1: { assets: [...] } — 기존 Apps Script 코드
      if (data.assets && Array.isArray(data.assets)) {
        const rows = data.assets;
        if (rows.length > 1) {
          const headers = rows[0];
          hwAssets = rows.slice(1).filter(r => r.some(c => c)).map((r, i) => {
            const obj = { id: `a${i+1}` };
            headers.forEach((h, idx) => { if(h) obj[String(h)] = r[idx] !== null ? String(r[idx]) : ''; });
            return obj;
          });
        }
      }
      // 형태 2: { "탭이름": [[...]] } — 새 Apps Script 코드 (원본 시트 탭별 파싱)
      else if (typeof data === 'object' && !Array.isArray(data)) {
        hwAssets = parseHwSheetData(data);
      }

      if (hwAssets.length) {
        assets = hwAssets;
        saveAssets();
        done.push(`HW ${assets.length}건`);
      } else {
        if (!silent) logSync('HW 파싱 결과 없음 — Apps Script 코드를 확인해주세요', true);
      }
    } catch(e) {
      if (!silent) logSync('HW 가져오기 실패 — ' + e.message, true);
    }
  }

  // SW Pull - 독립 처리 (기존 정적 스냅샷 대신 실시간 파싱)
  if (cfg.sw) {
    try {
      const data = await fetchSheet(cfg.sw);
      let swAssets = [];

      if (typeof data === 'object' && !Array.isArray(data)) {
        swAssets = parseSwSheetData(data);
      }

      if (swAssets.length) {
        swList = swAssets;
        loadSwUserData(); // localStorage에 사용자가 수동 추가한 항목 병합
        done.push(`SW ${swList.length}건`);
      } else {
        if (!silent) logSync('SW 파싱 결과 없음 — Apps Script 코드/시트 구조를 확인해주세요', true);
      }
    } catch(e) {
      if (!silent) logSync('SW 가져오기 실패 — ' + e.message, true);
    }
  }

  // 좌석 Pull - 독립 처리
  if (cfg.seats) {
    try {
      const data = await fetchSheet(cfg.seats);
      const newSeats = [];

      // 탭별 형태: { "탭이름": [[...]] }
      const sheetObj = data.assets ? null : data;
      const target = sheetObj || {};

      Object.entries(target).forEach(([sheetName, rowsRaw]) => {
        const rows = Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw && Array.isArray(rowsRaw.values)) ? rowsRaw.values : null;
        if (!rows) return;
        rows.forEach(r => {
          if (!Array.isArray(r)) return;
          r.forEach(cell => {
            if (!cell) return;
            const s = String(cell).trim();
            if (s.includes('\n')) {
              const parts = s.split('\n');
              if (parts.length >= 2) {
                const seat = parts[0].trim();
                const name = parts[1].trim();
                if (/^\d+-\d+$/.test(seat) && name) {
                  newSeats.push({ floor: sheetName, seat, name });
                }
              }
            }
          });
        });
      });

      if (newSeats.length) {
        window._dynamicSeats = newSeats;
        done.push(`좌석 ${newSeats.length}명`);
      }
    } catch(e) {
      if (!silent) logSync('좌석 가져오기 실패 — ' + e.message, true);
    }
  }

  // 현재 뷰 갱신
  const activeView = document.querySelector('.view.active')?.id?.replace('view-', '');
  if (activeView === 'dashboard') renderDashboard();
  if (activeView === 'list') renderList();
  if (activeView === 'replace') renderReplaceCandidates();
  if (activeView === 'stock') renderStock();
  if (activeView === 'people') renderPeople();
  if (activeView === 'sw-dashboard') renderSwDashboard();
  if (activeView === 'sw-list') renderSwList();
  if (activeView === 'sw-alert') renderSwAlert();

  const now = new Date();
  const timeStr = now.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'});
  if (!silent && done.length) logSync(`가져오기 완료 — ${done.join(', ')} (${timeStr})`);

  const syncText = document.getElementById('sync-status-text');
  if (syncText && (cfg.hw || cfg.seats)) {
    syncText.innerHTML = `구글시트 연동됨 — 마지막 갱신: <strong>${timeStr}</strong>`;
  }
}

function renderSyncView() {
  const elHw = document.getElementById('url-hw');
  const elSw = document.getElementById('url-sw');
  const elSeats = document.getElementById('url-seats');
  if (elHw) { elHw.value = SHEET_URLS.hw; elHw.readOnly = true; elHw.style.color = 'var(--text-muted)'; }
  if (elSw) { elSw.value = SHEET_URLS.sw; elSw.readOnly = true; elSw.style.color = 'var(--text-muted)'; }
  if (elSeats) { elSeats.value = SHEET_URLS.seats; elSeats.readOnly = true; elSeats.style.color = 'var(--text-muted)'; }
  const codeEl = document.getElementById('apps-script-code');
  if (codeEl) codeEl.textContent = APPS_SCRIPT_CODE;
}

function copyScript() {
  navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
    logSync('Apps Script 코드를 클립보드에 복사했어요.');
  });
}

const APPS_SCRIPT_CODE = `function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var result = {};
  ss.getSheets().forEach(function(sheet) {
    var range = sheet.getDataRange();
    result[sheet.getName()] = {
      values: range.getValues(),
      formats: range.getNumberFormats()
    };
  });

  var json = JSON.stringify(result);
  var callback = e.parameter.callback;

  var output;
  if (callback) {
    output = ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    output = ContentService
      .createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  return output;
}

function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}`;

// ============ 로딩/화면 제어 ============
function showLoading(msg) {
  const el = document.getElementById('loading-screen');
  if (el) { el.style.display = 'flex'; document.getElementById('loading-msg').textContent = msg || '데이터를 가져오는 중...'; }
}
function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'none';
}
function showNoConfig() {
  const el = document.getElementById('no-config-screen');
  if (el) el.style.display = 'flex';
}
function hideScreens() {
  hideLoading();
  const el = document.getElementById('no-config-screen');
  if (el) el.style.display = 'none';
}

// ============ Init ============
async function init() {
  loadAssets();
  loadSw();
  updateSyncBar();

  // URL 고정이므로 항상 즉시 Pull
  showLoading('구글시트에서 최신 데이터를 가져오는 중...');
  await pullFromSheet(false);
  hideLoading();
  renderDashboard();

  // 5분마다 자동 Pull
  if (window._autoSyncInterval) clearInterval(window._autoSyncInterval);
  window._autoSyncInterval = setInterval(() => pullFromSheet(true), 5 * 60 * 1000);
}

function startAutoSync() {
  const cfg = loadSheetConfig();
  if (!cfg.hw && !cfg.sw && !cfg.seats) return;
  if (window._autoSyncInterval) clearInterval(window._autoSyncInterval);
  window._autoSyncInterval = setInterval(() => pullFromSheet(true), 5 * 60 * 1000);
}

init();