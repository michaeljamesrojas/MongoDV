import { useRef } from 'react';

export const useDragAwareClick = (onClick, threshold = 5) => {
    const startPos = useRef({ x: 0, y: 0 });

    const onMouseDown = (e) => {
        startPos.current = { x: e.clientX, y: e.clientY };
    };

    const handleClick = (e, ...args) => {
        const dx = Math.abs(e.clientX - startPos.current.x);
        const dy = Math.abs(e.clientY - startPos.current.y);

        // If moved more than threshold, treat as drag and ignore click
        if (dx > threshold || dy > threshold) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        if (onClick) {
            onClick(e, ...args);
        }
    };

    return { onMouseDown, onClick: handleClick };
};
