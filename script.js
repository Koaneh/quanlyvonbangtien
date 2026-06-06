/* ========================================================
   CashFlow Pro – script.js
   Quản lý dòng tiền doanh nghiệp – Vanilla JS + LocalStorage
   ======================================================== */

// ===== CONSTANTS =====
const STORAGE_KEY = 'cashflow_transactions';
const OPENING_KEY = 'cashflow_opening';
const USERS_KEY = 'cashflow_users';
const AUTH_KEY = 'cashflow_current_user';

const INCOME_GROUPS = [
  'Thu bán hàng', 'Thu dịch vụ', 'Thu hồi công nợ', 'Thu vay', 'Thu khác'
];
const EXPENSE_GROUPS = [
  'Chi mua hàng', 'Chi lương', 'Chi thuê mặt bằng', 'Chi marketing', 'Chi trả nợ', 'Chi khác'
];

const PAGE_TITLES = {
  'dashboard': 'Dashboard',
  'add-transaction': 'Nhập Giao Dịch',
  'transactions': 'Danh Sách Giao Dịch',
  'reports': 'Báo Cáo',
  'cashbox': 'Tồn Quỹ',
  'export': 'Xuất Dữ Liệu',
  'users': 'Người Dùng'
};

// Chart palette
const CHART_COLORS = [
  '#2563eb','#16a34a','#dc2626','#ea580c','#ca8a04',
  '#0ea5e9','#7c3aed','#db2777','#0d9488','#9333ea'
];

const ROLE_LABELS = {
  admin: 'Admin',
  accountant: 'Kế toán',
  viewer: 'Viewer'
};

const DEFAULT_USERS = [
  { id: 'u_admin', username: 'admin', password: 'admin123', fullName: 'Quản trị hệ thống', role: 'admin', active: true },
  { id: 'u_ketoan', username: 'ketoan', password: 'ketoan123', fullName: 'Phòng Kế toán', role: 'accountant', active: true },
  { id: 'u_viewer', username: 'viewer', password: 'viewer123', fullName: 'Ban lãnh đạo / Người xem', role: 'viewer', active: true }
];

const ROLE_ACCESS = {
  admin: { pages: ['dashboard','add-transaction','transactions','reports','cashbox','export','users'], create: true, edit: true, delete: true, export: true, cashbox: true, admin: true },
  accountant: { pages: ['dashboard','add-transaction','transactions','reports','cashbox','export'], create: true, edit: true, delete: false, export: true, cashbox: true, admin: false },
  viewer: { pages: ['dashboard','transactions','reports','cashbox'], create: false, edit: false, delete: false, export: false, cashbox: false, admin: false }
};

// Chart instances cache (to destroy before re-rendering)
const charts = {};

// ===== STATE =====
let transactions = [];
let openingBalance = 0;
let dashPeriod = 'month';
let reportPeriod = 'month';
let reportCustomFrom = null;
let reportCustomTo = null;
let users = [];
let currentUser = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  initUsers();
  bindEvents();
  restoreSession();

  if (!currentUser) {
    showLoginScreen();
    return;
  }

  startApp();
});


// ===== AUTHENTICATION & PERMISSIONS =====
function initUsers() {
  const raw = localStorage.getItem(USERS_KEY);
  users = raw ? JSON.parse(raw) : DEFAULT_USERS;
  if (!raw) saveUsers();
}

function saveUsers() {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function restoreSession() {
  const raw = localStorage.getItem(AUTH_KEY);
  currentUser = raw ? JSON.parse(raw) : null;
  if (currentUser) {
    const fresh = users.find(u => u.id === currentUser.id && u.active);
    currentUser = fresh || null;
    if (!currentUser) localStorage.removeItem(AUTH_KEY);
  }
}

function startApp() {
  document.body.classList.remove('unauthenticated');
  document.body.classList.add('authenticated');
  loadData();
  setTodayDate();
  renderTopbarDate();
  renderRoleUI();
  navigateTo('dashboard');

  if (transactions.length === 0 && isAdmin()) loadSampleData(false);
}

function showLoginScreen() {
  document.body.classList.add('unauthenticated');
  document.body.classList.remove('authenticated');
  const loginUser = document.getElementById('loginUsername');
  if (loginUser) loginUser.focus();
}

function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const err = document.getElementById('loginError');
  const found = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

  if (!found || !found.active) {
    if (err) err.textContent = 'Sai tài khoản, mật khẩu hoặc tài khoản đã bị khóa.';
    return;
  }

  currentUser = { ...found };
  delete currentUser.password;
  localStorage.setItem(AUTH_KEY, JSON.stringify(currentUser));
  if (err) err.textContent = '';
  document.getElementById('loginForm').reset();
  showToast(`Xin chào ${found.fullName || found.username}!`, 'success');
  startApp();
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  currentUser = null;
  Object.keys(charts).forEach(k => { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
  showLoginScreen();
}

function getRoleConfig() {
  return ROLE_ACCESS[currentUser?.role] || ROLE_ACCESS.viewer;
}

function isAdmin() {
  return currentUser?.role === 'admin';
}

function hasPermission(action) {
  return !!getRoleConfig()[action];
}

function canAccessPage(page) {
  return getRoleConfig().pages.includes(page);
}

function requirePermission(action, msg = 'Bạn không có quyền thực hiện thao tác này.') {
  if (!currentUser) { showLoginScreen(); return false; }
  if (!hasPermission(action)) {
    showToast(msg, 'error');
    return false;
  }
  return true;
}

function renderRoleUI() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.style.display = canAccessPage(item.dataset.page) ? 'flex' : 'none';
  });

  setText('userNameText', currentUser?.fullName || currentUser?.username || 'Người dùng');
  setText('userRoleText', ROLE_LABELS[currentUser?.role] || 'Vai trò');

  const quickAdd = document.getElementById('quickAddBtn');
  if (quickAdd) quickAdd.style.display = hasPermission('create') ? 'inline-flex' : 'none';

  const exportBtn = document.getElementById('exportCsvBtn');
  if (exportBtn) exportBtn.disabled = !hasPermission('export');
  const sampleBtn = document.getElementById('sampleDataBtn');
  if (sampleBtn) sampleBtn.disabled = !isAdmin();
  const clearBtn = document.getElementById('clearDataBtn');
  if (clearBtn) clearBtn.disabled = !isAdmin();
}

function roleBadge(role) {
  const label = ROLE_LABELS[role] || role;
  return `<span class="role-badge role-badge-${role}">${label}</span>`;
}

function fillDemoAccount(btn) {
  document.getElementById('loginUsername').value = btn.dataset.user;
  document.getElementById('loginPassword').value = btn.dataset.pass;
  document.getElementById('loginError').textContent = '';
}

// ===== DATA PERSISTENCE =====
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  transactions = raw ? JSON.parse(raw) : [];

  const ob = localStorage.getItem(OPENING_KEY);
  if (ob) {
    const parsed = JSON.parse(ob);
    openingBalance = parsed.amount || 0;
    const obInput = document.getElementById('openingBalance');
    if (obInput) obInput.value = formatNumberInput(openingBalance);
    const odInput = document.getElementById('openingDate');
    if (odInput && parsed.date) odInput.value = parsed.date;
  }
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function saveOpeningBalance() {
  if (!requirePermission('cashbox', 'Bạn không có quyền thay đổi số dư đầu kỳ.')) return;
  const amtRaw = document.getElementById('openingBalance').value;
  const date = document.getElementById('openingDate').value;
  const amt = parseAmount(amtRaw);
  if (isNaN(amt) || amt < 0) {
    showToast('Số dư không hợp lệ!', 'error');
    return;
  }
  openingBalance = amt;
  localStorage.setItem(OPENING_KEY, JSON.stringify({ amount: amt, date }));
  showToast('Đã lưu số dư đầu kỳ!', 'success');
  renderCashbox();
}

// ===== DATE HELPERS =====
function setTodayDate() {
  const d = document.getElementById('txDate');
  if (d) d.value = todayStr();
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function renderTopbarDate() {
  const el = document.getElementById('topbarDate');
  if (!el) return;
  const now = new Date();
  const days = ['CN','T2','T3','T4','T5','T6','T7'];
  el.textContent = `${days[now.getDay()]}, ${now.getDate().toString().padStart(2,'0')}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getFullYear()}`;
}

// Parse date string "YYYY-MM-DD" to Date
function parseDate(str) {
  if (!str) return null;
  const parts = str.split('-');
  return new Date(+parts[0], +parts[1]-1, +parts[2]);
}

function formatDate(str) {
  if (!str) return '';
  const parts = str.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Period range
function getPeriodRange(period) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  let from, to;
  switch (period) {
    case 'today':
      from = to = todayStr(); break;
    case 'week': {
      const d = new Date(now);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      from = d.toISOString().split('T')[0];
      const d2 = new Date(d); d2.setDate(d.getDate() + 6);
      to = d2.toISOString().split('T')[0];
      break;
    }
    case 'month':
      from = `${y}-${String(m+1).padStart(2,'0')}-01`;
      to = new Date(y, m+1, 0).toISOString().split('T')[0];
      break;
    case 'quarter': {
      const q = Math.floor(m/3);
      from = `${y}-${String(q*3+1).padStart(2,'0')}-01`;
      to = new Date(y, q*3+3, 0).toISOString().split('T')[0];
      break;
    }
    case 'year':
      from = `${y}-01-01`;
      to = `${y}-12-31`;
      break;
    case 'all':
    default:
      from = null; to = null;
  }
  return { from, to };
}

function filterByPeriod(txList, from, to) {
  return txList.filter(tx => {
    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;
    return true;
  });
}

// ===== NAVIGATION =====
function navigateTo(page) {
  if (!currentUser) { showLoginScreen(); return; }
  if (!canAccessPage(page)) {
    showToast('Vai trò hiện tại không được truy cập chức năng này.', 'error');
    page = 'dashboard';
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = PAGE_TITLES[page] || page;

  // Close sidebar on mobile
  closeSidebar();

  // Render relevant page
  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'transactions': renderTransactions(); break;
    case 'reports': renderReports(); break;
    case 'cashbox': renderCashbox(); break;
    case 'export': renderExportPage(); break;
    case 'users': renderUsersPage(); break;
  }
}

// ===== BIND EVENTS =====
function bindEvents() {
  // Login / Logout
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  document.getElementById('passwordToggle')?.addEventListener('click', () => {
    const input = document.getElementById('loginPassword');
    const icon = document.querySelector('#passwordToggle i');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (icon) icon.className = isPassword ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
  });
  document.querySelectorAll('.demo-account').forEach(btn => btn.addEventListener('click', () => fillDemoAccount(btn)));
  document.getElementById('userForm')?.addEventListener('submit', handleUserFormSubmit);

  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
    });
  });

  // Mobile sidebar
  document.getElementById('menuToggle').addEventListener('click', openSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('overlay').addEventListener('click', closeSidebar);

  // Period buttons (dashboard)
  document.querySelectorAll('.period-filter-bar:first-of-type .period-btn').forEach(btn => {
    if (!btn.dataset.target) {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-filter-bar:first-of-type .period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        dashPeriod = btn.dataset.period;
        renderDashboard();
      });
    }
  });

  // Period buttons (reports)
  document.querySelectorAll('.period-btn[data-target="report"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn[data-target="report"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      reportPeriod = btn.dataset.period;
      reportCustomFrom = null;
      reportCustomTo = null;
      renderReports();
    });
  });

  // Form submit
  document.getElementById('transactionForm').addEventListener('submit', handleFormSubmit);

  // Amount formatting
  document.getElementById('txAmount').addEventListener('input', function() {
    const val = this.value.replace(/[^\d]/g, '');
    this.value = val ? Number(val).toLocaleString('vi-VN') : '';
  });

  // Opening balance formatting
  document.getElementById('openingBalance').addEventListener('input', function() {
    const val = this.value.replace(/[^\d]/g, '');
    this.value = val ? Number(val).toLocaleString('vi-VN') : '';
  });
}

// ===== SIDEBAR =====
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
  document.body.style.overflow = '';
}

// ===== FORM HANDLING =====
function updateGroupOptions() {
  const type = document.getElementById('txType').value;
  const groupSel = document.getElementById('txGroup');
  groupSel.innerHTML = '<option value="">-- Chọn nhóm --</option>';
  const groups = type === 'income' ? INCOME_GROUPS : type === 'expense' ? EXPENSE_GROUPS : [];
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    groupSel.appendChild(opt);
  });
}

function validateForm() {
  let valid = true;

  // Date
  const date = document.getElementById('txDate').value;
  const errDate = document.getElementById('errDate');
  if (!date) {
    errDate.textContent = 'Vui lòng chọn ngày giao dịch';
    document.getElementById('txDate').classList.add('error');
    valid = false;
  } else {
    errDate.textContent = '';
    document.getElementById('txDate').classList.remove('error');
  }

  // Type
  const type = document.getElementById('txType').value;
  const errType = document.getElementById('errType');
  if (!type) {
    errType.textContent = 'Vui lòng chọn loại giao dịch';
    document.getElementById('txType').classList.add('error');
    valid = false;
  } else {
    errType.textContent = '';
    document.getElementById('txType').classList.remove('error');
  }

  // Amount
  const amtRaw = document.getElementById('txAmount').value;
  const amt = parseAmount(amtRaw);
  const errAmount = document.getElementById('errAmount');
  if (!amtRaw || isNaN(amt) || amt <= 0) {
    errAmount.textContent = 'Số tiền phải lớn hơn 0';
    document.getElementById('txAmount').classList.add('error');
    valid = false;
  } else {
    errAmount.textContent = '';
    document.getElementById('txAmount').classList.remove('error');
  }

  return valid;
}

function handleFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  if (id && !requirePermission('edit', 'Bạn không có quyền sửa giao dịch.')) return;
  if (!id && !requirePermission('create', 'Bạn không có quyền thêm giao dịch.')) return;
  if (!validateForm()) return;

  const tx = {
    id: id || generateId(),
    date: document.getElementById('txDate').value,
    type: document.getElementById('txType').value,
    group: document.getElementById('txGroup').value,
    amount: parseAmount(document.getElementById('txAmount').value),
    method: document.getElementById('txMethod').value,
    person: document.getElementById('txPerson').value.trim(),
    desc: document.getElementById('txDesc').value.trim(),
    note: document.getElementById('txNote').value.trim(),
    createdAt: id ? (transactions.find(t => t.id === id)?.createdAt || Date.now()) : Date.now()
  };

  if (id) {
    const idx = transactions.findIndex(t => t.id === id);
    if (idx !== -1) transactions[idx] = tx;
    showToast('Đã cập nhật giao dịch!', 'success');
  } else {
    transactions.unshift(tx);
    showToast('Đã thêm giao dịch mới!', 'success');
  }

  saveTransactions();
  resetForm();
}

function resetForm() {
  document.getElementById('editId').value = '';
  document.getElementById('txDate').value = todayStr();
  document.getElementById('txType').value = '';
  document.getElementById('txGroup').innerHTML = '<option value="">-- Chọn nhóm --</option>';
  document.getElementById('txAmount').value = '';
  document.getElementById('txMethod').value = 'Tiền mặt';
  document.getElementById('txPerson').value = '';
  document.getElementById('txDesc').value = '';
  document.getElementById('txNote').value = '';
  document.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
  document.getElementById('formTitle').textContent = 'Thêm Giao Dịch Mới';
  document.getElementById('submitBtn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu Giao Dịch';
}

function editTransaction(id) {
  if (!requirePermission('edit', 'Bạn không có quyền sửa giao dịch.')) return;
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;

  navigateTo('add-transaction');

  setTimeout(() => {
    document.getElementById('editId').value = tx.id;
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txType').value = tx.type;
    updateGroupOptions();
    document.getElementById('txGroup').value = tx.group;
    document.getElementById('txAmount').value = formatNumberInput(tx.amount);
    document.getElementById('txMethod').value = tx.method;
    document.getElementById('txPerson').value = tx.person || '';
    document.getElementById('txDesc').value = tx.desc || '';
    document.getElementById('txNote').value = tx.note || '';
    document.getElementById('formTitle').textContent = 'Chỉnh Sửa Giao Dịch';
    document.getElementById('submitBtn').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Cập Nhật';
  }, 50);
}

function deleteTransaction(id) {
  if (!requirePermission('delete', 'Chỉ Admin mới được xóa giao dịch.')) return;
  const tx = transactions.find(t => t.id === id);
  if (!tx) return;
  openModal(
    'Xóa giao dịch?',
    `Bạn có chắc muốn xóa giao dịch "<strong>${tx.desc || tx.group || 'Không có tên'}</strong>" – ${formatCurrency(tx.amount)}?`,
    () => {
      transactions = transactions.filter(t => t.id !== id);
      saveTransactions();
      renderTransactions();
      showToast('Đã xóa giao dịch!', 'success');
    }
  );
}

// ===== DASHBOARD =====
function renderDashboard() {
  const { from, to } = getPeriodRange(dashPeriod);
  const filtered = filterByPeriod(transactions, from, to);

  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net = totalIncome - totalExpense;
  const incomeCount = filtered.filter(t => t.type === 'income').length;
  const expenseCount = filtered.filter(t => t.type === 'expense').length;
  const cash = openingBalance + net;
  const ratio = totalExpense > 0 ? (totalIncome / totalExpense).toFixed(2) : (totalIncome > 0 ? '∞' : '--');

  // Warnings
  const wb = document.getElementById('warningBanner');
  const wt = document.getElementById('warningText');
  if (cash < 0) {
    wb.style.display = 'flex';
    wt.textContent = 'Cảnh báo: Tồn quỹ âm! Doanh nghiệp đang thiếu hụt vốn lưu động.';
  } else if (totalExpense > totalIncome && totalIncome > 0) {
    wb.style.display = 'flex';
    wt.textContent = `Cảnh báo: Tổng chi (${formatCurrency(totalExpense)}) vượt tổng thu (${formatCurrency(totalIncome)}) trong kỳ này.`;
  } else {
    wb.style.display = 'none';
  }

  setText('dashCash', formatCurrency(cash));
  setText('dashIncome', formatCurrency(totalIncome));
  setText('dashIncomeCount', `${incomeCount} giao dịch`);
  setText('dashExpense', formatCurrency(totalExpense));
  setText('dashExpenseCount', `${expenseCount} giao dịch`);
  setText('dashNet', formatCurrency(net));
  setText('dashNetStatus', net >= 0 ? '✅ Dương – Thu > Chi' : '🔴 Âm – Chi > Thu');
  setText('dashRatio', ratio);
  setText('dashTotal', filtered.length.toString());
  setText('dashTotalSub', `${incomeCount} thu / ${expenseCount} chi`);

  // Color net value
  const netEl = document.getElementById('dashNet');
  if (netEl) netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';

  // Recent transactions (last 5)
  renderRecentTable(transactions.slice(0, 7));

  // Charts
  renderBarChart(filtered);
  renderLineChart(filtered, from, to);
}

function renderRecentTable(list) {
  const tbody = document.getElementById('recentTableBody');
  if (!tbody) return;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state" style="padding:2rem;text-align:center;color:var(--gray-400)">Chưa có giao dịch nào</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(tx => `
    <tr>
      <td>${formatDate(tx.date)}</td>
      <td><span class="badge ${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">
        <i class="fa-solid fa-${tx.type === 'income' ? 'arrow-up' : 'arrow-down'}"></i>
        ${tx.type === 'income' ? 'Thu' : 'Chi'}
      </span></td>
      <td>${tx.group || '--'}</td>
      <td>${tx.desc || '--'}</td>
      <td class="${tx.type === 'income' ? 'amount-income' : 'amount-expense'}">
        ${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.amount)}
      </td>
    </tr>
  `).join('');
}

// ===== BAR CHART (Dashboard) =====
function renderBarChart(filtered) {
  const canvas = document.getElementById('barChart');
  if (!canvas) return;

  // Group by month or by week if short period
  const dataMap = {};
  filtered.forEach(tx => {
    const key = tx.date.slice(0, 7); // YYYY-MM
    if (!dataMap[key]) dataMap[key] = { income: 0, expense: 0 };
    if (tx.type === 'income') dataMap[key].income += tx.amount;
    else dataMap[key].expense += tx.amount;
  });

  const labels = Object.keys(dataMap).sort();
  const incomeData = labels.map(k => dataMap[k].income);
  const expenseData = labels.map(k => dataMap[k].expense);
  const labelsFmt = labels.map(l => {
    const [y, m] = l.split('-');
    return `T${m}/${y.slice(2)}`;
  });

  if (charts.bar) { charts.bar.destroy(); }
  charts.bar = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labelsFmt.length ? labelsFmt : ['Không có dữ liệu'],
      datasets: [
        { label: 'Tổng Thu', data: incomeData, backgroundColor: 'rgba(22,163,74,.8)', borderRadius: 6 },
        { label: 'Tổng Chi', data: expenseData, backgroundColor: 'rgba(220,38,38,.8)', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, callback: v => shortCurrency(v) } }
      }
    }
  });
}

// ===== LINE CHART (Dashboard) =====
function renderLineChart(filtered) {
  const canvas = document.getElementById('lineChart');
  if (!canvas) return;

  const dateMap = {};
  filtered.forEach(tx => {
    if (!dateMap[tx.date]) dateMap[tx.date] = 0;
    if (tx.type === 'income') dateMap[tx.date] += tx.amount;
    else dateMap[tx.date] -= tx.amount;
  });

  const dates = Object.keys(dateMap).sort();
  let running = openingBalance;
  const cumData = dates.map(d => { running += dateMap[d]; return running; });
  const labelsFmt = dates.map(d => formatDate(d));

  if (charts.line) { charts.line.destroy(); }
  charts.line = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labelsFmt.length ? labelsFmt : ['Không có dữ liệu'],
      datasets: [{
        label: 'Tồn Quỹ',
        data: cumData,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,.08)',
        borderWidth: 2.5,
        pointBackgroundColor: '#2563eb',
        pointRadius: 4,
        tension: .35,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 10 } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, callback: v => shortCurrency(v) } }
      }
    }
  });
}

// ===== TRANSACTIONS LIST =====
let currentFiltered = [];

function renderTransactions() {
  applyFilters();
}

function applyFilters() {
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const type = document.getElementById('filterType')?.value || 'all';
  const method = document.getElementById('filterMethod')?.value || 'all';
  const from = document.getElementById('filterFrom')?.value || '';
  const to = document.getElementById('filterTo')?.value || '';

  currentFiltered = transactions.filter(tx => {
    if (type !== 'all' && tx.type !== type) return false;
    if (method !== 'all' && tx.method !== method) return false;
    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;
    if (search) {
      const hay = `${tx.desc} ${tx.group} ${tx.person} ${tx.note}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort by date desc
  currentFiltered.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  renderMainTable(currentFiltered);
  renderListSummary(currentFiltered);
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterType').value = 'all';
  document.getElementById('filterMethod').value = 'all';
  document.getElementById('filterFrom').value = '';
  document.getElementById('filterTo').value = '';
  applyFilters();
}

function renderMainTable(list) {
  const tbody = document.getElementById('mainTableBody');
  const emptyEl = document.getElementById('emptyState');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = list.map((tx, i) => `
    <tr>
      <td style="color:var(--gray-400);font-family:'DM Mono',monospace;font-size:.8rem">${i + 1}</td>
      <td style="white-space:nowrap;font-family:'DM Mono',monospace;font-size:.82rem">${formatDate(tx.date)}</td>
      <td>
        <span class="badge ${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">
          <i class="fa-solid fa-${tx.type === 'income' ? 'circle-arrow-up' : 'circle-arrow-down'}"></i>
          ${tx.type === 'income' ? 'Thu' : 'Chi'}
        </span>
      </td>
      <td style="white-space:nowrap">${tx.group || '--'}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(tx.desc)}">${tx.desc || '--'}</td>
      <td><span class="badge badge-method">${tx.method || '--'}</span></td>
      <td style="white-space:nowrap">${tx.person || '--'}</td>
      <td class="${tx.type === 'income' ? 'amount-income' : 'amount-expense'}">
        ${tx.type === 'income' ? '+' : '-'}${formatCurrency(tx.amount)}
      </td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--gray-400);font-size:.8rem" title="${escHtml(tx.note)}">${tx.note || '--'}</td>
      <td>
        <div class="action-btns">
          ${hasPermission('edit') ? `<button class="btn-icon btn-edit" onclick="editTransaction('${tx.id}')" title="Sửa"><i class="fa-solid fa-pen"></i></button>` : ''}
          ${hasPermission('delete') ? `<button class="btn-icon btn-del" onclick="deleteTransaction('${tx.id}')" title="Xóa"><i class="fa-solid fa-trash"></i></button>` : ''}
          ${(!hasPermission('edit') && !hasPermission('delete')) ? '<span style="color:var(--gray-400);font-size:.78rem">Chỉ xem</span>' : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function renderListSummary(list) {
  const el = document.getElementById('listSummary');
  if (!el) return;
  const inc = list.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const exp = list.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  el.innerHTML = `
    <div class="mini-stat mini-stat-income"><i class="fa-solid fa-arrow-up" style="color:var(--green)"></i> Tổng thu: <strong>${formatCurrency(inc)}</strong></div>
    <div class="mini-stat mini-stat-expense"><i class="fa-solid fa-arrow-down" style="color:var(--red)"></i> Tổng chi: <strong>${formatCurrency(exp)}</strong></div>
    <div class="mini-stat mini-stat-count"><i class="fa-solid fa-receipt" style="color:var(--blue)"></i> Kết quả: <strong>${list.length}</strong> giao dịch</div>
  `;
}

// ===== REPORTS =====
function applyCustomReportPeriod() {
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  if (!from || !to) { showToast('Vui lòng chọn đủ ngày bắt đầu và kết thúc', 'error'); return; }
  reportCustomFrom = from;
  reportCustomTo = to;
  document.querySelectorAll('.period-btn[data-target="report"]').forEach(b => b.classList.remove('active'));
  renderReports();
}

function renderReports() {
  let from, to;
  if (reportCustomFrom) {
    from = reportCustomFrom; to = reportCustomTo;
  } else {
    const range = getPeriodRange(reportPeriod);
    from = range.from; to = range.to;
  }

  const filtered = filterByPeriod(transactions, from, to);
  const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net = totalIncome - totalExpense;
  const cash = openingBalance + net;

  setText('rptIncome', formatCurrency(totalIncome));
  setText('rptExpense', formatCurrency(totalExpense));
  const netEl = document.getElementById('rptNet');
  if (netEl) { netEl.textContent = formatCurrency(net); netEl.style.color = net >= 0 ? 'var(--green)' : 'var(--red)'; }
  setText('rptCash', formatCurrency(cash));

  // Group breakdowns
  const incomeByGroup = groupBy(filtered.filter(t => t.type === 'income'), 'group', totalIncome);
  const expenseByGroup = groupBy(filtered.filter(t => t.type === 'expense'), 'group', totalExpense);

  renderGroupTable('incomeGroupTable', incomeByGroup);
  renderGroupTable('expenseGroupTable', expenseByGroup);

  renderPieChart('incomePieChart', incomeByGroup, 'income');
  renderPieChart('expensePieChart', expenseByGroup, 'expense');
  renderMonthlyChart(filtered);
}

function groupBy(list, key, total) {
  const map = {};
  list.forEach(tx => {
    const k = tx[key] || 'Khác';
    if (!map[k]) map[k] = { count: 0, total: 0 };
    map[k].count++;
    map[k].total += tx.amount;
  });
  return Object.entries(map)
    .map(([name, v]) => ({ name, count: v.count, total: v.total, pct: total > 0 ? (v.total / total * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.total - a.total);
}

function renderGroupTable(id, data) {
  const tbody = document.getElementById(id);
  if (!tbody) return;
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:1rem">Không có dữ liệu</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(d => `
    <tr>
      <td>${d.name}</td>
      <td style="font-family:'DM Mono',monospace">${d.count}</td>
      <td style="font-weight:700;font-family:'DM Mono',monospace">${formatCurrency(d.total)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="flex:1;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden">
            <div style="width:${d.pct}%;height:100%;background:var(--blue);border-radius:3px"></div>
          </div>
          <span style="font-size:.75rem;font-weight:600;color:var(--gray-600);min-width:38px">${d.pct}%</span>
        </div>
      </td>
    </tr>
  `).join('');
}

function renderPieChart(canvasId, data, type) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (charts[canvasId]) { charts[canvasId].destroy(); }

  if (data.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const colors = type === 'income'
    ? ['#16a34a','#22c55e','#4ade80','#86efac','#bbf7d0','#0d9488','#2dd4bf']
    : ['#dc2626','#ef4444','#f87171','#fca5a5','#fecaca','#ea580c','#fb923c'];

  charts[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.name),
      datasets: [{
        data: data.map(d => d.total),
        backgroundColor: data.map((_, i) => colors[i % colors.length]),
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '55%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 12, padding: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)} (${(ctx.raw / ctx.dataset.data.reduce((a,b) => a+b,0) * 100).toFixed(1)}%)` } }
      }
    }
  });
}

function renderMonthlyChart(filtered) {
  const canvas = document.getElementById('monthlyChart');
  if (!canvas) return;

  const monthMap = {};
  filtered.forEach(tx => {
    const key = tx.date.slice(0, 7);
    if (!monthMap[key]) monthMap[key] = { income: 0, expense: 0 };
    if (tx.type === 'income') monthMap[key].income += tx.amount;
    else monthMap[key].expense += tx.amount;
  });

  const months = Object.keys(monthMap).sort();
  const labelsFmt = months.map(m => `T${m.split('-')[1]}/${m.split('-')[0].slice(2)}`);
  const incomeData = months.map(m => monthMap[m].income);
  const expenseData = months.map(m => monthMap[m].expense);
  const netData = months.map(m => monthMap[m].income - monthMap[m].expense);

  if (charts.monthly) { charts.monthly.destroy(); }
  charts.monthly = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labelsFmt.length ? labelsFmt : ['Không có dữ liệu'],
      datasets: [
        { type: 'bar', label: 'Thu', data: incomeData, backgroundColor: 'rgba(22,163,74,.75)', borderRadius: 5 },
        { type: 'bar', label: 'Chi', data: expenseData, backgroundColor: 'rgba(220,38,38,.75)', borderRadius: 5 },
        { type: 'line', label: 'Dòng tiền thuần', data: netData, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.05)', borderWidth: 2.5, pointRadius: 4, tension: .4, fill: false, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'top', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, callback: v => shortCurrency(v) } }
      }
    }
  });
}

// ===== CASHBOX =====
function renderCashbox() {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance = openingBalance + totalIncome - totalExpense;

  setText('cbOpening', formatCurrency(openingBalance));
  setText('cbIncome', formatCurrency(totalIncome));
  setText('cbExpense', formatCurrency(totalExpense));

  const balEl = document.getElementById('cbBalance');
  if (balEl) { balEl.textContent = formatCurrency(balance); balEl.style.color = balance < 0 ? 'var(--red)' : 'var(--blue)'; }

  const warnEl = document.getElementById('cashboxWarning');
  if (warnEl) warnEl.style.display = balance < 0 ? 'flex' : 'none';

  // Method breakdown
  const methods = ['Tiền mặt', 'Chuyển khoản', 'Ví điện tử'];
  const tbody = document.getElementById('methodTable');
  if (tbody) {
    tbody.innerHTML = methods.map(m => {
      const mInc = transactions.filter(t => t.type === 'income' && t.method === m).reduce((s, t) => s + t.amount, 0);
      const mExp = transactions.filter(t => t.type === 'expense' && t.method === m).reduce((s, t) => s + t.amount, 0);
      const diff = mInc - mExp;
      return `
        <tr>
          <td><span class="badge badge-method">${m}</span></td>
          <td class="amount-income">+${formatCurrency(mInc)}</td>
          <td class="amount-expense">-${formatCurrency(mExp)}</td>
          <td class="${diff >= 0 ? 'amount-income' : 'amount-expense'}" style="font-weight:700">${diff >= 0 ? '+' : ''}${formatCurrency(diff)}</td>
        </tr>
      `;
    }).join('');
  }
}

// ===== EXPORT PAGE =====
function renderExportPage() {
  renderRoleUI();
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const el = document.getElementById('dataInfoTable');
  if (!el) return;
  el.innerHTML = `
    <div class="info-item"><div class="info-label">Tổng giao dịch</div><div class="info-value">${transactions.length}</div></div>
    <div class="info-item"><div class="info-label">Giao dịch thu</div><div class="info-value">${transactions.filter(t => t.type === 'income').length}</div></div>
    <div class="info-item"><div class="info-label">Giao dịch chi</div><div class="info-value">${transactions.filter(t => t.type === 'expense').length}</div></div>
    <div class="info-item"><div class="info-label">Tổng thu</div><div class="info-value">${formatCurrency(totalIncome)}</div></div>
    <div class="info-item"><div class="info-label">Tổng chi</div><div class="info-value">${formatCurrency(totalExpense)}</div></div>
    <div class="info-item"><div class="info-label">Số dư đầu kỳ</div><div class="info-value">${formatCurrency(openingBalance)}</div></div>
    <div class="info-item"><div class="info-label">Tồn quỹ hiện tại</div><div class="info-value">${formatCurrency(openingBalance + totalIncome - totalExpense)}</div></div>
    <div class="info-item"><div class="info-label">Bộ nhớ sử dụng</div><div class="info-value">~${(JSON.stringify(transactions).length / 1024).toFixed(1)} KB</div></div>
  `;
}

// ===== CSV EXPORT =====
function exportCSV() {
  if (!requirePermission('export', 'Bạn không có quyền xuất dữ liệu.')) return;
  if (transactions.length === 0) { showToast('Không có dữ liệu để xuất!', 'error'); return; }
  const headers = ['STT','Ngày','Loại','Nhóm','Nội dung','Phương thức','Người thực hiện','Số tiền','Ghi chú'];
  const rows = transactions.map((tx, i) => [
    i+1,
    formatDate(tx.date),
    tx.type === 'income' ? 'Thu' : 'Chi',
    tx.group || '',
    tx.desc || '',
    tx.method || '',
    tx.person || '',
    tx.amount,
    tx.note || ''
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));

  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cashflow_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Đã xuất file CSV thành công!', 'success');
}

// ===== CLEAR ALL =====
function clearAllData() {
  if (!isAdmin()) { showToast('Chỉ Admin mới được xóa toàn bộ dữ liệu.', 'error'); return; }
  openModal(
    'Xóa toàn bộ dữ liệu?',
    'Hành động này sẽ xóa <strong>tất cả</strong> giao dịch và thiết lập đã lưu. Không thể hoàn tác!',
    () => {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(OPENING_KEY);
      transactions = [];
      openingBalance = 0;
      document.getElementById('openingBalance').value = '';
      document.getElementById('openingDate').value = '';
      showToast('Đã xóa toàn bộ dữ liệu!', 'success');
      navigateTo('dashboard');
    }
  );
}

// ===== SAMPLE DATA =====
function loadSampleData(confirm_override) {
  if (confirm_override && !isAdmin()) { showToast('Chỉ Admin mới được nạp dữ liệu mẫu.', 'error'); return; }
  const doLoad = () => {
    const today = new Date();
    const d = (offset = 0, month_offset = 0) => {
      const dt = new Date(today);
      dt.setMonth(dt.getMonth() + month_offset);
      dt.setDate(dt.getDate() - offset);
      return dt.toISOString().split('T')[0];
    };

    const sample = [
      { id: generateId(), date: d(1), type: 'income', group: 'Thu bán hàng', amount: 45000000, method: 'Chuyển khoản', person: 'Phòng Kinh Doanh', desc: 'Thu tiền bán hàng tháng này (đợt 1)', note: 'Khách hàng Hoàng Phát', createdAt: Date.now()-100 },
      { id: generateId(), date: d(2), type: 'expense', group: 'Chi lương', amount: 28000000, method: 'Chuyển khoản', person: 'Phòng Nhân Sự', desc: 'Trả lương nhân viên tháng hiện tại', note: '7 nhân viên', createdAt: Date.now()-200 },
      { id: generateId(), date: d(3), type: 'income', group: 'Thu dịch vụ', amount: 12500000, method: 'Tiền mặt', person: 'Nguyễn Minh Khoa', desc: 'Thu phí dịch vụ tư vấn công ty ABC', note: 'Hợp đồng số HĐ-2024-01', createdAt: Date.now()-300 },
      { id: generateId(), date: d(4), type: 'expense', group: 'Chi mua hàng', amount: 18700000, method: 'Chuyển khoản', person: 'Phòng Mua Hàng', desc: 'Mua nguyên vật liệu sản xuất Q1', note: 'NCC: Công ty Thép Bắc Việt', createdAt: Date.now()-400 },
      { id: generateId(), date: d(5), type: 'expense', group: 'Chi thuê mặt bằng', amount: 15000000, method: 'Chuyển khoản', person: 'Kế Toán', desc: 'Trả tiền thuê văn phòng tháng hiện tại', note: 'Địa chỉ: 123 Nguyễn Huệ', createdAt: Date.now()-500 },
      { id: generateId(), date: d(7), type: 'income', group: 'Thu bán hàng', amount: 32000000, method: 'Chuyển khoản', person: 'Phòng Kinh Doanh', desc: 'Thu tiền bán hàng đơn #B2024-045', note: '', createdAt: Date.now()-600 },
      { id: generateId(), date: d(8), type: 'expense', group: 'Chi marketing', amount: 8500000, method: 'Chuyển khoản', person: 'Phòng Marketing', desc: 'Chi phí quảng cáo Facebook & Google tháng này', note: '', createdAt: Date.now()-700 },
      { id: generateId(), date: d(10), type: 'income', group: 'Thu hồi công nợ', amount: 22000000, method: 'Chuyển khoản', person: 'Phòng Kế Toán', desc: 'Thu hồi công nợ từ khách hàng XYZ', note: 'Nợ từ tháng trước', createdAt: Date.now()-800 },
      { id: generateId(), date: d(12), type: 'expense', group: 'Chi trả nợ', amount: 10000000, method: 'Chuyển khoản', person: 'Giám Đốc', desc: 'Trả nợ vay ngân hàng kỳ này', note: 'Khoản vay HD-2023-005', createdAt: Date.now()-900 },
      { id: generateId(), date: d(14), type: 'income', group: 'Thu dịch vụ', amount: 9800000, method: 'Ví điện tử', person: 'Lê Thị Hoa', desc: 'Doanh thu dịch vụ thiết kế website', note: 'Dự án DEF Media', createdAt: Date.now()-1000 },
      { id: generateId(), date: d(15), type: 'expense', group: 'Chi khác', amount: 3200000, method: 'Tiền mặt', person: 'Hành Chính', desc: 'Chi phí văn phòng phẩm, điện nước', note: '', createdAt: Date.now()-1100 },
      { id: generateId(), date: d(0,-1), type: 'income', group: 'Thu bán hàng', amount: 67000000, method: 'Chuyển khoản', person: 'Phòng Kinh Doanh', desc: 'Doanh thu bán hàng tháng trước (tổng kết)', note: '', createdAt: Date.now()-1200 },
      { id: generateId(), date: d(5,-1), type: 'expense', group: 'Chi lương', amount: 28000000, method: 'Chuyển khoản', person: 'Phòng Nhân Sự', desc: 'Lương nhân viên tháng trước', note: '', createdAt: Date.now()-1300 },
      { id: generateId(), date: d(8,-1), type: 'expense', group: 'Chi mua hàng', amount: 21000000, method: 'Chuyển khoản', person: 'Phòng Mua Hàng', desc: 'Nhập hàng tháng trước', note: '', createdAt: Date.now()-1400 },
      { id: generateId(), date: d(10,-1), type: 'income', group: 'Thu hồi công nợ', amount: 15000000, method: 'Tiền mặt', person: 'Trần Văn Nam', desc: 'Thu hồi nợ khách hàng cũ', note: 'Đã xác nhận', createdAt: Date.now()-1500 },
      { id: generateId(), date: d(15,-1), type: 'expense', group: 'Chi thuê mặt bằng', amount: 15000000, method: 'Chuyển khoản', person: 'Kế Toán', desc: 'Thuê văn phòng tháng trước', note: '', createdAt: Date.now()-1600 },
      { id: generateId(), date: d(2,-1), type: 'income', group: 'Thu vay', amount: 50000000, method: 'Chuyển khoản', person: 'Giám Đốc', desc: 'Vay vốn ngân hàng bổ sung kinh doanh', note: 'Khoản vay mới HD-2024-001', createdAt: Date.now()-1700 },
      { id: generateId(), date: d(20,-1), type: 'expense', group: 'Chi marketing', amount: 12000000, method: 'Chuyển khoản', person: 'Phòng Marketing', desc: 'Tổ chức sự kiện ra mắt sản phẩm mới', note: '', createdAt: Date.now()-1800 },
      { id: generateId(), date: d(18,-1), type: 'income', group: 'Thu dịch vụ', amount: 7500000, method: 'Ví điện tử', person: 'Nguyễn Văn An', desc: 'Thu phí bảo trì hệ thống phần mềm', note: 'Khách hàng: Công ty GHI', createdAt: Date.now()-1900 },
      { id: generateId(), date: d(25,-1), type: 'expense', group: 'Chi khác', amount: 4500000, method: 'Tiền mặt', person: 'Hành Chính', desc: 'Chi tiếp khách, phí đại diện', note: '', createdAt: Date.now()-2000 },
    ];

    transactions = sample;
    openingBalance = 50000000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    localStorage.setItem(OPENING_KEY, JSON.stringify({ amount: 50000000, date: d(0,-1) }));
    document.getElementById('openingBalance').value = formatNumberInput(50000000);
    showToast('Đã nạp dữ liệu mẫu thành công!', 'success');
    navigateTo('dashboard');
  };

  if (confirm_override) {
    openModal(
      'Nạp dữ liệu mẫu?',
      'Thao tác này sẽ xóa dữ liệu hiện tại và thay bằng dữ liệu mẫu. Bạn có chắc không?',
      doLoad
    );
  } else {
    doLoad();
  }
}


// ===== USER MANAGEMENT =====
function renderUsersPage() {
  if (!isAdmin()) { navigateTo('dashboard'); return; }
  renderUsersTable();
}

function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${escHtml(u.username)}</strong></td>
      <td>${escHtml(u.fullName || '--')}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${u.active ? '<span class="status-badge status-active">Đang hoạt động</span>' : '<span class="status-badge status-locked">Đã khóa</span>'}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-edit" onclick="editUser('${u.id}')" title="Sửa"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon ${u.active ? 'btn-lock' : 'btn-unlock'}" onclick="toggleUserStatus('${u.id}')" title="${u.active ? 'Khóa' : 'Mở khóa'}">
            <i class="fa-solid fa-${u.active ? 'lock' : 'unlock'}"></i>
          </button>
          ${u.username !== 'admin' ? `<button class="btn-icon btn-del" onclick="deleteUser('${u.id}')" title="Xóa"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function handleUserFormSubmit(e) {
  e.preventDefault();
  if (!isAdmin()) { showToast('Chỉ Admin mới được quản lý người dùng.', 'error'); return; }

  const id = document.getElementById('userEditId').value;
  const fullName = document.getElementById('newFullName').value.trim();
  const username = document.getElementById('newUsername').value.trim().toLowerCase();
  const password = document.getElementById('newPassword').value.trim();
  const role = document.getElementById('newRole').value;

  if (!username || !/^[a-z0-9_\.]{3,20}$/.test(username)) {
    showToast('Tên đăng nhập cần 3–20 ký tự, chỉ gồm chữ không dấu, số, dấu _ hoặc dấu chấm.', 'error');
    return;
  }
  if (!id && password.length < 6) { showToast('Mật khẩu cần tối thiểu 6 ký tự.', 'error'); return; }
  if (id && password && password.length < 6) { showToast('Mật khẩu mới cần tối thiểu 6 ký tự.', 'error'); return; }
  if (users.some(u => u.username === username && u.id !== id)) { showToast('Tên đăng nhập đã tồn tại.', 'error'); return; }

  if (id) {
    const idx = users.findIndex(u => u.id === id);
    if (idx !== -1) {
      users[idx] = { ...users[idx], username, fullName, role, ...(password ? { password } : {}) };
      showToast('Đã cập nhật tài khoản.', 'success');
    }
  } else {
    users.push({ id: generateId(), username, password, fullName, role, active: true });
    showToast('Đã tạo tài khoản mới.', 'success');
  }

  saveUsers();
  resetUserForm();
  renderUsersTable();
}

function editUser(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  document.getElementById('userEditId').value = u.id;
  document.getElementById('newFullName').value = u.fullName || '';
  document.getElementById('newUsername').value = u.username;
  document.getElementById('newPassword').value = '';
  document.getElementById('newPassword').placeholder = 'Để trống nếu không đổi mật khẩu';
  document.getElementById('newRole').value = u.role;
  document.getElementById('saveUserBtn').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Cập nhật tài khoản';
}

function resetUserForm() {
  document.getElementById('userEditId').value = '';
  document.getElementById('newFullName').value = '';
  document.getElementById('newUsername').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('newPassword').placeholder = 'Tối thiểu 6 ký tự';
  document.getElementById('newRole').value = 'viewer';
  document.getElementById('saveUserBtn').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu tài khoản';
}

function toggleUserStatus(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  if (u.id === currentUser?.id) { showToast('Không thể tự khóa tài khoản đang đăng nhập.', 'error'); return; }
  u.active = !u.active;
  saveUsers();
  renderUsersTable();
  showToast(u.active ? 'Đã mở khóa tài khoản.' : 'Đã khóa tài khoản.', 'success');
}

function deleteUser(id) {
  const u = users.find(x => x.id === id);
  if (!u) return;
  if (u.username === 'admin') { showToast('Không thể xóa tài khoản admin mặc định.', 'error'); return; }
  if (u.id === currentUser?.id) { showToast('Không thể xóa tài khoản đang đăng nhập.', 'error'); return; }
  openModal('Xóa tài khoản?', `Bạn có chắc muốn xóa tài khoản <strong>${escHtml(u.username)}</strong>?`, () => {
    users = users.filter(x => x.id !== id);
    saveUsers();
    renderUsersTable();
    showToast('Đã xóa tài khoản.', 'success');
  });
}

// ===== MODAL =====
let modalCallback = null;

function openModal(title, msg, onConfirm) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMsg').innerHTML = msg;
  document.getElementById('modalBackdrop').style.display = 'flex';
  modalCallback = onConfirm;
}

function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
  modalCallback = null;
}

document.getElementById('modalConfirmBtn').addEventListener('click', () => {
  if (modalCallback) modalCallback();
  closeModal();
});

document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('modalBackdrop')) closeModal();
});

// ===== TOAST =====
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const msgEl = document.getElementById('toastMsg');

  toast.className = 'toast';
  if (type === 'success') { toast.classList.add('toast-success'); icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>'; }
  else if (type === 'error') { toast.classList.add('toast-error'); icon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>'; }
  else if (type === 'warning') { toast.classList.add('toast-warning'); icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>'; }

  msgEl.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// ===== UTILITY =====
function generateId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function parseAmount(str) {
  return parseFloat(String(str).replace(/[^\d]/g, '')) || 0;
}

function formatCurrency(n) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(n || 0);
}

function formatNumberInput(n) {
  return (n || 0).toLocaleString('vi-VN');
}

function shortCurrency(v) {
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'T';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'Tr';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
