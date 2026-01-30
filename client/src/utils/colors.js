export const getColorFromId = (id) => {
    if (!id) return '#fbbf24';

    // Fowler-Noll-Vo (FNV-1a) hash for better distribution than standard additive hashes
    let hash = 2166136261;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }

    // Use Golden Ratio for hue distribution (spreads values more evenly across 360)
    const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;
    const h = (hash * GOLDEN_RATIO_CONJUGATE * 360) % 360;

    // Vary saturation and lightness slightly based on hash to further increase distinctness
    const s = 65 + (hash % 15); // 65-80%
    const l = 55 + (hash % 10); // 55-65%

    return `hsl(${Math.abs(h)}, ${s}%, ${l}%)`;
};
