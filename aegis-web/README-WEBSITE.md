# PROJECT AEGIS - Digital Experience Layer (Phase 6)

This repository contains the Next.js 15 frontend for the Six Nine Constructions Corporate Website. It acts as the public presentation layer for **Project Imperium**, interfacing exclusively with the FastAPI backend via Next.js Route Handlers.

## Technology Stack
- **Framework:** Next.js 15 (App Router, Server Components first)
- **Language:** TypeScript (Strict Mode)
- **Styling:** Tailwind CSS (Strict token system, no external UI libs)
- **Animation:** Framer Motion
- **Icons:** Lucide React
- **Forms:** React Hook Form + Zod

## Design System: Industrial Minimalism
The design system is hardcoded into `tailwind.config.ts` and `src/styles/globals.css`. 
**Core rule:** Never hardcode colors or spacing outside the token system. The UI components (`src/components/ui`) are heavily standardized to reflect the "Precision Engineering" aesthetic.

## Architecture
The frontend contains **zero** business logic and no direct database connections.
All dynamic data must be fetched via the Next.js Route Handlers (`src/app/api/...`), which securely proxy requests to the FastAPI backend (`process.env.NEXT_PUBLIC_API_URL`).

### Running Locally (Node)
- `npm run dev` - Start development server
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Running with Docker
You can easily containerize the application for deployment or local execution:

Using Docker Compose (Recommended):
```bash
docker-compose up -d --build
```
This will build and start the frontend on `http://localhost:3000`.

Using raw Docker:
```bash
docker build -t aegis-web .
docker run -p 3000:3000 -d aegis-web
```

## File Structure
- `src/app/`: Next.js App Router pages and API routes
- `src/components/ui/`: Reusable, atomic UI elements
- `src/components/sections/`: Larger page blocks (Cards, Stats, etc.)
- `src/components/forms/`: Complex interactive forms with Zod validation
- `src/components/layout/`: Global layout elements (MegaNav, Footer)
- `src/hooks/`: Custom React hooks (useApiQuery, useCountUp, etc.)
- `src/lib/`: Utilities, constants, API client, validations
- `src/types/`: Domain and API typescript interfaces

*Built to Last. Engineered to Perform.*
