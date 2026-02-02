import React, { useState, useEffect } from 'react';

const SaveLoadModal = ({ isOpen, onClose, mode, onConfirm, existingSaves = [], onDelete, defaultFormat = 'json' }) => {
    const [name, setName] = useState('');
    const [selectedSave, setSelectedSave] = useState(null);
    const [exportFormat, setExportFormat] = useState('json'); // 'json' or 'html'

    useEffect(() => {
        if (isOpen) {
            setName('');
            setSelectedSave(null);
            setExportFormat(defaultFormat);
        }
    }, [isOpen, defaultFormat]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if ((mode === 'save' || mode === 'export') && name.trim()) {
            onConfirm(name.trim(), exportFormat);
        } else if (mode === 'load' && selectedSave) {
            onConfirm(selectedSave);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
        }}
            onClick={onClose}
        >
            <div style={{
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '400px',
                padding: '1.5rem',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem'
            }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>
                        {mode === 'save' ? 'Save Canvas' : mode === 'export' ? 'Export Canvas' : 'Load Canvas'}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {mode === 'save' || mode === 'export' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem' }}>{mode === 'export' ? 'Export Filename' : 'Save Name'}</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={mode === 'export' ? (exportFormat === 'html' ? "investigation" : "mongoDV-export") : "e.g. Project Alpha"}
                                    autoFocus
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        borderRadius: '6px',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        background: 'rgba(0,0,0,0.3)',
                                        color: 'white',
                                        fontSize: '1rem',
                                        outline: 'none'
                                    }}
                                />
                            </div>

                            {mode === 'export' && (
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#cbd5e1', fontSize: '0.9rem' }}>Format</label>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#e2e8f0' }}>
                                            <input
                                                type="radio"
                                                name="exportFormat"
                                                value="json"
                                                checked={exportFormat === 'json'}
                                                onChange={() => setExportFormat('json')}
                                            />
                                            JSON (Data Only)
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: '#e2e8f0' }}>
                                            <input
                                                type="radio"
                                                name="exportFormat"
                                                value="html"
                                                checked={exportFormat === 'html'}
                                                onChange={() => setExportFormat('html')}
                                            />
                                            HTML (Standalone Viewer)
                                        </label>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                                        {exportFormat === 'json'
                                            ? "Standard JSON export. Cannot be opened directly in browser."
                                            : "Compass-independent single file. Can be shared and opened offline."}
                                    </div>
                                </div>
                            )}

                            {existingSaves.length > 0 && (
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>Or replace existing save:</label>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {existingSaves.map((save) => (
                                            <div
                                                key={save.name}
                                                onClick={() => setName(save.name)}
                                                style={{
                                                    padding: '0.5rem 0.75rem',
                                                    borderRadius: '6px',
                                                    background: name === save.name ? 'rgba(96, 165, 250, 0.1)' : 'rgba(255,255,255,0.03)',
                                                    border: name === save.name ? '1px solid var(--primary)' : '1px solid transparent',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center'
                                                }}
                                            >
                                                <span style={{ color: name === save.name ? 'white' : '#cbd5e1', fontSize: '0.9rem' }}>{save.name}</span>
                                                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                                    {new Date(save.timestamp).toLocaleDateString()}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {existingSaves.length === 0 ? (
                                <div style={{ color: '#64748b', textAlign: 'center', padding: '2rem 0', fontStyle: 'italic' }}>
                                    No saved canvases found.
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {existingSaves.map((save) => (
                                        <div
                                            key={save.name}
                                            onClick={() => setSelectedSave(save.name)}
                                            style={{
                                                padding: '0.75rem',
                                                borderRadius: '6px',
                                                background: selectedSave === save.name ? 'rgba(96, 165, 250, 0.1)' : 'rgba(255,255,255,0.03)',
                                                border: selectedSave === save.name ? '1px solid var(--primary)' : '1px solid transparent',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <div>
                                                <div style={{ color: selectedSave === save.name ? 'white' : '#e2e8f0', fontWeight: 500 }}>
                                                    {save.name}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                                    {new Date(save.timestamp).toLocaleString()}
                                                </div>
                                            </div>
                                            {onDelete && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`Delete "${save.name}"?`)) {
                                                            onDelete(save.name);
                                                        }
                                                    }}
                                                    style={{
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#ef4444',
                                                        opacity: 0.7,
                                                        cursor: 'pointer',
                                                        padding: '4px'
                                                    }}
                                                    title="Delete save"
                                                >
                                                    🗑
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                background: 'transparent',
                                color: '#e2e8f0',
                                cursor: 'pointer'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={(mode === 'save' || mode === 'export') ? !name.trim() : !selectedSave}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: 'var(--primary)',
                                color: 'white',
                                cursor: ((mode === 'save' || mode === 'export') ? !name.trim() : !selectedSave) ? 'not-allowed' : 'pointer',
                                opacity: ((mode === 'save' || mode === 'export') ? !name.trim() : !selectedSave) ? 0.5 : 1,
                                fontWeight: 600
                            }}
                        >
                            {mode === 'save' || mode === 'export' ? 'Save/Export' : 'Load'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SaveLoadModal;
