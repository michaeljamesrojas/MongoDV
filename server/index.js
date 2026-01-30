const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Helper to close client connection
const withClient = async (uri, operation) => {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        return await operation(client);
    } finally {
        await client.close();
    }
};

app.post('/api/connect', async (req, res) => {
    const { uri } = req.body;
    if (!uri) {
        return res.status(400).json({ error: 'Connection string is required' });
    }

    try {
        await withClient(uri, async (client) => {
            // Just ping to verify connection
            await client.db("admin").command({ ping: 1 });
        });
        res.json({ success: true, message: 'Connected successfully' });
    } catch (error) {
        console.error('Connection error:', error);
        res.status(500).json({ error: 'Failed to connect: ' + error.message });
    }
});


app.post('/api/databases', async (req, res) => {
    const { uri } = req.body;
    if (!uri) {
        return res.status(400).json({ error: 'Connection string is required' });
    }

    try {
        const dbs = await withClient(uri, async (client) => {
            const adminDb = client.db('admin');
            const result = await adminDb.admin().listDatabases();
            return result.databases;
        });
        res.json({ databases: dbs });
    } catch (error) {
        console.error('List databases error:', error);
        res.status(500).json({ error: 'Failed to list databases: ' + error.message });
    }
});

app.post('/api/collections', async (req, res) => {
    const { uri, dbName } = req.body;
    if (!uri || !dbName) {
        return res.status(400).json({ error: 'Connection string and database name are required' });
    }

    try {
        const collections = await withClient(uri, async (client) => {
            const db = client.db(dbName);
            const cols = await db.listCollections().toArray();
            return cols;
        });
        res.json({ collections });
    } catch (error) {
        console.error('List collections error:', error);
        res.status(500).json({ error: 'Failed to list collections: ' + error.message });
    }
});


app.post('/api/schema', async (req, res) => {
    const { uri, dbName, colName } = req.body;
    if (!uri || !dbName || !colName) {
        return res.status(400).json({ error: 'Connection string, database name, and collection name are required' });
    }

    try {
        const schema = await withClient(uri, async (client) => {
            const db = client.db(dbName);
            const collection = db.collection(colName);
            // Sample first 10 documents to infer schema
            const docs = await collection.find({}).limit(10).toArray();

            const schemaMap = {};

            const getType = (val) => {
                if (val === null) return 'Null';
                if (val === undefined) return 'Undefined';
                if (val instanceof ObjectId) return 'ObjectId';
                if (val instanceof Date) return 'Date';
                if (Array.isArray(val)) return 'Array';
                return typeof val; // 'string', 'number', 'boolean', 'object'
            };

            docs.forEach(doc => {
                Object.keys(doc).forEach(key => {
                    const type = getType(doc[key]);
                    if (!schemaMap[key]) {
                        schemaMap[key] = type;
                    } else if (schemaMap[key] !== type) {
                        // Simple conflict resolution: if mixed, just keep it, or mark as Mixed.
                        // For now, let's just stick with first seen or favor ObjectId/Date if present
                        if (type === 'ObjectId' || type === 'Date') schemaMap[key] = type;
                    }
                });
            });

            return schemaMap;
        });
        res.json({ schema });
    } catch (error) {
        console.error('Schema inference error:', error);
        res.status(500).json({ error: 'Failed to infer schema: ' + error.message });
    }
});

app.post('/api/documents', async (req, res) => {
    const { uri, dbName, colName, limit = 20, query = {} } = req.body;
    if (!uri || !dbName || !colName) {
        return res.status(400).json({ error: 'Connection string, database name, and collection name are required' });
    }

    try {
        const documents = await withClient(uri, async (client) => {
            const db = client.db(dbName);
            const collection = db.collection(colName);

            // Parse query if it's a string (though we expect object from body parser)
            let search = query;
            if (typeof query === 'string') {
                try {
                    search = JSON.parse(query);
                } catch (e) {
                    console.warn("Failed to parse query string, using empty query");
                    search = {};
                }
            }

            // Recursive function to convert extended JSON syntax ($oid, $date) to actual types
            // and regular string ObjectIds
            const processQuery = (obj) => {
                if (Array.isArray(obj)) {
                    return obj.map(item => processQuery(item));
                } else if (typeof obj === 'object' && obj !== null) {
                    // Check for extended syntax
                    if (obj.$oid) {
                        return new ObjectId(obj.$oid);
                    }
                    if (obj.$date) {
                        return new Date(obj.$date);
                    }

                    const newObj = {};
                    for (const [key, value] of Object.entries(obj)) {
                        newObj[key] = processQuery(value);
                    }
                    return newObj;
                }
                return obj;
            };

            // Apply conversions
            search = processQuery(search);

            console.log("Executing Query on", dbName + "." + colName, ":", JSON.stringify(search));

            const docs = await collection.find(search).limit(parseInt(limit)).toArray();
            return docs;
        });
        res.json({ documents });
    } catch (error) {
        console.error('Fetch documents error:', error);
        res.status(500).json({ error: 'Failed to fetch documents: ' + error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
