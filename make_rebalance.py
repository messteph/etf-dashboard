# -*- coding: utf-8 -*-
"""50/50 定期再平衡策略回测 + 收益率曲线 (配置驱动, 支持多组基金)
组: growth_value (159259/159263 起 2025-09-01)
    sm500_dividend (510500/515080 起 2022-01-01)
用法: python make_rebalance.py [组名...]  (默认全部)
"""
import warnings
warnings.filterwarnings('ignore')

import os
import sys
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter

from chart_common import setup_font, load

setup_font()

BG, GRID, TXT, SUB = '#ffffff', '#e8ecf1', '#1e293b', '#64748b'
PORT, BHOLD = '#7c3aed', '#94a3b8'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')

GROUPS = {
    'growth_value': {
        'title_a': '成长ETF', 'title_b': '价值ETF',
        'code_a': '159259', 'code_b': '159263',
        'prefix': 'gv',
    },
    'sm500_dividend': {
        'title_a': '中证500ETF南方', 'title_b': '中证红利ETF招商',
        'code_a': '510500', 'code_b': '515080',
        'prefix': 'sd',
    },
}


def render_pair(cfg):
    p = cfg['prefix']
    g = load(cfg['code_a'])
    v = load(cfg['code_b'])
    la = f"{cfg['title_a']} ({cfg['code_a']})"
    lb = f"{cfg['title_b']} ({cfg['code_b']})"

    assert len(g) == len(v), '两只ETF交易日数不一致'
    n = len(g)
    dates = g['日期'].values
    g_close = g['收盘'].values
    v_close = v['收盘'].values
    d0, d1 = dates[0].astype('datetime64[D]'), dates[-1].astype('datetime64[D]')

    INIT = 10000.0
    REBAL_INTERVAL = 10
    g_shares = INIT / g_close[0]
    v_shares = INIT / v_close[0]
    port_value = np.zeros(n)
    bh_value = np.zeros(n)
    weights_g = np.zeros(n)
    rebal_days = []

    for i in range(n):
        g_mv = g_shares * g_close[i]
        v_mv = v_shares * v_close[i]
        total = g_mv + v_mv
        port_value[i] = total
        weights_g[i] = g_mv / total if total > 0 else 0
        if i > 0 and i % REBAL_INTERVAL == 0:
            half = total / 2.0
            g_shares = half / g_close[i]
            v_shares = half / v_close[i]
            rebal_days.append(i)

    g_shares_bh = INIT / g_close[0]
    v_shares_bh = INIT / v_close[0]
    for i in range(n):
        bh_value[i] = g_shares_bh * g_close[i] + v_shares_bh * v_close[i]

    port_ret = (port_value / (2 * INIT) - 1) * 100
    bh_ret = (bh_value / (2 * INIT) - 1) * 100
    peak = np.maximum.accumulate(port_value)
    port_dd = (port_value / peak - 1) * 100
    dd_min = port_dd.min()
    dd_idx = int(port_dd.argmin())

    fig, ax = plt.subplots(figsize=(10, 5.4), facecolor=BG)
    ax.set_facecolor(BG)
    for rd in rebal_days:
        ax.axvline(dates[rd], color=PORT, linewidth=0.7, alpha=0.35, zorder=1)
    ax.plot(dates, bh_ret, color=BHOLD, linewidth=1.6, ls='--', label='买入持有（不操作）', zorder=2)
    ax.plot(dates, port_ret, color=PORT, linewidth=2.4, label='50/50 定期再平衡（每两周）', zorder=3)
    ax.fill_between(dates, port_ret, port_ret.min(), color=PORT, alpha=0.06, zorder=1)
    ax.axhline(0, color=TXT, linewidth=0.9, alpha=0.7)

    ax.set_title(f'{cfg["title_a"]} + {cfg["title_b"]} 50/50 再平衡策略 — 合计收益率（初始各 10,000 元, {d0} ~ {d1}）',
                 fontsize=14.5, fontweight='bold', color=TXT, pad=14)
    ax.set_ylabel('累计收益率（%）', color=SUB, fontsize=10)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color(GRID)
    ax.spines['bottom'].set_color(GRID)
    ax.tick_params(colors=SUB, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))
    loc = mdates.AutoDateLocator(minticks=4, maxticks=6)
    ax.xaxis.set_major_locator(loc)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%y-%m'))

    final_port = port_ret[-1]
    final_bh = bh_ret[-1]
    ax.annotate(f'再平衡 {final_port:+.2f}%', xy=(dates[-1], port_ret[-1]),
                xytext=(-10, 14), textcoords='offset points', ha='right',
                fontsize=10.5, color=PORT, fontweight='bold')
    ax.annotate(f'买入持有 {final_bh:+.2f}%', xy=(dates[-1], bh_ret[-1]),
                xytext=(-10, -18), textcoords='offset points', ha='right',
                fontsize=10.5, color=BHOLD, fontweight='bold')
    ax.scatter([dates[dd_idx]], [port_dd.min()], color='#dc2626', s=44, zorder=5,
               edgecolor='white', linewidth=1.2)
    ax.annotate(f'组合最大回撤 {dd_min:.2f}%\n({dates[dd_idx].astype("datetime64[D]")})',
                xy=(dates[dd_idx], port_dd.min()), xytext=(-20, 48), textcoords='offset points',
                ha='center', fontsize=9.5, color='#b91c1c', fontweight='bold',
                arrowprops=dict(arrowstyle='->', color='#b91c1c', lw=1.2))
    ax.legend(loc='upper left', frameon=False, fontsize=9.5)
    fig.tight_layout()
    fig.savefig(f'{OUT}/{p}_rebalance_trend.png', facecolor=BG, bbox_inches='tight')
    plt.close(fig)

    n_rebal = len(rebal_days)
    ann = (port_value[-1] / (2 * INIT)) ** (365.0 / max((n - 1) * 7 / 5, 1)) - 1
    print(f'=== 组 [{p}] 再平衡回测 ===')
    print(f'数据区间: {d0} ~ {d1} ({n} 交易日) | 再平衡 {n_rebal} 次')
    print(f'组合收益 {final_port:+.2f}% | 买入持有 {final_bh:+.2f}% | 超额 {final_port - final_bh:+.2f}pp')
    print(f'组合最大回撤 {dd_min:.2f}% ({dates[dd_idx].astype("datetime64[D]")}) | 年化 {ann * 100:+.2f}%')


def main():
    groups = sys.argv[1:] if len(sys.argv) > 1 else list(GROUPS.keys())
    for grp in groups:
        if grp in GROUPS:
            render_pair(GROUPS[grp])


if __name__ == '__main__':
    main()
