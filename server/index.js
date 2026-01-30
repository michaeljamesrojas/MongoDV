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

            const keys = new Set();
            docs.forEach(doc => {
                Object.keys(doc).forEach(key => keys.add(key));
            });

            return Array.from(keys);
        });
        res.json({ keys: schema });
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

            // Handle ObjectId conversion for _id field
            if (search._id && typeof search._id === 'string' && ObjectId.isValid(search._id)) {
                try {
                    search._id = new ObjectId(search._id);
                } catch (e) {
                    console.warn("Invalid ObjectId provided for _id query", search._id);
                }
            }

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
