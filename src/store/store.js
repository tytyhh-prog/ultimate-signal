// Zustand 상태 관리 스토어
import { create } from 'zustand';
import { DEMO_STOCKS, DEMO_MARKET, DEMO_SECTORS, DEMO_QUANT_INDEX, DEMO_ANALYSIS } from '../api/demoData';
import { fetchScanData } from '../api/backendApi';
import { calculateSupplyScore, classifySupplyPattern } from '../engines/supplyEngine';
import { calculateTraderScore } from '../engines/traderEngine';
import { calculateQuantScore } from '../engines/quantEngine';
import { calculateUltimateScore, calculateTargets } from '../engines/ultimateScorer';

const IS_DEMO = import.meta.env.VITE_USE_DEMO === 'true';

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

    // 스캔 실행
    runScan: async () => {
        set({ loading: true, step: '초기화 중...', progress: 2, error: null, signals: [] });

        try {
            if (IS_DEMO) {
                await runDemoScan(set);
                return;
            }

            // 백엔드 서버 연결 (Render.com 콜드스타트 시 30-90초 소요)
            set({ step: '백엔드 서버 연결 중... (첫 실행 시 1-2분 소요)', progress: 5 });

            set({ step: 'KOSPI/KOSDAQ 전종목 데이터 수집 중...', progress: 15 });
            const data = await fetchScanData();

            const stockCount = data.stocks?.length ?? 0;
            set({
                market: data.market ?? {},
                sectors: data.sectors ?? DEMO_SECTORS,
                step: `${stockCount}개 종목 3중 점수 계산 중...`,
                progress: 60,
            });

            if (stockCount === 0) {
                set({ loading: false, step: '종목 없음', progress: 100, scanned: true, signals: [], error: null });
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

            // 점수 ≥ 60 우선, 없으면 상위 5개 반환
            const sorted = scored.sort((a, b) => b.ultimate.scaledScore - a.ultimate.scaledScore);
            const above60 = sorted.filter(r => r.ultimate.scaledScore >= 60);
            const results = (above60.length > 0 ? above60 : sorted).slice(0, 5);
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
                error: `백엔드 오류: ${err.message}`,
            });
        }
    },

    // 자동 갱신
    toggleAutoRefresh: () => {
        const state = get();
        if (state.autoRefresh) {
            clearInterval(state.refreshInterval);
            set({ autoRefresh: false, refreshInterval: null });
        } else {
            const interval = setInterval(() => { get().runScan(); }, 5 * 60 * 1000);
            set({ autoRefresh: true, refreshInterval: interval });
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
    set({ signals: filtered, loading: false, step: '완료', progress: 100, scanned: true, sectors: DEMO_SECTORS });
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
