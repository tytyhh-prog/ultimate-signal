// Flask 백엔드 API 클라이언트
// VITE_BACKEND_URL: Render.com 배포 URL
// 로컬 개발: http://localhost:5000

const RAW_URL = import.meta.env.VITE_BACKEND_URL;

if (!RAW_URL) {
    console.warn('[backendApi] ⚠️ VITE_BACKEND_URL 환경변수가 없습니다. localhost:5000으로 폴백합니다.');
}

const BACKEND_URL = (RAW_URL || 'http://localhost:5000').replace(/\/$/, '');

console.log(`[backendApi] 백엔드 URL: ${BACKEND_URL}`);

/**
 * 전체 스캔 실행
 * - KOSPI/KOSDAQ 거래량 TOP 50 분석
 * - 기술적 지표 계산 (MA, VCP, Darvas, Stage)
 * - 업종별 등락률, KOSPI/KOSDAQ 지수 포함
 *
 * 첫 요청(Render 콜드스타트) 시 30-90초 소요될 수 있음
 * 5분 캐시로 이후 요청은 즉시 응답
 */
export async function fetchScanData() {
    const url = `${BACKEND_URL}/api/scan`;
    console.log(`[backendApi] 요청 URL: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3분 타임아웃

    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        console.log(`[backendApi] 응답 status: ${res.status}`);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `서버 오류 (HTTP ${res.status})`);
        }

        const data = await res.json();
        console.log(`[backendApi] 수신: 종목 ${data.stocks?.length ?? 0}개, KOSPI ${data.market?.kospi ?? 0}`);
        return data;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('요청 시간 초과 (3분). 서버가 깨어나는 중일 수 있습니다. 잠시 후 다시 시도해주세요.');
        }
        console.error(`[backendApi] 오류:`, err);
        throw err;
    }
}

export async function checkHealth() {
    const url = `${BACKEND_URL}/health`;
    console.log(`[backendApi] 헬스체크: ${url}`);
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        console.log(`[backendApi] 헬스체크 결과: ${res.status}`);
        return res.ok;
    } catch (e) {
        console.warn('[backendApi] 헬스체크 실패:', e.message);
        return false;
    }
}
