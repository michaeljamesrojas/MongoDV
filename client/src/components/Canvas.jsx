
import React, { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import DocumentCard from './DocumentCard';
import { ConnectionContext } from '../contexts/ConnectionContext';
import { useToast } from '../contexts/ToastContext';
import { getColorFromId } from '../utils/colors';
import { useDragAwareClick } from '../hooks/useDragAwareClick';

const getValueByPath = (obj, path) => {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
};

const getDateFromStableId = (docMap, stableId) => {
    if (!stableId) return null;
    // format: date-{docId}-{path}
    const match = stableId.match(/^date-([^-]+)-(.*)$/);
    if (!match) return null;
    const [, docId, path] = match;
    const doc = docMap instanceof Map ? docMap.get(docId) : (Array.isArray(docMap) ? docMap.find(d => d._id === docId) : null);
    if (!doc) return null;
    const val = getValueByPath(doc.data, path);
    if (!val) return null;
    const date = new Date(val);
    return isNaN(date.getTime()) ? null : date;
};

// Managed separately to avoid Canvas re-rendering on every frame
const ConnectionLayer = memo(({ gapNodes, arrowDirection, nodeRegistry, zoom, pan, canvasRef, documents, idColorOverrides = {}, showBackdroppedArrows = true, showAllArrows = true, cardRefs }) => {
    // Track dimmed document IDs for line dimming
    const dimmedDocIds = useMemo(() => {
        const set = new Set();
        documents.forEach(doc => {
            if (doc.dimmed) set.add(doc._id);
        });
        return set;
    }, [documents]);
    const [lines, setLines] = useState([]);
    const frameRef = useRef();

    useEffect(() => {
        const updateLines = () => {
            // Only update if canvas is visible and we have nodes
            if (!canvasRef.current || nodeRegistry.current.size === 0 && gapNodes.length === 0) {
                if (lines.length > 0) setLines([]);
                return;
            }

            if (!showAllArrows) {
                if (lines.length > 0) setLines([]);
                return;
            }

            const newLines = [];
            const nodes = Array.from(nodeRegistry.current.values());

            // 1. Regular Document Connections
            const grouped = {};
            nodes.forEach(node => {
                // Check if element is still in DOM, clean up if not
                if (!node.ref.isConnected) {
                    nodeRegistry.current.delete(node.ref);
                    return;
                }

                if (!grouped[node.value]) grouped[node.value] = { defs: [], refs: [] };
                if (node.type === 'def') grouped[node.value].defs.push(node);
                else grouped[node.value].refs.push(node);
            });

            // Helper to check if a node's parent card is dimmed
            const isNodeDimmed = (nodeRef) => {
                const cardEl = nodeRef.closest('[data-draggable-card]');
                if (!cardEl) return false;
                // Find the doc ID from the card - we check document IDs from our dimmedDocIds set
                for (const doc of documents) {
                    const docCard = document.querySelector(`[data-draggable-card][data-doc-id="${doc._id}"]`);
                    if (docCard === cardEl && doc.dimmed) return true;
                }
                return false;
            };

            if (canvasRef.current) {
                const canvasRect = canvasRef.current.getBoundingClientRect();

                // Helper to get Canvas Coords from Rect - now uses the "end" (right side) of the element
                const getCanvasCoords = (rect, anchor = 'right') => {
                    let xOffset = rect.width / 2;
                    if (anchor === 'right') xOffset = rect.width;
                    if (anchor === 'left') xOffset = 0;

                    return {
                        x: (rect.left - canvasRect.left + xOffset),
                        y: (rect.top - canvasRect.top + rect.height / 2)
                    };
                };

                Object.values(grouped).forEach(({ defs, refs }) => {
                    if (defs.length === 0 || refs.length === 0) return;

                    refs.forEach(refNode => {
                        const refRect = refNode.ref.getBoundingClientRect();
                        if (refRect.width === 0) return; // Hidden/Detached

                        defs.forEach(defNode => {
                            const defRect = defNode.ref.getBoundingClientRect();
                            if (defRect.width === 0) return;

                            const start = getCanvasCoords(refRect);
                            const end = getCanvasCoords(defRect);

                            // Determine start/end based on direction
                            const isReverse = arrowDirection === 'reverse';

                            // Check if either connected node is dimmed
                            const isDimmed = isNodeDimmed(refNode.ref) || isNodeDimmed(defNode.ref);

                            const variation = idColorOverrides[refNode.value] || 0;
                            const color = getColorFromId(refNode.value, variation);

                            newLines.push({
                                id: `${nodeRegistry.current.get(refNode.ref)?.value}-${refNode.value}-${defNode.value}`, // More stable ID structure could help but index is ok for now
                                x1: isReverse ? end.x : start.x,
                                y1: isReverse ? end.y : start.y,
                                x2: isReverse ? start.x : end.x,
                                y2: isReverse ? start.y : end.y,
                                color: color,
                                dimmed: isDimmed,
                                value: refNode.value // Store value to link to color/marker
                            });
                        });
                    });
                });

                const docMap = new Map();
                documents.forEach(d => docMap.set(d._id, d));

                // 2. Gap Node Connections
                gapNodes.forEach(node => {
                    let liveText = node.text;
                    if (node.sourceId && node.targetId) {
                        const startDate = getDateFromStableId(docMap, node.sourceId);
                        const endDate = getDateFromStableId(docMap, node.targetId);
                        if (startDate && endDate) {
                            liveText = calculateTimeGap(startDate, endDate);
                        }
                    }

                    // Start -> GapNode
                    const sourceEl = document.getElementById(node.sourceId);

                    if (sourceEl) {
                        const sourceRect = sourceEl.getBoundingClientRect();
                        if (sourceRect.width > 0) {
                            const sourcePos = getCanvasCoords(sourceRect, 'right');

                            // Calculate Gap Node Position (Prefer live DOM if available for smooth drag)
                            let gapScreenX, gapScreenY;
                            const gapEl = cardRefs?.current?.get(node.id);
                            if (gapEl) {
                                const rect = gapEl.getBoundingClientRect();
                                const centerX = rect.left - canvasRect.left + rect.width / 2;
                                const centerY = rect.top - canvasRect.top + rect.height / 2;
                                gapScreenX = centerX;
                                gapScreenY = centerY;
                            } else {
                                gapScreenX = node.x * zoom + pan.x;
                                gapScreenY = node.y * zoom + pan.y;
                            }

                            newLines.push({
                                id: `${node.id}-source`,
                                x1: sourcePos.x,
                                y1: sourcePos.y,
                                x2: gapScreenX,
                                y2: gapScreenY,
                                color: liveText.startsWith('After:') ? '#4ade80' : '#f87171'
                            });
                        }
                    }

                    // GapNode -> Target
                    const targetEl = document.getElementById(node.targetId);
                    if (targetEl) {
                        const targetRect = targetEl.getBoundingClientRect();
                        if (targetRect.width > 0) {
                            const targetPos = getCanvasCoords(targetRect, 'left');

                            // Calculate Gap Node Position (Repetitive but efficient enough for now, or hoist above)
                            let gapScreenX, gapScreenY;
                            const gapEl = cardRefs?.current?.get(node.id);
                            if (gapEl) {
                                const rect = gapEl.getBoundingClientRect();
                                const centerX = rect.left - canvasRect.left + rect.width / 2;
                                const centerY = rect.top - canvasRect.top + rect.height / 2;
                                gapScreenX = centerX;
                                gapScreenY = centerY;
                            } else {
                                gapScreenX = node.x * zoom + pan.x;
                                gapScreenY = node.y * zoom + pan.y;
                            }

                            newLines.push({
                                id: `${node.id}-target`,
                                x1: gapScreenX,
                                y1: gapScreenY,
                                x2: targetPos.x,
                                y2: targetPos.y,
                                color: liveText.startsWith('After:') ? '#4ade80' : '#f87171'
                            });
                        }
                    }
                });
            }

            setLines(newLines);
            frameRef.current = requestAnimationFrame(updateLines);
        };

        updateLines();
        return () => cancelAnimationFrame(frameRef.current);
    }, [gapNodes, arrowDirection, zoom, pan, nodeRegistry, canvasRef, documents, dimmedDocIds, idColorOverrides, showAllArrows, showBackdroppedArrows]);

    // Get unique values to create markers for
    const uniqueValues = useMemo(() => {
        const values = new Set();
        lines.forEach(line => {
            if (line.value) values.add(line.value);
        });
        return Array.from(values);
    }, [lines]);

    return (
        <svg style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 5
        }}>
            <defs>
                <marker id="arrowhead-default" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#fbbf24" opacity="0.5" />
                </marker>
                <marker id="marker-plus" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#4ade80" opacity="0.5" />
                </marker>
                <marker id="marker-minus" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="#f87171" opacity="0.5" />
                </marker>
                {uniqueValues.map(val => (
                    <marker
                        key={`marker-${val}`}
                        id={`marker-${val}`}
                        markerWidth="10"
                        markerHeight="7"
                        refX="9"
                        refY="3.5"
                        orient="auto"
                    >
                        <polygon points="0 0, 10 3.5, 0 7" fill={getColorFromId(val, idColorOverrides[val] || 0)} opacity="0.5" />
                    </marker>
                ))}
            </defs>
            {lines.map((line, i) => {
                let markerUrl = "url(#arrowhead-default)";
                if (line.value) {
                    markerUrl = `url(#marker-${line.value})`;
                } else if (line.color === '#4ade80') {
                    markerUrl = "url(#marker-plus)";
                } else if (line.color === '#f87171') {
                    markerUrl = "url(#marker-minus)";
                }

                return (
                    <line
                        key={i}
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        stroke={line.color || "#fbbf24"}
                        strokeWidth="2"
                        strokeOpacity={line.dimmed ? (showBackdroppedArrows ? 0.1 : 0) : 0.6}
                        markerEnd={markerUrl}
                        style={{ transition: 'stroke-opacity 0.2s' }}
                    />
                );
            })}
        </svg>
    );
});

const DraggableCard = React.memo(({ doc, zoom, onConnect, onFlagClick, onClone, onDelete, onDateClick, onToggleExpand, isSelected, onMouseDown, dragOffset, registerRef, backdropToggleMode, backdropMouseDown, onToggleBackdrop, onUpdateData, onUpdateDimensions, onContextMenu }) => {
    const cardRef = useRef(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editData, setEditData] = useState('');

    // Register this card's ref for box selection and dragging
    useEffect(() => {
        if (cardRef.current && registerRef) {
            registerRef(doc._id, cardRef.current);
        }
        return () => {
            if (registerRef) {
                registerRef(doc._id, null);
            }
        };
    }, [doc._id, registerRef]);
    useEffect(() => {
        if (!cardRef.current) return;

        // Apply initial dimensions if they exist
        if (doc.width) {
            cardRef.current.style.width = `${doc.width}px`;
        } else {
            cardRef.current.style.width = '350px';
        }

        if (doc.height) {
            cardRef.current.style.height = `${doc.height}px`;
        } else {
            cardRef.current.style.height = ''; // Ensure it's empty so it behaves as 'auto'
        }

        // Implementation of a simple debounce
        let timeout;
        const debouncedUpdate = (w, h) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (onUpdateDimensions) {
                    onUpdateDimensions(doc._id, w, h);
                }
            }, 500);
        };

        const ro = new ResizeObserver(entries => {
            for (let entry of entries) {
                const target = entry.target;

                // Only sync height if the user has manually set it (via resize handle)
                // browser sets target.style.height/width when resizing via 'resize: both'
                const hasInlineWidth = target.style.width !== "";
                const hasInlineHeight = target.style.height !== "";

                // We also check offsetWidth/Height for the actual values to save
                const actualWidth = target.offsetWidth;
                const actualHeight = target.offsetHeight;

                // Match against current state dimensions. 
                const currentWidth = doc.width || 350;
                const currentHeight = doc.height; // could be null

                let shouldUpdate = false;
                let updateWidth = currentWidth;
                let updateHeight = currentHeight;

                // Sync width if it differs from state (usually fixed at 350 by default anyway)
                if (Math.abs(actualWidth - currentWidth) > 3) {
                    shouldUpdate = true;
                    updateWidth = actualWidth;
                }

                // IMPORTANT: Only sync height if we intentionally HAVE a height 
                // (either from state or via manual inline style from browser resize)
                if (hasInlineHeight && (currentHeight === null || Math.abs(actualHeight - currentHeight) > 3)) {
                    shouldUpdate = true;
                    updateHeight = actualHeight;
                }

                if (shouldUpdate) {
                    debouncedUpdate(updateWidth, updateHeight);
                }
            }
        });

        ro.observe(cardRef.current);
        return () => {
            ro.disconnect();
            clearTimeout(timeout);
        };
    }, [doc._id, onUpdateDimensions, doc.width, doc.height]);

    const currentX = doc.x;
    const currentY = doc.y;

    // Determine if this card is dimmed
    const isDimmed = doc.dimmed === true;

    const toggleBackdropHandler = useDragAwareClick((e) => { e.stopPropagation(); onToggleBackdrop && onToggleBackdrop(doc._id); });
    const editHandler = useDragAwareClick((e) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditData(JSON.stringify(doc.data, null, 2));
    });
    const cloneHandler = useDragAwareClick((e) => { e.stopPropagation(); onClone && onClone(doc._id); });
    const deleteHandler = useDragAwareClick((e) => { e.stopPropagation(); onDelete && onDelete(doc._id); });

    return (
        <div
            ref={cardRef}
            data-draggable-card
            data-doc-id={doc._id}
            style={{
                position: 'absolute',
                left: currentX,
                top: currentY,
                zIndex: isSelected ? 100 : 10,
                boxShadow: isSelected ? '0 0 0 2px var(--primary), 0 10px 25px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.1)',
                transition: 'box-shadow 0.2s, opacity 0.2s, filter 0.2s', // Removed top/left transition for instant drag response
                background: 'var(--panel-bg)',
                borderRadius: '8px',
                border: '1px solid var(--glass-border)',
                padding: '1rem',
                resize: 'both',
                overflow: 'hidden',
                minWidth: '200px',
                minHeight: '100px',
                display: 'flex',
                flexDirection: 'column',
                // Dimming effect when backdrop is toggled
                opacity: isDimmed ? 0.15 : 1,
                filter: isDimmed ? 'blur(1px)' : 'none',
                cursor: backdropToggleMode ? 'crosshair' : undefined
            }}
            onMouseDown={(e) => {
                if (backdropToggleMode) {
                    e.stopPropagation();
                    onToggleBackdrop && onToggleBackdrop(doc._id);
                    return;
                }

                // Prevent drag when clicking resize handle (bottom-right corner)
                const rect = e.currentTarget.getBoundingClientRect();
                const isResizeHandle = e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;

                if (isResizeHandle) {
                    e.stopPropagation();
                    return;
                }

                e.stopPropagation();
                // We notify parent. Parent determines if it's a drag start or just selection.
                // But we need to pass the event so parent gets clientX/Y.
                onMouseDown(e, doc._id);
            }}
            onMouseEnter={() => {
                // If in backdrop toggle mode and mouse is pressed, toggle
                if (backdropToggleMode && backdropMouseDown) {
                    onToggleBackdrop && onToggleBackdrop(doc._id);
                }
            }}
            onContextMenu={(e) => {
                onContextMenu && onContextMenu(e, doc._id);
            }}
        >
            <div
                style={{
                    marginBottom: '0.5rem',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    cursor: 'grab',
                    userSelect: 'none',
                    flexShrink: 0
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {doc.collection && (
                        <span style={{
                            fontSize: '0.65rem',
                            color: 'var(--primary)',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            marginBottom: '2px'
                        }}>
                            {doc.collection}
                        </span>
                    )}
                    <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                        ID: {doc.data._id || 'Unknown'}
                    </span>
                </div>

                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <button
                        title="Toggle Backdrop"
                        onMouseDown={toggleBackdropHandler.onMouseDown}
                        onClick={toggleBackdropHandler.onClick}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: isDimmed ? 'var(--primary)' : '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'color 0.2s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
                        onMouseLeave={e => e.currentTarget.style.color = isDimmed ? 'var(--primary)' : '#94a3b8'}
                    >
                        <span style={{ fontSize: '0.9rem' }}>👁</span>
                    </button>
                    {doc.collection === 'Custom' && (
                        <button
                            title="Edit"
                            onMouseDown={editHandler.onMouseDown}
                            onClick={editHandler.onClick}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#94a3b8',
                                cursor: 'pointer',
                                padding: '2px',
                                borderRadius: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
                            onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                        >
                            <span style={{ fontSize: '0.9rem' }}>📝</span>
                        </button>
                    )}
                    <button
                        title="Clone"
                        onMouseDown={cloneHandler.onMouseDown}
                        onClick={cloneHandler.onClick}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--primary)'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                    >
                        <span style={{ fontSize: '0.9rem' }}>⎘</span>
                    </button>
                    <button
                        title="Delete"
                        onMouseDown={deleteHandler.onMouseDown}
                        onClick={deleteHandler.onClick}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: '2px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                        onMouseLeave={e => e.currentTarget.style.color = '#94a3b8'}
                    >
                        <span style={{ fontSize: '0.9rem' }}>✕</span>
                    </button>
                </div>
            </div>

            <div style={{ flex: 1 }} onMouseDown={(e) => isEditing && e.stopPropagation()}>
                {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '100%' }}>
                        <textarea
                            autoFocus
                            value={editData}
                            onChange={(e) => setEditData(e.target.value)}
                            onKeyDown={(e) => {
                                // Prevents panned/zoomed canvas from taking keyboard events while typing
                                e.stopPropagation();
                            }}
                            style={{
                                width: '100%',
                                minHeight: '200px',
                                flex: 1,
                                background: 'rgba(0,0,0,0.2)',
                                border: '1px solid var(--glass-border)',
                                borderRadius: '4px',
                                color: '#e2e8f0',
                                fontFamily: 'monospace',
                                fontSize: '0.85rem',
                                padding: '8px',
                                outline: 'none',
                                resize: 'vertical'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
                                style={{
                                    padding: '4px 8px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid var(--glass-border)',
                                    borderRadius: '4px',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                }}
                            >Cancel</button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    try {
                                        const parsed = JSON.parse(editData);
                                        onUpdateData && onUpdateData(doc._id, parsed);
                                        setIsEditing(false);
                                    } catch (err) {
                                        alert("Invalid JSON: " + err.message);
                                    }
                                }}
                                style={{
                                    padding: '4px 8px',
                                    background: 'var(--primary)',
                                    border: 'none',
                                    borderRadius: '4px',
                                    color: 'white',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    fontSize: '0.8rem'
                                }}
                            >Save</button>
                        </div>
                    </div>
                ) : (
                    <DocumentCard
                        data={doc.data}
                        isRoot={true}
                        onConnect={onConnect}
                        onDateClick={onDateClick}
                        onFlagClick={onFlagClick}
                        onToggleExpand={onToggleExpand}
                        expandedPaths={doc.expandedPaths || []}
                        docId={doc._id}
                        collection={doc.collection}
                    />
                )}
            </div>
        </div>
    );
});

const DraggableGapNode = memo(({ node, text, zoom, onUpdatePosition, onDelete, isSelected, onMouseDown, registerRef, onContextMenu }) => {
    const nodeRef = useRef(null);

    const currentX = node.x;
    const currentY = node.y;

    const deleteHandler = useDragAwareClick((e) => { e.stopPropagation(); onDelete(node.id); });

    useEffect(() => {
        if (registerRef) {
            registerRef(node.id, nodeRef.current);
            return () => registerRef(node.id, null);
        }
    }, [node.id, registerRef]);

    return (
        <div
            ref={nodeRef}
            onContextMenu={(e) => onContextMenu && onContextMenu(e, node.id)}
            onMouseDown={(e) => {
                e.stopPropagation();
                onMouseDown(e, node.id);
            }}
            style={{
                position: 'absolute',
                left: currentX,
                top: currentY,
                transform: 'translate(-50%, -50%)',
                background: text.startsWith('After:') ? '#4ade80' : '#f87171',
                color: '#0f172a',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: 'grab',
                zIndex: 2000,
                boxShadow: isSelected ? '0 0 0 3px var(--primary), 0 8px 16px rgba(0,0,0,0.4)' : '0 4px 6px rgba(0,0,0,0.2)',
                border: isSelected ? '1px solid white' : '1px solid rgba(255,255,255,0.2)',
                userSelect: 'none',
                minWidth: 'max-content',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'box-shadow 0.2s, border 0.2s, opacity 0.2s, filter 0.2s',
                opacity: node.dimmed ? 0.3 : 1,
                filter: node.dimmed ? 'blur(1px) grayscale(50%)' : 'none'
            }}
        >
            {text}
            <button
                onMouseDown={deleteHandler.onMouseDown}
                onClick={deleteHandler.onClick}
                style={{
                    background: 'rgba(0,0,0,0.1)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '16px',
                    height: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#0f172a',
                    fontSize: '0.7rem',
                    padding: 0
                }}
            >
                ✕
            </button>
        </div>
    );
});

const Canvas = ({
    documents,
    viewState,
    onViewStateChange,
    onUpdatePosition,
    onUpdatePositions,
    onUpdateDimensions,
    onConnect,
    onClone,
    onDelete,
    onDeleteMany,
    onSave,
    onSaveAs,
    onLoad,
    onExport,
    onImport,
    currentSaveName,
    gapNodes = [],
    onUpdateGapNodePosition,
    onAddGapNode,
    onDeleteGapNode,
    onToggleExpand,
    markedSources = new Set(),
    onMarkedSourcesChange,
    highlightedFields = new Set(),
    onHighlightedFieldsChange,
    hoistedFields = new Set(),
    onHoistedFieldsChange,
    arrowDirection = 'forward',
    onArrowDirectionChange,
    showBackdroppedArrows = true,
    onShowBackdroppedArrowsChange,
    showAllArrows = true,
    onShowAllArrowsChange,
    onToggleBackdrop,
    onUpdateData,
    onAddCustomDocument,
    idColorOverrides = {},
    onIdColorChange,
    onUndo,
    onRedo,
    canUndo,
    canRedo
}) => {
    const { showToast } = useToast();
    // destruct defaults if undefined to avoid crash, though App passes them
    const { pan, zoom } = viewState || { pan: { x: 0, y: 0 }, zoom: 1 };

    const [isPanning, setIsPanning] = useState(false);
    const canvasRef = useRef(null);
    const [selectedIds, setSelectedIds] = useState([]);

    // DRAG REFACTOR: Refs for high-performance dragging without re-renders
    const selectedIdsRef = useRef([]); // Keep in sync with selectedIds state
    const dragStateRef = useRef(null); // { startX, startY, [id]: { initialX, initialY, element, originalZIndex } }

    // Sync state to ref
    useEffect(() => {
        selectedIdsRef.current = selectedIds;
    }, [selectedIds]);

    const [boxSelectState, setBoxSelectState] = useState(null); // { startX, startY, currentX, currentY } in screen coords
    const [boxSelectPreviewIds, setBoxSelectPreviewIds] = useState([]); // IDs currently under box selection
    const boxSelectPreviewRef = useRef([]); // Ref to track latest preview for mouseup handler
    const cardRefs = useRef(new Map()); // Map<docId, HTMLElement>

    // Backdrop toggle mode state
    const [backdropToggleMode, setBackdropToggleMode] = useState(false);
    const [canvasContextMenu, setCanvasContextMenu] = useState(null); // { x, y } for canvas right-click menu
    const [cardContextMenu, setCardContextMenu] = useState(null); // { x, y, docId } for document right-click menu
    const [backdropMouseDown, setBackdropMouseDown] = useState(false); // Track if mouse is held down in backdrop mode

    // Custom document creation state
    const [pendingCustomCard, setPendingCustomCard] = useState(null); // { x, y, data: string }

    // Animation Ref
    const animationFrameRef = useRef(null);

    const handleFlagClick = useCallback((targetValue) => {
        if (!canvasRef.current) return;

        // 1. Find the target node in the registry
        let targetCanvasPos = null;

        // First look for a 'def' node with this value
        for (const [ref, node] of nodeRegistry.current.entries()) {
            if (node.value === targetValue && node.type === 'def') {
                const rect = ref.getBoundingClientRect();
                const canvasRect = canvasRef.current.getBoundingClientRect();
                // Convert screen center of node to canvas coordinates
                const screenX = rect.left + rect.width / 2;
                const screenY = rect.top + rect.height / 2;

                targetCanvasPos = {
                    x: (screenX - canvasRect.left - viewStateRef.current.pan.x) / viewStateRef.current.zoom,
                    y: (screenY - canvasRect.top - viewStateRef.current.pan.y) / viewStateRef.current.zoom
                };
                break;
            }
        }

        // If not found in registry (collapsed or not a source yet), look for document with this _id
        if (!targetCanvasPos) {
            const targetDoc = documents.find(d => d._id === targetValue || (d.data && d.data._id === targetValue));
            if (targetDoc) {
                targetCanvasPos = {
                    x: targetDoc.x + 175, // Center of 350px card
                    y: targetDoc.y + 100  // Rough center
                };
            }
        }

        if (!targetCanvasPos) {
            showToast(`Target "${targetValue}" not found on canvas`, 'warning');
            return;
        }

        // 2. Calculate target pan to center the targetCanvasPos
        const viewport = canvasRef.current.getBoundingClientRect();
        const targetZoom = Math.max(viewStateRef.current.zoom, 0.6); // Don't zoom in too much, but ensure it's visible

        const targetPanX = viewport.width / 2 - targetCanvasPos.x * targetZoom;
        const targetPanY = viewport.height / 2 - targetCanvasPos.y * targetZoom;

        // 3. Smoothly animate pan and zoom
        const startPan = { ...viewStateRef.current.pan };
        const startZoom = viewStateRef.current.zoom;
        const duration = 800; // ms
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (easeInOutCubic)
            const ease = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const currentPan = {
                x: startPan.x + (targetPanX - startPan.x) * ease,
                y: startPan.y + (targetPanY - startPan.y) * ease
            };
            const currentZoom = startZoom + (targetZoom - startZoom) * ease;

            onViewStateChange({ pan: currentPan, zoom: currentZoom });

            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                animationFrameRef.current = null;
            }
        };

        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = requestAnimationFrame(animate);

    }, [documents, onViewStateChange, showToast]);

    // Memoized Map of documents for efficient lookup by ID
    const docMap = useMemo(() => {
        const map = new Map();
        documents.forEach(d => map.set(d._id, d));
        return map;
    }, [documents]);

    // Keyboard listeners
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && backdropToggleMode) {
                setBackdropToggleMode(false);
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIds.length > 0) {
                    onDeleteMany && onDeleteMany(selectedIds);
                    setSelectedIds([]);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, onDeleteMany, backdropToggleMode]);

    // Date Gap Logic
    const [dateSelection, setDateSelection] = useState(null); // { value: Date, stableId: string }

    // Mark as Source Logic - keyed by collection:path so all docs from same collection share the marking
    // markedSources is now passed as a prop from App.jsx
    const [contextMenu, setContextMenu] = useState(null); // { x, y, docId, path, collection }

    const toggleMarkAsSource = useMemo(() => (collection, path) => {
        const key = `${collection}:${path}`;
        if (onMarkedSourcesChange) {
            onMarkedSourcesChange(prev => {
                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        }
        setContextMenu(null);
    }, [onMarkedSourcesChange]);

    const toggleHighlight = useMemo(() => (collection, path) => {
        const key = `${collection}:${path}`;
        if (onHighlightedFieldsChange) {
            onHighlightedFieldsChange(prev => {
                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        }
        setContextMenu(null);
    }, [onHighlightedFieldsChange]);

    const toggleHoist = useMemo(() => (collection, path) => {
        const key = `${collection}:${path}`;
        if (onHoistedFieldsChange) {
            onHoistedFieldsChange(prev => {
                const next = new Set(prev);
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        }
        setContextMenu(null);
    }, [onHoistedFieldsChange]);

    const handleContextMenu = useMemo(() => (e, docId, path, collection) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            docId,
            path,
            collection
        });
    }, []);


    // Close context menu on global click
    useEffect(() => {
        const closeMenu = () => {
            setContextMenu(null);
            setCanvasContextMenu(null);
            setCardContextMenu(null);
        };
        if (contextMenu || canvasContextMenu || cardContextMenu) {
            window.addEventListener('click', closeMenu);
            // Note: Don't listen to contextmenu here - it interferes with opening new context menus
        }
        return () => {
            window.removeEventListener('click', closeMenu);
        };
    }, [contextMenu, canvasContextMenu, cardContextMenu]);


    // Use ref to access latest viewState in callbacks without triggering re-renders
    const viewStateRef = useRef(viewState);
    useEffect(() => {
        viewStateRef.current = viewState;
    }, [viewState]);

    const handleDateClick = useMemo(() => (dateValue, e, stableId) => {
        const date = new Date(dateValue);
        const { pan, zoom } = viewStateRef.current;

        // Ensure we have a valid stableId, fallback if missing
        if (!stableId) {
            console.warn("Missing stable ID for date click");
            return;
        }

        if (!dateSelection) {
            setDateSelection({ value: date, stableId: stableId, ref: e.currentTarget });
        } else {
            // Check if same date selected (deselect)
            if (dateSelection.stableId === stableId) {
                setDateSelection(null);
                return;
            }

            // Calculate difference
            const text = calculateTimeGap(dateSelection.value, date);

            // Calculate position in Canvas Coordinates
            // e.clientX is viewport. We need to convert to canvas coords.
            const canvasX = (e.clientX - pan.x) / zoom;
            const canvasY = (e.clientY - pan.y) / zoom;

            const newGapNode = {
                id: `gap-${Date.now()}`,
                text,
                x: canvasX,
                y: canvasY - 50, // slightly above
                sourceId: dateSelection.stableId,
                targetId: stableId
            };

            onAddGapNode(newGapNode);
            setDateSelection(null); // Reset
        }
    }, [onAddGapNode, dateSelection]);

    // Connection Logic
    const nodeRegistry = useRef(new Map()); // Map<id, { type: 'def'|'ref', ref: HTMLElement, value: string }>

    // Register/Unregister nodes - Memoized to prevent Context value updates
    const registerNode = useMemo(() => (value, type, ref) => {
        if (!ref) return;
        nodeRegistry.current.set(ref, { value, type, ref });
    }, []);

    const unregisterNode = useMemo(() => (ref) => {
        nodeRegistry.current.delete(ref);
    }, []);

    const contextValue = useMemo(() => ({
        registerNode,
        unregisterNode,
        markedSources,
        toggleMarkAsSource,
        highlightedFields,
        toggleHighlight,
        hoistedFields,
        toggleHoist,
        onContextMenu: handleContextMenu,
        idColorOverrides,
        onIdColorChange
    }), [registerNode, unregisterNode, markedSources, toggleMarkAsSource, highlightedFields, toggleHighlight, hoistedFields, toggleHoist, handleContextMenu, idColorOverrides, onIdColorChange]);

    // For panning logic
    const lastMousePos = useRef({ x: 0, y: 0 });

    const handleWheel = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomSensitivity = 0.001;
        const delta = -e.deltaY * zoomSensitivity;
        const newZoom = Math.min(Math.max(zoom + delta, 0.1), 5);

        const scaleFactor = newZoom / zoom;

        // Calculate new pan to keep the point under mouse stationary
        const newPanX = mouseX - (mouseX - pan.x) * scaleFactor;
        const newPanY = mouseY - (mouseY - pan.y) * scaleFactor;

        onViewStateChange({
            pan: { x: newPanX, y: newPanY },
            zoom: newZoom
        });
    };

    const handlePanMouseDown = (e) => {
        // Middle mouse or Left click on background (only if not handled by card)
        if (e.button === 0 || e.button === 1) {
            if (e.shiftKey || e.button === 1) {
                // Shift+Drag or Middle mouse = pan
                setSelectedIds([]);
                setIsPanning(true);
                lastMousePos.current = { x: e.clientX, y: e.clientY };
                document.body.style.cursor = 'grabbing';
                document.addEventListener('mousemove', handlePanMove);
                document.addEventListener('mouseup', handlePanUp);
            } else {
                // Normal click on background = box selection
                setBoxSelectState({
                    startX: e.clientX,
                    startY: e.clientY,
                    currentX: e.clientX,
                    currentY: e.clientY
                });
                document.body.style.cursor = 'crosshair';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', handleBoxSelectMove);
                document.addEventListener('mouseup', handleBoxSelectUp);
            }
        }
    };

    const handlePanMove = (e) => {
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;

        onViewStateChange(prev => ({
            ...prev,
            pan: {
                x: prev.pan.x + dx,
                y: prev.pan.y + dy
            }
        }));
        lastMousePos.current = { x: e.clientX, y: e.clientY };
    };

    const handlePanUp = () => {
        setIsPanning(false);
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handlePanMove);
        document.removeEventListener('mouseup', handlePanUp);
    };

    // Helper: Find gaps for a document
    const findLinkedGaps = (docId) => {
        // Simple heuristic: if a gap node uses this docId as source or target
        // But actually gap nodes have stable IDs as source/target, not just docIds. 
        // We'll rely on the user selecting them or moving them manually for now as requested.
        // OR we just iterate all gap nodes and check if they are selected.
        return [];
    };

    const handleNodeContextMenu = useCallback((e, nodeId) => {
        e.preventDefault();
        e.stopPropagation();

        const currentSelected = selectedIdsRef.current;
        let newSelected = currentSelected;

        if (!currentSelected.includes(nodeId)) {
            // Right-clicked on unselected item -> Select ONLY this item
            newSelected = [nodeId];
            setSelectedIds([nodeId]);
        }
        // If right-clicked on already selected item, keep selection (to allow bulk action)

        setCardContextMenu({
            x: e.clientX,
            y: e.clientY,
            docId: nodeId
        });
    }, []);

    // ----- Box Selection Logic -----
    const handleBoxSelectMove = (e) => {
        const currentX = e.clientX;
        const currentY = e.clientY;

        setBoxSelectState(prev => ({
            ...prev,
            currentX,
            currentY
        }));

        // Calculate preview selection in real-time
        setBoxSelectState(prev => {
            if (!prev) return prev;

            const boxLeft = Math.min(prev.startX, currentX);
            const boxTop = Math.min(prev.startY, currentY);
            const boxRight = Math.max(prev.startX, currentX);
            const boxBottom = Math.max(prev.startY, currentY);

            const previewIds = [];
            cardRefs.current.forEach((el, id) => {
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.left < boxRight && rect.right > boxLeft &&
                        rect.top < boxBottom && rect.bottom > boxTop) {
                        previewIds.push(id);
                    }
                }
            });

            setBoxSelectPreviewIds(previewIds);
            boxSelectPreviewRef.current = previewIds; // Keep ref in sync
            return prev;
        });
    };

    const handleBoxSelectUp = (e) => {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleBoxSelectMove);
        document.removeEventListener('mouseup', handleBoxSelectUp);

        // Commit the preview selection from ref (state might be stale in closure)
        setSelectedIds(boxSelectPreviewRef.current);
        setBoxSelectPreviewIds([]);
        boxSelectPreviewRef.current = [];
        setBoxSelectState(null);
    };

    // ----- Card Drag & Selection Logic -----


    // ----- Card Drag & Selection Logic (Refactored) -----

    const handleCardMouseDown = (e, id) => {
        // e is React synthetic event, but we need native for performance
        if (e.button !== 0) return; // Left click only

        let newSelection = [...selectedIdsRef.current];

        if (e.shiftKey) {
            if (newSelection.includes(id)) {
                newSelection = newSelection.filter(sid => sid !== id);
            } else {
                newSelection.push(id);
            }
        } else {
            // If dragging something NOT in current selection, select ONLY that thing.
            if (!newSelection.includes(id)) {
                newSelection = [id];
            }
            // else: dragging something ALREADY selected -> keep selection as is so we can drag the group
        }

        // Optimistically update selection state for UI
        setSelectedIds(newSelection);
        selectedIdsRef.current = newSelection; // Sync ref immediately for drag logic

        // Initialize Drag State
        const dragInfo = {
            startX: e.clientX,
            startY: e.clientY,
            targets: {}
        };

        const zoom = viewStateRef.current.zoom;

        // Prepare targets
        newSelection.forEach(selId => {
            const el = cardRefs.current.get(selId);
            if (el) {
                // Find initial object pos (logic from render phase)
                // We need to know the Model Position (x,y) to calculate delta
                // We can fetch it from documents or gapNodes
                let modelX = 0, modelY = 0;

                // Gap Node?
                const gap = gapNodes.find(n => n.id === selId);
                if (gap) {
                    modelX = gap.x;
                    modelY = gap.y;
                } else {
                    // Document?
                    const doc = documents.find(d => d._id === selId);
                    if (doc) {
                        modelX = doc.x;
                        modelY = doc.y;
                    }
                }

                // Make sure we have a reference to the initial transform or style
                // We will use transform translate to move them visually
                el.style.transition = 'none'; // Disable transition during drag
                const originalZIndex = el.style.zIndex;
                el.style.zIndex = 1000; // Bring to front

                dragInfo.targets[selId] = {
                    el,
                    modelX,
                    modelY,
                    originalZIndex
                };
            }
        });

        dragStateRef.current = dragInfo;

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        document.addEventListener('mousemove', handleCardMouseMove);
        document.addEventListener('mouseup', handleCardMouseUp);
    };

    const handleCardMouseMove = (e) => {
        if (!dragStateRef.current) return;

        const { startX, startY, targets } = dragStateRef.current;
        const zoom = viewStateRef.current.zoom;

        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;

        // Apply visual transform to all targets
        Object.values(targets).forEach(({ el }) => {
            el.style.transform = `translate(${dx}px, ${dy}px)`;
        });
    };

    const handleCardMouseUp = (e) => {
        if (!dragStateRef.current) return;

        const { startX, startY, targets } = dragStateRef.current;
        const zoom = viewStateRef.current.zoom;

        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;

        // Cleanup DOM overrides
        Object.values(targets).forEach(({ el, originalZIndex }) => {
            el.style.transform = ''; // Remove temp transform
            el.style.transition = ''; // Restore transitions
            el.style.zIndex = '';
        });

        // 2. Commit final positions
        if (dx !== 0 || dy !== 0) {
            const updates = {};
            Object.keys(targets).forEach(id => {
                const target = targets[id];
                updates[id] = {
                    x: target.modelX + dx,
                    y: target.modelY + dy
                };
            });

            if (onUpdatePositions) {
                onUpdatePositions(updates);
            }
        } else {
            // Was a click, not a drag. 
            // Logic for simple click on card already handled by mousedown mostly, 
            // but if we need "selection clearing" logic on simple click it goes here.
            // (Not needed for now as mousedown handles selection logic nicely).
        }

        dragStateRef.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleCardMouseMove);
        document.removeEventListener('mouseup', handleCardMouseUp);
    };

    // Calculate drag offset for rendering


    return (
        <div ref={canvasRef} style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#0f172a',
            position: 'relative',
            cursor: backdropToggleMode ? 'crosshair' : (isPanning ? 'grabbing' : 'default')
        }}
            onWheel={handleWheel}
            onMouseDown={(e) => {
                if (backdropToggleMode) {
                    setBackdropMouseDown(true);
                    return;
                }
                handlePanMouseDown(e);
            }}
            onMouseUp={() => {
                if (backdropToggleMode) {
                    setBackdropMouseDown(false);
                }
            }}
            onMouseLeave={() => {
                if (backdropToggleMode) {
                    setBackdropMouseDown(false);
                }
            }}
            onContextMenu={(e) => {
                // Only show canvas context menu if right-clicking on empty canvas (not on a document card)
                // Check if the click is NOT on a document card by looking for data-draggable-card attribute
                const isOnCard = e.target.closest('[data-draggable-card]');
                if (!isOnCard) {
                    e.preventDefault();
                    if (backdropToggleMode) {
                        setBackdropToggleMode(false);
                        return;
                    }
                    setCanvasContextMenu({ x: e.clientX, y: e.clientY });
                }
            }}
        >
            {/* Grid Pattern that moves with Pan / Scale */}
            <div data-canvas-grid style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.05) 1px, transparent 0)',
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`, // Scale grid
                backgroundPosition: `${pan.x}px ${pan.y}px`,    // Move grid
                pointerEvents: 'none'
            }} />

            {/* Box Selection Rectangle */}
            {boxSelectState && (
                <div style={{
                    position: 'fixed',
                    left: Math.min(boxSelectState.startX, boxSelectState.currentX),
                    top: Math.min(boxSelectState.startY, boxSelectState.currentY),
                    width: Math.abs(boxSelectState.currentX - boxSelectState.startX),
                    height: Math.abs(boxSelectState.currentY - boxSelectState.startY),
                    border: '2px dashed var(--primary)',
                    background: 'rgba(96, 165, 250, 0.1)',
                    pointerEvents: 'none',
                    zIndex: 9999
                }} />
            )}

            {/* Content Container */}
            <div style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none' // Let events pass through to specific children
            }}>
                {/* Make sure children have pointer events */}
                <div style={{ pointerEvents: 'auto' }}>
                    <ConnectionContext.Provider value={contextValue}>
                        {documents.length === 0 && (
                            <div style={{
                                position: 'absolute',
                                left: (window.innerWidth / 2 - pan.x) / zoom,
                                top: (window.innerHeight / 2 - pan.y) / zoom,
                                transform: 'translate(-50%, -50%)',
                                textAlign: 'center',
                                color: '#475569',
                                pointerEvents: 'none'
                            }}>
                                <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>⧉</div>
                                <h3>Canvas is empty</h3>
                                <p style={{ fontSize: '0.9rem' }}>Send documents here from the collection view</p>
                            </div>
                        )}

                        {documents.map(doc => {
                            const isSelected = selectedIds.includes(doc._id);


                            return (
                                <DraggableCard
                                    key={doc._id}
                                    doc={doc}
                                    zoom={zoom}
                                    onConnect={onConnect}
                                    onFlagClick={handleFlagClick}
                                    onClone={onClone}
                                    onDelete={(id) => {
                                        if (selectedIds.includes(id)) {
                                            onDeleteMany && onDeleteMany(selectedIds);
                                            setSelectedIds([]);
                                        } else {
                                            onDelete(id);
                                        }
                                    }}
                                    onDateClick={handleDateClick}
                                    onToggleExpand={onToggleExpand}
                                    isSelected={isSelected || boxSelectPreviewIds.includes(doc._id)}
                                    onMouseDown={handleCardMouseDown}
                                    registerRef={(id, el) => {
                                        if (el) {
                                            cardRefs.current.set(id, el);
                                        } else {
                                            cardRefs.current.delete(id);
                                        }
                                    }}
                                    backdropToggleMode={backdropToggleMode}
                                    backdropMouseDown={backdropMouseDown}
                                    onToggleBackdrop={onToggleBackdrop}
                                    onUpdateData={onUpdateData}
                                    onUpdateDimensions={onUpdateDimensions}
                                    onContextMenu={handleNodeContextMenu}
                                />
                            );
                        })}

                        {gapNodes.map(node => {
                            let liveText = node.text;
                            if (node.sourceId && node.targetId) {
                                const startDate = getDateFromStableId(docMap, node.sourceId);
                                const endDate = getDateFromStableId(docMap, node.targetId);
                                if (startDate && endDate) {
                                    liveText = calculateTimeGap(startDate, endDate);
                                }
                            }
                            return (
                                <DraggableGapNode
                                    key={node.id}
                                    node={node}
                                    text={liveText}
                                    zoom={zoom}
                                    onUpdatePosition={onUpdateGapNodePosition}

                                    onDelete={onDeleteGapNode}
                                    isSelected={selectedIds.includes(node.id) || boxSelectPreviewIds.includes(node.id)}
                                    onMouseDown={handleCardMouseDown}
                                    onContextMenu={handleNodeContextMenu}
                                    registerRef={(id, el) => {
                                        if (el) {
                                            cardRefs.current.set(id, el);
                                        } else {
                                            cardRefs.current.delete(id);
                                        }
                                    }}
                                />
                            );
                        })}

                        {pendingCustomCard && (
                            <div style={{
                                position: 'absolute',
                                left: pendingCustomCard.x,
                                top: pendingCustomCard.y,
                                zIndex: 1000,
                                background: 'var(--panel-bg)',
                                borderRadius: '8px',
                                border: '2px solid var(--primary)',
                                padding: '1rem',
                                width: '350px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                                pointerEvents: 'auto'
                            }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, marginBottom: '4px' }}>
                                    NEW CUSTOM DOCUMENT
                                </div>
                                <textarea
                                    autoFocus
                                    value={pendingCustomCard.data}
                                    onChange={(e) => setPendingCustomCard({ ...pendingCustomCard, data: e.target.value })}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') setPendingCustomCard(null);
                                        // Prevents panned/zoomed canvas from taking keyboard events while typing
                                        e.stopPropagation();
                                    }}
                                    style={{
                                        width: '100%',
                                        height: '200px',
                                        background: 'rgba(0,0,0,0.2)',
                                        border: '1px solid var(--glass-border)',
                                        borderRadius: '4px',
                                        color: '#e2e8f0',
                                        fontFamily: 'monospace',
                                        fontSize: '0.85rem',
                                        padding: '8px',
                                        outline: 'none',
                                        resize: 'vertical'
                                    }}
                                />
                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                    <button
                                        onClick={() => setPendingCustomCard(null)}
                                        style={{
                                            padding: '6px 12px',
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid var(--glass-border)',
                                            borderRadius: '4px',
                                            color: '#94a3b8',
                                            cursor: 'pointer'
                                        }}
                                    >Cancel</button>
                                    <button
                                        onClick={() => {
                                            try {
                                                const parsed = JSON.parse(pendingCustomCard.data);
                                                onAddCustomDocument && onAddCustomDocument(parsed, pendingCustomCard.x, pendingCustomCard.y);
                                                setPendingCustomCard(null);
                                            } catch (err) {
                                                alert("Invalid JSON: " + err.message);
                                            }
                                        }}
                                        style={{
                                            padding: '6px 12px',
                                            background: 'var(--primary)',
                                            border: 'none',
                                            borderRadius: '4px',
                                            color: 'white',
                                            cursor: 'pointer',
                                            fontWeight: 600
                                        }}
                                    >Create</button>
                                </div>
                            </div>
                        )}
                    </ConnectionContext.Provider>
                </div>
            </div>

            {/* Connection Lines Layer */}
            <ConnectionLayer
                gapNodes={gapNodes}
                arrowDirection={arrowDirection}
                nodeRegistry={nodeRegistry}
                zoom={zoom}
                pan={pan}
                canvasRef={canvasRef}
                documents={documents}
                idColorOverrides={idColorOverrides}
                showBackdroppedArrows={showBackdroppedArrows}
                showAllArrows={showAllArrows}
                cardRefs={cardRefs}
            />

            {/* Date Selection Indicators */}
            {dateSelection && (
                <div style={{
                    position: 'fixed',
                    left: dateSelection.ref.getBoundingClientRect().left + dateSelection.ref.getBoundingClientRect().width / 2,
                    top: dateSelection.ref.getBoundingClientRect().top - 25,
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    pointerEvents: 'none',
                    zIndex: 2000,
                    transform: 'translate(-50%, 0)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                }}>
                    Start Date
                </div>
            )}

            {/* Document Context Menu */}
            {cardContextMenu && (
                <div style={{
                    position: 'fixed',
                    left: cardContextMenu.x,
                    top: cardContextMenu.y,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '6px',
                    padding: '4px',
                    zIndex: 9999,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    minWidth: '150px'
                }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <button
                        disabled={selectedIds.length < 2}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (selectedIds.length < 2) return;

                            // 1. Collect all items (Documents + GapNodes)
                            const selectedDocs = documents.filter(d => selectedIds.includes(d._id));
                            const selectedGapNodes = gapNodes.filter(n => selectedIds.includes(n.id));

                            const allItems = [
                                ...selectedDocs.map(d => ({
                                    id: d._id,
                                    x: d.x,
                                    y: d.y,
                                    width: d.width || 350,
                                    type: 'doc'
                                })),
                                ...selectedGapNodes.map(n => {
                                    // GapNodes don't have explicit width in data, we estimate or measure
                                    // Using a fixed estimate for now as refs might be tricky to access synchronously here without a map
                                    // or we could look up in cardRefs if we want perfection.
                                    let width = 150;
                                    const el = cardRefs.current.get(n.id);
                                    if (el) width = el.offsetWidth;

                                    return {
                                        id: n.id,
                                        x: n.x,
                                        y: n.y,
                                        width,
                                        type: 'gap'
                                    };
                                })
                            ];

                            if (allItems.length < 2) return;

                            // 2. Sort by X position
                            allItems.sort((a, b) => a.x - b.x);

                            // 3. Calculate new positions
                            const startY = allItems[0].y;
                            let currentX = allItems[0].x;
                            const updates = {};

                            allItems.forEach((item) => {
                                updates[item.id] = {
                                    x: currentX,
                                    y: startY
                                };

                                // Prepare X for next item
                                currentX += item.width + 50;
                            });

                            onUpdatePositions && onUpdatePositions(updates);
                            setCardContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: selectedIds.length < 2 ? '#64748b' : '#e2e8f0',
                            cursor: selectedIds.length < 2 ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => {
                            if (selectedIds.length >= 2) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                        }}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <span style={{ marginRight: '8px' }}>↔</span>
                        Rearrange Horizontally
                    </button>
                    <button
                        disabled={selectedIds.length < 2}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (selectedIds.length < 2) return;

                            // 1. Collect all items
                            const selectedDocs = documents.filter(d => selectedIds.includes(d._id));
                            const selectedGapNodes = gapNodes.filter(n => selectedIds.includes(n.id));

                            const allItems = [
                                ...selectedDocs.map(d => ({
                                    id: d._id,
                                    x: d.x,
                                    y: d.y,
                                    height: d.height || 100, // Default min height
                                    type: 'doc'
                                })),
                                ...selectedGapNodes.map(n => ({
                                    id: n.id,
                                    x: n.x,
                                    y: n.y,
                                    height: 40, // Estimated height for gap node
                                    type: 'gap'
                                }))
                            ];

                            if (allItems.length < 2) return;

                            // 2. Sort by Y position
                            allItems.sort((a, b) => a.y - b.y);

                            // 3. Calculate new positions
                            const startX = allItems[0].x;
                            let currentY = allItems[0].y;
                            const updates = {};

                            allItems.forEach((item) => {
                                // For docs, we might need actual current height from DOM if avail, 
                                // but state height is safer if accurate. 
                                // To be precise, let's try to get DOM height if possible, else fallback.
                                let itemHeight = item.height;
                                const el = cardRefs.current.get(item.id);
                                if (el) {
                                    itemHeight = el.offsetHeight;
                                }

                                updates[item.id] = {
                                    x: startX,
                                    y: currentY
                                };

                                // Prepare Y for next item
                                currentY += itemHeight + 50;
                            });

                            onUpdatePositions && onUpdatePositions(updates);
                            setCardContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: selectedIds.length < 2 ? '#64748b' : '#e2e8f0',
                            cursor: selectedIds.length < 2 ? 'not-allowed' : 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => {
                            if (selectedIds.length >= 2) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                        }}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <span style={{ marginRight: '8px' }}>↕</span>
                        Arrange Vertically
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const idsToProcess = selectedIds.length > 0 ? selectedIds : [cardContextMenu.docId];
                            idsToProcess.forEach(id => onToggleBackdrop && onToggleBackdrop(id));
                            setCardContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <span style={{ marginRight: '8px' }}>👁</span>
                        Toggle Backdrop {selectedIds.length > 1 ? `(${selectedIds.length})` : ''}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const idsToProcess = selectedIds.length > 0 ? selectedIds : [cardContextMenu.docId];
                            idsToProcess.forEach(id => onClone && onClone(id));
                            setCardContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <span style={{ marginRight: '8px' }}>⎘</span>
                        Clone {selectedIds.length > 1 ? `(${selectedIds.length})` : ''}
                    </button>
                    <div style={{ height: '1px', background: 'var(--glass-border)', margin: '4px 0' }} />
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const idsToProcess = selectedIds.length > 0 ? selectedIds : [cardContextMenu.docId];
                            onDeleteMany && onDeleteMany(idsToProcess);
                            setCardContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        title="Delete"
                    >
                        <span style={{ marginRight: '8px' }}>✕</span>
                        Delete {selectedIds.length > 1 ? `(${selectedIds.length})` : ''}
                    </button>
                </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
                <div style={{
                    position: 'fixed',
                    left: contextMenu.x,
                    top: contextMenu.y,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '6px',
                    padding: '4px',
                    zIndex: 9999,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    minWidth: '150px'
                }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleMarkAsSource(contextMenu.collection, contextMenu.path);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        {markedSources.has(`${contextMenu.collection}:${contextMenu.path}`) ? 'Unmark as Source' : 'Mark as Source (act as _id)'}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleHighlight(contextMenu.collection, contextMenu.path);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        {highlightedFields.has(`${contextMenu.collection}:${contextMenu.path}`) ? '✗ Remove Highlight' : '★ Highlight Key-Value'}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleHoist(contextMenu.collection, contextMenu.path);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        {hoistedFields.has(`${contextMenu.collection}:${contextMenu.path}`) ? '↓ Unhoist' : '📌 Hoist to Top'}
                    </button>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.05)', margin: '4px 0' }} />
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const doc = docMap.get(contextMenu.docId);
                            if (doc) {
                                const value = getValueByPath(doc.data, contextMenu.path);
                                const text = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value);
                                navigator.clipboard.writeText(text);
                                showToast('Value copied to clipboard', 'info', 2000);
                            }
                            setContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        📋 Copy Value
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const doc = docMap.get(contextMenu.docId);
                            if (doc) {
                                const value = getValueByPath(doc.data, contextMenu.path);
                                const key = contextMenu.path.split('.').pop();
                                const valueText = typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value);
                                navigator.clipboard.writeText(`${key}: ${valueText}`);
                                showToast('Key and Value copied to clipboard', 'info', 2000);
                            }
                            setContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        📝 Copy Key + Value
                    </button>
                </div>
            )}

            {/* Canvas Context Menu (for right-click on empty canvas) */}
            {canvasContextMenu && (
                <div style={{
                    position: 'fixed',
                    left: canvasContextMenu.x,
                    top: canvasContextMenu.y,
                    background: 'var(--panel-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '6px',
                    padding: '4px',
                    zIndex: 9999,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    minWidth: '150px'
                }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setBackdropToggleMode(true);
                            setCanvasContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        👁 Toggle Backdrop
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const canvasRect = canvasRef.current.getBoundingClientRect();
                            const x = (canvasContextMenu.x - canvasRect.left - pan.x) / zoom;
                            const y = (canvasContextMenu.y - canvasRect.top - pan.y) / zoom;
                            setPendingCustomCard({
                                x,
                                y,
                                data: JSON.stringify({ _id: `custom_${Math.random().toString(36).substr(2, 5)}` }, null, 2)
                            });
                            setCanvasContextMenu(null);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            color: '#e2e8f0',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontSize: '0.9rem',
                            borderRadius: '4px',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        📝 Custom Document
                    </button>
                </div>
            )}

            {/* HUD / Controls */}
            <div style={{
                position: 'absolute',
                bottom: '20px',
                right: '20px',
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)',
                padding: '0.5rem',
                borderRadius: '8px',
                color: '#cbd5e1',
                fontSize: '0.8rem',
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
                border: '1px solid var(--glass-border)',
                pointerEvents: 'auto'
            }}
                onMouseDown={e => e.stopPropagation()} // Prevent pan starting from HUD
            >
                <button
                    onClick={onUndo}
                    disabled={!canUndo}
                    title="Undo (Ctrl+Z)"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: canUndo ? '#e2e8f0' : '#475569',
                        cursor: canUndo ? 'pointer' : 'not-allowed',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    ↩️
                </button>
                <button
                    onClick={onRedo}
                    disabled={!canRedo}
                    title="Redo (Ctrl+Shift+Z)"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: canRedo ? '#e2e8f0' : '#475569',
                        cursor: canRedo ? 'pointer' : 'not-allowed',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    ↪️
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button onClick={() => onViewStateChange(prev => ({ ...prev, zoom: Math.max(prev.zoom - 0.1, 0.1) }))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>-</button>
                <span style={{ minWidth: '40px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => onViewStateChange(prev => ({ ...prev, zoom: Math.min(prev.zoom + 0.1, 5) }))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>+</button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={() => onConnect()}
                    title="Connect New Document"
                    style={{ background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}
                >
                    <span style={{ fontSize: '0.9rem' }}>+</span>
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={() => onArrowDirectionChange && onArrowDirectionChange(prev => prev === 'forward' ? 'reverse' : 'forward')}
                    title={`Toggle Arrow Direction (${arrowDirection})`}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: arrowDirection === 'forward' ? '#94a3b8' : '#fbbf24',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    ⇄
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={() => onShowBackdroppedArrowsChange && onShowBackdroppedArrowsChange(prev => !prev)}
                    title={showBackdroppedArrows ? "Hide Backdropped Arrows" : "Show Backdropped Arrows"}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: showBackdroppedArrows ? '#94a3b8' : '#64748b',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center',
                        position: 'relative'
                    }}
                >
                    👁️
                    {!showBackdroppedArrows && (
                        <div style={{
                            position: 'absolute',
                            width: '100%',
                            height: '2px',
                            background: '#f87171',
                            transform: 'rotate(45deg)',
                            top: '50%',
                            left: 0
                        }} />
                    )}
                </button>
                <button
                    onClick={() => onShowAllArrowsChange && onShowAllArrowsChange(prev => !prev)}
                    title={showAllArrows ? "Hide All Arrows" : "Show All Arrows"}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: showAllArrows ? '#94a3b8' : '#ef4444',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    {showAllArrows ? '⤡' : '✕'}
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button onClick={() => { onViewStateChange({ pan: { x: 0, y: 0 }, zoom: 1 }); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>Reset</button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                {currentSaveName && (
                    <span style={{
                        color: '#94a3b8',
                        fontSize: '0.75rem',
                        padding: '2px 6px',
                        background: 'rgba(96, 165, 250, 0.15)',
                        border: '1px solid rgba(96, 165, 250, 0.3)',
                        borderRadius: '4px',
                        maxWidth: '120px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                    }} title={`Current save: ${currentSaveName}`}>
                        📁 {currentSaveName}
                    </span>
                )}
                <button
                    onClick={onSave}
                    title={currentSaveName ? `Save to "${currentSaveName}"` : "Save Canvas State"}
                    style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    💾
                </button>
                <button
                    onClick={onSaveAs}
                    title="Save As New..."
                    style={{ background: 'transparent', border: 'none', color: '#a78bfa', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    ➕
                </button>
                <button
                    onClick={onLoad}
                    title="Load Canvas State"
                    style={{ background: 'transparent', border: 'none', color: '#4ade80', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    📂
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={onExport}
                    title="Export to JSON"
                    style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    📤
                </button>
                <button
                    onClick={onImport}
                    title="Import from JSON"
                    style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    📥
                </button>
            </div>
        </div >
    );
};

const calculateTimeGap = (startDate, endDate) => {
    let start = new Date(startDate);
    let end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return "Invalid Date";
    }

    let sign = '+';

    if (start > end) {
        sign = '-';
        [start, end] = [end, start];
    }

    // Clone start simple
    let temp = new Date(start);

    let years = 0;
    while (true) {
        let test = new Date(temp);
        test.setFullYear(test.getFullYear() + 1);
        if (test > end) break;
        temp = test;
        years++;
    }

    let months = 0;
    while (true) {
        let test = new Date(temp);
        test.setMonth(test.getMonth() + 1);
        // Handle month overflow (e.g. Jan 31 + 1 mo -> Mar 3. We want last day of Feb)
        if (test.getDate() !== temp.getDate()) {
            test.setDate(0);
        }

        if (test > end) break;
        temp = test;
        months++;
    }

    let days = 0;
    while (true) {
        let test = new Date(temp);
        test.setDate(test.getDate() + 1);
        if (test > end) break;
        temp = test;
        days++;
    }

    let diffMs = end - temp;
    let hours = Math.floor(diffMs / (1000 * 60 * 60));
    diffMs -= hours * 1000 * 60 * 60;
    let minutes = Math.floor(diffMs / (1000 * 60));
    diffMs -= minutes * 1000 * 60;
    let seconds = Math.floor(diffMs / 1000);
    diffMs -= seconds * 1000;
    let milliseconds = diffMs;

    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    if (milliseconds > 0 || parts.length === 0) parts.push(`${milliseconds}ms`);

    const prefix = sign === '+' ? 'After:' : 'Before:';
    return `${prefix} ${parts.join(' ')}`;
};

export default Canvas;
