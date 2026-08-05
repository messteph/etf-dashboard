/* ============================================================
 * etf-dashboard 数据层
 * 打开网页时拉取两只 ETF 最新日线数据, 多数据源 fallback:
 *   1. 东方财富 push2his  (JSONP, 免 CORS)
 *   2. 腾讯 ifzq           (fetch + CORS *)
 *   3. 新浪 quotes.sina    (JSONP)
 * 任一源失败自动切换下一源, 全部失败则由 main.js 降级静态图
 * ============================================================ */

const ETF_GROWTH = { code: '159259', name: '成长ETF易方达', market: 0 };
const ETF_VALUE  = { code: '159263', name: '价值ETF易方达', market: 0 };

const EM_API = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_UT  = '7eea3edcaed734bea9cbfc24409ed989';
const TX_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';
const SINA_URL = 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20t=/CN_MarketDataService.getKLineData';

/** 标准化行数据: 统一为 { date, open, close, high, low, volume, amount, amplitude, pct, chg, turnover } */
function normRow(p) {
  return {
    date: p.date,
    open: +p.open, close: +p.close, high: +p.high, low: +p.low,
    volume: +p.volume || 0, amount: +p.amount || 0,
    amplitude: +p.amplitude || 0, pct: +p.pct || 0,
    chg: +p.chg || 0, turnover: +p.turnover || 0,
  };
}

/** 源1: 东方财富 JSONP */
function fetchFromEastmoney(etf, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const cb = 'jsonp_cb_' + Math.random().toString(36).slice(2, 10);
    const params = new URLSearchParams({
      secid: `${etf.market}.${etf.code}`,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: '101', fqt: '1', beg: startDate, end: endDate, ut: EM_UT, cb: cb,
    });
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      window[cb] = undefined; script.remove();
      reject(new Error('东方财富超时'));
    }, 15000);
    window[cb] = (json) => {
      clearTimeout(timeoutId);
      window[cb] = undefined; script.remove();
      if (!json || !json.data || !json.data.klines) { reject(new Error('东方财富数据为空')); return; }
      try {
        const rows = json.data.klines.map((k) => {
          const p = k.split(',');
          return { date: p[0], open: p[1], close: p[2], high: p[3], low: p[4],
                   volume: p[5], amount: p[6], amplitude: p[7], pct: p[8], chg: p[9], turnover: p[10] };
        }).map(normRow);
        resolve(rows);
      } catch (e) { reject(new Error('东方财富解析失败: ' + e.message)); }
    };
    script.src = EM_API + '?' + params.toString();
    document.head.appendChild(script);
  });
}

/** 源2: 腾讯 fetch (CORS *, 日期参数需带横线; qfqday 单次约 640 条上限, 分段拉取拼接) */
async function fetchFromTencent(etf, startDate, endDate) {
  const prefix = etf.code.startsWith('159') ? 'sz' : 'sh';
  const fmtD = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 按 180 天分段
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
    const url = `${TX_URL}?param=${prefix}${etf.code},day,${ss},${se},800,qfq`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    } finally { clearTimeout(t); }
    if (!resp.ok) throw new Error('腾讯 HTTP ' + resp.status);
    const json = await resp.json();
    const node = json && json.data;
    if (!node || typeof node !== 'object') throw new Error('腾讯数据为空');
    const key = prefix + etf.code;
    const node2 = node[key] || {};
    // 腾讯结构: 深市用 day, 沪市用 qfqday (前复权)
    const rows = node2.day || node2.qfqday || [];
    for (const r of rows) {
      const p = typeof r === 'string' ? r.split(',') : r;
      if (!seen.has(p[0])) { seen.add(p[0]); merged.push(p); }
    }
  }
  if (!merged.length) throw new Error('腾讯 kline 为空');
  return merged.map((p) => ({ date: p[0], open: p[1], close: p[2], high: p[3], low: p[4], volume: p[5] })).map(normRow);
}

/** 源3: 新浪 JSONP (返回 var t=([...]) 格式, 用 script 加载后解析) */
function fetchFromSina(etf, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const prefix = etf.code.startsWith('159') ? 'sz' : 'sh';
    const cb = 'sina_cb_' + Math.random().toString(36).slice(2, 10);
    const url = `${SINA_URL}?symbol=${prefix}${etf.code}&scale=240&ma=no&datalen=2000&cb=${cb}`;
    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      window[cb] = undefined; script.remove();
      reject(new Error('新浪超时'));
    }, 15000);
    // 新浪实际返回 var t=([...]), 加载后读 window.t
    window[cb] = () => {
      clearTimeout(timeoutId);
      window[cb] = undefined; script.remove();
      const raw = window.t;
      window.t = undefined;
      if (!Array.isArray(raw) || !raw.length) { reject(new Error('新浪数据为空')); return; }
      try {
        const fmtD = (d) => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
        const rows = raw
          .filter((r) => r.day >= fmtD(startDate))
          .map((r) => ({ date: r.day, open: r.open, close: r.close, high: r.high, low: r.low, volume: r.volume }))
          .map(normRow);
        if (!rows.length) { reject(new Error('新浪数据范围为空')); return; }
        resolve(rows);
      } catch (e) { reject(new Error('新浪解析失败: ' + e.message)); }
    };
    script.src = url;
    document.head.appendChild(script);
  });
}

/** 多源拉取: 依次尝试东财 -> 腾讯 -> 新浪 */
async function fetchEtfDaily(etf, startDate, endDate) {
  const sources = [
    { name: '东方财富', fn: () => fetchFromEastmoney(etf, startDate, endDate) },
    { name: '腾讯', fn: () => fetchFromTencent(etf, startDate, endDate) },
    { name: '新浪', fn: () => fetchFromSina(etf, startDate, endDate) },
  ];
  let lastErr = null;
  for (const s of sources) {
    try {
      const rows = await s.fn();
      if (rows.length >= 2) {
        console.log(`[etf-dashboard] ${etf.code} 数据源=${s.name} ${rows.length} rows`);
        return rows;
      }
      lastErr = new Error(`${s.name} 数据不足`);
    } catch (e) {
      lastErr = e;
      console.warn(`[etf-dashboard] ${etf.code} ${s.name} 失败: ${e.message}`);
    }
  }
  throw lastErr || new Error('所有数据源均失败');
}

/** 计算回撤序列 (负数百分比) */
function calcDrawdown(closes) {
  let peak = -Infinity;
  return closes.map((c) => {
    if (c > peak) peak = c;
    return (c / peak - 1) * 100;
  });
}

/** 50/50 每两周(10交易日)再平衡回测
 *  initial: 每只初始投入金额
 *  returns: { dates, portRet, bhRet, rebalIdx, maxDD, maxDDDate, finalAssets }
 */
function backtestRebalance(gRows, vRows, initial = 10000, interval = 10) {
  const n = Math.min(gRows.length, vRows.length);
  const dates = gRows.slice(0, n).map((r) => r.date);
  const gClose = gRows.slice(0, n).map((r) => r.close);
  const vClose = vRows.slice(0, n).map((r) => r.close);

  let gShares = initial / gClose[0];
  let vShares = initial / vClose[0];
  const gSharesBH = gShares, vSharesBH = vShares;

  const portValue = new Array(n);
  const bhValue = new Array(n);
  const rebalIdx = [];

  for (let i = 0; i < n; i++) {
    const gMv = gShares * gClose[i];
    const vMv = vShares * vClose[i];
    const total = gMv + vMv;
    portValue[i] = total;

    if (i > 0 && i % interval === 0) {
      const half = total / 2;
      gShares = half / gClose[i];
      vShares = half / vClose[i];
      rebalIdx.push(i);
    }
  }
  for (let i = 0; i < n; i++) {
    bhValue[i] = gSharesBH * gClose[i] + vSharesBH * vClose[i];
  }

  const total0 = 2 * initial;
  const portRet = portValue.map((v) => (v / total0 - 1) * 100);
  const bhRet = bhValue.map((v) => (v / total0 - 1) * 100);

  // 组合最大回撤
  let peak = -Infinity, maxDD = 0, maxDDIdx = 0;
  portValue.forEach((v, i) => {
    if (v > peak) peak = v;
    const dd = (v / peak - 1) * 100;
    if (dd < maxDD) { maxDD = dd; maxDDIdx = i; }
  });
  // 买入持有最大回撤
  let peakBH = -Infinity, maxDDBH = 0, maxDDBHIdx = 0;
  bhValue.forEach((v, i) => {
    if (v > peakBH) peakBH = v;
    const dd = (v / peakBH - 1) * 100;
    if (dd < maxDDBH) { maxDDBH = dd; maxDDBHIdx = i; }
  });
  // 年化收益率 (按 252 交易日/年)
  const ann = (final) => ((1 + final / 100) ** (252 / n) - 1) * 100;

  return {
    dates, portRet, bhRet, rebalIdx,
    portValue, bhValue,
    maxDD, maxDDDate: dates[maxDDIdx],
    maxDDBH, maxDDBHDate: dates[maxDDBHIdx],
    annPort: ann(portRet[n - 1]), annBH: ann(bhRet[n - 1]),
    finalPort: portRet[n - 1], finalBH: bhRet[n - 1],
  };
}

/** 汇总指标 */
function computeStats(gRows, vRows, rebal) {
  const gClose = gRows.map((r) => r.close);
  const vClose = vRows.map((r) => r.close);
  const gDD = calcDrawdown(gClose);
  const vDD = calcDrawdown(vClose);

  const gRet = (gClose[gClose.length - 1] / gClose[0] - 1) * 100;
  const vRet = (vClose[vClose.length - 1] / vClose[0] - 1) * 100;

  const gMinDD = Math.min(...gDD);
  const vMinDD = Math.min(...vDD);
  const gMinIdx = gDD.indexOf(gMinDD);
  const vMinIdx = vDD.indexOf(vMinDD);

  const gHigh = Math.max(...gRows.map((r) => r.high));
  const gLow = Math.min(...gRows.map((r) => r.low));
  const vHigh = Math.max(...vRows.map((r) => r.high));
  const vLow = Math.min(...vRows.map((r) => r.low));

  return {
    dates: gRows.map((r) => r.date),
    gClose, vClose, gDD, vDD,
    gRet, vRet,
    gMinDD, gMinDate: gRows[gMinIdx].date,
    vMinDD, vMinDate: vRows[vMinIdx].date,
    gHigh, gLow, vHigh, vLow,
    gLast: gClose[gClose.length - 1],
    vLast: vClose[vClose.length - 1],
    gMA20: sma(gClose, 20),
    vMA20: sma(vClose, 20),
    gNorm: gClose.map((c) => (c / gClose[0]) * 100),
    vNorm: vClose.map((c) => (c / vClose[0]) * 100),
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
