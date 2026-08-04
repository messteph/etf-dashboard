# -*- coding: utf-8 -*-
"""根据 data/ 最新数据更新 index.html 中的静态占位数字 (降级模式显示用)
基于 id/正则替换, 不依赖硬编码旧值, 可重复运行
"""
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
g_min_idx = int(g_dd.idxmin())
v_min_idx = int(v_dd.idxmin())
g_min_date = dates.iloc[g_min_idx].date()
v_min_date = dates.iloc[v_min_idx].date()
g_peak_date = dates.iloc[int(g_close.iloc[:g_min_idx + 1].idxmax())].date()
v_peak_date = dates.iloc[int(v_close.iloc[:v_min_idx + 1].idxmax())].date()

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
g_high = g['最高'].max()
g_low = g['最低'].min()
v_high = v['最高'].max()
v_low = v['最低'].min()
g_last = g_close.iloc[-1]
v_last = v_close.iloc[-1]

def pct(x, sign=True):
    s = ('+' if x >= 0 else '') if sign else ''
    return f'{s}{x:.2f}%'

path = 'index.html'
html = open(path, encoding='utf-8').read()

def repl_id(html, el_id, new_value, cls_pattern='value up|value blue|value down'):
    """替换 <div class="..." id="el_id">VALUE</div> 中的 VALUE (保留 class 与 style)"""
    pat = re.compile(r'(<div class="(?:%s)" id="%s"[^>]*>)[^<]*(</div>)' % (cls_pattern, re.escape(el_id)))
    new_html, cnt = pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)
    if cnt == 0:
        # 尝试宽松匹配任何 class
        pat2 = re.compile(r'(<div [^>]*id="%s"[^>]*>)[^<]*(</div>)' % re.escape(el_id))
        new_html, cnt = pat2.subn(lambda m: m.group(1) + new_value + m.group(2), html)
    return new_html, cnt

def repl_note(html, el_id, new_value):
    pat = re.compile(r'(<div class="note" id="%s"[^>]*>)[^<]*(</div>)' % re.escape(el_id))
    new_html, cnt = pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)
    return new_html, cnt

def repl_cap(html, el_id, new_value):
    pat = re.compile(r'(<div class="cap" id="%s"[^>]*>)[^<]*(</div>)' % re.escape(el_id))
    new_html, cnt = pat.subn(lambda m: m.group(1) + new_value + m.group(2), html)
    return new_html, cnt

total = 0
# 指标卡数值
html, c = repl_id(html, 'stat_g_ret', pct(g_ret)); total += c
html, c = repl_id(html, 'stat_v_ret', pct(v_ret)); total += c
html, c = repl_id(html, 'stat_g_dd', pct(g_min_dd, False)); total += c
html, c = repl_id(html, 'stat_v_dd', pct(v_min_dd, False)); total += c
html, c = repl_id(html, 'stat_p_ret', pct(p_ret)); total += c
html, c = repl_id(html, 'stat_p_dd', pct(port_max_dd, False)); total += c
# 备注
html, c = repl_note(html, 'stat_g_dd_note', f'发生于 {g_min_date}（峰值 {g_peak_date.strftime("%m-%d")}）'); total += c
html, c = repl_note(html, 'stat_v_dd_note', f'发生于 {v_min_date}（峰值 {v_peak_date.strftime("%m-%d")}）'); total += c
html, c = repl_note(html, 'stat_p_ret_note', f'超额 {pct(p_ret - p_bh)} vs 买入持有'); total += c
# 图注
html, c = repl_cap(html, 'cap_g', f'成长ETF（159259）· 区间最高 {g_high:.3f} / 最低 {g_low:.3f} · 最新收盘 {g_last:.3f}'); total += c
html, c = repl_cap(html, 'cap_v', f'价值ETF（159263）· 区间最高 {v_high:.3f} / 最低 {v_low:.3f} · 最新收盘 {v_last:.3f}'); total += c
# 再平衡说明段
html, c = repl_cap(html, 'cap_rebal',
    f'回测结果：再平衡组合 {pct(p_ret)}（{port[-1]:,.2f} 元），买入持有 {pct(p_bh)}（{bh[-1]:,.2f} 元），'
    f'超额 {pct(p_ret - p_bh)} 个百分点；组合最大回撤 {pct(port_max_dd, False)}，'
    f'介于纯成长（{pct(g_min_dd, False)}）与纯价值（{pct(v_min_dd, False)}）之间，接近价值水平。'); total += c

# 顶部数据范围
pat_range = re.compile(r'(id="data_range">)[^<]*(<)')
html, c = pat_range.subn(lambda m: m.group(1) +
    f'数据区间：2025-09-01 ~ {dates.iloc[-1].date()}（{n} 个交易日）· 打开页面时实时更新' + m.group(2), html)
total += c

# 小结列表里的动态数字
html, c = re.subn(r'(<li><b>收益</b>：)[^<]*(</li>)',
    lambda m: m.group(1) + f'成长ETF 区间涨幅 {pct(g_ret)}，领先价值ETF 的 {pct(v_ret)}。' + m.group(2), html)
total += c
html, c = re.subn(r'(<li><b>再平衡</b>：)[^<]*(</li>)',
    lambda m: m.group(1) +
    f'50/50 每两周再平衡组合收益 {pct(p_ret)}，跑赢买入持有（{pct(p_bh)}），'
    f'且最大回撤收窄至 {pct(port_max_dd, False)}——在震荡市中既吃到成长反弹，又通过"低买高卖"降低波动。' + m.group(2), html)
total += c
# 风险小结里的回撤数字
html, c = re.subn(r'成长ETF 最大回撤 -[0-9.]+%，约为价值ETF（-[0-9.]+%）的 [0-9.]+ 倍；年化波动率约 [0-9]+% vs [0-9]+%',
    f'成长ETF 最大回撤 {pct(g_min_dd, False)}，约为价值ETF（{pct(v_min_dd, False)}）的 {abs(g_min_dd / v_min_dd):.1f} 倍；年化波动率约 51% vs 17%', html)
total += c

# footer 数据区间
html, c = re.subn(r'(统计区间 )[^<]*( · 打开页面时自动更新)',
    lambda m: m.group(1) + f'2025-09-01 ~ {dates.iloc[-1].date()}' + m.group(2), html)
total += c

open(path, 'w', encoding='utf-8').write(html)
print(f'index.html 更新完成: {total} 处替换')
print(f'数据: {dates.iloc[0].date()} ~ {dates.iloc[-1].date()} ({n} 交易日)')
print(f'成长 {pct(g_ret)} / 价值 {pct(v_ret)} / 再平衡 {pct(p_ret)} / 组合最大回撤 {pct(port_max_dd, False)}')
