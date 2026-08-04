# -*- coding: utf-8 -*-
"""共享工具: 字体配置 + 数据读取 (支持 macOS / Linux CI)"""
import os
import pandas as pd
from matplotlib import font_manager as _fm
import matplotlib

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
FALLBACK_DIR = '/tmp'  # 兼容旧路径

# 跨平台中文字体候选 (macOS 与 Linux CI)
FONT_FILES = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',   # macOS
    '/System/Library/Fonts/PingFang.ttc',           # macOS
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',  # Linux apt fonts-noto-cjk
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
]
FONT_NAMES = ['Hiragino Sans GB', 'PingFang HK', 'Noto Sans CJK SC',
              'Noto Sans CJK JP', 'Heiti TC', 'Arial Unicode MS', 'WenQuanYi Zen Hei']


def setup_font():
    for f in FONT_FILES:
        if os.path.exists(f):
            try:
                _fm.fontManager.addfont(f)
            except Exception:
                pass
    available = {f.name for f in _fm.fontManager.ttflist}
    for name in FONT_NAMES:
        if name in available:
            matplotlib.rcParams['font.family'] = [name, 'sans-serif']
            break
    matplotlib.rcParams['axes.unicode_minus'] = False
    matplotlib.rcParams['figure.dpi'] = 150
    matplotlib.rcParams['savefig.dpi'] = 150


def load(code):
    """读取 ETF 日线, 优先 data/ 目录 (CI 生成), 回退 /tmp (本地旧路径)"""
    for base in (DATA_DIR, FALLBACK_DIR):
        path = os.path.join(base, f'etf_{code}.csv')
        if os.path.exists(path):
            df = pd.read_csv(path)
            df['日期'] = pd.to_datetime(df['日期'])
            return df.sort_values('日期').reset_index(drop=True)
    raise FileNotFoundError(f'未找到 etf_{code}.csv (data/ 与 /tmp 均无)')
