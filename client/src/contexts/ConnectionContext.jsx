import { createContext, useContext } from 'react';

export const ConnectionContext = createContext({
    registerNode: (id, type, ref) => { },
    unregisterNode: (id, type) => { },
    markedSources: new Set(),
    toggleMarkAsSource: (docId, path) => { },
    highlightedFields: new Set(),
    toggleHighlight: (collection, path) => { }
});

export const useConnection = () => useContext(ConnectionContext);
