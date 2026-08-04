/* ============================================================
 * etf-dashboard 主入口
 * 1. 加载 ECharts (多 CDN 兜底)
 * 2. 打开页面时拉取最新数据
 * 3. 渲染动态图表并更新指标卡; 失败时降级为静态图
 * ============================================================ */
(function () {
  'use strict';

  const START_DATE = '20250901';  // 起始 2025-09-01
  const STATIC_IMAGES = true;     // 保留静态图作为降级

  /* ---------- ECharts 加载 (多 CDN 兜底) ---------- */
  const ECHARTS_CDNS = [
    'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
    'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js',
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function ensureECharts() {
    if (window.echarts) return true;
    for (const cdn of ECHARTS_CDNS) {
      try { await loadScript(cdn); if (window.echarts) return true; } catch (e) { /* next */ }
    }
    return false;
  }

  /* ---------- 降级: 显示静态图 ---------- */
  function showStaticFallback() {
    const map = {
      'chart-g-trend': 'assets/growth_trend.png',
      'chart-v-trend': 'assets/value_trend.png',
      'chart-compare': 'assets/compare_trend.png',
      'chart-g-dd': 'assets/growth_drawdown.png',
      'chart-v-dd': 'assets/value_drawdown.png',
      'chart-compare-dd': 'assets/compare_drawdown.png',
      'chart-rebal': 'assets/rebalance_trend.png',
    };
    Object.entries(map).forEach(([id, src]) => {
      const el = document.getElementById(id);
      if (el && !el.querySelector('img')) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '静态图';
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.borderRadius = '10px';
        el.appendChild(img);
      }
    });
    const banner = document.getElementById('live-banner');
    if (banner) {
      banner.textContent = '⚠ 实时数据加载失败，当前显示静态缓存图（数据截至页面生成时）';
      banner.style.display = 'block';
    }
  }

  /* ---------- 主流程 ---------- */
  async function main() {
    const hasEcharts = await ensureECharts();
    if (!hasEcharts) { showStaticFallback(); return; }

    try {
      const now = new Date();
      const endDate = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');

      const [gData, vData] = await Promise.all([
        fetchEtfDaily(ETF_GROWTH, START_DATE, endDate),
        fetchEtfDaily(ETF_VALUE, START_DATE, endDate),
      ]);
      if (gData.rows.length < 2 || vData.rows.length < 2) throw new Error('数据不足');

      // 对齐到共同交易日
      const gMap = new Map(gData.rows.map((r) => [r.date, r]));
      const vMap = new Map(vData.rows.map((r) => [r.date, r]));
      const commonDates = gData.rows.map((r) => r.date).filter((d) => vMap.has(d));
      const gRows = commonDates.map((d) => gMap.get(d));
      const vRows = commonDates.map((d) => vMap.get(d));

      const rebal = backtestRebalance(gRows, vRows, 10000, 10);
      const stats = computeStats(gRows, vRows, rebal);

      // 隐藏静态降级图 (如果有)
      document.querySelectorAll('.chart-card img').forEach((img) => img.remove());

      renderTrend('chart-g-trend', stats, C.growth, '成长ETF (159259) 走势', 'gClose');
      renderTrend('chart-v-trend', stats, C.value, '价值ETF (159263) 走势', 'vClose');
      renderCompare('chart-compare', stats);
      renderDrawdown('chart-g-dd', stats, C.dd, '成长ETF (159259) 最大回撤走势', stats.gMinDD, stats.gMinDate);
      renderDrawdown('chart-v-dd', stats, C.dd, '价值ETF (159263) 最大回撤走势', stats.vMinDD, stats.vMinDate);
      renderCompareDD('chart-compare-dd', stats);
      renderRebalance('chart-rebal', rebal);
      updateStats(stats, rebal);

      const banner = document.getElementById('live-banner');
      if (banner) {
        banner.textContent = '● 实时数据已更新至 ' + stats.dates[stats.dates.length - 1];
        banner.style.display = 'block';
      }
    } catch (e) {
      console.error('[etf-dashboard] 实时数据加载失败:', e);
      showStaticFallback();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
