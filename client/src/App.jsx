import React, { useState } from 'react';

import { connectToMongo, listDatabases, listCollections, fetchDocuments, fetchSchema } from './api';
import DocumentCard from './components/DocumentCard';
import './index.css';

function App() {

  const [uri, setUri] = useState('mongodb://localhost:27017');
  const [isConnected, setIsConnected] = useState(false);
  const [databases, setDatabases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedDb, setExpandedDb] = useState(null);
  const [collections, setCollections] = useState({});
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState(null);
  const [limit, setLimit] = useState(20);
  const [schemaKeys, setSchemaKeys] = useState([]);
  const [queryFilters, setQueryFilters] = useState([]); // Array of { field, operator, value }

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await connectToMongo(uri);
      const data = await listDatabases(uri);
      setDatabases(data.databases);
      setIsConnected(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDbClick = async (dbName) => {
    if (expandedDb === dbName) {
      setExpandedDb(null);
      return;
    }

    setExpandedDb(dbName);
    setSelectedCollection(null); // Reset selection when switching DBs

    if (!collections[dbName]) {
      try {
        const data = await listCollections(uri, dbName);
        setCollections(prev => ({ ...prev, [dbName]: data.collections }));
      } catch (err) {
        console.error("Failed to fetch collections:", err);
      }
    }
  };

  const fetchCollectionDocuments = async (dbName, colName, currentLimit) => {
    setDocLoading(true);
    setDocError(null);
    setDocuments([]);
    try {
      const data = await fetchDocuments(uri, dbName, colName, currentLimit);
      setDocuments(data.documents);
    } catch (err) {
      setDocError(err.message);
    } finally {
      setDocLoading(false);
    }
  };

  const handleCollectionClick = async (dbName, colName) => {
    setSelectedCollection({ db: dbName, col: colName });
    // Reset limit to default 20 when switching collections, or keep it? 
    // Let's keep it for now as it might be annoying to reset if user wants to browse with high limit.
    // Actually default to 20 is safer for performance.
    setLimit(20);
    // Reset filters
    setQueryFilters([]);

    // Fetch Documents
    await fetchCollectionDocuments(dbName, colName, 20);

    // Fetch Schema
    try {
      const schemaData = await fetchSchema(uri, dbName, colName);
      setSchemaKeys(schemaData.keys || []);
    } catch (err) {
      console.error("Failed to fetch schema:", err);
      setSchemaKeys([]);
    }
  };

  const handleRunQuery = async () => {
    if (!selectedCollection) return;

    // Construct query object
    const query = {};
    queryFilters.forEach(filter => {
      if (filter.field && filter.value !== '') {
        // Simple equality for now. 
        // TODO: Add support for $gt, $lt, etc. based on operator
        // If value looks like a number, try to parse it? For now, keep as string/inferred.
        // Let's try to be smart: if it looks like number, parse it.
        let val = filter.value;
        if (!isNaN(val) && val.trim() !== '') {
          val = Number(val);
        }

        if (filter.operator === '=') {
          query[filter.field] = val;
        } else if (filter.operator === '!=') {
          query[filter.field] = { $ne: val };
        } else if (filter.operator === '>') {
          query[filter.field] = { $gt: val };
        } else if (filter.operator === '>=') {
          query[filter.field] = { $gte: val };
        } else if (filter.operator === '<') {
          query[filter.field] = { $lt: val };
        } else if (filter.operator === '<=') {
          query[filter.field] = { $lte: val };
        }
      }
    });

    setDocLoading(true);
    setDocError(null);
    setDocuments([]);
    try {
      const data = await fetchDocuments(uri, selectedCollection.db, selectedCollection.col, limit, query);
      setDocuments(data.documents);
    } catch (err) {
      setDocError(err.message);
    } finally {
      setDocLoading(false);
    }
  };

  const addFilter = () => {
    setQueryFilters([...queryFilters, { field: schemaKeys[0] || '', operator: '=', value: '' }]);
  };

  const removeFilter = (index) => {
    const newFilters = [...queryFilters];
    newFilters.splice(index, 1);
    setQueryFilters(newFilters);
  };

  const updateFilter = (index, key, val) => {
    const newFilters = [...queryFilters];
    newFilters[index][key] = val;
    setQueryFilters(newFilters);
  };

  const handleRefresh = () => {
    if (selectedCollection) {
      fetchCollectionDocuments(selectedCollection.db, selectedCollection.col, limit);
    }
  };

  const Sidebar = () => (
    <div style={{
      width: '300px',
      background: 'var(--panel-bg)',
      borderRight: '1px solid var(--glass-border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '1rem',
      height: '100%'
    }}>
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary)' }}>MongoDB Manager</h2>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Connected to:</div>
        <div style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={uri}>
          {uri.replace(/\/\/([^:]+:[^@]+@)?/, '//***@')}
        </div>
        <button
          onClick={() => setIsConnected(false)}
          style={{
            marginTop: '0.5rem',
            background: 'transparent',
            border: '1px solid var(--glass-border)',
            color: '#94a3b8',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.8rem'
          }}
        >
          Disconnect
        </button>
      </div>


      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h3 style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '1rem' }}>DATABASES</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {databases.map((db) => (
            <div key={db.name}>
              <div style={{
                padding: '0.75rem',
                background: expandedDb === db.name ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                borderRadius: '6px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                border: expandedDb === db.name ? '1px solid var(--primary)' : '1px solid transparent'
              }}
                onClick={() => handleDbClick(db.name)}
                onMouseEnter={(e) => {
                  if (expandedDb !== db.name) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                }}
                onMouseLeave={(e) => {
                  if (expandedDb !== db.name) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                }}
              >
                <span style={{ fontWeight: 500 }}>{db.name}</span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{(db.sizeOnDisk / 1024 / 1024).toFixed(0)} MB</span>
              </div>

              {expandedDb === db.name && (
                <div style={{
                  marginLeft: '1rem',
                  paddingLeft: '1rem',
                  borderLeft: '1px solid var(--glass-border)',
                  marginTop: '0.5rem',
                  marginBottom: '0.5rem'
                }}>
                  {collections[db.name] ? (
                    collections[db.name].map(col => (
                      <div key={col.name} style={{
                        padding: '0.5rem',
                        fontSize: '0.9rem',
                        color: selectedCollection?.col === col.name && selectedCollection?.db === db.name ? 'var(--primary)' : '#cbd5e1',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        background: selectedCollection?.col === col.name && selectedCollection?.db === db.name ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
                        fontWeight: selectedCollection?.col === col.name && selectedCollection?.db === db.name ? 500 : 400
                      }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCollectionClick(db.name, col.name);
                        }}
                        onMouseEnter={(e) => {
                          if (selectedCollection?.col !== col.name || selectedCollection?.db !== db.name)
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                        }}
                        onMouseLeave={(e) => {
                          if (selectedCollection?.col !== col.name || selectedCollection?.db !== db.name)
                            e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        📄 {col.name}
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                      Loading collections...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const ConnectionScreen = () => (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)'
    }}>
      <form onSubmit={handleConnect} style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--glass-border)',
        padding: '3rem',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '500px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <h1 style={{ textAlign: 'center', marginBottom: '2rem', background: 'linear-gradient(to right, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Connect to MongoDB
        </h1>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', color: '#94a3b8' }}>Connection String</label>
          <input
            type="text"
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            placeholder="mongodb://localhost:27017"
            style={{
              width: '100%',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--glass-border)',
              background: 'rgba(0, 0, 0, 0.2)',
              color: 'white',
              fontSize: '1rem',
              outline: 'none'
            }}
            onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
            onBlur={(e) => e.target.style.borderColor = 'var(--glass-border)'}
          />
        </div>

        {error && (
          <div style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#f87171',
            borderRadius: '8px',
            fontSize: '0.9rem'
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '1rem',
            background: 'linear-gradient(to right, var(--primary), var(--accent))',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: 600,
            opacity: loading ? 0.7 : 1,
            transform: 'translateY(0)',
            transition: 'transform 0.1s'
          }}
          onMouseDown={(e) => !loading && (e.currentTarget.style.transform = 'translateY(2px)')}
          onMouseUp={(e) => !loading && (e.currentTarget.style.transform = 'translateY(0)')}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </form>
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex' }}>
      {isConnected ? (
        <>
          <Sidebar />
          <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
            {selectedCollection ? (
              <div>
                {/* Query Builder Section */}
                <div style={{ marginBottom: '2rem', background: 'var(--panel-bg)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: '#e2e8f0' }}>Query Builder</h3>
                    <button onClick={addFilter} style={{
                      background: 'rgba(255,255,255,0.1)', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.9rem'
                    }}>+ Add Filter</button>
                  </div>

                  {queryFilters.length === 0 && (
                    <div style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic', marginBottom: '1rem' }}>
                      No filters active. Showing all documents.
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1.5rem' }}>
                    {queryFilters.map((filter, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select
                          value={filter.field}
                          onChange={(e) => updateFilter(idx, 'field', e.target.value)}
                          style={{
                            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', flex: 1
                          }}
                        >
                          {schemaKeys.map(key => <option key={key} value={key}>{key}</option>)}
                          {!schemaKeys.includes(filter.field) && filter.field && <option value={filter.field}>{filter.field}</option>}
                        </select>

                        <select
                          value={filter.operator}
                          onChange={(e) => updateFilter(idx, 'operator', e.target.value)}
                          style={{
                            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', width: '80px'
                          }}
                        >
                          <option value="=">=</option>
                          <option value="!=">!=</option>
                          <option value=">">&gt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<">&lt;</option>
                          <option value="<=">&lt;=</option>
                        </select>

                        <input
                          type="text"
                          placeholder="Value"
                          value={filter.value}
                          onChange={(e) => updateFilter(idx, 'value', e.target.value)}
                          style={{
                            background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', flex: 1
                          }}
                        />

                        <button onClick={() => removeFilter(idx)} style={{
                          background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>✕</button>
                      </div>
                    ))}
                  </div>

                  <button onClick={handleRunQuery} style={{
                    background: 'linear-gradient(to right, var(--primary), var(--accent))', color: 'white', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer'
                  }}>
                    Run Query
                  </button>
                </div>

                <div style={{ marginBottom: '1.5rem', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ opacity: 0.5 }}>Documents in</span>
                  <span style={{ color: 'var(--primary)' }}>{selectedCollection.col}</span>
                  <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', color: '#94a3b8' }}>
                    {documents.length} results
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Limit:</label>
                    <input
                      type="number"
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      style={{
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid var(--glass-border)',
                        color: '#cbd5e1',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        width: '60px',
                        textAlign: 'center'
                      }}
                    />
                    <button
                      onClick={handleRefresh}
                      disabled={docLoading}
                      style={{
                        background: 'var(--primary)',
                        color: 'white',
                        border: 'none',
                        padding: '0.25rem 0.75rem',
                        borderRadius: '4px',
                        cursor: docLoading ? 'not-allowed' : 'pointer',
                        opacity: docLoading ? 0.7 : 1,
                        fontSize: '0.8rem'
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {docError && (
                  <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: '8px', marginBottom: '1rem' }}>
                    {docError}
                  </div>
                )}

                {docLoading ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                    Loading documents...
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                    {documents.map((doc, idx) => (
                      <div key={doc._id || idx} style={{
                        background: 'var(--panel-bg)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '8px',
                        padding: '1rem',
                        fontSize: '0.9rem',
                        overflow: 'auto',
                        maxHeight: '400px'
                      }}>
                        <DocumentCard data={doc} isRoot={true} />
                      </div>
                    ))}
                    {documents.length === 0 && !docError && (
                      <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: '#64748b', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px dashed var(--glass-border)' }}>
                        No documents found in this collection.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#475569' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: 0.2 }}>🍃</div>
                  <h2>Select a collection to view documents</h2>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <ConnectionScreen />
      )
      }
    </div >
  );
}

export default App;
