# MongoDV


<div align="center">

**Your database is a crime scene. This is your corkboard.**
*A visual investigation tool for MongoDB featuring an infinite canvas, drag-and-drop linking, and visual comparison tools.*


> This project is vibe coded.

</div>

![MongoDV Overview](assets/mongodv%20sample%201.png)

---


## 🌊 The Vibe

MongoDV isn't just a database GUI; it's a workspace for investigation. Traditional tools force you into rigid tables and isolated documents, breaking your mental model. MongoDV creates an **infinite canvas** where your data lives, breathes, and connects.

**Built for those moments when you need to "follow the thread":**
- 🐛 **Debugging**: A user reports a bug. Jump from their account to their recent orders, to the payment transactions, to the failed API logs—all without losing context.
- 🔍 **Data Investigation**: Track down a suspicious transaction by following the chain: customer → order → payment → shipping → fulfillment center.
- 🗺️ **Schema Exploration**: New to a codebase? Visually map out how collections reference each other instead of guessing from field names.
- ⚡ **Incident Response**: An alert fires at 3am. Trace the error from the log entry to the user session, to the corrupted data, back to the deployment timestamp.

---

## 📸 Gallery

<div align="center">

![Sample 0](assets/mongodv%20sample%200.png)
*Infinite canvas exploration*

![Sample 1](assets/mongodv%20sample%201.png)
*Visual relationship mapping*

![Sample 2](assets/mongodv%20sample%202.png)
*Investigation in action*

</div>

---

## 🏁 Getting Started

### 1. Connection
Paste your MongoDB connection string (e.g., `mongodb://localhost:27017` or an Atlas URI). MongoDV automatically discovers your databases and collections.

### 2. Start Your Investigation
There are two ways to begin a "case":
- **Sidebar Exploration**: Select a database and collection from the sidebar. Use the **Query Builder** to find specific data, then click the **⇱** icon on any document to send it to the infinite canvas.
- **Direct Canvas Connection**: Click the **+** icon in the Canvas HUD to open the Query Builder and pull data directly onto the board.

### 3. Follow the Thread
Once a document is on the canvas, look for `ObjectId` fields. 
- **The ID Text**: Click any ID string (underlined) to open the **Connect Modal**. This lets you manually choose which collection that ID belongs to.
- **Quick Connect (⚡)**: Click the **⚡** icon to instantly fetch and connect that document using automatic prediction.
- **Memory (🚀)**: Once connected, the icon turns into **🚀**, remembering the relationship for one-click access next time.
- **Randomize (👁)**: Click the eye icon next to an ID to change its visual color across the entire board.

---

## 🏗️ Investigation Workflow

1.  **Seed the Board**: Use the Query Builder to bring in your starting documents (e.g., a specific `User` or `Order`).
2.  **Follow Connections**: Click the `⚡` icons on related IDs to build a visual graph of the data.
3.  **Analyze**:
    *   **Compare**: Use [Diff Nodes](#-spot-the-difference) to see changes between documents.
    *   **Timeline**: Use [Time Gaps](#-mind-the-gap) to see the duration between events.
4.  **Organize**: Use the right-click menu to align cards, highlight critical fields, or backdrop (dim) irrelevant data.
5.  **Save Case**: Use the HUD to save your canvas state or export it for later review.

---

## 🎮 Heads-Up Display (HUD) Reference

The canvas HUD (bottom-right) provides quick access to essential tools:

| Icon | Tool | Action |
| :--- | :--- | :--- |
| ↩️ / ↪️ | **Undo/Redo** | Reverse or re-apply canvas actions (`Ctrl+Z` / `Ctrl+Shift+Z`) |
| `-` / `+` | **Zoom** | Adjust the view scale (10% to 500%) |
| **+** (Yellow) | **New Query** | Open the Query Builder to add more documents to the canvas |
| ⇄ | **Switch Direction** | Toggle arrow directions between forward (ref -> def) and reverse |
| 👁️ | **Focus Toggle** | Show or hide arrows connected to "backdropped" (dimmed) items |
| ⤡ / ✕ | **Arrows Toggle** | Quickly show or hide all connection arrows |
| 🚀 / 🐢 | **Turbo Mode** | Toggle "Hide arrows while panning" for smoother performance on large boards |
| `Reset` | **Reset View** | Snap the canvas back to (0,0) at 100% zoom |
| 📁 | **Active Save** | Shows the name of your current saved session |
| 💾 | **Quick Save** | Instantly save changes to the current named session |
| ➕ | **Save As** | Create a new named save state in browser storage |
| 📂 | **Load** | Switch between saved investigation states |
| 📤 / 📥 | **Export/Import** | Save your board as a JSON file or load an external case |

---

## ✨ Killer Features
<br/>

### ⚡ Quick Connect
**The most powerful tool in your kit.**
- **Manual**: Click any **underlined ObjectId** to open the Connect Modal. Choose your target collection and query for the data.
- **Fast**: Click the **⚡** icon to instantly fetch and connect that document using automatic prediction.
- **Persistent**: Once connected, the icon upgrades to **🚀**. It remembers which database and collection that ID belongs to, so next time it's one click to pull up the related data.

<br/>

### 🔍 Spot the Difference
Visually compare documents. Right-click on any document, then right-click another to create a Diff Node. See exactly what changed between versions.
![Diff Node](assets/difference%20node.png)

<br/>

### ⏳ Mind the Gap
Click any date field in one document, then click another date field to create a Time Gap node. Instantly see the time gap between the 2 events.
![Time Gap](assets/time%20gap%20nodes.png)

<br/>

### ⏪ Undo/Redo
Full history tracking. `Ctrl+Z` your way back to clarity.

<br/>

### 💾 Session Saver
**Don't lose your context.**
Save your investigation state to browser local storage with one click or export to a JSON file.

<br/>

### 🖱️ Right-Click Superpowers
**Context menus for everything.**

**On any field:**
- **Mark as Source** — Treat a non-`_id` field as a linkable reference
- **★ Highlight** — Visually emphasize key-value pairs
- **📌 Hoist to Top** — Pin important fields to the top of the card
- **📋 Copy Value / Key+Value** — Copy field data to clipboard

**On any document:**
- **↔ Arrange Horizontally / ↕ Vertically** — Auto-align selected cards
- **👁 Toggle Backdrop** — Dim/undim documents to focus on what matters
- **⎘ Clone** — Duplicate any document or node
- **⇔ Compare with...** — Create a Diff Node between two documents
- **✕ Delete** — Remove from canvas

**On empty canvas:**
- **👁 Toggle Backdrop** — Enter backdrop mode to dim multiple items
- **📝 Custom Document** — Create a custom JSON document
- **📝 Add Text** — Drop a floating text note


## 🛠️ Tech Stack

Built with a focus on performance and developer experience:

-   **Frontend**: React, Vite, Tailwind (for that premium feel)
-   **Backend**: Node.js, Express
-   **Database**: MongoDB (Native Driver)
-   **Orchestration**: Concurrently

## 🚀 Getting Started (Installation)

### Prerequisites
-   Node.js (v20+)
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
