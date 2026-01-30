const API_BASE = 'http://localhost:3001/api';

export const connectToMongo = async (uri) => {
    const response = await fetch(`${API_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to connect');
    }
    return response.json();
};


export const listDatabases = async (uri) => {
    const response = await fetch(`${API_BASE}/databases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to list databases');
    }
    return response.json();
};

export const listCollections = async (uri, dbName) => {
    const response = await fetch(`${API_BASE}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, dbName }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to list collections');
    }
    return response.json();
};

export const fetchDocuments = async (uri, dbName, colName, limit = 20) => {
    const response = await fetch(`${API_BASE}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uri, dbName, colName, limit }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch documents');
    }
    return response.json();
};
