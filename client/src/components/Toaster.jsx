import React from 'react';
import { useToast } from '../contexts/ToastContext';

const Toaster = () => {
    const { toasts, removeToast } = useToast();

    return (
        <div style={{
            position: 'fixed',
            bottom: '2rem',
            right: '2rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            zIndex: 10000,
            pointerEvents: 'none'
        }}>
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`toast toast-${toast.type}`}
                    style={{
                        pointerEvents: 'auto',
                        background: getToastBackground(toast.type),
                        color: 'white',
                        padding: '0.75rem 1.5rem',
                        borderRadius: '12px',
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.4)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '1rem',
                        minWidth: '200px',
                        animation: 'toast-in 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)',
                        cursor: 'pointer'
                    }}
                    onClick={() => removeToast(toast.id)}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{getToastIcon(toast.type)}</span>
                        <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{toast.message}</span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            removeToast(toast.id);
                        }}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'rgba(255, 255, 255, 0.6)',
                            fontSize: '1.2rem',
                            lineHeight: 1,
                            padding: '0 0 2px 0',
                            cursor: 'pointer'
                        }}
                    >
                        &times;
                    </button>
                </div>
            ))}
        </div>
    );
};

const getToastBackground = (type) => {
    switch (type) {
        case 'success': return 'rgba(34, 197, 94, 0.9)';
        case 'error': return 'rgba(239, 68, 68, 0.9)';
        case 'warning': return 'rgba(245, 158, 11, 0.9)';
        case 'info':
        default: return 'rgba(59, 130, 246, 0.9)';
    }
};

const getToastIcon = (type) => {
    switch (type) {
        case 'success': return '✅';
        case 'error': return '❌';
        case 'warning': return '⚠️';
        case 'info':
        default: return 'ℹ️';
    }
};

export default Toaster;
