# Portfolio & Income Calculator

Standalone single-file web tool (HTML + inline JS, no dependencies, works offline).

Live: https://onlinelkb.in/portfolio-calculator/

## What it calculates
- Portfolio outcome over a period (years + months) with monthly compounding
- **Initial investment** (lump sum)
- **Monthly income %** — return earned each month on the opening balance
- **Monthly new investment** — amount added every month
- **Monthly withdrawal %** — a percentage of the current portfolio value, taken each month
- **Tax** — cut once per year at year-end, on that year's total profit
- **Total income** — gross gains, gains after tax, tax paid, final value, total withdrawn

## Monthly simulation order
1. Portfolio earns `monthly income %` on the opening balance
2. Monthly withdrawal (`withdrawal % × balance`) is taken
3. Monthly new investment is added
4. At each year-end: that year's total profit × tax rate is deducted

Includes a live growth chart (portfolio value vs. money invested) and a
year-by-year breakdown table with exact values on hover.

Source of truth maintained at `~/code/trade/portfolio_calculator.html`.
