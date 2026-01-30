import React, { useState } from 'react';

import { connectToMongo, listDatabases, listCollections, fetchDocuments, fetchSchema } from './api';
import DocumentCard from './components/DocumentCard';
import Canvas from './components/Canvas';
import QueryBuilder from './components/QueryBuilder';
import ConnectModal from './components/ConnectModal';
import SaveLoadModal from './components/SaveLoadModal';
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
  const [schema, setSchema] = useState({});
  const [collectionSearchTerm, setCollectionSearchTerm] = useState('');
  const [canvasDocuments, setCanvasDocuments] = useState([]);
  const [gapNodes, setGapNodes] = useState([]);
  const [canvasView, setCanvasView] = useState({ pan: { x: 0, y: 0 }, zoom: 1 });
  const [showCanvas, setShowCanvas] = useState(false);
  const [connectModalState, setConnectModalState] = useState({ isOpen: false, sourceId: null });
  const [saveLoadModalState, setSaveLoadModalState] = useState({ isOpen: false, mode: 'save', savedList: [] });

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
    setCollectionSearchTerm(''); // Reset search term

    if (!collections[dbName]) {
      try {
        const data = await listCollections(uri, dbName);
        setCollections(prev => ({ ...prev, [dbName]: data.collections }));
      } catch (err) {
        console.error("Failed to fetch collections:", err);
      }
    }
  };

  const getFilteredCollections = (dbName) => {
    if (!collections[dbName]) return [];
    return collections[dbName]
      .filter(col => col.name.toLowerCase().includes(collectionSearchTerm.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
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
    setShowCanvas(false);

    if (selectedCollection?.db === dbName && selectedCollection?.col === colName) {
      return;
    }

    setSelectedCollection({ db: dbName, col: colName });
    // Reset limit to default 20 when switching collections, or keep it? 
    // Let's keep it for now as it might be annoying to reset if user wants to browse with high limit.
    // Actually default to 20 is safer for performance.
    setLimit(20);

    // Fetch Documents
    await fetchCollectionDocuments(dbName, colName, 20);

    // Fetch Schema
    try {
      const schemaData = await fetchSchema(uri, dbName, colName);
      setSchema(schemaData.schema || {});
    } catch (err) {
      console.error("Failed to fetch schema:", err);
      setSchema({});
    }
  };

  const handleRunQuery = async (queryObject) => {
    if (!selectedCollection) return;

    setDocLoading(true);
    setDocError(null);
    setDocuments([]);
    try {
      const data = await fetchDocuments(uri, selectedCollection.db, selectedCollection.col, limit, queryObject);
      setDocuments(data.documents);
    } catch (err) {
      setDocError(err.message);
    } finally {
      setDocLoading(false);
    }
  };


  const handleRefresh = () => {
    if (selectedCollection) {
      fetchCollectionDocuments(selectedCollection.db, selectedCollection.col, limit);
    }
  };

  const handleAddToCanvas = (doc) => {
    if (!canvasDocuments.find(d => d._id === doc._id)) {
      setCanvasDocuments(prev => [...prev, {
        _id: doc._id || Math.random().toString(36).substr(2, 9),
        data: doc,
        collection: selectedCollection?.col || 'Unknown',
        x: 100 + (prev.length % 5) * 40,
        y: 100 + (prev.length % 5) * 40
      }]);
    }
    // Optional: Flash a notification or something?
  };

  const handleUpdateGapNodePosition = (id, x, y) => {
    setGapNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n));
  };

  const handleAddGapNode = (newNode) => {
    setGapNodes(prev => [...prev, newNode]);
  };

  const handleDeleteGapNode = (id) => {
    setGapNodes(prev => prev.filter(n => n.id !== id));
  };

  const handleUpdateCanvasPosition = (id, x, y) => {
    setCanvasDocuments(prev => prev.map(d =>
      d._id === id ? { ...d, x, y } : d
    ));
  };

  const handleCloneCanvasDocument = (id) => {
    const docToClone = canvasDocuments.find(d => d._id === id);
    if (!docToClone) return;

    const newDoc = {
      ...docToClone,
      _id: `${docToClone.data._id || 'doc'}-${Math.random().toString(36).substr(2, 9)}`,
      x: docToClone.x + 20,
      y: docToClone.y + 20
    };

    setCanvasDocuments(prev => [...prev, newDoc]);
  };

  const handleDeleteCanvasDocument = (id) => {
    setCanvasDocuments(prev => prev.filter(d => d._id !== id));
  };

  const handleConnectRequest = (id) => {
    setConnectModalState({ isOpen: true, sourceId: id });
  };

  const handleConnectSubmit = (newDocs, collectionName) => {
    if (!newDocs || newDocs.length === 0) return;

    // Add new docs to canvas
    // TODO: Ideally position them near the source card, but for now just random/cascade
    setCanvasDocuments(prev => {
      const existingIds = new Set(prev.map(d => d._id));
      const addedDocs = newDocs
        .filter(d => !existingIds.has(d._id))
        .map((doc, idx) => ({
          _id: doc._id || Math.random().toString(36).substr(2, 9),
          data: doc,
          collection: collectionName || 'Unknown',
          x: 200 + (prev.length % 5) * 40 + idx * 20, // Offset slightly
          y: 200 + (prev.length % 5) * 40 + idx * 20
        }));
      return [...prev, ...addedDocs];
    });
  };

  const getSavesFromStorage = () => {
    try {
      const raw = localStorage.getItem('mongoDV_saves_v1');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error("Failed to read saves", e);
      return {};
    }
  };

  const handleOpenSaveModal = () => {
    const saves = getSavesFromStorage();
    const list = Object.entries(saves).map(([name, data]) => ({
      name,
      timestamp: data.timestamp
    })).sort((a, b) => b.timestamp - a.timestamp);
    setSaveLoadModalState({ isOpen: true, mode: 'save', savedList: list });
  };

  const handleOpenLoadModal = () => {
    const saves = getSavesFromStorage();
    const list = Object.entries(saves).map(([name, data]) => ({
      name,
      timestamp: data.timestamp
    })).sort((a, b) => b.timestamp - a.timestamp);

    setSaveLoadModalState({ isOpen: true, mode: 'load', savedList: list });
  };

  const handleConfirmSave = (name) => {
    const saves = getSavesFromStorage();
    // Save current state
    saves[name] = {
      documents: canvasDocuments,
      gapNodes: gapNodes,
      view: canvasView,
      timestamp: Date.now()
    };
    localStorage.setItem('mongoDV_saves_v1', JSON.stringify(saves));
    setSaveLoadModalState(prev => ({ ...prev, isOpen: false }));
    // Optional: Toast or notification
  };

  const handleConfirmLoad = (name) => {
    const saves = getSavesFromStorage();
    const save = saves[name];
    if (save) {
      if (save.documents) setCanvasDocuments(save.documents);
      if (save.gapNodes) setGapNodes(save.gapNodes);
      if (save.view) setCanvasView(save.view);
    }
    setSaveLoadModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleDeleteSave = (name) => {
    const saves = getSavesFromStorage();
    delete saves[name];
    localStorage.setItem('mongoDV_saves_v1', JSON.stringify(saves));

    // Refresh list
    const list = Object.entries(saves).map(([name, data]) => ({
      name,
      timestamp: data.timestamp
    })).sort((a, b) => b.timestamp - a.timestamp);
    setSaveLoadModalState(prev => ({ ...prev, savedList: list }));
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
        <div style={{ paddingBottom: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--glass-border)' }}>
          <button
            onClick={() => setShowCanvas(!showCanvas)}
            style={{
              width: '100%',
              padding: '0.75rem',
              background: showCanvas ? 'var(--primary)' : 'rgba(255,255,255,0.03)',
              color: showCanvas ? 'white' : '#cbd5e1',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s',
              fontWeight: 500
            }}
            onMouseEnter={e => !showCanvas && (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            onMouseLeave={e => !showCanvas && (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>🎨</span>
              <span>Canvas</span>
            </div>
            <span style={{ fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '12px' }}>
              {canvasDocuments.length}
            </span>
          </button>
        </div>

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
                    <>
                      <input
                        type="text"
                        placeholder="Search collections..."
                        value={collectionSearchTerm}
                        onChange={(e) => setCollectionSearchTerm(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: '100%',
                          padding: '0.5rem',
                          marginBottom: '0.5rem',
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: '4px',
                          color: '#e2e8f0',
                          fontSize: '0.8rem',
                          outline: 'none'
                        }}
                      />
                      {getFilteredCollections(db.name).map(col => (
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
                      ))}
                    </>
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
            {showCanvas ? (
              <Canvas
                documents={canvasDocuments}
                gapNodes={gapNodes}
                viewState={canvasView}
                onViewStateChange={setCanvasView}
                onUpdatePosition={handleUpdateCanvasPosition}
                onUpdateGapNodePosition={handleUpdateGapNodePosition}
                onAddGapNode={handleAddGapNode}
                onDeleteGapNode={handleDeleteGapNode}
                onConnect={handleConnectRequest}
                onClone={handleCloneCanvasDocument}
                onDelete={handleDeleteCanvasDocument}
                onSave={handleOpenSaveModal}
                onLoad={handleOpenLoadModal}
              />
            ) : selectedCollection ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h1 style={{ fontSize: '1.5rem', background: 'linear-gradient(to right, #e2e8f0, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
                      {selectedCollection.col}
                    </h1>
                  </div>
                </div>

                <QueryBuilder schema={schema} onRunQuery={handleRunQuery} />

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
                        maxHeight: '1000px',
                        resize: 'both',
                        minWidth: '300px',
                        minHeight: '100px',
                        position: 'relative'
                      }}>
                        <button
                          onClick={() => handleAddToCanvas(doc)}
                          title="Send to Canvas"
                          style={{
                            position: 'absolute',
                            top: '10px',
                            right: '10px',
                            background: 'rgba(255,255,255,0.05)',
                            border: '1px solid var(--glass-border)',
                            color: '#94a3b8',
                            borderRadius: '4px',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            zIndex: 5
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--primary)';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                            e.currentTarget.style.color = '#94a3b8';
                          }}
                        >
                          ⇱
                        </button>
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
                  <h2>Select a collection or open Canvas</h2>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <ConnectionScreen />
      )
      }
      <ConnectModal
        isOpen={connectModalState.isOpen}
        onClose={() => setConnectModalState({ ...connectModalState, isOpen: false })}
        sourceId={connectModalState.sourceId}
        initialUri={uri}
        onConnect={handleConnectSubmit}
      />
      <SaveLoadModal
        isOpen={saveLoadModalState.isOpen}
        onClose={() => setSaveLoadModalState(prev => ({ ...prev, isOpen: false }))}
        mode={saveLoadModalState.mode}
        existingSaves={saveLoadModalState.savedList}
        onConfirm={saveLoadModalState.mode === 'save' ? handleConfirmSave : handleConfirmLoad}
        onDelete={handleDeleteSave}
      />
    </div >
  );
}

export default App;
