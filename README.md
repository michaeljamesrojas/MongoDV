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

## ✨ Killer Features
<br/>

### 🕵️ The Investigation Board
**Drag. Drop. Connect.** 
An infinite canvas where your data lives. Freeform organization for those who think in graphs, not lists.
![Canvas](assets/mongodv%20sample%200.png)

<br/>

### 🔍 Spot the Difference
Visually compare documents. Right-click on any document, then right-click another to create a Diff Node. See exactly what changed between versions.
![Diff Node](assets/difference%20node.png)

<br/>

### ⏳ Mind the Gap
Click any date field in one document, then click another date field to create a Time Gap node. Instantly see the time gap between the 2 events.
![Time Gap](assets/time%20gap%20nodes.png)

<br/>

### ⚡ Quick Connect
**Follow the thread.**
Spot a cryptic `ObjectId`? Click the **⚡** icon to instantly fetch and connect that document.
> *Memory*: Once connected, the icon upgrades to **🚀**. It remembers which database and collection that ID belongs to, so next time it's one click to pull up the related data.

<br/>

### ⏪ Undo/Redo
Full history tracking. `Ctrl+Z` your way back to clarity.

<br/>

### 💾 Session Saver
**Don't lose your context.**
Save your investigation state to browser local storage with one click. Need to share or backup? Export to a JSON file and load it back anytime, even offline.

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

## 🚀 Getting Started

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

### Connecting to MongoDB
Paste your MongoDB connection string (e.g., `mongodb://localhost:27017` or a MongoDB Atlas URI). That's it—no config files needed.

![Initial connection screen](assets/home%20page.png)

---

*Verified Vibe Coded™*
