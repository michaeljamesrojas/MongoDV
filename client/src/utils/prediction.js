// Predict collection name from field path (e.g., "userId" → "users", "author.postId" → "posts")
export const predictCollectionName = (fieldPath) => {
    if (!fieldPath) return null;

    // Get the last part of the path (e.g., "author.userId" → "userId")
    const fieldName = fieldPath.split('.').pop().toLowerCase();

    // Remove common suffixes like "id", "_id", "Id"
    let baseName = fieldName
        .replace(/(_id|id)$/i, '')
        .replace(/_$/, ''); // Remove trailing underscore if any

    if (!baseName) return null;

    // Simple pluralization: add 's' if not already ending in 's'
    const pluralized = baseName.endsWith('s') ? baseName : baseName + 's';

    return pluralized;
};

// Find best matching collection from list
export const findBestMatch = (predicted, collections) => {
    if (!predicted || !collections || collections.length === 0) return null;

    const lowerPredicted = predicted.toLowerCase();

    // Exact match first
    const exact = collections.find(c => c.name.toLowerCase() === lowerPredicted);
    if (exact) return exact.name;

    // Starts with predicted
    const startsWith = collections.find(c => c.name.toLowerCase().startsWith(lowerPredicted));
    if (startsWith) return startsWith.name;

    // Contains predicted
    const contains = collections.find(c => c.name.toLowerCase().includes(lowerPredicted));
    if (contains) return contains.name;

    return null;
};
