<img src="./docs/arai-logo-mark-light.png" alt="ARAI.CO logo" width="320" />

# ARAI.CO

A full-stack telehealth platform where patients discover doctors, book appointments, and consult remotely, doctors manage their availability and patient records, and administrators oversee users, doctors, appointments, and audit activity.

Built as a pnpm monorepo with a NestJS + Prisma API and a Vite + React web client.

<!-- Replace with your deployed URLs once available -->

> **Status:** Proof of concept. Not intended for production or real patient data.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
  - [Demo Accounts](#demo-accounts)
  - [Running with Docker](#running-with-docker)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Features

**Patient**

- Browse and search doctors by specialty and symptoms
- View doctor profiles, availability, and schedules
- Book, reschedule, and cancel appointments
- Attend remote consultation sessions and view consultation notes
- View prescriptions and notifications

**Doctor**

- Manage professional profile and consultation details
- Define and update availability windows
- Review upcoming appointments and patient records
- Conduct consultations and author notes/prescriptions

**Admin**

- Manage user accounts and account states
- Approve or reject doctor registrations
- Oversee appointments across the platform
- Dashboard metrics and audit log review

**Platform**

- JWT-based authentication with role-based access control
- Optional AI-assisted symptom-to-specialty matching (DeepSeek)
- In-app notification system
- Audit logging of administrative actions

## Tech Stack

| Layer      | Technology                                                                          |
| ---------- | ----------------------------------------------------------------------------------- |
| Frontend   | React 18, Vite, TypeScript, React Router, Tailwind CSS v4, Radix UI, Lucide, Sonner |
| Backend    | NestJS 10, Prisma 5, PostgreSQL 16, Passport JWT, bcrypt, class-validator           |
| Tooling    | pnpm workspaces, ESLint, Prettier, Jest, Vitest, Testing Library, Docker Compose    |
| Deployment | Fly.io (backend + frontend), Nginx (static frontend serving)                        |

## Architecture

```
┌──────────────────────┐        HTTP/JSON        ┌──────────────────────┐
│  Frontend (Vite)     │  ───────────────────▶   │  Backend (NestJS)    │
│  React + TypeScript  │  ◀───────────────────   │  REST API + JWT      │
└──────────────────────┘                         └───────────┬──────────┘
                                                             │ Prisma
                                                             ▼
                                                 ┌──────────────────────┐
                                                 │  PostgreSQL 16       │
                                                 └──────────────────────┘
```

- `apps/frontend` — single-page application, feature-sliced by domain (`auth`, `patient`, `doctor`, `admin`, `notifications`, `public`).
- `apps/backend` — modular REST API; one Nest module per domain (`auth`, `doctors`, `appointments`, `consultations`, `notifications`, `admin`, `audit`, `patients`).
- `apps/backend/prisma` — schema, migrations, and seed script.

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **pnpm** 9.12.0 (`corepack enable` or `npm i -g pnpm@9`)
- **Docker** + Docker Compose (recommended for PostgreSQL)
- **PostgreSQL 16** if running the database natively

### Installation

```bash
git clone git@github.com:jlgrms/arai-co.git
cd arai-co
pnpm install
```

### Environment Variables

Copy the example file and adjust values:

```bash
cp .env.example .env
```

| Variable            | Description                                                                 | Default                          |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| `DATABASE_URL`      | PostgreSQL connection string used by Prisma                                 | —                                |
| `POSTGRES_USER`     | Database user (Docker Compose)                                              | `telehealth`                     |
| `POSTGRES_PASSWORD` | Database password (Docker Compose)                                          | `telehealth`                     |
| `POSTGRES_DB`       | Database name (Docker Compose)                                              | `telehealth`                     |
| `POSTGRES_PORT`     | Host port mapped to PostgreSQL                                              | `5432`                           |
| `BACKEND_PORT`      | Port the API listens on                                                     | `3000`                           |
| `FRONTEND_PORT`     | Port the web client is served on                                            | `5173`                           |
| `NODE_ENV`          | Runtime environment                                                         | `development`                    |
| `VITE_API_BASE_URL` | API base URL consumed by the frontend                                       | `http://localhost:3000`          |
| `JWT_SECRET`        | Secret used to sign JWTs — **change in any real deployment**                | `change-me-in-a-real-deployment` |
| `JWT_EXPIRES_IN`    | JWT lifetime                                                                | —                                |
| `DEEPSEEK_API_KEY`  | Optional key for AI symptom matching; blank disables the feature gracefully | _(empty)_                        |

> **Never commit `.env`.** Only `.env.example` belongs in version control.

### Running Locally

```bash
# 1. Start PostgreSQL
docker compose up -d postgres

# 2. Apply migrations and seed sample data
pnpm --filter @telehealth/backend prisma:migrate
pnpm --filter @telehealth/backend prisma:seed

# 3. Run both apps in parallel
pnpm dev
```

| Service     | URL                   |
| ----------- | --------------------- |
| Frontend    | http://localhost:5173 |
| Backend API | http://localhost:3000 |

Run a single app with `pnpm dev:backend` or `pnpm dev:frontend`.

### Demo Accounts

The seed script (`apps/backend/prisma/seed.ts`) creates ready-to-use accounts so
the app is demoable immediately after seeding. All data is **fictional and for
local development only**.

| Role        | Email                    | Password          |
| ----------- | ------------------------ | ----------------- |
| **Patient** | `jordan.lee@example.com` | `PatientPass123!` |
| **Doctor**  | `dr.patel@example.com`   | `DoctorPass123!`  |
| **Admin**   | `admin@example.com`      | `AdminPass123!`   |

**Other seeded accounts** (same shared password per role):

| Role    | Email                           | Notes                                                 |
| ------- | ------------------------------- | ----------------------------------------------------- |
| Patient | `sam.rivera@example.com`        | No consultation history — demonstrates empty states   |
| Patient | `alex.kim@example.com`          | No consultation history — demonstrates empty states   |
| Doctor  | `dr.chen@example.com`           | Cardiology, APPROVED                                  |
| Doctor  | `dr.okafor@example.com`         | Dermatology, APPROVED                                 |
| Doctor  | `dr.reyes@example.com`          | General Medicine, APPROVED (second in specialty)      |
| Doctor  | `dr.nguyen@example.com`         | Pediatrics, APPROVED                                  |
| Doctor  | `dr.silva@example.com`          | Psychiatry, APPROVED                                  |
| Doctor  | `dr.test001@example.com` …      | 70 generated doctors, for pagination and scale demos  |
| Doctor  | `dr.pending@example.com`        | PENDING — populates the admin Doctor Review queue     |
| Doctor  | `dr.rejected@example.com`       | REJECTED — exercises the rejected review state        |
| Patient | `suspended.patient@example.com` | SUSPENDED — valid credentials return **403** on login |

> **Password convention:** every patient shares `PatientPass123!`, every doctor
> shares `DoctorPass123!`, and the admin uses `AdminPass123!`.

**Where to start:** sign in as `jordan.lee@example.com` — that patient carries
three completed consultations with notes and prescriptions plus one upcoming
session, so the consultation workspace and medical records views are populated.
The other patients are intentionally empty to make the empty states reachable.

### Running with Docker

Bring up the full stack (database, API, and web client) with hot reload:

```bash
pnpm compose:up      # docker compose up --build
pnpm compose:down    # stop
pnpm compose:reset   # stop and remove volumes (drops the database)
```

## Testing

```bash
pnpm test                                   # all workspaces
pnpm --filter @telehealth/backend test      # Jest (API)
pnpm --filter @telehealth/frontend test     # Vitest (UI)
pnpm lint
pnpm format:check
```

End-to-end evidence harnesses live in `scripts/` and can be run against a live stack, e.g. `node scripts/evidence-sub3-happy.mjs`.

## Project Structure

```
.
├── apps/
│   ├── backend/            # NestJS API
│   │   ├── prisma/         # schema, migrations, seed
│   │   └── src/            # domain modules (auth, doctors, appointments, ...)
│   └── frontend/           # Vite + React SPA
│       └── src/
│           ├── app/        # router, nav, route guards
│           ├── features/   # domain features (patient, doctor, admin, ...)
│           └── components/ # shared UI primitives
├── docs/                   # design and reconnaissance notes
├── scripts/                # E2E evidence harnesses and utilities
├── docker-compose.yml
├── postman_collection.json # importable API collection
└── DEFERRED.md             # known debt and deferred work
```

## API Reference

The API is a JSON REST service. Import [`postman_collection.json`](./postman_collection.json) (with `postman_environment.json`) into Postman to explore all endpoints.

Representative routes:

| Method  | Endpoint             | Description                             |
| ------- | -------------------- | --------------------------------------- |
| `POST`  | `/auth/register`     | Register a patient account              |
| `POST`  | `/auth/login`        | Authenticate and receive a JWT          |
| `GET`   | `/doctors`           | List/search doctors                     |
| `GET`   | `/doctors/:id`       | Doctor profile and availability         |
| `POST`  | `/appointments`      | Book an appointment                     |
| `PATCH` | `/appointments/:id`  | Reschedule or cancel                    |
| `POST`  | `/consultations/:id` | Start/join a consultation session       |
| `GET`   | `/notifications`     | List notifications for the current user |
| `GET`   | `/admin/users`       | Admin: list and manage users            |
| `GET`   | `/admin/audit`       | Admin: read the audit log               |
| `GET`   | `/health`            | Health check                            |

Authenticated requests require an `Authorization: Bearer <token>` header.

## Data Model

Core Prisma models (`apps/backend/prisma/schema.prisma`):

`User`, `PatientProfile`, `DoctorProfile`, `Availability`, `Appointment`, `ConsultationSession`, `ConsultationNote`, `Prescription`, `Notification`, `AuditLog`, `SymptomSpecialtyMap`.

Enums cover `Role`, `AccountState`, `ApprovalStatus`, `AppointmentStatus`, and `ConsultationState`.

## Roadmap

Tracked in [`DEFERRED.md`](./DEFERRED.md). Notable open items:

- Paginate the audit log (currently unbounded)
- Consistent mutation-response shapes across admin endpoints
- UTC timestamp rendering in the UI
- Multi-administrator audit behavior is untested

## Contributing

1. Create a branch: `git checkout -b feat/short-description`
2. Make focused commits (Conventional Commits style preferred)
3. Ensure `pnpm lint`, `pnpm format:check`, and `pnpm test` pass
4. Open a pull request describing the change and how you verified it

## Security

- Do not commit secrets, `.env` files, or real patient data.
- Change `JWT_SECRET` and database credentials before any non-local deployment.
- Report vulnerabilities privately to the maintainers rather than via public issues.

## License

No license has been declared. Absent a license, this code is provided **all rights reserved** — add a `LICENSE` file (e.g. MIT) if you intend to allow reuse.

---

## Notes on this README

A README for a public repository should typically cover:

- **What it is** — a one-line description and the problem it solves
- **Features** — what users can actually do
- **Tech stack** — languages, frameworks, and key dependencies
- **Prerequisites & installation** — exact commands to get running
- **Configuration** — required environment variables and defaults
- **How to run** — local and containerized workflows
- **Testing** — how to verify the code works
- **Project structure** — orientation for new contributors
- **API reference** — endpoints or a link to docs
- **Roadmap / known issues** — current state and what's next
- **Contributing** — branch, commit, and PR conventions
- **License** — usage terms
- **Contact / maintainers** — where to ask questions

Sections above that still need filling in for this repo: **license choice**, **maintainer contact**, **screenshots or demo link**, and **CI/status badges**.
