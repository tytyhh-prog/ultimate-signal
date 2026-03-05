import React from 'react';
import useStore from '../store/store';

export default function SectorHeatmap() {
    const sectors = useStore(s => s.sectors);
    const scanned = useStore(s => s.scanned);

    if (!scanned) return null;

    const maxNetBuy = Math.max(...sectors.map(s => Math.abs(s.netBuy)));

    return (
        <div className="animate-slide-up bg-[var(--color-bg-card)] border border-[var(--color-border)]/30 rounded-2xl p-4 sm:p-6" style={{ animationDelay: '800ms' }}>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">📊 업종별 수급 히트맵</h3>
            <div className="space-y-2.5">
                {sectors.map((sector, i) => {
                    const width = Math.abs(sector.netBuy) / maxNetBuy * 100;
                    const isPositive = sector.netBuy >= 0;
                    const trendIcon = sector.trend === 'up' ? '🔥' : sector.trend === 'down' ? '↓' : '→';

                    return (
                        <div key={i} className="flex items-center gap-3">
                            <span className="text-sm text-[var(--color-text-secondary)] w-24 shrink-0 truncate">{sector.name}</span>
                            <div className="flex-1 h-5 bg-[var(--color-bg-primary)] rounded-full overflow-hidden relative">
                                <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{
                                        width: `${width}%`,
                                        background: isPositive
                                            ? `linear-gradient(90deg, rgba(0, 176, 255, 0.3), rgba(0, 176, 255, 0.7))`
                                            : `linear-gradient(90deg, rgba(255, 23, 68, 0.3), rgba(255, 23, 68, 0.7))`,
                                    }}
                                />
                            </div>
                            <span className={`text-xs font-mono font-semibold w-16 text-right ${isPositive ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}`}>
                                {isPositive ? '+' : ''}{sector.netBuy}억
                            </span>
                            <span className="text-sm w-5">{trendIcon}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
