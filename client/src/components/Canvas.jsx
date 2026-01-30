import React, { useState, useEffect, useRef } from 'react';
import DocumentCard from './DocumentCard';
import { ConnectionContext } from '../contexts/ConnectionContext';

const DraggableCard = ({ doc, onUpdatePosition, zoom, onConnect }) => {
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
                // Removed overflow: auto (unless we want internal scroll) - let's keep auto if content is HUGE but box is small
                // But for "infinitely resizable" usually means the box grows.
                // If we want box to grow, we shouldn't set maxHeight.
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
                    alignItems: 'center',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    flexShrink: 0
                }}
            >
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                    ID: {doc.data._id || 'Unknown'}
                </span>
                <div style={{ fontSize: '1rem', opacity: 0.5 }}>⠿</div>
            </div>

            <div style={{ flex: 1 }}>
                <DocumentCard data={doc.data} isRoot={false} onConnect={onConnect} />
            </div>
        </div>
    );
};

const Canvas = ({ documents, onUpdatePosition, onConnect }) => {
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);
    const canvasRef = useRef(null);

    // Connection Logic
    const nodeRegistry = useRef(new Map()); // Map<id, { type: 'def'|'ref', ref: HTMLElement, value: string }>
    const [lines, setLines] = useState([]);
    const frameRef = useRef();

    // Register/Unregister nodes
    const registerNode = (value, type, ref) => {
        // We use a unique key because multiple refs might verify to same value? 
        // No, we need to store them by reference actually.
        // Or generate a unique ID for each node.
        // Let's use the object reference of the DOM node as key if possible, or just a Symbol.
        // But map keys can be objects.
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

            // Group by value
            const grouped = {};
            nodes.forEach(node => {
                if (!grouped[node.value]) grouped[node.value] = { defs: [], refs: [] };
                if (node.type === 'def') grouped[node.value].defs.push(node);
                else grouped[node.value].refs.push(node);
            });

            // Calculate connections
            // Strategy: Connect every Ref to every Def? Or just nearest?
            // For now, simple: Connect all Refs to the first Def found? 
            // Or if multiple Defs (duplicates), maybe connect to nearest?
            // Let's just connect to ALL Defs for now to be distinct.

            if (canvasRef.current) {
                const canvasRect = canvasRef.current.getBoundingClientRect();

                Object.values(grouped).forEach(({ defs, refs }) => {
                    if (defs.length === 0 || refs.length === 0) return;

                    refs.forEach(refNode => {
                        const refRect = refNode.ref.getBoundingClientRect();

                        defs.forEach(defNode => {
                            const defRect = defNode.ref.getBoundingClientRect();

                            // Check if elements are visible/attached
                            if (refRect.width === 0 || defRect.width === 0) return;

                            // Calculate centers relative to canvas container
                            const start = {
                                x: refRect.left - canvasRect.left + refRect.width / 2,
                                y: refRect.top - canvasRect.top + refRect.height / 2
                            };
                            const end = {
                                x: defRect.left - canvasRect.left + defRect.width / 2,
                                y: defRect.top - canvasRect.top + defRect.height / 2
                            };

                            newLines.push({
                                id: `${nodeRegistry.current.get(refNode.ref)?.value}-${Math.random()}`,
                                x1: start.x,
                                y1: start.y,
                                x2: end.x,
                                y2: end.y
                            });
                        });
                    });
                });
            }

            setLines(newLines);
            frameRef.current = requestAnimationFrame(updateLines);
        };

        updateLines();
        return () => cancelAnimationFrame(frameRef.current);
    }, [documents, pan, zoom]); // Re-start loop if these change? Actually loop should just run always.
    // Dependencies: empty [] means run once. But we access `nodeRegistry` ref which is mutable. UseEffect is fine.

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

        setPan({ x: newPanX, y: newPanY });
        setZoom(newZoom);
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

        setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
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
                backgroundSize: `${20 * zoom}px ${20 * zoom}px`, // Scale grid
                backgroundPosition: `${pan.x}px ${pan.y}px`,    // Move grid
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
                                // We want this centered in the viewport, so we need to counter-act the transform
                                // Or just put it outside the transform container. 
                                // Putting it here means it moves with the canvas, which is consistent.
                                left: (window.innerWidth / 2 - pan.x) / zoom, // rough centering logic
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
                            />
                        ))}
                    </ConnectionContext.Provider>
                </div>
            </div>

            {/* Connection Lines Layer (Viewport coordinate space) */}
            <svg style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 5 // Below cards (cards are z-index 10 or 1000)
            }}>
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" fill="#fbbf24" opacity="0.5" />
                    </marker>
                </defs>
                {lines.map((line, i) => (
                    <line
                        key={i}
                        x1={line.x1}
                        y1={line.y1}
                        x2={line.x2}
                        y2={line.y2}
                        stroke="#fbbf24"
                        strokeWidth="2"
                        strokeOpacity="0.4"
                        markerEnd="url(#arrowhead)"
                    />
                ))}
            </svg>


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
                <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.1))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>-</button>
                <span style={{ minWidth: '40px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(z + 0.1, 5))} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', fontSize: '1.2rem' }}>+</button>
                <div style={{ width: '1px', height: '15px', background: 'rgba(255,255,255,0.2)' }}></div>
                <button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>Reset</button>
            </div>
        </div>
    );
};

export default Canvas;
