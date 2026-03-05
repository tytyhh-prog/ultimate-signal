// 수급 추적 엔진 - LAYER 1
// 250점 만점 (기존 200점 + 호가창/파생 50점)

export function calculateSupplyScore(stock) {
    let score = 0;
    const details = [];

    // === 기관 매수 점수 (80점) ===
    const { instNetBuy, marketCap, instConsecutiveDays, instAlwaysBuy, instMultipleBuyers } = stock;

    if (instNetBuy > 0 && marketCap > 0) {
        const ratio = instNetBuy / marketCap;
        if (ratio >= 0.001) {
            score += 20;
            details.push('기관 순매수 > 시총 0.1%');
        }
        if (ratio >= 0.003) {
            score += 20;
            details.push('기관 순매수 > 시총 0.3%');
        }
    }

    if (instConsecutiveDays >= 3) {
        score += 20;
        details.push('기관 3일 연속 순매수');
    }

    if (instAlwaysBuy) {
        score += 10;
        details.push('장 시작부터 순매도 없음');
    }

    if (instMultipleBuyers) {
        score += 10;
        details.push('투신+연기금+보험 동시 매수');
    }

    // === 외국인 매수 점수 (60점) ===
    const { foreignNetBuy, foreignConsecutiveDays } = stock;

    if (foreignNetBuy > 0) {
        score += 15;
        details.push('외국인 순매수');
    }

    if (instNetBuy > 0 && foreignNetBuy > 0) {
        score += 30;
        details.push('🔥 기관+외국인 쌍끌이');
    }

    if (foreignConsecutiveDays >= 5) {
        score += 15;
        details.push('외국인 5일 연속 순매수');
    }

    // === 거래량 폭발 점수 (40점) ===
    const { volumeRatio, volumeEarlyBreak } = stock;

    if (volumeRatio >= 200) {
        score += 20;
        details.push('거래량 20일 평균 200% 이상');
    }
    if (volumeRatio >= 400) {
        score += 20;
        details.push('거래량 20일 평균 400% 이상');
    }
    if (volumeEarlyBreak) {
        score += 10;
        details.push('오전 중 평균 거래량 돌파');
    }

    // === 호가창 분석 점수 (20점) 🆕 ===
    const orderBook = stock.orderBook || {};

    if (orderBook.bidDominant) {
        score += 12;
        details.push('📗 호가창 매수잔량 우위 (60%↑)');
    }
    if (orderBook.askDisappearing) {
        score += 8;
        details.push('📗 매도잔량 급감 → 돌파 신호');
    }

    // === 파생상품 신호 점수 (30점) 🆕 ===
    const derivatives = stock.derivatives || {};

    // 옵션 풋/콜 비율이 낮으면 콜 우위 → 매수 우호적
    if (derivatives.callDominant) {
        score += 15;
        details.push('📈 옵션 콜 우위 (P/C < 0.8)');
    }

    // 선물 기관 매수 포지션
    if (derivatives.instFuturesBuy) {
        score += 15;
        details.push('📈 선물 기관 매수 포지션');
    }

    // === 감점 ===
    const { retailNetBuy, creditRatio, lendingIncrease, recentDrop } = stock;

    if (retailNetBuy > (instNetBuy + foreignNetBuy) && retailNetBuy > 0) {
        score -= 30;
        details.push('⚠️ 개인 과매수 감점 -30');
    }

    if (creditRatio > 3) {
        score -= 20;
        details.push('⚠️ 신용잔고 과열 감점 -20');
    }

    if (lendingIncrease > 20) {
        score -= 20;
        details.push('⚠️ 대차잔고 급증 감점 -20');
    }

    if (recentDrop < -15) {
        score -= 15;
        details.push('⚠️ 최근 급락 이력 감점 -15');
    }

    // 0~250 범위 클램프
    score = Math.max(0, Math.min(250, score));

    return { score, maxScore: 250, details };
}

export function classifySupplyPattern(stock) {
    const { instNetBuy, foreignNetBuy, volumeRatio } = stock;

    if (instNetBuy > 0 && foreignNetBuy > 0 && (instNetBuy + foreignNetBuy) > 20) {
        return { pattern: '쌍끌이', emoji: '🔥', description: '기관+외국인 동시 대량 매수 → 최고 신뢰' };
    }
    if (instNetBuy > 30 && foreignNetBuy <= 0) {
        return { pattern: '기관선취매', emoji: '🏦', description: '기관 집중 매수, 외국인 중립' };
    }
    if (volumeRatio >= 300 && (instNetBuy > 0 || foreignNetBuy > 0)) {
        return { pattern: '거래량폭발', emoji: '⚡', description: '수급+거래량 동시 폭발' };
    }
    if (foreignNetBuy > 0 && stock.foreignConsecutiveDays >= 3) {
        return { pattern: '외국인추적', emoji: '📡', description: '외국인 연속 순매수 감지' };
    }

    return { pattern: '일반', emoji: '📊', description: '일반 수급' };
}
