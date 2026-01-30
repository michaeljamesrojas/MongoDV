import React from 'react';

const isObjectId = (value) => {
    // Simple check for 24-character hex string which is the standard representation of ObjectId in JSON
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
};

const isDate = (value) => {
    return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(value) &&
        !isNaN(Date.parse(value));
};

const ValueDisplay = ({ value }) => {
    if (value === null) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>null</span>;
    if (value === undefined) return <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>undefined</span>;

    if (typeof value === 'boolean') {
        return <span style={{ color: value ? '#4ade80' : '#f87171', fontWeight: 600 }}>{String(value)}</span>;
    }

    if (typeof value === 'number') {
        return <span style={{ color: '#60a5fa' }}>{value}</span>;
    }

    if (typeof value === 'string') {
        if (isObjectId(value)) {
            return (
                <span style={{
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#fbbf24',
                    padding: '0 4px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    border: '1px solid rgba(245, 158, 11, 0.3)'
                }}>
                    {value}
                </span>
            );
        }
        if (isDate(value)) {
            return <span style={{ color: '#22d3ee' }}>"{value}"</span>;
        }
        return <span style={{ color: '#a5f3fc', wordBreak: 'break-word' }}>"{value}"</span>;
    }

    return <span style={{ color: '#cbd5e1' }}>{String(value)}</span>;
};

const DocumentCard = ({ data, isRoot = false }) => {
    if (Array.isArray(data)) {
        if (data.length === 0) return <span style={{ color: '#94a3b8' }}>[]</span>;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: isRoot ? 0 : '1rem', borderLeft: isRoot ? 'none' : '1px solid var(--glass-border)' }}>
                {data.map((item, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem' }}>
                        <span style={{ color: '#64748b', fontSize: '0.8rem', minWidth: '20px' }}>{index}:</span>
                        <div>
                            {typeof item === 'object' && item !== null ? <DocumentCard data={item} /> : <ValueDisplay value={item} />}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (typeof data === 'object' && data !== null) {
        if (Object.keys(data).length === 0) return <span style={{ color: '#94a3b8' }}>{"{}"}</span>;

        return (
            <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                alignItems: 'flex-start'
            }}>
                {Object.entries(data).map(([key, value]) => {
                    const isComplex = typeof value === 'object' && value !== null;
                    return (
                        <div key={key} style={{
                            background: isComplex ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: '6px',
                            padding: '0.5rem',
                            display: isComplex ? 'block' : 'flex',
                            alignItems: isComplex ? 'stretch' : 'center',
                            gap: '0.5rem',
                            width: isComplex ? '100%' : 'auto',
                            maxWidth: isComplex ? '100%' : 'fit-content'
                        }}>
                            <span style={{
                                fontWeight: 600,
                                color: key === '_id' ? 'var(--primary)' : '#94a3b8',
                                fontSize: '0.85rem',
                                marginRight: isComplex ? 0 : '0.25rem',
                                marginBottom: isComplex ? '0.5rem' : 0,
                                display: isComplex ? 'block' : 'inline'
                            }}>{key}:</span>

                            {isComplex ? (
                                <div style={{ marginTop: '0.25rem' }}>
                                    <DocumentCard data={value} />
                                </div>
                            ) : (
                                <ValueDisplay value={value} />
                            )}
                        </div>
                    );
                })}
            </div>
        );
    }

    return <ValueDisplay value={data} />;
};

export default DocumentCard;
