const express = require('express');
const { MongoClient } = require('mongodb');
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

app.post('/api/documents', async (req, res) => {
    const { uri, dbName, colName, limit = 20 } = req.body;
    if (!uri || !dbName || !colName) {
        return res.status(400).json({ error: 'Connection string, database name, and collection name are required' });
    }

    try {
        const documents = await withClient(uri, async (client) => {
            const db = client.db(dbName);
            const collection = db.collection(colName);
            const docs = await collection.find({}).limit(parseInt(limit)).toArray();
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
