
import React, { useState, useEffect, useRef } from 'react';
import DocumentCard from './DocumentCard';
import { ConnectionContext } from '../contexts/ConnectionContext';

const DraggableCard = ({ doc, onUpdatePosition, zoom, onConnect, onClone, onDelete, onDateClick }) => {
    const [position, setPosition] = useState({ x: doc.x, y: doc.y });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 }); // Mouse position at start
    const docStart = useRef({ x: 0, y: 0 });  // Doc position at start
    const cardRef = useRef(null);

    // Sync local state when prop changes
    useEffect(() => {
        setPosition({ x: doc.x, y: doc.y });
    }, [doc.x, doc.y]);

    // Set initial width
    useEffect(() => {
        if (cardRef.current && !cardRef.current.style.width) {
            cardRef.current.style.width = '350px';
        }
    }, []);

    const handleMouseDown = (e) => {
        e.stopPropagation(); // Prevent propagation to canvas pan
        if (e.button !== 0) return; // Only left click

        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY };
        docStart.current = { x: position.x, y: position.y };

        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;

        setPosition({
            x: docStart.current.x + dx,
            y: docStart.current.y + dy
        });
    };

    const handleMouseUp = (e) => {
        setIsDragging(false);
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Calculate final position same way
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;

        onUpdatePosition(doc._id, docStart.current.x + dx, docStart.current.y + dy);
    };

    return (
        <div
            ref={cardRef}
            style={{
                position: 'absolute',
                left: position.x,
                top: position.y,
                // Removed maxHeight to allow infinite resizing
                zIndex: isDragging ? 1000 : 10,
                boxShadow: isDragging ? '0 10px 25px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.1)',
                transition: isDragging ? 'none' : 'box-shadow 0.2s',
                background: 'var(--panel-bg)',
                borderRadius: '8px',
                border: '1px solid var(--glass-border)',
                padding: '1rem',
                resize: 'both',
                overflow: 'auto',
                minWidth: '200px',
                minHeight: '100px',
                display: 'flex',
                flexDirection: 'column'
            }}
            onMouseDown={(e) => e.stopPropagation()} // Stop propagation for resize handle clicks etc
        >
            <div
                onMouseDown={handleMouseDown}
                style={{
                    marginBottom: '0.5rem',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    cursor: isDragging ? 'grabbing' : 'grab',
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
                        title="Clone"
                        onClick={(e) => { e.stopPropagation(); onClone && onClone(doc._id); }}
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
                        onClick={(e) => { e.stopPropagation(); onDelete && onDelete(doc._id); }}
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

            <div style={{ flex: 1 }}>
                <DocumentCard data={doc.data} isRoot={false} onConnect={onConnect} onDateClick={onDateClick} />
            </div>
        </div>
    );
};

const DraggableGapNode = ({ node, zoom, onUpdatePosition, onDelete }) => {
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const nodeStart = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;

        setIsDragging(true);
        dragStart.current = { x: e.clientX, y: e.clientY };
        nodeStart.current = { x: node.x, y: node.y };

        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;
        onUpdatePosition(node.id, nodeStart.current.x + dx, nodeStart.current.y + dy);
    };

    const handleMouseUp = (e) => {
        setIsDragging(false);
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Final update
        const dx = (e.clientX - dragStart.current.x) / zoom;
        const dy = (e.clientY - dragStart.current.y) / zoom;
        onUpdatePosition(node.id, nodeStart.current.x + dx, nodeStart.current.y + dy);
    };

    return (
        <div
            onMouseDown={handleMouseDown}
            style={{
                position: 'absolute',
                left: node.x,
                top: node.y,
                transform: 'translate(-50%, -50%)',
                background: node.text.startsWith('+') ? '#4ade80' : '#f87171',
                color: '#0f172a',
                padding: '4px 12px',
                borderRadius: '6px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                cursor: isDragging ? 'grabbing' : 'grab',
                zIndex: 2000,
                boxShadow: isDragging ? '0 8px 16px rgba(0,0,0,0.3)' : '0 4px 6px rgba(0,0,0,0.2)',
                border: '1px solid rgba(255,255,255,0.2)',
                userSelect: 'none',
                minWidth: 'max-content',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
            }}
        >
            {node.text}
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(node.id); }}
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
};

const Canvas = ({
    documents,
    viewState,
    onViewStateChange,
    onUpdatePosition,
    onConnect,
    onClone,
    onDelete,
    onSave,
    onLoad,
    gapNodes = [],
    onUpdateGapNodePosition,
    onAddGapNode,
    onDeleteGapNode
}) => {
    // destruct defaults if undefined to avoid crash, though App passes them
    const { pan, zoom } = viewState || { pan: { x: 0, y: 0 }, zoom: 1 };

    const [isPanning, setIsPanning] = useState(false);
    const canvasRef = useRef(null);

    // Date Gap Logic
    const [dateSelection, setDateSelection] = useState(null); // { value: Date, stableId: string }

    const handleDateClick = (dateValue, e, stableId) => {
        const date = new Date(dateValue);

        // Ensure we have a valid stableId, fallback if missing
        if (!stableId) {
            console.warn("Missing stable ID for date click");
            return;
        }

        if (!dateSelection) {
            setDateSelection({ value: date, stableId: stableId });
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
    };

    // Connection Logic
    const nodeRegistry = useRef(new Map()); // Map<id, { type: 'def'|'ref', ref: HTMLElement, value: string }>
    const [lines, setLines] = useState([]);
    const frameRef = useRef();

    // Register/Unregister nodes
    const registerNode = (value, type, ref) => {
        if (!ref) return;
        nodeRegistry.current.set(ref, { value, type, ref });
    };

    const unregisterNode = (ref) => {
        nodeRegistry.current.delete(ref);
    };

    const contextValue = { registerNode, unregisterNode };

    // Line Update Loop
    useEffect(() => {
        const updateLines = () => {
            const newLines = [];
            const nodes = Array.from(nodeRegistry.current.values());

            // 1. Regular Document Connections
            const grouped = {};
            nodes.forEach(node => {
                if (!grouped[node.value]) grouped[node.value] = { defs: [], refs: [] };
                if (node.type === 'def') grouped[node.value].defs.push(node);
                else grouped[node.value].refs.push(node);
            });

            if (canvasRef.current) {
                const canvasRect = canvasRef.current.getBoundingClientRect();

                // Helper to get Canvas Coords from Rect
                const getCanvasCoords = (rect) => ({
                    x: (rect.left - canvasRect.left + rect.width / 2),
                    y: (rect.top - canvasRect.top + rect.height / 2)
                });

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

                            newLines.push({
                                id: `${nodeRegistry.current.get(refNode.ref)?.value} -${Math.random()} `,
                                x1: start.x,
                                y1: start.y,
                                x2: end.x,
                                y2: end.y,
                                color: '#fbbf24'
                            });
                        });
                    });
                });

                // 2. Gap Node Connections
                gapNodes.forEach(node => {
                    // Start -> GapNode
                    const sourceEl = document.getElementById(node.sourceId);

                    if (sourceEl) {
                        const sourceRect = sourceEl.getBoundingClientRect();
                        if (sourceRect.width > 0) {
                            const sourcePos = getCanvasCoords(sourceRect);

                            const gapScreenX = node.x * zoom + pan.x;
                            const gapScreenY = node.y * zoom + pan.y;

                            newLines.push({
                                id: `${node.id}-source`,
                                x1: sourcePos.x,
                                y1: sourcePos.y,
                                x2: gapScreenX,
                                y2: gapScreenY,
                                color: node.text.startsWith('+') ? '#4ade80' : '#f87171'
                            });
                        }
                    }

                    // GapNode -> Target
                    const targetEl = document.getElementById(node.targetId);
                    if (targetEl) {
                        const targetRect = targetEl.getBoundingClientRect();
                        if (targetRect.width > 0) {
                            const targetPos = getCanvasCoords(targetRect);

                            const gapScreenX = node.x * zoom + pan.x;
                            const gapScreenY = node.y * zoom + pan.y;

                            newLines.push({
                                id: `${node.id}-target`,
                                x1: gapScreenX,
                                y1: gapScreenY,
                                x2: targetPos.x,
                                y2: targetPos.y,
                                color: node.text.startsWith('+') ? '#4ade80' : '#f87171'
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
    }, [documents, pan, zoom, gapNodes]);

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

    const handleMouseDown = (e) => {
        // Middle mouse or Left click on background
        if (e.button === 0 || e.button === 1) {
            setIsPanning(true);
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            document.body.style.cursor = 'grabbing';
            document.addEventListener('mousemove', handlePanMove);
            document.addEventListener('mouseup', handlePanUp);
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

    return (
        <div ref={canvasRef} style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#0f172a',
            position: 'relative',
            cursor: isPanning ? 'grabbing' : 'grab'
        }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
        >
            {/* Grid Pattern that moves with Pan / Scale */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.05) 1px, transparent 0)',
                backgroundSize: `${20 * zoom}px ${20 * zoom} px`, // Scale grid
                backgroundPosition: `${pan.x}px ${pan.y} px`,    // Move grid
                pointerEvents: 'none'
            }} />

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

                        {documents.map(doc => (
                            <DraggableCard
                                key={doc._id}
                                doc={doc}
                                onUpdatePosition={onUpdatePosition}
                                zoom={zoom}
                                onConnect={onConnect}
                                onClone={onClone}
                                onDelete={onDelete}
                                onDateClick={handleDateClick}
                            />
                        ))}

                        {gapNodes.map(node => (
                            <DraggableGapNode
                                key={node.id}
                                node={node}
                                zoom={zoom}
                                onUpdatePosition={onUpdateGapNodePosition}
                                onDelete={onDeleteGapNode}
                            />
                        ))}
                    </ConnectionContext.Provider>
                </div>
            </div>

            {/* Connection Lines Layer */}
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
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#fbbf24" opacity="0.5" />
                    </marker>
                    {/* Separate markers for gaps maybe or just use colored lines? */}
                </defs>
                {lines.map((line, i) => (
                    <line
                        key={i}
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        stroke={line.color || "#fbbf24"}
                        strokeWidth="2"
                        strokeOpacity="0.6"
                        markerEnd="url(#arrowhead)" // Reusing same arrowhead for now, might need colored ones later
                    />
                ))}
            </svg>

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
                <button onClick={() => onViewStateChange(prev => ({ ...prev, zoom: Math.max(prev.zoom - 0.1, 0.1) }))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>-</button>
                <span style={{ minWidth: '40px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => onViewStateChange(prev => ({ ...prev, zoom: Math.min(prev.zoom + 0.1, 5) }))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>+</button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button
                    onClick={() => onConnect()}
                    title="Connect New Document"
                    style={{ background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: '1.1rem', display: 'flex', alignItems: 'center' }}
                >
                    🔗
                </button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button onClick={() => { onViewStateChange({ pan: { x: 0, y: 0 }, zoom: 1 }); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>Reset</button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button onClick={onSave} title="Save Canvas State" style={{ background: 'transparent', border: 'none', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                <button onClick={onLoad} title="Load Canvas State" style={{ background: 'transparent', border: 'none', color: '#4ade80', cursor: 'pointer', fontWeight: 600 }}>Load</button>
            </div>
        </div>
    );
};

const calculateTimeGap = (startDate, endDate) => {
    let start = new Date(startDate);
    let end = new Date(endDate);
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

    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (months > 0) parts.push(`${months}m`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return `${sign} ${parts.join(' ')}`;
};

export default Canvas;
