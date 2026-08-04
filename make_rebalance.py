# -*- coding: utf-8 -*-
"""50/50 定期再平衡策略回测: 成长ETF(159259) + 价值ETF(159263)
初始各投入 10000 元, 每两周(10个交易日)再平衡至 50%:50%
再平衡方式: 卖出权重超标的一方, 买入权重不足的一方(即"买入净值较低/表现较弱的那一个")
"""
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
from matplotlib import font_manager as _fm
import os

# ---------- 字体 ----------
for _f in ['/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/PingFang.ttc']:
    try:
        _fm.fontManager.addfont(_f)
    except Exception:
        pass
plt.rcParams['font.family'] = ['Hiragino Sans GB', 'PingFang HK', 'Heiti TC', 'Arial Unicode MS']
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['figure.dpi'] = 150
plt.rcParams['savefig.dpi'] = 150

BG      = '#ffffff'
GRID    = '#e8ecf1'
TXT     = '#1e293b'
SUB     = '#64748b'
GROWTH  = '#e0522a'
VALUE   = '#2563eb'
PORT    = '#7c3aed'   # 再平衡组合: 紫
BHOLD   = '#94a3b8'   # 买入持有对比: 灰

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')

# ---------- 数据 ----------
def load(code):
    df = pd.read_csv(f'/tmp/etf_{code}.csv')
    df['日期'] = pd.to_datetime(df['日期'])
    return df.sort_values('日期').reset_index(drop=True)

g = load('159259')
v = load('159263')

assert len(g) == len(v), '两只ETF交易日数不一致'
n = len(g)
dates = g['日期'].values
g_close = g['收盘'].values
v_close = v['收盘'].values

INIT = 10000.0           # 每只初始投入
REBAL_INTERVAL = 10      # 每10个交易日(约两周)再平衡
TARGET = 0.5             # 目标权重 50%

# ---------- 回测 ----------
g_shares = INIT / g_close[0]   # 初始份额
v_shares = INIT / v_close[0]

port_value = np.zeros(n)   # 再平衡组合每日总市值
bh_value   = np.zeros(n)   # 买入持有(对照)每日总市值
weights_g  = np.zeros(n)   # 记录成长权重, 观察偏离
rebal_days = []            # 实际再平衡日索引

for i in range(n):
    g_mv = g_shares * g_close[i]
    v_mv = v_shares * v_close[i]
    total = g_mv + v_mv
    port_value[i] = total
    weights_g[i] = g_mv / total if total > 0 else 0

    # 每 REBAL_INTERVAL 个交易日收盘后调仓(第0天为初始建仓, 不需再平衡)
    if i > 0 and i % REBAL_INTERVAL == 0:
        half = total / 2.0
        g_shares = half / g_close[i]
        v_shares = half / v_close[i]
        rebal_days.append(i)

# 买入持有对照: 份额始终不变
g_shares_bh = INIT / g_close[0]
v_shares_bh = INIT / v_close[0]
for i in range(n):
    bh_value[i] = g_shares_bh * g_close[i] + v_shares_bh * v_close[i]

port_ret = (port_value / (2 * INIT) - 1) * 100   # 组合收益率%
bh_ret   = (bh_value / (2 * INIT) - 1) * 100

# ---------- 组合最大回撤 ----------
peak = np.maximum.accumulate(port_value)
port_dd = (port_value / peak - 1) * 100
dd_min = port_dd.min()
dd_idx = int(port_dd.argmin())

# ---------- 绘图 ----------
fig, ax = plt.subplots(figsize=(10, 5.4), facecolor=BG)
ax.set_facecolor(BG)

# 再平衡日竖线(浅)
for rd in rebal_days:
    ax.axvline(dates[rd], color=PORT, linewidth=0.7, alpha=0.35, zorder=1)

# 买入持有对比
ax.plot(dates, bh_ret, color=BHOLD, linewidth=1.6, ls='--',
        label='买入持有（不操作）', zorder=2)
# 再平衡组合主线
ax.plot(dates, port_ret, color=PORT, linewidth=2.4,
        label='50/50 定期再平衡（每两周）', zorder=3)
ax.fill_between(dates, port_ret, port_ret.min(), color=PORT, alpha=0.06, zorder=1)

ax.axhline(0, color=TXT, linewidth=0.9, alpha=0.7)

ax.set_title('成长+价值 ETF 50/50 再平衡策略 — 合计收益率曲线（初始各 10,000 元）',
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
ax.xaxis.set_major_formatter(mdates.DateFormatter('%m-%d'))

# 终点标注
final_port = port_ret[-1]
final_bh = bh_ret[-1]
ax.annotate(f'再平衡 {final_port:+.2f}%', xy=(dates[-1], port_ret[-1]),
            xytext=(-10, 14), textcoords='offset points', ha='right',
            fontsize=10.5, color=PORT, fontweight='bold')
ax.annotate(f'买入持有 {final_bh:+.2f}%', xy=(dates[-1], bh_ret[-1]),
            xytext=(-10, -18), textcoords='offset points', ha='right',
            fontsize=10.5, color=BHOLD, fontweight='bold')

# 最大回撤标注
ax.scatter([dates[dd_idx]], [port_dd.min()], color='#dc2626', s=44, zorder=5,
           edgecolor='white', linewidth=1.2)
ax.annotate(f'组合最大回撤 {dd_min:.2f}%\n({dates[dd_idx].astype("datetime64[D]")})',
            xy=(dates[dd_idx], port_dd.min()), xytext=(-20, 48), textcoords='offset points',
            ha='center', fontsize=9.5, color='#b91c1c', fontweight='bold',
            arrowprops=dict(arrowstyle='->', color='#b91c1c', lw=1.2))

ax.legend(loc='upper left', frameon=False, fontsize=9.5)
fig.tight_layout()
fig.savefig(f'{OUT}/rebalance_trend.png', facecolor=BG, bbox_inches='tight')
plt.close(fig)

# ---------- 输出统计 ----------
n_rebal = len(rebal_days)
ann = (port_value[-1] / (2 * INIT)) ** (365.0 / 180) - 1
print(f'=== 再平衡策略回测结果 ===')
print(f'数据区间: {dates[0].astype("datetime64[D]")} ~ {dates[-1].astype("datetime64[D]")} ({n} 个交易日)')
print(f'再平衡次数: {n_rebal} 次 (每 {REBAL_INTERVAL} 个交易日)')
print(f'再平衡组合最终资产: {port_value[-1]:,.2f} 元, 收益率 {final_port:+.2f}%')
print(f'买入持有最终资产: {bh_value[-1]:,.2f} 元, 收益率 {final_bh:+.2f}%')
print(f'策略超额收益: {final_port - final_bh:+.2f} 个百分点')
print(f'组合最大回撤: {dd_min:.2f}% (发生于 {dates[dd_idx].astype("datetime64[D]")})')
print(f'年化收益率(约6个月): {ann*100:+.2f}%')
print(f'成长权重波动范围: {weights_g.min()*100:.1f}% ~ {weights_g.max()*100:.1f}%')
