# Expo Monorepo Setup

## Overview
Expo apps live in apps/customer-mobile/ and apps/restaurant-mobile/.
Metro is configured for monorepo workspace resolution.

## metro.config.js Pattern
Each app's metro.config.js watches the workspace root and resolves packages
from both the app's own node_modules and the workspace root's node_modules.

## API URL
Use EXPO_PUBLIC_API_URL for the backend API base URL.
Example: http://192.168.x.x:5000 for local development.

## Running
From `apps/customer-mobile/`: `npx expo start`
Or from root: `npm --workspace @avenzo/customer-mobile run start`

## TypeScript
Apps extend expo/tsconfig.base.
Type checking: `npm --workspace @avenzo/customer-mobile run typecheck`
