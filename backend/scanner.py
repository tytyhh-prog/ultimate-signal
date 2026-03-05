"""
pykrx 기반 한국 주식 스캔 엔진
KOSPI/KOSDAQ 전종목에서 기술적 분석 조건 필터링
"""
from pykrx import stock as krx
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import concurrent.futures
import logging
import time

logger = logging.getLogger(__name__)

# 5분 캐시 (Render free tier 콜드스타트 대비)
_cache = {'data': None, 'timestamp': 0}
CACHE_TTL = 300

# KOSPI 업종 지수 코드 매핑
SECTOR_INDEX_MAP = [
    ('2차전지/전기차', '1008'),   # 화학
    ('반도체',         '1013'),   # 전기전자
    ('IT/소프트웨어',  '1025'),   # 서비스업
    ('바이오/제약',    '1009'),   # 의약품
    ('자동차',         '1015'),   # 운수장비
    ('건설',           '1018'),   # 건설업
    ('금융',           '1021'),   # 금융업
    ('철강/소재',      '1011'),   # 철강금속
]

APP_SECTORS = [name for name, _ in SECTOR_INDEX_MAP]


# ─────────────────────────────────────────
# 유틸리티
# ─────────────────────────────────────────

def safe_float(val, default=0.0):
    try:
        return float(val) if pd.notna(val) else default
    except Exception:
        return default


def safe_int(val, default=0):
    try:
        return int(val) if pd.notna(val) else default
    except Exception:
        return default


def calc_ma(series, period):
    if len(series) < period:
        return 0.0
    return float(series.iloc[-period:].mean())


def get_col(df, candidates, fallback_idx=None):
    """컬럼명 후보 중 존재하는 첫 번째 반환, 없으면 fallback_idx 인덱스 컬럼 사용"""
    for c in candidates:
        if c in df.columns:
            return c
    if fallback_idx is not None and len(df.columns) > fallback_idx:
        return df.columns[fallback_idx]
    return None


# ─────────────────────────────────────────
# 마지막 거래일 탐지
# ─────────────────────────────────────────

def get_last_trading_date():
    for i in range(10):
        d = datetime.today() - timedelta(days=i)
        date_str = d.strftime('%Y%m%d')
        try:
            df = krx.get_market_ohlcv_by_ticker(date_str, market='KOSPI')
            if df is not None and len(df) > 100:
                return date_str
        except Exception:
            continue
    return (datetime.today() - timedelta(days=1)).strftime('%Y%m%d')


# ─────────────────────────────────────────
# 개별 종목 기술적 분석
# ─────────────────────────────────────────

def process_stock(info):
    ticker  = info['ticker']
    name    = info['name']
    price   = info['price']
    volume  = info['volume']
    market_cap = info['marketCap']
    per     = info['per']
    pbr     = info['pbr']

    try:
        end_dt   = datetime.today().strftime('%Y%m%d')
        start_dt = (datetime.today() - timedelta(days=420)).strftime('%Y%m%d')

        hist = krx.get_market_ohlcv_by_date(start_dt, end_dt, ticker)
        if hist is None or len(hist) < 20:
            return None

        # pykrx 컬럼: 시가, 고가, 저가, 종가, 거래량
        close_col = get_col(hist, ['종가', 'Close'], fallback_idx=3)
        vol_col   = get_col(hist, ['거래량', 'Volume'], fallback_idx=4)

        close = hist[close_col].astype(float)
        vol_series = hist[vol_col].astype(float)

        ma50  = round(calc_ma(close, 50))
        ma150 = round(calc_ma(close, 150))
        ma200 = round(calc_ma(close, 200))

        # MA200 트렌드 (20일 전 대비)
        if len(close) >= 220:
            ma200_20ago = float(close.iloc[:-20].iloc[-200:].mean())
        else:
            ma200_20ago = ma200
        ma200_trend = 'up' if (ma200 > 0 and ma200 > ma200_20ago) else 'down'

        # 평균 거래량 20일
        avg_vol = float(vol_series.iloc[-20:].mean()) if len(vol_series) >= 20 else float(vol_series.mean())
        volume_ratio = round(volume / avg_vol * 100) if avg_vol > 0 else 100

        # 52주 고/저가
        n = min(len(close), 252)
        week52_high = round(float(close.iloc[-n:].max()))
        week52_low  = round(float(close.iloc[-n:].min()))

        # 수익률
        def calc_return(days):
            if len(close) < days:
                return 0
            past = float(close.iloc[-days])
            return round((price - past) / past * 100, 1) if past > 0 else 0

        return1m  = calc_return(20)
        return3m  = calc_return(60)
        return6m  = calc_return(120)
        return12m = calc_return(240)

        # Weinstein Stage
        stage = 1
        if len(close) >= 150:
            if price > ma150 and ma200_trend == 'up':
                stage = 2
            elif price > ma150:
                stage = 3
            elif ma200_trend == 'down':
                stage = 4

        # Minervini VCP
        vcp = False
        if len(close) >= 60:
            ranges = []
            for i in range(3):
                s_i = -(45 - i * 15)
                e_i = -(30 - i * 15) if (30 - i * 15) > 0 else None
                seg = close.iloc[s_i:e_i]
                if len(seg) > 0:
                    h, l = float(seg.max()), float(seg.min())
                    ranges.append((h - l) / h * 100 if h > 0 else 0)
            if len(ranges) == 3:
                vcp = ranges[0] > ranges[1] > ranges[2] and ranges[2] < 10

        # Darvas Box
        darvas_clear    = False
        darvas_breakout = False
        if len(close) >= 20:
            recent20  = close.iloc[-20:]
            box_high  = float(recent20.max())
            box_low   = float(recent20.min())
            if box_high > 0:
                box_range       = (box_high - box_low) / box_high * 100
                darvas_clear    = 3 < box_range < 20
                darvas_breakout = price > box_high and volume_ratio > 200

        recent_drop  = calc_return(5)
        is_breakout  = week52_high > 0 and price >= week52_high * 0.97
        ma30w_slope  = (
            'strong_up' if (ma200 > 0 and ma200_20ago > 0 and ma200 > ma200_20ago * 1.02)
            else ('up' if ma200_trend == 'up' else 'down')
        )

        return {
            'ticker': ticker,
            'name': name,
            'sector': info.get('sector', ''),
            'price': int(price),
            'change': round(info.get('change', 0.0), 2),
            'volume': int(volume),
            'volumeRatio': int(volume_ratio),
            'marketCap': int(market_cap),
            'sharesOutstanding': int(info.get('shares', 0)),
            # pykrx는 수급 데이터 미제공 → 0
            'instNetBuy': 0,
            'foreignNetBuy': 0,
            'retailNetBuy': 0,
            'instConsecutiveDays': 0,
            'foreignConsecutiveDays': 0,
            'instAlwaysBuy': False,
            'instMultipleBuyers': False,
            'creditRatio': 0,
            'lendingIncrease': 0,
            'recentDrop': recent_drop,
            'volumeEarlyBreak': volume_ratio > 150,
            'ma50': int(ma50),
            'ma150': int(ma150),
            'ma200': int(ma200),
            'ma200Trend': ma200_trend,
            'week52High': int(week52_high),
            'week52Low': int(week52_low),
            'vcpContraction': vcp,
            'vcpVolumeBreak': vcp and volume_ratio > 150,
            'quarterlyEarningsGrowth': 0,
            'annualEarningsYears': 0,
            'isNewHigh': is_breakout,
            'sectorRank': 20,
            'instNewBuyers': 0,
            'kospiAbove200': True,
            'breakoutResistance': is_breakout,
            'breakoutVolume': int(volume_ratio),
            'closedAboveResistance': is_breakout,
            'trendDirection': ma200_trend,
            'stage': stage,
            'ma30wSlope': ma30w_slope,
            'volumeAboveAvg': volume_ratio > 100,
            'darvasBoxClear': darvas_clear,
            'darvasBreakout': darvas_breakout,
            'darvasSupport': False,
            'returns1m': return1m,
            'returns3m': return3m,
            'returns6m': return6m,
            'returns12m': return12m,
            'pbr': round(pbr, 2),
            'roe': round(pbr / per * 100, 1) if per > 0 and pbr > 0 else 0,
            'debtRatio': 50,
            'operatingMargin': 10,
            'nearHigh52': week52_high > 0 and price >= week52_high * 0.9,
            'volumeSurge': volume_ratio > 200,
            'momentumRank': 10 if return12m > 20 else (20 if return12m > 10 else 40),
            'roeRank': 25,
            'operatingMarginRank': 25,
            'debtRatioRank': 75,
            'pbrRank': 80 if pbr < 1 else (65 if pbr < 1.5 else (45 if pbr < 3 else 25)),
            'perRank': 75 if 0 < per < 10 else (55 if per < 20 else 35),
            'psrRank': 50,
            'volatilityRank': 50,
            'beta': 1.0,
            'targetPriceRevisionUp': False,
            'earningSurprise': False,
            'orderBook': {
                'totalBid': 0, 'totalAsk': 0, 'bidRatio': 50,
                'bidDominant': False, 'askDisappearing': False,
            },
            'derivatives': {
                'instFuturesBuy': False, 'instFuturesAmount': 0,
                'callDominant': False, 'putCallRatio': 1.0, 'callOIIncreasing': False,
            },
        }

    except Exception as e:
        logger.warning(f'[{ticker}] {name} 처리 실패: {e}')
        return None


# ─────────────────────────────────────────
# 시장 지수 (KOSPI/KOSDAQ)
# ─────────────────────────────────────────

def get_market_indices(date_str):
    try:
        start = (datetime.today() - timedelta(days=300)).strftime('%Y%m%d')

        ki = krx.get_index_ohlcv_by_date(start, date_str, '1001')  # KOSPI
        kq = krx.get_index_ohlcv_by_date(start, date_str, '2001')  # KOSDAQ

        close_col = get_col(ki, ['종가', 'Close'], fallback_idx=3)

        kospi_price  = float(ki[close_col].iloc[-1])
        kospi_prev   = float(ki[close_col].iloc[-2]) if len(ki) > 1 else kospi_price
        kospi_change = round((kospi_price - kospi_prev) / kospi_prev * 100, 2) if kospi_prev > 0 else 0.0

        qclose_col   = get_col(kq, ['종가', 'Close'], fallback_idx=3)
        kosdaq_price  = float(kq[qclose_col].iloc[-1]) if kq is not None and len(kq) > 0 else 0.0
        kosdaq_prev   = float(kq[qclose_col].iloc[-2]) if kq is not None and len(kq) > 1 else kosdaq_price
        kosdaq_change = round((kosdaq_price - kosdaq_prev) / kosdaq_prev * 100, 2) if kosdaq_prev > 0 else 0.0

        kospi_ma200    = float(ki[close_col].iloc[-200:].mean()) if len(ki) >= 200 else 0.0
        kospi_above200 = bool(kospi_price > kospi_ma200) if kospi_ma200 > 0 else True

        return {
            'kospi': round(kospi_price, 2),
            'kospiChange': kospi_change,
            'kosdaq': round(kosdaq_price, 2),
            'kosdaqChange': kosdaq_change,
            'marketStatus': 'live',
            'kospiAbove200': kospi_above200,
        }
    except Exception as e:
        logger.error(f'지수 조회 오류: {e}')
        return {
            'kospi': 0, 'kospiChange': 0,
            'kosdaq': 0, 'kosdaqChange': 0,
            'marketStatus': 'closed', 'kospiAbove200': True,
        }


# ─────────────────────────────────────────
# 업종별 등락률 (KOSPI 업종 지수)
# ─────────────────────────────────────────

def get_sectors(date_str):
    start = (datetime.today() - timedelta(days=5)).strftime('%Y%m%d')
    result = []
    for name, code in SECTOR_INDEX_MAP:
        try:
            df = krx.get_index_ohlcv_by_date(start, date_str, code)
            if df is None or len(df) < 2:
                change = 0.0
            else:
                close_col = get_col(df, ['종가', 'Close'], fallback_idx=3)
                last  = float(df[close_col].iloc[-1])
                prev  = float(df[close_col].iloc[-2])
                change = round((last - prev) / prev * 100, 2) if prev > 0 else 0.0
        except Exception as e:
            logger.warning(f'업종 지수 오류 [{name}/{code}]: {e}')
            change = 0.0

        trend = 'up' if change > 0.5 else ('down' if change < -0.5 else 'neutral')
        result.append({'name': name, 'netBuy': 0, 'change': change, 'trend': trend})
    return result


# ─────────────────────────────────────────
# 메인 스캔 (5분 캐시)
# ─────────────────────────────────────────

def run_scan():
    global _cache
    now = time.time()
    if _cache['data'] and (now - _cache['timestamp']) < CACHE_TTL:
        remaining = int(CACHE_TTL - (now - _cache['timestamp']))
        logger.info(f'캐시 반환 (갱신까지 {remaining}초)')
        return _cache['data']

    logger.info('=== 스캔 시작 ===')
    t0 = time.time()

    date_str = get_last_trading_date()
    logger.info(f'기준일: {date_str}')

    empty_sectors = [{'name': n, 'netBuy': 0, 'change': 0, 'trend': 'neutral'} for n, _ in SECTOR_INDEX_MAP]

    # 1. 전종목 OHLCV (당일)
    logger.info('KOSPI/KOSDAQ 전종목 조회...')
    try:
        kospi_ohlcv  = krx.get_market_ohlcv_by_ticker(date_str, market='KOSPI')
        kosdaq_ohlcv = krx.get_market_ohlcv_by_ticker(date_str, market='KOSDAQ')
    except Exception as e:
        logger.error(f'전종목 OHLCV 오류: {e}')
        return {'stocks': [], 'market': get_market_indices(date_str), 'sectors': empty_sectors}

    # 2. 시가총액 / 상장주식수
    try:
        kospi_cap  = krx.get_market_cap_by_ticker(date_str, market='KOSPI')
        kosdaq_cap = krx.get_market_cap_by_ticker(date_str, market='KOSDAQ')
    except Exception as e:
        logger.warning(f'시총 조회 오류: {e}')
        kospi_cap  = pd.DataFrame()
        kosdaq_cap = pd.DataFrame()

    # 3. 펀더멘털 (PER, PBR)
    try:
        kospi_fund  = krx.get_market_fundamental_by_ticker(date_str, market='KOSPI')
        kosdaq_fund = krx.get_market_fundamental_by_ticker(date_str, market='KOSDAQ')
    except Exception as e:
        logger.warning(f'펀더멘털 조회 오류: {e}')
        kospi_fund  = pd.DataFrame()
        kosdaq_fund = pd.DataFrame()

    # 4. 병합 (KOSPI)
    def merge_market(ohlcv_df, cap_df, fund_df, market_name):
        if ohlcv_df is None or len(ohlcv_df) == 0:
            return pd.DataFrame()
        df = ohlcv_df.copy()
        df['_market'] = market_name
        if cap_df is not None and len(cap_df) > 0:
            cap_cols = {get_col(cap_df, ['시가총액'], fallback_idx=0): '시가총액',
                        get_col(cap_df, ['상장주식수'], fallback_idx=1): '상장주식수'}
            for src, dst in cap_cols.items():
                if src and src in cap_df.columns:
                    df[dst] = cap_df[src].reindex(df.index).fillna(0)
        if fund_df is not None and len(fund_df) > 0:
            for col in ['PER', 'PBR']:
                if col in fund_df.columns:
                    df[col] = fund_df[col].reindex(df.index).fillna(0)
        return df

    kospi_df  = merge_market(kospi_ohlcv,  kospi_cap,  kospi_fund,  'KOSPI')
    kosdaq_df = merge_market(kosdaq_ohlcv, kosdaq_cap, kosdaq_fund, 'KOSDAQ')
    all_df    = pd.concat([kospi_df, kosdaq_df], ignore_index=False)
    logger.info(f'전체 종목: {len(all_df)}개')

    # 5. 컬럼 탐지
    close_col  = get_col(all_df, ['종가', 'Close'],       fallback_idx=3)
    vol_col    = get_col(all_df, ['거래량', 'Volume'],     fallback_idx=4)
    cap_col    = '시가총액' if '시가총액' in all_df.columns else None
    shares_col = '상장주식수' if '상장주식수' in all_df.columns else None
    per_col    = 'PER' if 'PER' in all_df.columns else None
    pbr_col    = 'PBR' if 'PBR' in all_df.columns else None

    if not close_col:
        logger.error(f'종가 컬럼 없음. 가용: {list(all_df.columns)}')
        return {'stocks': [], 'market': get_market_indices(date_str), 'sectors': empty_sectors}

    # 6. 수치 변환
    all_df['_close']  = pd.to_numeric(all_df[close_col],                       errors='coerce').fillna(0)
    all_df['_vol']    = pd.to_numeric(all_df[vol_col],   errors='coerce').fillna(0) if vol_col   else 0
    all_df['_cap']    = pd.to_numeric(all_df[cap_col],   errors='coerce').fillna(0) if cap_col   else 0
    all_df['_shares'] = pd.to_numeric(all_df[shares_col],errors='coerce').fillna(0) if shares_col else 0
    all_df['_per']    = pd.to_numeric(all_df[per_col],   errors='coerce').fillna(0) if per_col   else 0
    all_df['_pbr']    = pd.to_numeric(all_df[pbr_col],   errors='coerce').fillna(0) if pbr_col   else 0

    # 7. 필터: 가격 ≥ 1,000원, 시총 ≥ 500억
    filtered = all_df[
        (all_df['_close'] >= 1_000) &
        (all_df['_cap']   >= 50_000_000_000)
    ].copy()
    logger.info(f'기본 필터 후: {len(filtered)}개')

    # 거래량 TOP 50
    filtered = filtered.sort_values('_vol', ascending=False).head(50)

    # 8. 종목 정보 리스트 구성
    stock_infos = []
    for ticker, row in filtered.iterrows():
        ticker_str = str(ticker).strip().zfill(6)
        if not ticker_str or ticker_str == '000000':
            continue
        try:
            name = krx.get_market_ticker_name(ticker_str)
        except Exception:
            name = ticker_str

        # 당일 등락률 계산 (시가 → 종가)
        open_col = get_col(all_df, ['시가', 'Open'], fallback_idx=0)
        if open_col and open_col in row.index:
            open_price = safe_float(row.get(open_col, 0))
            change = round((row['_close'] - open_price) / open_price * 100, 2) if open_price > 0 else 0.0
        else:
            change = 0.0

        stock_infos.append({
            'ticker':    ticker_str,
            'name':      name,
            'sector':    '',
            'price':     safe_float(row['_close']),
            'change':    change,
            'volume':    safe_int(row['_vol']),
            'marketCap': safe_int(row['_cap']) // 100_000_000,  # 억 단위
            'shares':    safe_int(row['_shares']),
            'per':       safe_float(row['_per']),
            'pbr':       safe_float(row['_pbr']),
        })

    logger.info(f'분석 대상: {len(stock_infos)}개')

    # 9. 병렬 히스토리 조회 + 기술적 분석
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(process_stock, info): info['ticker'] for info in stock_infos}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)

    elapsed = time.time() - t0
    logger.info(f'분석 완료: {len(results)}/{len(stock_infos)}개 ({elapsed:.1f}초)')

    # 10. 업종별 지수 등락률
    sectors = get_sectors(date_str)

    # 11. 시장 지수
    market = get_market_indices(date_str)

    data = {'stocks': results, 'market': market, 'sectors': sectors}
    _cache['data']      = data
    _cache['timestamp'] = time.time()
    return data
