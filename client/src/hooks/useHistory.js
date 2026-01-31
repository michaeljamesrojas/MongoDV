import { useState, useCallback } from 'react';

const useHistory = (initialState, maxHistory = 50) => {
    const [past, setPast] = useState([]);
    const [future, setFuture] = useState([]);

    const record = useCallback((currentState) => {
        setPast(prev => {
            const newPast = [...prev, currentState];
            if (newPast.length > maxHistory) {
                return newPast.slice(newPast.length - maxHistory);
            }
            return newPast;
        });
        setFuture([]);
    }, [maxHistory]);

    const undo = useCallback((currentState) => {
        if (past.length === 0) return currentState;

        const previous = past[past.length - 1];
        const newPast = past.slice(0, past.length - 1);

        setPast(newPast);
        setFuture(prev => [currentState, ...prev]);

        return previous;
    }, [past]);

    const redo = useCallback((currentState) => {
        if (future.length === 0) return currentState;


        const next = future[0];
        const newFuture = future.slice(1);

        setPast(prev => [...prev, currentState]);
        setFuture(newFuture);

        return next;
    }, [future]);

    return {
        record,
        undo,
        redo,
        canUndo: past.length > 0,
        canRedo: future.length > 0,
        clear: useCallback(() => {
            setPast([]);
            setFuture([]);
        }, [])
    };
};

export default useHistory;
