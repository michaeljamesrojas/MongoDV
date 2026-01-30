import { createContext, useContext } from 'react';

export const ConnectionContext = createContext({
    registerNode: (id, type, ref) => { },
    unregisterNode: (id, type) => { },
});

export const useConnection = () => useContext(ConnectionContext);
