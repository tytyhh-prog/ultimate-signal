"""
pykrx 기반 한국 주식 스캔 엔진
pykrx 실패 시 yfinance 자동 폴백
"""
from pykrx import stock as krx
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import concurrent.futures
import logging
import time
import pytz
import requests
import io

logger = logging.getLogger(__name__)

# 5분 캐시
_cache = {'data': None, 'timestamp': 0}
CACHE_TTL = 300

# 마지막 유효 수급 데이터 캐시 (장외에서 사용)
_supply_cache = {}

# KOSPI 업종 지수 코드 매핑
SECTOR_INDEX_MAP = [
    ('2차전지/전기차', '1008'),
    ('반도체',         '1013'),
    ('IT/소프트웨어',  '1025'),
    ('바이오/제약',    '1009'),
    ('자동차',         '1015'),
    ('건설',           '1018'),
    ('금융',           '1021'),
    ('철강/소재',      '1011'),
]

# yfinance 폴백용 상위 한국 종목
FALLBACK_TICKERS = [
    ('005930', '삼성전자',       'KOSPI'),
    ('000660', 'SK하이닉스',     'KOSPI'),
    ('005380', '현대차',         'KOSPI'),
    ('000270', '기아',           'KOSPI'),
    ('005490', 'POSCO홀딩스',    'KOSPI'),
    ('051910', 'LG화학',         'KOSPI'),
    ('006400', '삼성SDI',        'KOSPI'),
    ('207940', '삼성바이오로직스','KOSPI'),
    ('105560', 'KB금융',         'KOSPI'),
    ('055550', '신한지주',       'KOSPI'),
    ('086790', '하나금융지주',   'KOSPI'),
    ('035420', 'NAVER',          'KOSPI'),
    ('068270', '셀트리온',       'KOSPI'),
    ('096770', 'SK이노베이션',   'KOSPI'),
    ('003550', 'LG',             'KOSPI'),
    ('028260', '삼성물산',       'KOSPI'),
    ('015760', '한국전력',       'KOSPI'),
    ('009150', '삼성전기',       'KOSPI'),
    ('035720', '카카오',         'KOSDAQ'),
    ('247540', '에코프로비엠',   'KOSDAQ'),
    ('086520', '에코프로',       'KOSDAQ'),
    ('041510', 'SM엔터테인먼트', 'KOSDAQ'),
]


# ─────────────────────────────────────────
# 장 운영 여부 (유일한 판단 기준)
# ─────────────────────────────────────────

def is_market_open():
    KST = pytz.timezone('Asia/Seoul')
    now = datetime.now(KST)
    if now.weekday() >= 5:
        return False
    market_open  = now.replace(hour=9,  minute=0,  second=0, microsecond=0)
    market_close = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return market_open <= now <= market_close


def get_market_status():
    return 'open' if is_market_open() else 'closed'


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
    for c in candidates:
        if c in df.columns:
            return c
    if fallback_idx is not None and len(df.columns) > fallback_idx:
        return df.columns[fallback_idx]
    return None


# ─────────────────────────────────────────
# 투자자별 수급 데이터 조회 (pykrx)
# ─────────────────────────────────────────

def get_investor_data_direct(ticker, date_str):
    """
    KRX 데이터 포털 직접 HTTP 호출 — CP949 명시로 pykrx 인코딩 오류 우회
    pykrx 내부에서 'utf-8' 디코딩 실패 시 이 함수로 폴백
    """
    _KRX_OTP  = 'http://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd'
    _KRX_CSV  = 'http://data.krx.co.kr/comm/fileDn/download_csv.cmd'
    _HEADERS  = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer':    'http://data.krx.co.kr/',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    }

    start_str = (datetime.today() - timedelta(days=10)).strftime('%Y%m%d')

    # KRX는 6자리 ticker를 isuCd로 직접 수락하는 경우도 있으나
    # 정규 format은 'KR7{ticker}003' (보통주 기준)
    isu_candidates = [ticker, f'KR7{ticker}003']

    for isu_cd in isu_candidates:
        try:
            sess = requests.Session()

            # ── OTP 획득 ──────────────────────────────────────────────
            otp_payload = {
                'searchType': '1',
                'mktId':      'ALL',
                'strtDd':     start_str,
                'endDd':      date_str,
                'isuCd':      isu_cd,
                'share':      '1',
                'money':      '1',
                'csvxls_isNo': 'false',
                'name':       'fileDown',
                'url':        'dbms/MDC/STAT/standard/MDCSTAT02302',
            }
            r_otp = sess.post(_KRX_OTP, data=otp_payload, headers=_HEADERS, timeout=15)
            otp_code = r_otp.text.strip()

            if not otp_code or len(otp_code) > 200 or not otp_code.isalnum():
                logger.warning(f'[{ticker}] KRX direct OTP 획득 실패 (isuCd={isu_cd}): "{otp_code[:50]}"')
                continue

            # ── CSV 다운로드 (CP949 명시) ───────────────────────────
            r_csv = sess.post(_KRX_CSV, data={'code': otp_code}, headers=_HEADERS, timeout=15)
            r_csv.encoding = 'cp949'

            df = pd.read_csv(io.StringIO(r_csv.text))
            if df is None or len(df) == 0:
                logger.warning(f'[{ticker}] KRX direct CSV 빈 응답 (isuCd={isu_cd})')
                continue

            logger.info(f'[{ticker}] KRX direct 성공 (isuCd={isu_cd}) columns: {list(df.columns)}')
            logger.info(f'[{ticker}] KRX direct 최근 데이터:\n{df.tail(2).to_string()}')

            # ── 컬럼 탐색 ──────────────────────────────────────────
            inst_col    = get_col(df, ['기관합계', '기관계', '기관'],              fallback_idx=None)
            foreign_col = get_col(df, ['외국인합계', '외국인계', '외국인', '기타법인'], fallback_idx=None)
            retail_col  = get_col(df, ['개인'],                                    fallback_idx=None)

            if inst_col is None and foreign_col is None:
                logger.warning(f'[{ticker}] KRX direct 컬럼 탐색 실패: {list(df.columns)}')
                continue

            latest          = df.iloc[-1]
            inst_raw_won    = safe_float(latest[inst_col])    if inst_col    else None
            foreign_raw_won = safe_float(latest[foreign_col]) if foreign_col else None
            retail_raw_won  = safe_float(latest[retail_col])  if retail_col  else None

            inst_net    = round(inst_raw_won    / 100_000_000, 1) if inst_raw_won    is not None else None
            foreign_net = round(foreign_raw_won / 100_000_000, 1) if foreign_raw_won is not None else None
            retail_net  = round(retail_raw_won  / 100_000_000, 1) if retail_raw_won  is not None else None

            logger.info(f'[{ticker}] KRX direct 수급: 기관={inst_net}억, 외국인={foreign_net}억, 개인={retail_net}억')

            both_zero = (inst_net is not None and inst_net == 0) and \
                        (foreign_net is not None and foreign_net == 0)

            return {
                'instNetBuy':             inst_net,
                'foreignNetBuy':          foreign_net,
                'retailNetBuy':           retail_net,
                'instRawWon':             inst_raw_won,
                'foreignRawWon':          foreign_raw_won,
                'instConsecutiveDays':    0,
                'foreignConsecutiveDays': 0,
                'supplyDataAvailable':    True,
                'supplySource':           'live' if is_market_open() else 'closing',
                'supplyFailReason':       f'기관+외국인 모두 0억 (원: {inst_raw_won}/{foreign_raw_won})' if both_zero else None,
                'columns':                list(df.columns),
            }

        except Exception as e:
            logger.warning(f'[{ticker}] KRX direct 오류 (isuCd={isu_cd}): {type(e).__name__}: {e}')
            continue

    logger.error(f'[{ticker}] KRX direct 모든 시도 실패')
    return None


def get_investor_data(ticker, date_str):
    """
    종목별 기관/외국인/개인 순매수 데이터 조회
    반환 필드:
      instNetBuy / foreignNetBuy / retailNetBuy  — 억원 (소수점 1자리)
      instRawWon / foreignRawWon                 — 원 단위 실제값 (디버그용)
      supplyDataAvailable                        — True/False
      supplySource                               — live/closing/cache/none
      supplyFailReason                           — 실패 시 구체 이유
      columns                                    — pykrx 응답 컬럼 목록
    """
    global _supply_cache
    try:
        start = (datetime.today() - timedelta(days=10)).strftime('%Y%m%d')
        df = krx.get_market_trading_value_by_date(start, date_str, ticker)

        if df is None or len(df) == 0:
            reason = f'pykrx 빈 DataFrame (start={start}, date={date_str})'
            logger.warning(f'[{ticker}] 수급 데이터 없음 — {reason}')
            if ticker in _supply_cache:
                cached = _supply_cache[ticker].copy()
                cached.update({'supplyDataAvailable': False, 'supplySource': 'cache',
                                'supplyFailReason': '빈 DataFrame → 캐시 사용'})
                return cached
            return {'supplyDataAvailable': False, 'supplySource': 'none',
                    'supplyFailReason': reason, 'columns': []}

        cols = list(df.columns)
        logger.info(f'[{ticker}] 수급 raw columns: {cols}')
        logger.info(f'[{ticker}] 수급 raw data (최근):\n{df.tail(3).to_string()}')

        # 컬럼명 탐색 (pykrx 버전별 차이 대응)
        inst_col    = get_col(df, ['기관합계', '기관계', '기관'],              fallback_idx=None)
        foreign_col = get_col(df, ['외국인합계', '외국인계', '외국인', '기타법인'], fallback_idx=None)
        retail_col  = get_col(df, ['개인'],                                    fallback_idx=None)

        if inst_col is None and foreign_col is None:
            reason = f'필요 컬럼 없음 — 실제 컬럼: {cols}'
            logger.warning(f'[{ticker}] 수급 컬럼 탐색 실패 — {reason}')
            if ticker in _supply_cache:
                cached = _supply_cache[ticker].copy()
                cached.update({'supplyDataAvailable': False, 'supplySource': 'cache',
                                'supplyFailReason': reason, 'columns': cols})
                return cached
            return {'supplyDataAvailable': False, 'supplySource': 'none',
                    'supplyFailReason': reason, 'columns': cols}

        # 최근 거래일 원 단위 실제값 보존
        latest = df.iloc[-1]
        inst_raw_won    = safe_float(latest[inst_col])    if inst_col    else None
        foreign_raw_won = safe_float(latest[foreign_col]) if foreign_col else None
        retail_raw_won  = safe_float(latest[retail_col])  if retail_col  else None

        # 억원 단위 환산 — 소수점 1자리 유지 (0.3억 등 작은 값 보존)
        inst_net    = round(inst_raw_won    / 100_000_000, 1) if inst_raw_won    is not None else None
        foreign_net = round(foreign_raw_won / 100_000_000, 1) if foreign_raw_won is not None else None
        retail_net  = round(retail_raw_won  / 100_000_000, 1) if retail_raw_won  is not None else None

        logger.info(f'[{ticker}] 수급 파싱 결과: 기관={inst_net}억(원:{inst_raw_won}), '
                    f'외국인={foreign_net}억(원:{foreign_raw_won}), 개인={retail_net}억')

        # 연속 매수일 계산
        inst_consecutive = 0
        foreign_consecutive = 0
        if inst_col and len(df) >= 2:
            for i in range(len(df) - 1, -1, -1):
                if safe_float(df.iloc[i][inst_col]) > 0:
                    inst_consecutive += 1
                else:
                    break
        if foreign_col and len(df) >= 2:
            for i in range(len(df) - 1, -1, -1):
                if safe_float(df.iloc[i][foreign_col]) > 0:
                    foreign_consecutive += 1
                else:
                    break

        # 수급 상태 판정 — 0 vs None 구분
        both_zero = (inst_net is not None and inst_net == 0) and \
                    (foreign_net is not None and foreign_net == 0)
        fail_reason = None
        if both_zero:
            fail_reason = f'기관+외국인 모두 0억 (원단위: 기관={inst_raw_won}, 외국인={foreign_raw_won})'
            logger.info(f'[{ticker}] 수급 0 확인: {fail_reason}')

        result = {
            'instNetBuy':             inst_net,
            'foreignNetBuy':          foreign_net,
            'retailNetBuy':           retail_net,
            'instRawWon':             inst_raw_won,
            'foreignRawWon':          foreign_raw_won,
            'instConsecutiveDays':    inst_consecutive,
            'foreignConsecutiveDays': foreign_consecutive,
            'supplyDataAvailable':    True,
            'supplySource':           'live' if is_market_open() else 'closing',
            'supplyFailReason':       fail_reason,
            'columns':                cols,
        }

        # 유효 캐시 갱신 (실제 데이터 있을 때만)
        if inst_net is not None or foreign_net is not None:
            _supply_cache[ticker] = result.copy()

        return result

    except UnicodeDecodeError as e:
        # KRX 응답이 CP949인데 pykrx가 UTF-8로 읽으려다 실패
        # → KRX API 직접 호출 (CP949 명시) 로 폴백
        reason_pykrx = f'pykrx UnicodeDecodeError (CP949/UTF-8 인코딩 불일치): {e}'
        logger.warning(f'[{ticker}] {reason_pykrx} → KRX direct 폴백 시도')

        direct = get_investor_data_direct(ticker, date_str)
        if direct:
            logger.info(f'[{ticker}] KRX direct 폴백 성공')
            if direct.get('instNetBuy') is not None or direct.get('foreignNetBuy') is not None:
                _supply_cache[ticker] = direct.copy()
            return direct

        # KRX direct도 실패 → 캐시 또는 None
        if ticker in _supply_cache:
            cached = _supply_cache[ticker].copy()
            cached.update({'supplyDataAvailable': False, 'supplySource': 'cache',
                            'supplyFailReason': f'pykrx 인코딩 오류 + KRX direct 실패 → 캐시 사용'})
            return cached
        return {'supplyDataAvailable': False, 'supplySource': 'none',
                'supplyFailReason': reason_pykrx, 'columns': []}

    except Exception as e:
        reason = f'{type(e).__name__}: {e}'
        logger.error(f'[{ticker}] 수급 조회 예외 — {reason}')
        if ticker in _supply_cache:
            cached = _supply_cache[ticker].copy()
            cached.update({'supplyDataAvailable': False, 'supplySource': 'cache',
                            'supplyFailReason': f'예외 발생 → 캐시 사용 ({reason})'})
            return cached
        return {'supplyDataAvailable': False, 'supplySource': 'none',
                'supplyFailReason': reason, 'columns': []}


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
# pykrx 기반 개별 종목 처리
# ─────────────────────────────────────────

def _build_stock_dict(ticker, name, price, volume, market_cap, per, pbr,
                      close, vol_series, change=0.0, shares=0,
                      supply_data=None):
    """공통 종목 dict 생성 (supply_data: 수급 데이터 dict 또는 None)"""
    ma50  = round(calc_ma(close, 50))
    ma150 = round(calc_ma(close, 150))
    ma200 = round(calc_ma(close, 200))

    if len(close) >= 220:
        ma200_20ago = float(close.iloc[:-20].iloc[-200:].mean())
    else:
        ma200_20ago = ma200
    ma200_trend = 'up' if (ma200 > 0 and ma200 > ma200_20ago) else 'down'

    avg_vol = float(vol_series.iloc[-20:].mean()) if len(vol_series) >= 20 else float(vol_series.mean())
    volume_ratio = round(volume / avg_vol * 100) if avg_vol > 0 else 100

    n = min(len(close), 252)
    week52_high = round(float(close.iloc[-n:].max()))
    week52_low  = round(float(close.iloc[-n:].min()))

    def calc_return(days):
        if len(close) < days:
            return 0
        past = float(close.iloc[-days])
        return round((price - past) / past * 100, 1) if past > 0 else 0

    return1m  = calc_return(20)
    return3m  = calc_return(60)
    return6m  = calc_return(120)
    return12m = calc_return(240)

    stage = 1
    if len(close) >= 150:
        if price > ma150 and ma200_trend == 'up':
            stage = 2
        elif price > ma150:
            stage = 3
        elif ma200_trend == 'down':
            stage = 4

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

    darvas_clear = darvas_breakout = False
    if len(close) >= 20:
        recent20 = close.iloc[-20:]
        box_high = float(recent20.max())
        box_low  = float(recent20.min())
        if box_high > 0:
            box_range       = (box_high - box_low) / box_high * 100
            darvas_clear    = 3 < box_range < 20
            darvas_breakout = price > box_high and volume_ratio > 200

    is_breakout = week52_high > 0 and price >= week52_high * 0.97
    ma30w_slope = (
        'strong_up' if (ma200 > 0 and ma200_20ago > 0 and ma200 > ma200_20ago * 1.02)
        else ('up' if ma200_trend == 'up' else 'down')
    )

    # 수급 데이터: 실제 값 사용, 없으면 None (0 ≠ None)
    sd = supply_data or {}
    inst_net    = sd.get('instNetBuy')      # None = 데이터 없음, 0.0 = 실제 0
    foreign_net = sd.get('foreignNetBuy')
    retail_net  = sd.get('retailNetBuy')
    supply_available  = sd.get('supplyDataAvailable', False)
    supply_source     = sd.get('supplySource', 'none')
    supply_fail_reason = sd.get('supplyFailReason', None)
    supply_columns    = sd.get('columns', [])
    inst_raw_won      = sd.get('instRawWon', None)
    foreign_raw_won   = sd.get('foreignRawWon', None)
    inst_consec       = sd.get('instConsecutiveDays', 0)
    foreign_consec    = sd.get('foreignConsecutiveDays', 0)

    return {
        'ticker': ticker, 'name': name, 'sector': '',
        'price': int(price), 'change': round(change, 2),
        'volume': int(volume), 'volumeRatio': int(volume_ratio),
        'marketCap': int(market_cap), 'sharesOutstanding': int(shares),
        'instNetBuy': inst_net, 'foreignNetBuy': foreign_net, 'retailNetBuy': retail_net,
        'instRawWon': inst_raw_won, 'foreignRawWon': foreign_raw_won,
        'instConsecutiveDays': inst_consec, 'foreignConsecutiveDays': foreign_consec,
        'supplyDataAvailable': supply_available, 'supplySource': supply_source,
        'supplyFailReason': supply_fail_reason, 'supplyColumns': supply_columns,
        'instAlwaysBuy': False, 'instMultipleBuyers': False,
        'creditRatio': 0, 'lendingIncrease': 0,
        'recentDrop': calc_return(5),
        'volumeEarlyBreak': volume_ratio > 150,
        'ma50': int(ma50), 'ma150': int(ma150), 'ma200': int(ma200),
        'ma200Trend': ma200_trend,
        'week52High': int(week52_high), 'week52Low': int(week52_low),
        'vcpContraction': vcp, 'vcpVolumeBreak': vcp and volume_ratio > 150,
        'quarterlyEarningsGrowth': 0, 'annualEarningsYears': 0,
        'isNewHigh': is_breakout, 'sectorRank': 20, 'instNewBuyers': 0,
        'kospiAbove200': True,
        'breakoutResistance': is_breakout, 'breakoutVolume': int(volume_ratio),
        'closedAboveResistance': is_breakout, 'trendDirection': ma200_trend,
        'stage': stage, 'ma30wSlope': ma30w_slope,
        'volumeAboveAvg': volume_ratio > 100,
        'darvasBoxClear': darvas_clear, 'darvasBreakout': darvas_breakout,
        'darvasSupport': False,
        'returns1m': return1m, 'returns3m': return3m,
        'returns6m': return6m, 'returns12m': return12m,
        'pbr': round(pbr, 2),
        'roe': round(pbr / per * 100, 1) if per > 0 and pbr > 0 else 0,
        'debtRatio': 50, 'operatingMargin': 10,
        'nearHigh52': week52_high > 0 and price >= week52_high * 0.9,
        'volumeSurge': volume_ratio > 200,
        'momentumRank': 10 if return12m > 20 else (20 if return12m > 10 else 40),
        'roeRank': 25, 'operatingMarginRank': 25,
        'debtRatioRank': 75,
        'pbrRank': 80 if pbr < 1 else (65 if pbr < 1.5 else (45 if pbr < 3 else 25)),
        'perRank': 75 if 0 < per < 10 else (55 if per < 20 else 35),
        'psrRank': 50, 'volatilityRank': 50, 'beta': 1.0,
        'targetPriceRevisionUp': False, 'earningSurprise': False,
        'orderBook': {'totalBid': 0, 'totalAsk': 0, 'bidRatio': 50,
                      'bidDominant': False, 'askDisappearing': False},
        'derivatives': {'instFuturesBuy': False, 'instFuturesAmount': 0,
                        'callDominant': False, 'putCallRatio': 1.0,
                        'callOIIncreasing': False},
    }


def process_stock(info, date_str=None):
    """pykrx 기반 개별 종목 기술적 분석 + 수급 데이터"""
    ticker     = info['ticker']
    name       = info['name']
    price      = info['price']
    volume     = info['volume']
    market_cap = info['marketCap']
    per        = info['per']
    pbr        = info['pbr']
    change     = info.get('change', 0.0)
    shares     = info.get('shares', 0)

    try:
        end_dt   = datetime.today().strftime('%Y%m%d')
        start_dt = (datetime.today() - timedelta(days=420)).strftime('%Y%m%d')
        hist = krx.get_market_ohlcv_by_date(start_dt, end_dt, ticker)
        if hist is None or len(hist) < 20:
            return None

        close_col = get_col(hist, ['종가', 'Close'], fallback_idx=3)
        vol_col   = get_col(hist, ['거래량', 'Volume'], fallback_idx=4)
        close     = hist[close_col].astype(float)
        vol_s     = hist[vol_col].astype(float)

        # 수급 데이터 조회
        supply_date = date_str or end_dt
        supply_data = get_investor_data(ticker, supply_date)
        logger.info(f'[{ticker}] {name} 수급 결과: {supply_data}')

        return _build_stock_dict(ticker, name, price, volume, market_cap,
                                 per, pbr, close, vol_s, change, shares,
                                 supply_data=supply_data)
    except Exception as e:
        logger.warning(f'[{ticker}] {name} pykrx 처리 실패: {e}')
        return None


# ─────────────────────────────────────────
# yfinance 기반 개별 종목 처리 (폴백)
# ─────────────────────────────────────────

def process_stock_yf(ticker, name, market):
    """yfinance 기반 종목 처리 (pykrx 실패 시 폴백)"""
    import yfinance as yf
    suffix = '.KS' if market == 'KOSPI' else '.KQ'
    yf_sym = f'{ticker}{suffix}'
    try:
        tick = yf.Ticker(yf_sym)
        hist = tick.history(period='2y')   # yfinance 유효 기간: 1d/5d/1mo/3mo/6mo/1y/2y/5y
        if hist is None or len(hist) < 20:
            logger.warning(f'[{yf_sym}] 히스토리 부족: {len(hist) if hist is not None else 0}행')
            return None

        close  = hist['Close'].astype(float)
        vol_s  = hist['Volume'].astype(float)
        price  = float(close.iloc[-1])
        volume = float(vol_s.iloc[-1])
        change = round((float(close.iloc[-1]) - float(close.iloc[-2])) / float(close.iloc[-2]) * 100, 2) if len(close) >= 2 else 0.0

        try:
            fi  = tick.fast_info
            cap = int(getattr(fi, 'market_cap', 0) or 0) // 100_000_000
        except Exception:
            cap = 0

        return _build_stock_dict(ticker, name, price, volume, cap,
                                 0, 0, close, vol_s, change, 0)
    except Exception as e:
        logger.warning(f'[{yf_sym}] yfinance 처리 실패: {e}')
        return None


def run_scan_yf():
    """yfinance로 FALLBACK_TICKERS 전체 처리"""
    logger.info(f'yfinance 폴백 스캔: {len(FALLBACK_TICKERS)}개 시도')
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(process_stock_yf, t, n, m): t
            for t, n, m in FALLBACK_TICKERS
        }
        for future in concurrent.futures.as_completed(futures):
            r = future.result()
            if r:
                results.append(r)
    logger.info(f'yfinance 폴백 완료: {len(results)}개')
    return results


# ─────────────────────────────────────────
# 시장 지수 (pykrx → yfinance 폴백)
# ─────────────────────────────────────────

def get_market_indices(date_str):
    status = get_market_status()   # is_market_open() 결과만 사용

    # 1차: pykrx
    try:
        start = (datetime.today() - timedelta(days=300)).strftime('%Y%m%d')
        ki = krx.get_index_ohlcv_by_date(start, date_str, '1001')
        kq = krx.get_index_ohlcv_by_date(start, date_str, '2001')

        cc = get_col(ki, ['종가', 'Close'], fallback_idx=3)
        kp = float(ki[cc].iloc[-1])
        kp_prev = float(ki[cc].iloc[-2]) if len(ki) > 1 else kp
        kp_chg  = round((kp - kp_prev) / kp_prev * 100, 2) if kp_prev > 0 else 0.0

        qc = get_col(kq, ['종가', 'Close'], fallback_idx=3)
        kq_p    = float(kq[qc].iloc[-1]) if kq is not None and len(kq) > 0 else 0.0
        kq_prev = float(kq[qc].iloc[-2]) if kq is not None and len(kq) > 1 else kq_p
        kq_chg  = round((kq_p - kq_prev) / kq_prev * 100, 2) if kq_prev > 0 else 0.0

        ma200 = float(ki[cc].iloc[-200:].mean()) if len(ki) >= 200 else 0.0
        above = bool(kp > ma200) if ma200 > 0 else True

        logger.info(f'pykrx 지수: KOSPI={kp} KOSDAQ={kq_p}')
        return {'kospi': round(kp, 2), 'kospiChange': kp_chg,
                'kosdaq': round(kq_p, 2), 'kosdaqChange': kq_chg,
                'marketStatus': status, 'kospiAbove200': above}
    except Exception as e:
        logger.error(f'pykrx 지수 실패: {e}')

    # 2차: yfinance
    try:
        import yfinance as yf
        ki_h = yf.Ticker('^KS11').history(period='60d')
        kq_h = yf.Ticker('^KQ11').history(period='5d')

        if ki_h is not None and len(ki_h) >= 2:
            kp      = float(ki_h['Close'].iloc[-1])
            kp_prev = float(ki_h['Close'].iloc[-2])
            kp_chg  = round((kp - kp_prev) / kp_prev * 100, 2) if kp_prev > 0 else 0.0
            ma200   = float(ki_h['Close'].iloc[-200:].mean()) if len(ki_h) >= 200 else float(ki_h['Close'].mean())
            above   = bool(kp > ma200)
        else:
            kp, kp_chg, above = 0.0, 0.0, True

        if kq_h is not None and len(kq_h) >= 2:
            kq_p    = float(kq_h['Close'].iloc[-1])
            kq_prev = float(kq_h['Close'].iloc[-2])
            kq_chg  = round((kq_p - kq_prev) / kq_prev * 100, 2) if kq_prev > 0 else 0.0
        else:
            kq_p, kq_chg = 0.0, 0.0

        logger.info(f'yfinance 지수: KOSPI={kp} KOSDAQ={kq_p}')
        return {'kospi': round(kp, 2), 'kospiChange': kp_chg,
                'kosdaq': round(kq_p, 2), 'kosdaqChange': kq_chg,
                'marketStatus': status, 'kospiAbove200': above}
    except Exception as e:
        logger.error(f'yfinance 지수 실패: {e}')

    # 최종 폴백: 숫자는 0이지만 status는 KST 기준
    return {'kospi': 0, 'kospiChange': 0, 'kosdaq': 0, 'kosdaqChange': 0,
            'marketStatus': status, 'kospiAbove200': True}


# ─────────────────────────────────────────
# 업종별 등락률
# ─────────────────────────────────────────

def get_sectors(date_str, stocks=None):
    """업종별 등락률 + 수급 합산"""
    start = (datetime.today() - timedelta(days=5)).strftime('%Y%m%d')
    result = []

    # 종목별 수급을 업종별로 합산
    sector_supply = {}
    sector_has_data = {}
    if stocks:
        for s in stocks:
            sector_name = s.get('sector', '') or '기타'
            if sector_name not in sector_supply:
                sector_supply[sector_name] = 0
                sector_has_data[sector_name] = False
            inst = s.get('instNetBuy')
            foreign = s.get('foreignNetBuy')
            if inst is not None or foreign is not None:
                sector_supply[sector_name] += (inst or 0) + (foreign or 0)
                sector_has_data[sector_name] = True

    for name, code in SECTOR_INDEX_MAP:
        try:
            df = krx.get_index_ohlcv_by_date(start, date_str, code)
            if df is None or len(df) < 2:
                change = 0.0
            else:
                cc   = get_col(df, ['종가', 'Close'], fallback_idx=3)
                last = float(df[cc].iloc[-1])
                prev = float(df[cc].iloc[-2])
                change = round((last - prev) / prev * 100, 2) if prev > 0 else 0.0
        except Exception as e:
            logger.warning(f'업종 지수 오류 [{name}/{code}]: {e}')
            change = 0.0
        trend = 'up' if change > 0.5 else ('down' if change < -0.5 else 'neutral')

        # 매칭되는 업종의 수급 합산
        net_buy = sector_supply.get(name, None)
        has_data = sector_has_data.get(name, False)

        result.append({
            'name': name,
            'netBuy': net_buy if has_data else None,
            'change': change,
            'trend': trend,
            'supplyDataAvailable': has_data,
        })

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
    logger.info(f'장 운영 여부: {is_market_open()} / 상태: {get_market_status()}')
    t0 = time.time()

    date_str = get_last_trading_date()
    logger.info(f'기준일: {date_str}')

    empty_sectors = [{'name': n, 'netBuy': 0, 'change': 0, 'trend': 'neutral'} for n, _ in SECTOR_INDEX_MAP]

    # ── pykrx 전종목 OHLCV ──────────────────────────
    logger.info(f'KOSPI/KOSDAQ 전종목 조회... (기준일: {date_str})')
    pykrx_ok = False
    try:
        kospi_ohlcv  = krx.get_market_ohlcv_by_ticker(date_str, market='KOSPI')
        kosdaq_ohlcv = krx.get_market_ohlcv_by_ticker(date_str, market='KOSDAQ')
        cnt = (len(kospi_ohlcv) if kospi_ohlcv is not None else 0) + \
              (len(kosdaq_ohlcv) if kosdaq_ohlcv is not None else 0)
        logger.info(f'KOSPI {len(kospi_ohlcv) if kospi_ohlcv is not None else 0}개, '
                    f'KOSDAQ {len(kosdaq_ohlcv) if kosdaq_ohlcv is not None else 0}개')
        pykrx_ok = cnt > 0
    except Exception as e:
        logger.error(f'전종목 OHLCV 오류 (pykrx 실패): {type(e).__name__}: {e}')
        kospi_ohlcv = kosdaq_ohlcv = None

    results = []

    if pykrx_ok:
        # ── pykrx 경로 ───────────────────────────────
        try:
            kospi_cap  = krx.get_market_cap_by_ticker(date_str, market='KOSPI')
            kosdaq_cap = krx.get_market_cap_by_ticker(date_str, market='KOSDAQ')
        except Exception as e:
            logger.warning(f'시총 조회 오류: {e}')
            kospi_cap = kosdaq_cap = pd.DataFrame()

        try:
            kospi_fund  = krx.get_market_fundamental_by_ticker(date_str, market='KOSPI')
            kosdaq_fund = krx.get_market_fundamental_by_ticker(date_str, market='KOSDAQ')
        except Exception as e:
            logger.warning(f'펀더멘털 조회 오류: {e}')
            kospi_fund = kosdaq_fund = pd.DataFrame()

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

        close_col  = get_col(all_df, ['종가', 'Close'],   fallback_idx=3)
        vol_col    = get_col(all_df, ['거래량', 'Volume'], fallback_idx=4)
        cap_col    = '시가총액'  if '시가총액'  in all_df.columns else None
        shares_col = '상장주식수' if '상장주식수' in all_df.columns else None
        per_col    = 'PER' if 'PER' in all_df.columns else None
        pbr_col    = 'PBR' if 'PBR' in all_df.columns else None

        if close_col:
            all_df['_close']  = pd.to_numeric(all_df[close_col],                        errors='coerce').fillna(0)
            all_df['_vol']    = pd.to_numeric(all_df[vol_col],    errors='coerce').fillna(0) if vol_col    else 0
            all_df['_cap']    = pd.to_numeric(all_df[cap_col],    errors='coerce').fillna(0) if cap_col    else 0
            all_df['_shares'] = pd.to_numeric(all_df[shares_col], errors='coerce').fillna(0) if shares_col else 0
            all_df['_per']    = pd.to_numeric(all_df[per_col],    errors='coerce').fillna(0) if per_col    else 0
            all_df['_pbr']    = pd.to_numeric(all_df[pbr_col],    errors='coerce').fillna(0) if pbr_col    else 0

            # 필터: 시총 있으면 500억+, 없으면 가격 1000원+ 만 적용
            has_cap = cap_col is not None and all_df['_cap'].sum() > 0
            if has_cap:
                filtered = all_df[
                    (all_df['_close'] >= 1_000) &
                    (all_df['_cap']   >= 50_000_000_000)
                ].copy()
            else:
                logger.warning('시총 데이터 없음 → 가격 필터만 적용')
                filtered = all_df[all_df['_close'] >= 1_000].copy()
            logger.info(f'기본 필터 후: {len(filtered)}개 (시총데이터={has_cap})')

            filtered = filtered.sort_values('_vol', ascending=False).head(50)

            open_col = get_col(all_df, ['시가', 'Open'], fallback_idx=0)
            stock_infos = []
            for ticker, row in filtered.iterrows():
                ticker_str = str(ticker).strip().zfill(6)
                if not ticker_str or ticker_str == '000000':
                    continue
                try:
                    name = krx.get_market_ticker_name(ticker_str)
                except Exception:
                    name = ticker_str

                if open_col and open_col in row.index:
                    op = safe_float(row.get(open_col, 0))
                    change = round((row['_close'] - op) / op * 100, 2) if op > 0 else 0.0
                else:
                    change = 0.0

                stock_infos.append({
                    'ticker':    ticker_str,
                    'name':      name,
                    'sector':    '',
                    'price':     safe_float(row['_close']),
                    'change':    change,
                    'volume':    safe_int(row['_vol']),
                    'marketCap': safe_int(row['_cap']) // 100_000_000,
                    'shares':    safe_int(row['_shares']),
                    'per':       safe_float(row['_per']),
                    'pbr':       safe_float(row['_pbr']),
                })

            logger.info(f'분석 대상: {len(stock_infos)}개')
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
                futures = {executor.submit(process_stock, info, date_str): info['ticker'] for info in stock_infos}
                for future in concurrent.futures.as_completed(futures):
                    r = future.result()
                    if r:
                        results.append(r)

    # ── 결과 < 3개면 yfinance 폴백 ──────────────────
    if len(results) < 3:
        logger.warning(f'종목 {len(results)}개 → yfinance 폴백 실행')
        results = run_scan_yf()

    elapsed = time.time() - t0
    logger.info(f'분석 완료: {len(results)}개 ({elapsed:.1f}초)')

    sectors = get_sectors(date_str, stocks=results)
    market  = get_market_indices(date_str)

    data = {'stocks': results, 'market': market, 'sectors': sectors}
    _cache['data']      = data
    _cache['timestamp'] = time.time()
    return data
