#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成指数估值数据 data/valuation.json (PE/PB 历史序列)
源: 乐咕乐股 (akshare stock_index_pe_lg / stock_index_pb_lg)
覆盖: 沪深300 000300 / 中证500 000905 / 中证1000 000852 (乐咕仅支持这 3 个)
其余指数 (A500/红利/创业板指) 乐咕无历史估值, 前端显示"暂无估值数据"
"""
import json
import sys
import akshare as ak

OUT = 'data/valuation.json'

# 乐咕指数名称映射 (akshare 参数)
LG_MAP = {
    '000300': ('沪深300', '000300.SH'),
    '000905': ('中证500', '000905.SH'),
    '000852': ('中证1000', '000852.SH'),
}

# PE 取"滚动市盈率"列, PB 取"市净率"列
def fetch_one(code):
    name, _ = LG_MAP[code]
    pe_df = ak.stock_index_pe_lg(symbol=name)
    pb_df = ak.stock_index_pb_lg(symbol=name)
    pe_rows = [{'date': str(r['日期']), 'value': round(float(r['滚动市盈率']), 2)}
               for _, r in pe_df.iterrows() if r['滚动市盈率'] == r['滚动市盈率']]
    pb_rows = [{'date': str(r['日期']), 'value': round(float(r['市净率']), 3)}
               for _, r in pb_df.iterrows() if r['市净率'] == r['市净率']]
    return {'pe': pe_rows, 'pb': pb_rows}

def main():
    data = {'updated': '', 'series': {}}
    for code in LG_MAP:
        try:
            series = fetch_one(code)
            data['series'][code] = series
            n = len(series['pe'])
            print(f'{code} OK pe={n} rows pe最新={series["pe"][-1]} pb最新={series["pb"][-1]}')
        except Exception as e:
            print(f'{code} FAIL: {e}', file=sys.stderr)
    if not data['series']:
        print('无任何数据', file=sys.stderr)
        sys.exit(1)
    # 数据日期 = 最新 PE 日期
    first_code = next(iter(data['series']))
    data['updated'] = data['series'][first_code]['pe'][-1]['date']
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    print(f'written {OUT}, updated={data["updated"]}')

if __name__ == '__main__':
    main()
