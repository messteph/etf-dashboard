/* ============================================================
 * 宽基指数对比页 (indices.html)
 * 四指数: 沪深300(000300) / 中证500(000905) / 中证A500(000510) / 中证1000(000852)
 * 功能: 2022-01-01 起走势归一化对比 / ECharts dataZoom 缩放 /
 *       缩放范围变化时表格区间收益与年化收益实时更新
 * ============================================================ */
(function () {
  'use strict';

  const START_DATE = '20220101';

  const INDICES = [
    { code: '000300', name: '沪深300', color: '#e0522a' },
    { code: '000905', name: '中证500', color: '#2563eb' },
    { code: '000510', name: '中证A500', color: '#059669' },
    { code: '000852', name: '中证1000', color: '#d97706' },
  ];

  /* ---------- 指数数据源 (基于 data.js 的多源框架, 指数用 sh 前缀 + 分段) ---------- */

  /** 东财指数 K 线 (JSONP, 支持 2022 起回溯) */
  function fetchIdxEastmoney(idx, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const cb = 'idx_cb_' + Math.random().toString(36).slice(2, 10);
      const params = new URLSearchParams({
        secid: `1.${idx.code}`,
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57',
        klt: '101', fqt: '1', beg: startDate, end: endDate,
        ut: '7eea3edcaed734bea9cbfc24409ed989', cb: cb,
      });
      const script = document.createElement('script');
      const timeoutId = setTimeout(() => {
        window[cb] = undefined; script.remove();
        reject(new Error(idx.name + '东财超时'));
      }, 15000);
      window[cb] = (json) => {
        clearTimeout(timeoutId);
        window[cb] = undefined; script.remove();
        if (!json || !json.data || !json.data.klines) { reject(new Error(idx.name + '东财为空')); return; }
        try {
          const rows = json.data.klines.map((k) => {
            const p = k.split(',');
            return { date: p[0], close: +p[2] };
          });
          resolve(rows);
        } catch (e) { reject(new Error('东财解析失败')); }
      };
      script.src = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?' + params.toString();
      document.head.appendChild(script);
    });
  }

  /** 腾讯指数 K 线 (fetch + CORS, 分段拉取; A500 仅 2024-09 起) */
  async function fetchIdxTencent(idx, startDate, endDate) {
    const fmtD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const sy = +startDate.slice(0, 4), sm = +startDate.slice(4, 6), sd = +startDate.slice(6, 8);
    const ey = +endDate.slice(0, 4), em = +endDate.slice(4, 6), ed = +endDate.slice(6, 8);
    const segs = [];
    let cur = new Date(sy, sm - 1, sd);
    const endD = new Date(ey, em - 1, ed);
    while (cur <= endD) {
      const nxt = new Date(cur.getTime() + 180 * 86400000);
      const e2 = nxt > endD ? endD : nxt;
      segs.push([fmtD(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()),
                 fmtD(e2.getFullYear(), e2.getMonth() + 1, e2.getDate())]);
      cur = new Date(e2.getTime() + 86400000);
    }
    const seen = new Set();
    const merged = [];
    for (const [ss, se] of segs) {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh${idx.code},day,${ss},${se},800,qfq`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      let resp;
      try { resp = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }); }
      finally { clearTimeout(t); }
      if (!resp.ok) throw new Error('腾讯 HTTP ' + resp.status);
      const json = await resp.json();
      const node = json && json.data;
      if (!node || typeof node !== 'object') throw new Error('腾讯数据为空');
      const sub = node['sh' + idx.code] || {};
      const rows = sub.day || sub.qfqday || [];
      for (const r of rows) {
        const p = typeof r === 'string' ? r.split(',') : r;
        if (!seen.has(p[0])) { seen.add(p[0]); merged.push(p); }
      }
    }
    if (!merged.length) throw new Error('腾讯 kline 为空');
    return merged.map((p) => ({ date: p[0], close: +p[2] })).sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /** 指数多源拉取: 东财(完整回溯) -> 腾讯(兜底) */
  async function fetchIndexData(idx, startDate, endDate) {
    const sources = [
      { name: '东方财富', fn: () => fetchIdxEastmoney(idx, startDate, endDate) },
      { name: '腾讯', fn: () => fetchIdxTencent(idx, startDate, endDate) },
    ];
    let lastErr = null;
    for (const s of sources) {
      try {
        const rows = await s.fn();
        if (rows.length >= 2) {
          console.log(`[indices] ${idx.name} 数据源=${s.name} ${rows.length} rows ${rows[0].date} ~ ${rows[rows.length - 1].date}`);
          return rows;
        }
        lastErr = new Error(`${s.name} 数据不足`);
      } catch (e) { lastErr = e; console.warn(`[indices] ${idx.name} ${s.name} 失败: ${e.message}`); }
    }
    throw lastErr;
  }

  /* ---------- 图表与表格 ---------- */

  let chart = null;
  let allDates = [];
  let seriesCache = {};   // code -> close 数组 (与 allDates 对齐)
  let zoomStartIdx = 0, zoomEndIdx = 0;

  function fmtPct(v, sign = true) {
    const s = sign && v > 0 ? '+' : '';
    return s + v.toFixed(2) + '%';
  }

  function fmtPoint(v) {
    return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** 根据当前 zoom 范围更新表格 */
  function updateTable() {
    const sIdx = zoomStartIdx, eIdx = zoomEndIdx;
    const startDate = allDates[sIdx];
    const endDate = allDates[eIdx];
    const tbody = document.getElementById('stats-body');
    let html = '';
    INDICES.forEach((idx) => {
      const closes = seriesCache[idx.code];
      // 找到范围内第一个有数据的索引 (A500 可能从 2024 才有)
      let first = -1;
      for (let i = sIdx; i <= eIdx; i++) {
        if (closes[i] != null) { first = i; break; }
      }
      if (first < 0) {
        html += `<tr><td>${idx.name}<br><span class="sub" style="color:var(--sub)">${idx.code}</span></td>
                 <td colspan="7" style="color:var(--sub)">范围内无数据</td></tr>`;
        return;
      }
      const c0 = closes[first];
      const c1 = closes[eIdx];
      const ret = (c1 / c0 - 1) * 100;
      const days = eIdx - first;               // 交易日数
      const ann = ((c1 / c0) ** (252 / days) - 1) * 100;

      // 最大回撤
      let peak = -Infinity, maxDD = 0;
      for (let i = first; i <= eIdx; i++) {
        const c = closes[i];
        if (c == null) continue;
        if (c > peak) peak = c;
        const dd = (c / peak - 1) * 100;
        if (dd < maxDD) maxDD = dd;
      }

      // 年化波动率 (日收益标准差 * sqrt(252))
      const rets = [];
      for (let i = first + 1; i <= eIdx; i++) {
        if (closes[i - 1] != null && closes[i] != null) {
          rets.push(closes[i] / closes[i - 1] - 1);
        }
      }
      let annVol = 0;
      if (rets.length > 1) {
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
        annVol = Math.sqrt(variance) * Math.sqrt(252) * 100;
      }

      // 夏普比率 = (年化收益 - 无风险利率) / 年化波动率 (无风险利率按 2%)
      const RF = 2.0;
      const sharpe = annVol > 0 ? (ann - RF) / annVol : 0;

      const cls = ret >= 0 ? 'up' : 'down';
      const clsDD = maxDD <= 0 ? 'down' : 'up';
      html += `<tr>
        <td>${idx.name}<br><span class="sub" style="color:var(--sub)">${idx.code}</span></td>
        <td class="val ${cls}">${fmtPct(ret)}</td>
        <td class="val ${cls}">${fmtPct(ann)}</td>
        <td class="val ${clsDD}">${fmtPct(maxDD, false)}</td>
        <td class="val">${annVol.toFixed(2)}%</td>
        <td class="val">${sharpe.toFixed(2)}</td>
        <td>${fmtPoint(c0)}</td>
        <td>${fmtPoint(c1)}</td>
      </tr>`;
    });
    tbody.innerHTML = html;
    document.getElementById('range-note').textContent =
      `统计区间：${startDate} ~ ${endDate}（${eIdx - sIdx + 1} 个交易日）· 年化波动率按 252 交易日计算 · 夏普比率无风险利率按 2%`;
  }

  function renderChart() {
    const legend = document.getElementById('legend');
    legend.innerHTML = INDICES.map((i) =>
      `<span><i style="background:${i.color}"></i>${i.name}（${i.code}）</span>`).join('');

    const series = INDICES.map((idx) => {
      const closes = seriesCache[idx.code];
      // 直接使用原始指数点位
      const data = closes.map((c) => (c == null ? null : +c.toFixed(2)));
      return {
        name: `${idx.name} (${idx.code})`,
        type: 'line', data, smooth: true, showSymbol: false,
        lineStyle: { width: 2.2, color: idx.color },
        itemStyle: { color: idx.color },
        connectNulls: false,
      };
    });

    chart = echarts.init(document.getElementById('chart'));
    chart.setOption({
      title: {
        text: '宽基指数走势对比（原始点位）',
        left: 4, top: 2, textStyle: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#e2e8f0',
        textStyle: { color: '#1e293b', fontSize: 12 },
        axisPointer: { type: 'cross' },
        valueFormatter: (v) => (v == null ? '-' : v.toFixed(2)),
      },
      legend: { right: 8, top: 8, textStyle: { color: '#64748b', fontSize: 11 } },
      grid: { left: 60, right: 24, top: 48, bottom: 70 },
      xAxis: {
        type: 'category', data: allDates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', start: 0, end: 100, bottom: 10, height: 22,
          borderColor: '#e2e8f0', fillerColor: 'rgba(59,130,246,0.12)',
          handleStyle: { color: '#3b82f6' }, textStyle: { color: '#64748b', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#eef2f7' } } },
      ],
      series: series,
    });

    // dataZoom 变化 -> 更新表格
    chart.on('datazoom', () => {
      const opt = chart.getOption();
      const dz = opt.dataZoom[0];
      const start = dz.start != null ? dz.start : 0;
      const end = dz.end != null ? dz.end : 100;
      zoomStartIdx = Math.round(start / 100 * (allDates.length - 1));
      zoomEndIdx = Math.round(end / 100 * (allDates.length - 1));
      updateTable();
    });

    window.addEventListener('resize', () => chart && chart.resize());
  }

  /* ---------- 双指数相对走势图 (归一化相对强弱, 起点=100) ---------- */
  let relChart = null;
  let relZoomStart = 0, relZoomEnd = 0;

  function initRelPicker() {
    const selA = document.getElementById('rel-a');
    const selB = document.getElementById('rel-b');
    INDICES.forEach((idx) => {
      const o1 = document.createElement('option');
      o1.value = idx.code; o1.textContent = `${idx.name} (${idx.code})`;
      selA.appendChild(o1);
      const o2 = document.createElement('option');
      o2.value = idx.code; o2.textContent = `${idx.name} (${idx.code})`;
      selB.appendChild(o2);
    });
    selA.value = '000300';   // 默认沪深300
    selB.value = '000905';   // 默认中证500
    selA.addEventListener('change', () => { relZoomStart = 0; relZoomEnd = allDates.length - 1; renderRelChart(); });
    selB.addEventListener('change', () => { relZoomStart = 0; relZoomEnd = allDates.length - 1; renderRelChart(); });
  }

  /** 归一化相对强弱: RS = (A/A0) / (B/B0) * 100 */
  function renderRelChart() {
    const codeA = document.getElementById('rel-a').value;
    const codeB = document.getElementById('rel-b').value;
    const idxA = INDICES.find((i) => i.code === codeA);
    const idxB = INDICES.find((i) => i.code === codeB);
    const closesA = seriesCache[codeA];
    const closesB = seriesCache[codeB];

    // 起点: 两者都有数据的第一个交易日
    let base = -1;
    for (let i = 0; i < allDates.length; i++) {
      if (closesA[i] != null && closesB[i] != null) { base = i; break; }
    }
    if (base < 0) return;
    const a0 = closesA[base], b0 = closesB[base];

    const rs = allDates.map((_, i) => {
      if (closesA[i] == null || closesB[i] == null) return null;
      return +(((closesA[i] / a0) / (closesB[i] / b0)) * 100).toFixed(2);
    });

    if (!relChart) relChart = echarts.init(document.getElementById('chart-rel'));
    relChart.setOption({
      title: {
        text: `${idxA.name} vs ${idxB.name} 相对走势（归一化相对强弱，起点 = 100）`,
        left: 4, top: 2, textStyle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b' },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#e2e8f0',
        textStyle: { color: '#1e293b', fontSize: 12 }, axisPointer: { type: 'cross' },
        formatter: (params) => {
          const p = params[0];
          if (!p || p.value == null) return '';
          const over = p.value - 100;
          const dir = over >= 0 ? '走强' : '走弱';
          return `${p.axisValue}<br><b style="color:#7c3aed">RS ${p.value.toFixed(2)}</b><br>相对基准 ${over >= 0 ? '+' : ''}${over.toFixed(2)}（${idxA.name} ${dir}）`;
        },
      },
      grid: { left: 60, right: 24, top: 44, bottom: 70 },
      xAxis: {
        type: 'category', data: allDates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (v) => v.toFixed(0) },
      },
      dataZoom: [
        { type: 'inside', start: relZoomStart, end: relZoomEnd, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', start: relZoomStart, end: relZoomEnd, bottom: 10, height: 22,
          borderColor: '#e2e8f0', fillerColor: 'rgba(124,58,237,0.12)',
          handleStyle: { color: '#7c3aed' }, textStyle: { color: '#64748b', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#eef2f7' } } },
      ],
      series: [{
        name: `${idxA.name}/${idxB.name} RS`,
        type: 'line', data: rs, smooth: true, showSymbol: false, connectNulls: false,
        lineStyle: { width: 2.4, color: '#7c3aed' }, itemStyle: { color: '#7c3aed' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(124,58,237,0.25)' }, { offset: 1, color: 'rgba(124,58,237,0.02)' }] },
        },
        markLine: {
          silent: true, symbol: 'none',
          lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
          data: [{ yAxis: 100, label: { formatter: '基准 100', color: '#94a3b8', fontSize: 10, position: 'insideEndTop' } }],
        },
        markPoint: {
          data: [{
            coord: [allDates[allDates.length - 1], rs[rs.length - 1]],
            value: rs[rs.length - 1].toFixed(1),
            symbol: 'pin', symbolSize: 40, label: { fontSize: 9, color: '#fff' },
            itemStyle: { color: '#7c3aed' },
          }],
        },
      }],
    });

    // 同步缩放状态
    relChart.on('datazoom', () => {
      const dz = relChart.getOption().dataZoom[0];
      relZoomStart = dz.start != null ? dz.start : 0;
      relZoomEnd = dz.end != null ? dz.end : 100;
    });
    window.addEventListener('resize', () => relChart && relChart.resize());
  }

  /* ---------- 主流程 ---------- */

  async function main() {
    // 加载 ECharts (CDN 兜底)
    const CDNS = [
      'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js',
      'https://unpkg.com/echarts@5.5.1/dist/echarts.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.1/echarts.min.js',
    ];
    if (!window.echarts) {
      for (const cdn of CDNS) {
        try {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = cdn; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('cdn')); };
            document.head.appendChild(s);
          });
          if (window.echarts) break;
        } catch (e) { /* next */ }
      }
    }
    if (!window.echarts) {
      document.getElementById('stats-body').innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#dc2626">图表库加载失败</td></tr>';
      return;
    }

    try {
      const now = new Date();
      const endDate = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');

      // 并行拉取四个指数
      const results = await Promise.allSettled(
        INDICES.map((idx) => fetchIndexData(idx, START_DATE, endDate))
      );

      // 构建共同日期轴 (取所有指数日期的并集, 排序)
      const dateSet = new Set();
      const rawByCode = {};
      INDICES.forEach((idx, i) => {
        rawByCode[idx.code] = results[i].status === 'fulfilled' ? results[i].value : null;
        if (rawByCode[idx.code]) rawByCode[idx.code].forEach((r) => dateSet.add(r.date));
      });
      allDates = Array.from(dateSet).sort();

      // 填充每个指数的 close 序列
      INDICES.forEach((idx) => {
        const raw = rawByCode[idx.code];
        const map = new Map(raw ? raw.map((r) => [r.date, r.close]) : []);
        seriesCache[idx.code] = allDates.map((d) => map.get(d) ?? null);
      });

      const banner = document.getElementById('live-banner');
      const lastDate = allDates[allDates.length - 1];
      if (banner) {
        banner.textContent = '● 实时数据已更新至 ' + lastDate;
        banner.style.display = 'block';
      }

      zoomStartIdx = 0;
      zoomEndIdx = allDates.length - 1;
      renderChart();
      updateTable();
      initRelPicker();
      renderRelChart();
    } catch (e) {
      console.error('[indices] 加载失败:', e);
      document.getElementById('stats-body').innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#dc2626">数据加载失败，请刷新重试</td></tr>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
