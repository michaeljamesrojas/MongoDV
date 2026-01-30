import React, { useState, useEffect } from 'react';

const QueryBuilder = ({ schema = {}, onRunQuery }) => {
    const [filters, setFilters] = useState([]);
    const [jsonPreview, setJsonPreview] = useState('{}');

    // Convert schema object to array of keys for dropdown
    const schemaKeys = Object.keys(schema);

    useEffect(() => {
        // Re-generate JSON when filters change
        const query = {};
        filters.forEach(filter => {
            if (!filter.field || filter.value === '') return;

            let val = filter.value;

            // Type casting
            try {
                if (filter.type === 'Number') {
                    val = Number(val);
                } else if (filter.type === 'Boolean') {
                    val = val === 'true';
                } else if (filter.type === 'ObjectId') {
                    val = { $oid: val };
                } else if (filter.type === 'Date') {
                    val = { $date: val };
                }
            } catch (e) {
                console.warn("Failed to cast value", e);
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
        });
        setJsonPreview(JSON.stringify(query, null, 2));
    }, [filters]);

    const addFilter = () => {
        const defaultField = schemaKeys[0] || '';
        const defaultType = schema[defaultField] || 'string';
        setFilters([...filters, {
            field: defaultField,
            operator: '=',
            value: '',
            type: defaultType
        }]);
    };

    const removeFilter = (index) => {
        const newFilters = [...filters];
        newFilters.splice(index, 1);
        setFilters(newFilters);
    };

    const updateFilter = (index, key, val) => {
        const newFilters = [...filters];
        newFilters[index][key] = val;

        // If field changes, update type to default for that field
        if (key === 'field') {
            newFilters[index].type = schema[val] || 'string';
            newFilters[index].value = ''; // Reset value on field change
        }

        setFilters(newFilters);
    };

    return (
        <div style={{ marginBottom: '2rem', background: 'var(--panel-bg)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', color: '#e2e8f0' }}>Query Builder</h3>
                <button onClick={addFilter} style={{
                    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: '0.4rem 0.8rem', borderRadius: '4px', fontSize: '0.9rem'
                }}>+ Add Filter</button>
            </div>

            {filters.length === 0 && (
                <div style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic', marginBottom: '1rem' }}>
                    No filters active. Showing all documents.
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginBottom: '1.5rem' }}>
                {filters.map((filter, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                            value={filter.field}
                            onChange={(e) => updateFilter(idx, 'field', e.target.value)}
                            style={{
                                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', minWidth: '150px'
                            }}
                        >
                            {schemaKeys.map(key => <option key={key} value={key}>{key}</option>)}
                            {!schemaKeys.includes(filter.field) && filter.field && <option value={filter.field}>{filter.field}</option>}
                        </select>

                        <select
                            value={filter.type}
                            onChange={(e) => updateFilter(idx, 'type', e.target.value)}
                            style={{
                                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#94a3b8', padding: '0.5rem', borderRadius: '4px', width: '100px', fontSize: '0.85rem'
                            }}
                        >
                            <option value="string">String</option>
                            <option value="Number">Number</option>
                            <option value="Boolean">Boolean</option>
                            <option value="ObjectId">ObjectId</option>
                            <option value="Date">Date</option>
                        </select>

                        <select
                            value={filter.operator}
                            onChange={(e) => updateFilter(idx, 'operator', e.target.value)}
                            style={{
                                background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', width: '60px'
                            }}
                        >
                            <option value="=">=</option>
                            <option value="!=">!=</option>
                            <option value=">">&gt;</option>
                            <option value=">=">&gt;=</option>
                            <option value="<">&lt;</option>
                            <option value="<=">&lt;=</option>
                        </select>

                        {filter.type === 'Boolean' ? (
                            <select
                                value={filter.value}
                                onChange={(e) => updateFilter(idx, 'value', e.target.value)}
                                style={{
                                    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', flex: 1
                                }}
                            >
                                <option value="">Select...</option>
                                <option value="true">True</option>
                                <option value="false">False</option>
                            </select>
                        ) : (
                            <input
                                type="text"
                                placeholder={filter.type === 'ObjectId' ? '24 hex chars' : filter.type === 'Date' ? 'ISO Date String' : 'Value'}
                                value={filter.value}
                                onChange={(e) => updateFilter(idx, 'value', e.target.value)}
                                style={{
                                    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', color: '#e2e8f0', padding: '0.5rem', borderRadius: '4px', flex: 1, minWidth: '150px'
                                }}
                            />
                        )}

                        <button onClick={() => removeFilter(idx)} style={{
                            background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px', width: '30px', height: '30px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>✕</button>
                    </div>
                ))}
            </div>

            <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Query Preview (JSON)</div>
                <textarea
                    readOnly
                    value={jsonPreview}
                    style={{
                        width: '100%',
                        height: '100px',
                        background: 'rgba(0,0,0,0.4)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '4px',
                        color: '#bfdbfe',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                        padding: '0.5rem',
                        resize: 'vertical'
                    }}
                />
            </div>

            <button onClick={() => onRunQuery(JSON.parse(jsonPreview))} style={{
                background: 'linear-gradient(to right, var(--primary), var(--accent))', color: 'white', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer'
            }}>
                Run Query
            </button>
        </div>
    );
};

export default QueryBuilder;
