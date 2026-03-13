// ULTIMATE 점수 계산 + 등급 + 익절/손절 + EXCLUDE 사유

/**
 * supplyStatus 기반 가중치 전략
 *
 * 'active'   — 수급 매수 확인   → 40:35:25 (수급 최우선)
 * 'neutral'  — 수급 0/중립      → 20:50:30 (기법 중심, 수급 소폭 반영)
 * 'negative' — 수급 매도 확인   → 40:35:25 (패널티 그대로 반영)
 * 'missing'  — 수급 API 미수신  → 0:60:40  (기법+퀀트만)
 */
function getWeights(supplyStatus) {
    switch (supplyStatus) {
        case 'active':   return { s: 0.40, t: 0.35, q: 0.25 };
        case 'neutral':  return { s: 0.20, t: 0.50, q: 0.30 };
        case 'negative': return { s: 0.40, t: 0.35, q: 0.25 };
        case 'missing':
        default:         return { s: 0.00, t: 0.60, q: 0.40 };
    }
}

export function calculateUltimateScore(supplyResult, traderResult, quantResult) {
    const supplyMax = supplyResult.maxScore || 250;
    const supplyStatus = supplyResult.supplyStatus ||
        (supplyResult.supplyDataAvailable !== false ? 'active' : 'missing');

    const w = getWeights(supplyStatus);

    const supplyWeighted  = (supplyResult.score / supplyMax) * 100 * w.s;
    const traderWeighted  = traderResult.score * w.t;
    const quantWeighted   = quantResult.score  * w.q;
    const ultimateScore   = Math.round(supplyWeighted + traderWeighted + quantWeighted);

    // 140점 만점 환산
    const scaledScore = Math.round(ultimateScore * 1.4);

    // ── EXCLUDE 사유 수집 ──────────────────────────────────────
    const excludeReasons = [];

    // 수급 사유 (상태별 상세)
    if (supplyStatus === 'missing') {
        excludeReasons.push('수급 API 미수신 — 기법+퀀트 기준으로만 채점');
    } else if (supplyStatus === 'neutral') {
        const inst = supplyResult.instNetBuy;
        const foreign = supplyResult.foreignNetBuy;
        if (inst === 0 && foreign === 0) {
            excludeReasons.push('기관+외국인 순매수 없음 (0억) — 수급 중립');
        } else {
            if (inst !== null && inst <= 0) excludeReasons.push(`기관 순매도/중립 (${inst}억)`);
            if (foreign !== null && foreign <= 0) excludeReasons.push(`외국인 순매도/중립 (${foreign}억)`);
        }
    } else if (supplyStatus === 'negative') {
        excludeReasons.push('기관+외국인 동시 순매도 — 수급 악화');
    } else if (supplyStatus === 'active' && supplyResult.score <= 0) {
        excludeReasons.push('수급 점수 부족 (0점)');
    }

    // 기법 사유
    if (traderResult.score < 30) {
        excludeReasons.push(`기법 점수 부족 (${traderResult.score}/100)`);
    }
    if (traderResult.passedMethods && traderResult.passedMethods.length === 0) {
        excludeReasons.push('통과한 트레이더 기법 없음');
    }

    // 퀀트 사유
    if (quantResult.score < 30) {
        excludeReasons.push(`퀀트 점수 부족 (${quantResult.score}/100)`);
    }

    // ── 등급 결정 ──────────────────────────────────────────────
    let grade, gradeEmoji, gradeColor;

    if (scaledScore >= 120) {
        grade = 'DIAMOND'; gradeEmoji = '💎'; gradeColor = 'diamond';
    } else if (scaledScore >= 100) {
        grade = 'FIRE'; gradeEmoji = '🔥'; gradeColor = 'fire';
    } else if (scaledScore >= 80) {
        grade = 'BUY'; gradeEmoji = '✅'; gradeColor = 'buy';
    } else if (scaledScore >= 60) {
        grade = 'WATCH'; gradeEmoji = '👀'; gradeColor = 'watch';
    } else if (
        scaledScore >= 40 &&
        (supplyStatus === 'missing' || supplyStatus === 'neutral') &&
        traderResult.score >= 30
    ) {
        // 수급 미확인이지만 기법+퀀트가 일정 수준 이상 → EXCLUDE 대신 UNCONFIRMED
        grade = 'UNCONFIRMED'; gradeEmoji = '🔍'; gradeColor = 'unconfirmed';
    } else {
        grade = 'EXCLUDE'; gradeEmoji = '❌'; gradeColor = 'stop';
    }

    return {
        rawScore: ultimateScore,
        scaledScore,
        grade,
        gradeEmoji,
        gradeColor,
        supplyWeighted: Math.round(supplyWeighted * 10) / 10,
        traderWeighted: Math.round(traderWeighted * 10) / 10,
        quantWeighted:  Math.round(quantWeighted  * 10) / 10,
        excludeReasons,
        supplyDataAvailable: supplyResult.supplyDataAvailable !== false,
        supplyStatus,
    };
}

export function calculateTargets(price, grade, supplyPattern) {
    const targetMap = {
        'DIAMOND':     { t1: 0.06, t2: 0.12, t3: 0.20, stop: 0.05 },
        'FIRE':        { t1: 0.05, t2: 0.10, t3: 0.16, stop: 0.05 },
        'BUY':         { t1: 0.04, t2: 0.08, t3: 0.13, stop: 0.06 },
        'WATCH':       { t1: 0.03, t2: 0.06, t3: 0.10, stop: 0.07 },
        'UNCONFIRMED': { t1: 0.03, t2: 0.06, t3: 0.10, stop: 0.07 },
    };

    const patternBonus = {
        '쌍끌이':   { tBonus: 0.02, stopTight: 0.01 },
        '기관선취매': { tBonus: 0.01, stopTight: 0.00 },
        '거래량폭발': { tBonus: 0.00, stopTight: 0.01 },
        '외국인추적': { tBonus: 0.03, stopTight: 0.00 },
        '일반':      { tBonus: 0.00, stopTight: 0.00 },
        '데이터없음': { tBonus: 0.00, stopTight: 0.00 },
    };

    const base  = targetMap[grade]  || targetMap['BUY'];
    const bonus = patternBonus[supplyPattern] || patternBonus['일반'];

    const target1 = Math.round(price * (1 + base.t1 + bonus.tBonus));
    const target2 = Math.round(price * (1 + base.t2 + bonus.tBonus));
    const target3 = Math.round(price * (1 + base.t3 + bonus.tBonus));
    const stop    = Math.round(price * (1 - base.stop + bonus.stopTight));
    const stopDivisor = base.stop - bonus.stopTight;
    const riskReward = stopDivisor > 0 ? ((base.t2 + bonus.tBonus) / stopDivisor).toFixed(1) : '∞';

    return {
        entry: price,
        target1, target2, target3, stop, riskReward,
        target1Pct: `+${((base.t1 + bonus.tBonus) * 100).toFixed(0)}%`,
        target2Pct: `+${((base.t2 + bonus.tBonus) * 100).toFixed(0)}%`,
        target3Pct: `+${((base.t3 + bonus.tBonus) * 100).toFixed(0)}%`,
        stopPct:    `-${((base.stop - bonus.stopTight) * 100).toFixed(0)}%`,
    };
}
