/* ============================================================
 * etf-dashboard 主入口
 * 1. 加载 ECharts (多 CDN 兜底)
 * 2. 打开页面时拉取两组基金最新数据 (多源 fallback)
 * 3. 渲染动态图表并更新指标卡; 失败时降级为静态图
 * 4. 选项卡切换: gv (成长/价值) 与 sd (中证500/红利)
 * ============================================================ */
(function () {
  'use strict';

  /* 两组基金配置 */
  const GROUPS = {
    gv: {
      tabId: 'tab-gv', panelId: 'panel-gv',
      etfA: { code: '159259', name: '成长ETF易方达', market: 0 },
      etfB: { code: '159263', name: '价值ETF易方达', market: 0 },
      labelA: '成长ETF (159259)', labelB: '价值ETF (159263)',
      colorA: '#e0522a', colorB: '#2563eb',
      startDate: '20250901',
      staticImgs: {
        'chart-gv-a-trend': 'assets/gv_a_trend.png',
        'chart-gv-b-trend': 'assets/gv_b_trend.png',
        'chart-gv-compare': 'assets/gv_compare_trend.png',
        'chart-gv-a-dd': 'assets/gv_a_drawdown.png',
        'chart-gv-b-dd': 'assets/gv_b_drawdown.png',
        'chart-gv-compare-dd': 'assets/gv_compare_drawdown.png',
        'chart-gv-rebal': 'assets/gv_rebalance_trend.png',
      },
    },
    sd: {
      tabId: 'tab-sd', panelId: 'panel-sd',
      etfA: { code: '510500', name: '中证500ETF南方', market: 1 },
      etfB: { code: '515080', name: '中证红利ETF招商', market: 1 },
      labelA: '中证500ETF (510500)', labelB: '中证红利ETF (515080)',
      colorA: '#059669', colorB: '#d97706',
      startDate: '20220101',
      staticImgs: {
        'chart-sd-a-trend': 'assets/sd_a_trend.png',
        'chart-sd-b-trend': 'assets/sd_b_trend.png',
        'chart-sd-compare': 'assets/sd_compare_trend.png',
        'chart-sd-a-dd': 'assets/sd_a_drawdown.png',
        'chart-sd-b-dd': 'assets/sd_b_drawdown.png',
        'chart-sd-compare-dd': 'assets/sd_compare_drawdown.png',
        'chart-sd-rebal': 'assets/sd_rebalance_trend.png',
      },
    },
  };

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
  function showStaticFallback(group) {
    Object.entries(group.staticImgs).forEach(([id, src]) => {
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
      banner.textContent = '⚠ 实时数据加载失败，当前显示静态缓存图（数据截至每日 16:00 更新）';
      banner.style.display = 'block';
    }
  }

  /* ---------- 计算单组指标 (扩展 computeStats 为通用版) ---------- */
  function computeGroupStats(rowsA, rowsB) {
    const closeA = rowsA.map((r) => r.close);
    const closeB = rowsB.map((r) => r.close);
    const ddA = calcDrawdown(closeA);
    const ddB = calcDrawdown(closeB);

    const retA = (closeA[closeA.length - 1] / closeA[0] - 1) * 100;
    const retB = (closeB[closeB.length - 1] / closeB[0] - 1) * 100;

    const minDDA = Math.min(...ddA);
    const minDDB = Math.min(...ddB);
    const minIdxA = ddA.indexOf(minDDA);
    const minIdxB = ddB.indexOf(minDDB);

    // 峰值日 (回撤起点)
    let peakIdxA = 0;
    for (let i = 0; i <= minIdxA; i++) if (closeA[i] >= closeA[peakIdxA]) peakIdxA = i;
    let peakIdxB = 0;
    for (let i = 0; i <= minIdxB; i++) if (closeB[i] >= closeB[peakIdxB]) peakIdxB = i;

    return {
      dates: rowsA.map((r) => r.date),
      closeA, closeB, ddA, ddB,
      normA: closeA.map((c) => (c / closeA[0]) * 100),
      normB: closeB.map((c) => (c / closeB[0]) * 100),
      maA: sma(closeA, 20), maB: sma(closeB, 20),
      retA, retB, minDDA, minDDB,
      minDDA_date: rowsA[minIdxA].date, minDDB_date: rowsB[minIdxB].date,
      peakA_date: rowsA[peakIdxA].date, peakB_date: rowsB[peakIdxB].date,
      highA: Math.max(...rowsA.map((r) => r.high)), lowA: Math.min(...rowsA.map((r) => r.low)),
      highB: Math.max(...rowsB.map((r) => r.high)), lowB: Math.min(...rowsB.map((r) => r.low)),
      lastA: closeA[closeA.length - 1], lastB: closeB[closeB.length - 1],
    };
  }

  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  /* ---------- 渲染单组 ---------- */
  async function renderGroup(groupKey) {
    const group = GROUPS[groupKey];
    try {
      const now = new Date();
      const endDate = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0');

      const [rowsA0, rowsB0] = await Promise.all([
        fetchEtfDaily(group.etfA, group.startDate, endDate),
        fetchEtfDaily(group.etfB, group.startDate, endDate),
      ]);
      if (rowsA0.length < 2 || rowsB0.length < 2) throw new Error('数据不足');

      // 对齐到共同交易日
      const mapA = new Map(rowsA0.map((r) => [r.date, r]));
      const mapB = new Map(rowsB0.map((r) => [r.date, r]));
      const commonDates = rowsA0.map((r) => r.date).filter((d) => mapB.has(d));
      const rowsA = commonDates.map((d) => mapA.get(d));
      const rowsB = commonDates.map((d) => mapB.get(d));

      const rebal = backtestRebalance(rowsA, rowsB, 10000, 10);
      const stats = computeGroupStats(rowsA, rowsB);
      const pfx = groupKey;

      // 隐藏静态降级图
      document.querySelectorAll('#' + group.panelId + ' .chart-card img').forEach((img) => img.remove());

      renderTrend(`chart-${pfx}-a-trend`, stats, group.colorA, `${group.labelA} 走势`, 'closeA', 'maA');
      renderTrend(`chart-${pfx}-b-trend`, stats, group.colorB, `${group.labelB} 走势`, 'closeB', 'maB');
      renderCompare(`chart-${pfx}-compare`, stats, group.colorA, group.colorB, group.labelA, group.labelB);
      renderDrawdown(`chart-${pfx}-a-dd`, stats, `${group.labelA} 最大回撤走势`, stats.minDDA, stats.minDDA_date, 'ddA');
      renderDrawdown(`chart-${pfx}-b-dd`, stats, `${group.labelB} 最大回撤走势`, stats.minDDB, stats.minDDB_date, 'ddB');
      renderCompareDD(`chart-${pfx}-compare-dd`, stats, group.colorA, group.colorB, group.labelA, group.labelB);
      renderRebalance(`chart-${pfx}-rebal`, rebal);
      updateStats(pfx, group, stats, rebal);

      return stats.dates[stats.dates.length - 1];
    } catch (e) {
      console.error(`[etf-dashboard] ${groupKey} 实时数据加载失败:`, e);
      showStaticFallback(group);
      return null;
    }
  }

  /* ---------- 选项卡切换 ---------- */
  function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('panel-' + btn.dataset.tab);
        panel.classList.add('active');
        // 面板从 display:none 变为可见后, 重算内部所有 ECharts 尺寸
        // (隐藏容器中初始化的图表宽度为 0, 必须 resize 才正常显示)
        requestAnimationFrame(() => {
          panel.querySelectorAll('.chart-box').forEach((el) => {
            const inst = echarts.getInstanceByDom(el);
            if (inst) inst.resize();
          });
        });
      });
    });
  }

  /* ---------- 主流程 ---------- */
  async function main() {
    setupTabs();
    const hasEcharts = await ensureECharts();
    if (!hasEcharts) {
      Object.values(GROUPS).forEach((g) => showStaticFallback(g));
      return;
    }

    // 并行渲染两组 (各自内部多源 fallback)
    const results = await Promise.all([
      renderGroup('gv'),
      renderGroup('sd'),
    ]);

    const ok = results.filter(Boolean);
    const banner = document.getElementById('live-banner');
    if (banner && ok.length > 0) {
      banner.textContent = '● 实时数据已更新至 ' + ok[0];
      banner.style.display = 'block';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
