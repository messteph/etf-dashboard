/* ============================================================
 * etf-dashboard 图表渲染层
 * 使用 ECharts 在浏览器端动态绘制交互式图表 (支持双组: gv / sd)
 * 数据加载失败时页面自动降级为静态 PNG
 * ============================================================ */

/* ---------- 通用配置 ---------- */
const C = {
  bg: '#ffffff', grid: '#e8ecf1', txt: '#1e293b', sub: '#64748b',
  growth: '#e0522a', value: '#2563eb', dd: '#ef4444',
  port: '#7c3aed', bhold: '#94a3b8',
  green: '#059669', amber: '#d97706',
};

function baseGrid() {
  return { left: 56, right: 24, top: 40, bottom: 40, containLabel: false };
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
  return echarts.init(el);
}

/* ---------- 走势图 ---------- */
function renderTrend(elId, s, color, title, closeKey, maKey) {
  const chart = mkChart(elId);
  if (!chart) return;
  const dates = s.dates;
  chart.setOption({
    title: { text: title, left: 4, top: 2, textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(3) + ' 元') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(dates),
    yAxis: valAxis((v) => v.toFixed(2)),
    series: [
      { name: '收盘价', type: 'line', data: s[closeKey], smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: color }, itemStyle: { color: color },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: color + '26' }, { offset: 1, color: color + '05' }] } } },
      { name: 'MA20', type: 'line', data: s[maKey], smooth: true, showSymbol: false,
        lineStyle: { width: 1.1, type: 'dashed', color: color, opacity: 0.55 }, itemStyle: { color: color } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 双基金对比走势 (原始净值) ---------- */
function renderCompare(elId, s, colorA, colorB, labelA, labelB) {
  const chart = mkChart(elId);
  if (!chart) return;
  chart.setOption({
    title: { text: labelA + ' vs ' + labelB + ' 走势对比（原始净值）', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(3) + ' 元') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(s.dates),
    yAxis: valAxis((v) => v.toFixed(2)),
    series: [
      { name: labelA, type: 'line', data: s.closeA, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: colorA }, itemStyle: { color: colorA } },
      { name: labelB, type: 'line', data: s.closeB, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: colorB }, itemStyle: { color: colorB } },
    ],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 单基金最大回撤图 ---------- */
function renderDrawdown(elId, s, title, minDD, minDate, ddKey) {
  const chart = mkChart(elId);
  if (!chart) return;
  const ddData = s[ddKey];
  const dates = s.dates;
  chart.setOption({
    title: { text: title + ' — 最大回撤 ' + minDD.toFixed(2) + '%', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2) + '%') }),
    grid: baseGrid(),
    xAxis: dateAxis(dates),
    yAxis: valAxis((v) => v + '%'),
    series: [{
      name: '回撤', type: 'line', data: ddData, smooth: true, showSymbol: false,
      lineStyle: { width: 1.8, color: C.dd }, itemStyle: { color: C.dd },
      areaStyle: { color: C.dd + '33' }, markPoint: {
        data: [{ coord: [minDate, minDD], value: minDD.toFixed(2) + '%',
          symbol: 'pin', symbolSize: 42, label: { fontSize: 10, color: '#fff' },
          itemStyle: { color: '#dc2626' } }],
      },
    }],
  });
  window.addEventListener('resize', () => chart.resize());
  return chart;
}

/* ---------- 双基金回撤对比 ---------- */
function renderCompareDD(elId, s, colorA, colorB, labelA, labelB) {
  const chart = mkChart(elId);
  if (!chart) return;
  chart.setOption({
    title: { text: labelA + ' vs ' + labelB + ' 最大回撤对比', left: 4, top: 2,
      textStyle: { fontSize: 14, fontWeight: 'bold', color: C.txt } },
    tooltip: baseTooltip({ valueFormatter: (v) => (v == null ? '-' : v.toFixed(2) + '%') }),
    legend: { right: 8, top: 6, textStyle: { color: C.sub, fontSize: 11 } },
    grid: baseGrid(),
    xAxis: dateAxis(s.dates),
    yAxis: valAxis((v) => v + '%'),
    series: [
      { name: labelA + ' 回撤', type: 'line', data: s.ddA, smooth: true, showSymbol: false,
        lineStyle: { width: 1.8, color: colorA }, itemStyle: { color: colorA }, areaStyle: { color: colorA + '1f' } },
      { name: labelB + ' 回撤', type: 'line', data: s.ddB, smooth: true, showSymbol: false,
        lineStyle: { width: 1.8, color: colorB }, itemStyle: { color: colorB }, areaStyle: { color: colorB + '1f' } },
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
    title: { text: '50/50 再平衡策略 — 合计收益率（初始各 10,000 元）', left: 4, top: 2,
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

/* ---------- 指标表更新 ---------- */
function updateStats(pfx, cfg, s, r) {
  const fmt = (v, d = 2) => v.toFixed(d) + '%';
  // 区间涨幅 (正值红 / 负值绿)
  setVal(pfx + '_tbl_a_ret', s.retA, fmt);
  setVal(pfx + '_tbl_b_ret', s.retB, fmt);
  setVal(pfx + '_tbl_p_ret', r.finalPort, fmt);
  setVal(pfx + '_tbl_bh_ret', r.finalBH, fmt);
  // 年化收益率
  setVal(pfx + '_tbl_a_ann', s.annA, fmt);
  setVal(pfx + '_tbl_b_ann', s.annB, fmt);
  setVal(pfx + '_tbl_p_ann', r.annPort, fmt);
  setVal(pfx + '_tbl_bh_ann', r.annBH, fmt);
  // 最大回撤 (均为负值 -> 绿色)
  setVal(pfx + '_tbl_a_dd', s.minDDA, fmt);
  setVal(pfx + '_tbl_b_dd', s.minDDB, fmt);
  setVal(pfx + '_tbl_p_dd', r.maxDD, fmt);
  setVal(pfx + '_tbl_bh_dd', r.maxDDBH, fmt);
  // 回撤发生日 (中性)
  setText(pfx + '_tbl_a_dd_date', s.minDDA_date);
  setText(pfx + '_tbl_b_dd_date', s.minDDB_date);
  setText(pfx + '_tbl_p_dd_date', r.maxDDDate);
  setText(pfx + '_tbl_bh_dd_date', r.maxDDBHDate);

  setText(pfx + '_cap_a', `${cfg.labelA}（${cfg.codeA}）· 区间最高 ${s.highA.toFixed(3)} / 最低 ${s.lowA.toFixed(3)} · 最新收盘 ${s.lastA.toFixed(3)}`);
  setText(pfx + '_cap_b', `${cfg.labelB}（${cfg.codeB}）· 区间最高 ${s.highB.toFixed(3)} / 最低 ${s.lowB.toFixed(3)} · 最新收盘 ${s.lastB.toFixed(3)}`);
  setText(pfx + '_cap_rebal',
    `回测结果：再平衡组合 ${(r.finalPort >= 0 ? '+' : '') + fmt(r.finalPort)}（${r.portValue[r.portValue.length - 1].toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元），` +
    `买入持有 ${(r.finalBH >= 0 ? '+' : '') + fmt(r.finalBH)}，超额 ${(r.finalPort - r.finalBH >= 0 ? '+' : '') + fmt(r.finalPort - r.finalBH)} 个百分点；` +
    `组合最大回撤 ${fmt(r.maxDD)}，介于 ${cfg.labelA}（${fmt(s.minDDA)}）与 ${cfg.labelB}（${fmt(s.minDDB)}）之间。`);
  setText(pfx + '_range', `数据区间：${s.dates[0]} ~ ${s.dates[s.dates.length - 1]}（${s.dates.length} 个交易日）`);
}

/** 设置单元格文本并按正负着色: 正值红 / 负值绿 */
function setVal(id, value, fmt) {
  const el = document.getElementById(id);
  if (!el) return;
  const sign = value >= 0 ? '+' : '';
  el.textContent = sign + fmt(Math.abs(value));
  el.className = 'val ' + (value >= 0 ? 'up' : 'down');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
