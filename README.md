# Distributed Systems Project 2

This project is a **minimal distributed systems scaffold** built with:

* **Node.js gRPC microservices**
* **Docker Compose orchestration**
* A dedicated **tester service** that exercises system scenarios

The repository is designed so a user can:

> **Download the project and run a single command to build and execute everything.**

---
# Project Layout

Below is the **current folder structure** of the distributed gRPC mono-repo.
This layout is intentionally **minimal, clear, and reproducible**.

```
project-root/
│
├── contracts/
│   └── proto/
│       ├── auth.proto              # LoginService gRPC contract
│       └── gateway.proto           # GatewayService gRPC contract
│
├── services/
│   │
│   ├── login-service/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   └── src/
│   │       └── server.js           # Login gRPC server implementation
│   │
│   ├── gateway-service/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   └── src/
│   │       └── server.js           # Gateway gRPC server implementation
│   │
│   └── tester-service/
│       ├── Dockerfile
│       ├── package.json
│       ├── package-lock.json
│       └── src/
│           ├── run.js              # Stable scenario runner entrypoint
│           └── scenarios/
│               ├── scenario1_login_single_user.js
│               └── scenario2_login_multiple_users.js
│
├── infrastructure/
│   └── docker-compose.yml          # Builds and runs all services
│
├── .gitignore
├── README.md
└── LICENSE (optional)
```

---

## Layout Design Principles

**1. Contracts are centralized**

All shared gRPC definitions live in:

```
contracts/proto/
```

This guarantees a **single source of truth** for service communication.

---

**2. Each service is isolated**

Every microservice contains:

* its own **Dockerfile**
* its own **Node dependencies**
* its own **source code**

This mirrors **real distributed system boundaries**.

---

**3. Tester is scenario-driven**

The tester service uses:

```
run.js → stable entrypoint  
scenarios/ → one file per scenario
```

This allows:

* adding new scenarios **without modifying existing code**
* selecting behavior via **environment variables**
* building a true **system exerciser / load driver**

---

**4. Infrastructure is minimal**

```
infrastructure/docker-compose.yml
```

Provides:

* single-command build
* single-command execution
* reproducible teammate environment

No CI/CD, orchestration, or monitoring is included **yet** by design.

---

This structure forms the **clean baseline** for evolving into a full distributed system while remaining easy to understand and run.

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
# Scaled Microservices Performance Testing

This project supports running the microservice architecture with **N replicas** of:

- `gateway-service`
- `login-service`
- `chat-service`

The test runner will:

1. Reset the Docker environment
2. Start the microservices with scaling enabled
3. Execute performance scenarios `4–11`
4. Run each scenario at user loads `10`, `100`, `1000`, and `5000`
5. Save logs using a consistent naming pattern

---

## Log Naming Convention

Each test run generates a log file with the following format:

```
scaledx_<n>_scenario_<y>_users_<z>.log
```

Where:

- `<n>` = number of service replicas  
- `<y>` = scenario number  
- `<z>` = user count  

Example:

```
scaledx_2_scenario_4_users_10.log
scaledx_2_scenario_11_users_5000.log
```

Logs are written to:

```
./perf_results/
```

---

## Running the Scaled Tests

### 1️⃣ Configure Number of Replicas

Open `run_scaled_tests.ps1` and set:

```powershell
$N = 2
```

Change `2` to any desired number of replicas (e.g., `1`, `2`, `4`).

---

### 2️⃣ Execute the Test Script

From the project root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\run_scaled_tests.ps1 -N xxx
```

The script will:

- Bring down any existing containers
- Start the stack with:

```
--scale gateway-service=<N>
--scale login-service=<N>
--scale chat-service=<N>
```

- Execute all scenarios and loads
- Save performance logs automatically

---

## Verifying Load Distribution

While a test is running, you can verify scaling using:

```powershell
docker stats
```

You should observe CPU activity on multiple replicas of:

- `gateway-service`
- `login-service`
- `chat-service`

If only one replica shows activity, load balancing is not configured correctly.

---

## Purpose of Scaled Testing

This experiment evaluates:

- Horizontal scalability of the microservice architecture
- Throughput growth as replicas increase
- Latency stabilization under high concurrency
- Whether bottlenecks shift from application layer to database layer

This enables direct comparison between:

- 1× microservices
- N× microservices
- Monolithic architecture

---



