import React, { useState } from 'react';
import ScoreBar from './ScoreBar';

const gradeStyles = {
    DIAMOND:     { bg: 'bg-[#b9f2ff]/10', border: 'border-[#b9f2ff]/30', text: 'text-[#b9f2ff]',  glow: 'animate-diamond-pulse' },
    FIRE:        { bg: 'bg-[#ff6b35]/10', border: 'border-[#ff6b35]/30', text: 'text-[#ff6b35]',  glow: 'glow-fire' },
    BUY:         { bg: 'bg-[#00e676]/10', border: 'border-[#00e676]/30', text: 'text-[#00e676]',  glow: 'glow-buy' },
    WATCH:       { bg: 'bg-[#ffd600]/10', border: 'border-[#ffd600]/30', text: 'text-[#ffd600]',  glow: '' },
    UNCONFIRMED: { bg: 'bg-[#ab47bc]/10', border: 'border-[#ab47bc]/30', text: 'text-[#ab47bc]',  glow: '' },
    EXCLUDE:     { bg: 'bg-[#78909c]/10', border: 'border-[#78909c]/30', text: 'text-[#78909c]',  glow: '' },
};

/**
 * 수급 값 표시: null → "N/A", 숫자 → "+12억" / "-5억" / "0억"
 */
function formatSupply(val) {
    if (val === null || val === undefined) return { text: 'N/A', colorClass: 'text-[var(--color-text-muted)]' };
    const prefix = val >= 0 ? '+' : '';
    const colorClass = val > 0 ? 'text-[var(--color-up)]' : val < 0 ? 'text-[var(--color-down)]' : 'text-[var(--color-text-secondary)]';
    return { text: `${prefix}${val}억`, colorClass };
}

export default function SignalCard({ signal, index }) {
    const [expanded, setExpanded] = useState(false);
    const s = gradeStyles[signal.ultimate.grade] || gradeStyles.WATCH;

    const instDisplay = formatSupply(signal.instNetBuy);
    const foreignDisplay = formatSupply(signal.foreignNetBuy);
    const retailDisplay = formatSupply(signal.retailNetBuy);

    // 수급 데이터 소스 라벨
    const supplySourceLabel = signal.supplySource === 'live' ? '🟢 실시간'
        : signal.supplySource === 'closing' ? '🟡 장마감 기준'
            : signal.supplySource === 'cache' ? '🟠 캐시'
                : '⚪ N/A';

    return (
        <div
            className={`animate-slide-up border rounded-2xl ${s.border} ${s.bg} ${s.glow} bg-[var(--color-bg-card)] overflow-hidden transition-all duration-300 hover:border-opacity-60`}
            style={{ animationDelay: `${index * 150}ms` }}
        >
            <div className="p-4 sm:p-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full ${s.bg} ${s.text} border ${s.border}`}>
                                {signal.ultimate.gradeEmoji} {signal.ultimate.grade === 'UNCONFIRMED' ? '수급미확인' : signal.ultimate.grade}
                            </span>
                            <h3 className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)]">
                                {signal.name}
                            </h3>
                            <span className="text-xs text-[var(--color-text-muted)] font-mono">({signal.ticker})</span>
                        </div>
                        <div className="mt-1 text-sm text-[var(--color-text-secondary)]">
                            ULTIMATE 점수: <span className="font-bold text-[var(--color-text-primary)] font-mono">{signal.ultimate.scaledScore}</span>
                            <span className="text-[var(--color-text-muted)]"> / 140</span>
                            {signal.ultimate.supplyStatus === 'missing' && (
                                <span className="ml-2 text-xs text-yellow-500" title={signal.supplyResult?.supplyReason}>
                                    ⚠️ 수급 미수신
                                </span>
                            )}
                            {signal.ultimate.supplyStatus === 'neutral' && (
                                <span className="ml-2 text-xs text-orange-400" title={signal.supplyResult?.supplyReason}>
                                    ⚠️ 수급 중립
                                </span>
                            )}
                            {signal.ultimate.supplyStatus === 'negative' && (
                                <span className="ml-2 text-xs text-red-400">🔴 수급 매도세</span>
                            )}
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <div className="text-lg sm:text-xl font-bold font-mono">
                            {signal.price.toLocaleString()}<span className="text-xs text-[var(--color-text-muted)] ml-0.5">원</span>
                        </div>
                        <div className={`text-sm font-semibold font-mono ${signal.change >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                            {signal.change >= 0 ? '▲' : '▼'} {signal.change >= 0 ? '+' : ''}{signal.change}%
                            <span className="text-xs ml-1 text-[var(--color-text-secondary)]">
                                거래량 ↑ {signal.volumeRatio}%
                            </span>
                        </div>
                    </div>
                </div>

                {/* EXCLUDE 사유 표시 */}
                {signal.ultimate.grade === 'EXCLUDE' && signal.ultimate.excludeReasons?.length > 0 && (
                    <div className="mb-4 bg-[#78909c]/10 border border-[#78909c]/20 rounded-lg p-3">
                        <div className="text-xs font-semibold text-[#78909c] mb-1.5">❌ EXCLUDE 사유</div>
                        <ul className="space-y-0.5">
                            {signal.ultimate.excludeReasons.map((reason, i) => (
                                <li key={i} className="text-xs text-[var(--color-text-secondary)]">• {reason}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* 3-Layer Score Bars */}
                <div className="space-y-3 mb-5">
                    <div className="border-t border-[var(--color-border)]/30 pt-3">
                        <div className="text-xs text-[var(--color-text-muted)] mb-2 font-semibold tracking-wider">── 3중 필터 통과 현황 ──</div>
                    </div>

                    {/* 수급 */}
                    <div>
                        <ScoreBar
                            label="💧 수급"
                            score={signal.supplyResult.score}
                            maxScore={200}
                            color="var(--color-supply-bar)"
                            badge={`${signal.supplyPattern.emoji}${signal.supplyPattern.pattern}`}
                            delay={index * 150}
                        />
                        <div className="flex gap-3 mt-1 text-xs text-[var(--color-text-secondary)] ml-7 font-mono flex-wrap">
                            <span>기관 <span className={instDisplay.colorClass}>{instDisplay.text}</span></span>
                            <span>외국인 <span className={foreignDisplay.colorClass}>{foreignDisplay.text}</span></span>
                            <span>개인 <span className={retailDisplay.colorClass}>{retailDisplay.text}</span></span>
                            <span className="text-[10px] opacity-60">{supplySourceLabel}</span>
                        </div>
                    </div>

                    {/* 기법 */}
                    <div>
                        <ScoreBar
                            label="📐 기법"
                            score={signal.traderResult.score}
                            maxScore={100}
                            color="var(--color-trader-bar)"
                            delay={index * 150 + 100}
                        />
                        <div className="flex gap-2 mt-1 ml-7 flex-wrap">
                            {signal.traderResult.passedMethods.map((m, i) => (
                                <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-[#7c4dff]/15 text-[#b39dff] border border-[#7c4dff]/20">
                                    {m.replace('미너비니 SEPA+VCP', '미너비니 VCP').replace('오닐 CAN SLIM', '오닐').replace('리버모어 피벗돌파', '리버모어').replace('와인스타인 스테이지', '와인스타인').replace('다바스 박스이론', '다바스').replace('강환국 모멘텀+밸류', '강환국')} ✅
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* 퀀트 */}
                    <div>
                        <ScoreBar
                            label="📊 퀀트"
                            score={signal.quantResult.score}
                            maxScore={100}
                            color="var(--color-quant-bar)"
                            delay={index * 150 + 200}
                        />
                        <div className="flex gap-2 mt-1 ml-7 flex-wrap">
                            {signal.quantResult.passedFactors.map((f, i) => (
                                <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-[#69f0ae]/10 text-[#69f0ae] border border-[#69f0ae]/20">
                                    {f} ✅
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Trade Plan */}
                <div className="border-t border-[var(--color-border)]/30 pt-4 mb-4">
                    <div className="text-xs text-[var(--color-text-muted)] mb-3 font-semibold tracking-wider">── 매매 플랜 ──</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-up)]">📈</span>
                            <span className="text-[var(--color-text-secondary)]">매수가</span>
                            <span className="font-mono font-semibold">{signal.targets.entry.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-gold)]">🎯</span>
                            <span className="text-[var(--color-text-secondary)]">1차 익절</span>
                            <span className="font-mono font-semibold text-[var(--color-gold)]">
                                {signal.targets.target1.toLocaleString()}
                                <span className="text-xs ml-1 opacity-70">({signal.targets.target1Pct})</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-gold)]">🎯</span>
                            <span className="text-[var(--color-text-secondary)]">2차 익절</span>
                            <span className="font-mono font-semibold text-[var(--color-gold)]">
                                {signal.targets.target2.toLocaleString()}
                                <span className="text-xs ml-1 opacity-70">({signal.targets.target2Pct})</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-gold)]">🎯</span>
                            <span className="text-[var(--color-text-secondary)]">3차 익절</span>
                            <span className="font-mono font-semibold text-[var(--color-gold)]">
                                {signal.targets.target3.toLocaleString()}
                                <span className="text-xs ml-1 opacity-70">({signal.targets.target3Pct})</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-stop)]">🛑</span>
                            <span className="text-[var(--color-text-secondary)]">손절가</span>
                            <span className="font-mono font-semibold text-[var(--color-stop)]">
                                {signal.targets.stop.toLocaleString()}
                                <span className="text-xs ml-1 opacity-70">({signal.targets.stopPct})</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span>⚖️</span>
                            <span className="text-[var(--color-text-secondary)]">손익비</span>
                            <span className="font-mono font-semibold text-[var(--color-text-primary)]">{signal.targets.riskReward} : 1</span>
                        </div>
                    </div>
                    <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                        ⏱️ 예상 보유: 당일 ~ 3일
                    </div>
                </div>

                {/* AI Analysis */}
                <div className="bg-[var(--color-bg-primary)]/60 rounded-xl p-3 sm:p-4 border border-[var(--color-border)]/20">
                    <div className="text-xs text-[var(--color-text-muted)] mb-2 font-semibold">💬 AI 분석</div>
                    <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                        "{signal.analysis}"
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 mt-4 flex-wrap">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
                    >
                        📊 상세분석
                    </button>
                    <button className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer">
                        📈 차트
                    </button>
                    <button className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer">
                        ⭐ 저장
                    </button>
                    <button className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card-hover)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer">
                        🔔 알림
                    </button>
                </div>

                {/* Expanded Details */}
                {expanded && (
                    <div className="mt-4 border-t border-[var(--color-border)]/30 pt-4 animate-slide-up text-xs space-y-3">
                        <div>
                            <h4 className="text-[var(--color-supply-bar)] font-semibold mb-1">수급 상세</h4>
                            <ul className="space-y-0.5 text-[var(--color-text-secondary)]">
                                {signal.supplyResult.details.map((d, i) => <li key={i}>• {d}</li>)}
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-[var(--color-trader-bar)] font-semibold mb-1">기법 상세</h4>
                            <div className="space-y-1 text-[var(--color-text-secondary)]">
                                {signal.traderResult.methods.map((m, i) => (
                                    <div key={i} className="flex items-center justify-between">
                                        <span>{m.name}</span>
                                        <span className="font-mono">{m.score}/{m.maxScore} ({Math.round(m.normalized)}점)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h4 className="text-[var(--color-quant-bar)] font-semibold mb-1">퀀트 팩터 상세</h4>
                            <div className="space-y-1 text-[var(--color-text-secondary)]">
                                {signal.quantResult.factors.map((f, i) => (
                                    <div key={i} className="flex items-center justify-between">
                                        <span>{f.name} {f.passed ? '✅' : '❌'}</span>
                                        <span className="font-mono">{f.score}/{f.max}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
