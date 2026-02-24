# Distributed Chat System (Monolith + Microservices)

## Overview

This project implements a distributed chat system that supports both:

-   A **Monolithic deployment**
-   A **Microservices deployment**

It includes performance testing scenarios and automated PowerShell
scripts to validate scalability and behavior under load.

------------------------------------------------------------------------

## Prerequisites

-   Docker Desktop (Windows 11) or Docker Engine
-   Docker Compose v2 (`docker compose version`)
-   PowerShell 5+ or PowerShell Core

------------------------------------------------------------------------

## Project Structure

``` text
project_extracted/
├── contracts/
│   └── proto/
│       ├── auth.proto
│       ├── chat.proto
│       ├── chatroom.proto
│       └── gateway.proto
├── data/
├── infrastructure/
│   ├── docker-compose.yml
│   ├── docker-compose.monolith.yml
│   └── envoy.yaml
├── services/
│   ├── monolith-service/
│   ├── login-service/
│   ├── chat-service/
│   ├── chatroom-service/
│   ├── gateway-service/
│   └── tester-service/
├── monolithic_tests.ps1
└── run_scaled_tests.ps1
```

------------------------------------------------------------------------

## Running the System

All docker-compose files are located under:

    infrastructure/

------------------------------------------------------------------------

## Run Monolithic Deployment

### Start

``` bash
docker compose -f infrastructure/docker-compose.monolith.yml up --build
```

### Stop

``` bash
docker compose -f infrastructure/docker-compose.monolith.yml down
```

------------------------------------------------------------------------

## Run Microservices Deployment

### Start

``` bash
docker compose -f infrastructure/docker-compose.yml up --build
```

### Stop

``` bash
docker compose -f infrastructure/docker-compose.yml down
```

------------------------------------------------------------------------

## Performance & Test Execution

Two PowerShell scripts are provided at repository root:

-   `monolithic_tests.ps1`
-   `run_scaled_tests.ps1`

### Re-run Monolithic Tests

``` powershell
.\monolithic_tests.ps1
```

This will execute the defined monolith performance scenarios and
generate logs in:

    data/

------------------------------------------------------------------------

### Re-run Scaled Microservice Tests

``` powershell
.un_scaled_tests.ps1
```

This executes scaled performance scenarios and stores output logs in:

    data/

------------------------------------------------------------------------

## Test Scenarios

The tester-service contains load scenarios under:

    services/tester-service/src/scenarios/

These simulate:

-   Login stress (10 → 5000 users)
-   Login + Chat combined load
-   Gateway routing behavior
-   Multi-service scaling behavior

------------------------------------------------------------------------

## Logs & Analysis

Performance logs are written to:

    data/

Comparison utilities: - `compare-perf-logs.ps1`

------------------------------------------------------------------------

## Architecture Notes

-   gRPC contracts are defined under `contracts/proto/`
-   Envoy is configured via `infrastructure/envoy.yaml`
-   Database initialization scripts exist under each `*-db/init/` folder
-   Each service includes its own Dockerfile

------------------------------------------------------------------------

## Cleanup

Remove containers and volumes:

``` bash
docker compose -f infrastructure/docker-compose.yml down -v
docker compose -f infrastructure/docker-compose.monolith.yml down -v
```

------------------------------------------------------------------------

## Last Generated

2026-02-24 06:59:18
