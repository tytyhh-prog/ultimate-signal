"""
Ultimate Signal - Python Flask 백엔드
pykrx 기반 한국 주식 스캔 API
"""
from flask import Flask, jsonify
from flask_cors import CORS
import scanner
import logging
import os

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


# 루트 헬스체크 (Render 모니터링 + 프론트 ping용)
@app.route('/health', methods=['GET'])
def health_root():
    return jsonify({'ok': True, 'status': 'ok'})


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'ok': True, 'status': 'ok', 'version': 'v7b-sync'})


@app.route('/api/market', methods=['GET'])
def market_indices():
    """KOSPI/KOSDAQ 지수만 빠르게 반환 (스캔 없이)"""
    try:
        date_str = scanner.get_last_trading_date()
        data = scanner.get_market_indices(date_str)
        return jsonify(data)
    except Exception as e:
        logger.error(f'시장 지수 오류: {e}', exc_info=True)
        return jsonify({
            'kospi': 0, 'kospiChange': 0, 'kosdaq': 0, 'kosdaqChange': 0,
            'marketStatus': 'closed', 'kospiAbove200': True,
        }), 500


@app.route('/api/scan', methods=['GET'])
def scan():
    try:
        logger.info('스캔 요청')
        data = scanner.run_scan()
        logger.info(f"응답: 종목 {len(data.get('stocks', []))}개")
        return jsonify(data)
    except Exception as e:
        logger.error(f'스캔 오류: {e}', exc_info=True)
        return jsonify({
            'error': str(e),
            'stocks': [],
            'market': {'kospi': 0, 'kospiChange': 0, 'kosdaq': 0, 'kosdaqChange': 0, 'marketStatus': 'closed', 'kospiAbove200': True},
            'sectors': [],
        }), 500


@app.route('/api/debug/supply/<ticker>', methods=['GET'])
def debug_supply(ticker):
    """특정 종목 수급 raw 데이터 진단 (예: /api/debug/supply/105560)"""
    try:
        date_str = scanner.get_last_trading_date()
        result = scanner.get_investor_data(ticker, date_str)
        return jsonify({
            'ticker': ticker,
            'date': date_str,
            'market_open': scanner.is_market_open(),
            'supply_result': result,
            'diagnosis': {
                'data_available': bool(result and result.get('supplyDataAvailable')),
                'source': result.get('supplySource') if result else 'none',
                'fail_reason': result.get('supplyFailReason') if result else 'get_investor_data returned None',
                'columns': result.get('columns', []) if result else [],
                'inst_net_billion': result.get('instNetBuy') if result else None,
                'foreign_net_billion': result.get('foreignNetBuy') if result else None,
                'inst_raw_won': result.get('instRawWon') if result else None,
                'foreign_raw_won': result.get('foreignRawWon') if result else None,
            }
        })
    except Exception as e:
        logger.error(f'[debug/supply/{ticker}] 오류: {e}', exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/debug/last_error', methods=['GET'])
def debug_last_error():
    """마지막 수급 오류 트레이스백 반환 (빠른 진단용)"""
    return jsonify(scanner._last_supply_error)


@app.route('/api/debug/trigger_supply/<ticker>', methods=['GET'])
def debug_trigger_supply(ticker):
    """수급 조회 동기 실행 — 결과 직접 반환 (최대 20초 대기)"""
    import time, traceback as tb
    t0 = time.time()
    try:
        date_str = scanner.get_last_trading_date()
        result = scanner.get_investor_data(ticker, date_str)
        elapsed = round(time.time() - t0, 2)
        return jsonify({
            'ticker': ticker,
            'elapsed_sec': elapsed,
            'result': result,
            'error': None,
        })
    except Exception as e:
        elapsed = round(time.time() - t0, 2)
        return jsonify({
            'ticker': ticker,
            'elapsed_sec': elapsed,
            'result': None,
            'error': f'{type(e).__name__}: {e}',
            'traceback': tb.format_exc(),
        })


@app.route('/api/debug/krx_raw', methods=['GET'])
def debug_krx_raw():
    """KRX API 원본 응답 바이트 진단 — 인코딩 문제 파악용"""
    import requests as req
    url = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://data.krx.co.kr/',
        'Content-Type': 'application/x-www-form-urlencoded',
    }
    # get_market_trading_value_by_date 에 해당하는 파라미터
    date_str = scanner.get_last_trading_date()
    params = {
        'bld': 'dbms/MDC/STAT/standard/MDCSTAT02202',
        'strtDd': date_str,
        'endDd': date_str,
        'isuCd': 'KR7105560007',  # KB금융 ISIN
        'share': '1',
        'money': '1',
        'csvxls_isNo': 'false',
    }
    try:
        resp = req.post(url, headers=headers, data=params, timeout=10)
        raw_bytes = resp.content[:300]
        json_ok = False
        json_error = None
        json_preview = None
        try:
            j = resp.json()
            json_ok = True
            out = j.get('output', [])
            json_preview = out[:2] if isinstance(out, list) else str(j)[:200]
        except Exception as je:
            json_error = f'{type(je).__name__}: {je}'
        return jsonify({
            'status_code': resp.status_code,
            'encoding': resp.encoding,
            'content_type': resp.headers.get('Content-Type'),
            'raw_hex': raw_bytes.hex(),
            'raw_utf8_attempt': raw_bytes.decode('utf-8', errors='replace'),
            'json_ok': json_ok,
            'json_error': json_error,
            'json_data_preview': json_preview,
        })
    except Exception as e:
        return jsonify({'error': str(e), 'type': type(e).__name__}), 500


@app.route('/api/debug/yf', methods=['GET'])
def debug_yf():
    """yfinance 한국 종목 동작 여부 진단"""
    import yfinance as yf
    results = {}
    test_cases = [
        ('^KS11', 'KOSPI지수'),
        ('005930.KS', '삼성전자'),
        ('000660.KS', 'SK하이닉스'),
        ('035720.KQ', '카카오'),
    ]
    for sym, label in test_cases:
        try:
            hist = yf.Ticker(sym).history(period='5d')
            results[label] = {
                'ok': True,
                'rows': len(hist),
                'last_close': float(hist['Close'].iloc[-1]) if hist is not None and len(hist) > 0 else None,
            }
        except Exception as e:
            results[label] = {'ok': False, 'error': str(e), 'type': type(e).__name__}

    import scanner
    return jsonify({
        'market_open': scanner.is_market_open(),
        'market_status': scanner.get_market_status(),
        'yfinance_tests': results,
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
