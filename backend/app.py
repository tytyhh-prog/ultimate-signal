"""
Ultimate Signal - Python Flask 백엔드
FinanceDataReader 기반 한국 주식 스캔 API
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
CORS(app, origins='*')


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


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


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
