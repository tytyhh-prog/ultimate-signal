// 퀀트 팩터 엔진 - LAYER 3
// 6개 팩터 합산 → 100점 만점 환산

export function calculateQuantScore(stock) {
    let rawScore = 0;
    const maxRaw = 130; // 이론적 최대 원점수
    const details = [];
    const factors = [];

    // === 팩터 1: 모멘텀 (25점) ===
    let momentumScore = 0;
    if (stock.momentumRank <= 20) {
        momentumScore = 25;
        details.push('모멘텀 상위 20% ✅');
    }
    rawScore += momentumScore;
    factors.push({ name: '모멘텀', score: momentumScore, max: 25, passed: momentumScore > 0 });

    // === 팩터 2: 퀄리티 (25점) ===
    let qualityScore = 0;
    if (stock.roeRank <= 30) {
        qualityScore += 10;
        details.push('ROE 상위 30% ✅');
    }
    if (stock.operatingMarginRank <= 30) {
        qualityScore += 10;
        details.push('영업이익률 상위 30% ✅');
    }
    if (stock.debtRatioRank >= 70) { // 하위 30% = 상위 70% 이상
        qualityScore += 5;
        details.push('부채비율 하위 30% ✅');
    }
    rawScore += qualityScore;
    factors.push({ name: '퀄리티', score: qualityScore, max: 25, passed: qualityScore >= 15 });

    // === 팩터 3: 밸류 (25점) ===
    let valueScore = 0;
    if (stock.pbrRank >= 60) { // 하위 40% = 상위 60% 이상
        valueScore += 10;
        details.push('PBR 하위 40% ✅');
    }
    if (stock.perRank >= 60) {
        valueScore += 10;
        details.push('PER 하위 40% ✅');
    }
    if (stock.psrRank >= 60) {
        valueScore += 5;
        details.push('PSR 하위 40% ✅');
    }
    rawScore += valueScore;
    factors.push({ name: '밸류', score: valueScore, max: 25, passed: valueScore >= 15 });

    // === 팩터 4: 저변동성 (15점) ===
    let lowVolScore = 0;
    if (stock.volatilityRank >= 60) { // 하위 40%
        lowVolScore += 10;
        details.push('변동성 하위 40% ✅');
    }
    if (stock.beta >= 0.5 && stock.beta <= 1.2) {
        lowVolScore += 5;
        details.push('베타 0.5~1.2 ✅');
    }
    rawScore += lowVolScore;
    factors.push({ name: '저변동성', score: lowVolScore, max: 15, passed: lowVolScore >= 10 });

    // === 팩터 5: 이익 개선 (30점) ===
    let earningsScore = 0;
    if (stock.targetPriceRevisionUp) {
        earningsScore += 15;
        details.push('목표가 상향 ✅');
    }
    if (stock.earningSurprise) {
        earningsScore += 15;
        details.push('어닝 서프라이즈 ✅');
    }
    rawScore += earningsScore;
    factors.push({ name: '이익개선', score: earningsScore, max: 30, passed: earningsScore >= 15 });

    // === 팩터 6: 소형주 (10점) ===
    let smallCapScore = 0;
    const mcap = stock.marketCap; // 억 단위
    if (mcap >= 500 && mcap <= 3000) {
        smallCapScore = 10;
        details.push('시총 500~3000억 소형주 ✅');
    }
    rawScore += smallCapScore;
    factors.push({ name: '소형주', score: smallCapScore, max: 10, passed: smallCapScore > 0 });

    // 100점 만점으로 환산
    const score = Math.round((rawScore / maxRaw) * 100);

    return {
        score: Math.min(100, score),
        rawScore,
        factors,
        details,
        passedFactors: factors.filter(f => f.passed).map(f => f.name),
    };
}
