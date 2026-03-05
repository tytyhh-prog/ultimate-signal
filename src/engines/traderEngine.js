// 트레이더 기법 엔진 - LAYER 2
// 6개 기법 가중 평균 → 100점 만점

// === 마크 미너비니 SEPA + VCP (90점 만점) ===
export function calcMinervini(stock) {
    let score = 0;
    const conditions = [];

    const { price, ma50, ma150, ma200, ma200Trend, week52Low, week52High, vcpContraction, vcpVolumeBreak } = stock;

    // 조건 1: 현재가 > 50일선 > 150일선 > 200일선
    if (price > ma50 && ma50 > ma150 && ma150 > ma200) {
        score += 15; conditions.push('완전 정배열 ✅');
    }
    // 조건 2: 200일선 1개월 이상 우상향
    if (ma200Trend === 'up') {
        score += 15; conditions.push('200일선 우상향 ✅');
    }
    // 조건 3: 52주 최저가 대비 +30% 이상
    if (week52Low > 0 && price >= week52Low * 1.3) {
        score += 15; conditions.push('52주 저점 대비 +30% ✅');
    }
    // 조건 4: 52주 최고가 대비 -25% 이내
    if (week52High > 0 && price >= week52High * 0.75) {
        score += 15; conditions.push('52주 고점 근접 ✅');
    }
    // 조건 5: VCP 수렴 패턴
    if (vcpContraction) {
        score += 15; conditions.push('VCP 수렴 ✅');
    }
    // 조건 6: 거래량 150% 이상 증가
    if (vcpVolumeBreak) {
        score += 15; conditions.push('VCP 거래량 돌파 ✅');
    }

    return { score, maxScore: 90, conditions, name: '미너비니 SEPA+VCP' };
}

// === 윌리엄 오닐 CAN SLIM (100점 만점) ===
export function calcONeil(stock) {
    let score = 0;
    const conditions = [];

    const { quarterlyEarningsGrowth, annualEarningsYears, isNewHigh, sharesOutstanding, sectorRank, instNewBuyers, kospiAbove200 } = stock;

    // C - 최근 분기 영업이익 증가율 20% 이상
    if (quarterlyEarningsGrowth >= 20) {
        score += 15; conditions.push('C: 분기 이익 +20% ✅');
    }
    // A - 연간 3년 연속 증가
    if (annualEarningsYears >= 3) {
        score += 15; conditions.push('A: 3년 연속 이익 증가 ✅');
    }
    // N - 52주 신고가
    if (isNewHigh) {
        score += 20; conditions.push('N: 52주 신고가 ✅');
    }
    // S - 유통주식수 5000만주 이하
    if (sharesOutstanding <= 50000000) {
        score += 10; conditions.push('S: 소형 유통주식 ✅');
    }
    // L - 업종 내 3개월 수익률 상위 20%
    if (sectorRank <= 20) {
        score += 15; conditions.push('L: 업종 리더 ✅');
    }
    // I - 기관 3개 이상 신규 편입
    if (instNewBuyers >= 3) {
        score += 15; conditions.push('I: 기관 신규 편입 ✅');
    }
    // M - KOSPI 200일선 위
    if (kospiAbove200) {
        score += 10; conditions.push('M: 상승장 ✅');
    }

    return { score, maxScore: 100, conditions, name: '오닐 CAN SLIM' };
}

// === 제시 리버모어 피벗 돌파 (100점 만점) ===
export function calcLivermore(stock) {
    let score = 0;
    const conditions = [];

    const { breakoutResistance, breakoutVolume, closedAboveResistance, trendDirection } = stock;

    // 저항선 돌파 + 거래량 동반
    if (breakoutResistance && breakoutVolume >= 200) {
        score += 40; conditions.push('저항선 돌파 + 거래량 ✅');
    }
    // 돌파 후 종가 유지
    if (closedAboveResistance) {
        score += 30; conditions.push('돌파 후 종가 유지 ✅');
    }
    // 추세 방향 일치
    if (trendDirection === 'up') {
        score += 30; conditions.push('추세 방향 상승 ✅');
    }

    return { score, maxScore: 100, conditions, name: '리버모어 피벗돌파' };
}

// === 스탠 와인스타인 스테이지 (100점 만점) ===
export function calcWeinstein(stock) {
    let score = 0;
    const conditions = [];

    const { stage, ma30wSlope, volumeAboveAvg } = stock;

    // Stage 2 확인
    if (stage === 2) {
        score += 50; conditions.push('Stage 2 상승 추세 ✅');
    }
    // 30주선 우상향 기울기 강함
    if (ma30wSlope === 'strong_up') {
        score += 30;
        conditions.push('30주선 강한 우상향 ✅');
    } else if (ma30wSlope === 'up') {
        score += 15;
        conditions.push('30주선 우상향 ✅');
    }
    // 거래량 평균 이상
    if (volumeAboveAvg) {
        score += 20; conditions.push('거래량 평균 이상 ✅');
    }

    return { score, maxScore: 100, conditions, name: '와인스타인 스테이지' };
}

// === 니콜라스 다바스 박스 이론 (100점 만점) ===
export function calcDarvas(stock) {
    let score = 0;
    const conditions = [];

    const { darvasBoxClear, darvasBreakout, darvasSupport } = stock;

    // 박스 패턴 명확
    if (darvasBoxClear) {
        score += 35; conditions.push('다바스 박스 형성 ✅');
    }
    // 상단 돌파 + 거래량
    if (darvasBreakout) {
        score += 40; conditions.push('박스 상단 돌파 ✅');
    }
    // 이전 박스 상단 지지
    if (darvasSupport) {
        score += 25; conditions.push('이전 상단 지지 ✅');
    }

    return { score, maxScore: 100, conditions, name: '다바스 박스이론' };
}

// === 강환국 모멘텀+밸류 (100점 만점) ===
export function calcKang(stock) {
    let score = 0;
    const conditions = [];

    const { returns1m, returns3m, returns6m, returns12m, pbr, roe, debtRatio, operatingMargin, nearHigh52, volumeSurge } = stock;

    // 1~12개월 수익률 모두 양수
    if (returns1m > 0 && returns3m > 0 && returns6m > 0 && returns12m > 0) {
        score += 20; conditions.push('전 기간 양수 수익률 ✅');
    }
    // PBR 1.5 이하 + ROE 10% 이상
    if (pbr <= 1.5 && roe >= 10) {
        score += 20; conditions.push('PBR≤1.5 & ROE≥10% ✅');
    }
    // 부채비율 100% 이하
    if (debtRatio <= 100) {
        score += 20; conditions.push('부채비율 ≤100% ✅');
    }
    // 영업이익률 5% 이상
    if (operatingMargin >= 5) {
        score += 20; conditions.push('영업이익률 ≥5% ✅');
    }
    // 52주 신고가 근처 + 거래량 급증
    if (nearHigh52 && volumeSurge) {
        score += 20; conditions.push('고점 근처 + 거래량 ✅');
    }

    return { score, maxScore: 100, conditions, name: '강환국 모멘텀+밸류' };
}

// === 트레이더 종합 점수 ===
export function calculateTraderScore(stock) {
    const minervini = calcMinervini(stock);
    const oneil = calcONeil(stock);
    const livermore = calcLivermore(stock);
    const weinstein = calcWeinstein(stock);
    const darvas = calcDarvas(stock);
    const kang = calcKang(stock);

    // 각 기법 100점 만점으로 정규화 후 가중 평균
    const norm = (s) => ({ ...s, normalized: (s.score / s.maxScore) * 100 });
    const methods = [
        { ...norm(minervini), weight: 0.20 },
        { ...norm(oneil), weight: 0.20 },
        { ...norm(livermore), weight: 0.15 },
        { ...norm(weinstein), weight: 0.20 },
        { ...norm(darvas), weight: 0.10 },
        { ...norm(kang), weight: 0.15 },
    ];

    const weightedScore = methods.reduce((sum, m) => sum + m.normalized * m.weight, 0);

    // 어떤 기법이 통과했는지 리스트
    const passedMethods = methods
        .filter(m => m.normalized >= 50)
        .map(m => m.name);

    return {
        score: Math.round(weightedScore),
        methods,
        passedMethods,
        details: methods.flatMap(m => m.conditions),
    };
}
