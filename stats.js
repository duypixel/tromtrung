/* TromTrung visit analytics. Requires the SQL in supabase-site-visits.sql. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let started = false;
  let lastView = '';
  let lastRows = [];

  function getSessionId() {
    try {
      let id = sessionStorage.getItem('tromtrung_analytics_session');
      if (!id) {
        id = (window.crypto && crypto.randomUUID)
          ? crypto.randomUUID()
          : 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        sessionStorage.setItem('tromtrung_analytics_session', id);
      }
      return id;
    } catch (_) {
      return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }
  }

  function currentView() {
    const detail = $('mapDetailPage');
    const isDetail = detail && !detail.hidden;
    const title = isDetail ? ($('currentTitle')?.textContent || 'Bản đồ') : 'Trang chọn bản đồ';
    return { key: (isDetail ? 'map:' : 'gallery:') + title, path: location.pathname + (isDetail ? '#map/' + encodeURIComponent(title) : '#gallery') };
  }

  async function recordView(force = false) {
    if (!db) return;
    const view = currentView();
    if (!force && view.key === lastView) return;
    lastView = view.key;
    try {
      const { error } = await db.from('site_visits').insert({
        session_id: getSessionId(),
        page_path: view.path.slice(0, 500)
      });
      if (error) console.warn('Thống kê truy cập chưa được ghi nhận. Hãy chạy supabase-site-visits.sql:', error.message);
    } catch (error) {
      console.warn('Không ghi được lượt truy cập:', error);
    }
  }

  function injectAdminTab() {
    const tabs = document.querySelector('.tabs');
    const editor = $('editorPanel');
    if (!tabs || !editor || $('siteVisitsTabButton')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.id = 'siteVisitsTabButton';
    button.textContent = 'Thống kê truy cập';
    tabs.appendChild(button);

    const panel = document.createElement('section');
    panel.id = 'siteVisitsTab';
    panel.className = 'tab-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <h3>Thống kê truy cập website</h3>
      <p class="muted">Số liệu bắt đầu được ghi nhận sau khi cài đặt bảng thống kê. Mỗi lần mở trang hoặc chuyển sang một bản đồ khác sẽ được tính là một lượt xem.</p>
      <div class="visit-stats-grid">
        <div class="visit-stat-card"><span>Tổng lượt xem</span><strong id="visitTotal">—</strong></div>
        <div class="visit-stat-card"><span>Khách theo phiên (ước tính)</span><strong id="visitUnique">—</strong></div>
        <div class="visit-stat-card"><span>Hôm nay</span><strong id="visitToday">—</strong></div>
        <div class="visit-stat-card"><span>7 ngày gần nhất</span><strong id="visitWeek">—</strong></div>
      </div>
      <div class="section-head"><span>LƯỢT XEM 7 NGÀY GẦN NHẤT</span><button type="button" class="mini-button" id="refreshVisitStats">Làm mới</button></div>
      <div id="visitDailyBars" class="visit-daily-bars"><p class="muted">Nhấn làm mới để tải thống kê.</p></div>
      <p id="visitStatsMessage" class="message"></p>
      <p class="muted">Khách theo phiên là số mã phiên trình duyệt ước tính, không phải số người chính xác. Không lưu địa chỉ IP hoặc thông tin cá nhân.</p>
    `;
    editor.appendChild(panel);

    button.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.tab-panel').forEach(section => { section.hidden = section !== panel; });
      loadStats();
    });
    $('refreshVisitStats').addEventListener('click', loadStats);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('vi-VN').format(value || 0);
  }

  async function loadStats() {
    const message = $('visitStatsMessage');
    if (!db || !session) {
      if (message) message.textContent = 'Hãy đăng nhập quản trị Supabase để xem số liệu.';
      return;
    }
    message.textContent = 'Đang tải số liệu…';
    try {
      const since7 = new Date();
      since7.setHours(0, 0, 0, 0);
      since7.setDate(since7.getDate() - 6);
      const since30 = new Date();
      since30.setDate(since30.getDate() - 30);
      const [totalResult, recentResult] = await Promise.all([
        db.from('site_visits').select('id', { count: 'exact', head: true }),
        db.from('site_visits').select('visited_at,session_id,page_path').gte('visited_at', since30.toISOString()).order('visited_at', { ascending: false }).limit(10000)
      ]);
      if (totalResult.error) throw totalResult.error;
      if (recentResult.error) throw recentResult.error;
      lastRows = recentResult.data || [];
      const now = new Date();
      const todayKey = now.toLocaleDateString('en-CA');
      const todayRows = lastRows.filter(row => new Date(row.visited_at).toLocaleDateString('en-CA') === todayKey);
      const weekRows = lastRows.filter(row => new Date(row.visited_at) >= since7);
      $('visitTotal').textContent = formatNumber(totalResult.count);
      $('visitUnique').textContent = formatNumber(new Set(lastRows.map(row => row.session_id)).size);
      $('visitToday').textContent = formatNumber(todayRows.length);
      $('visitWeek').textContent = formatNumber(weekRows.length);
      renderDailyBars(lastRows);
      message.textContent = 'Cập nhật lúc ' + now.toLocaleTimeString('vi-VN');
    } catch (error) {
      console.error('Không tải được thống kê truy cập:', error);
      message.textContent = 'Chưa đọc được dữ liệu. Hãy chạy file supabase-site-visits.sql trong Supabase SQL Editor rồi thử lại. Chi tiết: ' + (error.message || 'Lỗi không xác định');
    }
  }

  function renderDailyBars(rows) {
    const host = $('visitDailyBars');
    if (!host) return;
    const days = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - offset);
      const key = date.toLocaleDateString('en-CA');
      const count = rows.filter(row => new Date(row.visited_at).toLocaleDateString('en-CA') === key).length;
      days.push({ label: date.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }), count });
    }
    const max = Math.max(1, ...days.map(day => day.count));
    host.innerHTML = days.map(day => `
      <div class="visit-day">
        <span class="visit-day-label">${day.label}</span>
        <div class="visit-bar-track"><div class="visit-bar" style="width:${Math.max(day.count ? 3 : 0, day.count / max * 100)}%"></div></div>
        <strong>${formatNumber(day.count)}</strong>
      </div>`).join('');
  }

  function start() {
    if (started || !db) return;
    started = true;
    injectAdminTab();
    recordView(true);
    const observer = new MutationObserver(() => recordView());
    const gallery = $('mapGalleryPage');
    const detail = $('mapDetailPage');
    const title = $('currentTitle');
    [gallery, detail, title].filter(Boolean).forEach(node => observer.observe(node, {
      attributes: true,
      attributeFilter: ['hidden'],
      childList: node === title,
      characterData: node === title,
      subtree: node === title
    }));
    if (typeof db.auth?.onAuthStateChange === 'function') {
      db.auth.onAuthStateChange(() => injectAdminTab());
    }
  }

  // app.js initializes Supabase asynchronously; wait without blocking the map UI.
  const wait = window.setInterval(() => {
    if (typeof db !== 'undefined' && db) {
      window.clearInterval(wait);
      start();
    }
  }, 300);
  window.setTimeout(() => window.clearInterval(wait), 30000);
  window.addEventListener('DOMContentLoaded', injectAdminTab, { once: true });
})();
