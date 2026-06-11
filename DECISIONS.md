# DECISIONS.md

## Data Model

Every user action is represented as an immutable operation (Op).

Examples:

* SESSION_STARTED
* SESSION_COMPLETED
* SESSION_FAILED
* TASK_STATUS_CHANGED
* TASK_DELETED

Each operation contains:

* opId (UUID)
* deviceId
* type
* payload

Operations are never edited after creation.

---

## Sync Model

The server maintains a master register.

The register is an append-only ordered log of operations.

Each operation receives:

* serverSeq

Clients maintain:

* confirmed operations
* pending operations
* cursor

Sync process:

1. Client sends pending operations.
2. Server appends unseen operations.
3. Duplicate operations are discarded.
4. Server returns all operations after cursor.
5. Client updates confirmed state.

---

## Why Devices Always Converge

All devices eventually receive the same register.

All devices apply:

* the same operations
* in the same order
* using the same reducer

Therefore:

same register
+
same order
+
same reducer

always produces identical state.

This guarantees convergence.

---

## Conflict Resolution Strategy

### Same Task Edited On Both Devices

Server register order decides winner.

The operation that appears later in the register wins.

Reason:

This is deterministic and guarantees convergence.

---

### Edit vs Delete

Delete wins.

Once a task is deleted:

* it is added to tombstones
* future edits are ignored

Reason:

Deleted entities should not reappear.

---

### Duplicate Sync Requests

Duplicate operations are detected using opId.

The server stores all processed IDs in:

seenIds

Duplicate operations are discarded.

---

### Out Of Order Arrival

Server assigns serverSeq.

Reducers process operations in serverSeq order.

Therefore arrival order does not matter.

---

## Reward Idempotency

Successful focus sessions must award rewards exactly once.

The backend maintains:

rewardedSessions

Before awarding:

if sessionId already exists:

* skip reward
* skip streak increment
* skip coin award

Otherwise:

* award reward
* record sessionId

Result:

Retries and replays never create duplicate rewards.

---

## Notification Idempotency

The backend creates outbox entries keyed by sessionId.

Only one outbox entry may exist per successful session.

Even if sync replays occur:

* no additional outbox entries are created

n8n performs a second deduplication layer.

It remembers eventId values and ignores duplicates.

Result:

Notifications are delivered exactly once from the user's perspective.

---

## Tradeoff

Chosen approach:

Append-only operation log.

Pros:

* Simple
* Easy to debug
* Strong convergence guarantees
* Easy idempotency handling

Cons:

* Register grows indefinitely
* Requires periodic compaction in production

For this assignment, simplicity and correctness were prioritized over storage efficiency.

---

## Where This Could Still Break

* Register growth over very long periods
* n8n dedupe memory reset after workflow re-import
* No authentication
* Single student account assumption

These limitations were accepted to keep the implementation simple and focused on sync correctness.
