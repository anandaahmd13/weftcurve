# Motion review

| Plan | Severity | Status | Scope |
|---|---:|---|---|
| 001 — Shorten reduced-motion dialog exit | MEDIUM | DONE | `src/components/ui.tsx`, `src/app/globals.css` |

## Review result

Reviewed after live simulator flows: identity dialog, launch review, trade review, epoch dialog, Claim dialog, and state refresh.

- Shared motion tokens use the approved curves.
- Press feedback is `scale(.97)` over 160ms.
- Dialogs use opacity and transform only, enter from `scale(.97)`, and retain an opacity response under reduced motion.
- No `transition: all`, `ease-in`, `scale(0)`, animated layout properties, money count-ups, or decorative list animation found.
- Fast keyboard/navigation actions do not animate.

`001` is complete: reduced-motion dialog close uses 100ms instead of the normal 240ms. No other motion changes are recommended until a real devnet transaction state is available for review.
