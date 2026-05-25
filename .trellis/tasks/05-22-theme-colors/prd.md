# PRD: Frontend Theme Update - Black Gold AI Tech Style

## 1. Goal
Implement a high-end "Black Gold AI Tech" theme that conveys professionalism, modern SaaS aesthetics, and an AI-driven technological feel.

## 2. Design Specifications

### Color Palette (Design Tokens)
- **Primary Background**: `#030303` (Overall page background)
- **Section Background**: `#080704` / `#0B0A08`
- **Card Background**: `rgba(18, 15, 10, 0.82)`
- **Hover Card Background**: `rgba(28, 23, 14, 0.95)`
- **Brand Gold (Primary)**: `#FFC83D`
- **Highlight Gold**: `#FFE27A`
- **Deep Gold**: `#D99A18`
- **Primary Text**: `#F6F1E3` (Soft ivory/white)
- **Secondary Text**: `#B8AA86`
- **Muted Text**: `#6F6757`
- **Border**: `rgba(255, 200, 61, 0.18)`
- **Accent Border**: `rgba(255, 200, 61, 0.45)`
- **Gold Glow/Effect**: `rgba(255, 200, 61, 0.25)`

### Color Proportions
- **Deep Black**: 75%
- **Dark Gold/Brown Cards**: 15%
- **Gold Accents**: 7%
- **White/Ivory Text**: 3%

### Component Requirements
1. **Navbar**: Semi-transparent black background, `blur` effect, ultra-thin gold separator.
2. **Typography**: Headings use gold gradients for keywords, ivory white for others.
3. **Primary Button**: Gradient `#FFE27A` → `#FFC83D` → `#D99A18`, text color deep black.
4. **Secondary Button**: Transparent dark background, gold border, subtle gold glow on hover.
5. **Functional Cards**: Dark glassmorphism, 1px semi-transparent gold border, enhanced border/shadow on hover.
6. **Data Numbers**: Gold color, subtle `text-shadow`.
7. **Background Effects**: Subtle gold radial gradients, thin grids, or tech lines (minimalist).
8. **Icons**: Linear style, gold color.

## 3. Implementation Plan
- [ ] Update `app/globals.css` with the new design tokens.
- [ ] Implement utility classes for gold gradients and glassmorphism.
- [ ] Update key components (Button, Card, Navbar) to use the new tokens.
- [ ] Ensure text readability and accessibility.
- [ ] Verify the overall aesthetic consistency.
