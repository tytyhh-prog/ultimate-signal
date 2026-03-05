"""
FinanceDataReader 기반 한국 주식 스캔 엔진
KOSPI/KOSDAQ 전종목에서 기술적 분석 조건 필터링
"""
import FinanceDataReader as fdr
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

# FinanceDataReader 업종명 → 앱 섹터명 매핑
SECTOR_ALIAS = {
    '화학': '2차전지/전기차',
    '전기전자': '반도체',
    '전기,전자': '반도체',
    '전기·전자': '반도체',
    '서비스업': 'IT/소프트웨어',
    '소프트웨어': 'IT/소프트웨어',
    '통신업': 'IT/소프트웨어',
    '의약품': '바이오/제약',
    '의료정밀': '바이오/제약',
    '의료·정밀기기': '바이오/제약',
    '운수장비': '자동차',
    '건설업': '건설',
    '금융업': '금융',
    '은행': '금융',
    '보험': '금융',
    '증권': '금융',
    '철강금속': '철강/소재',
    '철강·금속': '철강/소재',
    '철강,금속': '철강/소재',
    '비금속광물': '철강/소재',
}

APP_SECTORS = [
    '2차전지/전기차', '반도체', 'IT/소프트웨어', '바이오/제약',
    '자동차', '건설', '금융', '철강/소재',
]


# ─────────────────────────────────────────
# 유틸리티
# ─────────────────────────────────────────

def find_col(df, candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


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


# ─────────────────────────────────────────
# 개별 종목 기술적 분석
# ─────────────────────────────────────────

def process_stock(info):
    ticker = info['ticker']
    name = info['name']
    sector_raw = info.get('sector', '')
    price = info['price']
    change = info.get('change', 0.0)
    volume = info.get('volume', 0)
    market_cap = info.get('marketCap', 0)   # 억 단위
    per = info.get('per', 0.0)
    pbr = info.get('pbr', 0.0)
    shares = info.get('shares', 0)

    try:
        end_dt = datetime.today().strftime('%Y-%m-%d')
        start_dt = (datetime.today() - timedelta(days=420)).strftime('%Y-%m-%d')
        hist = fdr.DataReader(ticker, start_dt, end_dt)

        if hist is None or len(hist) < 20:
            return None

        close = hist['Close'].astype(float)
        vol_series = hist['Volume'].astype(float) if 'Volume' in hist.columns else pd.Series([volume] * len(hist))

        ma50 = round(calc_ma(close, 50))
        ma150 = round(calc_ma(close, 150))
        ma200 = round(calc_ma(close, 200))

        # MA200 트렌드 (20일 전 대비)
        ma200_20ago = round(float(close.iloc[:-20].iloc[-200:].mean())) if len(close) >= 220 else ma200
        ma200_trend = 'up' if (ma200 > 0 and ma200 > ma200_20ago) else 'down'

        # 평균 거래량 20일
        avg_vol = float(vol_series.iloc[-20:].mean()) if len(vol_series) >= 20 else float(vol_series.mean())
        volume_ratio = round(volume / avg_vol * 100) if avg_vol > 0 else 100

        # 52주 고/저가
        n = min(len(close), 252)
        week52_high = round(float(close.iloc[-n:].max()))
        week52_low = round(float(close.iloc[-n:].min()))

        # 수익률
        def calc_return(days):
            if len(close) < days:
                return 0
            past = float(close.iloc[-days])
            return round((price - past) / past * 100, 1) if past > 0 else 0

        return1m = calc_return(20)
        return3m = calc_return(60)
        return6m = calc_return(120)
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
        darvas_clear = False
        darvas_breakout = False
        if len(close) >= 20:
            recent20 = close.iloc[-20:]
            box_high = float(recent20.max())
            box_low = float(recent20.min())
            if box_high > 0:
                box_range = (box_high - box_low) / box_high * 100
                darvas_clear = 3 < box_range < 20
                darvas_breakout = price > box_high and volume_ratio > 200

        recent_drop = calc_return(5)
        is_breakout = week52_high > 0 and price >= week52_high * 0.97
        app_sector = SECTOR_ALIAS.get(sector_raw, sector_raw)
        ma30w_slope = (
            'strong_up' if (ma200 > 0 and ma200_20ago > 0 and ma200 > ma200_20ago * 1.02)
            else ('up' if ma200_trend == 'up' else 'down')
        )

        return {
            'ticker': ticker,
            'name': name,
            'sector': app_sector,
            'price': int(price),
            'change': round(change, 2),
            'volume': int(volume),
            'volumeRatio': int(volume_ratio),
            'marketCap': int(market_cap),
            'sharesOutstanding': int(shares),
            # FinanceDataReader는 수급 데이터 미제공 → 0으로 설정
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
# 시장 지수
# ─────────────────────────────────────────

def get_market_indices():
    try:
        start = (datetime.today() - timedelta(days=300)).strftime('%Y-%m-%d')
        end = datetime.today().strftime('%Y-%m-%d')

        kospi = fdr.DataReader('KS11', start, end)
        kosdaq = fdr.DataReader('KQ11', start, end)

        kospi_price = float(kospi['Close'].iloc[-1])
        kospi_prev = float(kospi['Close'].iloc[-2]) if len(kospi) > 1 else kospi_price
        kospi_change = round((kospi_price - kospi_prev) / kospi_prev * 100, 2)

        kosdaq_price = float(kosdaq['Close'].iloc[-1]) if kosdaq is not None and len(kosdaq) > 0 else 0.0
        kosdaq_prev = float(kosdaq['Close'].iloc[-2]) if kosdaq is not None and len(kosdaq) > 1 else kosdaq_price
        kosdaq_change = round((kosdaq_price - kosdaq_prev) / kosdaq_prev * 100, 2) if kosdaq_prev > 0 else 0.0

        kospi_ma200 = float(kospi['Close'].iloc[-200:].mean()) if len(kospi) >= 200 else 0.0
        kospi_above_200 = bool(kospi_price > kospi_ma200) if kospi_ma200 > 0 else True

        return {
            'kospi': round(kospi_price, 2),
            'kospiChange': kospi_change,
            'kosdaq': round(kosdaq_price, 2),
            'kosdaqChange': kosdaq_change,
            'marketStatus': 'live',
            'kospiAbove200': kospi_above_200,
        }
    except Exception as e:
        logger.error(f'지수 조회 오류: {e}')
        return {
            'kospi': 0, 'kospiChange': 0,
            'kosdaq': 0, 'kosdaqChange': 0,
            'marketStatus': 'closed', 'kospiAbove200': True,
        }


# ─────────────────────────────────────────
# 업종별 등락률 (종목 목록에서 집계)
# ─────────────────────────────────────────

def get_sectors_from_listing(df):
    change_col = find_col(df, ['ChagesRatio', 'ChangeRatio', 'Changes_ratio', 'change_ratio'])
    sector_col = find_col(df, ['Sector', 'sector', '업종', 'Industry'])

    if not change_col or not sector_col:
        logger.warning(f'업종/등락률 컬럼 없음. 가용: {list(df.columns)}')
        return [{'name': s, 'netBuy': 0, 'change': 0, 'trend': 'neutral'} for s in APP_SECTORS]

    bucket = {}
    for _, row in df.iterrows():
        raw = str(row.get(sector_col, ''))
        app = SECTOR_ALIAS.get(raw)
        if app:
            v = safe_float(row.get(change_col, 0))
            bucket.setdefault(app, []).append(v)

    result = []
    for name in APP_SECTORS:
        vals = bucket.get(name, [])
        change = round(sum(vals) / len(vals), 2) if vals else 0.0
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

    # 1. 전종목 목록 (오늘 가격 포함)
    logger.info('KOSPI/KOSDAQ 종목 목록 조회...')
    try:
        kospi_df = fdr.StockListing('KOSPI')
        kosdaq_df = fdr.StockListing('KOSDAQ')
        all_df = pd.concat([kospi_df, kosdaq_df], ignore_index=True)
        logger.info(f'전체 종목: {len(all_df)}개')
    except Exception as e:
        logger.error(f'StockListing 오류: {e}')
        empty_sectors = [{'name': s, 'netBuy': 0, 'change': 0, 'trend': 'neutral'} for s in APP_SECTORS]
        return {'stocks': [], 'market': get_market_indices(), 'sectors': empty_sectors}

    # 2. 업종별 등락률 (전종목 데이터에서 계산)
    sectors = get_sectors_from_listing(all_df)

    # 3. 컬럼 탐지
    sym_col = find_col(all_df, ['Symbol', 'Code', 'code', '종목코드'])
    name_col = find_col(all_df, ['Name', 'name', '종목명'])
    close_col = find_col(all_df, ['Close', 'close', '현재가', 'Adj Close'])
    vol_col = find_col(all_df, ['Volume', 'volume', '거래량'])
    marcap_col = find_col(all_df, ['Marcap', 'MarketCap', 'marcap', '시가총액'])
    change_col = find_col(all_df, ['ChagesRatio', 'ChangeRatio', 'change', '등락률'])
    sector_col = find_col(all_df, ['Sector', 'sector', '업종', 'Industry'])
    per_col = find_col(all_df, ['Per', 'PER', 'per'])
    pbr_col = find_col(all_df, ['Pbr', 'PBR', 'pbr'])
    stocks_col = find_col(all_df, ['Stocks', 'shares', '상장주식수'])

    if not sym_col or not close_col:
        logger.error(f'필수 컬럼 없음. 가용: {list(all_df.columns)}')
        return {'stocks': [], 'market': get_market_indices(), 'sectors': sectors}

    # 4. 수치 변환
    all_df['_close'] = pd.to_numeric(all_df[close_col], errors='coerce').fillna(0)
    all_df['_vol'] = pd.to_numeric(all_df[vol_col], errors='coerce').fillna(0) if vol_col else 0
    all_df['_marcap'] = pd.to_numeric(all_df[marcap_col], errors='coerce').fillna(0) if marcap_col else 0

    # 5. 필터: 가격 ≥ 1,000원, 시총 ≥ 500억 (Marcap은 원 단위)
    filtered = all_df[
        (all_df['_close'] >= 1_000) &
        (all_df['_marcap'] >= 50_000_000_000)
    ].copy()
    logger.info(f'기본 필터 후: {len(filtered)}개')

    # 거래량 TOP 50
    filtered = filtered.sort_values('_vol', ascending=False).head(50)

    # 6. 종목 정보 정리
    stock_infos = []
    for _, row in filtered.iterrows():
        ticker = str(row.get(sym_col, '')).strip().zfill(6)
        if not ticker or ticker == '000000':
            continue
        stock_infos.append({
            'ticker': ticker,
            'name': str(row.get(name_col, ticker)) if name_col else ticker,
            'sector': str(row.get(sector_col, '')) if sector_col else '',
            'price': safe_float(row['_close']),
            'change': safe_float(row.get(change_col, 0)) if change_col else 0.0,
            'volume': safe_int(row['_vol']),
            'marketCap': safe_int(row['_marcap']) // 100_000_000,  # 억 단위
            'per': safe_float(row.get(per_col, 0)) if per_col else 0.0,
            'pbr': safe_float(row.get(pbr_col, 0)) if pbr_col else 0.0,
            'shares': safe_int(row.get(stocks_col, 0)) if stocks_col else 0,
        })

    logger.info(f'분석 대상: {len(stock_infos)}개')

    # 7. 병렬 히스토리 조회 + 기술적 분석
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(process_stock, info): info['ticker'] for info in stock_infos}
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)

    elapsed = time.time() - t0
    logger.info(f'분석 완료: {len(results)}/{len(stock_infos)}개 ({elapsed:.1f}초)')

    market = get_market_indices()
    data = {'stocks': results, 'market': market, 'sectors': sectors}

    _cache['data'] = data
    _cache['timestamp'] = time.time()
    return data
