// Flask 백엔드 API 클라이언트
// VITE_BACKEND_URL: Render.com 배포 URL
// 로컬 개발: http://localhost:5000

const RAW_URL = import.meta.env.VITE_BACKEND_URL;

if (!RAW_URL) {
    console.warn('[backendApi] ⚠️ VITE_BACKEND_URL 환경변수가 없습니다. localhost:5000으로 폴백합니다.');
}

const BACKEND_URL = (RAW_URL || 'http://localhost:5000').replace(/\/$/, '');

console.log(`[backendApi] 백엔드 URL: ${BACKEND_URL}`);

// 최대 재시도 횟수
const MAX_RETRY = 3;

/**
 * 수급 데이터 검증
 * 기관 + 외국인 + 개인 모두 0이면 API 오류로 판단
 */
function validateSupplyData(stocks) {
    if (!stocks || stocks.length === 0) return true; // 종목이 없으면 검증 패스

    const allZero = stocks.every(stock =>
        (stock.instNetBuy === 0 || stock.instNetBuy == null) &&
        (stock.foreignNetBuy === 0 || stock.foreignNetBuy == null) &&
        (stock.retailNetBuy === 0 || stock.retailNetBuy == null)
    );

    if (allZero) {
        console.warn('[backendApi] ⚠️ 수급 데이터 검증 실패: 모든 종목의 기관/외국인/개인 데이터가 0입니다.');
        return false;
    }

    console.log('[backendApi] ✅ 수급 데이터 검증 통과');
    return true;
}

/**
 * 전체 스캔 실행 (캐시 완전 우회 + 수급 검증 + 자동 재시도)
 * - KOSPI/KOSDAQ 거래량 TOP 50 분석
 * - 기술적 지표 계산 (MA, VCP, Darvas, Stage)
 * - 업종별 등락률, KOSPI/KOSDAQ 지수 포함
 *
 * 첫 요청(Render 콜드스타트) 시 30-90초 소요될 수 있음
 */
export async function fetchScanData(retryCount = 0) {
    // 타임스탬프로 CDN 캐시 완전 우회
    const timestamp = Date.now();
    const url = `${BACKEND_URL}/api/scan?_t=${timestamp}`;
    console.log(`[backendApi] 요청 URL: ${url} (시도 ${retryCount + 1}/${MAX_RETRY})`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3분 타임아웃

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
        clearTimeout(timeoutId);

        console.log(`[backendApi] 응답 status: ${res.status}`);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `서버 오류 (HTTP ${res.status})`);
        }

        const data = await res.json();
        console.log(`[backendApi] 수신: 종목 ${data.stocks?.length ?? 0}개, KOSPI ${data.market?.kospi ?? 0}`);
        console.log('[backendApi] API response:', data);

        // 수급 데이터 검증 — 모두 0이면 재시도
        if (!validateSupplyData(data.stocks) && retryCount < MAX_RETRY - 1) {
            console.warn(`[backendApi] 수급 데이터 이상 감지 — ${retryCount + 2}번째 재시도 중...`);
            await new Promise(r => setTimeout(r, 2000)); // 2초 대기 후 재시도
            return fetchScanData(retryCount + 1);
        }

        return data;
    } catch (err) {
        clearTimeout(timeoutId);

        if (err.name === 'AbortError') {
            throw new Error('요청 시간 초과 (3분). 서버가 깨어나는 중일 수 있습니다. 잠시 후 다시 시도해주세요.');
        }

        console.error(`[backendApi] 오류:`, err);

        // 네트워크 오류 시 재시도
        if (retryCount < MAX_RETRY - 1) {
            console.warn(`[backendApi] 네트워크 오류 — ${retryCount + 2}번째 재시도 중... (3초 후)`);
            await new Promise(r => setTimeout(r, 3000));
            return fetchScanData(retryCount + 1);
        }

        throw err;
    }
}

/**
 * KOSPI/KOSDAQ 지수만 빠르게 조회 (스캔 없이)
 */
export async function fetchMarketData() {
    const url = `${BACKEND_URL}/api/market?_t=${Date.now()}`;
    console.log(`[backendApi] 시장 지수 요청: ${url}`);
    const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
    if (!res.ok) throw new Error(`시장 데이터 오류 (HTTP ${res.status})`);
    return res.json();
}

export async function checkHealth() {
    const url = `${BACKEND_URL}/health`;
    console.log(`[backendApi] 헬스체크: ${url}`);
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
            cache: 'no-store',
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
            },
        });
        console.log(`[backendApi] 헬스체크 결과: ${res.status}`);
        return res.ok;
    } catch (e) {
        console.warn('[backendApi] 헬스체크 실패:', e.message);
        return false;
    }
}
