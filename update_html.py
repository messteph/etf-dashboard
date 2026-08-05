# -*- coding: utf-8 -*-
"""根据 data/ 最新数据更新 index.html 中的静态占位数字 (降级模式显示用)
支持两组基金: growth_value (gv_ 前缀) 与 sm500_dividend (sd_ 前缀)
基于 id/正则替换, 不依赖硬编码旧值, 可重复运行
"""
import warnings
warnings.filterwarnings('ignore')

import re
import numpy as np
import pandas as pd

from chart_common import load

# ---------- 配置 ----------
GROUPS = {
    'gv': {
        'label_a': '成长ETF', 'label_b': '价值ETF',
        'code_a': '159259', 'code_b': '159263',
        'start_label': '2025-09-01',
    },
    'sd': {
        'label_a': '沪深300ETF', 'label_b': '创业板ETF',
        'code_a': '510300', 'code_b': '159915',
        'start_label': '2022-01-01',
    },
}


def pct(x, sign=True):
    s = ('+' if x >= 0 else '') if sign else ''
    return f'{s}{x:.2f}%'


def dd_series(close):
    peak = close.cummax()
    return (close / peak - 1) * 100


def analyze(cfg):
    """计算单组全部指标, 返回 dict"""
    a = load(cfg['code_a'])
    b = load(cfg['code_b'])
    # 对齐到共同交易日
    a = a.set_index('日期')
    b = b.set_index('日期')
    common = a.index.intersection(b.index)
    a = a.loc[common].sort_index().reset_index()
    b = b.loc[common].sort_index().reset_index()
    n = len(a)
    dates = a['日期'].iloc[:n]
    a_close = a['收盘'].iloc[:n].reset_index(drop=True)
    b_close = b['收盘'].iloc[:n].reset_index(drop=True)
    a_dd = dd_series(a_close)
    b_dd = dd_series(b_close)

    a_ret = (a_close.iloc[-1] / a_close.iloc[0] - 1) * 100
    b_ret = (b_close.iloc[-1] / b_close.iloc[0] - 1) * 100
    a_min_dd = a_dd.min()
    b_min_dd = b_dd.min()
    a_min_idx = int(a_dd.idxmin())
    b_min_idx = int(b_dd.idxmin())
    a_min_date = dates.iloc[a_min_idx].date()
    b_min_date = dates.iloc[b_min_idx].date()
    a_peak_date = dates.iloc[int(a_close.iloc[:a_min_idx + 1].idxmax())].date()
    b_peak_date = dates.iloc[int(b_close.iloc[:b_min_idx + 1].idxmax())].date()

    # 再平衡回测
    INIT = 10000.0
    interval = 10
    a_shares = INIT / a_close.iloc[0]
    b_shares = INIT / b_close.iloc[0]
    port = []
    for i in range(n):
        total = a_shares * a_close.iloc[i] + b_shares * b_close.iloc[i]
        port.append(total)
        if i > 0 and i % interval == 0:
            half = total / 2
            a_shares = half / a_close.iloc[i]
            b_shares = half / b_close.iloc[i]
    port = np.array(port)
    bh = INIT * (a_close / a_close.iloc[0] + b_close / b_close.iloc[0]).values
    port_ret = (port / (2 * INIT) - 1) * 100
    bh_ret = (bh / (2 * INIT) - 1) * 100
    port_max_dd = ((port / np.maximum.accumulate(port)) - 1).min() * 100
    bh_max_dd = ((bh / np.maximum.accumulate(bh)) - 1).min() * 100
    port_max_dd_idx = int(((port / np.maximum.accumulate(port)) - 1).argmin())
    bh_max_dd_idx = int(((bh / np.maximum.accumulate(bh)) - 1).argmin())
    p_ret = port_ret[-1]
    p_bh = bh_ret[-1]
    # 年化收益率 (按 252 交易日/年)
    a_ann = ((1 + a_ret / 100) ** (252 / n) - 1) * 100
    b_ann = ((1 + b_ret / 100) ** (252 / n) - 1) * 100
    p_ann = ((1 + p_ret / 100) ** (252 / n) - 1) * 100
    bh_ann = ((1 + p_bh / 100) ** (252 / n) - 1) * 100

    return {
        'a_ret': a_ret, 'b_ret': b_ret,
        'a_ann': a_ann, 'b_ann': b_ann,
        'a_min_dd': a_min_dd, 'b_min_dd': b_min_dd,
        'a_min_date': a_min_date, 'b_min_date': b_min_date,
        'a_peak_date': a_peak_date, 'b_peak_date': b_peak_date,
        'a_high': a['最高'].max(), 'a_low': a['最低'].min(),
        'b_high': b['最高'].max(), 'b_low': b['最低'].min(),
        'a_last': a_close.iloc[-1], 'b_last': b_close.iloc[-1],
        'p_ret': p_ret, 'p_bh': p_bh, 'port_max_dd': port_max_dd,
        'p_ann': p_ann, 'bh_ann': bh_ann,
        'bh_max_dd': bh_max_dd,
        'port_max_dd_date': dates.iloc[port_max_dd_idx].date(),
        'bh_max_dd_date': dates.iloc[bh_max_dd_idx].date(),
        'port_last': port[-1], 'bh_last': bh[-1],
        'd0': dates.iloc[0].date(), 'd1': dates.iloc[-1].date(), 'n': n,
    }


def repl_id(html, el_id, new_value):
    # 匹配 div 或 td 元素
    pat = re.compile(r'(<(?:div|td) [^>]*id="%s"[^>]*>)[^<]*(</(?:div|td)>)' % re.escape(el_id))
    return pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)


def repl_note(html, el_id, new_value):
    pat = re.compile(r'(<div class="note" id="%s"[^>]*>)[^<]*(</div>)' % re.escape(el_id))
    return pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)


def repl_cap(html, el_id, new_value):
    pat = re.compile(r'(<div class="cap" id="%s"[^>]*>)[^<]*(</div>)' % re.escape(el_id))
    return pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)


def update_group(html, pfx, cfg, s):
    """更新某一组的所有占位值, 返回 (html, count)"""
    total = 0
    la, lb = cfg['label_a'], cfg['label_b']
    ca, cb = cfg['code_a'], cfg['code_b']

    def do(fn, el_id, val):
        nonlocal total
        html2, c = fn(html, el_id, val)
        return html2, c

    # 表格: 区间涨幅
    html, c = repl_id(html, f'{pfx}_tbl_a_ret', pct(s['a_ret'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_b_ret', pct(s['b_ret'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_p_ret', pct(s['p_ret'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_bh_ret', pct(s['p_bh'])); total += c
    # 表格: 年化收益率
    html, c = repl_id(html, f'{pfx}_tbl_a_ann', pct(s['a_ann'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_b_ann', pct(s['b_ann'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_p_ann', pct(s['p_ann'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_bh_ann', pct(s['bh_ann'])); total += c
    # 表格: 最大回撤
    html, c = repl_id(html, f'{pfx}_tbl_a_dd', pct(s['a_min_dd'], False)); total += c
    html, c = repl_id(html, f'{pfx}_tbl_b_dd', pct(s['b_min_dd'], False)); total += c
    html, c = repl_id(html, f'{pfx}_tbl_p_dd', pct(s['port_max_dd'], False)); total += c
    html, c = repl_id(html, f'{pfx}_tbl_bh_dd', pct(s['bh_max_dd'], False)); total += c
    # 表格: 回撤发生日
    html, c = repl_id(html, f'{pfx}_tbl_a_dd_date', str(s['a_min_date'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_b_dd_date', str(s['b_min_date'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_p_dd_date', str(s['port_max_dd_date'])); total += c
    html, c = repl_id(html, f'{pfx}_tbl_bh_dd_date', str(s['bh_max_dd_date'])); total += c
    # 图注
    html, c = repl_cap(html, f'{pfx}_cap_a',
        f'{la}（{ca}）· 区间最高 {s["a_high"]:.3f} / 最低 {s["a_low"]:.3f} · 最新收盘 {s["a_last"]:.3f}'); total += c
    html, c = repl_cap(html, f'{pfx}_cap_b',
        f'{lb}（{cb}）· 区间最高 {s["b_high"]:.3f} / 最低 {s["b_low"]:.3f} · 最新收盘 {s["b_last"]:.3f}'); total += c
    html, c = repl_cap(html, f'{pfx}_cap_rebal',
        f'回测结果：再平衡组合 {pct(s["p_ret"])}（{s["port_last"]:,.2f} 元），买入持有 {pct(s["p_bh"])}（{s["bh_last"]:,.2f} 元），'
        f'超额 {pct(s["p_ret"] - s["p_bh"])} 个百分点；组合最大回撤 {pct(s["port_max_dd"], False)}，'
        f'介于 {la}（{pct(s["a_min_dd"], False)}）与 {lb}（{pct(s["b_min_dd"], False)}）之间。'); total += c
    # 组内数据范围
    html, c = re.subn(r'(id="%s_range">)[^<]*(<)' % pfx,
        lambda m: m.group(1) + f'数据区间：{s["d0"]} ~ {s["d1"]}（{s["n"]} 个交易日）' + m.group(2), html)
    total += c
    return html, total


def main():
    html = open('index.html', encoding='utf-8').read()
    grand = 0
    results = {}
    for pfx, cfg in GROUPS.items():
        s = analyze(cfg)
        results[pfx] = s
        html, c = update_group(html, pfx, cfg, s)
        grand += c
        print(f'[{pfx}] {cfg["label_a"]} vs {cfg["label_b"]}: '
              f'{pct(s["a_ret"])} vs {pct(s["b_ret"])} | 再平衡 {pct(s["p_ret"])} | '
              f'组合最大回撤 {pct(s["port_max_dd"], False)} | {s["d0"]} ~ {s["d1"]} ({s["n"]} 交易日)')
    open('index.html', 'w', encoding='utf-8').write(html)
    print(f'index.html 更新完成: 共 {grand} 处替换')


if __name__ == '__main__':
    main()
