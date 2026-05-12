# Avenzo Design System

## Product Feel

Avenzo should feel calm, premium, and operationally trustworthy. Customer surfaces should be simple and warm. Restaurant/admin surfaces should be dense, scannable, and work-focused.

## Typography

- Page title: 24-40px depending on context.
- Card title: 17-22px.
- Body: 14-16px.
- Utility/eyebrow: 12px uppercase, strong weight.

## Spacing

- Page gutters: 20-40px desktop, 10-18px mobile.
- Cards/forms: 14-18px internal padding.
- Grid gaps: 12-18px.

## Colors

- Brand orange for primary customer action.
- Cocoa/dark for restaurant/admin primary action.
- Green for success/ready/active.
- Red only for risk, blocked, or destructive states.

## Components

- Buttons: explicit action copy such as `Sign in`, `Create customer account`, `Restaurant login`, `Submit restaurant interest`.
- Cards: use for individual items, forms, and modals only.
- Badges/pills: status, counts, roles, food type, payment status.
- Forms: labels always visible, helper text for sensitive fields like phone and OTP.
- Empty states: short message plus next action.

## Auth Layout

- Homepage has one generic auth entry.
- Customer and restaurant credential forms live on separate pages.
- Restaurant login is partner-only and must never show signup.

## Sticky Rules

- Desktop menu: sticky vertical category sidebar, independently scrollable.
- Mobile menu: sticky horizontal category chips, full-width menu content, one page scroll.
- Cart CTA: sticky bottom only when meaningful and must not cover content.

## Admin Layout

- Prioritize scan density, filters, counts, and direct actions.
- Leads and orders should have status summaries and clear next actions.

## Public Layout

- Public pages should expose the product and next action without competing auth choices.
- Legal pages should look consistent and be clearly marked as templates until reviewed.
