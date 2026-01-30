import React, { useState, useEffect, useRef } from 'react';
import DocumentCard from './DocumentCard';

const DraggableCard = ({ doc, onUpdatePosition, zoom }) => {
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
                <DocumentCard data={doc.data} isRoot={false} />
            </div>
        </div>
    );
};

const Canvas = ({ documents, onUpdatePosition }) => {
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [isPanning, setIsPanning] = useState(false);

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
        <div style={{
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
                        />
                    ))}
                </div>
            </div>

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
