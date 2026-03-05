import React from 'react';
import useStore from '../store/store';

export default function Header() {
    const market = useStore(s => s.market);
    const autoRefresh = useStore(s => s.autoRefresh);
    const toggleAutoRefresh = useStore(s => s.toggleAutoRefresh);

    return (
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)]/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                        <span className="gradient-text-diamond">💎 ULTIMATE</span>
                        <span className="text-[var(--color-text-primary)] ml-1">SIGNAL</span>
                    </h1>
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-xs font-semibold text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-live"></span>
                        LIVE
                    </span>
                </div>

                {/* Market Indices */}
                <div className="flex items-center gap-4 sm:gap-6">
                    <div className="flex items-center gap-4 font-mono text-sm">
                        <div className="flex items-center gap-2">
                            <span className="text-[var(--color-text-secondary)] text-xs">KOSPI</span>
                            <span className="font-semibold">{market.kospi.toLocaleString()}</span>
                            <span className={market.kospiChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                                {market.kospiChange >= 0 ? '▲' : '▼'} {Math.abs(market.kospiChange).toFixed(2)}%
                            </span>
                        </div>
                        <div className="hidden sm:flex items-center gap-2">
                            <span className="text-[var(--color-text-secondary)] text-xs">KOSDAQ</span>
                            <span className="font-semibold">{market.kosdaq.toLocaleString()}</span>
                            <span className={market.kosdaqChange >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                                {market.kosdaqChange >= 0 ? '▲' : '▼'} {Math.abs(market.kosdaqChange).toFixed(2)}%
                            </span>
                        </div>
                    </div>

                    {/* Auto Refresh Toggle */}
                    <button
                        onClick={toggleAutoRefresh}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-all
              ${autoRefresh
                                ? 'border-[var(--color-up)] text-[var(--color-up)] bg-[var(--color-up)]/10'
                                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-secondary)]'
                            }`}
                    >
                        {autoRefresh ? '⟳ 자동갱신 ON' : '⟳ 자동갱신'}
                    </button>
                </div>
            </div>
        </header>
    );
}
