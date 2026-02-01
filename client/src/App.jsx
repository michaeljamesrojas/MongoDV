import React, { useState, useCallback } from 'react';

import { connectToMongo, listDatabases, listCollections, fetchDocuments, fetchSchema } from './api';
import DocumentCard from './components/DocumentCard';
import Canvas from './components/Canvas';
import QueryBuilder from './components/QueryBuilder';
import ConnectModal from './components/ConnectModal';
import SaveLoadModal from './components/SaveLoadModal';
import Toaster from './components/Toaster';
import { useToast } from './contexts/ToastContext';
import useHistory from './hooks/useHistory';
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
  const [connectionHistoryVersion, setConnectionHistoryVersion] = useState(0);
  const [gapNodes, setGapNodes] = useState([]);
  const [textNodes, setTextNodes] = useState([]); // Array of { id, x, y, text, width, height, dimmed }
  const [imageNodes, setImageNodes] = useState([]); // Array of { id, x, y, src, width, height, dimmed, originalSize, compressedSize }
  const [diffNodes, setDiffNodes] = useState([]); // Array of { id, x, y, sourceDocId, targetDocId, dimmed }
  const [canvasView, setCanvasView] = useState({ pan: { x: 0, y: 0 }, zoom: 1 });
  const [markedSources, setMarkedSources] = useState(new Set()); // Set<"collection:path">
  const [highlightedFields, setHighlightedFields] = useState(new Set()); // Set<"collection:path">
  const [hoistedFields, setHoistedFields] = useState(new Set()); // Set<"collection:path">
  const [arrowDirection, setArrowDirection] = useState('forward'); // 'forward' | 'reverse'
  const [showBackdroppedArrows, setShowBackdroppedArrows] = useState(true);
  const [showAllArrows, setShowAllArrows] = useState(true);
  const [showCanvas, setShowCanvas] = useState(false);
  const [connectModalState, setConnectModalState] = useState({ isOpen: false, sourceId: null });
  const [saveLoadModalState, setSaveLoadModalState] = useState({ isOpen: false, mode: 'save', savedList: [] });
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [currentSaveName, setCurrentSaveName] = useState(null); // Track which save is currently loaded
  const [idColorOverrides, setIdColorOverrides] = useState({}); // { [id]: variationIndex }
  const [selectedIds, setSelectedIds] = useState([]); // Lifted state from Canvas

  const { showToast } = useToast();
  // History Logic
  const history = useHistory.default ? useHistory.default() : useHistory(); // Handle potential default import issues if any

  // Helper: Create a snapshot of the current canvas state
  const getCanvasSnapshot = useCallback((includeView = false) => {
    return {
      documents: canvasDocuments,
      gapNodes: gapNodes,
      textNodes: textNodes,
      imageNodes: imageNodes,
      diffNodes: diffNodes,
      markedSources: new Set(markedSources), // Copy Set
      highlightedFields: new Set(highlightedFields), // Copy Set
      hoistedFields: new Set(hoistedFields), // Copy Set
      arrowDirection: arrowDirection,
      showBackdroppedArrows: showBackdroppedArrows,
      showAllArrows: showAllArrows,
      idColorOverrides: { ...idColorOverrides },
      // Optional view state (included for File Saves, excluded for Undo/Redo)
      view: includeView ? canvasView : undefined
    };
  }, [canvasDocuments, gapNodes, textNodes, imageNodes, diffNodes, markedSources, highlightedFields, hoistedFields, arrowDirection, showBackdroppedArrows, showAllArrows, idColorOverrides, canvasView]);

  // Helper: Restore state from a snapshot
  const restoreCanvasSnapshot = useCallback((snapshot, includeView = false) => {
    if (!snapshot) return;

    // Batch updates where possible (React 18 does this auto, but good to be explicit/ordered)
    if (snapshot.documents) setCanvasDocuments(snapshot.documents);
    if (snapshot.gapNodes) setGapNodes(snapshot.gapNodes);
    if (snapshot.textNodes) setTextNodes(snapshot.textNodes);
    if (snapshot.imageNodes) setImageNodes(snapshot.imageNodes);
    if (snapshot.diffNodes) setDiffNodes(snapshot.diffNodes);

    // Sets need to be restored as Sets
    if (snapshot.markedSources) setMarkedSources(snapshot.markedSources instanceof Set ? snapshot.markedSources : new Set(snapshot.markedSources));
    if (snapshot.highlightedFields) setHighlightedFields(snapshot.highlightedFields instanceof Set ? snapshot.highlightedFields : new Set(snapshot.highlightedFields));
    if (snapshot.hoistedFields) setHoistedFields(snapshot.hoistedFields instanceof Set ? snapshot.hoistedFields : new Set(snapshot.hoistedFields));

    if (snapshot.arrowDirection) setArrowDirection(snapshot.arrowDirection);
    if (snapshot.showBackdroppedArrows !== undefined) setShowBackdroppedArrows(snapshot.showBackdroppedArrows);
    if (snapshot.showAllArrows !== undefined) setShowAllArrows(snapshot.showAllArrows);
    if (snapshot.idColorOverrides) setIdColorOverrides(snapshot.idColorOverrides);
    else setIdColorOverrides({});

    if (includeView && snapshot.view) {
      setCanvasView(snapshot.view);
    }
  }, []);

  // Record history point
  const saveHistoryPoint = useCallback(() => {
    // We snapshot immediately BEFORE the change. 
    // Wait, the standard "undo" pattern is: 
    // Stack contains [State A, State B]. Current is State C.
    // Undo -> restore State B. Stack [State A]. Future [State C].
    // So we record the *current* state before mutating it.
    history.record(getCanvasSnapshot(false));
  }, [history, getCanvasSnapshot]);

  const handleUndo = useCallback(() => {
    if (!history.canUndo) return;
    const previousState = history.undo(getCanvasSnapshot(false));
    if (previousState) {
      restoreCanvasSnapshot(previousState, false);
      showToast('Undo', 'info', 1000);
    }
  }, [history, getCanvasSnapshot, restoreCanvasSnapshot, showToast]);

  const handleRedo = useCallback(() => {
    if (!history.canRedo) return;
    const nextState = history.redo(getCanvasSnapshot(false));
    if (nextState) {
      restoreCanvasSnapshot(nextState, false);
      showToast('Redo', 'info', 1000);
    }
  }, [history, getCanvasSnapshot, restoreCanvasSnapshot, showToast]);

  // Keyboard Shortcuts for Undo/Redo
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      // Check for Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          // Redo: Ctrl+Shift+Z
          e.preventDefault();
          handleRedo();
        } else {
          // Undo: Ctrl+Z
          e.preventDefault();
          handleUndo();
        }
      }
      // Redo: Ctrl+Y
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);


  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await connectToMongo(uri);
      const data = await listDatabases(uri);
      setDatabases(data.databases);
      setIsConnected(true);
      showToast('Connected successfully', 'success');
    } catch (err) {
      setError(err.message);
      showToast('Failed to connect', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOfflineMode = () => {
    setIsOfflineMode(true);
    setIsConnected(true);
    setShowCanvas(true);
    setDatabases([]);
    setCollections({});
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

  const handleAddToCanvas = useCallback((doc) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => {
      if (prev.find(d => d._id === doc._id)) return prev;

      // Calculate center of current viewport
      const W = window.innerWidth - 300; // Sidebar is 300px
      const H = window.innerHeight;
      const centerX = (W / 2 - canvasView.pan.x) / canvasView.zoom;
      const centerY = (H / 2 - canvasView.pan.y) / canvasView.zoom;

      showToast('Added to canvas', 'success', 2000);
      return [...prev, {
        _id: doc._id || Math.random().toString(36).substr(2, 9),
        data: doc,
        collection: selectedCollection?.col || 'Unknown',
        x: centerX - 175, // Center the 350px card
        y: centerY - 100,
        width: 350,
        height: null,
        expandedPaths: []
      }];
    });
  }, [selectedCollection, canvasView, showToast, saveHistoryPoint]);

  const handleAddCustomDocument = useCallback((data, x, y) => {
    saveHistoryPoint();
    const newId = data._id || `custom-${Math.random().toString(36).substr(2, 9)}`;
    setCanvasDocuments(prev => {
      if (prev.find(d => d._id === newId)) return prev;
      return [...prev, {
        _id: newId,
        data: { ...data, _id: newId },
        collection: 'Custom',
        x: x,
        y: y,
        width: 350,
        height: null,
        expandedPaths: []
      }];
    });
  }, [saveHistoryPoint]);

  const handleUpdateGapNodePosition = useCallback((id, x, y) => {
    // Check for change
    const node = gapNodes.find(n => n.id === id);
    if (node && Math.abs(node.x - x) < 1 && Math.abs(node.y - y) < 1) return;

    saveHistoryPoint();
    setGapNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n));
  }, [gapNodes, saveHistoryPoint]);

  const handleAddGapNode = useCallback((newNode) => {
    saveHistoryPoint();
    setGapNodes(prev => [...prev, newNode]);
  }, [saveHistoryPoint]);

  const handleDeleteGapNode = useCallback((id) => {
    saveHistoryPoint();
    setGapNodes(prev => prev.filter(n => n.id !== id));
  }, [saveHistoryPoint]);

  // Text Node Handlers
  const handleAddTextNode = useCallback((newNode) => {
    saveHistoryPoint();
    setTextNodes(prev => [...prev, newNode]);
  }, [saveHistoryPoint]);

  const handleUpdateTextNode = useCallback((id, text) => {
    saveHistoryPoint();
    setTextNodes(prev => prev.map(n => n.id === id ? { ...n, text } : n));
  }, [saveHistoryPoint]);

  const handleUpdateTextNodePosition = useCallback((id, x, y) => {
    // Check for change
    const node = textNodes.find(n => n.id === id);
    if (node && Math.abs(node.x - x) < 1 && Math.abs(node.y - y) < 1) return;

    saveHistoryPoint();
    setTextNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n));
  }, [textNodes, saveHistoryPoint]);

  const handleDeleteTextNode = useCallback((id) => {
    saveHistoryPoint();
    setTextNodes(prev => prev.filter(n => n.id !== id));
  }, [saveHistoryPoint]);

  const handleToggleTextNodeBackdrop = useCallback((id) => {
    saveHistoryPoint();
    setTextNodes(prev => {
      const idx = prev.findIndex(n => n.id === id);
      if (idx !== -1) {
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });
  }, [saveHistoryPoint]);

  // Image Node Handlers
  const handleAddImageNode = useCallback((newNode) => {
    saveHistoryPoint();
    setImageNodes(prev => [...prev, newNode]);
  }, [saveHistoryPoint]);

  const handleUpdateImageNode = useCallback((id, updates) => {
    saveHistoryPoint();
    setImageNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }, [saveHistoryPoint]);

  const handleUpdateImageNodePosition = useCallback((id, x, y) => {
    const node = imageNodes.find(n => n.id === id);
    if (node && Math.abs(node.x - x) < 1 && Math.abs(node.y - y) < 1) return;

    saveHistoryPoint();
    setImageNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n));
  }, [imageNodes, saveHistoryPoint]);

  const handleDeleteImageNode = useCallback((id) => {
    saveHistoryPoint();
    setImageNodes(prev => prev.filter(n => n.id !== id));
  }, [saveHistoryPoint]);

  const handleToggleImageNodeBackdrop = useCallback((id) => {
    saveHistoryPoint();
    setImageNodes(prev => {
      const idx = prev.findIndex(n => n.id === id);
      if (idx !== -1) {
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });
  }, [saveHistoryPoint]);

  // Diff Node Handlers
  const handleAddDiffNode = useCallback((newNode) => {
    saveHistoryPoint();
    setDiffNodes(prev => [...prev, newNode]);
  }, [saveHistoryPoint]);

  const handleUpdateDiffNodePosition = useCallback((id, x, y) => {
    const node = diffNodes.find(n => n.id === id);
    if (node && Math.abs(node.x - x) < 1 && Math.abs(node.y - y) < 1) return;

    saveHistoryPoint();
    setDiffNodes(prev => prev.map(n => n.id === id ? { ...n, x, y } : n));
  }, [diffNodes, saveHistoryPoint]);

  const handleUpdateDiffNode = useCallback((id, updates) => {
    saveHistoryPoint();
    setDiffNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  }, [saveHistoryPoint]);

  const handleDeleteDiffNode = useCallback((id) => {
    saveHistoryPoint();
    setDiffNodes(prev => prev.filter(n => n.id !== id));
  }, [saveHistoryPoint]);

  const handleUpdateCanvasPosition = useCallback((id, x, y) => {
    const doc = canvasDocuments.find(d => d._id === id);
    if (doc && Math.abs(doc.x - x) < 1 && Math.abs(doc.y - y) < 1) return;

    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(d =>
      d._id === id ? { ...d, x, y } : d
    ));
  }, [canvasDocuments, saveHistoryPoint]);

  const handleUpdateCanvasDimensions = useCallback((id, width, height) => {
    const doc = canvasDocuments.find(d => d._id === id);
    // Use a small epsilon for float comparisons if needed, though usually pixels are close integers
    const currentW = doc?.width || 350;
    const currentH = doc?.height || 0;

    // Check if height is effectively "auto" (null/0) and we are setting it to something specific?
    // If doc.height is null, currentH is 0. If new height is provided, it changed.
    // If new height is null/undefined?

    // If doc is not found, we shouldn't update anyway, but safety first.
    if (doc && Math.abs(currentW - width) < 2 && Math.abs(currentH - (height || 0)) < 2) {
      return;
    }

    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(d =>
      d._id === id ? { ...d, width, height } : d
    ));
  }, [canvasDocuments, saveHistoryPoint]);

  const handleUpdateCanvasPositions = useCallback((updates) => {
    // updates: { [id]: { x, y } }

    // Check if any update is meaningful
    let hasChange = false;
    const ids = Object.keys(updates);

    for (const id of ids) {
      const { x, y } = updates[id];

      // Check docs
      const doc = canvasDocuments.find(d => d._id === id);
      if (doc) {
        if (Math.abs(doc.x - x) > 1 || Math.abs(doc.y - y) > 1) {
          hasChange = true;
          break;
        }
      }

      // Check gaps
      const gap = gapNodes.find(n => n.id === id);
      if (gap) {
        if (Math.abs(gap.x - x) > 1 || Math.abs(gap.y - y) > 1) {
          hasChange = true;
          break;
        }
      }

      // Check text nodes
      const textNode = textNodes.find(n => n.id === id);
      if (textNode) {
        if (Math.abs(textNode.x - x) > 1 || Math.abs(textNode.y - y) > 1) {
          hasChange = true;
          break;
        }
      }

      // Check image nodes
      const imageNode = imageNodes.find(n => n.id === id);
      if (imageNode) {
        if (Math.abs(imageNode.x - x) > 1 || Math.abs(imageNode.y - y) > 1) {
          hasChange = true;
          break;
        }
      }

      // Check diff nodes
      const diffNode = diffNodes.find(n => n.id === id);
      if (diffNode) {
        if (Math.abs(diffNode.x - x) > 1 || Math.abs(diffNode.y - y) > 1) {
          hasChange = true;
          break;
        }
      }
    }

    if (!hasChange) return;

    saveHistoryPoint();

    setCanvasDocuments(prev => prev.map(d => {
      if (updates[d._id]) {
        return { ...d, x: updates[d._id].x, y: updates[d._id].y };
      }
      return d;
    }));
    setGapNodes(prev => prev.map(n => {
      if (updates[n.id]) {
        return { ...n, x: updates[n.id].x, y: updates[n.id].y };
      }
      return n;
    }));
    setTextNodes(prev => prev.map(n => {
      if (updates[n.id]) {
        return { ...n, x: updates[n.id].x, y: updates[n.id].y };
      }
      return n;
    }));
    setImageNodes(prev => prev.map(n => {
      if (updates[n.id]) {
        return { ...n, x: updates[n.id].x, y: updates[n.id].y };
      }
      return n;
    }));
    setDiffNodes(prev => prev.map(n => {
      if (updates[n.id]) {
        return { ...n, x: updates[n.id].x, y: updates[n.id].y };
      }
      return n;
    }));
  }, [canvasDocuments, gapNodes, textNodes, imageNodes, diffNodes, saveHistoryPoint]);

  const handleCloneCanvasDocument = (id) => {
    saveHistoryPoint();
    // 1. Try Document
    const docToClone = canvasDocuments.find(d => d._id === id);
    if (docToClone) {
      const newDoc = {
        ...docToClone,
        _id: `${docToClone.data._id || 'doc'}-${Math.random().toString(36).substr(2, 9)}`,
        x: docToClone.x + 20,
        y: docToClone.y + 20,
        width: docToClone.width || 350,
        height: docToClone.height || null,
        expandedPaths: [...(docToClone.expandedPaths || [])]
      };
      setCanvasDocuments(prev => [...prev, newDoc]);
      return;
    }

    // 2. Try Gap Node
    const gapToClone = gapNodes.find(n => n.id === id);
    if (gapToClone) {
      const newGap = {
        ...gapToClone,
        id: `gap-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        x: gapToClone.x + 20,
        y: gapToClone.y + 20,
        // dimmed: false // Reset dimmed state on clone if persisted
      };
      setGapNodes(prev => [...prev, newGap]);
      return;
    }

    // 3. Try Text Node
    const textNodeToClone = textNodes.find(n => n.id === id);
    if (textNodeToClone) {
      const newTextNode = {
        ...textNodeToClone,
        id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        x: textNodeToClone.x + 20,
        y: textNodeToClone.y + 20,
      };
      setTextNodes(prev => [...prev, newTextNode]);
      return;
    }

    // 4. Try Image Node
    const imageNodeToClone = imageNodes.find(n => n.id === id);
    if (imageNodeToClone) {
      const newImageNode = {
        ...imageNodeToClone,
        id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        x: imageNodeToClone.x + 20,
        y: imageNodeToClone.y + 20,
      };
      setImageNodes(prev => [...prev, newImageNode]);
      return;
    }

    // 5. Try Diff Node
    const diffNodeToClone = diffNodes.find(n => n.id === id);
    if (diffNodeToClone) {
      const newDiffNode = {
        ...diffNodeToClone,
        id: `diff-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        x: diffNodeToClone.x + 20,
        y: diffNodeToClone.y + 20,
      };
      setDiffNodes(prev => [...prev, newDiffNode]);
    }
  };

  const handleDeleteCanvasDocument = (id) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => prev.filter(d => d._id !== id));
  };

  const handleDeleteCanvasDocuments = (ids) => {
    saveHistoryPoint();
    const idsSet = new Set(ids);
    setCanvasDocuments(prev => prev.filter(d => !idsSet.has(d._id)));
    setGapNodes(prev => prev.filter(n => !idsSet.has(n.id)));
    setTextNodes(prev => prev.filter(n => !idsSet.has(n.id)));
    setImageNodes(prev => prev.filter(n => !idsSet.has(n.id)));
    setDiffNodes(prev => prev.filter(n => !idsSet.has(n.id)));
  };


  const handleToggleExpand = useCallback((docId, path) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(doc => {
      if (doc._id === docId) {
        const currentPaths = doc.expandedPaths || [];
        const newPaths = currentPaths.includes(path)
          ? currentPaths.filter(p => p !== path)
          : [...currentPaths, path];
        // Reset height to null (auto) so the card resizes to fit new content
        return { ...doc, expandedPaths: newPaths, height: null };
      }
      return doc;
    }));
  }, [saveHistoryPoint]);

  const handleToggleBackdrop = useCallback((docId) => {
    saveHistoryPoint();
    // 1. Try Document
    let found = false;
    setCanvasDocuments(prev => {
      const idx = prev.findIndex(d => d._id === docId);
      if (idx !== -1) {
        found = true;
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });

    if (found) return;

    // 2. Try Gap Node
    let gapFound = false;
    setGapNodes(prev => {
      const idx = prev.findIndex(n => n.id === docId);
      if (idx !== -1) {
        gapFound = true;
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });

    if (gapFound) return;

    // 3. Try Text Node
    let textFound = false;
    setTextNodes(prev => {
      const idx = prev.findIndex(n => n.id === docId);
      if (idx !== -1) {
        textFound = true;
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });

    if (textFound) return;

    // 4. Try Image Node
    let imageFound = false;
    setImageNodes(prev => {
      const idx = prev.findIndex(n => n.id === docId);
      if (idx !== -1) {
        imageFound = true;
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });

    if (imageFound) return;

    // 5. Try Diff Node
    setDiffNodes(prev => {
      const idx = prev.findIndex(n => n.id === docId);
      if (idx !== -1) {
        const newArr = [...prev];
        newArr[idx] = { ...newArr[idx], dimmed: !newArr[idx].dimmed };
        return newArr;
      }
      return prev;
    });
  }, [saveHistoryPoint]);

  const handleUpdateCanvasDocumentData = useCallback((id, newData) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(doc => {
      if (doc._id === id) {
        return { ...doc, data: newData };
      }
      return doc;
    }));
  }, [saveHistoryPoint]);

  const handleSaveDocumentVersion = useCallback((id, newData) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(doc => {
      if (doc._id === id) {
        const versions = doc.versions || [doc.data]; // Initialize with original if none
        const newVersions = [...versions, newData];
        return {
          ...doc,
          versions: newVersions,
          activeVersionIndex: newVersions.length - 1,
          data: newData // Update current data to the new version
        };
      }
      return doc;
    }));
  }, [saveHistoryPoint]);

  const handleSelectDocumentVersion = useCallback((id, versionIndex) => {
    saveHistoryPoint();
    setCanvasDocuments(prev => prev.map(doc => {
      if (doc._id === id) {
        if (!doc.versions || !doc.versions[versionIndex]) return doc;
        return {
          ...doc,
          activeVersionIndex: versionIndex,
          data: doc.versions[versionIndex]
        };
      }
      return doc;
    }));
  }, [saveHistoryPoint]);

  const handleIdColorChange = useCallback((id) => {
    saveHistoryPoint();
    setIdColorOverrides(prev => ({
      ...prev,
      [id]: (prev[id] || 0) + 1
    }));
  }, [saveHistoryPoint]);

  // Wrappers for visual state setters to ensure history tracking
  const handleMarkedSourcesChange = useCallback((updater) => {
    saveHistoryPoint();
    setMarkedSources(updater);
  }, [saveHistoryPoint]);

  const handleHighlightedFieldsChange = useCallback((updater) => {
    saveHistoryPoint();
    setHighlightedFields(updater);
  }, [saveHistoryPoint]);

  const handleHoistedFieldsChange = useCallback((updater) => {
    saveHistoryPoint();
    setHoistedFields(updater);
  }, [saveHistoryPoint]);

  const handleArrowDirectionChange = useCallback((updater) => {
    saveHistoryPoint();
    setArrowDirection(updater);
  }, [saveHistoryPoint]);

  const handleShowBackdroppedArrowsChange = useCallback((updater) => {
    saveHistoryPoint();
    setShowBackdroppedArrows(updater);
  }, [saveHistoryPoint]);

  const handleShowAllArrowsChange = useCallback((updater) => {
    saveHistoryPoint();
    setShowAllArrows(updater);
  }, [saveHistoryPoint]);

  const handleConnectRequest = useCallback((id, fieldPath) => {
    setConnectModalState({ isOpen: true, sourceId: id, fieldPath: fieldPath });
  }, []);

  const handleQuickConnect = useCallback(async (sourceDocId, idValue, fieldPath, dbName, colName) => {
    try {
      showToast(`Quick connecting to ${colName}...`, 'info', 1000);

      // Build query matching QueryBuilder format - ObjectId uses { $oid: value }
      const queryObject = {
        _id: { $oid: idValue }
      };

      const data = await fetchDocuments(uri, dbName, colName, 20, queryObject);

      if (data.documents && data.documents.length > 0) {
        // Save to connection history so ⚡ becomes 🚀 next time
        try {
          const historyRaw = localStorage.getItem('mongoDV_connectionHistory');
          const history = historyRaw ? JSON.parse(historyRaw) : {};
          history[fieldPath] = { db: dbName, collection: colName };
          localStorage.setItem('mongoDV_connectionHistory', JSON.stringify(history));
          // Trigger re-render of icons
          setConnectionHistoryVersion(v => v + 1);
        } catch (e) { /* localStorage unavailable */ }

        // Use sourceDocId for positioning (the document that contains the clicked field)
        handleConnectSubmit(data.documents, colName, sourceDocId);
      } else {
        showToast('No documents found', 'warning', 2000);
      }
    } catch (err) {
      console.error("Quick connect failed", err);
      showToast(`Connection failed: ${err.message}`, 'error', 3000);
    }
  }, [uri, showToast]);

  const handleConnectSubmit = (newDocs, collectionName, explicitSourceId = null) => {
    if (!newDocs || newDocs.length === 0) return;

    saveHistoryPoint();

    // Add new docs to canvas
    setCanvasDocuments(prev => {
      const existingIds = new Set(prev.map(d => d._id));

      // Find source document position if available
      const sourceId = explicitSourceId || connectModalState.sourceId;
      const sourceDoc = prev.find(d => d._id === sourceId);
      let baseX = 200;
      let baseY = 200;

      if (sourceDoc) {
        baseX = sourceDoc.x + 400; // Position to the right of source (card is 350px wide)
        baseY = sourceDoc.y;
      } else {
        // Fallback to center of viewport
        const W = window.innerWidth - 300;
        const H = window.innerHeight;
        baseX = (W / 2 - canvasView.pan.x) / canvasView.zoom - 175;
        baseY = (H / 2 - canvasView.pan.y) / canvasView.zoom - 100;
      }

      const addedDocs = newDocs
        .filter(d => !existingIds.has(d._id))
        .map((doc, idx) => ({
          _id: doc._id || Math.random().toString(36).substr(2, 9),
          data: doc,
          collection: collectionName || 'Unknown',
          x: baseX + idx * 30, // Offset each new doc slightly
          y: baseY + idx * 30,
          width: 350,
          height: null,
          expandedPaths: []
        }));

      if (addedDocs.length > 0) {
        showToast(`Connected ${addedDocs.length} document${addedDocs.length > 1 ? 's' : ''}`, 'success', 2000);
      } else if (newDocs.length > 0) {
        showToast('Documents already on canvas', 'info', 2000);
      }

      return [...prev, ...addedDocs];
    });

    // Auto-select newly added documents
    const newDocIds = newDocs.map(d => d._id || d.id); // Handle potential ID variations if any, though _id is standard here
    // But wait, the mapping above generates IDs if missing. We need the IDs that were *actually* added.
    // The previous logic generated IDs inside the map.
    // We need to capture those IDs.
    // Let's refactor the setCanvasDocuments update to first calculate the new docs, then update both states.
    // Actually, setCanvasDocuments functional update is tricky if we need the result.
    // But we can generate the IDs *before* the update or replicate the ID generation logic.
    // The ID generation uses Math.random() so it's not deterministic if we do it twice.
    // Better strategy: Calculate addedDocs outside the setter first?
    // Accessing `prev` is the issue.
    // We can rely on `newDocs` if they already have _id. Most `fetchDocuments` results have `_id`.
    // If they don't, the code generates them.
    // If `newDocs` comes from `fetchDocuments`, it has `_id`.
    // Let's assume `newDocs` have `_id` for now as they come from DB.
    // If it is a fresh connection, they are DB docs.
    if (newDocs && newDocs.length > 0) {
      // We only know the _ids if they are in newDocs.
      // If the code above generates IDs, we might miss them.
      // However, handleQuickConnect passes `data.documents` which definitely have `_id` from Mongo.
      // So we can trust `newDocs` to have `_id`.
      const newIds = newDocs.map(d => d._id);
      setSelectedIds(newIds);
    }
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
    // Save current state using helper
    const snapshot = getCanvasSnapshot(true); // Include View state for file saves

    saves[name] = {
      ...snapshot,
      // Convert Sets to Arrays for JSON serialization (getCanvasSnapshot returns Sets for internal use)
      markedSources: Array.from(snapshot.markedSources),
      highlightedFields: Array.from(snapshot.highlightedFields),
      hoistedFields: Array.from(snapshot.hoistedFields),
      timestamp: Date.now()
    };

    localStorage.setItem('mongoDV_saves_v1', JSON.stringify(saves));
    setCurrentSaveName(name); // Track the saved name
    setSaveLoadModalState(prev => ({ ...prev, isOpen: false }));

    // Show toast
    showToast(`Saved "${name}"`, 'success', 2000);
  };

  const handleQuickSave = () => {
    if (currentSaveName) {
      // Auto-save to current save
      handleConfirmSave(currentSaveName);
    } else {
      // No current save, open Save As modal
      handleOpenSaveModal();
    }
  };

  const handleConfirmLoad = (name) => {
    const saves = getSavesFromStorage();
    const save = saves[name];
    if (save) {
      // Restore using helper
      restoreCanvasSnapshot(save, true); // Include view state restoration

      setCurrentSaveName(name); // Track the loaded save name
      showToast(`Loaded "${name}"`, 'info', 2000);

      // Clear history logic since we loaded a fresh state? 
      // Usually loading a file clears undo history or pushes the load as a massive change.
      // Let's clear it to avoid invalid state transitions.
      history.clear();
    }
    setSaveLoadModalState(prev => ({ ...prev, isOpen: false }));
  };

  const handleDeleteSave = (name) => {
    const saves = getSavesFromStorage();
    delete saves[name];
    localStorage.setItem('mongoDV_saves_v1', JSON.stringify(saves));
    showToast(`Deleted save "${name}"`, 'warning', 2000);

    // Refresh list
    const list = Object.entries(saves).map(([name, data]) => ({
      name,
      timestamp: data.timestamp
    })).sort((a, b) => b.timestamp - a.timestamp);
    setSaveLoadModalState(prev => ({ ...prev, savedList: list }));
  };

  const getExportData = () => {
    const snapshot = getCanvasSnapshot(true); // Include view state
    // Convert Sets to Arrays for JSON serialization
    return {
      ...snapshot,
      markedSources: Array.from(snapshot.markedSources),
      highlightedFields: Array.from(snapshot.highlightedFields),
      hoistedFields: Array.from(snapshot.hoistedFields)
    };
  };

  const handleExport = async () => {
    // Feature Check: File System Access API (Browser Native Save Dialog)
    if ('showSaveFilePicker' in window) {
      try {
        const exportData = getExportData();
        const data = JSON.stringify(exportData, null, 2);
        const blob = new Blob([data], { type: 'application/json' });

        const handle = await window.showSaveFilePicker({
          suggestedName: `mongoDV-export-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
          types: [{
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          }],
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();

        showToast('Exported successfully', 'success', 2000);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error("Export failed:", err);
          showToast('Export failed', 'error');
        }
        // User cancelled is fine, do nothing
      }
    } else {
      // Fallback: Open modal to ask for filename (Method 2)
      setSaveLoadModalState({ isOpen: true, mode: 'export', savedList: [] });
    }
  };

  const handleConfirmExport = (name) => {
    try {
      const exportData = getExportData();
      const data = JSON.stringify(exportData, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Ensure .json extension
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setSaveLoadModalState(prev => ({ ...prev, isOpen: false }));
      showToast('Exported successfully', 'success', 2000);
    } catch (err) {
      console.error("Export failed:", err);
      showToast('Export failed', 'error');
    }
  };

  const fileInputRef = React.useRef(null);

  const handleImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset to allow selecting same file again
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        restoreCanvasSnapshot(json, true);
        history.clear(); // Clear history as this is a fresh state load
        setCurrentSaveName(null); // Clear current save name as it's an imported file
        showToast('Imported successfully', 'success', 2000);
      } catch (err) {
        console.error("Import failed:", err);
        showToast('Invalid export file', 'error');
      }
    };
    reader.readAsText(file);
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
      <h2 style={{ marginBottom: '0.25rem', fontSize: '1.2rem', color: 'var(--primary)' }}>MongoDV</h2>
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1.5rem' }}>Mongo Data Visualizer</div>

      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
          {isOfflineMode ? 'Status' : 'Connected to:'}
        </div>
        <div style={{ fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={isOfflineMode ? 'Offline Mode' : uri}>
          {isOfflineMode ? 'Offline Mode' : uri.replace(/\/\/([^:]+:[^@]+@)?/, '//***@')}
        </div>
        <button
          onClick={() => {
            setIsConnected(false);
            setIsOfflineMode(false);
          }}
          style={{
            marginTop: '0.5rem',
            background: 'transparent',
            border: '1px solid var(--glass-border)',
            color: '#94a3b8',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.8rem',
            cursor: 'pointer'
          }}
        >
          {isOfflineMode ? 'Connect to DB' : 'Disconnect'}
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

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>OR</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--glass-border)' }}></div>
        </div>

        <button
          type="button"
          onClick={handleOfflineMode}
          style={{
            width: '100%',
            marginTop: '1rem',
            padding: '1rem',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--glass-border)',
            color: '#cbd5e1',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.borderColor = '#94a3b8';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.borderColor = 'var(--glass-border)';
          }}
        >
          Open Visualizer Canvas (Offline)
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
                selectedIds={selectedIds}
                setSelectedIds={setSelectedIds}
                documents={canvasDocuments}
                gapNodes={gapNodes}
                textNodes={textNodes}
                viewState={canvasView}
                onViewStateChange={setCanvasView}
                onUpdatePosition={handleUpdateCanvasPosition}
                onUpdateData={handleUpdateCanvasDocumentData}
                onSaveVersion={handleSaveDocumentVersion}
                onSelectVersion={handleSelectDocumentVersion}
                onUpdateDimensions={handleUpdateCanvasDimensions}
                onUpdateGapNodePosition={handleUpdateGapNodePosition}
                onAddGapNode={handleAddGapNode}
                onDeleteGapNode={handleDeleteGapNode}
                onAddTextNode={handleAddTextNode}
                onUpdateTextNode={handleUpdateTextNode}
                onUpdateTextNodePosition={handleUpdateTextNodePosition}
                onDeleteTextNode={handleDeleteTextNode}
                imageNodes={imageNodes}
                onAddImageNode={handleAddImageNode}
                onUpdateImageNode={handleUpdateImageNode}
                onUpdateImageNodePosition={handleUpdateImageNodePosition}
                onDeleteImageNode={handleDeleteImageNode}
                diffNodes={diffNodes}
                onAddDiffNode={handleAddDiffNode}
                onUpdateDiffNodePosition={handleUpdateDiffNodePosition}
                onUpdateDiffNode={handleUpdateDiffNode}
                onDeleteDiffNode={handleDeleteDiffNode}
                onConnect={handleConnectRequest}
                onQuickConnect={handleQuickConnect}
                connectionHistoryVersion={connectionHistoryVersion}
                onClone={handleCloneCanvasDocument}
                onDelete={handleDeleteCanvasDocument}
                onDeleteMany={handleDeleteCanvasDocuments}
                onSave={handleQuickSave}
                onSaveAs={handleOpenSaveModal}
                onLoad={handleOpenLoadModal}
                currentSaveName={currentSaveName}
                onToggleExpand={handleToggleExpand}
                onToggleBackdrop={handleToggleBackdrop}

                onAddCustomDocument={handleAddCustomDocument}
                markedSources={markedSources}
                onMarkedSourcesChange={handleMarkedSourcesChange}
                highlightedFields={highlightedFields}
                onHighlightedFieldsChange={handleHighlightedFieldsChange}
                hoistedFields={hoistedFields}
                onHoistedFieldsChange={handleHoistedFieldsChange}
                arrowDirection={arrowDirection}
                onArrowDirectionChange={handleArrowDirectionChange}
                showBackdroppedArrows={showBackdroppedArrows}
                onShowBackdroppedArrowsChange={handleShowBackdroppedArrowsChange}
                showAllArrows={showAllArrows}
                onShowAllArrowsChange={handleShowAllArrowsChange}
                idColorOverrides={idColorOverrides}
                onIdColorChange={handleIdColorChange}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onExport={handleExport}
                onImport={handleImportClick}
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
      )}
      <ConnectModal
        isOpen={connectModalState.isOpen}
        onClose={() => setConnectModalState({ ...connectModalState, isOpen: false })}
        sourceId={connectModalState.sourceId}
        fieldPath={connectModalState.fieldPath}
        initialUri={uri}
        onConnect={handleConnectSubmit}
      />
      <SaveLoadModal
        isOpen={saveLoadModalState.isOpen}
        onClose={() => setSaveLoadModalState(prev => ({ ...prev, isOpen: false }))}
        mode={saveLoadModalState.mode}
        existingSaves={saveLoadModalState.savedList}
        onConfirm={
          saveLoadModalState.mode === 'save' ? handleConfirmSave :
            saveLoadModalState.mode === 'export' ? handleConfirmExport :
              handleConfirmLoad
        }
        onDelete={handleDeleteSave}
      />

      <Toaster />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        style={{ display: 'none' }}
      />
    </div>
  );
}

export default App;
