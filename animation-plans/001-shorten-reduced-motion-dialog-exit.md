# 001 — Shorten reduced-motion dialog exit

- **Status**: DONE
- **Commit**: Repository had no Git commit when reviewed.
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, 4 lines

## Problem

`src/components/ui.tsx:92-94` always waited 240ms before closing a dialog. CSS correctly removes dialog transform under reduced motion, but the JavaScript close timer still held the modal and focus trap for the full movement-duration budget.

```tsx
frame = requestAnimationFrame(() => setVisible(false));
timer = setTimeout(() => { element.close(); document.body.classList.remove("dialog-open"); }, 240);
```

## Target

Respect reduced-motion preference for dialog close. Keep the opacity feedback, but close after 100ms for users who request reduced motion.

```tsx
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
frame = requestAnimationFrame(() => setVisible(false));
timer = setTimeout(() => { element.close(); document.body.classList.remove("dialog-open"); }, reduceMotion ? 100 : 240);
```

The 240ms normal dialog duration and `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` remain unchanged.

## Repo conventions to follow

- Motion tokens live in `src/app/globals.css:24-27`.
- Reduced-motion visual fallback lives in `src/app/globals.css:624-627`.
- Dialog lifecycle and visibility class live in `src/components/ui.tsx:78-102`.

## Steps

1. Read `window.matchMedia("(prefers-reduced-motion: reduce)").matches` inside the dialog lifecycle effect.
2. Keep normal close timing at 240ms.
3. Use 100ms only for the reduced-motion close timer.
4. Do not change dialog markup, focus behavior, press feedback, or animation tokens.

## Boundaries

- Do not add a motion dependency.
- Do not remove opacity feedback for reduced-motion users.
- Do not add movement to balances, trade lists, or keyboard navigation.

## Verification

- **Mechanical**: `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass.
- **Feel check**: open and close identity, launch review, trade review, epoch, and Claim dialogs quickly. Normal motion should remain a 240ms transform-and-opacity transition. With DevTools reduced motion enabled, movement disappears and close takes about 100ms while opacity feedback remains.
- **Done when**: focus returns after close without a visible 240ms reduced-motion delay.
