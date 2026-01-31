import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useConnection } from '../contexts/ConnectionContext';
import { getColorFromId } from '../utils/colors';
import { useDragAwareClick } from '../hooks/useDragAwareClick';
import { predictCollectionName, findBestMatch } from '../utils/prediction';

const isObjectId = (value) => {
    return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
};

const isDate = (value) => {
    return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(value) &&
        !isNaN(Date.parse(value));
};


const ValueDisplay = ({ value, onConnect, onQuickConnect, connectionHistoryVersion, onDateClick, onFlagClick, isIdField, docId, path, collection }) => {
    const { registerNode, unregisterNode, markedSources, idColorOverrides = {}, onIdColorChange } = useConnection();
    const spanRef = useRef(null);

    // Check if this field is marked as a source (keyed by collection:path)
    const isMarkedSource = markedSources && collection && markedSources.has(`${collection}:${path}`);

    useEffect(() => {
        if (spanRef.current) {
            // Register if it's an ObjectId OR if it's marked as a source
            if (typeof value === 'string' && (isObjectId(value) || isMarkedSource)) {
                // Marked sources act as 'def' so arrows can point TO them
                const type = (isIdField || isMarkedSource) ? 'def' : 'ref';
                registerNode(value, type, spanRef.current);
                return () => unregisterNode(spanRef.current);
            }
        }
    }, [value, isIdField, isMarkedSource, registerNode, unregisterNode]);

    // Drag-aware handlers
    const idColorHandlers = useDragAwareClick((e) => { e.stopPropagation(); onIdColorChange(value); });
    const connectHandlers = useDragAwareClick((e) => {
        if (onConnect) {
            e.stopPropagation();
            onConnect(value, path);
        }
    });
    const flagHandlers = useDragAwareClick((e) => { e.stopPropagation(); onFlagClick && onFlagClick(value); });
    const dateHandlers = useDragAwareClick((e) => {
        if (onDateClick) {
            e.stopPropagation();
            const stableId = `date-${docId}-${path}`;
            onDateClick(value, e, stableId);
        }
    });

    // Quick connect logic - check for remembered or predicted connections
    const quickConnectInfo = useMemo(() => {
        if (!path || isIdField || !onQuickConnect) return null;

        try {
            // Check connection history first
            const historyRaw = localStorage.getItem('mongoDV_connectionHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                if (history[path]) {
                    return {
                        type: 'remembered',
                        db: history[path].db,
                        collection: history[path].collection
                    };
                }
            }

            // Try prediction
            const predicted = predictCollectionName(path);
            if (predicted) {
                // Get cached databases and try to find a match
                const cachedDb = localStorage.getItem('mongoDV_lastUsedDb');
                if (cachedDb) {
                    const cachedCollectionsRaw = localStorage.getItem(`mongoDV_cachedCollections_${cachedDb}`);
                    if (cachedCollectionsRaw) {
                        const cachedCollections = JSON.parse(cachedCollectionsRaw);
                        const match = findBestMatch(predicted, cachedCollections);
                        if (match) {
                            return {
                                type: 'predicted',
                                db: cachedDb,
                                collection: match
                            };
                        }
                    }
                }
            }
        } catch (e) {
            // localStorage unavailable
        }
        return null;
    }, [path, isIdField, onQuickConnect, connectionHistoryVersion]);

    const quickConnectHandlers = useDragAwareClick((e) => {
        if (quickConnectInfo && onQuickConnect) {
            e.stopPropagation();
            // Pass docId (source document), value (ID to query), path, db, collection
            onQuickConnect(docId, value, path, quickConnectInfo.db, quickConnectInfo.collection);
        }
    });


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
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {onIdColorChange && (
                        <button
                            onMouseDown={idColorHandlers.onMouseDown}
                            onClick={idColorHandlers.onClick}
                            title="Randomize Color"
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: getColorFromId(value, idColorOverrides[value] || 0),
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                fontSize: '0.8rem',
                                opacity: 0.8,
                                transition: 'transform 0.1s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                            👁
                        </button>
                    )}
                    <span
                        ref={spanRef}
                        onMouseDown={connectHandlers.onMouseDown}
                        onClick={connectHandlers.onClick}
                        style={{
                            color: getColorFromId(value, idColorOverrides[value] || 0),
                            fontFamily: 'monospace',
                            cursor: onConnect ? 'pointer' : 'text',
                            textDecoration: onConnect ? 'underline' : 'none',
                            textDecorationStyle: onConnect ? 'dotted' : 'none'
                        }}
                        title={onConnect ? "Click to connect" : ""}
                    >
                        {value}
                    </span>
                    {(isIdField || isMarkedSource) ? null : (
                        <>
                            {quickConnectInfo && (
                                <button
                                    onMouseDown={quickConnectHandlers.onMouseDown}
                                    onClick={quickConnectHandlers.onClick}
                                    title={quickConnectInfo.type === 'remembered'
                                        ? `Quick connect to ${quickConnectInfo.collection} (remembered)`
                                        : `Quick connect to ${quickConnectInfo.collection} (predicted)`}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '2px',
                                        fontSize: '0.8rem',
                                        opacity: 0.8,
                                        transition: 'transform 0.1s, opacity 0.1s',
                                        marginLeft: '2px',
                                        color: quickConnectInfo.type === 'remembered' ? '#4ade80' : '#fbbf24'
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.2)'; e.currentTarget.style.opacity = '1'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.opacity = '0.8'; }}
                                >
                                    {quickConnectInfo.type === 'remembered' ? '🚀' : '⚡'}
                                </button>
                            )}
                            <button
                                onMouseDown={flagHandlers.onMouseDown}
                                onClick={flagHandlers.onClick}
                                title="Go to definition"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '2px',
                                    fontSize: '0.8rem',
                                    opacity: 0.7,
                                    transition: 'transform 0.1s',
                                    marginLeft: '2px'
                                }}
                                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.2)'}
                                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                            >
                                🚩
                            </button>
                        </>
                    )}
                </span>
            );
        }
        if (isDate(value)) {
            const stableId = `date-${docId}-${path}`;
            return (
                <span
                    id={stableId}
                    onMouseDown={dateHandlers.onMouseDown}
                    onClick={dateHandlers.onClick}
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
        // For marked sources that aren't ObjectIds or Dates, attach the ref
        if (isMarkedSource) {
            const markedColorHandlers = useDragAwareClick((e) => { e.stopPropagation(); onIdColorChange(value); });

            return (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    {onIdColorChange && (
                        <button
                            onMouseDown={markedColorHandlers.onMouseDown}
                            onClick={markedColorHandlers.onClick}
                            title="Randomize Color"
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: getColorFromId(value, idColorOverrides[value] || 0),
                                cursor: 'pointer',
                                padding: '2px',
                                display: 'flex',
                                alignItems: 'center',
                                fontSize: '0.8rem',
                                opacity: 0.8
                            }}
                        >
                            👁
                        </button>
                    )}
                    <span
                        ref={spanRef}
                        style={{
                            color: getColorFromId(value, idColorOverrides[value] || 0),
                            wordBreak: 'break-word',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                            textDecorationColor: getColorFromId(value, idColorOverrides[value] || 0)
                        }}
                    >
                        "{value}"
                    </span>
                </span>
            );
        }
        return <span style={{ color: '#a5f3fc', wordBreak: 'break-word' }}>"{value}"</span>;
    }

    return <span style={{ color: '#cbd5e1' }}>{String(value)}</span>;
};

const CollapsibleField = ({ label, children, typeLabel, initialOpen = false, isOpen: controlledIsOpen, onToggle }) => {
    const [localIsOpen, setLocalIsOpen] = useState(initialOpen);

    const isControlled = controlledIsOpen !== undefined;
    const isOpen = isControlled ? controlledIsOpen : localIsOpen;


    const { onMouseDown, onClick } = useDragAwareClick((e) => {
        e.stopPropagation();
        if (isControlled && onToggle) {
            onToggle();
        } else {
            setLocalIsOpen(!localIsOpen);
        }
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div
                onMouseDown={onMouseDown}
                onClick={onClick}
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

const DocumentCard = ({ data, isRoot = false, onConnect, onQuickConnect, connectionHistoryVersion, onDateClick, onFlagClick, path = '', docId, collection, expandedPaths, onToggleExpand }) => {
    // Extract ID if at root. Prefer passed docId (Wrapper ID) over data._id if available.
    const currentDocId = docId || (isRoot && data ? data._id : 'unknown');

    // Helper to determine if a path is expanded
    const isExpanded = (checkPath) => {
        if (!expandedPaths) return undefined; // Return undefined to trigger local state fallback
        return expandedPaths.includes(checkPath);
    };

    // Array Handling
    if (Array.isArray(data)) {
        if (data.length === 0) return <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>[]</span>;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {data.map((item, index) => {
                    const currentPath = `${path ? path + '.' : ''}${index}`;
                    return (
                        <div key={index} style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
                            <span style={{ color: '#64748b', fontSize: '0.8rem', minWidth: '15px' }}>{index}:</span>
                            <div style={{ flex: 1 }}>
                                {typeof item === 'object' && item !== null ? (
                                    <CollapsibleField
                                        label={index}
                                        typeLabel={Array.isArray(item) ? `Array[${item.length}]` : `Object{${Object.keys(item).length}}`}
                                        isOpen={isExpanded(currentPath)}
                                        onToggle={() => onToggleExpand && onToggleExpand(currentDocId, currentPath)}
                                    >
                                        <DocumentCard
                                            data={item}
                                            onConnect={onConnect}
                                            onQuickConnect={onQuickConnect}
                                            connectionHistoryVersion={connectionHistoryVersion}
                                            onDateClick={onDateClick}
                                            onFlagClick={onFlagClick}
                                            path={currentPath}
                                            docId={currentDocId}
                                            collection={collection}
                                            expandedPaths={expandedPaths}
                                            onToggleExpand={onToggleExpand}
                                        />
                                    </CollapsibleField>
                                ) : (
                                    <ValueDisplay
                                        value={item}
                                        onConnect={onConnect}
                                        onQuickConnect={onQuickConnect}
                                        connectionHistoryVersion={connectionHistoryVersion}
                                        onDateClick={onDateClick}
                                        onFlagClick={onFlagClick}
                                        path={currentPath}
                                        docId={currentDocId}
                                        collection={collection}
                                    />
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // Object Handling
    if (typeof data === 'object' && data !== null) {
        if (Object.keys(data).length === 0) return <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>{"{}"}</span>;

        // Get hoistedFields from context
        const { hoistedFields } = useConnection();

        // Sort entries so hoisted fields come first
        const sortedEntries = Object.entries(data).sort(([keyA], [keyB]) => {
            const pathA = `${path ? path + '.' : ''}${keyA}`;
            const pathB = `${path ? path + '.' : ''}${keyB}`;
            const aHoisted = hoistedFields && collection && hoistedFields.has(`${collection}:${pathA}`);
            const bHoisted = hoistedFields && collection && hoistedFields.has(`${collection}:${pathB}`);
            if (aHoisted && !bHoisted) return -1;
            if (!aHoisted && bHoisted) return 1;
            return 0;
        });

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
                {sortedEntries.map(([key, value]) => {
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
                                isOpen={isExpanded(nextPath)}
                                onToggle={() => onToggleExpand && onToggleExpand(currentDocId, nextPath)}
                            >
                                <DocumentCard
                                    data={value}
                                    onConnect={onConnect}
                                    onQuickConnect={onQuickConnect}
                                    connectionHistoryVersion={connectionHistoryVersion}
                                    onDateClick={onDateClick}
                                    onFlagClick={onFlagClick}
                                    path={nextPath}
                                    docId={currentDocId}
                                    collection={collection}
                                    expandedPaths={expandedPaths}
                                    onToggleExpand={onToggleExpand}
                                />
                            </CollapsibleField>
                        );
                    }

                    const { onContextMenu, markedSources, highlightedFields, hoistedFields: contextHoistedFields, idColorOverrides = {} } = useConnection();
                    const isMarked = markedSources && collection && markedSources.has(`${collection}:${nextPath}`);
                    const isHighlighted = highlightedFields && collection && highlightedFields.has(`${collection}:${nextPath}`);
                    const isHoisted = contextHoistedFields && collection && contextHoistedFields.has(`${collection}:${nextPath}`);

                    return (
                        <div key={key} style={{
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'baseline',
                            padding: isHighlighted ? '4px 8px' : '1px 0',
                            margin: isHighlighted ? '2px 0' : '0',
                            background: isHighlighted
                                ? 'linear-gradient(90deg, rgba(52, 211, 153, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)'
                                : 'transparent',
                            borderRadius: isHighlighted ? '6px' : '0',
                            border: isHighlighted ? '1px solid rgba(52, 211, 153, 0.3)' : 'none',
                            boxShadow: isHighlighted ? '0 0 8px rgba(52, 211, 153, 0.15)' : 'none',
                            transition: 'all 0.2s ease'
                        }}>
                            <span
                                onContextMenu={(e) => {
                                    if (onContextMenu) {
                                        onContextMenu(e, currentDocId, nextPath, collection);
                                    }
                                }}
                                style={{
                                    fontWeight: 600,
                                    color: isHighlighted ? '#34d399' : (key === '_id' ? getColorFromId(value, idColorOverrides[value] || 0) : '#94a3b8'),
                                    fontSize: '0.85rem',
                                    whiteSpace: 'nowrap',
                                    cursor: 'context-menu',
                                    background: isMarked ? 'rgba(251, 191, 36, 0.2)' : 'transparent',
                                    padding: isMarked ? '2px 4px' : '0',
                                    border: isMarked ? '1px solid rgba(251, 191, 36, 0.4)' : 'none',
                                    borderRadius: '3px'
                                }}
                            >{isHoisted && <span style={{ marginRight: '4px' }}>📌</span>}{key}:</span>
                            <ValueDisplay
                                value={value}
                                onConnect={onConnect}
                                onQuickConnect={onQuickConnect}
                                connectionHistoryVersion={connectionHistoryVersion}
                                onFlagClick={onFlagClick}
                                isIdField={key === '_id'}
                                onDateClick={onDateClick}
                                path={nextPath}
                                docId={currentDocId}
                                collection={collection}
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
        onQuickConnect={onQuickConnect}
        connectionHistoryVersion={connectionHistoryVersion}
        onDateClick={onDateClick}
        onFlagClick={onFlagClick}
        path={path}
        docId={currentDocId}
        collection={collection}
    />;
};

export default DocumentCard;

