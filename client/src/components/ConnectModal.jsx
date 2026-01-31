import React, { useState, useEffect, useRef } from 'react';
import { listDatabases, listCollections, fetchDocuments, fetchSchema } from '../api';
import QueryBuilder from './QueryBuilder';

// Predict collection name from field path (e.g., "userId" → "users", "author.postId" → "posts")
const predictCollectionName = (fieldPath) => {
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
const findBestMatch = (predicted, collections) => {
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

const ConnectModal = ({ isOpen, onClose, sourceId, fieldPath, initialUri, onConnect }) => {
    const [databases, setDatabases] = useState([]);
    const [selectedDb, setSelectedDb] = useState('');
    const [collections, setCollections] = useState([]);
    const [selectedCol, setSelectedCol] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [schema, setSchema] = useState({});
    const [queryObject, setQueryObject] = useState({});

    // Track if we've already auto-selected for this modal open
    const hasAutoSelectedDb = useRef(false);
    const hasAutoSelectedCol = useRef(false);

    // UI hints for auto-selection
    const [autoSelectHint, setAutoSelectHint] = useState(null); // e.g., "Restored from recent"
    const [predictedHint, setPredictedHint] = useState(null);   // e.g., "Predicted from 'userId'"
    const [loadingDbs, setLoadingDbs] = useState(false);
    const [loadingCols, setLoadingCols] = useState(false);

    // Fetch databases from server
    const fetchDatabases = async (autoSelect = false) => {
        setLoadingDbs(true);
        try {
            const data = await listDatabases(initialUri);
            setDatabases(data.databases);
            // Cache databases
            try {
                localStorage.setItem('mongoDV_cachedDatabases', JSON.stringify(data.databases));
            } catch (e) { /* localStorage unavailable */ }

            // Auto-select cached db if requested
            if (autoSelect && !hasAutoSelectedDb.current) {
                const cachedDb = localStorage.getItem('mongoDV_lastUsedDb');
                if (cachedDb && data.databases.some(db => db.name === cachedDb)) {
                    hasAutoSelectedDb.current = true;
                    setSelectedDb(cachedDb);
                    setAutoSelectHint(`Restored: ${cachedDb}`);
                    loadCollections(cachedDb, true);
                }
            }
        } catch (err) {
            setError("Failed to load databases");
        } finally {
            setLoadingDbs(false);
        }
    };

    // Load from cache instantly, then optionally fetch fresh
    useEffect(() => {
        if (isOpen && initialUri) {
            // Reset state on open
            hasAutoSelectedDb.current = false;
            hasAutoSelectedCol.current = false;
            setAutoSelectHint(null);
            setPredictedHint(null);
            setError(null);

            // First, check if we have a stored connection for this exact field path
            if (fieldPath) {
                try {
                    const connectionHistory = JSON.parse(localStorage.getItem('mongoDV_connectionHistory') || '{}');
                    const savedConnection = connectionHistory[fieldPath];

                    if (savedConnection) {
                        // We have a saved connection for this field - use it!
                        hasAutoSelectedDb.current = true;
                        hasAutoSelectedCol.current = true;
                        setSelectedDb(savedConnection.db);
                        setSelectedCol(savedConnection.collection);
                        setAutoSelectHint(`Remembered: ${savedConnection.db}`);
                        setPredictedHint(`Remembered: ${savedConnection.collection}`);

                        // Load cached databases and collections
                        const cachedDbs = localStorage.getItem('mongoDV_cachedDatabases');
                        if (cachedDbs) setDatabases(JSON.parse(cachedDbs));

                        const cachedCols = localStorage.getItem(`mongoDV_cachedCollections_${savedConnection.db}`);
                        if (cachedCols) setCollections(JSON.parse(cachedCols));
                        else loadCollections(savedConnection.db, false);

                        return; // Skip prediction logic
                    }
                } catch (e) { /* localStorage unavailable */ }
            }

            // Try to load cached databases instantly
            try {
                const cachedDbs = localStorage.getItem('mongoDV_cachedDatabases');
                const cachedDb = localStorage.getItem('mongoDV_lastUsedDb');

                if (cachedDbs) {
                    const dbs = JSON.parse(cachedDbs);
                    setDatabases(dbs);

                    // Instantly select cached db if it exists in cached list
                    if (cachedDb && dbs.some(db => db.name === cachedDb)) {
                        hasAutoSelectedDb.current = true;
                        setSelectedDb(cachedDb);
                        setAutoSelectHint(`Restored: ${cachedDb}`);

                        // Load cached collections too
                        const cachedCols = localStorage.getItem(`mongoDV_cachedCollections_${cachedDb}`);
                        if (cachedCols) {
                            const cols = JSON.parse(cachedCols);
                            setCollections(cols);

                            // Try to predict collection
                            if (fieldPath) {
                                const predicted = predictCollectionName(fieldPath);
                                if (predicted) {
                                    const match = findBestMatch(predicted, cols);
                                    if (match) {
                                        hasAutoSelectedCol.current = true;
                                        setSelectedCol(match);
                                        setPredictedHint(`Predicted: ${fieldPath.split('.').pop()}`);
                                    } else {
                                        setPredictedHint(`No match for: ${predicted}`);
                                    }
                                } else {
                                    setPredictedHint(`Could not predict from: ${fieldPath.split('.').pop()}`);
                                }
                            }
                        } else {
                            // No cached collections, fetch them
                            loadCollections(cachedDb, true);
                        }
                    }
                } else {
                    // No cache, fetch from server
                    fetchDatabases(true);
                }
            } catch (e) {
                // Cache read failed, fetch from server
                fetchDatabases(true);
            }
        }
    }, [isOpen, initialUri, sourceId]);

    const loadCollections = async (dbName, autoPredict = true) => {
        setLoadingCols(true);
        try {
            const data = await listCollections(initialUri, dbName);
            const sortedCollections = data.collections.sort((a, b) => a.name.localeCompare(b.name));
            setCollections(sortedCollections);

            // Cache collections
            try {
                localStorage.setItem(`mongoDV_cachedCollections_${dbName}`, JSON.stringify(sortedCollections));
            } catch (e) { /* localStorage unavailable */ }

            // Try to predict and auto-select collection
            if (autoPredict && !hasAutoSelectedCol.current && fieldPath) {
                const predicted = predictCollectionName(fieldPath);
                if (predicted) {
                    const match = findBestMatch(predicted, sortedCollections);
                    if (match) {
                        hasAutoSelectedCol.current = true;
                        setSelectedCol(match);
                        setPredictedHint(`Predicted: ${fieldPath.split('.').pop()}`);
                        // Also fetch schema for the predicted collection
                        try {
                            const schemaData = await fetchSchema(initialUri, dbName, match);
                            setSchema(schemaData.schema || {});
                        } catch (e) {
                            console.error("Failed to fetch schema", e);
                        }
                    } else {
                        setPredictedHint(`No match for: ${predicted}`);
                    }
                } else {
                    setPredictedHint(`Could not predict from: ${fieldPath.split('.').pop()}`);
                }
            }
        } catch (err) {
            console.error("Failed to fetch collections", err);
        } finally {
            setLoadingCols(false);
        }
    };

    const handleDbChange = async (e) => {
        const dbName = e.target.value;
        setSelectedDb(dbName);
        setSelectedCol('');
        setSchema({});
        setCollections([]);
        setAutoSelectHint(null); // Clear hint when manually changing
        setPredictedHint(null);

        if (dbName) {
            // Cache the selected database
            try {
                localStorage.setItem('mongoDV_lastUsedDb', dbName);
            } catch (e) { /* localStorage unavailable */ }

            await loadCollections(dbName);
        }
    };

    const handleColChange = async (e) => {
        const colName = e.target.value;
        setSelectedCol(colName);
        setPredictedHint(null); // Clear hint when manually changing
        if (colName && selectedDb) {
            try {
                const schemaData = await fetchSchema(initialUri, selectedDb, colName);
                setSchema(schemaData.schema || {});
            } catch (err) {
                console.error("Failed to fetch schema", err);
                setSchema({});
            }
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const data = await fetchDocuments(initialUri, selectedDb, selectedCol, 20, queryObject);

            // Store this connection in history for this field path
            if (fieldPath) {
                try {
                    const connectionHistory = JSON.parse(localStorage.getItem('mongoDV_connectionHistory') || '{}');
                    connectionHistory[fieldPath] = {
                        db: selectedDb,
                        collection: selectedCol,
                        timestamp: Date.now()
                    };
                    localStorage.setItem('mongoDV_connectionHistory', JSON.stringify(connectionHistory));
                } catch (e) { /* localStorage unavailable */ }
            }

            onConnect(data.documents, selectedCol);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const initialFilters = sourceId ? [{
        field: '_id',
        operator: '=',
        value: sourceId,
        type: 'ObjectId'
    }] : [];

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(4px)',
            zIndex: 2000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        }} onClick={onClose}>
            <div style={{
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '2rem',
                width: '100%',
                maxWidth: '600px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
            }} onClick={e => e.stopPropagation()}>
                <h2 style={{ color: '#e2e8f0', marginBottom: '1.5rem', fontSize: '1.5rem' }}>Connect to Document</h2>

                {error && (
                    <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Database Selection */}
                    <div>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Target Database</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                                value={selectedDb}
                                onChange={handleDbChange}
                                required
                                style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                            >
                                <option value="">Select Database</option>
                                {databases.map(db => (
                                    <option key={db.name} value={db.name}>{db.name}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => fetchDatabases(false)}
                                disabled={loadingDbs}
                                title="Refresh databases from server"
                                style={{
                                    padding: '0.6rem 0.8rem',
                                    borderRadius: '6px',
                                    border: '1px solid #475569',
                                    background: '#0f172a',
                                    color: '#94a3b8',
                                    cursor: loadingDbs ? 'wait' : 'pointer',
                                    opacity: loadingDbs ? 0.6 : 1,
                                    transition: 'all 0.2s'
                                }}
                            >
                                {loadingDbs ? '...' : '🔄'}
                            </button>
                        </div>
                        {autoSelectHint && (() => {
                            const isRemembered = autoSelectHint.startsWith('Remembered:');
                            return (
                                <div style={{
                                    marginTop: '0.4rem',
                                    fontSize: '0.75rem',
                                    color: isRemembered ? '#4ade80' : '#a78bfa',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span>{isRemembered ? '✅' : '✨'}</span> {autoSelectHint}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Collection Selection */}
                    <div>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Target Collection</label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                                value={selectedCol}
                                onChange={handleColChange}
                                required
                                disabled={!selectedDb}
                                style={{ flex: 1, padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white', opacity: !selectedDb ? 0.5 : 1 }}
                            >
                                <option value="">Select Collection</option>
                                {collections.map(col => (
                                    <option key={col.name} value={col.name}>{col.name}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => { hasAutoSelectedCol.current = true; loadCollections(selectedDb, false); }}
                                disabled={loadingCols || !selectedDb}
                                title="Refresh collections from server"
                                style={{
                                    padding: '0.6rem 0.8rem',
                                    borderRadius: '6px',
                                    border: '1px solid #475569',
                                    background: '#0f172a',
                                    color: '#94a3b8',
                                    cursor: (loadingCols || !selectedDb) ? 'not-allowed' : 'pointer',
                                    opacity: (loadingCols || !selectedDb) ? 0.5 : 1,
                                    transition: 'all 0.2s'
                                }}
                            >
                                {loadingCols ? '...' : '🔄'}
                            </button>
                        </div>
                        {predictedHint && (() => {
                            const isSuccess = predictedHint.startsWith('Predicted:') || predictedHint.startsWith('Remembered:');
                            const isRemembered = predictedHint.startsWith('Remembered:');
                            return (
                                <div style={{
                                    marginTop: '0.4rem',
                                    fontSize: '0.75rem',
                                    color: isSuccess ? '#4ade80' : '#fbbf24',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                }}>
                                    <span>{isRemembered ? '✅' : (isSuccess ? '🎯' : '⚠️')}</span> {predictedHint}
                                </div>
                            );
                        })()}
                    </div>

                    {/* Query Builder */}
                    <div style={{ marginTop: '0.5rem' }}>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Filter Documents</label>
                        <QueryBuilder
                            schema={schema}
                            onQueryChange={setQueryObject}
                            showRunButton={false}
                            initialFilters={initialFilters}
                            style={{ background: 'rgba(15, 23, 42, 0.5)', marginBottom: '0', padding: '1rem' }}
                        />
                    </div>


                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', cursor: 'pointer' }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !selectedDb || !selectedCol}
                            style={{
                                padding: '0.6rem 1.2rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: 'linear-gradient(to right, #3b82f6, #8b5cf6)',
                                color: 'white',
                                cursor: (loading || !selectedDb || !selectedCol) ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                opacity: (loading || !selectedDb || !selectedCol) ? 0.7 : 1
                            }}
                        >
                            {loading ? 'Connecting...' : 'Connect'}
                        </button>
                    </div>

                </form>
            </div>
        </div>
    );
};

export default ConnectModal;
