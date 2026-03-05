// ULTIMATE 점수 계산 + 등급 + 익절/손절

export function calculateUltimateScore(supplyResult, traderResult, quantResult) {
    const supplyMax = supplyResult.maxScore || 250;
    const supplyWeighted = (supplyResult.score / supplyMax) * 100 * 0.40;
    const traderWeighted = traderResult.score * 0.35;
    const quantWeighted = quantResult.score * 0.25;

    const ultimateScore = Math.round(supplyWeighted + traderWeighted + quantWeighted);

    // 140점 만점 환산
    const scaledScore = Math.round(ultimateScore * 1.4);

    let grade, gradeEmoji, gradeColor;
    if (scaledScore >= 120) {
        grade = 'DIAMOND'; gradeEmoji = '💎'; gradeColor = 'diamond';
    } else if (scaledScore >= 100) {
        grade = 'FIRE'; gradeEmoji = '🔥'; gradeColor = 'fire';
    } else if (scaledScore >= 80) {
        grade = 'BUY'; gradeEmoji = '✅'; gradeColor = 'buy';
    } else if (scaledScore >= 60) {
        grade = 'WATCH'; gradeEmoji = '👀'; gradeColor = 'watch';
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
        quantWeighted: Math.round(quantWeighted * 10) / 10,
    };
}

export function calculateTargets(price, grade, supplyPattern) {
    const targetMap = {
        'DIAMOND': { t1: 0.06, t2: 0.12, t3: 0.20, stop: 0.05 },
        'FIRE': { t1: 0.05, t2: 0.10, t3: 0.16, stop: 0.05 },
        'BUY': { t1: 0.04, t2: 0.08, t3: 0.13, stop: 0.06 },
        'WATCH': { t1: 0.03, t2: 0.06, t3: 0.10, stop: 0.07 },
    };

    const patternBonus = {
        '쌍끌이': { tBonus: 0.02, stopTight: 0.01 },
        '기관선취매': { tBonus: 0.01, stopTight: 0.00 },
        '거래량폭발': { tBonus: 0.00, stopTight: 0.01 },
        '외국인추적': { tBonus: 0.03, stopTight: 0.00 },
        '일반': { tBonus: 0.00, stopTight: 0.00 },
    };

    const base = targetMap[grade] || targetMap['BUY'];
    const bonus = patternBonus[supplyPattern] || patternBonus['일반'];

    const target1 = Math.round(price * (1 + base.t1 + bonus.tBonus));
    const target2 = Math.round(price * (1 + base.t2 + bonus.tBonus));
    const target3 = Math.round(price * (1 + base.t3 + bonus.tBonus));
    const stop = Math.round(price * (1 - base.stop + bonus.stopTight));
    const riskReward = ((base.t2 + bonus.tBonus) / (base.stop - bonus.stopTight)).toFixed(1);

    return {
        entry: price,
        target1,
        target2,
        target3,
        stop,
        riskReward,
        target1Pct: `+${((base.t1 + bonus.tBonus) * 100).toFixed(0)}%`,
        target2Pct: `+${((base.t2 + bonus.tBonus) * 100).toFixed(0)}%`,
        target3Pct: `+${((base.t3 + bonus.tBonus) * 100).toFixed(0)}%`,
        stopPct: `-${((base.stop - bonus.stopTight) * 100).toFixed(0)}%`,
    };
}
