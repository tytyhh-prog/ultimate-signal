import React, { useState, useRef } from 'react';
import useStore from '../store/store';

export default function ScanButton() {
    const loading = useStore(s => s.loading);
    const step = useStore(s => s.step);
    const progress = useStore(s => s.progress);
    const runScan = useStore(s => s.runScan);
    const scanned = useStore(s => s.scanned);
    const signals = useStore(s => s.signals);
    const [ripple, setRipple] = useState(null);
    const btnRef = useRef(null);

    const handleClick = (e) => {
        if (loading) return;
        // Ripple effect
        const rect = btnRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        setRipple({ x, y, key: Date.now() });
        setTimeout(() => setRipple(null), 600);
        runScan();
    };

    return (
        <div className="text-center py-6 sm:py-10">
            {/* Subtitle */}
            <p className="text-[var(--color-text-secondary)] text-sm sm:text-base mb-4 sm:mb-6">
                수급 + 트레이더기법 + 퀀트 <span className="text-[var(--color-diamond)] font-semibold">3중 필터</span> 적용
            </p>

            {/* Main Button */}
            <div className="relative inline-block">
                <button
                    ref={btnRef}
                    onClick={handleClick}
                    disabled={loading}
                    className={`relative overflow-hidden px-8 sm:px-12 py-4 sm:py-5 rounded-xl font-bold text-lg sm:text-xl
            transition-all duration-300 cursor-pointer
            ${loading
                            ? 'bg-[var(--color-bg-card)] border-2 border-[var(--color-border)] text-[var(--color-text-secondary)]'
                            : 'bg-gradient-to-r from-[#00b0ff]/20 via-[#7c4dff]/20 to-[#69f0ae]/20 border-2 border-[var(--color-supply-bar)] text-white hover:scale-[1.02] active:scale-[0.98] animate-electric'
                        }`}
                >
                    {loading ? (
                        <span className="flex items-center gap-3">
                            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
                                <path d="M12 2a10 10 0 019.747 7.716" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                            </svg>
                            분석 중...
                        </span>
                    ) : (
                        <span>⚡ ULTIMATE 신호 찾기</span>
                    )}

                    {/* Ripple */}
                    {ripple && (
                        <span
                            key={ripple.key}
                            className="absolute rounded-full bg-white/30 pointer-events-none"
                            style={{
                                left: ripple.x - 10,
                                top: ripple.y - 10,
                                width: 20,
                                height: 20,
                                animation: 'ripple-effect 0.6s ease-out forwards',
                            }}
                        />
                    )}
                </button>
            </div>

            {/* Progress */}
            {loading && (
                <div className="mt-6 max-w-md mx-auto">
                    <div className="flex justify-between text-xs text-[var(--color-text-secondary)] mb-2">
                        <span>{step}</span>
                        <span className="font-mono">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--color-bg-card)] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-500 ease-out"
                            style={{
                                width: `${progress}%`,
                                background: 'linear-gradient(90deg, #00b0ff, #7c4dff, #69f0ae)',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Result count */}
            {scanned && !loading && (
                <div className="mt-6 animate-slide-up">
                    <p className="text-[var(--color-text-secondary)] text-sm">
                        오늘의 시장 상태: <span className="text-[var(--color-up)]">🟢 매수 우호적</span>
                    </p>
                    <p className="text-[var(--color-text-secondary)] text-sm mt-1">
                        분석 완료: <span className="text-[var(--color-text-primary)] font-semibold">2,847개</span> 종목 중{' '}
                        <span className="text-[var(--color-diamond)] font-bold">{signals.length}개</span> 통과
                    </p>
                </div>
            )}
        </div>
    );
}
