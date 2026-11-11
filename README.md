# ft_transcendence

> [!IMPORTANT]
> THIS REPOSITORY IS A STRIPPED OUT VERSION OF THE PROJECT. BUILDING IT DOES NOT WORK.

## Table of Contents

- [1. Description](#1-description)
- [2. Project Management](#2-project-management)
- [3. Technical Stack](#3-technical-stack)
  - [3.1. Game client](#31-game-client)
  - [3.2. Frontend](#32-frontend)
  - [3.3. Backend](#33-backend)
  - [3.4. DevOps](#34-devops)
  - [3.5. Justification of major technical choices](#35-justification-of-major-technical-choices)
- [4. Database Schema](#4-database-schema)
- [5. Features List](#5-features-list)
- [6. Service responsibilities](#6-service-responsibilities)
- [7. Individual Contributions](#7-individual-contributions)
- [8. Resources](#8-resources)
  - [8.1. References](#81-references)
  - [8.2. AI usage](#82-ai-usage)
- [9. Credits](#9-credits)
- [10. License](#10-license)

## 1. Description

 is a web-based, real-time 3D multiplayer game platform.

The goal of the project is to let players create accounts, join game rooms from a lobby, and compete
against each other — or against AI opponents — in live 3D matches directly in the browser, with no
installation required. Spectators can watch ongoing matches in real time.

### Key features

- **Accounts and profiles** — email/password sign-up and login, with editable avatar and username.
- **Lobby and rooms** — browse and create rooms, up to 6 players per match, plus unlimited live
  spectators.
- **Real-time gameplay** — WebSocket-based multiplayer for remote players (on separate computers),
  against other players or AI opponents, with graceful handling of latency and disconnections.
- **Custom renderer** — a C++/WebGPU 3D renderer compiled to WebAssembly, driving gameplay and visuals
  in the browser.
- **Backend services** — a microservice architecture on PostgreSQL (persistent data) and Redis
  (sessions/live state), exposing a documented, API-key-secured and rate-limited public API.


## 2. Project Management

**Organisation.** The team started with offline meetings to agree on the project idea and scope, and
to divide the work by area — frontend, backend, database, bots and game mechanics — with each member owning their area. A mid-project in-person catch-up was used to review progress and re-balance
remaining work. Several unofficial meetings to test the game together at school. Between meetings, work was coordinated through the team's Discord channel, and every task was tracked as a GitHub Issue assigned to its owner.

**Tools.** GitHub Projects (board) + GitHub Issues for task distribution and tracking; Git/GitHub for
version control and code review.

**Communication.** Discord (group chat, plus voice for pairing and review sessions).

## 3. Technical Stack

### 3.1. Game client

The game itself is a custom C++ client compiled to WebAssembly and driven by the React shell.

| Library | Role |
| --- | --- |
| **WebGPU** (C++ Dawn headers) | Rendering API — the renderer submits draw work to WebGPU through Dawn's C++ bindings. |
| **Box3D** | Rigid-body physics and collision. |
| **EnTT** | Entity Component System — organises game objects and systems. |
| **cgltf** | Loading glTF 3D models and scenes. |
| **glaze** | Fast JSON serialisation/deserialisation for network messages and config. |
| **glm** | Vector/matrix maths for transforms, camera and rendering. |
| **stb_image** | Decoding image files into textures. |
| **FMOD** | Audio playback and mixing. |

### 3.2. Frontend

A React + TypeScript single-page application built with Vite. It provides the account, room and
lobby experience along with the in-game interface. Gameplay and rendering are handled by the C++
client running in WebAssembly, while React manages the surrounding UI.

- **Vite** — dev server and production bundling.
- **React** — component model for the multi-screen UI.
- **TypeScript** — static typing across the frontend and its API contracts.

### 3.3. Backend

- **Node.js** with Fastify handles account authentication, profiles, room
  operations, and HTTP health endpoints.
- **`@fastify/cookie`** supports cookie-based account sessions.
- **Prisma ORM** provides the PostgreSQL models and database client.
- **PostgreSQL** stores player accounts, account sessions, and match-history
  records.
- **Redis** stores temporary room information and supports coordination
  between the backend and game server.
- **`ioredis`** connects the Node.js backend to Redis.
- **Argon2** provides password hashing.
- **uWebSockets** The C++ game server uses uWebSockets for real-time game connections.
  It is separate from the Node.js Fastify application.

### 3.4. DevOps

- **Docker** — containerised builds and a reproducible dev/production environment.
- **NGINX** — reverse proxy in front of the services (TLS termination, static assets, routing).

### 3.5. Justification of major technical choices

The following explains how the technologies fit the implementation.

- **React** and **TypeScript** organise the player-facing application into reusable
  screens and components, with typed interfaces between the UI and backend.

- **C++** allows the game simulation and browser client to share core game
  code. Emscripten compiles the browser client to WebAssembly.

- **WebGPU** provides direct control over GPU resources, rendering pipelines,
  shaders, and draw submission. The custom renderer integrates with the
  C++ game code rather than relying on a complete external 3D engine.

- **EnTT** separates game objects into components and systems, allowing
  rendering, physics, input, and networking to work with the same entities.

- **Box3D** provides rigid-body simulation and collision handling for the
  vehicles, ball, and arena.

- **FMOD** handles game audio, including engine and impact sounds.

- **PostgreSQL** provides persistent relational storage. Unique constraints
  protect account identifiers, while the account/session relation defines
  session ownership.

- **Prisma** keeps the relational schema and application database access in a
  shared model definition.

- **Redis** separates short-lived room state and coordination data from
  persistent account data.

- **Separate containers**  keep HTTP requests, real-time simulation, AI
  inference, storage, and reverse-proxy responsibilities distinct.

## 4. Database Schema

### Redis and live game state

Redis supports temporary room data and communication between the HTTP
backend and game server.

The game server holds the active simulation and room roster in memory.
Redis provides backend-facing room information and a channel for
game-server lifecycle reports.

The backend starts a game-event consumer to process reports such as
players leaving and rooms closing.

Account-session records are defined in PostgreSQL; they should not be
confused with temporary room membership.

## 5. Features List

The table below describes the ownership of the main implementation areas.

| Feature | Description | Main contributor(s) |
| --- | --- | --- |
| Authentication | Email/password sign-up and login, cookie-based sessions, session restoration, and logout. | Daniel |
| Session coordination | Rejects another active login for the same account and synchronises browser authentication state across tabs. | Daniel |
| Profile editing | Editable username and avatar, including a one-hour username-change cooldown. | Daniel, Giang |
| Database access | PostgreSQL schema, Prisma integration, Redis access, and repository abstractions. | Janne, with authentication/schema integration by Daniel |
| Database lifecycle | Startup checks, readiness reporting, shutdown handling, and regression-test reporting. | Janne |
| Game assets | Original team-created 3D models for the game. | Mika |
| Game simulation | Vehicle and ball physics, arena collisions, scoring, and match-state transitions. | Mika |
| Multiplayer | Two teams with three driving slots each, supporting up to six simultaneous drivers. | Mika |
| Spectator mode | Connected users without a driving slot can watch the live match. | Mika |
| AI opponents | A trained policy controls CPU-assigned vehicles through a separate AI service. | Cristian |
| Audio | FMOD integration for engine and impact sounds. | Cristian |
| Legal pages | Terms of Service, Privacy Policy, and Credits. | Giang |
| Game tickets | Backend-issued short-lived authorisation for game-room connections. | Giang, Janne |
| Room interface | Room creation, room browsing, and room entry. | Giang, Janne |
| Live lobby | Displays server-owned seats, player information, spectator count, and match state. | Giang, Mika |
| Match interface | Countdown, score/timer HUD, match results, and mid-game quit flow. | Giang |
| Real-time networking | WebSocket snapshots, client prediction, server reconciliation, and interpolation. | Mika |
| 3D renderer | Custom C++/WebGPU rendering, materials, lighting, shadows, and grass effects. | Mika |
| Reverse proxy | NGINX routing and TLS termination. | Cristian |

## 6. Service responsibilities

| Compose service | Responsibility |
| --- | --- |
| `frontend` | Builds and serves the player-facing web application. |
| `nginx` | Public entry point, TLS termination, and routing to application services. |
| `backend` | Authentication, profiles, room HTTP operations, database access, and health endpoints. |
| `game-server` | Authoritative room rosters, simulation, input validation, and live game updates. |
| `game-ai` | Loads the trained policy and supplies input for CPU-controlled vehicles. |
| `postgres` | Persistent relational storage. |
| `redis` | Temporary room data and inter-service coordination. |

## 7. Individual Contributions

### [Mika](https://github.com/mordori)

- **Tasks**:
  - Implemented the shared C++ game systems and browser game client.
  - Integrated vehicle and ball physics, collisions, scoring, and match rules.
  - Implemented the authoritative game server and room/seat management.
  - Implemented real-time snapshots, client-side prediction,
    reconciliation, and remote-object interpolation.
  - Built the custom WebGPU renderer, material system, lighting,
    shadows, mesh instancing, and grass/trail effects.
  - Created the game's original 3D models.
  - Implemented spectator behaviour and integration between the C++
    engine and browser application.

- **Technical challenges addressed**:
  - Keeping local controls responsive while the server remains authoritative.
  - Sharing game logic between native and WebAssembly builds.
  - Integrating rendering, physics, room ownership, and networking.


### [Daniel](https://github.com/OneEyedWilly293)

- **Tasks**:
  - Implemented backend account registration and login.
  - Integrated account authentication with persistent session records.
  - Implemented browser sign-up, login, session restoration, and logout.
  - Added rejection of a new login when the account already has an
    active session.
  - Added browser-tab synchronisation for authentication state.
  - Implemented username/avatar editing and the one-hour
    username-change cooldown.
  - Added and reviewed authentication/profile tests and integration changes.
  - Participated in code reviews and integration checks across the
    frontend, backend, and database boundaries.

- **Technical challenges addressed**:
  - Keeping cookie state, server-side sessions, and browser UI state consistent.
  - Preventing conflicting active logins for the same account.
  - Applying profile validation and cooldown rules consistently.


### [Janne](https://github.com/cubicajupiter)

- **Tasks**:
  - Integrated PostgreSQL and Redis with the backend.
  - Implemented database schemas and database-access repositories.
  - Implemented temporary room-state operations and atomic Redis updates.
  - Added database lifecycle management, connection checks,
    readiness reporting, and shutdown handling.
  - Added database regression tests and startup test reporting.
  - Implemented game-server/Redis synchronisation and room lifecycle
    reporting.
  - Contributed to backend room operations and game-entry integration.

- **Technical challenges addressed**:
  - Keeping temporary room state consistent during concurrent joins and leaves.
  - Handling expiration boundaries and database connection failures.
  - Separating application readiness from informational regression reports.

### [Cristian](https://github.com/cristichitz)

- **Tasks**:
  - Built the reinforcement-learning training environment.
  - Trained and integrated the AI policy.
  - Implemented the Python bot service and Dockerised inference.
  - Adapted observations and actions for multi-player/team gameplay.
  - Implemented FMOD integration for engine and impact sounds.
  - Implemented the initial NGINX TLS termination and reverse proxy.
  - Contributed to dependency-installation support.

- **Technical challenges addressed**:
  - Keeping training observations compatible with live game snapshots.
  - Controlling multiple CPU vehicles through one inference service.
  - Keeping bot decisions aligned with the game's simulation ticks.
  - Integrating game audio into the browser client.

### [Giang](https://github.com/Kjngita)

- **Tasks**:
  - Built the main player-facing frontend with React and TypeScript,
    including account screens, room browsing, lobby, and in-game views.
  - Implemented room creation, room-list display, and room-entry flows.
  - Contributed the game-ticket flow securing room entry.
  - Integrated the lobby with the server's roster and spectator count,
    including ignoring stale status revisions.
  - Implemented match countdown, score/timer HUD, results, and error views.
  - Implemented mid-game quit and return-to-menu behaviour.
  - Added the legal pages, manual, credits, and project documentation.
  - Collaborated on profile editing and frontend/backend integration.

- **Technical challenges addressed**:
  - Keeping the React interface aligned with the game server's state.
  - Integrating a WebAssembly game engine into the application lifecycle.
  - Handling transitions between lobby, match, results, and main menu.


## 8. Resources

### 8.1. References

Documentation relevant to understanding the implementation:

- React documentation — component-based user interfaces.
- TypeScript Handbook — application types and interfaces.
- Vite documentation — frontend development and production builds.
- Fastify documentation — routing, validation schemas, plugins, and testing.
- Prisma documentation — schema models, generated clients, and PostgreSQL access.
- PostgreSQL documentation — relational storage, constraints, and connections.
- Redis and ioredis documentation — temporary state and Redis client behaviour.
- Emscripten documentation — compiling C++ to WebAssembly and browser integration.
- WebGPU and Dawn documentation — GPU resources, pipelines, and C++ API usage.
- EnTT documentation — entity/component organisation.
- Box3D project documentation and source — rigid-body simulation.
- FMOD documentation — audio playback and engine integration.
- PyTorch and RLGym-PPO documentation — trained-policy inference and training.
- Docker Compose documentation — service orchestration, networks, volumes, and secrets.
- NGINX documentation — reverse proxying and TLS termination.

### 8.2. AI usage

AI assistants were used as development aids for explanation, debugging,
design discussions, test ideas, and documentation.

Uses included:

- Explaining unfamiliar technologies and existing code.
- Discussing alternative implementations and potential edge cases.
- Interpreting errors and suggesting checks.
- Assisting with repetitive code and test drafts.
- Drafting commit messages, review comments, and documentation.


Generated suggestions are not treated as proof that code is correct or
that a feature is complete. Contributors remain responsible for
understanding, reviewing, adapting, and testing the material they use.

## 9. Credits

The original 3D models identified in this README were created by the team.

The project also depends on third-party libraries, tools, and runtimes.
Their licenses and attribution requirements apply separately.

## 10. License

See `LICENSE.md` for the repository's usage restrictions.

The current notice states that the repository is provided for educational
and portfolio demonstration purposes and prohibits commercial use,
redistribution, or modification for commercial purposes.

Third-party dependencies remain subject to their respective licenses.
