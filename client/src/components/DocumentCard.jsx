import React, { useState, useEffect, useRef } from 'react';
import { useConnection } from '../contexts/ConnectionContext';

const isObjectId = (value) => {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
};

const isDate = (value) => {
    return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(value) &&
        !isNaN(Date.parse(value));
};

const ValueDisplay = ({ value, onConnect, onDateClick, isIdField, docId, path }) => {
    const { registerNode, unregisterNode } = useConnection();
    const spanRef = useRef(null);

    useEffect(() => {
        if (typeof value === 'string' && isObjectId(value) && spanRef.current) {
            const type = isIdField ? 'def' : 'ref';
            registerNode(value, type, spanRef.current);
            return () => unregisterNode(spanRef.current);
        }
    }, [value, isIdField, registerNode, unregisterNode]);

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
                <span
                    ref={spanRef}
                    onClick={(e) => {
                        if (onConnect) {
                            e.stopPropagation();
                            onConnect(value);
                        }
                    }}
                    style={{
                        color: '#fbbf24',
                        fontFamily: 'monospace',
                        cursor: onConnect ? 'pointer' : 'text',
                        textDecoration: onConnect ? 'underline' : 'none',
                        textDecorationStyle: onConnect ? 'dotted' : 'none'
                    }}
                    title={onConnect ? "Click to connect" : ""}
                >
                    {value}
                </span>
            );
        }
        if (isDate(value)) {
            const stableId = `date-${docId}-${path}`;
            return (
                <span
                    id={stableId}
                    onClick={(e) => {
                        if (onDateClick) {
                            e.stopPropagation();
                            onDateClick(value, e, stableId);
                        }
                    }}
                    style={{
                        color: '#22d3ee',
                        cursor: onDateClick ? 'pointer' : 'text',
                        textDecoration: onDateClick ? 'underline' : 'none',
                        textDecorationStyle: onDateClick ? 'dotted' : 'none'
                    }}
                    title="Click to measure time gap"
                    data-date-value={value}
                >
                    "{value}"
                </span>
            );
        }
        return <span style={{ color: '#a5f3fc', wordBreak: 'break-word' }}>"{value}"</span>;
    }

    return <span style={{ color: '#cbd5e1' }}>{String(value)}</span>;
};

const CollapsibleField = ({ label, children, typeLabel, initialOpen = false }) => {
    const [isOpen, setIsOpen] = useState(initialOpen);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontSize: '0.85rem',
                    color: '#94a3b8',
                    padding: '2px 0',
                    gap: '4px'
                }}
            >
                <span style={{ fontSize: '0.7rem', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.1s' }}>▶</span>
                <span style={{ fontWeight: 600, color: label === '_id' ? 'var(--primary)' : '#cbd5e1' }}>{label}:</span>
                <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>{typeLabel}</span>
            </div>
            {isOpen && (
                <div style={{ paddingLeft: '12px', borderLeft: '1px solid rgba(255,255,255,0.05)', marginLeft: '3px' }}>
                    {children}
                </div>
            )}
        </div>
    );
};

const DocumentCard = ({ data, isRoot = false, onConnect, onDateClick, path = '', docId }) => {
    // Extract ID if at root
    const currentDocId = isRoot ? (data._id || 'unknown') : docId;

    // Array Handling
    if (Array.isArray(data)) {
        if (data.length === 0) return <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>[]</span>;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {data.map((item, index) => (
                    <div key={index} style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                        <span style={{ color: '#64748b', fontSize: '0.8rem', minWidth: '15px' }}>{index}:</span>
                        <div style={{ flex: 1 }}>
                            {typeof item === 'object' && item !== null ? (
                                <CollapsibleField
                                    label={index}
                                    typeLabel={Array.isArray(item) ? `Array[${item.length}]` : `Object{${Object.keys(item).length}}`}
                                >
                                    <DocumentCard
                                        data={item}
                                        onConnect={onConnect}
                                        onDateClick={onDateClick}
                                        path={`${path ? path + '.' : ''}${index}`}
                                        docId={currentDocId}
                                    />
                                </CollapsibleField>
                            ) : (
                                <ValueDisplay
                                    value={item}
                                    onConnect={onConnect}
                                    onDateClick={onDateClick}
                                    path={`${path ? path + '.' : ''}${index}`}
                                    docId={currentDocId}
                                />
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // Object Handling
    if (typeof data === 'object' && data !== null) {
        if (Object.keys(data).length === 0) return <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{"{}"}</span>;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
                {Object.entries(data).map(([key, value]) => {
                    const isComplex = typeof value === 'object' && value !== null;
                    const nextPath = `${path ? path + '.' : ''}${key}`;

                    if (isComplex) {
                        const typeCount = Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
                        return (
                            <CollapsibleField
                                key={key}
                                label={key}
                                typeLabel={typeCount}
                                initialOpen={false}
                            >
                                <DocumentCard
                                    data={value}
                                    onConnect={onConnect}
                                    onDateClick={onDateClick}
                                    path={nextPath}
                                    docId={currentDocId}
                                />
                            </CollapsibleField>
                        );
                    }

                    return (
                        <div key={key} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', padding: '1px 0' }}>
                            <span style={{
                                fontWeight: 600,
                                color: key === '_id' ? 'var(--primary)' : '#94a3b8',
                                fontSize: '0.85rem',
                                whiteSpace: 'nowrap'
                            }}>{key}:</span>
                            <ValueDisplay
                                value={value}
                                onConnect={onConnect}
                                isIdField={key === '_id'}
                                onDateClick={onDateClick}
                                path={nextPath}
                                docId={currentDocId}
                            />
                        </div>
                    );
                })}
            </div>
        );
    }

    return <ValueDisplay
        value={data}
        onConnect={onConnect}
        onDateClick={onDateClick}
        path={path}
        docId={currentDocId}
    />;
};

export default DocumentCard;

