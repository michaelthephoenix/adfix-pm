# Adfix UI system

Adfix uses a compact, Linear-inspired interface for high-frequency project work. Every element must either orient the user, expose current state, or enable the next action.

## Principles

1. One primary action per page. Secondary actions remain visually quiet.
2. Creation and editing happen in dialogs or focused detail views, never in permanent page forms.
3. Filters describe the current list. Bulk actions only appear after selection.
4. State is communicated with text plus restrained color; color never carries meaning alone.
5. Surfaces use borders and hierarchy instead of gradients, large shadows, or decorative cards.
6. Controls are 32–36px on desktop and at least 44px on touch layouts.
7. Empty states explain the next useful action in one sentence.

## Tokens

- Canvas: `#0f1013`
- Sidebar: `#111216`
- Surface: `#16171c`
- Raised surface: `#1c1d23`
- Border: `#292b32`
- Primary text: `#f1f2f4`
- Secondary text: `#9699a3`
- Accent: `#5e6ad2`
- Success: `#4cb782`
- Warning: `#e2a03f`
- Danger: `#e56868`
- Radius: 6px controls, 8px panels, 10px dialogs
- Spacing: 4, 8, 12, 16, 24, 32

## Components

- `PageHeader`: title, one sentence of context, and one primary action.
- `Button`: primary, secondary, ghost, and danger variants.
- `Panel`: bordered content region with an optional compact header.
- `Badge`: neutral or semantic status label.
- `Dialog`: keyboard-accessible creation and editing surface.

## Content rules

- Prefer “In progress” over `in_progress`.
- Do not display internal identifiers when a project or person name is available.
- Avoid greetings, slogans, and decorative labels inside operational screens.
- Remove any element whose relevance cannot be explained in one sentence.
