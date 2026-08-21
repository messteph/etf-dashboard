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
    { code: '000300', name: '沪深300', color: '#1d4ed8' },
    { code: '000905', name: '中证500', color: '#0ea5e9' },
    { code: '000510', name: '中证A500', color: '#059669' },
    { code: '000852', name: '中证1000', color: '#d97706' },
    { code: '000922', name: '中证红利', color: '#dc2626' },
    { code: '399006', name: '创业板指', color: '#7c3aed' },
  ];

  /* 指数市场: 000xxx = 上证(东财 market 1 / 腾讯 sh), 399xxx = 深证(东财 market 0 / 腾讯 sz) */
  function idxMarket(code) {
    return code.startsWith('399') ? 0 : 1;
  }
  function idxPrefix(code) {
    return code.startsWith('399') ? 'sz' : 'sh';
  }

  /* ---------- 指数数据源 (基于 data.js 的多源框架, 指数用 sh 前缀 + 分段) ---------- */

  /** 东财指数 K 线 (JSONP, 支持 2022 起回溯) */
  function fetchIdxEastmoney(idx, startDate, endDate) {
    return new Promise((resolve, reject) => {
      const cb = 'idx_cb_' + Math.random().toString(36).slice(2, 10);
      const params = new URLSearchParams({
        secid: `${idxMarket(idx.code)}.${idx.code}`,
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
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${idxPrefix(idx.code)}${idx.code},day,${ss},${se},800,qfq`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      let resp;
      try { resp = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } }); }
      finally { clearTimeout(t); }
      if (!resp.ok) throw new Error('腾讯 HTTP ' + resp.status);
      const json = await resp.json();
      const node = json && json.data;
      if (!node || typeof node !== 'object') throw new Error('腾讯数据为空');
      const sub = node[idxPrefix(idx.code) + idx.code] || {};
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
        text: '指数走势对比（原始点位）',
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
      grid: { left: 60, right: 24, top: 78, bottom: 70 },
      xAxis: {
        type: 'category', data: allDates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true, interval: 1000,
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

  /* ---------- 归一化走势图 (起始日 = 100, 线性坐标) ---------- */
  let normChart = null;
  let normZoomStart = 0, normZoomEnd = 100;

  function renderNormChart() {
    const legend = document.getElementById('legend-norm');
    legend.innerHTML = INDICES.map((i) =>
      `<span><i style="background:${i.color}"></i>${i.name}（${i.code}）</span>`).join('');

    const series = INDICES.map((idx) => {
      const closes = seriesCache[idx.code];
      // 找到该指数首个可用交易日作为归一化基准, 通常做法: 起始日 = 100
      let base = null;
      let data = closes.map((c) => {
        if (c == null) return null;
        if (base == null) base = c;
        return +(c / base * 100).toFixed(2);
      });
      return {
        name: `${idx.name} (${idx.code})`,
        type: 'line', data, smooth: true, showSymbol: false, connectNulls: false,
        lineStyle: { width: 2.2, color: idx.color },
        itemStyle: { color: idx.color },
      };
    });

    if (!normChart) normChart = echarts.init(document.getElementById('chart-norm'));
    normChart.setOption({
      title: {
        text: '指数归一化走势（起始日 = 100）',
        left: 4, top: 2, textStyle: { fontSize: 15, fontWeight: 'bold', color: '#1e293b' },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#e2e8f0',
        textStyle: { color: '#1e293b', fontSize: 12 }, axisPointer: { type: 'cross' },
        valueFormatter: (v) => (v == null ? '-' : v.toFixed(1)),
      },
      legend: { right: 8, top: 8, textStyle: { color: '#64748b', fontSize: 11 } },
      grid: { left: 60, right: 24, top: 78, bottom: 70 },
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
        { type: 'inside', start: normZoomStart, end: normZoomEnd, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', start: normZoomStart, end: normZoomEnd, bottom: 10, height: 22,
          borderColor: '#e2e8f0', fillerColor: 'rgba(59,130,246,0.12)',
          handleStyle: { color: '#3b82f6' }, textStyle: { color: '#64748b', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#eef2f7' } } },
      ],
      series: series,
    });

    normChart.on('datazoom', () => {
      const dz = normChart.getOption().dataZoom[0];
      normZoomStart = dz.start != null ? dz.start : 0;
      normZoomEnd = dz.end != null ? dz.end : 100;
    });
    window.addEventListener('resize', () => normChart && normChart.resize());
  }

  /* ---------- 双指数相对走势图 (归一化相对强弱, 起点=100) ---------- */
  let relChart = null;
  let relZoomStart = 0, relZoomEnd = 100;   // 默认显示完整范围 (百分比)

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
    selA.addEventListener('change', () => { relZoomStart = 0; relZoomEnd = 100; renderRelChart(); });
    selB.addEventListener('change', () => { relZoomStart = 0; relZoomEnd = 100; renderRelChart(); });
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

  /* ---------- 单指数走势 + 最大回撤组合图 (下拉选择, 双 Y 轴) ---------- */
  let comboChart = null;
  let comboZoomStart = 0, comboZoomEnd = 100;
  let comboCode = '000300';

  function initComboPicker() {
    const sel = document.getElementById('combo-idx');
    INDICES.forEach((idx) => {
      const o = document.createElement('option');
      o.value = idx.code; o.textContent = `${idx.name} (${idx.code})`;
      sel.appendChild(o);
    });
    sel.value = comboCode;
    sel.addEventListener('change', () => {
      comboCode = sel.value;
      comboZoomStart = 0; comboZoomEnd = 100;
      renderComboChart();
      renderValuationChart();
    });
  }

  /** 同一张图: 左轴 = 原始指数点位, 右轴 = 回撤水下曲线(%) */
  function renderComboChart() {
    const idx = INDICES.find((i) => i.code === comboCode);
    const closes = seriesCache[comboCode];
    if (!idx || !closes) return;

    let peak = -Infinity;
    const price = [], dd = [];
    closes.forEach((c) => {
      if (c == null) { price.push(null); dd.push(null); return; }
      if (c > peak) peak = c;
      price.push(+c.toFixed(2));
      dd.push(+(c / peak * 100 - 100).toFixed(2));
    });

    if (!comboChart) comboChart = echarts.init(document.getElementById('chart-combo'));
    comboChart.setOption({
      title: {
        text: `${idx.name} 走势与最大回撤`,
        left: 4, top: 2, textStyle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b' },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#e2e8f0',
        textStyle: { color: '#1e293b', fontSize: 12 }, axisPointer: { type: 'cross' },
        valueFormatter: (v) => (v == null ? '-' : v.toFixed(2)),
      },
      legend: { right: 8, top: 8, textStyle: { color: '#64748b', fontSize: 11 } },
      grid: { left: 60, right: 62, top: 44, bottom: 70 },
      xAxis: {
        type: 'category', data: allDates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 }, axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value', scale: true, name: '点位', nameTextStyle: { color: '#64748b', fontSize: 10 },
          splitLine: { lineStyle: { color: '#e8ecf1' } },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: (v) => v.toFixed(0) },
        },
        {
          type: 'value', scale: true, name: '回撤 %', nameTextStyle: { color: '#64748b', fontSize: 10 },
          splitLine: { show: false },
          axisLabel: { color: '#64748b', fontSize: 10, formatter: (v) => v + '%' },
        },
      ],
      dataZoom: [
        { type: 'inside', start: comboZoomStart, end: comboZoomEnd, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', start: comboZoomStart, end: comboZoomEnd, bottom: 10, height: 22,
          borderColor: '#e2e8f0', fillerColor: 'rgba(59,130,246,0.12)',
          handleStyle: { color: '#3b82f6' }, textStyle: { color: '#64748b', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#eef2f7' } } },
      ],
      series: [
        {
          name: `${idx.name} 走势`,
          type: 'line', yAxisIndex: 0, data: price, smooth: true, showSymbol: false, connectNulls: false,
          lineStyle: { width: 2.4, color: idx.color }, itemStyle: { color: idx.color },
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: idx.color + '2e' }, { offset: 1, color: idx.color + '05' }] },
          },
        },
        {
          name: '最大回撤',
          type: 'line', yAxisIndex: 1, data: dd, smooth: true, showSymbol: false, connectNulls: false,
          lineStyle: { opacity: 0 }, itemStyle: { color: '#334155' },
          emphasis: { lineStyle: { opacity: 0 } },
          areaStyle: { color: 'rgba(51,65,85,0.18)' },
          markPoint: (() => {
            let minIdx = -1, minVal = 0;
            dd.forEach((v, i) => { if (v != null && v < minVal) { minVal = v; minIdx = i; } });
            if (minIdx < 0) return {};
            return {
              data: [{
                coord: [allDates[minIdx], minVal],
                value: minVal.toFixed(2) + '%',
                symbol: 'pin', symbolSize: 42, label: { fontSize: 10, color: '#fff' },
                itemStyle: { color: '#334155' },
              }],
            };
          })(),
        },
      ],
    });

    comboChart.on('datazoom', () => {
      const dz = comboChart.getOption().dataZoom[0];
      comboZoomStart = dz.start != null ? dz.start : 0;
      comboZoomEnd = dz.end != null ? dz.end : 100;
    });
    window.addEventListener('resize', () => comboChart && comboChart.resize());
  }

  /* ---------- 指数估值 PE/PB (data/valuation.json, 乐咕源) ---------- */
  let valuationData = null;       // { updated, series: { code: { pe: [{date,value}], pb: [...] } } }
  let valuationMetric = 'pe';     // 'pe' | 'pb'
  let valChart = null;
  let valZoomStart = 0, valZoomEnd = 100;
  const VAL_COLORS = { pe: '#0891b2', pb: '#b45309' };
  const VAL_NAMES = { pe: '市盈率 PE', pb: '市净率 PB' };

  /** 拉取估值 JSON (同源, sessionStorage 当日缓存) */
  async function fetchValuation() {
    const key = 'valuation_' + new Date().toISOString().slice(0, 10);
    const cached = getSessionCache(key);
    if (cached) { console.log('[indices] 估值数据使用会话缓存'); return cached; }
    const resp = await fetch('data/valuation.json', { cache: 'no-store' });
    if (!resp.ok) throw new Error('估值数据 HTTP ' + resp.status);
    const data = await resp.json();
    setSessionCache(key, data);
    return data;
  }

  /** 分位值 (线性插值) 与当前值百分位 */
  function percentileVal(sorted, p) {
    if (!sorted.length) return null;
    const pos = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function currentPercentile(values, cur) {
    if (!values.length) return null;
    const cnt = values.filter((v) => v <= cur).length;
    return cnt / values.length * 100;
  }

  /** 渲染估值走势图: 跟随 combo-idx 选择, PE/PB 按钮切换 */
  function renderValuationChart() {
    const idx = INDICES.find((i) => i.code === comboCode);
    const note = document.getElementById('valuation-note');
    const el = document.getElementById('chart-valuation');
    if (!idx || !el || !note) return;

    const series = valuationData && valuationData.series[comboCode];
    if (!valuationData || !series || !series[valuationMetric] || !series[valuationMetric].length) {
      // 无数据: 清空图表并给出说明
      if (valChart) { valChart.clear(); }
      note.innerHTML = `<span class="hl">${idx.name}</span> 暂无历史估值数据（数据源：乐咕乐股，暂不覆盖该指数）`;
      return;
    }

    const rows = series[valuationMetric];
    const dates = rows.map((r) => r.date);
    const values = rows.map((r) => r.value);
    const cur = values[values.length - 1];
    const sorted = values.slice().sort((a, b) => a - b);
    const pct = currentPercentile(values, cur);
    const QUANTILES = [10, 30, 50, 70, 90];
    const qLines = QUANTILES.map((p) => {
      const v = percentileVal(sorted, p);
      return { yAxis: +v.toFixed(2), lineStyle: { color: '#94a3b8', type: 'dashed', width: 1, opacity: 0.9 },
        label: { formatter: p + '%', color: '#64748b', fontSize: 10, position: 'insideEndTop' } };
    });

    if (!valChart) valChart = echarts.init(el);
    valChart.setOption({
      title: {
        text: `${idx.name} ${VAL_NAMES[valuationMetric]} 走势（虚线为历史分位）`,
        left: 4, top: 2, textStyle: { fontSize: 14, fontWeight: 'bold', color: '#1e293b' },
      },
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#e2e8f0',
        textStyle: { color: '#1e293b', fontSize: 12 }, axisPointer: { type: 'cross' },
        valueFormatter: (v) => (v == null ? '-' : v.toFixed(2)),
      },
      grid: { left: 60, right: 24, top: 44, bottom: 70 },
      xAxis: {
        type: 'category', data: dates, boundaryGap: false,
        axisLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10 }, axisTick: { show: false },
      },
      yAxis: {
        type: 'value', scale: true,
        splitLine: { lineStyle: { color: '#e8ecf1' } },
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (v) => v.toFixed(1) },
      },
      dataZoom: [
        { type: 'inside', start: valZoomStart, end: valZoomEnd, zoomOnMouseWheel: true, moveOnMouseMove: true },
        { type: 'slider', start: valZoomStart, end: valZoomEnd, bottom: 10, height: 22,
          borderColor: '#e2e8f0', fillerColor: 'rgba(59,130,246,0.12)',
          handleStyle: { color: '#3b82f6' }, textStyle: { color: '#64748b', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#eef2f7' } } },
      ],
      series: [{
        name: VAL_NAMES[valuationMetric],
        type: 'line', data: values, smooth: true, showSymbol: false, connectNulls: false,
        lineStyle: { width: 2.2, color: VAL_COLORS[valuationMetric] },
        itemStyle: { color: VAL_COLORS[valuationMetric] },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: VAL_COLORS[valuationMetric] + '2e' }, { offset: 1, color: VAL_COLORS[valuationMetric] + '05' }] },
        },
        markLine: {
          silent: true, symbol: 'none', data: qLines,
        },
      }],
    });

    valChart.on('datazoom', () => {
      const dz = valChart.getOption().dataZoom[0];
      valZoomStart = dz.start != null ? dz.start : 0;
      valZoomEnd = dz.end != null ? dz.end : 100;
    });
    window.addEventListener('resize', () => valChart && valChart.resize());

    // 估值说明: 当前值 + 当前百分位 + 数据范围
    const rangeStart = dates[0], rangeEnd = dates[dates.length - 1];
    const level = pct < 30 ? '低估区间' : (pct > 70 ? '高估区间' : '合理区间');
    note.innerHTML =
      `<span class="hl">${idx.name}</span> 当前 ${VAL_NAMES[valuationMetric]} = <span class="hl">${cur.toFixed(2)}</span>` +
      `，处于历史 <span class="hl">${pct.toFixed(1)}%</span> 分位（${level}）· 数据区间 ${rangeStart} ~ ${rangeEnd}`;
  }

  /** 初始化 PE/PB 切换按钮 */
  function initMetricButtons() {
    const btnPe = document.getElementById('metric-pe');
    const btnPb = document.getElementById('metric-pb');
    if (!btnPe || !btnPb) return;
    const setActive = (m) => {
      valuationMetric = m;
      btnPe.classList.toggle('active', m === 'pe');
      btnPb.classList.toggle('active', m === 'pb');
      valZoomStart = 0; valZoomEnd = 100;
      renderValuationChart();
    };
    btnPe.addEventListener('click', () => setActive('pe'));
    btnPb.addEventListener('click', () => setActive('pb'));
  }

  /* ---------- 图表加载状态: 数据未就绪时显示"数据加载中" ---------- */
  function setChartLoading(on) {
    ['chart', 'chart-norm', 'chart-rel', 'chart-combo', 'chart-valuation'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('loading', on);
    });
  }

  /* ---------- 主流程 ---------- */

  async function main() {
    // 数据未就绪: 图表先显示"数据加载中"
    setChartLoading(true);

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

      // 并行拉取六个指数 (优先使用会话缓存, 缓存命中则不发起网络请求)
      const results = await Promise.allSettled(
        INDICES.map(async (idx) => {
          const cached = getSessionCache('idx_' + idx.code + '_' + START_DATE);
          if (cached) {
            console.log(`[indices] ${idx.name} 使用会话缓存`);
            return cached;
          }
          const rows = await fetchIndexData(idx, START_DATE, endDate);
          setSessionCache('idx_' + idx.code + '_' + START_DATE, rows);
          return rows;
        })
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
      renderNormChart();
      updateTable();
      initRelPicker();
      renderRelChart();
      initComboPicker();
      renderComboChart();
      // 估值数据 (独立 JSON, 与指数数据并行; 失败不阻塞其他图表)
      initMetricButtons();
      try {
        valuationData = await fetchValuation();
      } catch (e) {
        console.warn('[indices] 估值数据加载失败:', e.message);
        const note = document.getElementById('valuation-note');
        if (note) note.textContent = '估值数据加载失败，请稍后刷新重试';
      }
      renderValuationChart();
      // 数据就绪, 移除"数据加载中"提示
      setChartLoading(false);
    } catch (e) {
      console.error('[indices] 加载失败:', e);
      setChartLoading(false);
      document.getElementById('stats-body').innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:#dc2626">数据加载失败，请刷新重试</td></tr>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
