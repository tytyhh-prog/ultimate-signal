import React, { useState, useEffect, useRef } from 'react';

export default function ScoreBar({ label, score, maxScore, color, badge, delay = 0 }) {
    const [visible, setVisible] = useState(false);
    const ref = useRef(null);
    const percentage = Math.round((score / maxScore) * 100);

    useEffect(() => {
        const timer = setTimeout(() => setVisible(true), delay + 300);
        return () => clearTimeout(timer);
    }, [delay]);

    return (
        <div className="flex items-center gap-2" ref={ref}>
            <span className="text-sm w-16 shrink-0">{label}</span>
            <div className="flex-1 h-3 bg-[var(--color-bg-primary)] rounded-full overflow-hidden relative">
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: visible ? `${percentage}%` : '0%',
                        backgroundColor: color,
                        transition: 'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        boxShadow: `0 0 8px ${color}40`,
                    }}
                />
            </div>
            <span className="text-sm font-mono font-semibold w-12 text-right" style={{ color }}>
                {score}<span className="text-[var(--color-text-muted)] text-xs">점</span>
            </span>
            {badge && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]/30 shrink-0 whitespace-nowrap">
                    {badge}
                </span>
            )}
        </div>
    );
}
