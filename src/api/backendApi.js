// Flask 백엔드 API 클라이언트
// VITE_BACKEND_URL: Render.com 배포 URL (예: https://ultimate-signal-backend.onrender.com)
// 로컬 개발: http://localhost:5000
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3분 타임아웃

    try {
        const res = await fetch(`${BACKEND_URL}/api/scan`, {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `서버 오류 (${res.status})`);
        }

        return await res.json();
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            throw new Error('요청 시간 초과 (3분). 서버가 깨어나는 중일 수 있습니다. 잠시 후 다시 시도해주세요.');
        }
        throw err;
    }
}

export async function checkHealth() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/health`, {
            signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
