# -*- coding: utf-8 -*-
"""生成成长ETF(159259) 与 价值ETF(159263) 过去6个月走势图 + 最大回撤图"""
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
import os

# ---------- 全局样式 ----------
from matplotlib import font_manager as _fm
for _f in ['/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/PingFang.ttc']:
    try:
        _fm.fontManager.addfont(_f)
    except Exception:
        pass
plt.rcParams['font.family'] = ['Hiragino Sans GB', 'PingFang HK', 'Heiti TC', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.dpi'] = 150

# 配色（浅色专业风）
BG      = '#ffffff'
GRID    = '#e8ecf1'
TXT     = '#1e293b'
SUB     = '#64748b'
GROWTH  = '#e0522a'   # 成长：暖橙红
VALUE   = '#2563eb'   # 价值：亮蓝
DD_FILL = '#ef4444'   # 回撤填充

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
os.makedirs(OUT, exist_ok=True)

# ---------- 读取数据 ----------
def load(code):
    df = pd.read_csv(f'/tmp/etf_{code}.csv')
    df['日期'] = pd.to_datetime(df['日期'])
    df = df.sort_values('日期').reset_index(drop=True)
    return df

g = load('159259')   # 成长
v = load('159263')   # 价值

def drawdown(close):
    """回撤序列: 当前净值相对历史峰值回撤比例(负数)"""
    peak = close.cummax()
    return close / peak - 1.0

g['dd'] = drawdown(g['收盘'])
v['dd'] = drawdown(v['收盘'])

def max_dd_info(df):
    dd = df['dd']
    trough_idx = dd.idxmin()
    trough = dd[trough_idx]
    peak_date = df.loc[:trough_idx, '日期'][df.loc[:trough_idx, '收盘'].idxmax()]
    return trough, df.loc[trough_idx, '日期'], peak_date

g_trough, g_trough_date, g_peak_date = max_dd_info(g)
v_trough, v_trough_date, v_peak_date = max_dd_info(v)

def style_ax(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color(GRID)
    ax.spines['bottom'].set_color(GRID)
    ax.tick_params(colors=SUB, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)

def date_ticks(ax, n=6):
    loc = mdates.AutoDateLocator(minticks=4, maxticks=n)
    ax.xaxis.set_major_locator(loc)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d'))
    ax.tick_params(axis='x', rotation=0)

# ---------- 图1: 成长ETF 走势 ----------
fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=BG)
ax.set_facecolor(BG)
ax.plot(g['日期'], g['收盘'], color=GROWTH, linewidth=2.2, label='成长ETF (159259)', zorder=3)
ax.fill_between(g['日期'], g['收盘'], g['收盘'].min(), color=GROWTH, alpha=0.06, zorder=1)
# 均线
g['ma20'] = g['收盘'].rolling(20).mean()
ax.plot(g['日期'], g['ma20'], color=GROWTH, linewidth=1.1, alpha=0.55, ls='--', label='MA20', zorder=2)

ax.set_title('成长ETF (159259) 过去6个月走势', fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('净值（元）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)

ret = (g['收盘'].iloc[-1] / g['收盘'].iloc[0] - 1) * 100
ax.annotate(f'区间涨幅 {ret:+.1f}%', xy=(g['日期'].iloc[-1], g['收盘'].iloc[-1]),
            xytext=(-8, 10), textcoords='offset points', ha='right', fontsize=10,
            color=GROWTH, fontweight='bold')
ax.legend(loc='upper left', frameon=False, fontsize=9)
fig.tight_layout()
fig.savefig(f'{OUT}/growth_trend.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 图2: 价值ETF 走势 ----------
fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=BG)
ax.set_facecolor(BG)
ax.plot(v['日期'], v['收盘'], color=VALUE, linewidth=2.2, label='价值ETF (159263)', zorder=3)
ax.fill_between(v['日期'], v['收盘'], v['收盘'].min(), color=VALUE, alpha=0.06, zorder=1)
v['ma20'] = v['收盘'].rolling(20).mean()
ax.plot(v['日期'], v['ma20'], color=VALUE, linewidth=1.1, alpha=0.55, ls='--', label='MA20', zorder=2)

ax.set_title('价值ETF (159263) 过去6个月走势', fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('净值（元）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)

ret_v = (v['收盘'].iloc[-1] / v['收盘'].iloc[0] - 1) * 100
ax.annotate(f'区间涨幅 {ret_v:+.1f}%', xy=(v['日期'].iloc[-1], v['收盘'].iloc[-1]),
            xytext=(-8, 10), textcoords='offset points', ha='right', fontsize=10,
            color=VALUE, fontweight='bold')
ax.legend(loc='upper left', frameon=False, fontsize=9)
fig.tight_layout()
fig.savefig(f'{OUT}/value_trend.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 图3: 成长ETF 最大回撤 ----------
fig, ax = plt.subplots(figsize=(10, 4.6), facecolor=BG)
ax.set_facecolor(BG)
ax.fill_between(g['日期'], g['dd'] * 100, 0, color=DD_FILL, alpha=0.22, zorder=1)
ax.plot(g['日期'], g['dd'] * 100, color=DD_FILL, linewidth=1.8, zorder=2)

ax.axhline(0, color=TXT, linewidth=0.8)
ax.set_title(f'成长ETF (159259) 最大回撤走势 — 最大回撤 {g_trough*100:.2f}%',
             fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('回撤（%）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)
ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))

ax.scatter([g_trough_date], [g_trough*100], color=DD_FILL, s=46, zorder=5, edgecolor='white', linewidth=1.2)
ax.annotate(f'最大回撤 {g_trough*100:.2f}%\n{g_trough_date.date()}',
            xy=(g_trough_date, g_trough*100), xytext=(-18, -52), textcoords='offset points',
            ha='center', fontsize=9.5, color='#b91c1c', fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#b91c1c', lw=1.2))
fig.tight_layout()
fig.savefig(f'{OUT}/growth_drawdown.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 图4: 价值ETF 最大回撤 ----------
fig, ax = plt.subplots(figsize=(10, 4.6), facecolor=BG)
ax.set_facecolor(BG)
ax.fill_between(v['日期'], v['dd'] * 100, 0, color=DD_FILL, alpha=0.22, zorder=1)
ax.plot(v['日期'], v['dd'] * 100, color=DD_FILL, linewidth=1.8, zorder=2)

ax.axhline(0, color=TXT, linewidth=0.8)
ax.set_title(f'价值ETF (159263) 最大回撤走势 — 最大回撤 {v_trough*100:.2f}%',
             fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('回撤（%）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)
ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))

ax.scatter([v_trough_date], [v_trough*100], color=DD_FILL, s=46, zorder=5, edgecolor='white', linewidth=1.2)
ax.annotate(f'最大回撤 {v_trough*100:.2f}%\n{v_trough_date.date()}',
            xy=(v_trough_date, v_trough*100), xytext=(-18, -52), textcoords='offset points',
            ha='center', fontsize=9.5, color='#b91c1c', fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#b91c1c', lw=1.2))
fig.tight_layout()
fig.savefig(f'{OUT}/value_drawdown.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 图5: 双基金归一化对比走势 ----------
fig, ax = plt.subplots(figsize=(10, 5.2), facecolor=BG)
ax.set_facecolor(BG)
gn = g['收盘'] / g['收盘'].iloc[0] * 100
vn = v['收盘'] / v['收盘'].iloc[0] * 100
ax.plot(g['日期'], gn, color=GROWTH, linewidth=2.2, label='成长ETF (159259)', zorder=3)
ax.plot(v['日期'], vn, color=VALUE, linewidth=2.2, label='价值ETF (159263)', zorder=3)
ax.axhline(100, color=SUB, linewidth=0.9, ls=':', alpha=0.7)

ax.set_title('成长 vs 价值 ETF 过去6个月走势对比（起点归一化 = 100）',
             fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('归一化净值（起点=100）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)

ax.annotate(f'成长 {ret:+.1f}%', xy=(g['日期'].iloc[-1], gn.iloc[-1]),
            xytext=(-8, 12), textcoords='offset points', ha='right', fontsize=10,
            color=GROWTH, fontweight='bold')
ax.annotate(f'价值 {ret_v:+.1f}%', xy=(v['日期'].iloc[-1], vn.iloc[-1]),
            xytext=(-8, -16), textcoords='offset points', ha='right', fontsize=10,
            color=VALUE, fontweight='bold')
ax.legend(loc='upper left', frameon=False, fontsize=9)
fig.tight_layout()
fig.savefig(f'{OUT}/compare_trend.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 图6: 双基金最大回撤对比 ----------
fig, ax = plt.subplots(figsize=(10, 4.6), facecolor=BG)
ax.set_facecolor(BG)
ax.fill_between(g['日期'], g['dd'] * 100, 0, color=GROWTH, alpha=0.13, zorder=1)
ax.fill_between(v['日期'], v['dd'] * 100, 0, color=VALUE, alpha=0.13, zorder=1)
ax.plot(g['日期'], g['dd'] * 100, color=GROWTH, linewidth=1.8, label=f'成长ETF 最大回撤 {g_trough*100:.2f}%', zorder=2)
ax.plot(v['日期'], v['dd'] * 100, color=VALUE, linewidth=1.8, label=f'价值ETF 最大回撤 {v_trough*100:.2f}%', zorder=2)
ax.axhline(0, color=TXT, linewidth=0.8)

ax.set_title('成长 vs 价值 ETF 最大回撤对比', fontsize=15, fontweight='bold', color=TXT, pad=14)
ax.set_ylabel('回撤（%）', color=SUB, fontsize=10)
style_ax(ax); date_ticks(ax)
ax.yaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%'))
ax.legend(loc='lower left', frameon=False, fontsize=9)
fig.tight_layout()
fig.savefig(f'{OUT}/compare_drawdown.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 输出统计 ----------
print('=== 统计指标 ===')
print(f'成长ETF 159259: 区间涨幅 {ret:+.2f}%, 最大回撤 {g_trough*100:.2f}% ({g_trough_date.date()}), 峰值日 {g_peak_date.date()}')
print(f'价值ETF 159263: 区间涨幅 {ret_v:+.2f}%, 最大回撤 {v_trough*100:.2f}% ({v_trough_date.date()}), 峰值日 {v_peak_date.date()}')
print(f'数据区间: {g["日期"].iloc[0].date()} ~ {g["日期"].iloc[-1].date()} ({len(g)} 个交易日)')
print('图片输出目录:', OUT)
print(sorted(os.listdir(OUT)))
