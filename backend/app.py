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
    return jsonify({'ok': True, 'status': 'ok', 'version': 'v4-debug'})


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
