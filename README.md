# MongoDV

<div align="center">

**A visualizer for data for investigating data.**
*Stop squinting at JSON tables. Start investigating with flow.*

> This project is vibe coded.

</div>

---

## 🌊 The Vibe

MongoDV isn't just a database GUI; it's a workspace for investigation. Traditional tools force you into rigid tables and isolated documents, breaking your mental model. MongoDV creates an **infinite canvas** where your data lives, breathes, and connects.

It's built for those moments when you need to "follow the thread"—jumping from a user to their posts, to the comments, and back again, without losing context.

## ✨ Key Features

### ♾️ Infinite Canvas
-   **Freeform Organization**: Drag, drop, and arrange documents anywhere. Group related data visually to tell a story or track a bug.
-   **Gap & Text Nodes**: Add context to your investigation with sticky notes and spatial separators.

### 🔗 Visual Connections
-   **Dynamic Linking**: See the relationships between your data instantly. Arrows automatically draw between referenced IDs, visualizing concepts like "Foreign Keys" in a NoSQL world.
-   **Smart Layouts**: Arrows ghost and fade when things get messy, keeping your view clean.

### ⚡ Quick Connect
-   **Instant Traversal**: Spot a cryptic `ObjectId`? Click the **⚡** icon to instantly fetch and connect that document.
-   **Memory**: Once you've traversed a link, the icon upgrades to a **🚀**, remembering the path for next time.

### ⏪ Time Travel
-   **Robust History**: Experiment fearlessly. Every move, connect, and edit is tracked. 
-   **Undo/Redo**: Made a mess? `Ctrl+Z` your way back to clarity.

### 💾 Session Management
-   **Save & Load**: Don't lose your investigation context. Save your entire canvas state—positions, arrows, and all—and pick up exactly where you left off.
-   **Offline Mode**: Investigate saved snapshots even without a live database connection.

## 🛠️ Tech Stack

Built with a focus on performance and developer experience:

-   **Frontend**: React, Vite, Tailwind (for that premium feel)
-   **Backend**: Node.js, Express
-   **Database**: MongoDB (Native Driver)
-   **Orchestration**: Concurrently

## 🚀 Getting Started

### Prerequisites
-   Node.js (v14+)
-   A running MongoDB instance

### Installation
Clone the repo and install dependencies:

```bash
npm install
```

### Running
Launch both the client and server with a single command:

```bash
npm start
```

Open [http://localhost:5173](http://localhost:5173) to start your investigation.

---

*Verified Vibe Coded™*
