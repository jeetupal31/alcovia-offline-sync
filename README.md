# Alcovia Full Stack Engineering Intern Assignment

## Overview

This project implements an offline-first study application with:

* Focus Sessions
* Syllabus Progress Tracking
* Multi-device synchronization
* Server-side reward processing
* n8n automation workflow
* Exactly-once notification delivery

The system supports multiple devices working offline simultaneously and guarantees eventual convergence after synchronization.

---

## Tech Stack

* TypeScript
* React Native (Expo Web)
* Express
* n8n

---

## Features

### Focus Sessions

Students can:

* Start focus sessions
* Complete sessions successfully
* Abandon sessions using Give Up
* Fail sessions due to app switching

Successful sessions:

* Increase streak
* Award coins
* Add focused minutes

Failed sessions:

* Are recorded with failure reason
* Do not award rewards

All actions work offline.

---

### Syllabus Progress

Students can:

* Change task status
* Mark tasks Done
* Move tasks In Progress
* Delete tasks

Progress updates instantly on-device and syncs later.

---

### Offline First Sync

Each client stores operations locally.

Every user action creates an operation ("Op").

Operations are:

* Applied locally immediately
* Stored durably
* Synced later

Devices exchange operations through the sync server.

---

### Multi Device Support

Two devices can:

* Go offline
* Make independent changes
* Reconnect later

After synchronization:

* Both devices converge to identical state
* No edits are lost
* No rewards are duplicated
* No notifications are duplicated

---

### n8n Automation

When a focus session is confirmed successfully:

1. Backend awards rewards exactly once.
2. Backend queues a notification.
3. Outbox dispatcher sends webhook to n8n.
4. n8n deduplicates by eventId.
5. Notification is delivered exactly once.

Mock WhatsApp delivery is implemented using:

POST /mock-whatsapp

---

## Running The Project

### Backend

```bash
cd server
npm install
npm run dev
```

Server:

http://localhost:4000

---

### App

```bash
cd app
npm install
npm run web
```

Open two devices:

http://localhost:8081/?device=A

http://localhost:8081/?device=B

---

### n8n

```bash
npx n8n
```

Open:

http://localhost:5678

Import:

n8n-workflow.json

Activate workflow.

---

## Useful Endpoints

* /register
* /state
* /outbox
* /notifications

---

## Conflict Cases Handled

### Same Task Edited On Both Devices

Resolution:

Last operation in server register order wins.

### Edit vs Delete

Delete wins.

Subsequent edits are ignored.

### Duplicate Sync Messages

Ignored using operation IDs.

### Out Of Order Delivery

Operations are replayed using server sequence order.

---

## Idempotency

### Rewards

Each completed session is rewarded only once using:

* rewardedSessions set
* sessionId based processing

### Notifications

Notifications are sent only once using:

* sessionId keyed outbox
* n8n eventId deduplication

---

## Optional Features Implemented

* Crash survival via local storage persistence
* Session resume after refresh
* Offline sync
* Two device convergence
* Exactly once notification effects

---

## Future Improvements

* Real database
* Authentication
* Push notifications
* Three or more devices
* Incremental sync optimization
* Conflict UI for manual resolution
