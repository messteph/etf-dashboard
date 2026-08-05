# -*- coding: utf-8 -*-
"""生成 ETF 走势图 + 最大回撤图 (配置驱动, 支持多组基金)
组: growth_value (159259/159263 起 2025-09-01)
    sm500_dividend (510500/515080 起 2022-01-01)
用法: python make_charts.py [组名...]  (默认全部)
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

# ---------- 样式 ----------
BG, GRID, TXT, SUB, DD_FILL = '#ffffff', '#e8ecf1', '#1e293b', '#64748b', '#ef4444'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

# ---------- 基金组配置 ----------
GROUPS = {
    'growth_value': {
        'title_a': '成长ETF', 'title_b': '价值ETF',
        'code_a': '159259', 'code_b': '159263',
        'color_a': '#e0522a', 'color_b': '#2563eb',
        'prefix': 'gv',
    },
    'sm500_dividend': {
        'title_a': '中证500ETF南方', 'title_b': '中证红利ETF招商',
        'code_a': '510500', 'code_b': '515080',
        'color_a': '#059669', 'color_b': '#d97706',
        'prefix': 'sd',
    },
}


def drawdown(close):
    peak = close.cummax()
    return close / peak - 1.0


def max_dd_info(df):
    dd = df['dd']
    trough_idx = dd.idxmin()
    trough = dd[trough_idx]
    peak_date = df.loc[:trough_idx, '日期'][df.loc[:trough_idx, '收盘'].idxmax()]
    return trough, df.loc[trough_idx, '日期'], peak_date


def style_ax(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color(GRID)
    ax.spines['bottom'].set_color(GRID)
    ax.tick_params(colors=SUB, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def date_ticks(ax, n=6, fmt='%y-%m'):
    loc = mdates.AutoDateLocator(minticks=4, maxticks=n)
    ax.xaxis.set_major_locator(loc)
    ax.xaxis.set_major_formatter(mdates.DateFormatter(fmt))
    ax.tick_params(axis='x', rotation=0)


def render_pair(cfg):
    p = cfg['prefix']
    a = load(cfg['code_a'])
    b = load(cfg['code_b'])
    a['dd'] = drawdown(a['收盘'])
    b['dd'] = drawdown(b['收盘'])
    a_trough, a_trough_date, a_peak_date = max_dd_info(a)
    b_trough, b_trough_date, b_peak_date = max_dd_info(b)
    la = f"{cfg['title_a']} ({cfg['code_a']})"
    lb = f"{cfg['title_b']} ({cfg['code_b']})"
    ca, cb = cfg['color_a'], cfg['color_b']
    d0, d1 = a['日期'].iloc[0].date(), a['日期'].iloc[-1].date()

    # ---------- 图1/2: 单基金走势 ----------
    for df, color, label, fname, title in [
        (a, ca, la, f'{p}_a_trend.png', f"{cfg['title_a']} ({cfg['code_a']}) 走势"),
        (b, cb, lb, f'{p}_b_trend.png', f"{cfg['title_b']} ({cfg['code_b']}) 走势"),
    ]:
        fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=BG)
        ax.set_facecolor(BG)
        ax.plot(df['日期'], df['收盘'], color=color, linewidth=2.2, label=label, zorder=3)
        ax.fill_between(df['日期'], df['收盘'], df['收盘'].min(), color=color, alpha=0.06, zorder=1)
        df['ma20'] = df['收盘'].rolling(20).mean()
        ax.plot(df['日期'], df['ma20'], color=color, linewidth=1.1, alpha=0.55, ls='--', label='MA20', zorder=2)
        ret = (df['收盘'].iloc[-1] / df['收盘'].iloc[0] - 1) * 100
        ax.set_title(f'{title}（{d0} ~ {d1}）', fontsize=15, fontweight='bold', color=TXT, pad=14)
        ax.set_ylabel('净值（元）', color=SUB, fontsize=10)
        style_ax(ax)
        date_ticks(ax, fmt='%y-%m')
        ax.annotate(f'区间涨幅 {ret:+.1f}%', xy=(df['日期'].iloc[-1], df['收盘'].iloc[-1]),
                    xytext=(-8, 10), textcoords='offset points', ha='right', fontsize=10,
                    color=color, fontweight='bold')
        ax.legend(loc='upper left', frameon=False, fontsize=9)
        fig.tight_layout()
        fig.savefig(f'{OUT}/{fname}', facecolor=BG, bbox_inches='tight')
        plt.close(fig)

    # ---------- 图3: 双基金归一化对比 ----------
    an = a['收盘'] / a['收盘'].iloc[0] * 100
    bn = b['收盘'] / b['收盘'].iloc[0] * 100
    fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=BG)
    ax.set_facecolor(BG)
    ax.plot(a['日期'], an, color=ca, linewidth=2.2, label=la, zorder=3)
    ax.plot(b['日期'], bn, color=cb, linewidth=2.2, label=lb, zorder=3)
    ax.axhline(100, color=SUB, linewidth=0.9, ls=':', alpha=0.7)
    ax.set_title(f'{cfg["title_a"]} vs {cfg["title_b"]} 走势对比（起点归一化 = 100, {d0} ~ {d1}）',
                 fontsize=15, fontweight='bold', color=TXT, pad=14)
    ax.set_ylabel('归一化净值（起点=100）', color=SUB, fontsize=10)
    style_ax(ax)
    date_ticks(ax, fmt='%y-%m')
    ret_a = (an.iloc[-1] - 100)
    ret_b = (bn.iloc[-1] - 100)
    ax.annotate(f'{la} {ret_a:+.1f}%', xy=(a['日期'].iloc[-1], an.iloc[-1]),
                xytext=(-8, 12), textcoords='offset points', ha='right', fontsize=10,
                color=ca, fontweight='bold')
    ax.annotate(f'{lb} {ret_b:+.1f}%', xy=(b['日期'].iloc[-1], bn.iloc[-1]),
                xytext=(-8, -16), textcoords='offset points', ha='right', fontsize=10,
                color=cb, fontweight='bold')
    ax.legend(loc='upper left', frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(f'{OUT}/{p}_compare_trend.png', facecolor=BG, bbox_inches='tight')
    plt.close(fig)

    # ---------- 图4/5: 单基金最大回撤 ----------
    for df, color, label, fname, title, trough, trough_date in [
        (a, ca, la, f'{p}_a_drawdown.png', cfg['title_a'], a_trough, a_trough_date),
        (b, cb, lb, f'{p}_b_drawdown.png', cfg['title_b'], b_trough, b_trough_date),
    ]:
        fig, ax = plt.subplots(figsize=(10, 4.6), facecolor=BG)
        ax.set_facecolor(BG)
        ax.fill_between(df['日期'], df['dd'] * 100, 0, color=DD_FILL, alpha=0.22, zorder=1)
        ax.plot(df['日期'], df['dd'] * 100, color=DD_FILL, linewidth=1.8, zorder=2)
        ax.axhline(0, color=TXT, linewidth=0.8)
        ax.set_title(f'{title} ({label.split("(")[-1].rstrip(")")}) 最大回撤走势 — 最大回撤 {trough * 100:.2f}%',
                     fontsize=15, fontweight='bold', color=TXT, pad=14)
        ax.set_ylabel('回撤（%）', color=SUB, fontsize=10)
        style_ax(ax)
        date_ticks(ax, fmt='%y-%m')
        ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))
        ax.scatter([trough_date], [trough * 100], color=DD_FILL, s=46, zorder=5,
                   edgecolor='white', linewidth=1.2)
        ax.annotate(f'最大回撤 {trough * 100:.2f}%\n{trough_date.date()}',
                    xy=(trough_date, trough * 100), xytext=(-18, -52), textcoords='offset points',
                    ha='center', fontsize=9.5, color='#b91c1c', fontweight='bold',
                    arrowprops=dict(arrowstyle='->', color='#b91c1c', lw=1.2))
        fig.tight_layout()
        fig.savefig(f'{OUT}/{fname}', facecolor=BG, bbox_inches='tight')
        plt.close(fig)

    # ---------- 图6: 双基金回撤对比 ----------
    fig, ax = plt.subplots(figsize=(10, 4.6), facecolor=BG)
    ax.set_facecolor(BG)
    ax.fill_between(a['日期'], a['dd'] * 100, 0, color=ca, alpha=0.13, zorder=1)
    ax.fill_between(b['日期'], b['dd'] * 100, 0, color=cb, alpha=0.13, zorder=1)
    ax.plot(a['日期'], a['dd'] * 100, color=ca, linewidth=1.8,
            label=f'{la} 最大回撤 {a_trough * 100:.2f}%', zorder=2)
    ax.plot(b['日期'], b['dd'] * 100, color=cb, linewidth=1.8,
            label=f'{lb} 最大回撤 {b_trough * 100:.2f}%', zorder=2)
    ax.axhline(0, color=TXT, linewidth=0.8)
    ax.set_title(f'{cfg["title_a"]} vs {cfg["title_b"]} 最大回撤对比（{d0} ~ {d1}）',
                 fontsize=15, fontweight='bold', color=TXT, pad=14)
    ax.set_ylabel('回撤（%）', color=SUB, fontsize=10)
    style_ax(ax)
    date_ticks(ax, fmt='%y-%m')
    ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))
    ax.legend(loc='lower left', frameon=False, fontsize=9)
    fig.tight_layout()
    fig.savefig(f'{OUT}/{p}_compare_drawdown.png', facecolor=BG, bbox_inches='tight')
    plt.close(fig)

    # 输出统计
    ret_a = (a['收盘'].iloc[-1] / a['收盘'].iloc[0] - 1) * 100
    ret_b = (b['收盘'].iloc[-1] / b['收盘'].iloc[0] - 1) * 100
    print(f'=== 组 [{p}] {cfg["title_a"]} vs {cfg["title_b"]} ===')
    print(f'{cfg["title_a"]} {cfg["code_a"]}: 区间涨幅 {ret_a:+.2f}%, 最大回撤 {a_trough * 100:.2f}% ({a_trough_date.date()}), 峰值 {a_peak_date.date()}')
    print(f'{cfg["title_b"]} {cfg["code_b"]}: 区间涨幅 {ret_b:+.2f}%, 最大回撤 {b_trough * 100:.2f}% ({b_trough_date.date()}), 峰值 {b_peak_date.date()}')
    print(f'数据区间: {d0} ~ {d1} ({len(a)} 个交易日)')


def main():
    groups = sys.argv[1:] if len(sys.argv) > 1 else list(GROUPS.keys())
    for grp in groups:
        if grp in GROUPS:
            render_pair(GROUPS[grp])


if __name__ == '__main__':
    main()
