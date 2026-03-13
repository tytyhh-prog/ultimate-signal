// 수급 추적 엔진 - LAYER 1
// 250점 만점 (기존 200점 + 호가창/파생 50점)

/**
 * null/undefined 안전 변환 (데이터 없음과 실제 0 구분)
 * @returns {number|null} — null이면 데이터 없음
 */
function safeNum(val) {
    if (val === null || val === undefined) return null;
    return Number(val);
}

/**
 * 수급 상태 분류
 * 'active'   — 기관/외국인 실제 매수 존재
 * 'neutral'  — 데이터 있으나 매수 없음 (0 또는 소폭 매도)
 * 'negative' — 기관+외국인 동시 순매도
 * 'missing'  — API 미수신 (null)
 */
function classifySupplyStatus(instNetBuy, foreignNetBuy, supplyDataAvailable, score, rawScore) {
    if (!supplyDataAvailable) return 'missing';
    const hasAnyBuying = (instNetBuy !== null && instNetBuy > 0) ||
                         (foreignNetBuy !== null && foreignNetBuy > 0);
    if (hasAnyBuying || score > 0) return 'active';
    const bothNegative = (instNetBuy !== null && instNetBuy < 0) &&
                         (foreignNetBuy !== null && foreignNetBuy < 0);
    if (bothNegative || rawScore < -10) return 'negative';
    return 'neutral';
}

export function calculateSupplyScore(stock) {
    let score = 0;
    let rawScore = 0; // 감점 전 점수 (negative 판정용)
    const details = [];

    const instNetBuy = safeNum(stock.instNetBuy);
    const foreignNetBuy = safeNum(stock.foreignNetBuy);
    const retailNetBuy = safeNum(stock.retailNetBuy);
    const marketCap = stock.marketCap || 0;
    const instConsecutiveDays = stock.instConsecutiveDays || 0;
    const instAlwaysBuy = stock.instAlwaysBuy || false;
    const instMultipleBuyers = stock.instMultipleBuyers || false;
    const foreignConsecutiveDays = stock.foreignConsecutiveDays || 0;

    // 수급 데이터 가용성
    const supplyDataAvailable = stock.supplyDataAvailable !== false &&
        (instNetBuy !== null || foreignNetBuy !== null);

    if (!supplyDataAvailable) {
        // API 미수신 — null로 전달됨
        const reason = stock.supplySource === 'none'
            ? '수급 API 미수신 (요청 실패)'
            : '수급 데이터 없음 (N/A)';
        details.push(`⚠️ ${reason}`);
        return {
            score: 0,
            maxScore: 250,
            details,
            supplyDataAvailable: false,
            supplyStatus: 'missing',
            instNetBuy,
            foreignNetBuy,
        };
    }

    // === 기관 매수 점수 (80점) ===
    if (instNetBuy !== null && instNetBuy > 0 && marketCap > 0) {
        const ratio = instNetBuy / marketCap;
        if (ratio >= 0.001) {
            score += 20; rawScore += 20;
            details.push('기관 순매수 > 시총 0.1%');
        }
        if (ratio >= 0.003) {
            score += 20; rawScore += 20;
            details.push('기관 순매수 > 시총 0.3%');
        }
    }

    if (instConsecutiveDays >= 3) {
        score += 20; rawScore += 20;
        details.push('기관 3일 연속 순매수');
    }

    if (instAlwaysBuy) {
        score += 10; rawScore += 10;
        details.push('장 시작부터 순매도 없음');
    }

    if (instMultipleBuyers) {
        score += 10; rawScore += 10;
        details.push('투신+연기금+보험 동시 매수');
    }

    // === 외국인 매수 점수 (60점) ===
    if (foreignNetBuy !== null && foreignNetBuy > 0) {
        score += 15; rawScore += 15;
        details.push('외국인 순매수');
    }

    if (instNetBuy !== null && instNetBuy > 0 && foreignNetBuy !== null && foreignNetBuy > 0) {
        score += 30; rawScore += 30;
        details.push('🔥 기관+외국인 쌍끌이');
    }

    if (foreignConsecutiveDays >= 5) {
        score += 15; rawScore += 15;
        details.push('외국인 5일 연속 순매수');
    }

    // === 거래량 폭발 점수 (40점) ===
    const { volumeRatio, volumeEarlyBreak } = stock;

    if (volumeRatio >= 200) {
        score += 20; rawScore += 20;
        details.push('거래량 20일 평균 200% 이상');
    }
    if (volumeRatio >= 400) {
        score += 20; rawScore += 20;
        details.push('거래량 20일 평균 400% 이상');
    }
    if (volumeEarlyBreak) {
        score += 10; rawScore += 10;
        details.push('오전 중 평균 거래량 돌파');
    }

    // === 호가창 분석 점수 (20점) ===
    const orderBook = stock.orderBook || {};

    if (orderBook.bidDominant) {
        score += 12; rawScore += 12;
        details.push('📗 호가창 매수잔량 우위 (60%↑)');
    }
    if (orderBook.askDisappearing) {
        score += 8; rawScore += 8;
        details.push('📗 매도잔량 급감 → 돌파 신호');
    }

    // === 파생상품 신호 점수 (30점) ===
    const derivatives = stock.derivatives || {};

    if (derivatives.callDominant) {
        score += 15; rawScore += 15;
        details.push('📈 옵션 콜 우위 (P/C < 0.8)');
    }

    if (derivatives.instFuturesBuy) {
        score += 15; rawScore += 15;
        details.push('📈 선물 기관 매수 포지션');
    }

    // === 감점 ===
    const creditRatio = stock.creditRatio || 0;
    const lendingIncrease = stock.lendingIncrease || 0;
    const recentDrop = stock.recentDrop || 0;

    if (retailNetBuy !== null && instNetBuy !== null && foreignNetBuy !== null &&
        retailNetBuy > (instNetBuy + foreignNetBuy) && retailNetBuy > 0) {
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

    // 수급 상태 분류
    const supplyStatus = classifySupplyStatus(instNetBuy, foreignNetBuy, supplyDataAvailable, score, rawScore);

    // neutral/negative 상태에서 사유 상세화
    if (supplyStatus === 'neutral') {
        if (instNetBuy === 0 && foreignNetBuy === 0) {
            details.push('⚠️ 기관+외국인 순매수 없음 (0억)');
        } else {
            if (instNetBuy !== null && instNetBuy <= 0) details.push(`⚠️ 기관 순매도/중립 (${instNetBuy}억)`);
            if (foreignNetBuy !== null && foreignNetBuy <= 0) details.push(`⚠️ 외국인 순매도/중립 (${foreignNetBuy}억)`);
        }
    } else if (supplyStatus === 'negative') {
        details.push('🔴 기관+외국인 동시 순매도');
    }

    return {
        score,
        maxScore: 250,
        details,
        supplyDataAvailable: true,
        supplyStatus,
        instNetBuy,
        foreignNetBuy,
    };
}

export function classifySupplyPattern(stock) {
    const instNetBuy = safeNum(stock.instNetBuy);
    const foreignNetBuy = safeNum(stock.foreignNetBuy);
    const { volumeRatio } = stock;

    // 수급 데이터 없으면 일반 패턴
    if (instNetBuy === null && foreignNetBuy === null) {
        return { pattern: '데이터없음', emoji: '❓', description: '수급 데이터 미수신 (N/A)' };
    }

    if (instNetBuy !== null && instNetBuy > 0 && foreignNetBuy !== null && foreignNetBuy > 0 && (instNetBuy + foreignNetBuy) > 20) {
        return { pattern: '쌍끌이', emoji: '🔥', description: '기관+외국인 동시 대량 매수 → 최고 신뢰' };
    }
    if (instNetBuy !== null && instNetBuy > 30 && (foreignNetBuy === null || foreignNetBuy <= 0)) {
        return { pattern: '기관선취매', emoji: '🏦', description: '기관 집중 매수, 외국인 중립' };
    }
    if (volumeRatio >= 300 && ((instNetBuy !== null && instNetBuy > 0) || (foreignNetBuy !== null && foreignNetBuy > 0))) {
        return { pattern: '거래량폭발', emoji: '⚡', description: '수급+거래량 동시 폭발' };
    }
    if (foreignNetBuy !== null && foreignNetBuy > 0 && stock.foreignConsecutiveDays >= 3) {
        return { pattern: '외국인추적', emoji: '📡', description: '외국인 연속 순매수 감지' };
    }

    return { pattern: '일반', emoji: '📊', description: '일반 수급' };
}
