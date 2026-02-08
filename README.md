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

# Tester Scenarios

The **tester service** executes predefined system scenarios.
Scenarios are selected using the **`SCENARIO` environment variable** and default to **Scenario 1** if not specified.

All commands below are run from the **repository root**.

---

# Scenario 1 — Login Single User (Default)

## Behavior

* Logs in **one user**
* Prints the returned credential
* Exits when complete

## Run (Windows CMD)

```bat
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
docker compose -f infrastructure/docker-compose.yml up --build
```

Because no `SCENARIO` value is provided, Docker Compose uses the default:

```
SCENARIO=1
```

## Expected Output

```
Tester: starting Scenario 1...
Scenario 1: login single user...
Scenario 1: user1 -> credential="cred-user1-demo"
Tester: Scenario 1 complete.
```

---

# Scenario 2 — Login Five Users (Login-Only)

## Behavior

* Logs in **five users**
* Prints each returned credential
* Makes **no gateway calls**
* Exits after completion

## Run (Windows CMD)

```bat
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
set "SCENARIO=2" && docker compose -f infrastructure/docker-compose.yml up --build
```

## Optional: Override User Count

```bat
docker compose -f infrastructure/docker-compose.yml down --remove-orphans
set "SCENARIO=2" && set "USER_COUNT=10" && docker compose -f infrastructure/docker-compose.yml up --build
```

---

# Notes

* Docker Compose passes environment variables into the **tester container** using:

```
SCENARIO=${SCENARIO:-1}
USER_COUNT=${USER_COUNT:-5}
```

* If no environment variables are set:

  * **Scenario 1 runs**
  * **5 users** is the default for Scenario 2

* No code changes are required to switch scenarios.

---



