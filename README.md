# Distributed Systems Project 2

This project is a **minimal distributed systems scaffold** built with:

* **Node.js gRPC microservices**
* **Docker Compose orchestration**
* A dedicated **tester service** that exercises system scenarios

The repository is designed so a user can:

> **Download the project and run a single command to build and execute everything.**

---

# 1. Prerequisites

You must have:

* **Docker Desktop** installed and running
* **Docker Compose v2** (included with Docker Desktop)

Verify Docker is working:

```bash
docker version
docker compose version
```

Both commands must succeed before continuing.

---

# 2. Download the Project

## Option A — Clone with Git (recommended)

```bash
git clone https://github.com/jonathanfallen/ds5306-PR2.git
cd ds5306-PR2
```

## Option B — Download ZIP

1. Download the repository ZIP from GitHub
2. Extract the archive
3. Open a terminal in the extracted folder

---

# 3. Build and Run the System

From the **repository root**:

```bash
docker compose -f infrastructure/docker-compose.yml up --build
```

This single command will:

1. Build Docker images for all services
2. Run `npm ci` **inside containers**
3. Start the gRPC services
4. Execute the **tester service**

Stop the system:

```bash
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
```

---

# 4. Tester Scenarios

The tester service supports **multiple execution scenarios**.
A scenario is selected using the **`SCENARIO` environment variable**.

---

## Scenario 1 — Login Single User

**Behavior**

* Logs in **one user**
* Prints the returned credential
* Exits

**Run (Windows CMD)**

```bat
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
set SCENARIO=1
docker compose -f infrastructure/docker-compose.yml up --build
```

**Expected output**

```
Tester: starting Scenario 1...
Scenario 1: login single user...
Scenario 1: user1 -> credential="cred-user1-demo"
Tester: Scenario 1 complete.
```

---

## Scenario 2 — Login Five Users (Login-Only)

**Behavior**

* Logs in **five users**
* Prints each credential
* No gateway calls are made
* Exits after completion

**Run (Windows CMD)**

```bat
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
set SCENARIO=2
docker compose -f infrastructure/docker-compose.yml up --build
```

**Expected output**

```
Tester: starting Scenario 2...
Scenario 2: login-only for 5 users
Scenario 2: user1 -> credential="cred-user1-demo"
Scenario 2: user2 -> credential="cred-user2-demo"
Scenario 2: user3 -> credential="cred-user3-demo"
Scenario 2: user4 -> credential="cred-user4-demo"
Scenario 2: user5 -> credential="cred-user5-demo"
Tester: Scenario 2 complete.
```

---

# 5. Service Ports

| Service        | Port      |
| -------------- | --------- |
| LoginService   | **50051** |
| GatewayService | **50052** |

Both are exposed on **localhost**.

---

