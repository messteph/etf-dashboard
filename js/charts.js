/* ============================================================
 * etf-dashboard 图表渲染层
 * 使用 ECharts 在浏览器端动态绘制交互式图表
 * 数据加载失败时页面自动降级为静态 PNG
 * ============================================================ */

/* ---------- 通用配置 ---------- */
const C = {
  bg: '#ffffff', grid: '#e8ecf1', txt: '#1e293b', sub: '#64748b',
  growth: '#e0522a', value: '#2563eb', dd: '#ef4444',
  port: '#7c3aed', bhold: '#94a3b8',
};

function baseGrid() {
  return { left: 56, right: 24, top: 36, bottom: 40, containLabel: false };
}
function baseTooltip(extra) {
  return Object.assign({ trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)',
    borderColor: '#e2e8f0', textStyle: { color: C.txt, fontSize: 12 },
    axisPointer: { type: 'cross', lineStyle: { color: '#cbd5e1' } } }, extra || {});
}
function dateAxis(dates) {
  return { type: 'category', data: dates || [], axisLine: { lineStyle: { color: C.grid } },
    axisLabel: { color: C.sub, fontSize: 10 }, axisTick: { show: false } };
}
function valAxis(formatter) {
  return { type: 'value', scale: true, splitLine: { lineStyle: { color: C.grid } },
    axisLabel: { color: C.sub, fontSize: 10, formatter: formatter || '{value}' } };
}
function mkChart(elId) {
  const el = document.getElementById(elId);
  if (!el) return null;
  const chart = echarts.init(el);
  return chart;
}

/* ---------- 走势图 ---------- */
function renderTrend(elId, s, color, title, closeKey) {
  const chart = mkChart(elId);
  if (!chart) return;
  const dates = s.dates;
  const closes = s[closeKey];
  const ma = s[closeKey === 'gClose' ? 'gMA20' : 'vMA20'];
  chart.setOption({
    title: { text: title, left: 4, top: 2, textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(3) + ' 元') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(dates),
    yAxis: valAxis((v) => v.toFixed(2)),
    series: [
      { name: '收盘价', type: 'line', data: closes, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: color }, itemStyle: { color: color },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: color + '26' }, { offset: 1, color: color + '05' }] } } },
      { name: 'MA20', type: 'line', data: ma, smooth: true, showSymbol: false,
        lineStyle: { width: 1.1, type: 'dashed', color: color, opacity: 0.55 }, itemStyle: { color: color } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 双基金归一化对比 ---------- */
function renderCompare(elId, s) {
  const chart = mkChart(elId);
  if (!chart) return;
  chart.setOption({
    title: { text: '成长 vs 价值 ETF 走势对比（起点归一化 = 100）', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2)) }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(s.dates),
    yAxis: valAxis((v) => v.toFixed(0)),
    series: [
      { name: '成长ETF (159259)', type: 'line', data: s.gNorm, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: C.growth }, itemStyle: { color: C.growth } },
      { name: '价值ETF (159263)', type: 'line', data: s.vNorm, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: C.value }, itemStyle: { color: C.value } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 最大回撤图 ---------- */
function renderDrawdown(elId, s, color, title, minDD, minDate, ddKey) {
  const chart = mkChart(elId);
  if (!chart) return;
  const ddData = s[ddKey];
  const dates = s.dates;
  const series = [
    { name: '回撤', type: 'line', data: ddData, smooth: true, showSymbol: false,
      lineStyle: { width: 1.8, color: color }, itemStyle: { color: color },
      areaStyle: { color: color + '33' }, markPoint: {
        data: [{ coord: [minDate, minDD], value: minDD.toFixed(2) + '%',
          symbol: 'pin', symbolSize: 42, label: { fontSize: 10, color: '#fff' },
          itemStyle: { color: '#dc2626' } }],
      } },
  ];
  chart.setOption({
    title: { text: title + ' — 最大回撤 ' + minDD.toFixed(2) + '%', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2) + '%') }),
    grid: baseGrid(),
    xAxis: dateAxis(dates),
    yAxis: valAxis((v) => v + '%'),
    series: series,
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 双基金回撤对比 ---------- */
function renderCompareDD(elId, s) {
  const chart = mkChart(elId);
  if (!chart) return;
  chart.setOption({
    title: { text: '成长 vs 价值 ETF 最大回撤对比', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2) + '%') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(s.dates),
    yAxis: valAxis((v) => v + '%'),
    series: [
      { name: '成长ETF 回撤', type: 'line', data: s.gDD, smooth: true, showSymbol: false,
        lineStyle: { width: 1.8, color: C.growth }, itemStyle: { color: C.growth }, areaStyle: { color: C.growth + '1f' } },
      { name: '价值ETF 回撤', type: 'line', data: s.vDD, smooth: true, showSymbol: false,
        lineStyle: { width: 1.8, color: C.value }, itemStyle: { color: C.value }, areaStyle: { color: C.value + '1f' } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 再平衡策略 ---------- */
function renderRebalance(elId, r) {
  const chart = mkChart(elId);
  if (!chart) return;
  const markLine = {
    symbol: 'none', silent: true, lineStyle: { color: C.port, width: 1, opacity: 0.3 },
    data: r.rebalIdx.map((i) => ({ xAxis: r.dates[i] })),
  };
  chart.setOption({
    title: { text: '成长+价值 ETF 50/50 再平衡策略 — 合计收益率（初始各 10,000 元）', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2) + '%') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(r.dates),
    yAxis: valAxis((v) => v + '%'),
    series: [
      { name: '50/50 定期再平衡', type: 'line', data: r.portRet, smooth: true, showSymbol: false,
        lineStyle: { width: 2.4, color: C.port }, itemStyle: { color: C.port },
        areaStyle: { color: C.port + '14' }, markLine: markLine,
        markPoint: { data: [{ coord: [r.maxDDDate, r.maxDD], value: r.maxDD.toFixed(2) + '%',
          symbol: 'pin', symbolSize: 42, label: { fontSize: 10, color: '#fff' }, itemStyle: { color: '#dc2626' } }] } },
      { name: '买入持有（不操作）', type: 'line', data: r.bhRet, smooth: true, showSymbol: false,
        lineStyle: { width: 1.6, type: 'dashed', color: C.bhold }, itemStyle: { color: C.bhold } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 指标卡更新 ---------- */
function updateStats(s, r) {
  const fmt = (v, d = 2) => v.toFixed(d) + '%';
  setText('stat_g_ret', (s.gRet >= 0 ? '+' : '') + fmt(s.gRet));
  setText('stat_v_ret', (s.vRet >= 0 ? '+' : '') + fmt(s.vRet));
  setText('stat_g_dd', fmt(s.gMinDD));
  setText('stat_v_dd', fmt(s.vMinDD));
  setText('stat_g_dd_note', '发生于 ' + s.gMinDate + '');
  setText('stat_v_dd_note', '发生于 ' + s.vMinDate + '');
  setText('stat_p_ret', (r.finalPort >= 0 ? '+' : '') + fmt(r.finalPort));
  setText('stat_p_dd', fmt(r.maxDD));
  setText('stat_p_ret_note', '超额 ' + ((r.finalPort - r.finalBH) >= 0 ? '+' : '') + fmt(r.finalPort - r.finalBH) + ' vs 买入持有');
  setText('stat_p_dd_note', '显著低于纯成长 ETF');

  // 图注
  setText('cap_g', `成长ETF（159259）· 区间最高 ${s.gHigh.toFixed(3)} / 最低 ${s.gLow.toFixed(3)} · 最新收盘 ${s.gLast.toFixed(3)}`);
  setText('cap_v', `价值ETF（159263）· 区间最高 ${s.vHigh.toFixed(3)} / 最低 ${s.vLow.toFixed(3)} · 最新收盘 ${s.vLast.toFixed(3)}`);
  setText('cap_rebal', `回测结果：再平衡组合 ${(r.finalPort >= 0 ? '+' : '') + fmt(r.finalPort)}（${r.portValue[r.portValue.length - 1].toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元），买入持有 ${(r.finalBH >= 0 ? '+' : '') + fmt(r.finalBH)}，超额 ${(r.finalPort - r.finalBH >= 0 ? '+' : '') + fmt(r.finalPort - r.finalBH)} 个百分点；组合最大回撤 ${fmt(r.maxDD)}。`);
  setText('data_range', `数据区间：${s.dates[0]} ~ ${s.dates[s.dates.length - 1]}（${s.dates.length} 个交易日）· 打开页面时实时更新`);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
