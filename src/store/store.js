// Zustand 상태 관리 스토어
import { create } from 'zustand';
import { DEMO_STOCKS, DEMO_MARKET, DEMO_SECTORS, DEMO_QUANT_INDEX, DEMO_ANALYSIS } from '../api/demoData';
import { fetchScanData } from '../api/backendApi';
import { calculateSupplyScore, classifySupplyPattern } from '../engines/supplyEngine';
import { calculateTraderScore } from '../engines/traderEngine';
import { calculateQuantScore } from '../engines/quantEngine';
import { calculateUltimateScore, calculateTargets } from '../engines/ultimateScorer';
import { fetchMarketData as fetchMarketDataApi } from '../api/backendApi';

const IS_DEMO = import.meta.env.VITE_USE_DEMO === 'true';

// 장중 갱신 간격: 10초
const MARKET_OPEN_INTERVAL = 10 * 1000;
// 장외 갱신 간격: 5분
const MARKET_CLOSED_INTERVAL = 5 * 60 * 1000;
// 에러 발생 시 재시도 간격: 30초
const ERROR_RETRY_INTERVAL = 30 * 1000;

/**
 * 한국 장 시간 체크 (KST 09:00~15:30)
 * UTC 기반으로 계산하여 정확한 KST 시간 획득
 */
export function isKoreanMarketOpen() {
    const now = new Date();
    // UTC 시간에 +9시간을 더해 KST 획득
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const kstTotalMinutes = (utcHours * 60 + utcMinutes + 9 * 60) % (24 * 60);
    const kstHours = Math.floor(kstTotalMinutes / 60);
    const kstMinutes = kstTotalMinutes % 60;

    // KST 기준 요일 체크 (토/일 제외)
    const utcDay = now.getUTCDay();
    // KST 날짜 경계 보정
    const kstDayOffset = (utcHours + 9 >= 24) ? 1 : 0;
    const kstDay = (utcDay + kstDayOffset) % 7;
    if (kstDay === 0 || kstDay === 6) {
        console.log(`[장시간] KST ${kstHours}:${String(kstMinutes).padStart(2, '0')} — 주말(${kstDay === 0 ? '일' : '토'}요일) → 장외`);
        return false;
    }

    const marketOpen = kstHours * 60 + kstMinutes >= 9 * 60;       // 09:00 이후
    const marketClose = kstHours * 60 + kstMinutes <= 15 * 60 + 30; // 15:30 이전
    const isOpen = marketOpen && marketClose;

    console.log(`[장시간] KST ${kstHours}:${String(kstMinutes).padStart(2, '0')} — ${isOpen ? '🟢 장중' : '🔴 장외'}`);
    return isOpen;
}

const useStore = create((set, get) => ({
    // 상태
    signals: [],
    loading: false,
    step: '',
    progress: 0,
    market: { kospi: 0, kospiChange: 0, kosdaq: 0, kosdaqChange: 0, marketStatus: 'closed', kospiAbove200: true },
    sectors: DEMO_SECTORS,
    quantIndex: DEMO_QUANT_INDEX,
    autoRefresh: false,
    refreshInterval: null,
    scanned: false,
    error: null,
    lastUpdated: null,       // 마지막 갱신 시각
    marketOpen: false,        // 현재 장 상태
    errorRetryTimeout: null,  // (미사용 — 자동 재시도 제거됨)

    // 시장 지수만 빠르게 조회 (페이지 로딩 시 1회 — 스캔 없이)
    fetchMarketData: async () => {
        try {
            console.log('[fetchMarketData] KOSPI/KOSDAQ 지수 로딩 중...');
            const data = await fetchMarketDataApi();
            set({ market: data });
            console.log(`[fetchMarketData] 완료 — KOSPI: ${data.kospi}, KOSDAQ: ${data.kosdaq}`);
        } catch (err) {
            console.warn('[fetchMarketData] 시장 지수 로드 실패:', err.message);
        }
    },

    // 스캔 실행 (버튼 클릭 시에만 호출)
    runScan: async () => {
        console.log('[runScan] analysis start triggered — 버튼 클릭으로 시작');
        // signals는 초기화하지 않음 — scan 완료 시에만 덮어씀 (깜빡임 방지)
        set({ loading: true, step: '초기화 중...', progress: 2, error: null });

        // 장 상태 업데이트
        const isOpen = isKoreanMarketOpen();
        set({ marketOpen: isOpen });

        try {
            if (IS_DEMO) {
                await runDemoScan(set);
                return;
            }

            // 백엔드 서버 연결 (Render.com 콜드스타트 시 30-90초 소요)
            set({ step: '백엔드 서버 연결 중... (첫 실행 시 1-2분 소요)', progress: 5 });

            set({ step: 'KOSPI/KOSDAQ 전종목 데이터 수집 중...', progress: 15 });
            console.log(`[runScan] 스캔 시작 — 장 상태: ${isOpen ? '장중' : '장외'}`);
            const data = await fetchScanData();

            const stockCount = data.stocks?.length ?? 0;
            set({
                market: data.market ?? {},
                sectors: data.sectors ?? DEMO_SECTORS,
                step: `${stockCount}개 종목 3중 점수 계산 중...`,
                progress: 60,
            });

            if (stockCount === 0) {
                set({ loading: false, step: '종목 없음', progress: 100, scanned: true, signals: [], error: null, lastUpdated: new Date() });
                return;
            }

            // 3레이어 점수 계산 (프론트엔드 엔진)
            set({ step: '수급 + 기법 + 퀀트 3중 점수 계산 중...', progress: 75 });
            const scored = data.stocks.map(stock => {
                const supplyResult = calculateSupplyScore(stock);
                const supplyPattern = classifySupplyPattern(stock);
                const traderResult = calculateTraderScore(stock);
                const quantResult = calculateQuantScore(stock);
                const ultimate = calculateUltimateScore(supplyResult, traderResult, quantResult);
                const targets = calculateTargets(stock.price, ultimate.grade, supplyPattern.pattern);
                return { ...stock, supplyResult, supplyPattern, traderResult, quantResult, ultimate, targets };
            });

            set({ step: 'ULTIMATE 등급 필터링 중...', progress: 85 });
            console.log(`[runScan] 수집된 종목: ${scored.length}개`);
            console.log('[runScan] 점수 분포:', scored.map(s => `${s.name}:${s.ultimate.scaledScore}`).join(', '));

            // 수급 데이터 상세 로그
            scored.forEach(s => {
                console.log(`[runScan] ${s.name} 수급: 기관 ${s.instNetBuy}억, 외국인 ${s.foreignNetBuy}억, 개인 ${s.retailNetBuy}억, 거래량 ${s.volume?.toLocaleString()}`);
            });

            // 등급 우선순위 필터
            // 1순위: 점수 ≥ 60 (WATCH 이상)
            // 2순위: UNCONFIRMED (수급 미확인이지만 기법+퀀트 통과)
            // 3순위: 점수 기준 상위 5개
            const sorted = scored.sort((a, b) => b.ultimate.scaledScore - a.ultimate.scaledScore);
            const above60 = sorted.filter(r => r.ultimate.scaledScore >= 60);
            const unconfirmed = sorted.filter(r => r.ultimate.grade === 'UNCONFIRMED');
            const results = above60.length > 0
                ? above60.slice(0, 5)
                : unconfirmed.length > 0
                    ? unconfirmed.slice(0, 5)
                    : sorted.slice(0, 5);
            console.log(`[runScan] 최종 반환: ${results.length}개`);

            set({ step: 'AI 분석 생성 중...', progress: 92 });
            const withAnalysis = results.map(stock => ({
                ...stock,
                analysis: generateTemplateAnalysis(stock),
            }));

            set({
                signals: withAnalysis,
                loading: false,
                step: '완료',
                progress: 100,
                scanned: true,
                lastUpdated: new Date(),
            });

            // DIAMOND 등급 푸시 알림
            const diamonds = withAnalysis.filter(s => s.ultimate.grade === 'DIAMOND');
            if (diamonds.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
                diamonds.forEach(d => {
                    new Notification('💎 DIAMOND 신호 감지!', {
                        body: `${d.name} ${d.ultimate.scaledScore}점 - 매수가 ${d.price.toLocaleString()}원`,
                    });
                });
            }

        } catch (err) {
            console.error('[runScan] 스캔 오류:', err);
            set({
                loading: false, step: '오류 발생', progress: 0,
                scanned: true, signals: [],
                error: `실시간 데이터 오류: ${err.message}`,
                lastUpdated: new Date(),
            });

            // 에러 발생 시 자동 재시도 없음 — 사용자가 버튼을 직접 눌러야 재실행
            const prevTimeout = get().errorRetryTimeout;
            if (prevTimeout) clearTimeout(prevTimeout);
        }
    },

    // 자동 갱신 — 시장 지수만 갱신 (scan 실행 금지)
    // 장중 10초 / 장외 5분 간격으로 fetchMarketData()만 호출
    toggleAutoRefresh: () => {
        const state = get();
        if (state.autoRefresh) {
            clearInterval(state.refreshInterval);
            set({ autoRefresh: false, refreshInterval: null });
            console.log('[자동갱신] OFF');
        } else {
            const isOpen = isKoreanMarketOpen();
            const interval = isOpen ? MARKET_OPEN_INTERVAL : MARKET_CLOSED_INTERVAL;
            console.log(`[자동갱신] ON — ${isOpen ? '장중 10초' : '장외 5분'} 간격 (시장지수만 갱신, scan 없음)`);

            const id = setInterval(() => {
                // 매 갱신마다 장 상태 재체크 → 간격 자동 전환
                const currentOpen = isKoreanMarketOpen();
                const currentState = get();

                // 장 상태 변경 시 간격 재설정
                if (currentOpen !== currentState.marketOpen) {
                    console.log(`[자동갱신] 장 상태 변경: ${currentOpen ? '장외→장중' : '장중→장외'} — 간격 재설정`);
                    clearInterval(currentState.refreshInterval);
                    set({ marketOpen: currentOpen });

                    const newInterval = currentOpen ? MARKET_OPEN_INTERVAL : MARKET_CLOSED_INTERVAL;
                    const newId = setInterval(() => { get().fetchMarketData(); }, newInterval);
                    set({ refreshInterval: newId });
                }

                // scan 금지 — 시장 지수만 갱신
                get().fetchMarketData();
            }, interval);

            set({ autoRefresh: true, refreshInterval: id, marketOpen: isOpen });
        }
    },

    // 장중 자동갱신 시작 — runScan()은 포함하지 않음 (버튼 클릭 시에만 스캔)
    startMarketAutoRefresh: () => {
        const state = get();
        if (state.autoRefresh) return;

        const isOpen = isKoreanMarketOpen();
        if (isOpen) {
            console.log('[자동시작] 장중 감지 → 자동갱신 ON (첫 스캔은 버튼 클릭으로 시작)');
            get().toggleAutoRefresh();
        }
    },

    // 알림 권한 요청
    requestNotification: async () => {
        if ('Notification' in window) {
            await Notification.requestPermission();
        }
    },
}));


// =========================================
// 데모 모드 스캔
// =========================================
async function runDemoScan(set) {
    set({ step: '전체 종목 수집 중...', progress: 10 });
    await delay(400);
    set({ step: '2,847개 종목 기본 필터 적용 중...', progress: 20, market: DEMO_MARKET });
    await delay(500);
    set({ step: '수급 데이터 분석 중...', progress: 35 });
    await delay(600);
    set({ step: '트레이더 기법 6개 적용 중...', progress: 55 });
    await delay(500);
    set({ step: '퀀트 팩터 6개 계산 중...', progress: 72 });
    await delay(400);
    set({ step: 'ULTIMATE 점수 산출 중...', progress: 88 });

    const results = DEMO_STOCKS.map(stock => {
        const supplyResult = calculateSupplyScore(stock);
        const supplyPattern = classifySupplyPattern(stock);
        const traderResult = calculateTraderScore(stock);
        const quantResult = calculateQuantScore(stock);
        const ultimate = calculateUltimateScore(supplyResult, traderResult, quantResult);
        const targets = calculateTargets(stock.price, ultimate.grade, supplyPattern.pattern);
        const analysis = DEMO_ANALYSIS[stock.ticker] || '';
        return { ...stock, supplyResult, supplyPattern, traderResult, quantResult, ultimate, targets, analysis };
    });

    const filtered = results
        .filter(r => r.ultimate.scaledScore >= 60)
        .sort((a, b) => b.ultimate.scaledScore - a.ultimate.scaledScore)
        .slice(0, 5);

    await delay(300);
    set({ step: 'AI 분석 생성 중...', progress: 95 });
    await delay(500);
    set({ signals: filtered, loading: false, step: '완료', progress: 100, scanned: true, sectors: DEMO_SECTORS, lastUpdated: new Date() });
}


// =========================================
// 템플릿 기반 AI 분석 생성
// =========================================
function generateTemplateAnalysis(stock) {
    const supplyText = stock.instNetBuy > 0 && stock.foreignNetBuy > 0
        ? `기관 ${stock.instNetBuy > 0 ? '+' : ''}${stock.instNetBuy}억, 외국인 ${stock.foreignNetBuy > 0 ? '+' : ''}${stock.foreignNetBuy}억의 ${stock.supplyPattern.pattern} 수급 패턴이 감지되며, ${stock.instConsecutiveDays}일 연속 기관 순매수가 진행 중입니다.`
        : `거래량이 20일 평균 대비 ${stock.volumeRatio}%로 상승하며 시장의 관심이 집중되고 있습니다.`;

    const traderText = stock.traderResult.passedMethods.length > 0
        ? `${stock.traderResult.passedMethods.slice(0, 3).join(', ')} 기법 조건을 충족하며, 기술적으로 매수 적격 구간에 위치합니다.`
        : `이동평균선 배열 상태에서 ${stock.ma200Trend === 'up' ? '상승 추세' : '하락 추세'}가 유지되고 있습니다.`;

    const quantText = stock.quantResult.passedFactors.length > 0
        ? `${stock.quantResult.passedFactors.join('·')} 퀀트 팩터가 동시 충족되어, 팩터 기반 초과수익 가능성이 높습니다.`
        : `PBR ${stock.pbr}배 수준에서 밸류에이션 매력이 있으며, 모멘텀 지표가 양호합니다.`;

    const actionText = `${stock.price.toLocaleString()}원 근처 매수 후 ${stock.targets.target1.toLocaleString()}원(${stock.targets.target1Pct})에서 1차 익절, ${stock.targets.stop.toLocaleString()}원 이탈 시 손절을 권고하며, 이는 투자 권유가 아닌 분석 정보입니다.`;

    return `${supplyText} ${traderText} ${quantText} ${actionText}`;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default useStore;
