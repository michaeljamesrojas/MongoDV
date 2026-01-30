import React, { useState, useEffect } from 'react';
import { listDatabases, listCollections, fetchDocuments, fetchSchema } from '../api';

const ConnectModal = ({ isOpen, onClose, sourceId, initialUri, onConnect }) => {
    const [databases, setDatabases] = useState([]);
    const [selectedDb, setSelectedDb] = useState('');
    const [collections, setCollections] = useState([]);
    const [selectedCol, setSelectedCol] = useState('');
    const [field, setField] = useState('_id'); // Default field to query
    const [value, setValue] = useState(sourceId || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [schemaKeys, setSchemaKeys] = useState([]);

    useEffect(() => {
        if (isOpen && initialUri) {
            // Load databases when modal opens
            listDatabases(initialUri)
                .then(data => setDatabases(data.databases))
                .catch(err => setError("Failed to load databases"));
            setValue(sourceId);
        }
    }, [isOpen, initialUri, sourceId]);

    const handleDbChange = async (e) => {
        const dbName = e.target.value;
        setSelectedDb(dbName);
        setSelectedCol('');
        setSchemaKeys([]);
        if (dbName) {
            try {
                const data = await listCollections(initialUri, dbName);
                const sortedCollections = data.collections.sort((a, b) => a.name.localeCompare(b.name));
                setCollections(sortedCollections);
            } catch (err) {
                console.error("Failed to fetch collections", err);
            }
        }
    };

    const handleColChange = async (e) => {
        const colName = e.target.value;
        setSelectedCol(colName);
        if (colName && selectedDb) {
            try {
                const schemaData = await fetchSchema(initialUri, selectedDb, colName);
                setSchemaKeys(schemaData.keys || []);
                // Smart default: if we have a field like "userId" and our source is an ID, maybe pick that?
                // For now, default to _id or first key
            } catch (err) {
                console.error("Failed to fetch schema", err);
            }
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Construct query
            const query = {};
            // Attempt to infer type. If looks like ObjectId, keep string? No, standard query parser in App.jsx handles basic types?
            // Wait, we need to call the API directly or pass back to App?
            // The plan said "onConnect runs query".
            // Let's call the API here to get the docs, then pass them up.

            // Smart value parsing (similar to App.jsx)
            let queryVal = value;
            if (!isNaN(queryVal) && queryVal.trim() !== '') {
                queryVal = Number(queryVal);
            }

            query[field] = queryVal;

            const data = await fetchDocuments(initialUri, selectedDb, selectedCol, 20, query); // Default limit 20
            onConnect(data.documents, selectedCol);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

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
                maxWidth: '500px',
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
                        <select
                            value={selectedDb}
                            onChange={handleDbChange}
                            required
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                        >
                            <option value="">Select Database</option>
                            {databases.map(db => (
                                <option key={db.name} value={db.name}>{db.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Collection Selection */}
                    <div>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Target Collection</label>
                        <select
                            value={selectedCol}
                            onChange={handleColChange}
                            required
                            disabled={!selectedDb}
                            style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white', opacity: !selectedDb ? 0.5 : 1 }}
                        >
                            <option value="">Select Collection</option>
                            {collections.map(col => (
                                <option key={col.name} value={col.name}>{col.name}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {/* Field Selection */}
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Field</label>
                            <input
                                list="schemaFields"
                                type="text"
                                value={field}
                                onChange={(e) => setField(e.target.value)}
                                required
                                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                            />
                            <datalist id="schemaFields">
                                {schemaKeys.map(key => <option key={key} value={key} />)}
                            </datalist>
                        </div>

                        {/* Value Input */}
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.9rem', marginBottom: '0.4rem' }}>Value</label>
                            <input
                                type="text"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                required
                                style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}
                            />
                        </div>
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
                            disabled={loading}
                            style={{
                                padding: '0.6rem 1.2rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: 'linear-gradient(to right, #3b82f6, #8b5cf6)',
                                color: 'white',
                                cursor: loading ? 'wait' : 'pointer',
                                fontWeight: 600,
                                opacity: loading ? 0.7 : 1
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
