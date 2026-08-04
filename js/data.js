/* ============================================================
 * etf-dashboard 数据层
 * 打开网页时通过东方财富 JSONP 接口拉取两只 ETF 最新日线数据
 * 并计算: 走势 / 最大回撤 / 50-50 每两周再平衡策略
 * 接口: push2his.eastmoney.com (JSONP, 免 CORS, 免 token)
 * ============================================================ */

const ETF_GROWTH = { code: '159259', name: '成长ETF易方达', market: 0 };
const ETF_VALUE  = { code: '159263', name: '价值ETF易方达', market: 0 };

const API = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const UT  = '7eea3edcaed734bea9cbfc24409ed989';

/** JSONP 拉取单只 ETF 日线 (前复权) */
function fetchEtfDaily(etf, startDate, endDate) {
  return new Promise((resolve, reject) => {
    const cb = 'jsonp_cb_' + Math.random().toString(36).slice(2, 10);
    const params = new URLSearchParams({
      secid: `${etf.market}.${etf.code}`,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: '101',          // 日线
      fqt: '1',            // 前复权
      beg: startDate,      // YYYYMMDD
      end: endDate,
      ut: UT,
      cb: cb,
    });

    const script = document.createElement('script');
    const timeoutId = setTimeout(() => {
      window[cb] = undefined;
      script.remove();
      reject(new Error(`拉取 ${etf.code} 数据超时`));
    }, 20000);

    window[cb] = (json) => {
      clearTimeout(timeoutId);
      window[cb] = undefined;
      script.remove();
      if (!json || !json.data || !json.data.klines) {
        reject(new Error(`拉取 ${etf.code} 数据失败`));
        return;
      }
      const rows = json.data.klines.map((k) => {
        const p = k.split(',');
        return {
          date: p[0],
          open: +p[1], close: +p[2], high: +p[3], low: +p[4],
          volume: +p[5], amount: +p[6], amplitude: +p[7],
          pct: +p[8], chg: +p[9], turnover: +p[10],
        };
      });
      resolve({ etf, rows });
    };

    script.src = API + '?' + params.toString();
    document.head.appendChild(script);
  });
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

  return {
    dates, portRet, bhRet, rebalIdx,
    portValue, bhValue,
    maxDD, maxDDDate: dates[maxDDIdx],
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
