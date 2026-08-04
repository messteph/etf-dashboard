# -*- coding: utf-8 -*-
"""根据 data/ 最新数据更新 index.html 中的静态占位数字 (降级模式显示用)"""
import warnings
warnings.filterwarnings('ignore')

import re
import numpy as np
import pandas as pd

from chart_common import load

g = load('159259')
v = load('159263')

n = min(len(g), len(v))
dates = g['日期'].iloc[:n]

def dd_series(close):
    peak = close.cummax()
    return (close / peak - 1) * 100

g_close = g['收盘'].iloc[:n].reset_index(drop=True)
v_close = v['收盘'].iloc[:n].reset_index(drop=True)
g_dd = dd_series(g_close)
v_dd = dd_series(v_close)

g_ret = (g_close.iloc[-1] / g_close.iloc[0] - 1) * 100
v_ret = (v_close.iloc[-1] / v_close.iloc[0] - 1) * 100
g_min_dd = g_dd.min()
v_min_dd = v_dd.min()
g_min_date = dates.iloc[int(g_dd.idxmin())].date()
v_min_date = dates.iloc[int(v_dd.idxmin())].date()
g_peak_date = dates.iloc[int(g_close.iloc[:int(g_dd.idxmin()) + 1].idxmax())].date()
v_peak_date = dates.iloc[int(v_close.iloc[:int(v_dd.idxmin()) + 1].idxmax())].date()

# 再平衡回测
INIT = 10000.0
interval = 10
g_shares = INIT / g_close.iloc[0]
v_shares = INIT / v_close.iloc[0]
port = []
for i in range(n):
    total = g_shares * g_close.iloc[i] + v_shares * v_close.iloc[i]
    port.append(total)
    if i > 0 and i % interval == 0:
        half = total / 2
        g_shares = half / g_close.iloc[i]
        v_shares = half / v_close.iloc[i]
port = np.array(port)
bh = INIT * (g_close / g_close.iloc[0] + v_close / v_close.iloc[0]).values
port_ret = (port / (2 * INIT) - 1) * 100
bh_ret = (bh / (2 * INIT) - 1) * 100
port_max_dd = ((port / np.maximum.accumulate(port)) - 1).min() * 100
p_ret = port_ret[-1]
p_bh = bh_ret[-1]

def pct(x, sign=True):
    s = ('+' if x >= 0 else '') if sign else ''
    return f'{s}{x:.2f}%'

# 读取 index.html
path = 'index.html'
html = open(path, encoding='utf-8').read()

# 逐个替换占位值
replacements = [
    ('id="stat_g_ret">+19.05%', f'id="stat_g_ret">{pct(g_ret)}'),
    ('id="stat_v_ret">+11.52%', f'id="stat_v_ret">{pct(v_ret)}'),
    ('id="stat_g_dd">-37.68%', f'id="stat_g_dd">{pct(g_min_dd, False)}'),
    ('id="stat_v_dd">-16.56%', f'id="stat_v_dd">{pct(v_min_dd, False)}'),
    ('id="stat_p_ret" style="color:var(--growth)">+18.26%',
     f'id="stat_p_ret" style="color:var(--growth)">{pct(p_ret)}'),
    ('id="stat_p_dd">-16.83%', f'id="stat_p_dd">{pct(port_max_dd, False)}'),
    ('id="stat_g_dd_note">发生于 2026-07-30（峰值 06-22）',
     f'id="stat_g_dd_note">发生于 {g_min_date}（峰值 {g_peak_date.strftime("%m-%d")}）'),
    ('id="stat_v_dd_note">发生于 2026-06-30（峰值 03-12）',
     f'id="stat_v_dd_note">发生于 {v_min_date}（峰值 {v_peak_date.strftime("%m-%d")}）'),
    ('id="stat_p_ret_note">超额 +2.98pp vs 买入持有',
     f'id="stat_p_ret_note">超额 {pct(p_ret - p_bh)} vs 买入持有'),
    ('id="stat_p_dd_note">显著低于纯成长 ETF', 'id="stat_p_dd_note">显著低于纯成长 ETF'),
    ('id="cap_g">成长ETF（159259）· 区间最高 1.827 / 最低 1.017 · 最新收盘 1.163',
     f'id="cap_g">成长ETF（159259）· 区间最高 {g["最高"].max():.3f} / 最低 {g["最低"].min():.3f} · 最新收盘 {g_close.iloc[-1]:.3f}'),
    ('id="cap_v">价值ETF（159263）· 区间最高 1.247 / 最低 1.024 · 最新收盘 1.170',
     f'id="cap_v">价值ETF（159263）· 区间最高 {v["最高"].max():.3f} / 最低 {v["最低"].min():.3f} · 最新收盘 {v_close.iloc[-1]:.3f}'),
]

changed = 0
for old, new in replacements:
    if old in html:
        html = html.replace(old, new)
        changed += 1
    else:
        print(f'[warn] 未找到: {old[:50]}')

# 更新再平衡 cap 与小结中的数字
html = re.sub(
    r'回测结果：再平衡组合 [^（]*（[0-9,.]* 元），买入持有 [^（]*（[0-9,.]* 元），超额 [^；]*；',
    f'回测结果：再平衡组合 {pct(p_ret)}（{port[-1]:,.2f} 元），买入持有 {pct(p_bh)}（{bh[-1]:,.2f} 元），超额 {pct(p_ret - p_bh)} 个百分点；',
    html)
html = re.sub(r'组合最大回撤 -[0-9.]+%', f'组合最大回撤 {pct(port_max_dd, False)}', html)
html = re.sub(r'成长ETF 区间涨幅 \+[0-9.]+%，领先价值ETF 的 \+[0-9.]+%',
              f'成长ETF 区间涨幅 {pct(g_ret)}，领先价值ETF 的 {pct(v_ret)}', html)
html = re.sub(r'50/50 每两周再平衡组合收益 \+[0-9.]+%，跑赢买入持有（\+[0-9.]+%）',
              f'50/50 每两周再平衡组合收益 {pct(p_ret)}，跑赢买入持有（{pct(p_bh)}）', html)
# 数据区间 footer
html = re.sub(r'统计区间 2025-09-01 起[^<]*',
              f'统计区间 2025-09-01 ~ {dates.iloc[-1].date()} · 打开页面时自动更新', html)
html = re.sub(r'id="data_range">[^<]*',
              f'id="data_range">数据区间：2025-09-01 ~ {dates.iloc[-1].date()}（{n} 个交易日）· 打开页面时实时更新', html)

open(path, 'w', encoding='utf-8').write(html)
print(f'index.html 更新完成: {changed} 处占位值替换')
print(f'数据: {dates.iloc[0].date()} ~ {dates.iloc[-1].date()} ({n} 交易日)')
print(f'成长 {pct(g_ret)} / 价值 {pct(v_ret)} / 再平衡 {pct(p_ret)} / 最大回撤 {pct(port_max_dd, False)}')
