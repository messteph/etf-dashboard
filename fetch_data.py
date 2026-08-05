# -*- coding: utf-8 -*-
"""拉取两只 ETF 日线数据到 data/ 目录 (2025-09-01 起, 前复权)
数据源优先级: 东方财富(push2his) -> 腾讯(ifzq) -> 新浪(sina)
带 UA + 重试, 单源失败自动切换, 避免限流导致任务失败
"""
import warnings
warnings.filterwarnings('ignore')

import os
import sys
import time
import requests
import pandas as pd
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

START = '20250901'
END = datetime.now().strftime('%Y%m%d')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
HEADERS = {'User-Agent': UA, 'Referer': 'https://quote.eastmoney.com/'}

# 沪深 ETF 前缀: 159xxx -> sz, 51xxxx -> sh
def _prefix(code):
    return 'sz' if code.startswith('159') else 'sh'


def _fetch_eastmoney(code, market=0):
    """东方财富日线 (前复权, 含全部字段)"""
    url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get'
    params = {
        'secid': f'{market}.{code}',
        'fields1': 'f1,f2,f3,f4,f5,f6',
        'fields2': 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        'klt': '101', 'fqt': '1', 'beg': START, 'end': END,
        'ut': '7eea3edcaed734bea9cbfc24409ed989',
    }
    r = requests.get(url, timeout=20, params=params, headers=HEADERS)
    r.raise_for_status()
    d = r.json()
    if not (d.get('data') and d['data'].get('klines')):
        raise ValueError('东财接口返回空')
    rows = [k.split(',') for k in d['data']['klines']]
    df = pd.DataFrame(rows, columns=[
        '日期', '开盘', '收盘', '最高', '最低', '成交量',
        '成交额', '振幅', '涨跌幅', '涨跌额', '换手率'])
    df['日期'] = pd.to_datetime(df['日期'])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    return df


def _fetch_tencent(code):
    """腾讯日线 (前复权): 日期,开盘,收盘,最高,最低,成交量
    注意: 腾讯接口日期参数必须带横线 (YYYY-MM-DD), 否则返回 param error"""
    start_fmt = f'{START[:4]}-{START[4:6]}-{START[6:]}'
    end_fmt = f'{END[:4]}-{END[4:6]}-{END[6:]}'
    url = ('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'
           f'?param={_prefix(code)}{code},day,{start_fmt},{end_fmt},400,qfq')
    r = requests.get(url, timeout=20, headers={'User-Agent': UA,
                                               'Referer': 'https://gu.qq.com/'})
    r.raise_for_status()
    d = r.json()
    key = f'{_prefix(code)}{code}'
    node = d.get('data', {})
    if not isinstance(node, dict):
        raise ValueError('腾讯接口返回结构异常')
    rows = (node.get(key, {}) or {}).get('day') or []
    if not rows:
        raise ValueError('腾讯接口返回空')
    df = pd.DataFrame(rows).iloc[:, :6]
    df.columns = ['日期', '开盘', '收盘', '最高', '最低', '成交量']
    df['日期'] = pd.to_datetime(df['日期'])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    # 计算涨跌幅/成交额等衍生列(与东财格式对齐)
    df['成交额'] = df['成交量'] * df['收盘']
    df['涨跌幅'] = df['收盘'].pct_change() * 100
    df['涨跌额'] = df['收盘'].diff()
    df['振幅'] = (df['最高'] - df['最低']) / df['收盘'].shift(1) * 100
    df['换手率'] = 0.0
    df = df[['日期', '开盘', '收盘', '最高', '最低', '成交量',
             '成交额', '振幅', '涨跌幅', '涨跌额', '换手率']]
    return df


def _fetch_sina(code):
    """新浪日线 (不复权): 日期,开盘,最高,最低,收盘,成交量"""
    url = ('https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20t=/'
           f'CN_MarketDataService.getKLineData?symbol={_prefix(code)}{code}'
           '&scale=240&ma=no&datalen=400')
    r = requests.get(url, timeout=20, headers={'User-Agent': UA,
                                               'Referer': 'https://finance.sina.com.cn/'})
    r.raise_for_status()
    text = r.text
    s = text.find('=(')
    e = text.rfind(')')
    if s < 0 or e < 0 or e <= s:
        raise ValueError('新浪接口返回格式异常')
    import json
    rows = json.loads(text[s + 2:e])
    if not rows:
        raise ValueError('新浪接口返回空')
    df = pd.DataFrame(rows)
    df = df.rename(columns={'day': '日期', 'open': '开盘', 'high': '最高',
                            'low': '最低', 'close': '收盘', 'volume': '成交量'})
    df = df[['日期', '开盘', '最高', '最低', '收盘', '成交量']]
    df['日期'] = pd.to_datetime(df['日期'])
    df = df[df['日期'] >= pd.Timestamp(START)].reset_index(drop=True)
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    # 新浪返回不复权, 与东财前复权可能有细微差异; 重新排列为东财列序
    df['成交额'] = df['成交量'] * df['收盘']
    df['涨跌幅'] = df['收盘'].pct_change() * 100
    df['涨跌额'] = df['收盘'].diff()
    df['振幅'] = (df['最高'] - df['最低']) / df['收盘'].shift(1) * 100
    df['换手率'] = 0.0
    df = df[['日期', '开盘', '收盘', '最高', '最低', '成交量',
             '成交额', '振幅', '涨跌幅', '涨跌额', '换手率']]
    return df


SOURCES = [
    ('东方财富', _fetch_eastmoney),
    ('腾讯', _fetch_tencent),
    ('新浪', _fetch_sina),
]


def fetch(code):
    last_err = None
    for name, fn in SOURCES:
        for attempt in range(3):
            try:
                df = fn(code)
                if len(df) >= 2:
                    print(f'[{code}] 来源={name} {len(df)} rows: '
                          f'{df["日期"].iloc[0].date()} ~ {df["日期"].iloc[-1].date()}')
                    return df
                last_err = ValueError(f'{name} 数据不足({len(df)})')
            except Exception as e:
                last_err = e
                print(f'[{code}] {name} 尝试 {attempt + 1}/3 失败: {e}', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'拉取 {code} 数据失败, 全部源不可用: {last_err}')


for code in ['159259', '159263']:
    df = fetch(code)
    path = os.path.join(DATA_DIR, f'etf_{code}.csv')
    df.to_csv(path, index=False)
    print(f'[{code}] saved -> {path}')
    time.sleep(8)
