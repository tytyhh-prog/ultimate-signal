import React, { useEffect, useState } from 'react';
import useStore from '../store/store';
import { isKoreanMarketOpen } from '../store/store';

export default function Header() {
    const market = useStore(s => s.market);
    const autoRefresh = useStore(s => s.autoRefresh);
    const toggleAutoRefresh = useStore(s => s.toggleAutoRefresh);
    const lastUpdated = useStore(s => s.lastUpdated);
    const marketOpen = useStore(s => s.marketOpen);
    const error = useStore(s => s.error);

    // 마지막 갱신으로부터 경과 시간
    const [elapsed, setElapsed] = useState('');

    useEffect(() => {
        const tick = () => {
            if (lastUpdated) {
                const diff = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
                if (diff < 60) {
                    setElapsed(`${diff}초 전`);
                } else {
                    setElapsed(`${Math.floor(diff / 60)}분 전`);
                }
            }
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [lastUpdated]);

    const isOpen = marketOpen || isKoreanMarketOpen();

    return (
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)]/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                        <span className="gradient-text-diamond">💎 ULTIMATE</span>
                        <span className="text-[var(--color-text-primary)] ml-1">SIGNAL</span>
                    </h1>
                    {/* 장 상태에 따른 뱃지 */}
                    {isOpen ? (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-green-500/20 border border-green-500/30 text-xs font-semibold text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-live"></span>
                            LIVE 장중
                        </span>
                    ) : (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-500/20 border border-gray-500/30 text-xs font-semibold text-gray-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                            장외
                        </span>
                    )}
                </div>

                {/* Market Indices + Controls */}
                <div className="flex items-center gap-4 sm:gap-6">
                    <div className="flex items-center gap-4 font-mono text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-text-secondary)] text-xs">KOSPI</span>
                            {market.kospi > 0 ? (
                                <>
                                    <span className="font-semibold">{market.kospi.toLocaleString()}</span>
                                    <span className={market.kospiChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                                        {market.kospiChange >= 0 ? '▲' : '▼'} {Math.abs(market.kospiChange).toFixed(2)}%
                                    </span>
                                </>
                            ) : (
                                <span className="text-[var(--color-text-muted)] font-mono">--</span>
                            )}
                        </div>
                        <div className="hidden sm:flex items-center gap-2">
                            <span className="text-[var(--color-text-secondary)] text-xs">KOSDAQ</span>
                            {market.kosdaq > 0 ? (
                                <>
                                    <span className="font-semibold">{market.kosdaq.toLocaleString()}</span>
                                    <span className={market.kosdaqChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                                        {market.kosdaqChange >= 0 ? '▲' : '▼'} {Math.abs(market.kosdaqChange).toFixed(2)}%
                                    </span>
                                </>
                            ) : (
                                <span className="text-[var(--color-text-muted)] font-mono">--</span>
                            )}
                        </div>
                    </div>

                    {/* Auto Refresh Toggle */}
                    <div className="flex flex-col items-end gap-0.5">
                        <button
                            onClick={toggleAutoRefresh}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all cursor-pointer
                                ${autoRefresh
                                    ? 'border-[var(--color-up)] text-[var(--color-up)] bg-[var(--color-up)]/10'
                                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
                                }`}
                        >
                            {autoRefresh
                                ? `⟳ 자동갱신 ON (${isOpen ? '10초' : '5분'})`
                                : '⟳ 자동갱신'}
                        </button>
                        {lastUpdated && (
                            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                                갱신: {elapsed}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 에러 배너 */}
            {error && (
                <div className="bg-red-500/10 border-t border-red-500/30 px-4 py-2 text-center">
                    <span className="text-xs text-red-400 font-medium">
                        ⚠️ {error} — 30초 후 자동 재시도합니다
                    </span>
                </div>
            )}
        </header>
    );
}
