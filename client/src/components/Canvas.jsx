
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

const getDocIdFromStableId = (stableId) => {
    if (!stableId) return null;
    const match = stableId.match(/^date-([^-]+)-/);
    return match ? match[1] : stableId;
};

// Managed separately to avoid Canvas re-rendering on every frame
const ConnectionLayer = memo(({ gapNodes, diffNodes = [], arrowDirection, nodeRegistry, zoom, pan, isPanning = false, hideArrowsWhilePanning = false, canvasRef, documents, idColorOverrides = {}, showBackdroppedArrows = true, showAllArrows = true, cardRefs }) => {
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
    const lastUpdateTimeRef = useRef(0);
    const panSettleTimeRef = useRef(0); // Track when panning stopped for settle delay
    const wasPanningRef = useRef(false);
    const THROTTLE_MS = 32; // ~30fps when idle
    const PAN_SETTLE_MS = 100; // Delay after panning before computing lines

    useEffect(() => {
        const updateLines = () => {
            // Track panning state transitions for settle delay
            // Only skip during panning if hideArrowsWhilePanning is enabled
            if (isPanning && hideArrowsWhilePanning) {
                wasPanningRef.current = true;
                frameRef.current = requestAnimationFrame(updateLines);
                return;
            } else if (wasPanningRef.current && !isPanning) {
                // Just stopped panning - record time and start settle period
                wasPanningRef.current = false;
                panSettleTimeRef.current = performance.now();
            }

            // Skip updates during settle period after panning (only if we were hiding)
            const timeSincePanStop = performance.now() - panSettleTimeRef.current;
            if (panSettleTimeRef.current > 0 && timeSincePanStop < PAN_SETTLE_MS && hideArrowsWhilePanning) {
                frameRef.current = requestAnimationFrame(updateLines);
                return;
            }

            // Throttle updates to reduce CPU usage
            const now = performance.now();
            if (now - lastUpdateTimeRef.current < THROTTLE_MS) {
                frameRef.current = requestAnimationFrame(updateLines);
                return;
            }
            lastUpdateTimeRef.current = now;

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

            // PERF LOG: Track line computation time
            const lineComputeStart = performance.now();

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

            // Helper to check if a node's parent card is dimmed - optimized to avoid expensive DOM queries
            const isNodeDimmed = (nodeRef) => {
                const cardEl = nodeRef.closest('[data-draggable-card]');
                if (!cardEl) return false;
                // Use the data-doc-id attribute directly instead of querying DOM
                const docId = cardEl.getAttribute('data-doc-id');
                return docId && dimmedDocIds.has(docId);
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
                                color: liveText.startsWith('After:') ? '#4ade80' : '#f87171',
                                dimmed: dimmedDocIds.has(getDocIdFromStableId(node.sourceId)) || node.dimmed
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
                                color: liveText.startsWith('After:') ? '#4ade80' : '#f87171',
                                dimmed: dimmedDocIds.has(getDocIdFromStableId(node.targetId)) || node.dimmed
                            });
                        }
                    }
                });

                // 3. Diff Node Connections
                diffNodes.forEach(node => {
                    // Get diff node position from DOM or fallback to model
                    let diffScreenX, diffScreenY;
                    const diffEl = cardRefs?.current?.get(node.id);
                    if (diffEl) {
                        const rect = diffEl.getBoundingClientRect();
                        diffScreenX = rect.left - canvasRect.left + rect.width / 2;
                        diffScreenY = rect.top - canvasRect.top + rect.height / 2;
                    } else {
                        diffScreenX = node.x * zoom + pan.x;
                        diffScreenY = node.y * zoom + pan.y;
                    }

                    // Source Document -> Diff Node
                    const sourceDocEl = cardRefs?.current?.get(node.sourceDocId);
                    if (sourceDocEl) {
                        const sourceRect = sourceDocEl.getBoundingClientRect();
                        if (sourceRect.width > 0) {
                            const sourcePos = getCanvasCoords(sourceRect, 'right');

                            newLines.push({
                                id: `${node.id}-source`,
                                x1: sourcePos.x,
                                y1: sourcePos.y,
                                x2: diffScreenX,
                                y2: diffScreenY,
                                color: '#f87171', // Red for source (old)
                                dimmed: dimmedDocIds.has(node.sourceDocId) || node.dimmed,
                                isDiff: true
                            });
                        }
                    }

                    // Diff Node -> Target Document
                    const targetDocEl = cardRefs?.current?.get(node.targetDocId);
                    if (targetDocEl) {
                        const targetRect = targetDocEl.getBoundingClientRect();
                        if (targetRect.width > 0) {
                            const targetPos = getCanvasCoords(targetRect, 'left');

                            newLines.push({
                                id: `${node.id}-target`,
                                x1: diffScreenX,
                                y1: diffScreenY,
                                x2: targetPos.x,
                                y2: targetPos.y,
                                color: '#4ade80', // Green for target (new)
                                dimmed: dimmedDocIds.has(node.targetDocId) || node.dimmed,
                                isDiff: true
                            });
                        }
                    }
                });
            }

            // PERF LOG: Warn if line computation takes too long
            const lineComputeDuration = performance.now() - lineComputeStart;
            if (lineComputeDuration > 16) {
                console.warn(`[PERF] ConnectionLayer updateLines took ${lineComputeDuration.toFixed(1)}ms (${newLines.length} lines, ${nodes.length} nodes)`);
            }

            setLines(newLines);
            frameRef.current = requestAnimationFrame(updateLines);
        };

        updateLines();
        return () => cancelAnimationFrame(frameRef.current);
    }, [gapNodes, diffNodes, arrowDirection, zoom, pan, nodeRegistry, canvasRef, documents, dimmedDocIds, idColorOverrides, showAllArrows, showBackdroppedArrows, isPanning, hideArrowsWhilePanning]);

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
                        strokeWidth={2 * zoom}
                        strokeOpacity={line.dimmed ? (showBackdroppedArrows ? 0.1 : 0) : 0.6}
                        markerEnd={markerUrl}
                        style={{ transition: 'stroke-opacity 0.2s' }}
                    />
                );
            })}
        </svg>
    );
});

// Helper to hide arrows during panning (wraps ConnectionLayer)
const ConnectionLayerWrapper = memo(({ isPanning, hideArrowsWhilePanning, ...props }) => {
    // Hide completely during panning if the toggle is enabled
    if (isPanning && hideArrowsWhilePanning) {
        return null;
    }
    return <ConnectionLayer isPanning={isPanning} hideArrowsWhilePanning={hideArrowsWhilePanning} {...props} />;
});

const DraggableCard = React.memo(({ doc, zoom, onConnect, onQuickConnect, connectionHistoryVersion, onFlagClick, onClone, onDelete, onDateClick, onToggleExpand, onExpandAll, onCollapseAll, isSelected, onMouseDown, dragOffset, registerRef, backdropToggleMode, backdropMouseDown, onToggleBackdrop, onUpdateData, onUpdateDimensions, onContextMenu }) => {
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
                cursor: backdropToggleMode ? 'crosshair' : undefined,
                // Performance: isolate layout/paint recalculations to this element
                contain: 'layout style paint'
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
                        title="Expand All"
                        onMouseDown={(e) => { e.stopPropagation(); }}
                        onClick={(e) => { e.stopPropagation(); onExpandAll && onExpandAll(doc._id); }}
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
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>&gt;</span>
                    </button>
                    <button
                        title="Collapse All"
                        onMouseDown={(e) => { e.stopPropagation(); }}
                        onClick={(e) => { e.stopPropagation(); onCollapseAll && onCollapseAll(doc._id); }}
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
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>v</span>
                    </button>
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
                        onQuickConnect={onQuickConnect}
                        connectionHistoryVersion={connectionHistoryVersion}
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
            data-centered="true"
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

// Diff utility functions
const computeCharDiff = (oldStr, newStr) => {
    const old = String(oldStr ?? '');
    const new_ = String(newStr ?? '');

    if (old === new_) return { prefix: old, oldMiddle: '', newMiddle: '', suffix: '' };

    // Find common prefix
    let prefixLen = 0;
    while (prefixLen < old.length && prefixLen < new_.length && old[prefixLen] === new_[prefixLen]) {
        prefixLen++;
    }

    // Find common suffix (not overlapping with prefix)
    let suffixLen = 0;
    while (
        suffixLen < old.length - prefixLen &&
        suffixLen < new_.length - prefixLen &&
        old[old.length - 1 - suffixLen] === new_[new_.length - 1 - suffixLen]
    ) {
        suffixLen++;
    }

    return {
        prefix: old.slice(0, prefixLen),
        oldMiddle: old.slice(prefixLen, old.length - suffixLen),
        newMiddle: new_.slice(prefixLen, new_.length - suffixLen),
        suffix: old.slice(old.length - suffixLen)
    };
};

const computeDocDiff = (obj1, obj2, path = '') => {
    const diffs = [];
    const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);

    for (const key of allKeys) {
        const val1 = obj1?.[key];
        const val2 = obj2?.[key];
        const fullPath = path ? `${path}.${key}` : key;

        const hasKey1 = obj1 && key in obj1;
        const hasKey2 = obj2 && key in obj2;

        if (!hasKey1) {
            diffs.push({ path: fullPath, type: 'added', value: val2 });
        } else if (!hasKey2) {
            diffs.push({ path: fullPath, type: 'removed', value: val1 });
        } else if (val1 !== null && val2 !== null && typeof val1 === 'object' && typeof val2 === 'object' && !Array.isArray(val1) && !Array.isArray(val2)) {
            // Both are objects - recurse
            diffs.push(...computeDocDiff(val1, val2, fullPath));
        } else if (Array.isArray(val1) && Array.isArray(val2)) {
            // Compare arrays element by element
            const maxLen = Math.max(val1.length, val2.length);
            for (let i = 0; i < maxLen; i++) {
                const elemPath = `${fullPath}[${i}]`;
                if (i >= val1.length) {
                    diffs.push({ path: elemPath, type: 'added', value: val2[i] });
                } else if (i >= val2.length) {
                    diffs.push({ path: elemPath, type: 'removed', value: val1[i] });
                } else if (typeof val1[i] === 'object' && typeof val2[i] === 'object' && val1[i] !== null && val2[i] !== null) {
                    diffs.push(...computeDocDiff(val1[i], val2[i], elemPath));
                } else if (val1[i] !== val2[i]) {
                    diffs.push({ path: elemPath, type: 'changed', oldValue: val1[i], newValue: val2[i] });
                }
            }
        } else if (val1 !== val2) {
            diffs.push({ path: fullPath, type: 'changed', oldValue: val1, newValue: val2 });
        }
    }
    return diffs;
};

// Renders a value with character-level diff highlighting
const DiffValue = ({ value, type, oldValue, newValue }) => {
    const formatValue = (val) => {
        if (val === null) return 'null';
        if (val === undefined) return 'undefined';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
    };

    if (type === 'added') {
        return (
            <span style={{ background: 'rgba(74, 222, 128, 0.3)', color: '#4ade80', padding: '1px 4px', borderRadius: '2px' }}>
                {formatValue(value)}
            </span>
        );
    }

    if (type === 'removed') {
        return (
            <span style={{ background: 'rgba(248, 113, 113, 0.3)', color: '#f87171', padding: '1px 4px', borderRadius: '2px', textDecoration: 'line-through' }}>
                {formatValue(value)}
            </span>
        );
    }

    if (type === 'changed') {
        const oldFormatted = formatValue(oldValue);
        const newFormatted = formatValue(newValue);

        // Use character-level diff for strings
        if (typeof oldValue === 'string' && typeof newValue === 'string') {
            const { prefix, oldMiddle, newMiddle, suffix } = computeCharDiff(oldValue, newValue);
            return (
                <span>
                    <span style={{ color: '#94a3b8' }}>{prefix}</span>
                    {oldMiddle && <span style={{ background: '#f87171', color: '#0f172a', padding: '0 2px', borderRadius: '2px' }}>{oldMiddle}</span>}
                    {newMiddle && <span style={{ background: '#4ade80', color: '#0f172a', padding: '0 2px', borderRadius: '2px' }}>{newMiddle}</span>}
                    <span style={{ color: '#94a3b8' }}>{suffix}</span>
                </span>
            );
        }

        // For non-strings, show old → new
        return (
            <span>
                <span style={{ background: 'rgba(248, 113, 113, 0.3)', color: '#f87171', padding: '1px 4px', borderRadius: '2px', textDecoration: 'line-through' }}>
                    {oldFormatted}
                </span>
                <span style={{ color: '#64748b', margin: '0 4px' }}>→</span>
                <span style={{ background: 'rgba(74, 222, 128, 0.3)', color: '#4ade80', padding: '1px 4px', borderRadius: '2px' }}>
                    {newFormatted}
                </span>
            </span>
        );
    }

    return <span style={{ color: '#94a3b8' }}>{formatValue(value)}</span>;
};

const DraggableDiffNode = memo(({ node, sourceDoc, targetDoc, zoom, onDelete, isSelected, onMouseDown, registerRef, onContextMenu, onUpdateDiffNode }) => {
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

    // Handle Resize Logic
    useEffect(() => {
        if (!nodeRef.current) return;

        // Apply initial dimensions if they exist
        if (node.width) {
            nodeRef.current.style.width = `${node.width}px`;
        }
        if (node.height) {
            nodeRef.current.style.height = `${node.height}px`;
        }

        let timeout;
        const debouncedUpdate = (w, h) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                if (onUpdateDiffNode) {
                    onUpdateDiffNode(node.id, { width: w, height: h });
                }
            }, 500);
        };

        const ro = new ResizeObserver(entries => {
            for (let entry of entries) {
                const target = entry.target;
                const hasInlineWidth = target.style.width !== "";
                const hasInlineHeight = target.style.height !== "";

                const actualWidth = target.offsetWidth;
                const actualHeight = target.offsetHeight;

                const currentWidth = node.width;
                const currentHeight = node.height;

                let shouldUpdate = false;
                let updateWidth = currentWidth;
                let updateHeight = currentHeight;

                // Sync width if it differs (DiffNode has minWidth, so check diff)
                if (Math.abs(actualWidth - (currentWidth || 320)) > 3) {
                    shouldUpdate = true;
                    updateWidth = actualWidth;
                }

                if (hasInlineHeight && Math.abs(actualHeight - (currentHeight || 0)) > 3) {
                    shouldUpdate = true;
                    updateHeight = actualHeight;
                }

                if (shouldUpdate) {
                    debouncedUpdate(updateWidth, updateHeight);
                }
            }
        });

        ro.observe(nodeRef.current);
        return () => {
            ro.disconnect();
            clearTimeout(timeout);
        };
    }, [node.id, onUpdateDiffNode, node.width, node.height]);

    // Compute diff
    const diffs = useMemo(() => {
        if (!sourceDoc || !targetDoc) return [];
        return computeDocDiff(sourceDoc.data, targetDoc.data);
    }, [sourceDoc, targetDoc]);

    const getShortId = (id) => {
        if (!id) return '?';
        const str = String(id);
        return str.length > 8 ? str.slice(0, 4) + '…' + str.slice(-4) : str;
    };

    return (
        <div
            ref={nodeRef}
            onContextMenu={(e) => onContextMenu && onContextMenu(e, node.id)}
            onMouseDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                // Check if clicking resize handle (bottom-right)
                const isResizeHandle = e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;
                if (isResizeHandle) {
                    e.stopPropagation();
                    return;
                }

                e.stopPropagation();
                onMouseDown(e, node.id);
            }}
            style={{
                position: 'absolute',
                left: currentX,
                top: currentY,
                transform: 'translate(-50%, -50%)',
                background: '#1e293b',
                border: isSelected ? '2px solid var(--primary)' : '1px solid var(--glass-border)',
                borderRadius: '8px',
                padding: '0',
                minWidth: '320px',
                // Explicitly bind width/height if present, else let CSS handle mins/maxs
                width: node.width,
                height: node.height,
                // Remove max constraints when resizing is enabled/active
                maxWidth: node.width ? 'none' : '500px',
                maxHeight: node.height ? 'none' : '400px',
                resize: 'both',
                overflow: 'hidden',
                cursor: 'grab',
                zIndex: isSelected ? 2001 : 100,
                boxShadow: isSelected ? '0 0 0 3px var(--primary), 0 8px 16px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.3)',
                userSelect: 'none',
                display: 'flex',
                flexDirection: 'column',
                transition: 'box-shadow 0.2s, border 0.2s, opacity 0.2s, filter 0.2s',
                opacity: node.dimmed ? 0.3 : 1,
                filter: node.dimmed ? 'blur(1px) grayscale(50%)' : 'none',
            }}
            data-centered="true"
        >
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'rgba(0,0,0,0.2)',
                borderBottom: '1px solid var(--glass-border)',
                gap: '8px',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#94a3b8', overflow: 'hidden' }}>
                    <span style={{ color: '#f87171' }}>{getShortId(sourceDoc?.data?._id)}</span>
                    <span>↔</span>
                    <span style={{ color: '#4ade80' }}>{getShortId(targetDoc?.data?._id)}</span>
                </div>
                <button
                    onMouseDown={deleteHandler.onMouseDown}
                    onClick={deleteHandler.onClick}
                    style={{
                        background: 'rgba(0,0,0,0.2)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        fontSize: '0.75rem',
                        padding: 0,
                        flexShrink: 0
                    }}
                >
                    ✕
                </button>
            </div>

            {/* Content */}
            <div style={{
                padding: '8px 12px',
                overflowY: 'auto',
                flex: 1, // Take remaining space
                fontSize: '0.85rem'
            }}>
                {!sourceDoc || !targetDoc ? (
                    <div style={{ color: '#f87171', fontStyle: 'italic' }}>
                        Document not found
                    </div>
                ) : diffs.length === 0 ? (
                    <div style={{ color: '#4ade80', fontStyle: 'italic' }}>
                        No differences
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {diffs.map((diff, idx) => {
                            let dateGap = null;
                            if (diff.type === 'changed' && typeof diff.oldValue === 'string' && typeof diff.newValue === 'string') {
                                const d1 = new Date(diff.oldValue);
                                const d2 = new Date(diff.newValue);
                                // Heuristic: valid valid date and string length > 5 (avoids short numbers/strings)
                                if (!isNaN(d1.getTime()) && !isNaN(d2.getTime()) && diff.oldValue.length > 5 && diff.newValue.length > 5 && d1.getFullYear() > 1900 && d1.getFullYear() < 2200) {
                                    dateGap = calculateTimeGap(d1, d2);
                                }
                            }

                            return (
                                <div key={idx} style={{
                                    display: 'flex',
                                    gap: '8px',
                                    padding: '4px 6px',
                                    borderRadius: '4px',
                                    background: diff.type === 'added' ? 'rgba(74, 222, 128, 0.1)' :
                                        diff.type === 'removed' ? 'rgba(248, 113, 113, 0.1)' :
                                            'rgba(148, 163, 184, 0.1)',
                                    alignItems: 'flex-start'
                                }}>
                                    <span style={{
                                        color: diff.type === 'added' ? '#4ade80' :
                                            diff.type === 'removed' ? '#f87171' :
                                                '#94a3b8',
                                        fontWeight: 500,
                                        minWidth: '30%',
                                        wordBreak: 'break-word'
                                    }}>
                                        {diff.path}:
                                    </span>
                                    <span style={{ wordBreak: 'break-word', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <DiffValue
                                            type={diff.type}
                                            value={diff.value}
                                            oldValue={diff.oldValue}
                                            newValue={diff.newValue}
                                        />
                                        {dateGap && (
                                            <span style={{
                                                fontSize: '0.75rem',
                                                color: '#fbbf24',
                                                fontStyle: 'italic',
                                                marginTop: '2px'
                                            }}>
                                                Gap: {dateGap.replace(/^(After:|Before:)\s*/, '')} {dateGap.startsWith('After:') ? '(later)' : '(earlier)'}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
});

const DraggableTextNode = memo(({ node, zoom, onUpdatePosition, onDelete, onUpdateText, onUpdateSize, isSelected, onMouseDown, registerRef, onContextMenu }) => {
    const nodeRef = useRef(null);
    const [isEditing, setIsEditing] = useState(false);
    const [text, setText] = useState(node.text);
    const [editValue, setEditValue] = useState(node.text);
    const textareaRef = useRef(null);

    const currentX = node.x;
    const currentY = node.y;

    const deleteHandler = useDragAwareClick((e) => { e.stopPropagation(); onDelete(node.id); });

    useEffect(() => {
        setText(node.text);
        setEditValue(node.text);
    }, [node.text]);

    useEffect(() => {
        if (registerRef) {
            registerRef(node.id, nodeRef.current);
            return () => registerRef(node.id, null);
        }
    }, [node.id, registerRef]);

    useEffect(() => {
        if (!nodeRef.current || !onUpdateSize) return;

        // Apply initial dimensions if they exist
        if (node.width) {
            nodeRef.current.style.width = `${node.width}px`;
        }
        if (node.height) {
            nodeRef.current.style.height = `${node.height}px`;
        }

        let timeout;
        const debouncedUpdate = (w, h) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                onUpdateSize(node.id, { width: w, height: h });
            }, 300);
        };

        const ro = new ResizeObserver(entries => {
            for (let entry of entries) {
                const target = entry.target;
                const hasInlineWidth = target.style.width !== "";
                const hasInlineHeight = target.style.height !== "";

                const actualWidth = target.offsetWidth;
                const actualHeight = target.offsetHeight;

                const currentWidth = node.width;
                const currentHeight = node.height;

                let shouldUpdate = false;
                let updateWidth = currentWidth;
                let updateHeight = currentHeight;

                if (hasInlineWidth && Math.abs(actualWidth - (currentWidth || 0)) > 3) {
                    shouldUpdate = true;
                    updateWidth = actualWidth;
                }
                if (hasInlineHeight && Math.abs(actualHeight - (currentHeight || 0)) > 3) {
                    shouldUpdate = true;
                    updateHeight = actualHeight;
                }

                if (shouldUpdate) {
                    debouncedUpdate(updateWidth, updateHeight);
                }
            }
        });

        ro.observe(nodeRef.current);
        return () => {
            ro.disconnect();
            clearTimeout(timeout);
        };
    }, [node.id, node.width, node.height, onUpdateSize]);

    useEffect(() => {
        if (isEditing && textareaRef.current) {
            textareaRef.current.focus();
            // Auto-resize
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [isEditing, editValue]);

    const handleDoubleClick = (e) => {
        e.stopPropagation();
        setIsEditing(true);
        setEditValue(text);
    };

    const handleBlur = () => {
        setIsEditing(false);
        if (editValue !== node.text) {
            onUpdateText(node.id, editValue);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.ctrlKey) {
                e.target.blur();
            }
        }
        e.stopPropagation();
    };

    const handleWheel = (e) => {
        e.stopPropagation();
    };

    return (
        <div
            ref={nodeRef}
            onContextMenu={(e) => onContextMenu && onContextMenu(e, node.id)}
            onMouseDown={(e) => {
                if (isEditing) {
                    e.stopPropagation();
                    return;
                }
                e.stopPropagation();
                onMouseDown(e, node.id);
            }}
            onDoubleClick={handleDoubleClick}
            style={{
                position: 'absolute',
                left: currentX,
                top: currentY,
                transform: 'translate(-50%, -50%)',
                background: node.dimmed ? 'rgba(30, 41, 59, 0.5)' : '#1e293b',
                border: isSelected ? '2px solid var(--primary)' : '1px solid var(--glass-border)',
                color: '#e2e8f0',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                cursor: isEditing ? 'text' : 'grab',
                zIndex: isSelected ? 2001 : 100,
                boxShadow: isSelected ? '0 0 0 2px rgba(96, 165, 250, 0.2), 0 8px 16px rgba(0,0,0,0.4)' : '0 4px 6px rgba(0,0,0,0.2)',
                marginBottom: '8px',
                userSelect: isEditing ? 'text' : 'none',
                minWidth: '120px',
                minHeight: '60px',
                width: node.width,
                height: node.height,
                display: 'flex',
                transition: 'box-shadow 0.2s, border 0.2s, opacity 0.2s, filter 0.2s',
                opacity: node.dimmed ? 0.5 : 1,
                filter: node.dimmed ? 'blur(0.5px)' : 'none',
                resize: 'both',
                overflow: 'auto'
            }}
            data-centered="true"
        >
            {isEditing ? (
                <textarea
                    ref={textareaRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    onWheel={handleWheel}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'white',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        resize: 'none',
                        outline: 'none',
                        width: '100%',
                        height: '100%',
                        minWidth: '100%',
                        minHeight: '100%',
                        overflow: 'auto'
                    }}
                />
            ) : (
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {text}
                </div>
            )}

            {!isEditing && (
                <button
                    onMouseDown={deleteHandler.onMouseDown}
                    onClick={deleteHandler.onClick}
                    style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        background: '#ef4444',
                        border: '2px solid #0f172a',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'white',
                        fontSize: '0.7rem',
                        padding: 0,
                        opacity: isSelected ? 1 : 0,
                        transition: 'opacity 0.2s',
                        pointerEvents: isSelected ? 'auto' : 'none'
                    }}
                >
                    ✕
                </button>
            )}
        </div>
    );
});

const DraggableImageNode = memo(({ node, zoom, onUpdatePosition, onDelete, onUpdateImage, isSelected, onMouseDown, registerRef, onContextMenu }) => {
    const nodeRef = useRef(null);
    const fileInputRef = useRef(null);
    const isUploading = useRef(false);

    const currentX = node.x;
    const currentY = node.y;

    const deleteHandler = useDragAwareClick((e) => { e.stopPropagation(); onDelete(node.id); });

    useEffect(() => {
        if (registerRef) {
            registerRef(node.id, nodeRef.current);
            return () => registerRef(node.id, null);
        }
    }, [node.id, registerRef]);

    // Handle Image Upload & Compression
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        isUploading.current = true;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Compression Logic
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 1024;

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                const originalSizeMB = (file.size / 1024 / 1024).toFixed(2);

                // Base64 size is approx 1.33 * length, but let's just use string length approximation
                const compressedSizeMB = (compressedDataUrl.length * 0.75 / 1024 / 1024).toFixed(2);

                onUpdateImage(node.id, {
                    src: compressedDataUrl,
                    width: node.width || 300, // Default width
                    height: node.height || (300 * height / width), // Maintain aspect ratio
                    originalSize: originalSizeMB,
                    compressedSize: compressedSizeMB
                });

                isUploading.current = false;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    const handleUploadClick = useDragAwareClick((e) => {
        e.stopPropagation();
        if (fileInputRef.current) fileInputRef.current.click();
    });

    const backdropHandler = useDragAwareClick((e) => {
        // We'll need a toggle backdrop handler passed down, or use context menu
        e.stopPropagation();
    });

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
                width: node.width || 300,
                height: node.height || 'auto',
                transform: 'translate(-50%, -50%)', // Centered anchor
                background: node.src ? 'transparent' : '#1e293b',
                border: isSelected ? '2px solid var(--primary)' : (node.src ? 'none' : '1px solid var(--glass-border)'),
                borderRadius: '8px',
                cursor: 'grab',
                zIndex: isSelected ? 2001 : 100,
                boxShadow: isSelected ? '0 0 0 2px rgba(96, 165, 250, 0.2), 0 8px 16px rgba(0,0,0,0.4)' : (node.src ? 'none' : '0 4px 6px rgba(0,0,0,0.2)'),
                userSelect: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'box-shadow 0.2s, border 0.2s, opacity 0.2s, filter 0.2s',
                opacity: node.dimmed ? 0.3 : 1,
                filter: node.dimmed ? 'blur(1px) grayscale(50%)' : 'none',
                overflow: 'hidden',
                resize: node.src ? 'both' : 'none' // Allow resize only if image exists? Or always?
                // Actually regular div resize doesn't work well with absolute positioning + transform translate(-50%)
                // We typically need a handle or custom resize logic for centered nodes.
                // For now, let's rely on DraggableCard's ResizeObserver logic if we want to support verify resizing.
                // But DraggableCard uses resize: both style. 
            }}
            // We need to support resizing. DraggableCard implementation uses `resize: both` and ResizeObserver.
            // We can do the same here if we add `resize: both` and `overflow: hidden`.
            // However, transform translate(-50%, -50%) messes up CSS resize handles because they stay at the limit of the element,
            // but visual bounds shift.
            // DraggableCard uses left/top without translation for anchor?
            // Let's check DraggableCard. 
            // DraggableCard uses `left: currentX, top: currentY`.
            // DraggableGapNode uses `transform: translate(-50%, -50%)`.
            // TextNode uses `transform: translate(-50%, -50%)`.
            // If we want resize handles to work naturally, we might want top-left anchor or custom handles.
            // For simplicity, let's try `resize: both` but we might need to adjust logic later if handles are wonky.
            data-centered="true"
        >
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={handleFileChange}
            />

            {node.src ? (
                <>
                    <img
                        src={node.src}
                        alt="Node"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain', // or cover? contain is safer
                            pointerEvents: 'none'
                        }}
                    />
                    {/* Size Info Overlay */}
                    {isSelected && (
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: 'rgba(0,0,0,0.6)',
                            color: '#e2e8f0',
                            fontSize: '0.7rem',
                            padding: '4px',
                            textAlign: 'center'
                        }}>
                            {node.originalSize}MB ➔ {node.compressedSize}MB
                        </div>
                    )}
                </>
            ) : (
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '2rem', opacity: 0.5 }}>🖼️</span>
                    <button
                        onMouseDown={handleUploadClick.onMouseDown}
                        onClick={handleUploadClick.onClick}
                        style={{
                            background: 'var(--primary)',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Choose Image
                    </button>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center' }}>
                        Images are compressed &<br />saved locally
                    </div>
                </div>
            )}

            <button
                onMouseDown={deleteHandler.onMouseDown}
                onClick={deleteHandler.onClick}
                style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px', // Adjusted for inside container
                    background: '#ef4444',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '0.8rem',
                    padding: 0,
                    opacity: isSelected ? 1 : 0,
                    transition: 'opacity 0.2s',
                    pointerEvents: isSelected ? 'auto' : 'none',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
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
    onQuickConnect,
    connectionHistoryVersion,
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
    textNodes = [],
    onUpdateGapNodePosition,
    onAddGapNode,
    onDeleteGapNode,
    onAddTextNode,
    onUpdateTextNode,
    onUpdateTextNodeSize,
    onUpdateTextNodePosition,
    onDeleteTextNode,
    imageNodes = [],
    onAddImageNode,
    onUpdateImageNode,
    onUpdateImageNodePosition,
    onDeleteImageNode,
    diffNodes = [],
    onAddDiffNode,
    onUpdateDiffNodePosition,
    onUpdateDiffNode,
    onDeleteDiffNode,
    onToggleExpand,
    onExpandAll,
    onCollapseAll,
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
    canRedo,
    selectedIds,
    setSelectedIds,
    onClearCanvas,
    onPasteNodes,
    presentationList = [],
    setPresentationList,
    presentationIndex = -1,
    setPresentationIndex
}) => {
    const { showToast } = useToast();
    // destruct defaults if undefined to avoid crash, though App passes them
    const { pan, zoom } = viewState || { pan: { x: 0, y: 0 }, zoom: 1 };

    const [isPanning, setIsPanning] = useState(false);
    const [hideArrowsWhilePanning, setHideArrowsWhilePanning] = useState(true); // Default ON for performance
    const canvasRef = useRef(null);
    // const [selectedIds, setSelectedIds] = useState([]); // Moved to App.jsx

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
    const clipboardRef = useRef(null); // Stores copied node data for internal copy/paste

    // Backdrop toggle mode state
    const [backdropToggleMode, setBackdropToggleMode] = useState(false);

    // Diff selection state - for "Compare with..." feature
    const [diffSelection, setDiffSelection] = useState(null); // { docId }
    const [canvasContextMenu, setCanvasContextMenu] = useState(null); // { x, y } for canvas right-click menu
    const [cardContextMenu, setCardContextMenu] = useState(null); // { x, y, docId } for document right-click menu
    const [backdropMouseDown, setBackdropMouseDown] = useState(false); // Track if mouse is held down in backdrop mode

    // Custom document creation state
    const [pendingCustomCard, setPendingCustomCard] = useState(null); // { x, y, data: string }

    // Presentation editor panel visibility
    const [showPresentationEditor, setShowPresentationEditor] = useState(false);

    // Animation Ref
    const animationFrameRef = useRef(null);

    // Animate camera to a specific pan+zoom using easeInOutCubic
    const navigateToView = useCallback((targetPan, targetZoom, onComplete) => {
        const startPan = { ...viewStateRef.current.pan };
        const startZoom = viewStateRef.current.zoom;
        const duration = 800;
        const startTime = performance.now();

        const animate = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const ease = progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;

            const currentPan = {
                x: startPan.x + (targetPan.x - startPan.x) * ease,
                y: startPan.y + (targetPan.y - startPan.y) * ease
            };
            const currentZoom = startZoom + (targetZoom - startZoom) * ease;
            onViewStateChange({ pan: currentPan, zoom: currentZoom });

            if (progress < 1) {
                animationFrameRef.current = requestAnimationFrame(animate);
            } else {
                animationFrameRef.current = null;
                if (onComplete) onComplete();
            }
        };

        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = requestAnimationFrame(animate);
    }, [onViewStateChange]);

    // Navigate camera to center on an entity by id, optionally using a stored view
    const navigateToEntity = useCallback((entityId, storedView) => {
        if (!canvasRef.current) return;

        const selectAfterAnim = () => setSelectedIds([entityId]);

        // If a stored view is provided, animate directly to it
        if (storedView && storedView.pan && storedView.zoom) {
            navigateToView(storedView.pan, storedView.zoom, selectAfterAnim);
            return;
        }

        // Fallback: look up entity position and calculate center
        let targetCanvasPos = null;

        // Check documents by _id
        const doc = documents.find(d => d._id === entityId);
        if (doc) {
            targetCanvasPos = {
                x: doc.x + (doc.width ? doc.width / 2 : 175),
                y: doc.y + (doc.height ? doc.height / 2 : 100)
            };
        }

        // Check gap nodes
        if (!targetCanvasPos) {
            const gap = gapNodes.find(n => n.id === entityId);
            if (gap) {
                targetCanvasPos = { x: gap.x + 75, y: gap.y + 20 };
            }
        }

        // Check text nodes
        if (!targetCanvasPos) {
            const text = textNodes.find(n => n.id === entityId);
            if (text) {
                targetCanvasPos = {
                    x: text.x + (text.width ? text.width / 2 : 100),
                    y: text.y + (text.height ? text.height / 2 : 30)
                };
            }
        }

        // Check image nodes
        if (!targetCanvasPos) {
            const img = imageNodes.find(n => n.id === entityId);
            if (img) {
                targetCanvasPos = {
                    x: img.x + (img.width ? img.width / 2 : 150),
                    y: img.y + (img.height ? img.height / 2 : 100)
                };
            }
        }

        // Check diff nodes
        if (!targetCanvasPos) {
            const diff = diffNodes.find(n => n.id === entityId);
            if (diff) {
                targetCanvasPos = { x: diff.x + 175, y: diff.y + 100 };
            }
        }

        if (!targetCanvasPos) return;

        const viewport = canvasRef.current.getBoundingClientRect();
        const targetZoom = Math.max(viewStateRef.current.zoom, 0.6);
        const targetPanX = viewport.width / 2 - targetCanvasPos.x * targetZoom;
        const targetPanY = viewport.height / 2 - targetCanvasPos.y * targetZoom;

        navigateToView({ x: targetPanX, y: targetPanY }, targetZoom, selectAfterAnim);
    }, [documents, gapNodes, textNodes, imageNodes, diffNodes, navigateToView, setSelectedIds]);

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

    // Copy selected nodes to internal clipboard
    const handleCopySelected = useCallback(() => {
        const ids = selectedIdsRef.current;
        if (!ids || ids.length === 0) return;
        const idsSet = new Set(ids);

        const copiedDocs = documents.filter(d => idsSet.has(d._id)).map(d => ({
            ...d,
            expandedPaths: [...(d.expandedPaths || [])]
        }));
        const copiedGaps = gapNodes.filter(n => idsSet.has(n.id)).map(n => ({ ...n }));
        const copiedTexts = textNodes.filter(n => idsSet.has(n.id)).map(n => ({ ...n }));
        const copiedImages = imageNodes.filter(n => idsSet.has(n.id)).map(n => ({ ...n }));
        const copiedDiffs = diffNodes.filter(n => idsSet.has(n.id)).map(n => ({ ...n }));

        clipboardRef.current = {
            documents: copiedDocs,
            gapNodes: copiedGaps,
            textNodes: copiedTexts,
            imageNodes: copiedImages,
            diffNodes: copiedDiffs,
            pasteCount: 0
        };
    }, [documents, gapNodes, textNodes, imageNodes, diffNodes]);

    // Paste from internal clipboard
    const handlePasteFromClipboard = useCallback(() => {
        if (!clipboardRef.current || !onPasteNodes) return;
        const clip = clipboardRef.current;
        clip.pasteCount = (clip.pasteCount || 0) + 1;
        const offset = clip.pasteCount * 50;

        // Build ID remapping
        const idMap = new Map();
        const ts = Date.now();
        let counter = 0;
        const newId = (prefix) => `${prefix}-${ts}-${Math.random().toString(36).substr(2, 4)}-${counter++}`;

        // Generate new IDs
        clip.documents.forEach(d => idMap.set(d._id, newId(d.data?._id || 'doc')));
        clip.gapNodes.forEach(n => idMap.set(n.id, newId('gap')));
        clip.textNodes.forEach(n => idMap.set(n.id, newId('text')));
        clip.imageNodes.forEach(n => idMap.set(n.id, newId('image')));
        clip.diffNodes.forEach(n => idMap.set(n.id, newId('diff')));

        const remap = (id) => idMap.get(id) || id;

        const newDocs = clip.documents.map(d => ({
            ...d,
            _id: remap(d._id),
            x: d.x + offset,
            y: d.y + offset,
            expandedPaths: [...(d.expandedPaths || [])]
        }));

        const newGaps = clip.gapNodes.map(n => ({
            ...n,
            id: remap(n.id),
            x: n.x + offset,
            y: n.y + offset,
            sourceId: idMap.has(n.sourceId) ? remap(n.sourceId) : n.sourceId,
            targetId: idMap.has(n.targetId) ? remap(n.targetId) : n.targetId
        }));

        const newTexts = clip.textNodes.map(n => ({
            ...n,
            id: remap(n.id),
            x: n.x + offset,
            y: n.y + offset
        }));

        const newImages = clip.imageNodes.map(n => ({
            ...n,
            id: remap(n.id),
            x: n.x + offset,
            y: n.y + offset
        }));

        const newDiffs = clip.diffNodes.map(n => ({
            ...n,
            id: remap(n.id),
            x: n.x + offset,
            y: n.y + offset,
            sourceDocId: idMap.has(n.sourceDocId) ? remap(n.sourceDocId) : n.sourceDocId,
            targetDocId: idMap.has(n.targetDocId) ? remap(n.targetDocId) : n.targetDocId
        }));

        onPasteNodes({
            documents: newDocs,
            gapNodes: newGaps,
            textNodes: newTexts,
            imageNodes: newImages,
            diffNodes: newDiffs
        });

        // Select the newly pasted nodes
        const allNewIds = [
            ...newDocs.map(d => d._id),
            ...newGaps.map(n => n.id),
            ...newTexts.map(n => n.id),
            ...newImages.map(n => n.id),
            ...newDiffs.map(n => n.id)
        ];
        setSelectedIds(allNewIds);
    }, [onPasteNodes, setSelectedIds]);

    // Keyboard listeners
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Presentation mode: arrow key navigation
            if (presentationIndex >= 0 && presentationList.length > 0) {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (presentationIndex < presentationList.length - 1) {
                        const newIdx = presentationIndex + 1;
                        setPresentationIndex(newIdx);
                        const entry = presentationList[newIdx];
                        navigateToEntity(entry.id, entry.view);
                    }
                    return;
                }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (presentationIndex > 0) {
                        const newIdx = presentationIndex - 1;
                        setPresentationIndex(newIdx);
                        const entry = presentationList[newIdx];
                        navigateToEntity(entry.id, entry.view);
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setPresentationIndex(-1);
                    return;
                }
            }
            if (e.key === 'Escape' && backdropToggleMode) {
                setBackdropToggleMode(false);
                return;
            }
            // Ctrl+C / Cmd+C — copy selected nodes
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                const target = e.target;
                const isEditable = target && (
                    target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable
                );
                if (isEditable) return;
                if (selectedIds.length > 0) {
                    handleCopySelected();
                }
                return;
            }
            if (e.key === 'Delete') {
                if (selectedIds.length > 0) {
                    onDeleteMany && onDeleteMany(selectedIds);
                    setSelectedIds([]);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, onDeleteMany, backdropToggleMode, handleCopySelected, presentationIndex, presentationList, setPresentationIndex, navigateToEntity]);

    // Paste listener (images -> image node, text -> text node)
    useEffect(() => {
        const handlePaste = async (e) => {
            const target = e.target;
            const isEditableTarget = target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );
            if (isEditableTarget) return;

            // Internal clipboard takes priority
            if (clipboardRef.current) {
                e.preventDefault();
                handlePasteFromClipboard();
                return;
            }

            const items = e.clipboardData?.items;
            if (!items || items.length === 0) return;

            const imageItem = Array.from(items).find(item => item.type && item.type.startsWith('image/'));
            if (imageItem) {
                if (!onAddImageNode) return;

                const blob = imageItem.getAsFile();
                if (!blob) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        // Compress similarly to upload flow
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        const maxDim = 1024;

                        if (width > maxDim || height > maxDim) {
                            if (width > height) {
                                height = Math.round((height * maxDim) / width);
                                width = maxDim;
                            } else {
                                width = Math.round((width * maxDim) / height);
                                height = maxDim;
                            }
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                        const originalSizeMB = (blob.size / 1024 / 1024).toFixed(2);
                        const compressedSizeMB = (compressedDataUrl.length * 0.75 / 1024 / 1024).toFixed(2);

                        const rect = canvasRef.current?.getBoundingClientRect();
                        const { pan, zoom } = viewStateRef.current;
                        const centerX = rect ? rect.width / 2 : window.innerWidth / 2;
                        const centerY = rect ? rect.height / 2 : window.innerHeight / 2;
                        const x = (centerX - pan.x) / zoom;
                        const y = (centerY - pan.y) / zoom;

                        const baseWidth = 300;
                        const baseHeight = Math.round(baseWidth * (height / width));

                        onAddImageNode({
                            id: `image-${Date.now()}`,
                            x,
                            y,
                            src: compressedDataUrl,
                            width: baseWidth,
                            height: baseHeight,
                            dimmed: false,
                            originalSize: originalSizeMB,
                            compressedSize: compressedSizeMB
                        });
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(blob);
                return;
            }

            const textData = e.clipboardData?.getData('text/plain');
            if (!textData) return;
            if (!onAddTextNode) return;

            // Ignore pure whitespace pastes
            if (textData.trim().length === 0) return;

            const rect = canvasRef.current?.getBoundingClientRect();
            const { pan, zoom } = viewStateRef.current;
            const centerX = rect ? rect.width / 2 : window.innerWidth / 2;
            const centerY = rect ? rect.height / 2 : window.innerHeight / 2;
            const x = (centerX - pan.x) / zoom;
            const y = (centerY - pan.y) / zoom;

            onAddTextNode({
                id: `text-${Date.now()}`,
                text: textData,
                x,
                y,
                dimmed: false
            });
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [onAddImageNode, onAddTextNode, handlePasteFromClipboard]);

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
    const contentContainerRef = useRef(null);
    const gridRef = useRef(null);
    const panStartRef = useRef(null);

    const handleWheel = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomSensitivity = 0.001;
        const zoomFactor = Math.exp(-e.deltaY * zoomSensitivity);
        const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.01), 10);

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
                // Store starting state for direct DOM manipulation
                panStartRef.current = {
                    startMouseX: e.clientX,
                    startMouseY: e.clientY,
                    startPanX: viewState.pan.x,
                    startPanY: viewState.pan.y
                };
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
        const panMoveStart = performance.now();
        if (!panStartRef.current) return;

        const { startMouseX, startMouseY, startPanX, startPanY } = panStartRef.current;
        const zoom = viewStateRef.current.zoom;

        const newPanX = startPanX + (e.clientX - startMouseX);
        const newPanY = startPanY + (e.clientY - startMouseY);

        // Direct DOM manipulation - no React re-render
        if (contentContainerRef.current) {
            contentContainerRef.current.style.transform = `translate(${newPanX}px, ${newPanY}px) scale(${zoom})`;
            // Performance: hint browser to optimize for transform during pan
            contentContainerRef.current.style.willChange = 'transform';
            // Performance: disable pointer-events during pan to reduce hit-testing
            contentContainerRef.current.style.pointerEvents = 'none';
        }
        if (gridRef.current) {
            gridRef.current.style.backgroundPosition = `${newPanX}px ${newPanY}px`;
        }

        // PERF LOG: Warn if pan move takes too long
        const panMoveDuration = performance.now() - panMoveStart;
        if (panMoveDuration > 8) {
            console.warn(`[PERF] handlePanMove took ${panMoveDuration.toFixed(1)}ms`);
        }
    };

    const handlePanUp = (e) => {
        if (panStartRef.current) {
            const { startMouseX, startMouseY, startPanX, startPanY } = panStartRef.current;
            const newPanX = startPanX + (e.clientX - startMouseX);
            const newPanY = startPanY + (e.clientY - startMouseY);

            // Commit to React state
            onViewStateChange(prev => ({
                ...prev,
                pan: { x: newPanX, y: newPanY }
            }));
            panStartRef.current = null;
        }

        // Clean up pan-mode styles with small settle delay for smoother resume
        if (contentContainerRef.current) {
            contentContainerRef.current.style.pointerEvents = '';
            // Delay removing will-change to allow smooth settle
            setTimeout(() => {
                if (contentContainerRef.current) {
                    contentContainerRef.current.style.willChange = '';
                }
            }, 50);
        }

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
        // Handle Middle Click (Zoom Toggle)
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();

            const currentZoom = viewStateRef.current.zoom;
            const distTo10 = Math.abs(currentZoom - 0.1);
            const distTo100 = Math.abs(currentZoom - 1.0);

            let newZoom;
            if (distTo10 > distTo100) {
                newZoom = 0.1;
            } else {
                newZoom = 1.0;
            }

            // Calculate new pan to zoom around mouse position
            if (canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const { pan } = viewStateRef.current;

                const scaleFactor = newZoom / currentZoom;
                const newPanX = mouseX - (mouseX - pan.x) * scaleFactor;
                const newPanY = mouseY - (mouseY - pan.y) * scaleFactor;

                onViewStateChange({
                    pan: { x: newPanX, y: newPanY },
                    zoom: newZoom
                });
            }
            return;
        }

        // e is React synthetic event, but we need native for performance
        if (e.button !== 0) return; // Left click only

        // Handle diff selection mode - create diff node when second document is clicked
        if (diffSelection && diffSelection.docId !== id) {
            // Check if both are documents (not gap/text/image nodes)
            const sourceDoc = documents.find(d => d._id === diffSelection.docId);
            const targetDoc = documents.find(d => d._id === id);

            if (sourceDoc && targetDoc) {
                // Calculate position between the two documents
                const midX = (sourceDoc.x + targetDoc.x) / 2;
                const midY = Math.min(sourceDoc.y, targetDoc.y) - 50;

                onAddDiffNode({
                    id: `diff-${Date.now()}`,
                    x: midX,
                    y: midY,
                    sourceDocId: diffSelection.docId,
                    targetDocId: id,
                    dimmed: false
                });

                setDiffSelection(null);
                return;
            } else {
                // One of them is not a document, cancel diff selection
                setDiffSelection(null);
            }
        }

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
                    // Text Node?
                    const textNode = textNodes.find(n => n.id === selId);
                    if (textNode) {
                        modelX = textNode.x;
                        modelY = textNode.y;
                    } else {
                        // Image Node?
                        const imageNode = imageNodes.find(n => n.id === selId);
                        if (imageNode) {
                            modelX = imageNode.x;
                            modelY = imageNode.y;
                        } else {
                            // Diff Node?
                            const diffNode = diffNodes.find(n => n.id === selId);
                            if (diffNode) {
                                modelX = diffNode.x;
                                modelY = diffNode.y;
                            } else {
                                // Document?
                                const doc = documents.find(d => d._id === selId);
                                if (doc) {
                                    modelX = doc.x;
                                    modelY = doc.y;
                                }
                            }
                        }
                    }
                }

                // Make sure we have a reference to the initial transform or style
                // We will use transform translate to move them visually
                el.style.transition = 'none'; // Disable transition during drag
                const originalZIndex = el.style.zIndex;
                el.style.zIndex = 1000; // Bring to front

                // Check for centered attribute
                const isCentered = el.getAttribute('data-centered') === 'true';
                const originalTransform = el.style.transform;

                dragInfo.targets[selId] = {
                    el,
                    modelX,
                    modelY,
                    originalZIndex,
                    originalTransform,
                    isCentered
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
        Object.values(targets).forEach(({ el, isCentered }) => {
            let transform = `translate(${dx}px, ${dy}px)`;
            if (isCentered) {
                transform += ' translate(-50%, -50%)';
            }
            el.style.transform = transform;
        });
    };

    const handleCardMouseUp = (e) => {
        if (!dragStateRef.current) return;

        const { startX, startY, targets } = dragStateRef.current;
        const zoom = viewStateRef.current.zoom;

        const dx = (e.clientX - startX) / zoom;
        const dy = (e.clientY - startY) / zoom;

        // Cleanup DOM overrides
        Object.values(targets).forEach(({ el, originalZIndex, originalTransform }) => {
            el.style.transform = originalTransform; // Restore original transform (e.g. translate(-50%, -50%))
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

    const handleDoubleClick = (e) => {
        // Only trigger on empty canvas
        if (e.target !== canvasRef.current) return;

        const currentZoom = zoom;
        const distTo10 = Math.abs(currentZoom - 0.1);
        const distTo100 = Math.abs(currentZoom - 1.0);

        let newZoom;
        if (distTo10 > distTo100) {
            newZoom = 0.1;
        } else {
            newZoom = 1.0;
        }

        // Calculate new pan to zoom around mouse position
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const scaleFactor = newZoom / currentZoom;
        const newPanX = mouseX - (mouseX - pan.x) * scaleFactor;
        const newPanY = mouseY - (mouseY - pan.y) * scaleFactor;

        onViewStateChange({
            pan: { x: newPanX, y: newPanY },
            zoom: newZoom
        });
    };

    return (
        <div ref={canvasRef} style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#0f172a',
            position: 'relative',
            cursor: backdropToggleMode ? 'crosshair' : (isPanning ? 'grabbing' : 'default')
        }}
            onDoubleClick={handleDoubleClick}
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
            <div ref={gridRef} data-canvas-grid style={{
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
            <div ref={contentContainerRef} style={{
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
                                    onQuickConnect={onQuickConnect}
                                    connectionHistoryVersion={connectionHistoryVersion}
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
                                    onExpandAll={onExpandAll}
                                    onCollapseAll={onCollapseAll}
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

                        {textNodes.map(node => (
                            <DraggableTextNode
                                key={node.id}
                                node={node}
                                zoom={zoom}
                                onUpdatePosition={onUpdateTextNodePosition}
                                onUpdateText={onUpdateTextNode}
                                onUpdateSize={onUpdateTextNodeSize}
                                onDelete={onDeleteTextNode}
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
                        ))}

                        {/* Image Nodes */}
                        {imageNodes.map(node => (
                            <DraggableImageNode
                                key={node.id}
                                node={node}
                                zoom={zoom}
                                onUpdatePosition={onUpdateImageNodePosition}
                                onUpdateImage={onUpdateImageNode}
                                onDelete={onDeleteImageNode}
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
                        ))}

                        {/* Diff Nodes */}
                        {diffNodes.map(node => (
                            <DraggableDiffNode
                                key={node.id}
                                node={node}
                                sourceDoc={docMap.get(node.sourceDocId)}
                                targetDoc={docMap.get(node.targetDocId)}
                                zoom={zoom}
                                onUpdateDiffNode={onUpdateDiffNode}
                                onDelete={onDeleteDiffNode}
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
                        ))}

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
            <ConnectionLayerWrapper
                gapNodes={gapNodes}
                diffNodes={diffNodes}
                arrowDirection={arrowDirection}
                nodeRegistry={nodeRegistry}
                zoom={zoom}
                pan={pan}
                isPanning={isPanning}
                hideArrowsWhilePanning={hideArrowsWhilePanning}
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

            {/* Diff Selection Mode Indicator */}
            {diffSelection && (
                <div style={{
                    position: 'fixed',
                    top: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--primary)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '0.9rem',
                    zIndex: 2000,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <span>Click another document to compare</span>
                    <button
                        onClick={() => setDiffSelection(null)}
                        style={{
                            background: 'rgba(0,0,0,0.2)',
                            border: 'none',
                            color: 'white',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.8rem'
                        }}
                    >
                        Cancel
                    </button>
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
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCopySelected();
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
                        <span style={{ marginRight: '8px' }}>📋</span>
                        Copy {selectedIds.length > 1 ? `(${selectedIds.length})` : ''}
                    </button>
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
                                }),
                                ...textNodes.filter(n => selectedIds.includes(n.id)).map(n => {
                                    let width = 150;
                                    const el = cardRefs.current.get(n.id);
                                    if (el) width = el.offsetWidth;
                                    return {
                                        id: n.id,
                                        x: n.x,
                                        y: n.y,
                                        width,
                                        type: 'text'
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
                                })),
                                ...textNodes.filter(n => selectedIds.includes(n.id)).map(n => ({
                                    id: n.id,
                                    x: n.x,
                                    y: n.y,
                                    height: 40,
                                    type: 'text'
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
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setDiffSelection({ docId: cardContextMenu.docId });
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
                        <span style={{ marginRight: '8px' }}>⇔</span>
                        Compare with...
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
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const canvasRect = canvasRef.current.getBoundingClientRect();
                            const x = (canvasContextMenu.x - canvasRect.left - pan.x) / zoom;
                            const y = (canvasContextMenu.y - canvasRect.top - pan.y) / zoom;

                            onAddTextNode({
                                id: `text-${Date.now()}`,
                                text: 'New Text',
                                x,
                                y,
                                dimmed: false
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
                        📝 Add Text
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const canvasRect = canvasRef.current.getBoundingClientRect();
                            const x = (canvasContextMenu.x - canvasRect.left - pan.x) / zoom;
                            const y = (canvasContextMenu.y - canvasRect.top - pan.y) / zoom;

                            onAddImageNode({
                                id: `image-${Date.now()}`,
                                x,
                                y,
                                src: null, // Starts empty
                                width: 300,
                                height: 200,
                                dimmed: false
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
                        🖼 Add Image
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
                pointerEvents: 'auto',
                zIndex: 100
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
                <button
                    onClick={onClearCanvas}
                    title="Clear Canvas"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        display: 'flex',
                        alignItems: 'center'
                    }}
                >
                    🗑️
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
                <button
                    onClick={() => setHideArrowsWhilePanning(prev => !prev)}
                    title={hideArrowsWhilePanning ? "Show Arrows While Panning" : "Hide Arrows While Panning"}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: hideArrowsWhilePanning ? '#4ade80' : '#94a3b8',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: hideArrowsWhilePanning ? 'rgba(74, 222, 128, 0.15)' : 'transparent'
                    }}
                >
                    {hideArrowsWhilePanning ? '🚀' : '🐢'}
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
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={() => onExport(true)} // Pass true to indicate HTML export preference
                    title="Export as HTML (Viewer)"
                    style={{ background: 'transparent', border: 'none', color: '#f472b6', cursor: 'pointer', fontSize: '1.2rem' }}
                >
                    🌏
                </button>
            </div>

            {/* Presentation Toggle Button — bottom-left */}
            <button
                onClick={() => setShowPresentationEditor(prev => !prev)}
                title="Presentation Mode"
                onMouseDown={e => e.stopPropagation()}
                style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: '20px',
                    background: showPresentationEditor || presentationIndex >= 0 ? 'rgba(251, 191, 36, 0.25)' : 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(4px)',
                    border: showPresentationEditor || presentationIndex >= 0 ? '1px solid rgba(251, 191, 36, 0.5)' : '1px solid var(--glass-border)',
                    color: showPresentationEditor || presentationIndex >= 0 ? '#fbbf24' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '1.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    pointerEvents: 'auto',
                    zIndex: 100
                }}
            >
                ▶
            </button>

            {/* Presentation Editor Panel */}
            {showPresentationEditor && (
                <div style={{
                    position: 'absolute',
                    bottom: '70px',
                    left: '20px',
                    width: '260px',
                    maxHeight: '400px',
                    background: 'rgba(0,0,0,0.7)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '8px',
                    border: '1px solid var(--glass-border)',
                    color: '#cbd5e1',
                    fontSize: '0.8rem',
                    pointerEvents: 'auto',
                    zIndex: 101,
                    display: 'flex',
                    flexDirection: 'column'
                }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--glass-border)' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Presentation</span>
                        <button
                            onClick={() => setShowPresentationEditor(false)}
                            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
                        >✕</button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
                        {presentationList.length === 0 ? (
                            <div style={{ padding: '12px', textAlign: 'center', color: '#64748b' }}>
                                No items. Select entities and click "Add Selected".
                            </div>
                        ) : presentationList.map((entry, idx) => {
                            // Resolve label
                            let label = entry.type + ' ' + (entry.id || '').slice(-6);
                            if (entry.type === 'doc') {
                                const d = documents.find(d => d._id === entry.id);
                                if (d) label = (d.collection || 'doc') + ' ' + (entry.id || '').slice(-6);
                            } else if (entry.type === 'text') {
                                const t = textNodes.find(n => n.id === entry.id);
                                if (t && t.text) label = 'Text ' + t.text.slice(0, 20);
                                else label = 'Text ' + (entry.id || '').slice(-6);
                            } else if (entry.type === 'gap') {
                                label = 'Gap ' + (entry.id || '').slice(-6);
                            } else if (entry.type === 'image') {
                                label = 'Image ' + (entry.id || '').slice(-6);
                            } else if (entry.type === 'diff') {
                                label = 'Diff ' + (entry.id || '').slice(-6);
                            }
                            return (
                                <div key={entry.id + '-' + idx} style={{
                                    padding: '4px 8px',
                                    background: presentationIndex === idx ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                                    borderLeft: presentationIndex === idx ? '2px solid #fbbf24' : '2px solid transparent'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ minWidth: '18px', color: '#64748b', fontSize: '0.7rem' }}>{idx + 1}.</span>
                                        <span style={{
                                            flex: 1,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            cursor: 'pointer'
                                        }}
                                            onClick={() => navigateToEntity(entry.id)}
                                            title={label}
                                        >{label}</span>
                                        <button
                                            onClick={() => {
                                                if (idx > 0) {
                                                    setPresentationList(prev => {
                                                        const next = [...prev];
                                                        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                                        return next;
                                                    });
                                                }
                                            }}
                                            disabled={idx === 0}
                                            style={{ background: 'transparent', border: 'none', color: idx === 0 ? '#334155' : '#94a3b8', cursor: idx === 0 ? 'default' : 'pointer', fontSize: '0.7rem', padding: '1px 3px' }}
                                            title="Move up"
                                        >▲</button>
                                        <button
                                            onClick={() => {
                                                if (idx < presentationList.length - 1) {
                                                    setPresentationList(prev => {
                                                        const next = [...prev];
                                                        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                                        return next;
                                                    });
                                                }
                                            }}
                                            disabled={idx === presentationList.length - 1}
                                            style={{ background: 'transparent', border: 'none', color: idx === presentationList.length - 1 ? '#334155' : '#94a3b8', cursor: idx === presentationList.length - 1 ? 'default' : 'pointer', fontSize: '0.7rem', padding: '1px 3px' }}
                                            title="Move down"
                                        >▼</button>
                                        <button
                                            onClick={() => {
                                                setPresentationList(prev => prev.filter((_, i) => i !== idx));
                                                // Adjust presentation index if needed
                                                if (presentationIndex >= 0) {
                                                    if (idx < presentationIndex) setPresentationIndex(prev => prev - 1);
                                                    else if (idx === presentationIndex) setPresentationIndex(-1);
                                                }
                                            }}
                                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.75rem', padding: '1px 3px' }}
                                            title="Remove"
                                        >✕</button>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Add note..."
                                        value={entry.note || ''}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setPresentationList(prev => {
                                                const next = [...prev];
                                                next[idx] = { ...next[idx], note: val };
                                                return next;
                                            });
                                        }}
                                        style={{
                                            width: '100%',
                                            marginTop: '3px',
                                            marginLeft: '18px',
                                            padding: '2px 6px',
                                            background: 'rgba(255,255,255,0.05)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '3px',
                                            color: '#e2e8f0',
                                            fontSize: '0.7rem',
                                            outline: 'none',
                                            boxSizing: 'border-box',
                                            maxWidth: 'calc(100% - 18px)'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = 'rgba(251, 191, 36, 0.4)'}
                                        onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                                    />
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', padding: '8px', borderTop: '1px solid var(--glass-border)', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => {
                                if (!selectedIds || selectedIds.length === 0) return;
                                const currentView = { pan: { ...viewStateRef.current.pan }, zoom: viewStateRef.current.zoom };
                                const newEntries = selectedIds
                                    .map(id => {
                                        // Determine type and store current view
                                        if (documents.find(d => d._id === id)) return { id, type: 'doc', view: currentView };
                                        if (gapNodes.find(n => n.id === id)) return { id, type: 'gap', view: currentView };
                                        if (textNodes.find(n => n.id === id)) return { id, type: 'text', view: currentView };
                                        if (imageNodes.find(n => n.id === id)) return { id, type: 'image', view: currentView };
                                        if (diffNodes.find(n => n.id === id)) return { id, type: 'diff', view: currentView };
                                        return null;
                                    })
                                    .filter(Boolean);
                                if (newEntries.length > 0) {
                                    setPresentationList(prev => [...prev, ...newEntries]);
                                }
                            }}
                            style={{
                                flex: 1,
                                padding: '5px 8px',
                                background: 'rgba(96, 165, 250, 0.2)',
                                border: '1px solid rgba(96, 165, 250, 0.3)',
                                borderRadius: '4px',
                                color: '#93c5fd',
                                cursor: 'pointer',
                                fontSize: '0.75rem'
                            }}
                        >+ Add Selected</button>
                        <button
                            onClick={() => {
                                if (presentationList.length > 0) {
                                    setPresentationIndex(0);
                                    const entry = presentationList[0];
                                    navigateToEntity(entry.id, entry.view);
                                }
                            }}
                            disabled={presentationList.length === 0}
                            style={{
                                flex: 1,
                                padding: '5px 8px',
                                background: presentationList.length === 0 ? 'rgba(100,100,100,0.2)' : 'rgba(251, 191, 36, 0.2)',
                                border: '1px solid ' + (presentationList.length === 0 ? 'rgba(100,100,100,0.3)' : 'rgba(251, 191, 36, 0.3)'),
                                borderRadius: '4px',
                                color: presentationList.length === 0 ? '#475569' : '#fbbf24',
                                cursor: presentationList.length === 0 ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem'
                            }}
                        >▶ Play</button>
                        <button
                            onClick={() => { setPresentationList([]); setPresentationIndex(-1); }}
                            disabled={presentationList.length === 0}
                            style={{
                                padding: '5px 8px',
                                background: 'transparent',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '4px',
                                color: presentationList.length === 0 ? '#475569' : '#ef4444',
                                cursor: presentationList.length === 0 ? 'not-allowed' : 'pointer',
                                fontSize: '0.75rem'
                            }}
                        >Clear</button>
                    </div>
                </div>
            )}

            {/* Presentation Floating Note — draggable & resizable */}
            {presentationIndex >= 0 && presentationList.length > 0 && presentationList[presentationIndex]?.note && (() => {
                const entry = presentationList[presentationIndex];
                const notePos = entry.notePos || { x: 65, y: window.innerHeight - 140 };
                const noteSize = entry.noteSize || { width: 300, height: 60 };
                return (
                    <div
                        style={{
                            position: 'absolute',
                            left: notePos.x + 'px',
                            top: notePos.y + 'px',
                            width: noteSize.width + 'px',
                            minHeight: noteSize.height + 'px',
                            background: 'rgba(0,0,0,0.75)',
                            backdropFilter: 'blur(10px)',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: '1px solid rgba(251, 191, 36, 0.4)',
                            color: '#fbbf24',
                            fontSize: '1rem',
                            fontWeight: 500,
                            lineHeight: 1.4,
                            pointerEvents: 'auto',
                            zIndex: 102,
                            textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                            boxShadow: '0 0 20px rgba(251, 191, 36, 0.15)',
                            cursor: 'move',
                            userSelect: 'none',
                            overflow: 'hidden',
                            wordWrap: 'break-word'
                        }}
                        onMouseDown={(e) => {
                            if (e.target.dataset.resize) return;
                            e.stopPropagation();
                            const startX = e.clientX;
                            const startY = e.clientY;
                            const startPos = { ...notePos };
                            const onMove = (ev) => {
                                const dx = ev.clientX - startX;
                                const dy = ev.clientY - startY;
                                e.currentTarget.style.left = (startPos.x + dx) + 'px';
                                e.currentTarget.style.top = (startPos.y + dy) + 'px';
                            };
                            const el = e.currentTarget;
                            const onUp = (ev) => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                                const dx = ev.clientX - startX;
                                const dy = ev.clientY - startY;
                                const newPos = { x: startPos.x + dx, y: startPos.y + dy };
                                setPresentationList(prev => {
                                    const next = [...prev];
                                    next[presentationIndex] = { ...next[presentationIndex], notePos: newPos };
                                    return next;
                                });
                            };
                            window.addEventListener('mousemove', onMove);
                            window.addEventListener('mouseup', onUp);
                        }}
                    >
                        {entry.note}
                        {/* Resize handle */}
                        <div
                            data-resize="true"
                            style={{
                                position: 'absolute',
                                right: 0,
                                bottom: 0,
                                width: '14px',
                                height: '14px',
                                cursor: 'nwse-resize',
                                background: 'linear-gradient(135deg, transparent 50%, rgba(251, 191, 36, 0.5) 50%)',
                                borderRadius: '0 0 8px 0'
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                const startX = e.clientX;
                                const startY = e.clientY;
                                const startSize = { ...noteSize };
                                const parent = e.currentTarget.parentElement;
                                const onMove = (ev) => {
                                    const dw = ev.clientX - startX;
                                    const dh = ev.clientY - startY;
                                    const newW = Math.max(120, startSize.width + dw);
                                    const newH = Math.max(30, startSize.height + dh);
                                    parent.style.width = newW + 'px';
                                    parent.style.minHeight = newH + 'px';
                                };
                                const onUp = (ev) => {
                                    window.removeEventListener('mousemove', onMove);
                                    window.removeEventListener('mouseup', onUp);
                                    const dw = ev.clientX - startX;
                                    const dh = ev.clientY - startY;
                                    const newSize = {
                                        width: Math.max(120, startSize.width + dw),
                                        height: Math.max(30, startSize.height + dh)
                                    };
                                    setPresentationList(prev => {
                                        const next = [...prev];
                                        next[presentationIndex] = { ...next[presentationIndex], noteSize: newSize };
                                        return next;
                                    });
                                };
                                window.addEventListener('mousemove', onMove);
                                window.addEventListener('mouseup', onUp);
                            }}
                        />
                    </div>
                );
            })()}

            {/* Presentation Player Bar */}
            {presentationIndex >= 0 && presentationList.length > 0 && (
                <div style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: '65px',
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(8px)',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    color: '#cbd5e1',
                    fontSize: '0.85rem',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    border: '1px solid rgba(251, 191, 36, 0.5)',
                    boxShadow: '0 0 12px rgba(251, 191, 36, 0.3)',
                    pointerEvents: 'auto',
                    zIndex: 102
                }}
                    onMouseDown={e => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            if (presentationIndex > 0) {
                                const newIdx = presentationIndex - 1;
                                setPresentationIndex(newIdx);
                                const entry = presentationList[newIdx];
                                navigateToEntity(entry.id, entry.view);
                            }
                        }}
                        disabled={presentationIndex === 0}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: presentationIndex === 0 ? '#475569' : '#e2e8f0',
                            cursor: presentationIndex === 0 ? 'not-allowed' : 'pointer',
                            fontSize: '1rem',
                            padding: '2px 8px'
                        }}
                    >◀ Prev</button>
                    <span style={{ minWidth: '50px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                        {presentationIndex + 1} / {presentationList.length}
                    </span>
                    <button
                        onClick={() => {
                            if (presentationIndex < presentationList.length - 1) {
                                const newIdx = presentationIndex + 1;
                                setPresentationIndex(newIdx);
                                const entry = presentationList[newIdx];
                                navigateToEntity(entry.id, entry.view);
                            }
                        }}
                        disabled={presentationIndex === presentationList.length - 1}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: presentationIndex === presentationList.length - 1 ? '#475569' : '#e2e8f0',
                            cursor: presentationIndex === presentationList.length - 1 ? 'not-allowed' : 'pointer',
                            fontSize: '1rem',
                            padding: '2px 8px'
                        }}
                    >Next ▶</button>
                    <button
                        onClick={() => setPresentationIndex(-1)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            padding: '2px 8px'
                        }}
                        title="Exit presentation"
                    >✕</button>
                </div>
            )}
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
