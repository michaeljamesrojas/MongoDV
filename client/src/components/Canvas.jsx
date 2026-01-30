import React, { useState, useEffect, useRef } from 'react';
import DocumentCard from './DocumentCard';

const DraggableCard = ({ doc, onUpdatePosition }) => {
    const [position, setPosition] = useState({ x: doc.x, y: doc.y });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const cardRef = useRef(null);

    // Sync local state when prop changes (e.g. initial load or external reset)
    useEffect(() => {
        setPosition({ x: doc.x, y: doc.y });
    }, [doc.x, doc.y]);

    const handleMouseDown = (e) => {
        if (e.target.closest('button') || e.target.closest('.collapsible-header')) {
            // Prevent dragging when interacting with internal elements if needed, 
            // though DocumentCard handles its own clicks. 
            // We'll see if this is needed. For now, let's allow dragging from anywhere 
            // on the card unless it's a specific interactive element.
            // Actually, better to only allow dragging from a "handle" or the border/background.
            // Let's try general dragging first but stop propagation if needed.
        }

        setIsDragging(true);
        const rect = cardRef.current.getBoundingClientRect();
        dragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };

        // Prevent text selection while dragging
        document.body.style.userSelect = 'none';

        // Add global listeners
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        // Calculate new position relative to the canvas container
        // We assume the canvas container is the offset parent or we use absolute coordinates
        // For simplicity, let's assume the parent <Canvas> is positioned relative 
        // and we are positioning absolute relative to it.
        // We need to account for the canvas's own offset if we used client coordinates directly.
        // However, since we are just updating the 'left' and 'top', 
        // we can calculate the new 'left' = currentMouseX - startMouseX + startLeft
        // Or simpler: newLeft = currentMouseX - parentLeft - offsetX

        // Let's rely on deltas to be safe or just use the offset we calculated.

        const parentRect = cardRef.current.parentElement.getBoundingClientRect();

        const newX = e.clientX - parentRect.left - dragOffset.current.x;
        const newY = e.clientY - parentRect.top - dragOffset.current.y;

        setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = (e) => {
        setIsDragging(false);
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // Commit the final position
        // We need to re-calculate one last time or just use the current state
        // But since state update is async, 'position' in this closure might be stale 
        // if we just relied on closure capture without refs.
        // Actually handleMouseMove updates state, so we can just read the LAST computed value.
        // But wait, handleMouseMove doesn't return the value.
        // Let's recalculate exactly as we did in mousemove.

        const parentRect = cardRef.current.parentElement.getBoundingClientRect();
        const newX = e.clientX - parentRect.left - dragOffset.current.x;
        const newY = e.clientY - parentRect.top - dragOffset.current.y;

        onUpdatePosition(doc._id, newX, newY);
    };

    // Set initial width directly on DOM to allow native resize without React interference
    useEffect(() => {
        if (cardRef.current && !cardRef.current.style.width) {
            cardRef.current.style.width = '350px';
        }
    }, []);

    return (
        <div
            ref={cardRef}
            style={{
                position: 'absolute',
                left: position.x,
                top: position.y,
                // width is handled by ref/native resize
                zIndex: isDragging ? 1000 : 10,
                boxShadow: isDragging ? '0 10px 25px rgba(0,0,0,0.5)' : '0 4px 6px rgba(0,0,0,0.1)',
                transition: isDragging ? 'none' : 'box-shadow 0.2s',
                background: 'var(--panel-bg)',
                borderRadius: '8px',
                border: '1px solid var(--glass-border)',
                padding: '1rem',
                maxHeight: '400px',
                overflow: 'auto',
                resize: 'both',
                minWidth: '200px',
                minHeight: '100px',
                display: 'flex',
                flexDirection: 'column'
            }}
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
                    userSelect: 'none'
                }}
            >
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
                    ID: {doc.data._id || 'Unknown'}
                </span>
                <div style={{ fontSize: '1rem', opacity: 0.5 }}>⠿</div>
            </div>

            {/* Content area */}
            <div style={{ flex: 1 }}>
                <DocumentCard data={doc.data} isRoot={false} />
            </div>
        </div>
    );
};

const Canvas = ({ documents, onUpdatePosition }) => {
    return (
        <div style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'auto',
            background: 'radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.05) 1px, transparent 0)',
            backgroundSize: '20px 20px',
            backgroundColor: '#0f172a'
        }}>
            <div style={{
                // Infinite canvas simulation - just make it big enough for now
                minWidth: '2000px',
                minHeight: '2000px',
                position: 'relative'
            }}>
                {documents.length === 0 ? (
                    <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center',
                        color: '#475569',
                        pointerEvents: 'none'
                    }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>⧉</div>
                        <h3>Canvas is empty</h3>
                        <p style={{ fontSize: '0.9rem' }}>Send documents here from the collection view</p>
                    </div>
                ) : (
                    documents.map(doc => (
                        <DraggableCard
                            key={doc._id}
                            doc={doc}
                            onUpdatePosition={onUpdatePosition}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default Canvas;
